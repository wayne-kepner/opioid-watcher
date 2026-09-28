(() => {
  const archive = window.OPIOID_WATCHER_ARCHIVE;
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const monthName = value => new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-US', {month:'long',year:'numeric',timeZone:'UTC'});
  const articleDate = value => new Date(value).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  window.addEventListener('load', () => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, {once:true});
  if (!archive || !Array.isArray(archive.articles) || !Array.isArray(archive.months)) {
    $('archive-range').textContent = 'The archive is unavailable. Run python3 archive.py in the Opioid Watcher folder.';
    $('archive-total-note').textContent = 'No archive snapshot found';
    $('archive-results-count').textContent = 'No archived articles';
    return;
  }
  const prefs = window.OPIOID_WATCHER_PREFS || {review:{}};
  const savePrefs = window.OPIOID_WATCHER_SAVE_PREFS || (() => {});
  const state = {month:null, shown:25};
  const focusTotal = archive.months.reduce((sum, month) => sum + month.focus, 0);
  const capped = archive.months.filter(month => month.capped);
  $('archive-range').textContent = `${archive.start} through ${new Date(Date.parse(archive.end_exclusive) - 86400000).toISOString().slice(0,10)} · U.S. edition, English interface`;
  $('archive-focus-total').textContent = focusTotal.toLocaleString('en-US');
  $('archive-total-note').textContent = `${archive.articles.length.toLocaleString('en-US')} retrieved headlines · ${archive.months.length} calendar months`;
  $('archive-chart-note').textContent = capped.length
    ? `${capped.length} striped bars mark months with a date that returned at least 100 search results. Those bars show minimum retrieved counts. The first and last months cover only part of a month. The U.S. edition can include coverage from elsewhere.`
    : 'The first and last months cover only part of a month. The U.S. edition can include coverage from elsewhere. Google News search results are not a census of published coverage.';
  $('archive-limit').textContent = 'The chart counts distinct retrieved headlines that pass the public health keyword screen. Search indexing changes, and several publishers may report the same event.';

  function drawChart() {
    const host = $('archive-chart');
    const axis = $('archive-axis');
    host.replaceChildren(); axis.replaceChildren();
    const max = Math.max(1, ...archive.months.map(month => month.focus));
    $('archive-scale-label').textContent = `0–${max} headlines · Click a month to inspect`;
    archive.months.forEach((month, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `archive-bar${state.month === month.period ? ' selected' : ''}${month.capped ? ' capped' : ''}`;
      button.style.height = `${Math.max(3, month.focus / max * 100)}%`;
      button.setAttribute('aria-label', `${monthName(month.period)}, ${month.focus} likely public health headlines${month.capped ? ', minimum count because retrieval hit a cap' : ''}`);
      button.setAttribute('aria-pressed', String(state.month === month.period));
      button.title = `${monthName(month.period)}: ${month.focus} likely public health headlines${month.capped ? ' (minimum)' : ''}`;
      button.addEventListener('click', () => {
        state.month = state.month === month.period ? null : month.period;
        state.shown = 25; drawChart(); renderList();
        $('archive-results-count').scrollIntoView({block:'nearest'});
      });
      host.append(button);
      if (index === 0 || month.period.endsWith('-01')) {
        const label = document.createElement('span');
        label.textContent = month.period.slice(0,4);
        label.style.left = `${(index + 0.5) * 100 / archive.months.length}%`;
        axis.append(label);
      }
    });
  }

  function matching() {
    const query = $('archive-search').value.trim().toLocaleLowerCase();
    const topic = $('archive-topic').value;
    const review = $('archive-review').value;
    const focusOnly = $('archive-focus-only').checked;
    return archive.articles.filter(item =>
      (!state.month || item.published_at.startsWith(state.month)) &&
      (!query || `${item.title} ${item.source}`.toLocaleLowerCase().includes(query)) &&
      (topic === 'All topics' || item.topics.includes(topic)) &&
      (!focusOnly || item.public_health_focus) &&
      (review === 'all' || (prefs.review[item.id] || 'Unreviewed') === review)
    );
  }

  function renderList(focusId = null) {
    const items = matching();
    $('archive-selected-period').textContent = state.month ? monthName(state.month) : 'All months';
    $('archive-clear-month').hidden = !state.month;
    $('archive-results-count').textContent = `${items.length.toLocaleString('en-US')} matching headlines · ${Math.min(items.length,state.shown).toLocaleString('en-US')} shown`;
    const host = $('archive-list');
    host.replaceChildren();
    if (!items.length) host.innerHTML = '<div class="empty">No archived headlines match these filters.</div>';
    const fragment = document.createDocumentFragment();
    items.slice(0,state.shown).forEach(item => {
      const review = prefs.review[item.id] || 'Unreviewed';
      const article = document.createElement('article');
      article.className = 'article';
      const url = /^https:\/\/news\.google\.com\//.test(item.url) ? item.url : '#';
      article.innerHTML = `<div class="article-body"><div class="article-meta"><span class="publisher">${escape(item.source)}</span><span aria-hidden="true">·</span><time datetime="${escape(item.published_at)}">${escape(articleDate(item.published_at))}</time>${item.topics.slice(0,2).map(topic => `<span class="tag">${escape(topic)}</span>`).join('')}</div><h3><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a></h3></div><div class="article-actions"><select data-archive-review="${escape(item.id)}" aria-label="Review status for ${escape(item.title)}"><option value="Unreviewed" ${review==='Unreviewed'?'selected':''}>Unreviewed</option><option value="Relevant" ${review==='Relevant'?'selected':''}>Relevant</option><option value="Exclude" ${review==='Exclude'?'selected':''}>Exclude</option></select></div>`;
      fragment.append(article);
    });
    host.append(fragment);
    $('archive-more').hidden = items.length <= state.shown;
    if (focusId) host.querySelector(`select[data-archive-review="${focusId}"]`)?.focus({preventScroll:true});
  }

  drawChart(); renderList();
  for (const id of ['archive-search','archive-topic','archive-review','archive-focus-only']) {
    $(id).addEventListener(id === 'archive-search' ? 'input' : 'change', () => { state.shown=25; renderList(); });
  }
  $('archive-clear-month').addEventListener('click', () => { state.month=null; state.shown=25; drawChart(); renderList(); });
  $('archive-more').addEventListener('click', () => { state.shown+=25; renderList(); });
  $('archive-export').addEventListener('click', () => {
    const rows = [['published_utc','publisher','headline','topics','public_health_screen','review_status','url'],
      ...matching().map(item => [item.published_at,item.source,item.title,item.topics.join('; '),item.public_health_focus ? 'yes' : 'no',prefs.review[item.id] || 'Unreviewed',item.url])];
    const quote = value => {
      const safe = /^[=+\-@]/.test(String(value)) ? `'${value}` : String(value);
      return `"${safe.replaceAll('"','""')}"`;
    };
    const blob = new Blob([rows.map(row => row.map(quote).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'opioid-watcher-five-year-archive.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('archive-list').addEventListener('change', event => {
    const select = event.target.closest('select[data-archive-review]');
    if (!select) return;
    prefs.review[select.dataset.archiveReview] = select.value;
    savePrefs(); renderList(select.dataset.archiveReview);
  });
})();
