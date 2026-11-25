import { escapeHtml } from './utils.js';

const searchStates = new Map();

function getSearchState(targetId) {
  let st = searchStates.get(targetId);
  if (!st) {
    st = { query: '', caseSensitive: false, activeIdx: 0, matches: [] };
    searchStates.set(targetId, st);
  }
  return st;
}

export function resetEditorSearch(targetId = 'td-edit-content') {
  searchStates.set(targetId, { query: '', caseSensitive: false, activeIdx: 0, matches: [] });
}

export function setEditorSearchQuery(targetId, query, containerEl, opts = {}) {
  const root = containerEl || document;
  const ta = root.querySelector(`#${targetId}`);
  const inp = root.querySelector(`[data-role='editor-search-input'][data-target='${targetId}']`);
  const st = getSearchState(targetId);
  st.query = String(query || '');
  st.caseSensitive = !!opts.caseSensitive;
  st.activeIdx = 0;

  if (inp) inp.value = st.query;
  const caseBtn = root.querySelector(`[data-action='es-case'][data-target='${targetId}']`);
  if (caseBtn) caseBtn.classList.toggle('active', st.caseSensitive);

  if (ta && st.query) {
    const matches = findMatches(ta.value || '', st.query, st.caseSensitive);
    st.matches = matches;
    if (typeof opts.preferredOffset === 'number' && opts.preferredOffset >= 0 && matches.length > 0) {
      let bestIdx = matches.findIndex((m) => m.start === opts.preferredOffset);
      if (bestIdx < 0) bestIdx = matches.findIndex((m) => m.start >= opts.preferredOffset);
      if (bestIdx >= 0) st.activeIdx = bestIdx;
    }
  }

  syncEditorSearchHighlights(targetId, root, false);
  if (opts.scrollToActive !== false) {
    requestAnimationFrame(() => syncEditorSearchHighlights(targetId, root, true));
  }
}

function findMatches(text, query, caseSensitive) {
  if (!query) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];
  const matches = [];
  let pos = 0;
  while (pos <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, pos);
    if (idx < 0) break;
    matches.push({ start: idx, end: idx + needle.length });
    pos = idx + needle.length;
    if (matches.length >= 2000) break;
  }
  return matches;
}

export function renderSearchableTextareaHtml({
  id = 'td-edit-content',
  value = '',
  placeholder = '',
  minHeight = '160px',
  readonly = false,
} = {}) {
  resetEditorSearch(id);
  const roAttr = readonly ? 'readonly' : '';
  const phAttr = placeholder ? `placeholder='${escapeHtml(placeholder)}'` : '';
  return `
    <div class='td-hl-wrap td-editor-hl-wrap' data-search-wrap='${escapeHtml(id)}' style='min-height:${escapeHtml(minHeight)};'>
      <div class='td-hl-backdrop' id='${escapeHtml(id)}-bd' aria-hidden='true'></div>
      <textarea class='td-textarea td-hl-textarea td-scroll' id='${escapeHtml(id)}' ${phAttr} ${roAttr}>${escapeHtml(value)}</textarea>
    </div>
    <div class='td-editor-search-bar' data-search-bar='${escapeHtml(id)}'>
      <div class='td-search-input-wrap' style='flex:1;min-width:110px;'>
        <input class='td-search-input td-editor-search-input' data-role='editor-search-input' data-target='${escapeHtml(id)}' type='text' placeholder='搜索正文关键词并高亮...' value='' />
      </div>
      <span class='td-editor-search-count' data-role='editor-search-count' data-target='${escapeHtml(id)}'>0/0</span>
      <button type='button' class='td-btn sm' data-action='es-prev' data-target='${escapeHtml(id)}' title='上一个匹配 (Shift+Enter)'>↑</button>
      <button type='button' class='td-btn sm' data-action='es-next' data-target='${escapeHtml(id)}' title='下一个匹配 (Enter)'>↓</button>
      <button type='button' class='td-chip' data-action='es-case' data-target='${escapeHtml(id)}' title='区分大小写'>Aa</button>
      <button type='button' class='td-btn sm' data-action='es-clear' data-target='${escapeHtml(id)}' title='清空搜索'>清空</button>
    </div>`;
}

export function syncEditorSearchHighlights(targetId, containerEl, scrollToActive = false) {
  const root = containerEl || document;
  const ta = root.querySelector(`#${targetId}`);
  const wrap = root.querySelector(`[data-search-wrap='${targetId}']`);
  const bd = root.querySelector(`#${targetId}-bd`);
  const countEl = root.querySelector(`[data-role='editor-search-count'][data-target='${targetId}']`);
  if (!ta || !wrap || !bd) return;

  const st = getSearchState(targetId);
  const query = st.query || '';
  const text = ta.value || '';

  if (!query) {
    st.matches = [];
    st.activeIdx = 0;
    wrap.classList.remove('has-search');
    bd.innerHTML = '';
    if (countEl) countEl.textContent = '0/0';
    return;
  }

  const matches = findMatches(text, query, st.caseSensitive);
  st.matches = matches;
  if (matches.length === 0) st.activeIdx = 0;
  else if (st.activeIdx >= matches.length || st.activeIdx < 0) st.activeIdx = 0;

  wrap.classList.add('has-search');

  let html = '';
  let last = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.start > last) html += escapeHtml(text.slice(last, m.start));
    const cls = i === st.activeIdx ? 'td-es-hit is-current' : 'td-es-hit';
    html += `<mark class='${cls}' data-hit-idx='${i}'>${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    last = m.end;
  }
  if (last < text.length) html += escapeHtml(text.slice(last));
  if (text.endsWith('\n') || text === '') html += '\u200b';
  bd.innerHTML = html;

  if (countEl) {
    countEl.textContent = matches.length > 0 ? `${st.activeIdx + 1}/${matches.length}` : '0/0';
  }

  if (scrollToActive && matches.length > 0) {
    const curMark = bd.querySelector(`mark[data-hit-idx='${st.activeIdx}']`);
    if (curMark) {
      const targetTop = Math.max(0, curMark.offsetTop - Math.floor(ta.clientHeight * 0.4));
      ta.scrollTop = targetTop;
    }
  }
  bd.scrollTop = ta.scrollTop;
  bd.scrollLeft = ta.scrollLeft;
}

export function bindEditorSearchEvents(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll('.td-editor-hl-wrap .td-hl-textarea').forEach((ta) => {
    if (ta.dataset.tdEsScrollBound) return;
    ta.dataset.tdEsScrollBound = '1';
    const targetId = ta.id;
    const bd = containerEl.querySelector(`#${targetId}-bd`);
    if (!bd) return;
    ta.addEventListener('scroll', () => {
      bd.scrollTop = ta.scrollTop;
      bd.scrollLeft = ta.scrollLeft;
    }, { passive: true });
  });
}

function stepSearchMatch(targetId, containerEl, delta) {
  const st = getSearchState(targetId);
  if (!st.query || st.matches.length === 0) {
    syncEditorSearchHighlights(targetId, containerEl, true);
    return;
  }
  const len = st.matches.length;
  st.activeIdx = ((st.activeIdx + delta) % len + len) % len;
  syncEditorSearchHighlights(targetId, containerEl, true);
}

export function handleEditorSearchClick(e, actionEl, action, containerEl) {
  const targetId = actionEl.getAttribute('data-target');
  if (!targetId) return false;
  if (action === 'es-prev') {
    stepSearchMatch(targetId, containerEl, -1);
    return true;
  }
  if (action === 'es-next') {
    stepSearchMatch(targetId, containerEl, 1);
    return true;
  }
  if (action === 'es-case') {
    const st = getSearchState(targetId);
    st.caseSensitive = !st.caseSensitive;
    st.activeIdx = 0;
    actionEl.classList.toggle('active', st.caseSensitive);
    syncEditorSearchHighlights(targetId, containerEl, true);
    return true;
  }
  if (action === 'es-clear') {
    const st = getSearchState(targetId);
    st.query = '';
    st.activeIdx = 0;
    st.matches = [];
    const inp = (containerEl || document).querySelector(`[data-role='editor-search-input'][data-target='${targetId}']`);
    if (inp) { inp.value = ''; inp.focus(); }
    syncEditorSearchHighlights(targetId, containerEl, false);
    return true;
  }
  return false;
}

export function handleEditorSearchInput(e, containerEl) {
  const target = e.target;
  if (!target) return false;
  if (target.getAttribute('data-role') === 'editor-search-input') {
    const targetId = target.getAttribute('data-target');
    if (!targetId) return false;
    const st = getSearchState(targetId);
    st.query = target.value || '';
    st.activeIdx = 0;
    syncEditorSearchHighlights(targetId, containerEl, true);
    return true;
  }
  if (target.id && (containerEl || document).querySelector(`[data-search-wrap='${target.id}']`)) {
    syncEditorSearchHighlights(target.id, containerEl, false);
  }
  return false;
}

export function handleEditorSearchKeydown(e, containerEl) {
  const target = e.target;
  if (!target || e.key !== 'Enter' || e.isComposing) return false;
  if (target.getAttribute('data-role') === 'editor-search-input') {
    e.preventDefault();
    const targetId = target.getAttribute('data-target');
    if (targetId) stepSearchMatch(targetId, containerEl, e.shiftKey ? -1 : 1);
    return true;
  }
  return false;
}
