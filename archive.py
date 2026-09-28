#!/usr/bin/env python3
"""Build a dated, auditable five-year Google News retrieval archive."""

from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import tempfile
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from refresh import CORE_TERMS, FEED_BASE, ROOT, TOPIC_RULES, fetch, public_health_focus


QUERY = "(opioid OR fentanyl OR naloxone OR methadone OR buprenorphine OR xylazine OR nitazene)"
PROGRESS = ROOT / "archive-progress.json"
MAX_RESULTS = 100


def dated_url(start: date, end: date) -> str:
    query = f"{QUERY} after:{start.isoformat()} before:{end.isoformat()}"
    params = urllib.parse.urlencode({"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    return f"{FEED_BASE}?{params}"


def parse_feed(start: date, end: date) -> tuple[list[dict], int]:
    root = ET.fromstring(fetch(dated_url(start, end), timeout=40))
    raw_items = root.findall("./channel/item")
    articles = []
    for item in raw_items:
        title = html.unescape(" ".join((item.findtext("title") or "").split()))
        source_node = item.find("source")
        source = html.unescape(source_node.text or "") if source_node is not None else "Unknown source"
        if title.endswith(f" - {source}"):
            title = title[: -(len(source) + 3)]
        if len(title) < 18 or not CORE_TERMS.search(title):
            continue
        if re.search(r"\bnon-opioid\b", title, re.IGNORECASE) and not re.search(
            r"\b(opioid use disorder|overdose|fentanyl|naloxone|buprenorphine|methadone)\b",
            title, re.IGNORECASE,
        ):
            continue
        try:
            published = parsedate_to_datetime(item.findtext("pubDate") or "").astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        if not start <= published.date() < end:
            continue
        link = (item.findtext("link") or "").strip()
        if not link.startswith("https://news.google.com/"):
            continue
        topics = [name for name, pattern in TOPIC_RULES.items() if re.search(pattern, title, re.IGNORECASE)]
        if not topics:
            topics = ["Other opioid news"]
        articles.append({
            "id": hashlib.sha256(f"{title}|{source}".encode()).hexdigest()[:16],
            "title": title,
            "url": link,
            "source": source,
            "published_at": published.isoformat(),
            "topics": topics,
            "public_health_focus": public_health_focus(title),
        })
    return articles, len(raw_items)


def save_json(path: Path, payload: object) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=ROOT, delete=False) as tmp:
        json.dump(payload, tmp, ensure_ascii=False, separators=(",", ":"))
        tmp.write("\n")
        name = Path(tmp.name)
    name.replace(path)


def already_covered(start: date, end: date, windows: dict) -> bool:
    cursor = start
    for key in sorted(windows):
        left, right = (date.fromisoformat(part) for part in key.split("_"))
        if right <= cursor:
            continue
        if left > cursor:
            return False
        cursor = max(cursor, right)
        if cursor >= end:
            return True
    return False


def main() -> int:
    today = datetime.now().date()
    try:
        start = today.replace(year=today.year - 5)
    except ValueError:
        start = today.replace(year=today.year - 5, day=28)
    end = today + timedelta(days=1)
    try:
        progress = json.loads(PROGRESS.read_text(encoding="utf-8"))
        if progress.get("query") != QUERY:
            progress = {}
    except (FileNotFoundError, ValueError):
        progress = {}
    origin = date.fromisoformat(progress.get("start", start.isoformat()))
    progress = {"query": QUERY, "start": origin.isoformat(), "end": end.isoformat(), "windows": progress.get("windows", {})}
    queue = []
    cursor = origin
    while cursor < end:
        next_day = min(cursor + timedelta(days=7), end)
        queue.append((cursor, next_day))
        cursor = next_day
    requests = 0
    while queue:
        left, right = queue.pop(0)
        key = f"{left.isoformat()}_{right.isoformat()}"
        if already_covered(left, right, progress["windows"]):
            continue
        for attempt in range(3):
            try:
                items, raw_count = parse_feed(left, right)
                break
            except Exception as error:
                if attempt == 2:
                    print(f"Archive stopped at {key}: {error}", file=sys.stderr)
                    save_json(PROGRESS, progress)
                    return 1
                time.sleep(2 ** attempt)
        requests += 1
        if raw_count >= MAX_RESULTS and (right - left).days > 1:
            middle = left + timedelta(days=max(1, (right - left).days // 2))
            queue[:0] = [(left, middle), (middle, right)]
            continue
        for previous in list(progress["windows"]):
            previous_left, previous_right = (date.fromisoformat(part) for part in previous.split("_"))
            if previous_left < right and previous_right > left:
                del progress["windows"][previous]
        progress["windows"][key] = {"articles": items, "capped": raw_count >= MAX_RESULTS}
        if requests % 20 == 0:
            save_json(PROGRESS, progress)
            print(f"Retrieved {len(progress['windows'])} completed windows; {len(queue)} remain.", flush=True)
        time.sleep(0.15)
    save_json(PROGRESS, progress)
    covered_until = origin
    for key in sorted(progress["windows"]):
        left, right = (date.fromisoformat(part) for part in key.split("_"))
        if left > covered_until:
            raise RuntimeError(f"Missing archive dates from {covered_until} to {left}.")
        covered_until = max(covered_until, right)
    if covered_until < end:
        raise RuntimeError(f"Missing archive dates from {covered_until} to {end}.")
    unique = {}
    for window in progress["windows"].values():
        for article in window["articles"]:
            if start <= date.fromisoformat(article["published_at"][:10]) < end:
                article["public_health_focus"] = public_health_focus(article["title"])
                unique[article["id"]] = article
    articles = sorted(unique.values(), key=lambda item: item["published_at"], reverse=True)
    months = {}
    cursor = date(start.year, start.month, 1)
    while cursor < end:
        months[cursor.strftime("%Y-%m")] = {"period": cursor.strftime("%Y-%m"), "retrieved": 0, "focus": 0, "capped": False}
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    for article in articles:
        month = months[article["published_at"][:7]]
        month["retrieved"] += 1
        month["focus"] += int(article["public_health_focus"])
    for key, window in progress["windows"].items():
        if window["capped"]:
            month = key[:7]
            if month in months:
                months[month]["capped"] = True
    payload = {
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        "start": start.isoformat(), "end_exclusive": end.isoformat(),
        "query": QUERY, "source": "Google News RSS, U.S. edition and English interface",
        "complete": not any(month["capped"] for month in months.values()),
        "months": list(months.values()), "articles": articles,
    }
    save_json(ROOT / "archive.json", payload)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=ROOT, delete=False) as tmp:
        tmp.write("window.OPIOID_WATCHER_ARCHIVE = ")
        json.dump(payload, tmp, ensure_ascii=False, separators=(",", ":"))
        tmp.write(";\n")
        name = Path(tmp.name)
    name.replace(ROOT / "archive.js")
    print(f"Archived {len(articles)} distinct headlines across {len(months)} calendar months. Capped months: {sum(month['capped'] for month in months.values())}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
