(() => {
  const data = window.OPIOID_WATCHER_DATA;
  const $ = (id) => document.getElementById(id);
  const state = { shown: 25 };
  const key = 'opioid-watcher-v1';
  let preferences;
  try { preferences = JSON.parse(localStorage.getItem(key) || '{}'); } catch { preferences = {}; }
  preferences.bookmarks ||= [];
  preferences.savedArticles ||= [];
  preferences.review ||= {};
  preferences.searches ||= [];
  if (data && Array.isArray(data.articles)) {
    for (const id of preferences.bookmarks) {
      const article = data.articles.find(item => item.id === id);
      if (article && !preferences.savedArticles.some(item => item.id === id)) preferences.savedArticles.push(article);
    }
  }
  preferences.bookmarks = [];
  preferences.searches = preferences.searches.map(saved => typeof saved === 'string'
    ? {term:saved, seenIds:(data?.articles || []).filter(item => `${item.title} ${item.source}`.toLowerCase().includes(saved.toLowerCase())).map(item => item.id)}
    : saved);
  const savePrefs = () => localStorage.setItem(key, JSON.stringify(preferences));
  window.OPIOID_WATCHER_PREFS = preferences;
  window.OPIOID_WATCHER_SAVE_PREFS = savePrefs;
  savePrefs();
  const escape = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatDate = (value) => new Date(value).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});
  const formatMonth = (value) => new Date(value + '-01T00:00:00Z').toLocaleDateString('en-US', {month:'long', year:'numeric', timeZone:'UTC'});

  function filtered() {
    const query = $('search').value.trim().toLocaleLowerCase();
    const onlySaved = $('bookmarks-only').checked;
    const focusOnly = $('focus-only').checked;
    const source = onlySaved ? preferences.savedArticles : data.articles;
    const result = source.filter(item =>
      ($('topic-filter').value === 'All topics' || item.topics.includes($('topic-filter').value)) &&
      (!query || `${item.title} ${item.source}`.toLocaleLowerCase().includes(query)) &&
      (!focusOnly || onlySaved || item.public_health_focus) &&
      ($('review-filter').value === 'all' || (preferences.review[item.id] || 'Unreviewed') === $('review-filter').value)
    );
    result.sort((a,b) => b.published_at.localeCompare(a.published_at));
    if ($('sort').value === 'oldest') result.reverse();
    if ($('sort').value === 'source') result.sort((a,b) => a.source.localeCompare(b.source) || b.published_at.localeCompare(a.published_at));
    return result;
  }

  function renderSavedSearches() {
    const host = $('saved-searches');
    host.replaceChildren();
    if (!preferences.searches.length) return;
    const label = document.createElement('span');
    label.textContent = 'Watched searches  ';
    host.append(label);
    preferences.searches.forEach((saved, index) => {
      const term = saved.term;
      saved.seenIds ||= [];
      const newMatches = data.articles.filter(item => `${item.title} ${item.source}`.toLowerCase().includes(term.toLowerCase()) && !saved.seenIds.includes(item.id));
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${term}${newMatches.length ? ` · ${newMatches.length} new since opened` : ''}`;
      button.title = 'Open this search and mark its current articles seen';
      button.addEventListener('click', () => {
        $('search').value = term; state.shown = 25;
        saved.seenIds = data.articles.filter(item => `${item.title} ${item.source}`.toLowerCase().includes(term.toLowerCase())).map(item => item.id);
        savePrefs(); render(); $('search').focus();
      });
      host.append(button);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Remove ${term}`;
      remove.setAttribute('aria-label', `Remove saved search ${term}`);
      remove.addEventListener('click', () => { preferences.searches.splice(index,1); savePrefs(); renderSavedSearches(); });
      host.append(remove);
    });
  }

  function render(focusTarget = null) {
    const result = filtered();
    const reviewed = data.articles.filter(item => preferences.review[item.id] === 'Relevant').length;
    const excluded = data.articles.filter(item => preferences.review[item.id] === 'Exclude').length;
    $('results-count').textContent = `${result.length} shown of ${data.articles.length} articles · ${reviewed} relevant · ${excluded} excluded · ${preferences.savedArticles.length} saved`;
    const focusCount = data.articles.filter(item => item.public_health_focus).length;
    $('focus-note').textContent = $('focus-only').checked
      ? `${focusCount} of ${data.articles.length} articles pass this headline keyword screen. You can turn it off to inspect every result.`
      : 'The public health keyword screen is off. You can review every retrieved article.';
    const host = $('article-list');
    host.replaceChildren();
    if (!result.length) {
      host.innerHTML = '<div class="empty">No headlines match these filters. Try another term or topic.</div>';
    }
    result.slice(0, state.shown).forEach(item => {
      const saved = preferences.savedArticles.some(savedItem => savedItem.id === item.id);
      const review = preferences.review[item.id] || 'Unreviewed';
      const older = !data.articles.some(current => current.id === item.id);
      const article = document.createElement('article');
      article.className = 'article';
      const validUrl = /^https:\/\/news\.google\.com\//.test(item.url) ? item.url : '#';
      article.innerHTML = `<div class="article-body"><div class="article-meta"><span class="publisher">${escape(item.source)}</span><span aria-hidden="true">·</span><time datetime="${escape(item.published_at)}">${escape(formatDate(item.published_at))}</time>${older?'<span class="status">Earlier snapshot</span>':''}${item.topics.slice(0,2).map(topic => `<span class="tag">${escape(topic)}</span>`).join('')}</div><h3><a href="${escape(validUrl)}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a></h3><details class="article-details"><summary>Source details</summary><p>Matched search topic: ${escape(item.retrieved_by || 'Configured news search')}. Open the headline to reach the publisher through Google News. Review labels remain local to this browser.</p></details></div><div class="article-actions"><button type="button" data-id="${escape(item.id)}" class="${saved?'saved':''}" aria-label="${saved?'Remove saved article':'Save article'}">${saved?'Saved':'Save'}</button><select data-review="${escape(item.id)}" aria-label="Review status for ${escape(item.title)}"><option value="Unreviewed" ${review==='Unreviewed'?'selected':''}>Unreviewed</option><option value="Relevant" ${review==='Relevant'?'selected':''}>Relevant</option><option value="Exclude" ${review==='Exclude'?'selected':''}>Exclude</option></select></div>`;
      host.append(article);
    });
    $('more-button').hidden = result.length <= state.shown;
    renderSavedSearches();
    if (focusTarget) {
      const selector = focusTarget.type === 'review' ? `select[data-review="${focusTarget.id}"]` : `button[data-id="${focusTarget.id}"]`;
      const next = host.querySelector(selector) || $('results-count');
      if (next === $('results-count')) next.tabIndex = -1;
      next.focus({preventScroll:true});
    }
  }

  function renderChart() {
    const rows = data.mortality.filter(item => Number.isFinite(item.predicted_count));
    const last = rows.at(-1);
    if (!last || rows.length < 2) return;
    $('stat-deaths').textContent = last.predicted_count.toLocaleString('en-US');
    $('stat-deaths-caption').textContent = `CDC estimates deaths involving any opioid in the 12 months through ${formatMonth(last.period_end)}.`;
    $('chart-period').textContent = `${formatMonth(rows[0].period_end)} to ${formatMonth(last.period_end)}`;
    const yearEarlier = rows.find(row => row.period_end === `${Number(last.period_end.slice(0,4))-1}${last.period_end.slice(4)}`);
    if (yearEarlier && yearEarlier.predicted_count) {
      const change = (last.predicted_count / yearEarlier.predicted_count - 1) * 100;
      $('chart-comparison').textContent = `${Math.abs(change).toFixed(1)}% ${change < 0 ? 'below' : 'above'} the same ending month one year earlier`;
    }
    const axis = $('chart-years');
    axis.replaceChildren();
    const addYear = (index, year, position) => {
      const tick = document.createElement('span');
      tick.textContent = year;
      tick.className = position === 'start' || position === 'end' ? position : Number(year) % 2 === 0 ? 'intermediate hide-small' : 'intermediate';
      tick.style.left = `${index * 100 / (rows.length - 1)}%`;
      axis.append(tick);
    };
    addYear(0, rows[0].period_end.slice(0, 4), 'start');
    rows.forEach((row, index) => {
      const year = row.period_end.slice(0, 4);
      if (row.period_end.endsWith('-01') && year !== rows[0].period_end.slice(0, 4) && year !== last.period_end.slice(0, 4)) addYear(index, year, 'middle');
    });
    addYear(rows.length - 1, last.period_end.slice(0, 4), 'end');
    const svg = $('mortality-chart');
    const width = 900, height = 330, left = 55, right = 15, top = 23, bottom = 36;
    const values = rows.map(row => row.predicted_count);
    const lo = Math.floor(Math.min(...values) * .9 / 5000) * 5000;
    const hi = Math.ceil(Math.max(...values) * 1.05 / 5000) * 5000;
    $('chart-scale-max').textContent = `${Math.round(hi / 1000)}k`;
    $('chart-scale-min').textContent = `${Math.round(lo / 1000)}k`;
    const x = i => left + i * (width-left-right)/(rows.length-1);
    const y = n => top + (hi-n) * (height-top-bottom)/(hi-lo);
    const svgNS = 'http://www.w3.org/2000/svg';
    const node = (name, attrs) => {
      const el = document.createElementNS(svgNS, name);
      for (const [key,value] of Object.entries(attrs)) el.setAttribute(key, value);
      svg.append(el); return el;
    };
    svg.replaceChildren();
    for (let tick=lo; tick<=hi; tick+=10000) {
      node('line',{x1:left,y1:y(tick),x2:width-right,y2:y(tick),stroke:'#c9d1c8','stroke-width':1});
      const label = node('text',{x:0,y:y(tick)+4,fill:'#58625d','font-size':12,'font-family':'Arial, sans-serif'});
      label.textContent = `${Math.round(tick/1000)}k`;
    }
    const path = values.map((value,i) => `${i?'L':'M'} ${x(i).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
    node('path',{d:path,fill:'none',stroke:'#ab492f','stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'});
    const dot = node('circle',{cx:x(values.length-1),cy:y(last.predicted_count),r:6,fill:'#ab492f',stroke:'white','stroke-width':3});
    const title = document.createElementNS(svgNS,'title');
    title.textContent = `${formatMonth(last.period_end)}: ${last.predicted_count.toLocaleString('en-US')} predicted provisional deaths in the prior 12 months`;
    dot.append(title);
    const tbody = $('mortality-table-body');
    tbody.replaceChildren();
    rows.slice().reverse().forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th scope="row">${escape(formatMonth(row.period_end))}</th><td>${Number(row.predicted_count).toLocaleString('en-US')}</td><td>${row.reported_count == null ? '—' : Number(row.reported_count).toLocaleString('en-US')}</td>`;
      tbody.append(tr);
    });
  }

  function renderHistory() {
    const history = Array.isArray(data.history) ? data.history.slice(-30) : [];
    const svg = $('history-chart');
    svg.replaceChildren();
    if (!history.length) return;
    const latest = history.at(-1);
    svg.hidden = history.length < 2;
    $('history-description').textContent = history.length === 1
      ? `History begins with this refresh. ${latest.public_health_focus_leads} articles pass the current keyword screen.`
      : `${latest.public_health_focus_leads} public health focus leads in the latest of ${history.length} daily snapshots. Counts reflect retrieval, not underlying events.`;
    const ns = 'http://www.w3.org/2000/svg';
    const values = history.map(entry => entry.public_health_focus_leads);
    const max = Math.max(1, ...values);
    const x = index => 8 + index * 244 / Math.max(1, values.length - 1);
    const y = value => 56 - value * 45 / max;
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', values.map((value,index) => `${index?'L':'M'} ${x(index)} ${y(value)}`).join(' '));
    line.setAttribute('fill','none'); line.setAttribute('stroke','#ab492f'); line.setAttribute('stroke-width','2');
    svg.append(line);
    values.forEach((value,index) => {
      const dot = document.createElementNS(ns,'circle');
      dot.setAttribute('cx',x(index)); dot.setAttribute('cy',y(value)); dot.setAttribute('r',3);
      dot.setAttribute('fill','#ab492f');
      const title = document.createElementNS(ns,'title');
      title.textContent = `${history[index].date}: ${value} public health focus leads retrieved`;
      dot.append(title); svg.append(dot);
    });
  }

  function exportCsv() {
    const rows = [['published_utc','publisher','headline','topics','matched_search','url','review_status'], ...filtered().map(item => [item.published_at,item.source,item.title,item.topics.join('; '),item.retrieved_by || '',item.url,preferences.review[item.id] || 'Unreviewed'])];
    const quote = value => {
      const safe = /^[=+\-@]/.test(String(value)) ? `'${value}` : String(value);
      return `"${safe.replaceAll('"','""')}"`;
    };
    const blob = new Blob([rows.map(row => row.map(quote).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href=url; link.download='opioid-watcher-media-leads.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!data || !Array.isArray(data.articles) || !Array.isArray(data.mortality)) {
    $('refreshed').textContent = 'No valid snapshot found. Run refresh.command.';
    return;
  }
  $('refreshed').textContent = `Snapshot refreshed ${formatDate(data.refreshed_at)}`;
  $('article-total').textContent = 'Current 14-day retrieval';
  renderChart(); renderHistory(); render();
  $('search').addEventListener('input', () => { state.shown=25; render(); });
  $('topic-filter').addEventListener('change', () => { state.shown=25; render(); });
  $('review-filter').addEventListener('change', () => { state.shown=25; render(); });
  $('sort').addEventListener('change', () => render());
  $('bookmarks-only').addEventListener('change', () => { state.shown=25; render(); });
  $('focus-only').addEventListener('change', () => { state.shown=25; render(); });
  $('more-button').addEventListener('click', () => { state.shown+=25; render(); });
  $('article-list').addEventListener('click', event => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const id = button.dataset.id;
    if (preferences.savedArticles.some(item => item.id === id)) preferences.savedArticles = preferences.savedArticles.filter(item => item.id !== id);
    else {
      const article = data.articles.find(item => item.id === id);
      if (article) preferences.savedArticles.push(article);
    }
    savePrefs(); render({type:'save',id});
  });
  $('article-list').addEventListener('change', event => {
    const select = event.target.closest('select[data-review]');
    if (!select) return;
    preferences.review[select.dataset.review] = select.value;
    savePrefs(); render({type:'review',id:select.dataset.review});
  });
  $('export-button').addEventListener('click', exportCsv);
  $('save-search').addEventListener('click', () => {
    const term = $('search').value.trim();
    if (!term) { $('search-status').textContent = 'Enter a term before creating a watch.'; return; }
    if (preferences.searches.some(saved => saved.term.toLowerCase() === term.toLowerCase())) { $('search-status').textContent = 'You already watch this search.'; return; }
    preferences.searches.push({term, seenIds:data.articles.filter(item => `${item.title} ${item.source}`.toLowerCase().includes(term.toLowerCase())).map(item => item.id)});
    savePrefs(); renderSavedSearches(); $('search-status').textContent = `Watching “${term}” for new articles after the next refresh.`;
  });
})();
