import { escapeHtml, formatKeysInput, hasTH, callTH, logWarn } from './utils.js';
import { state } from './store.js';
import { getPresetRegexes } from './preset-manager.js';
import { ICONS, uiCtx } from './ui-common.js';

export function buildPresetRefItemsList(presetName, presetData, regexListOverride = null) {
  const out = [];
  const seen = new Set();
  const displayPreset = presetName === 'in_use'
    ? `当前实时预设 (${state.presetName || 'in_use'})`
    : presetName;
  ['prompts', 'prompts_unused'].forEach((listName) => {
    const list = Array.isArray(presetData?.[listName]) ? presetData[listName] : [];
    list.forEach((p, idx) => {
      if (!p) return;
      const base = p.id ? `preset::${presetName}::${listName}::id::${p.id}` : `preset::${presetName}::${listName}::idx::${idx}`;
      const refKey = seen.has(base) ? `${base}::${idx}` : base;
      seen.add(refKey);
      const badge = listName === 'prompts_unused' ? `[未添加 #${idx + 1}]` : `[主列表 #${idx + 1}]`;
      const name = p.name || p.id || `条目 #${idx + 1}`;
      out.push({
        refKey,
        kind: 'preset',
        sourceName: presetName,
        sourceLabel: `预设: ${displayPreset}`,
        listName,
        index: idx,
        badge,
        name,
        label: `${badge} ${name}`,
        enabled: !!p.enabled,
        prompt: p,
      });
    });
  });
  const regList = Array.isArray(regexListOverride)
    ? regexListOverride
    : getPresetRegexes(presetName, presetData);
  regList.forEach((r, idx) => {
    if (!r) return;
    const base = r.id ? `preset::${presetName}::regex::id::${r.id}` : `preset::${presetName}::regex::idx::${idx}`;
    const refKey = seen.has(base) ? `${base}::${idx}` : base;
    seen.add(refKey);
    const badge = `[正则 #${idx + 1}]`;
    const name = r.script_name || r.id || `正则 #${idx + 1}`;
    out.push({
      refKey,
      kind: 'regex',
      sourceName: presetName,
      sourceLabel: `预设: ${displayPreset}`,
      listName: 'regex',
      index: idx,
      badge,
      name,
      label: `${badge} ${name}`,
      enabled: !!r.enabled,
      regex: r,
    });
  });
  return out;
}

export function buildWorldbookRefItemsList(bookName, entries) {
  const out = [];
  const seen = new Set();
  (Array.isArray(entries) ? entries : []).forEach((e, idx) => {
    if (!e) return;
    const base = (e.uid !== undefined && e.uid !== null)
      ? `wb::${bookName}::uid::${e.uid}`
      : `wb::${bookName}::idx::${idx}`;
    const refKey = seen.has(base) ? `${base}::${idx}` : base;
    seen.add(refKey);
    const badge = `[#${idx + 1}]`;
    const name = e.name || `条目 #${e.uid}`;
    out.push({
      refKey,
      kind: 'worldbook',
      sourceName: bookName,
      sourceLabel: `世界书: ${bookName}`,
      index: idx,
      badge,
      name,
      label: `${badge} ${name}`,
      enabled: !!e.enabled,
      entry: e,
    });
  });
  return out;
}

export function getAllSavedPresetNames() {
  const list = hasTH('getPresetNames') ? (callTH('getPresetNames') || []).filter((n) => n && n !== 'in_use') : [];
  if (state.presetName && state.presetName !== 'in_use' && !list.includes(state.presetName)) {
    list.unshift(state.presetName);
  }
  return list;
}

export function getAllWorldbookNames() {
  return hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
}

export function getPresetRefItems(ai, presetName) {
  if (!presetName) return [];
  if (state.modal?.type === 'presetDetail' && state.modal.presetName === presetName) {
    return buildPresetRefItemsList(presetName, state.modal.data, state.modal.regexes || []);
  }
  ai.refCache = ai.refCache || { presets: {}, worldbooks: {} };
  if (Array.isArray(ai.refCache.presets[presetName])) return ai.refCache.presets[presetName];
  if (!hasTH('getPreset')) return [];
  try {
    const pData = callTH('getPreset', presetName);
    const list = buildPresetRefItemsList(presetName, pData || {});
    ai.refCache.presets[presetName] = list;
    return list;
  } catch (e) {
    logWarn(`读取参考预设「${presetName}」失败`, e);
    return [];
  }
}

export function getWorldbookRefItemsSync(ai, bookName) {
  if (!bookName) return { items: [], loading: false };
  if (state.modal?.type === 'worldbookDetail' && state.modal.bookName === bookName) {
    return { items: buildWorldbookRefItemsList(bookName, state.modal.entries), loading: false };
  }
  ai.refCache = ai.refCache || { presets: {}, worldbooks: {} };
  if (Array.isArray(ai.refCache.worldbooks[bookName])) {
    return { items: ai.refCache.worldbooks[bookName], loading: false };
  }
  ai.refLoadingBooks = ai.refLoadingBooks || {};
  if (!ai.refLoadingBooks[bookName] && hasTH('getWorldbook')) {
    ai.refLoadingBooks[bookName] = true;
    callTH('getWorldbook', bookName).then((entries) => {
      ai.refCache.worldbooks[bookName] = buildWorldbookRefItemsList(bookName, entries || []);
      delete ai.refLoadingBooks[bookName];
      hydrateSelectedRefData(ai);
      if (state.previewCtx === ai) uiCtx.renderPreviewModal();
    }).catch((err) => {
      delete ai.refLoadingBooks[bookName];
      logWarn(`加载参考世界书「${bookName}」失败`, err);
      if (state.previewCtx === ai) uiCtx.renderPreviewModal();
    });
  }
  return { items: [], loading: !!ai.refLoadingBooks[bookName] };
}

export function hydrateSelectedRefData(ai) {
  if (!ai) return;
  ai.refSelectedData = ai.refSelectedData instanceof Map ? ai.refSelectedData : new Map();
  ai.refSelectedKeys.forEach((rk) => {
    if (ai.refSelectedData.has(rk)) return;
    if (rk.startsWith('preset::')) {
      const sName = rk.slice(8).split('::')[0];
      const hit = getPresetRefItems(ai, sName).find((x) => x.refKey === rk);
      if (hit) ai.refSelectedData.set(rk, hit);
    } else if (rk.startsWith('wb::')) {
      const bName = rk.slice(4).split('::')[0];
      const { items } = getWorldbookRefItemsSync(ai, bName);
      const hit = items.find((x) => x.refKey === rk);
      if (hit) ai.refSelectedData.set(rk, hit);
    }
  });
}

export async function resolveAllSelectedReferenceItems(ai) {
  hydrateSelectedRefData(ai);
  const missingBooks = new Set();
  ai.refSelectedKeys.forEach((rk) => {
    if (!ai.refSelectedData.has(rk) && rk.startsWith('wb::')) {
      const bName = rk.slice(4).split('::')[0];
      if (bName) missingBooks.add(bName);
    }
  });
  if (missingBooks.size > 0 && hasTH('getWorldbook')) {
    ai.refCache = ai.refCache || { presets: {}, worldbooks: {} };
    await Promise.all(Array.from(missingBooks).map(async (bName) => {
      try {
        const entries = await callTH('getWorldbook', bName);
        ai.refCache.worldbooks[bName] = buildWorldbookRefItemsList(bName, entries || []);
      } catch (e) {
        logWarn(`加载参考世界书「${bName}」失败`, e);
      }
    }));
    hydrateSelectedRefData(ai);
  }
  const out = [];
  ai.refSelectedKeys.forEach((rk) => {
    const it = ai.refSelectedData.get(rk);
    if (it) out.push(it);
  });
  return out;
}

export function ensureAiRefDefaults(ai) {
  if (!(ai.refSelectedKeys instanceof Set)) ai.refSelectedKeys = new Set();
  if (!(ai.refSelectedData instanceof Map)) ai.refSelectedData = new Map();
  if (!ai.refCache) ai.refCache = { presets: {}, worldbooks: {} };
  if (!ai.refLoadingBooks) ai.refLoadingBooks = {};
  if (ai.refSourceType !== 'preset' && ai.refSourceType !== 'worldbook') {
    ai.refSourceType = ai.type === 'wbAiEdit' ? 'worldbook' : 'preset';
  }
  if (typeof ai.refOnlySelected !== 'boolean') ai.refOnlySelected = false;
  if (typeof ai.refExpanded !== 'boolean') ai.refExpanded = false;
  if (typeof ai.refSearch !== 'string') ai.refSearch = '';
}

export function renderReferencePickerHtml(ai) {
  const refOpen = !!ai.refExpanded;
  const rq = (ai.refSearch || '').trim().toLowerCase();
  const srcType = ai.refSourceType === 'worldbook' ? 'worldbook' : 'preset';
  const presetNames = getAllSavedPresetNames();
  const bookNames = getAllWorldbookNames();
  const editingPreset = state.modal?.type === 'presetDetail' ? state.modal.presetName : '';
  const editingBook = state.modal?.type === 'worldbookDetail' ? state.modal.bookName : '';

  let sourceOptionsHtml = '';
  let sourceItems = [];
  let isLoadingSource = false;

  if (srcType === 'preset') {
    const validPresetNames = editingPreset === 'in_use' ? ['in_use', ...presetNames] : presetNames;
    if (!ai.refSourceName || !validPresetNames.includes(ai.refSourceName)) {
      ai.refSourceName = editingPreset || (state.presetName && validPresetNames.includes(state.presetName) ? state.presetName : (validPresetNames[0] || 'in_use'));
    }
    ai.refLastPreset = ai.refSourceName;
    if (refOpen) sourceItems = getPresetRefItems(ai, ai.refSourceName);
    sourceOptionsHtml = validPresetNames.map((pn) => {
      const isEditing = editingPreset === pn;
      const baseLabel = pn === 'in_use' ? `当前实时预设 (${state.presetName || 'in_use'})` : pn;
      const label = isEditing ? `${baseLabel} [当前编辑]` : baseLabel;
      return `<option value='${escapeHtml(pn)}' ${pn === ai.refSourceName ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
  } else {
    if (!ai.refSourceName || !bookNames.includes(ai.refSourceName)) {
      ai.refSourceName = (editingBook && bookNames.includes(editingBook)) ? editingBook : (bookNames[0] || '');
    }
    ai.refLastWorldbook = ai.refSourceName;
    if (refOpen && ai.refSourceName) {
      const wbRes = getWorldbookRefItemsSync(ai, ai.refSourceName);
      sourceItems = wbRes.items;
      isLoadingSource = wbRes.loading;
    }
    sourceOptionsHtml = bookNames.length > 0
      ? bookNames.map((bn) => {
          const label = editingBook === bn ? `${bn} [当前编辑]` : bn;
          return `<option value='${escapeHtml(bn)}' ${bn === ai.refSourceName ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('')
      : "<option value=''>（暂无可用世界书）</option>";
  }

  let listContentHtml = '';
  if (refOpen) {
    let displayList = [];
    if (ai.refOnlySelected) {
      hydrateSelectedRefData(ai);
      ai.refSelectedKeys.forEach((rk) => {
        const it = ai.refSelectedData.get(rk);
        if (it) displayList.push(it);
      });
    } else {
      displayList = sourceItems;
    }
    const visible = displayList.filter((it) => {
      if (!rq) return true;
      return `${it.sourceLabel} ${it.label}`.toLowerCase().includes(rq);
    });

    if (!ai.refOnlySelected && isLoadingSource) {
      listContentHtml = "<div class='td-group-empty'>正在加载世界书条目...</div>";
    } else if (visible.length === 0) {
      listContentHtml = ai.refOnlySelected
        ? "<div class='td-group-empty'>暂无已选参考条目</div>"
        : "<div class='td-group-empty'>无匹配参考条目</div>";
    } else {
      listContentHtml = visible.map((it) => {
        const checked = ai.refSelectedKeys.has(it.refKey);
        const text = ai.refOnlySelected ? `[${it.sourceLabel}] ${it.label}` : it.label;
        return `
          <div class='td-picker-row ${checked ? 'checked' : ''}' style='min-height:34px;padding:5px 8px;'>
            <div class='td-picker-left'>
              <input type='checkbox' class='td-checkbox' data-action='ai-toggle-ref' data-key='${escapeHtml(it.refKey)}' ${checked ? 'checked' : ''} />
              <span class='td-item-name' style='font-size:12.5px;' title='${escapeHtml(text)}'>${escapeHtml(text)}</span>
            </div>
            <button type='button' class='td-icon-btn' data-action='ai-preview-ref-item' data-key='${escapeHtml(it.refKey)}' title='预览条目内容'>${ICONS.eye}</button>
          </div>`;
      }).join('');
    }
  }

  return `
    <div class='td-ai-ref-box'>
      <div class='td-ai-ref-head'>
        <span class='td-ai-compact-summary' data-role='ai-ref-summary'>参考条目（默认折叠 · 已选 ${ai.refSelectedKeys.size} 项）</span>
        <div style='display:flex;align-items:center;gap:5px;flex-shrink:0;'>
          <button type='button' class='td-chip sm' data-action='ai-ref-clear' ${ai.refSelectedKeys.size === 0 ? 'disabled' : ''} title='清除已选参考条目'>清除</button>
          <button type='button' class='td-chip sm ${refOpen ? 'active' : ''}' data-action='ai-toggle-ref-box'>${refOpen ? '收起参考' : '展开参考'}</button>
        </div>
      </div>
      ${refOpen ? `
        <div class='td-ai-ref-body'>
          <div class='td-ai-ref-source-row'>
            <div class='td-pv-seg'>
              <button type='button' class='td-pv-seg-btn ${srcType === 'preset' ? 'active' : ''}' data-action='ai-ref-set-type' data-type='preset'>预设</button>
              <button type='button' class='td-pv-seg-btn ${srcType === 'worldbook' ? 'active' : ''}' data-action='ai-ref-set-type' data-type='worldbook'>世界书</button>
            </div>
            <select class='td-select' id='td-ai-ref-source-name' style='height:28px;font-size:12px;'>${sourceOptionsHtml}</select>
          </div>
          <div style='display:flex;gap:5px;align-items:center;flex-wrap:wrap;'>
            <input class='td-input' id='td-ai-ref-search' type='text' placeholder='筛选参考条目...' value='${escapeHtml(ai.refSearch || '')}' style='flex:1;min-width:95px;height:28px;font-size:12px;' />
            <button type='button' class='td-chip sm ${ai.refOnlySelected ? 'active' : ''}' data-action='ai-ref-toggle-selected-view' data-role='ai-ref-selected-chip'>已选 (${ai.refSelectedKeys.size})</button>
            <button type='button' class='td-chip sm' data-action='ai-ref-select-enabled' ${ai.refOnlySelected ? 'disabled' : ''}>全选启用</button>
          </div>
          <div class='td-picker-list td-scroll' style='max-height:165px;min-height:80px;border:1px solid var(--td-border);border-radius:9px;padding:5px;'>
            ${listContentHtml}
          </div>
        </div>` : ''}
    </div>`;
}

export function handleAiRefClick(e, actionEl, action, { previewLayerEl, syncDraftInputs, persistDraft }) {
  const ai = state.previewCtx;
  if (!ai || (ai.type !== 'pmAiEdit' && ai.type !== 'wbAiEdit')) return false;

  if (action === 'ai-preview-ref-item') {
    e.stopPropagation();
    const rk = actionEl.getAttribute('data-key') || '';
    ensureAiRefDefaults(ai);
    hydrateSelectedRefData(ai);
    let it = ai.refSelectedData.get(rk);
    if (!it) {
      if (rk.startsWith('preset::')) {
        it = getPresetRefItems(ai, rk.slice(8).split('::')[0]).find((x) => x.refKey === rk);
      } else if (rk.startsWith('wb::')) {
        it = getWorldbookRefItemsSync(ai, rk.slice(4).split('::')[0]).items.find((x) => x.refKey === rk);
      }
    }
    if (!it) return true;
    if (it.kind === 'preset' && it.prompt) {
      const p = it.prompt;
      const posLabel = p.position?.type === 'in_chat' ? `@D${p.position.depth ?? 0}` : '相对位置';
      state.selectPopup = {
        type: 'aiItemPreview',
        title: p.name || p.id,
        metas: [it.sourceLabel, it.badge, `状态: ${p.enabled ? '开启' : '关闭'}`, `身份: ${p.role || 'system'}`, posLabel],
        content: typeof p.content === 'string' ? p.content : '（此条目为内置占位符，无正文内容）',
      };
      uiCtx.renderSelectPopup();
    } else if (it.kind === 'regex' && it.regex) {
      const r = it.regex;
      state.selectPopup = {
        type: 'aiItemPreview',
        title: r.script_name || r.id,
        metas: [it.sourceLabel, it.badge, `状态: ${r.enabled ? '开启' : '关闭'}`, r.run_on_edit ? '编辑时运行' : ''],
        content: `查找正则 (Find Regex):\n${r.find_regex || ''}\n\n替换为 (Replace String):\n${r.replace_string || ''}`,
      };
      uiCtx.renderSelectPopup();
    } else if (it.kind === 'worldbook' && it.entry) {
      const entry = it.entry;
      const keysStr = formatKeysInput(entry.strategy?.keys);
      state.selectPopup = {
        type: 'aiItemPreview',
        title: entry.name || `条目 #${entry.uid}`,
        metas: [it.sourceLabel, it.badge, `状态: ${entry.enabled ? '开启' : '关闭'}`, keysStr ? `关键词: ${keysStr}` : '无关键词'],
        content: entry.content || '',
      };
      uiCtx.renderSelectPopup();
    }
    return true;
  }

  if (action === 'ai-toggle-ref-box') {
    syncDraftInputs(previewLayerEl);
    ai.refExpanded = !ai.refExpanded;
    uiCtx.renderPreviewModal();
    return true;
  }
  if (action === 'ai-ref-set-type') {
    ensureAiRefDefaults(ai);
    syncDraftInputs(previewLayerEl);
    const nextType = actionEl.getAttribute('data-type') === 'worldbook' ? 'worldbook' : 'preset';
    if (ai.refSourceType !== nextType) {
      ai.refSourceType = nextType;
      ai.refOnlySelected = false;
      ai.refSourceName = nextType === 'worldbook' ? (ai.refLastWorldbook || '') : (ai.refLastPreset || '');
      uiCtx.renderPreviewModal();
    }
    return true;
  }
  if (action === 'ai-ref-toggle-selected-view') {
    ensureAiRefDefaults(ai);
    syncDraftInputs(previewLayerEl);
    ai.refOnlySelected = !ai.refOnlySelected;
    uiCtx.renderPreviewModal();
    return true;
  }
  if (action === 'ai-toggle-ref') {
    ensureAiRefDefaults(ai);
    const k = actionEl.getAttribute('data-key');
    if (ai.refSelectedKeys.has(k)) {
      ai.refSelectedKeys.delete(k);
      ai.refSelectedData.delete(k);
    } else {
      ai.refSelectedKeys.add(k);
      if (k.startsWith('preset::')) {
        const hit = getPresetRefItems(ai, k.slice(8).split('::')[0]).find((x) => x.refKey === k);
        if (hit) ai.refSelectedData.set(k, hit);
      } else if (k.startsWith('wb::')) {
        const hit = getWorldbookRefItemsSync(ai, k.slice(4).split('::')[0]).items.find((x) => x.refKey === k);
        if (hit) ai.refSelectedData.set(k, hit);
      }
    }
    persistDraft(ai);
    if (ai.refOnlySelected) {
      uiCtx.renderPreviewModal();
      return true;
    }
    const sumEl = previewLayerEl?.querySelector("[data-role='ai-ref-summary']");
    if (sumEl) sumEl.textContent = `参考条目（默认折叠 · 已选 ${ai.refSelectedKeys.size} 项）`;
    const selChip = previewLayerEl?.querySelector("[data-role='ai-ref-selected-chip']");
    if (selChip) selChip.textContent = `已选 (${ai.refSelectedKeys.size})`;
    const clrBtn = previewLayerEl?.querySelector("[data-action='ai-ref-clear']");
    if (clrBtn) clrBtn.disabled = ai.refSelectedKeys.size === 0;
    actionEl.closest('.td-picker-row')?.classList.toggle('checked', ai.refSelectedKeys.has(k));
    return true;
  }
  if (action === 'ai-ref-select-enabled') {
    ensureAiRefDefaults(ai);
    const items = ai.refSourceType === 'worldbook'
      ? getWorldbookRefItemsSync(ai, ai.refSourceName).items
      : getPresetRefItems(ai, ai.refSourceName);
    items.forEach((it) => {
      if (it.enabled) {
        ai.refSelectedKeys.add(it.refKey);
        ai.refSelectedData.set(it.refKey, it);
      }
    });
    persistDraft(ai);
    uiCtx.renderPreviewModal();
    return true;
  }
  if (action === 'ai-ref-clear') {
    ensureAiRefDefaults(ai);
    ai.refSelectedKeys.clear();
    ai.refSelectedData.clear();
    persistDraft(ai);
    uiCtx.renderPreviewModal();
    return true;
  }
  return false;
}

export function handleAiRefChange(target, { syncDraftInputs }) {
  if (target?.id !== 'td-ai-ref-source-name') return false;
  const ai = state.previewCtx;
  if (!ai || (ai.type !== 'pmAiEdit' && ai.type !== 'wbAiEdit')) return false;
  ensureAiRefDefaults(ai);
  syncDraftInputs(uiCtx.getPreviewLayer());
  ai.refSourceName = target.value;
  ai.refOnlySelected = false;
  if (ai.refSourceType === 'worldbook') ai.refLastWorldbook = target.value;
  else ai.refLastPreset = target.value;
  uiCtx.renderPreviewModal();
  return true;
}
