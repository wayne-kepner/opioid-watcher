#!/usr/bin/env python3
"""Refresh a local, source-linked opioid news watch and one CDC mortality series."""

from __future__ import annotations

import calendar
import hashlib
import html
import json
import re
import subprocess
import sys
import tempfile
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CDC_URL = "https://data.cdc.gov/resource/xkb8-kh2a.json"
CDC_SOURCE = "https://www.cdc.gov/nchs/nvss/vsrr/drug-overdose-data.htm"
FEED_BASE = "https://news.google.com/rss/search"
FEEDS = {
    "Overdose and supply": "opioid OR fentanyl OR overdose when:14d",
    "Treatment access": "buprenorphine OR methadone OR opioid treatment when:14d",
    "Harm reduction": "naloxone OR Narcan OR drug checking when:14d",
    "Policy and courts": "opioid settlement OR opioid policy OR fentanyl legislation when:14d",
    "Research": "opioid study OR fentanyl research when:14d",
}
CORE_TERMS = re.compile(
    r"\b(opioid|opiate|fentanyl|naloxone|narcan|buprenorphine|methadone|overdose|heroin|nitazene|xylazine|medetomidine|drug checking)\b",
    re.IGNORECASE,
)
FOCUS_TERMS = re.compile(
    r"\b(treatment|methadone|buprenorphine|naloxone|narcan|prevention|harm reduction|drug checking|settlement|medicaid|policy|legislation|law|study|research|trial|health department|overdose deaths|mortality|drug supply|recovery)\b",
    re.IGNORECASE,
)
CASE_NEWS = re.compile(
    r"\b(charged|arrested|sentenced|guilty|plea|prosecution|trial of|bust|seize|seized|seizure|trafficking|poisoning|possession|firearms|swat|indicted|indictment|murder|manslaughter|court told)\b",
    re.IGNORECASE,
)
PAIN_PROCEDURE = re.compile(r"\b(postoperative|post-op|surgical|surgery|anesthesia|analgesia|orthopedic)\b", re.IGNORECASE)
ADDICTION_CONTEXT = re.compile(r"\b(overdose|addiction|opioid use disorder|fentanyl crisis|opioid crisis|naloxone|narcan|methadone|buprenorphine|harm reduction|drug death)\b", re.IGNORECASE)
TOPIC_RULES = {
    "Overdose and supply": r"\b(overdose|fentanyl|nitazene|xylazine|medetomidine|drug supply|opioid death)\b",
    "Treatment access": r"\b(buprenorphine|methadone|treatment|medication for opioid|moud|recovery|opioid use disorder)\b",
    "Harm reduction": r"\b(naloxone|narcan|harm reduction|drug checking|test strip|overdose prevention)\b",
    "Policy and courts": r"\b(settlement|lawsuit|litigation|court|legislation|bill|congress|policy|medicaid|dea|fda)\b",
    "Research": r"\b(study|research|clinical trial|randomized trial|scientists|journal|university|nih)\b",
}


def public_health_focus(title: str) -> bool:
    return bool(
        FOCUS_TERMS.search(title)
        and not CASE_NEWS.search(title)
        and (not PAIN_PROCEDURE.search(title) or ADDICTION_CONTEXT.search(title))
    )


def fetch(url: str, *, timeout: int = 25) -> bytes:
    response = subprocess.run(
        ["/usr/bin/curl", "--fail", "--location", "--silent", "--show-error",
         "--max-time", str(timeout), "--user-agent", "OpioidWatcherLocal/0.1", url],
        check=True, capture_output=True,
    )
    return response.stdout


def get_news(now: datetime) -> tuple[list[dict], list[str]]:
    articles: dict[str, dict] = {}
    warnings: list[str] = []
    cutoff = now - timedelta(days=14)
    for feed_name, query in FEEDS.items():
        params = urllib.parse.urlencode(
            {"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"}
        )
        try:
            root = ET.fromstring(fetch(f"{FEED_BASE}?{params}"))
        except Exception as error:
            warnings.append(f"{feed_name} feed failed: {error}")
            continue
        for item in root.findall("./channel/item"):
            title = html.unescape(" ".join((item.findtext("title") or "").split()))
            link = (item.findtext("link") or "").strip()
            source_node = item.find("source")
            source = html.unescape(source_node.text or "") if source_node is not None else "Unknown source"
            if title.endswith(f" - {source}"):
                title = title[: -(len(source) + 3)]
            if not CORE_TERMS.search(title):
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
            if published < cutoff or published > now + timedelta(days=1):
                continue
            if not link.startswith("https://news.google.com/"):
                continue
            key = re.sub(r"\W+", "", title.casefold())
            if not key or len(title) < 18:
                continue
            if key in articles:
                continue
            topics = [
                name for name, pattern in TOPIC_RULES.items()
                if re.search(pattern, title, re.IGNORECASE)
            ]
            if not topics:
                topics = ["Other opioid news"]
            articles[key] = {
                "id": hashlib.sha256(f"{title}|{source}".encode()).hexdigest()[:16],
                "title": title,
                "url": link,
                "source": source,
                "published_at": published.isoformat(),
                "topics": topics,
                "retrieved_by": feed_name,
                "public_health_focus": public_health_focus(title),
                "review_status": "Unreviewed",
            }
    if not articles:
        raise RuntimeError("No recent news articles were retrieved; existing snapshot was preserved.")
    if warnings:
        raise RuntimeError("One or more required news feeds failed: " + " | ".join(warnings))
    return sorted(articles.values(), key=lambda item: item["published_at"], reverse=True)[:300], warnings


def get_mortality() -> list[dict]:
    params = urllib.parse.urlencode({
        "$where": "state='US' AND indicator='Opioids (T40.0-T40.4,T40.6)'",
        "$limit": 500,
    })
    rows = json.loads(fetch(f"{CDC_URL}?{params}"))
    months = {name: number for number, name in enumerate(calendar.month_name) if name}
    output = []
    for row in rows:
        if row.get("month") not in months or not row.get("year"):
            continue
        if not row.get("predicted_value") and not row.get("data_value"):
            continue
        output.append({
            "period_end": f"{int(row['year']):04d}-{months[row['month']]:02d}",
            "reported_count": int(row["data_value"]) if row.get("data_value") else None,
            "predicted_count": int(row["predicted_value"]) if row.get("predicted_value") else None,
            "footnote": row.get("footnote", ""),
        })
    output.sort(key=lambda row: row["period_end"])
    recent = output[-60:]
    periods = [int(row["period_end"][:4]) * 12 + int(row["period_end"][5:]) for row in recent]
    if len(recent) != 60 or any(row["predicted_count"] is None for row in recent) or any(
        later - earlier != 1 for earlier, later in zip(periods, periods[1:])
    ):
        raise RuntimeError("CDC did not return 60 consecutive predicted monthly periods; existing snapshot was preserved.")
    return recent


def write_snapshot(payload: dict) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    for filename, content in (
        ("data.json", encoded + "\n"),
        ("data.js", "window.OPIOID_WATCHER_DATA = " + encoded + ";\n"),
        ("history.json", json.dumps(payload["history"], ensure_ascii=False, indent=2) + "\n"),
    ):
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=ROOT, delete=False) as tmp:
            tmp.write(content)
            tmp_name = Path(tmp.name)
        tmp_name.replace(ROOT / filename)


def main() -> int:
    now = datetime.now(timezone.utc)
    try:
        news, warnings = get_news(now)
        mortality = get_mortality()
        try:
            history = json.loads((ROOT / "history.json").read_text(encoding="utf-8"))
            if not isinstance(history, list):
                history = []
        except (FileNotFoundError, ValueError):
            history = []
        today = datetime.now().date().isoformat()
        history = [entry for entry in history if entry.get("date", "") < today]
        history.append({
            "date": today,
            "retrieved_leads": len(news),
            "public_health_focus_leads": sum(article["public_health_focus"] for article in news),
            "article_ids": [article["id"] for article in news],
        })
        history = sorted(history, key=lambda entry: entry["date"])[-90:]
        payload = {
            "refreshed_at": now.isoformat(),
            "news_window_days": 14,
            "news_source": "Google News RSS search results; U.S. edition, English interface; coverage may include events outside the United States",
            "news_source_url": "https://news.google.com/",
            "news_limitations": "Search results and topic labels are unreviewed media leads. Feed coverage and article counts do not measure opioid use, overdose incidence, or policy adoption.",
            "mortality_source": CDC_SOURCE,
            "mortality_api": CDC_URL,
            "mortality_measure": "Predicted number of U.S. drug overdose deaths involving any opioid, 12-month-ending period; provisional, based on deaths by place of occurrence",
            "articles": news,
            "mortality": mortality,
            "history": history,
            "warnings": warnings,
        }
        write_snapshot(payload)
    except Exception as error:
        print(f"Refresh failed: {error}", file=sys.stderr)
        return 1
    print(f"Updated {len(news)} media leads and {len(mortality)} CDC periods at {now:%Y-%m-%d %H:%M UTC}.")
    for warning in warnings:
        print(f"Warning: {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
