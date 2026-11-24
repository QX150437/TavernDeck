import {
  escapeHtml, notify, computeLineDiff, formatKeysInput, parseKeysInput,
  hasTH, callTH, getST, genId, copyToClipboard, logWarn, logError,
} from './utils.js';
import { state, saveStore } from './store.js';
import { PRESET_SYSTEM_IDS, buildNewPromptEntry } from './preset-manager.js';
import { buildDefaultWorldbookEntry } from './worldbook-manager.js';
import {
  runAiPresetEdit, runAiWorldbookEdit,
  getAvailableApiTargets, fetchModelsForApiTarget, normalizeApiTargetValue,
} from './ai-preset-edit.js';
import { ICONS, uiCtx, openConfirm } from './ui-common.js';

let aiDraftSaveTimer = null;

function getAiDraftKey(type) {
  if (type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
    const pName = state.modal.presetName === 'in_use'
      ? (state.presetName || 'in_use')
      : (state.modal.presetName || 'in_use');
    return `preset::${pName}`;
  }
  if (type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
    return `worldbook::${state.modal.bookName || ''}`;
  }
  return '';
}

function buildPresetRefItemsList(presetName, presetData) {
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
  return out;
}

function buildWorldbookRefItemsList(bookName, entries) {
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

function getAllSavedPresetNames() {
  const list = hasTH('getPresetNames') ? (callTH('getPresetNames') || []).filter((n) => n && n !== 'in_use') : [];
  if (state.presetName && state.presetName !== 'in_use' && !list.includes(state.presetName)) {
    list.unshift(state.presetName);
  }
  return list;
}

function getAllWorldbookNames() {
  return hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
}

function getPresetRefItems(ai, presetName) {
  if (!presetName) return [];
  if (state.modal?.type === 'presetDetail' && state.modal.presetName === presetName) {
    return buildPresetRefItemsList(presetName, state.modal.data);
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

function getWorldbookRefItemsSync(ai, bookName) {
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

function hydrateSelectedRefData(ai) {
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

async function resolveAllSelectedReferenceItems(ai) {
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

function encodeAiKeySet(type, keySet) {
  const out = [];
  if (!(keySet instanceof Set)) return out;
  if (type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
    keySet.forEach((k) => {
      const [listName, idxStr] = String(k).split('::');
      const p = state.modal.data?.[listName]?.[Number(idxStr)];
      if (!p) return;
      out.push(p.id ? `${listName}::id::${p.id}` : `${listName}::idx::${idxStr}`);
    });
  } else if (type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
    keySet.forEach((k) => {
      const idx = Number(k);
      const e = state.modal.entries?.[idx];
      if (!e) return;
      out.push((e.uid !== undefined && e.uid !== null) ? `uid::${e.uid}` : `idx::${idx}`);
    });
  }
  return out;
}

function buildAiTokenMap(type) {
  const map = new Map();
  if (type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
    ['prompts', 'prompts_unused'].forEach((listName) => {
      (state.modal.data?.[listName] || []).forEach((p, idx) => {
        const k = `${listName}::${idx}`;
        if (p?.id) map.set(`${listName}::id::${p.id}`, k);
        map.set(`${listName}::idx::${idx}`, k);
        map.set(k, k);
      });
    });
  } else if (type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
    (state.modal.entries || []).forEach((e, idx) => {
      const k = String(idx);
      if (e?.uid !== undefined && e?.uid !== null) map.set(`uid::${e.uid}`, k);
      map.set(`idx::${idx}`, k);
      map.set(k, k);
    });
  }
  return map;
}

export function createAiEditPreviewCtx(type) {
  const draftKey = getAiDraftKey(type);
  const rawDraft = draftKey ? state.store?.extensions?.aiEditDrafts?.[draftKey] : null;
  const tokenMap = buildAiTokenMap(type);
  const selectedKeys = new Set();
  const refSelectedKeys = new Set();

  const isPresetCtx = type === 'pmAiEdit' && state.modal?.type === 'presetDetail';
  const curPresetName = isPresetCtx ? (state.modal.presetName || 'in_use') : (state.presetName || getAllSavedPresetNames()[0] || 'in_use');
  const curBookName = (type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail')
    ? (state.modal.bookName || '')
    : (getAllWorldbookNames()[0] || '');

  if (rawDraft && typeof rawDraft === 'object') {
    (Array.isArray(rawDraft.selected) ? rawDraft.selected : []).forEach((t) => {
      const resolved = tokenMap.get(t);
      if (resolved) selectedKeys.add(resolved);
    });
    (Array.isArray(rawDraft.refSelected) ? rawDraft.refSelected : []).forEach((t) => {
      if (typeof t === 'string' && (t.startsWith('preset::') || t.startsWith('wb::'))) {
        refSelectedKeys.add(t);
        return;
      }
      const resolved = tokenMap.get(t);
      if (resolved) {
        if (isPresetCtx) {
          const [ln, idxStr] = resolved.split('::');
          const p = state.modal.data?.[ln]?.[Number(idxStr)];
          if (p) refSelectedKeys.add(p.id ? `preset::${curPresetName}::${ln}::id::${p.id}` : `preset::${curPresetName}::${ln}::idx::${idxStr}`);
        } else if (type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
          const idx = Number(resolved);
          const e = state.modal.entries?.[idx];
          if (e) refSelectedKeys.add((e.uid !== undefined && e.uid !== null) ? `wb::${curBookName}::uid::${e.uid}` : `wb::${curBookName}::idx::${idx}`);
        }
      }
    });
  }

  const ctx = {
    type,
    draftKey,
    step: 'setup',
    selectedKeys,
    refSelectedKeys,
    refSelectedData: new Map(),
    refCache: { presets: {}, worldbooks: {} },
    refLoadingBooks: {},
    refSourceType: type === 'wbAiEdit' ? 'worldbook' : 'preset',
    refSourceName: type === 'wbAiEdit' ? curBookName : curPresetName,
    refLastPreset: curPresetName,
    refLastWorldbook: curBookName,
    refOnlySelected: false,
    refExpanded: false,
    refSearch: '',
    instruction: typeof rawDraft?.instruction === 'string' ? rawDraft.instruction : '',
    search: '',
    loading: false,
    results: [],
  };
  hydrateSelectedRefData(ctx);
  return ctx;
}

export function persistAiEditDraft(ai) {
  if (aiDraftSaveTimer) {
    clearTimeout(aiDraftSaveTimer);
    aiDraftSaveTimer = null;
  }
  if (!ai || (ai.type !== 'pmAiEdit' && ai.type !== 'wbAiEdit')) return;
  const draftKey = ai.draftKey || getAiDraftKey(ai.type);
  if (!draftKey) return;

  const instruction = typeof ai.instruction === 'string' ? ai.instruction : '';
  const selected = encodeAiKeySet(ai.type, ai.selectedKeys);
  const refSelected = Array.from(ai.refSelectedKeys instanceof Set ? ai.refSelectedKeys : []);

  state.store.extensions = state.store.extensions || {};
  const drafts = (state.store.extensions.aiEditDrafts = state.store.extensions.aiEditDrafts || {});
  if (!instruction && selected.length === 0 && refSelected.length === 0) {
    delete drafts[draftKey];
    if (Object.keys(drafts).length === 0) delete state.store.extensions.aiEditDrafts;
  } else {
    drafts[draftKey] = {
      instruction,
      selected,
      refSelected,
      updatedAt: Date.now(),
    };
  }
  saveStore(state.store);
}

function scheduleSaveAiEditDraft(ai) {
  if (aiDraftSaveTimer) clearTimeout(aiDraftSaveTimer);
  aiDraftSaveTimer = setTimeout(() => {
    aiDraftSaveTimer = null;
    persistAiEditDraft(ai);
  }, 260);
}

export function flushAiEditDraft(previewLayerEl) {
  const pc = state.previewCtx;
  if (!pc || (pc.type !== 'pmAiEdit' && pc.type !== 'wbAiEdit')) return;
  syncAiPreviewDraftInputs(previewLayerEl);
  persistAiEditDraft(pc);
}
import { renderQuickInsertHtml } from './ui-snippets.js';
import { renderSearchableTextareaHtml, bindEditorSearchEvents, syncEditorSearchHighlights } from './ui-editor-search.js';

function readAiResultEditSnapshot(selectLayerEl, aiType) {
  const q = (sel) => selectLayerEl?.querySelector(sel);
  return {
    name: q('#td-aire-name')?.value ?? '',
    enabled: !!q('#td-aire-enabled')?.checked,
    role: aiType === 'pmAiEdit' ? (q('#td-aire-role')?.value || 'system') : '',
    keys: aiType === 'wbAiEdit' ? (q('#td-aire-keys')?.value ?? '') : '',
    content: q('#td-aire-content')?.value ?? '',
  };
}

function aiEditSnapshotsEqual(a, b) {
  return !!a && !!b
    && a.name === b.name
    && a.enabled === b.enabled
    && a.role === b.role
    && a.keys === b.keys
    && a.content === b.content;
}

function updateAiEditHistoryButtons(selectLayerEl, sp) {
  if (!selectLayerEl || !sp) return;
  const undoBtn = selectLayerEl.querySelector("[data-action='ai-edit-undo']");
  const redoBtn = selectLayerEl.querySelector("[data-action='ai-edit-redo']");
  if (undoBtn) undoBtn.disabled = !sp.history || sp.historyIdx <= 0;
  if (redoBtn) redoBtn.disabled = !sp.history || sp.historyIdx >= sp.history.length - 1;
}

function applyAiResultEditSnapshot(selectLayerEl, sp, snap) {
  if (!selectLayerEl || !snap) return;
  const q = (sel) => selectLayerEl.querySelector(sel);
  const nameEl = q('#td-aire-name');
  const enEl = q('#td-aire-enabled');
  const roleEl = q('#td-aire-role');
  const keysEl = q('#td-aire-keys');
  const contentEl = q('#td-aire-content');
  if (nameEl) nameEl.value = snap.name;
  if (enEl) enEl.checked = !!snap.enabled;
  if (roleEl && sp.aiType === 'pmAiEdit') roleEl.value = snap.role || 'system';
  if (keysEl && sp.aiType === 'wbAiEdit') keysEl.value = snap.keys || '';
  if (contentEl) contentEl.value = snap.content;
  syncEditorSearchHighlights('td-aire-content', selectLayerEl, false);
}

function pushAiEditSnapshot(selectLayerEl, sp, force = false) {
  if (!sp || sp.type !== 'aiResultEdit') return;
  if (sp.timer) { clearTimeout(sp.timer); sp.timer = null; }
  const snap = readAiResultEditSnapshot(selectLayerEl, sp.aiType);
  if (!Array.isArray(sp.history)) {
    sp.history = [snap];
    sp.historyIdx = 0;
    updateAiEditHistoryButtons(selectLayerEl, sp);
    return;
  }
  if (aiEditSnapshotsEqual(sp.history[sp.historyIdx], snap)) {
    updateAiEditHistoryButtons(selectLayerEl, sp);
    return;
  }
  if (!force || sp.historyIdx < sp.history.length - 1) {
    sp.history = sp.history.slice(0, sp.historyIdx + 1);
  }
  sp.history.push(snap);
  if (sp.history.length > 80) sp.history.shift();
  sp.historyIdx = sp.history.length - 1;
  updateAiEditHistoryButtons(selectLayerEl, sp);
}

function scheduleAiEditSnapshot(selectLayerEl, sp) {
  if (!sp || sp.type !== 'aiResultEdit') return;
  if (sp.timer) clearTimeout(sp.timer);
  sp.timer = setTimeout(() => {
    sp.timer = null;
    pushAiEditSnapshot(selectLayerEl, sp, false);
  }, 300);
}

const DEFAULT_AI_TEMPLATES = [
  { id: 'tpl_polish', name: '润色精简', content: '在不改变原有核心规则与约束的前提下，精简冗余表述，使指令更清晰、紧凑。' },
  { id: 'tpl_zh', name: '中文化重写', content: '将条目正文翻译并本地化为自然流畅的简体中文，完整保留所有 XML 标签、{{宏}} 与变量语法不变。' },
  { id: 'tpl_xml', name: 'XML 结构化', content: '将条目内容整理为清晰的 XML 标签分块结构，提升模型指令遵循度。' },
  { id: 'tpl_new_ref', name: '参考扩展新条目', content: '参考所选参考条目的文风、结构与设定规范，新增一条互补条目（action 设为 "add"），不要修改原条目。' },
];

function getAiInstructionTemplates() {
  state.store.extensions = state.store.extensions || {};
  if (!Array.isArray(state.store.extensions.aiInstructionTemplates)) {
    state.store.extensions.aiInstructionTemplates = DEFAULT_AI_TEMPLATES.map((t) => Object.assign({}, t));
    saveStore(state.store);
  }
  return state.store.extensions.aiInstructionTemplates;
}

function saveAiInstructionTemplates(list) {
  state.store.extensions = state.store.extensions || {};
  state.store.extensions.aiInstructionTemplates = list;
  saveStore(state.store);
}

function ensureAiSetupDefaults(ai) {
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
  if (typeof ai.tplExpanded !== 'boolean') ai.tplExpanded = false;
  if (typeof ai.tplAddOpen !== 'boolean') ai.tplAddOpen = false;
}

function renderSharedAiApiFieldsHtml() {
  const cfg = state.store.settings.aiEditConfig || { proxyPreset: '', jailbreakPreset: '', model: '' };
  const curApi = normalizeApiTargetValue(cfg.proxyPreset);
  if (curApi !== String(cfg.proxyPreset || '')) cfg.proxyPreset = curApi;

  const { profiles, proxies } = getAvailableApiTargets();
  const presetList = hasTH('getPresetNames') ? (callTH('getPresetNames') || []).filter((n) => n && n !== 'in_use') : [];
  const allApiValues = new Set([...profiles.map((p) => p.value), ...proxies.map((p) => p.value)]);
  const hasMissingApi = !!curApi && !allApiValues.has(curApi);

  const profileOpts = profiles.map((p) => (
    `<option value='${escapeHtml(p.value)}' ${p.value === curApi ? 'selected' : ''}>${escapeHtml(p.name)}${p.model ? ` (${escapeHtml(p.model)})` : ''}</option>`
  )).join('');
  const proxyOpts = proxies.map((p) => (
    `<option value='${escapeHtml(p.value)}' ${p.value === curApi ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  )).join('');

  const apiSelectHtml = [
    `<option value='' ${!curApi ? 'selected' : ''}>（跟随酒馆当前连接）</option>`,
    hasMissingApi ? `<option value='${escapeHtml(curApi)}' selected>${escapeHtml(curApi.replace(/^(profile|proxy):/, ''))} (未找到)</option>` : '',
    profileOpts ? `<optgroup label='连接配置 (Connection Profiles · ${profiles.length})'>${profileOpts}</optgroup>` : '',
    proxyOpts ? `<optgroup label='代理预设 (Proxy Presets · ${proxies.length})'>${proxyOpts}</optgroup>` : '',
  ].join('');

  const cache = (state._aiModelsCache = state._aiModelsCache || {});
  const cachedModels = Array.isArray(cache[curApi]) ? cache[curApi] : [];
  const curProfile = curApi.startsWith('profile:') ? profiles.find((p) => p.value === curApi) : null;
  const curModel = String(cfg.model || '');
  const modelList = [];
  const pushM = (m) => { const s = String(m || '').trim(); if (s && !modelList.includes(s)) modelList.push(s); };
  if (curProfile?.model) pushM(curProfile.model);
  cachedModels.forEach(pushM);
  if (curModel) pushM(curModel);

  const manualMode = !!state.previewCtx?.manualModelInput;
  const modelControlHtml = manualMode
    ? `<div style='display:flex;gap:5px;align-items:center;min-width:0;width:100%;'>
         <input class='td-input' id='td-ai-model' type='text' placeholder='输入模型名，留空用默认' value='${escapeHtml(curModel)}' style='flex:1;min-width:0;width:0;height:34px;' />
         <button type='button' class='td-btn sm' style='flex-shrink:0;' data-action='ai-toggle-model-manual' title='切换回下拉列表'>列表</button>
       </div>`
    : `<div style='display:flex;gap:5px;align-items:center;min-width:0;width:100%;'>
         <select class='td-select' id='td-ai-model-select' style='flex:1;min-width:0;width:0;'>
           <option value='' ${!curModel ? 'selected' : ''}>（默认${curProfile?.model ? `: ${escapeHtml(curProfile.model)}` : ''}）</option>
           ${modelList.map((m) => `<option value='${escapeHtml(m)}' ${m === curModel ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
           <option value='__manual__'>✎ 手动输入模型名...</option>
         </select>
         <button type='button' class='td-btn sm' style='flex-shrink:0;' data-action='ai-fetch-models' title='从当前 API 拉取可用模型列表'>${state.previewCtx?.fetchingModels ? '拉取中...' : '拉取'}</button>
       </div>`;

  const jbOpts = [
    `<option value=''>（不使用破甲预设）</option>`,
    ...presetList.map((pn) => `<option value='${escapeHtml(pn)}' ${pn === cfg.jailbreakPreset ? 'selected' : ''}>${escapeHtml(pn)}</option>`),
  ].join('');

  return `
    <div class='td-form-grid'>
      <div class='td-field'>
        <span class='td-label' style='font-size:11.5px;'>API 连接 / 代理预设（免存 Key）</span>
        <select class='td-select' id='td-ai-proxy-preset' style='width:100%;min-width:0;'>${apiSelectHtml}</select>
      </div>
      <div class='td-field'>
        <span class='td-label' style='font-size:11.5px;'>覆盖模型名（可拉取或留空默认）</span>
        ${modelControlHtml}
      </div>
    </div>
    <div class='td-field'>
      <span class='td-label' style='font-size:11.5px;'>破甲预设（NSFW 场景可选）</span>
      <select class='td-select' id='td-ai-jailbreak-preset' style='width:100%;min-width:0;'>${jbOpts}</select>
    </div>`;
}

export function saveSharedAiApiFieldsFromPreview(previewLayerEl) {
  const cfg = state.store.settings.aiEditConfig || (state.store.settings.aiEditConfig = { proxyPreset: '', jailbreakPreset: '', model: '' });
  const proxyEl = previewLayerEl?.querySelector('#td-ai-proxy-preset');
  const jbEl = previewLayerEl?.querySelector('#td-ai-jailbreak-preset');
  const modelInputEl = previewLayerEl?.querySelector('#td-ai-model');
  const modelSelEl = previewLayerEl?.querySelector('#td-ai-model-select');
  if (proxyEl) cfg.proxyPreset = normalizeApiTargetValue(proxyEl.value);
  if (jbEl) cfg.jailbreakPreset = jbEl.value;
  if (modelInputEl) cfg.model = modelInputEl.value;
  else if (modelSelEl && modelSelEl.value !== '__manual__') cfg.model = modelSelEl.value;
  saveStore(state.store);
  return cfg;
}

export function syncAiPreviewDraftInputs(previewLayerEl) {
  const pc = state.previewCtx;
  if (!pc || !previewLayerEl) return;
  if (pc.type === 'pmAiEdit' || pc.type === 'wbAiEdit') {
    const instrEl = previewLayerEl.querySelector('#td-ai-instruction');
    const tplNameEl = previewLayerEl.querySelector('#td-ai-tpl-name');
    const tplContEl = previewLayerEl.querySelector('#td-ai-tpl-content');
    if (instrEl) pc.instruction = instrEl.value;
    if (tplNameEl) pc.tplDraftName = tplNameEl.value;
    if (tplContEl) pc.tplDraftContent = tplContEl.value;
  } else if (pc.type === 'mvuAiUpdate') {
    const mc = previewLayerEl.querySelector('#td-mvu-ai-msgcount');
    const fl = previewLayerEl.querySelector('#td-mvu-ai-floor');
    const ir = previewLayerEl.querySelector('#td-mvu-ai-include-rules');
    const it = previewLayerEl.querySelector('#td-mvu-ai-include-trunc');
    const ins = previewLayerEl.querySelector('#td-mvu-ai-instruction');
    if (mc) pc.msgCount = Number(mc.value) || 2;
    if (fl && !Number.isNaN(Number(fl.value))) pc.targetFloor = Math.max(0, Math.min(pc.lastMsgId, Math.floor(Number(fl.value))));
    if (ir) pc.includeRules = !!ir.checked;
    if (it) pc.includeTruncated = !!it.checked;
    if (ins) pc.instruction = ins.value;
  }
}

function getSharedAiSummaryText() {
  const cfg = state.store.settings.aiEditConfig || { proxyPreset: '', jailbreakPreset: '', model: '' };
  const curApi = normalizeApiTargetValue(cfg.proxyPreset);
  const { profiles } = getAvailableApiTargets();
  let apiLabel = '当前连接';
  let curProfile = null;
  if (curApi.startsWith('profile:')) {
    const pid = curApi.slice(8);
    curProfile = profiles.find((p) => p.value === curApi);
    apiLabel = curProfile ? curProfile.name : pid;
  } else if (curApi.startsWith('proxy:')) {
    apiLabel = curApi.slice(6);
  }
  let modelLabel = String(cfg.model || '').trim();
  if (!modelLabel) {
    if (curProfile?.model) modelLabel = curProfile.model;
    else if (!curApi) {
      try { modelLabel = String(getST()?.getChatCompletionModel?.() || '').trim(); } catch (e) {}
    }
  }
  if (!modelLabel) modelLabel = '默认模型';
  const jbName = String(cfg.jailbreakPreset || '').trim();
  return jbName ? `${apiLabel} · ${modelLabel} · ${jbName}` : `${apiLabel} · ${modelLabel}`;
}

export function renderCollapsibleAiApiBoxHtml(ai) {
  const expanded = !!ai?.apiExpanded;
  const summary = getSharedAiSummaryText();
  return `
    <div class='td-ai-compact-box'>
      <div class='td-ai-compact-head'>
        <span class='td-ai-compact-summary' title='${escapeHtml(summary)}'>API：${escapeHtml(summary)}</span>
        <button type='button' class='td-chip sm ${expanded ? 'active' : ''}' data-action='ai-toggle-api-box'>${expanded ? '收起' : '配置 API'}</button>
      </div>
      ${expanded ? renderSharedAiApiFieldsHtml() : ''}
    </div>`;
}

function renderInstructionTemplatesHtml(ai, templates) {
  const chipsHtml = templates.length > 0
    ? templates.map((t) => `
        <span class='td-qi-tpl-chip'>
          <button type='button' class='td-qi-tpl-btn' data-action='ai-use-tpl' data-tpl-id='${escapeHtml(t.id)}' title='${escapeHtml(t.content)}'>${escapeHtml(t.name)}</button>
          <button type='button' class='td-qi-tpl-del' data-action='ai-del-tpl' data-tpl-id='${escapeHtml(t.id)}' title='删除模板'>×</button>
        </span>`).join('')
    : "<span style='font-size:11.5px;color:var(--td-text-dim);'>暂无指令模板，可点击右侧新增</span>";

  const addFormHtml = ai.tplAddOpen ? `
    <div class='td-qi-add-form'>
      <div style='display:flex;gap:5px;align-items:center;'>
        <input class='td-input' id='td-ai-tpl-name' type='text' placeholder='指令模板名称' value='${escapeHtml(ai.tplDraftName || '')}' style='flex:1;height:28px;font-size:12px;' />
        <button type='button' class='td-btn sm' data-action='ai-fill-tpl-from-instr'>取当前指令</button>
      </div>
      <textarea class='td-textarea td-scroll' id='td-ai-tpl-content' placeholder='输入常用修改指令模板内容...' style='min-height:54px;height:60px;font-size:12px;padding:6px 8px;font-family:inherit;'>${escapeHtml(ai.tplDraftContent || '')}</textarea>
      <div style='display:flex;gap:5px;justify-content:flex-end;'>
        <button type='button' class='td-btn sm' data-action='ai-toggle-tpl-add'>取消</button>
        <button type='button' class='td-btn sm primary' data-action='ai-save-tpl'>保存模板</button>
      </div>
    </div>` : '';

  return `
    <div class='td-ai-tpl-panel'>
      <div style='display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;'>
        <div class='td-qi-chips' style='flex:1;max-height:76px;'>${chipsHtml}</div>
        <button type='button' class='td-btn sm ${ai.tplAddOpen ? 'warn' : ''}' data-action='ai-toggle-tpl-add'>${ai.tplAddOpen ? '取消新增' : '+ 新增模板'}</button>
      </div>
      ${addFormHtml}
    </div>`;
}

function renderReferencePickerHtml(ai) {
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
        <button type='button' class='td-chip sm ${refOpen ? 'active' : ''}' data-action='ai-toggle-ref-box'>${refOpen ? '收起参考' : '展开参考'}</button>
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
            <button type='button' class='td-chip sm' data-action='ai-ref-clear' ${ai.refSelectedKeys.size === 0 ? 'disabled' : ''}>清空</button>
          </div>
          <div class='td-picker-list td-scroll' style='max-height:165px;min-height:80px;border:1px solid var(--td-border);border-radius:9px;padding:5px;'>
            ${listContentHtml}
          </div>
        </div>` : ''}
    </div>`;
}

function renderAiEditSetupHtml({ title, ai, items, itemLabelFn }) {
  ensureAiSetupDefaults(ai);
  const templates = getAiInstructionTemplates();
  const q = (ai.search || '').trim().toLowerCase();
  const visible = items.filter((it) => !q || itemLabelFn(it).toLowerCase().includes(q));
  const anySubExpanded = !!ai.apiExpanded || !!ai.refExpanded || !!ai.tplExpanded;

  return `
    <div class='td-modal td-modal-tall'>
      <div class='td-modal-head'><div class='td-modal-title'>${escapeHtml(title)}</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='aiEdit' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div></div>
      <div class='td-modal-body ${anySubExpanded ? '' : 'td-picker-body'}' style='gap:7px;'>
        ${renderCollapsibleAiApiBoxHtml(ai)}
        ${renderReferencePickerHtml(ai)}
        <div class='td-field' style='flex-shrink:0;gap:5px;'>
          <div class='td-ai-sec-row'>
            <label class='td-label' style='margin:0;'>修改 / 生成指令</label>
            <div style='display:flex;align-items:center;gap:5px;'>
              <button type='button' class='td-chip sm' data-action='ai-clear-instruction' ${ai.instruction ? '' : 'disabled'} title='清除指令文本'>清除</button>
              <button type='button' class='td-chip sm ${ai.tplExpanded ? 'active' : ''}' data-action='ai-toggle-tpl-box'>指令模板 (${templates.length}) ${ai.tplExpanded ? '▴' : '▾'}</button>
            </div>
          </div>
          ${ai.tplExpanded ? renderInstructionTemplatesHtml(ai, templates) : ''}
          <textarea class='td-textarea' id='td-ai-instruction' style='min-height:115px;height:130px;padding:8px 10px;font-size:13px;font-family:inherit;' placeholder='输入修改指令，或展开右上角指令模板；若仅选参考条目，可要求 AI 新增条目...'>${escapeHtml(ai.instruction || '')}</textarea>
        </div>
        <div class='td-field' style='flex:1;min-height:${anySubExpanded ? '200px' : '0'};display:flex;flex-direction:column;gap:5px;'>
          <div class='td-ai-sec-row'>
            <div style='display:flex;align-items:center;gap:5px;min-width:0;'>
              <label class='td-label' data-role='ai-selected-label' style='margin:0;white-space:nowrap;'>待编辑条目 (已选 ${ai.selectedKeys.size})</label>
              <button type='button' class='td-chip sm' data-action='ai-clear-selected' ${ai.selectedKeys.size > 0 ? '' : 'disabled'} title='清除已勾选条目'>清除</button>
            </div>
            <div class='td-search-input-wrap' style='flex:1;max-width:170px;'>
              <input class='td-input' id='td-ai-search' type='text' placeholder='筛选条目...' value='${escapeHtml(ai.search || '')}' style='height:28px;font-size:12px;padding:0 ${ai.search ? '24px' : '8px'} 0 8px;border-radius:8px;' />
              ${ai.search ? `<button type='button' class='td-search-clear' data-action='ai-clear-search' title='清空筛选' style='width:22px;height:22px;right:3px;'>${ICONS.close}</button>` : ''}
            </div>
          </div>
          <div class='td-picker-list td-scroll' style='border:1px solid var(--td-border);border-radius:10px;padding:5px;min-height:140px;'>
            ${visible.map((it) => {
              const checked = ai.selectedKeys.has(it.key);
              return `
                <div class='td-picker-row ${checked ? 'checked' : ''}' style='min-height:36px;padding:5px 9px;'>
                  <div class='td-picker-left'>
                    <input type='checkbox' class='td-checkbox' data-action='ai-toggle-item' data-key='${escapeHtml(it.key)}' ${checked ? 'checked' : ''} />
                    <span class='td-item-name' style='font-size:13px;' title='${escapeHtml(itemLabelFn(it))}'>${escapeHtml(itemLabelFn(it))}</span>
                  </div>
                  <button type='button' class='td-icon-btn' data-action='ai-preview-item' data-key='${escapeHtml(it.key)}' title='预览条目内容'>${ICONS.eye}</button>
                </div>`;
            }).join('') || "<div class='td-group-empty'>无匹配条目</div>"}
          </div>
        </div>
      </div>
      <div class='td-modal-foot'>
        <button class='td-btn' data-action='close-preview'>取消</button>
        ${Array.isArray(ai.results) && ai.results.length > 0 ? `<button type='button' class='td-btn warn' data-action='ai-goto-review' ${ai.loading ? 'disabled' : ''}>返回检视 (${ai.results.length})</button>` : ''}
        <button class='td-btn primary' data-action='ai-run' ${ai.loading ? 'disabled' : ''}>${ai.loading ? 'AI 处理中，请稍候...' : '发送给 AI 编辑'}</button>
      </div>
    </div>`;
}

export function setAiRunBtnLoading(previewLayerEl, loading, selector = "[data-action='ai-run']", idleText = '发送给 AI 编辑') {
  const btn = previewLayerEl?.querySelector(selector);
  if (!btn) return;
  btn.disabled = !!loading;
  btn.textContent = loading ? 'AI 处理中，请稍候...' : idleText;
}

function formatAiNotesText(pc) {
  if (!pc) return '';
  const blocks = [];
  if (pc.summary && pc.summary.trim()) {
    blocks.push(`【整体说明与指导信息】\n${pc.summary.trim()}`);
  }
  const noted = (pc.results || []).filter((r) => r && typeof r.note === 'string' && r.note.trim());
  if (noted.length > 0) {
    blocks.push(`【逐条说明 (${noted.length} 项)】\n${noted.map((r, i) => `${i + 1}. ${r.newName || '未命名条目'}\n   ${r.note.trim()}`).join('\n')}`);
  }
  if (blocks.length === 0 && pc.rawReply && pc.rawReply.trim()) {
    blocks.push(`【AI 原始返回】\n${pc.rawReply.trim()}`);
  }
  return blocks.join('\n\n');
}

export const aiAssistantUiModule = {
  renderSelectPopup(sp, selectLayerEl) {
    if (sp.type === 'aiNotes') {
      const pc = state.previewCtx;
      if (!pc || (pc.type !== 'pmAiEdit' && pc.type !== 'wbAiEdit')) return false;
      const summary = String(pc.summary || '').trim();
      const notedItems = (pc.results || []).filter((r) => r && typeof r.note === 'string' && r.note.trim());
      const rawReply = String(pc.rawReply || '').trim();

      const summaryHtml = summary
        ? `<div class='td-field'>
             <label class='td-label'>整体说明与指导信息</label>
             <div class='td-code-block' style='font-family:inherit;font-size:12.5px;line-height:1.6;'>${escapeHtml(summary)}</div>
           </div>`
        : '';

      const itemNotesHtml = notedItems.length > 0
        ? `<div class='td-field'>
             <label class='td-label'>逐条修改 / 使用说明 (${notedItems.length})</label>
             <div style='display:flex;flex-direction:column;gap:6px;'>
               ${notedItems.map((r) => `
                 <div class='td-mgr-row'>
                   <div class='td-mgr-row-head is-wrap-head'>
                     <div class='td-mgr-row-left'>
                       <span class='td-mode-tag ${r.writeMode === 'add' ? 'ok' : 'multi'}'>${r.isAiNew ? 'AI新增' : (r.writeMode === 'add' ? '新增写入' : `#${r.index + 1}`)}</span>
                       <span class='td-mgr-row-title is-wrap'>${escapeHtml(r.newName || '未命名条目')}</span>
                     </div>
                   </div>
                   <div style='font-size:12px;color:var(--td-text-muted);line-height:1.5;white-space:pre-wrap;user-select:text;'>${escapeHtml(r.note.trim())}</div>
                 </div>`).join('')}
             </div>
           </div>`
        : '';

      const emptyHtml = (!summary && notedItems.length === 0)
        ? `<div class='td-group-empty'>本次 AI 未附带额外文字说明或指导信息（可展开下方查看原始回复）</div>`
        : '';

      const rawHtml = rawReply
        ? `<details class='td-attr-diff-box'>
             <summary class='td-attr-diff-head'><span>查看 AI 原始回复内容</span></summary>
             <div style='padding:8px;border-top:1px solid var(--td-border);'>
               <div class='td-code-block td-scroll' style='max-height:220px;overflow-y:auto;'>${escapeHtml(rawReply)}</div>
             </div>
           </details>`
        : '';

      selectLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>${ICONS.help} AI 返回说明与指导</div>
            <div class='td-modal-head-actions'>
              <button type='button' class='td-icon-btn' data-action='ai-copy-notes' title='复制全部说明'>${ICONS.copy}</button>
              <button type='button' class='td-icon-btn' data-action='close-select-popup' title='关闭'>${ICONS.close}</button>
            </div>
          </div>
          <div class='td-modal-body'>
            ${summaryHtml}
            ${itemNotesHtml}
            ${emptyHtml}
            ${rawHtml}
          </div>
          <div class='td-modal-foot'>
            <button type='button' class='td-btn primary' data-action='close-select-popup'>关闭</button>
          </div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }
    if (sp.type !== 'aiResultEdit') return false;
    const pc = state.previewCtx;
    const r = pc?.results?.[sp.rIdx];
    if (!pc || !r || (pc.type !== 'pmAiEdit' && pc.type !== 'wbAiEdit')) return false;

    if (!Array.isArray(sp.history) || sp.history.length === 0) {
      sp.history = [{
        name: r.newName || '',
        enabled: !!r.newEnabled,
        role: pc.type === 'pmAiEdit' ? (r.newRole || 'system') : '',
        keys: pc.type === 'wbAiEdit' ? (r.newKeys || '') : '',
        content: r.newContent || '',
      }];
      sp.historyIdx = 0;
    }
    const cur = sp.history[sp.historyIdx] || sp.history[0];
    const isPreset = pc.type === 'pmAiEdit';

    const extraFieldHtml = isPreset
      ? `<div class='td-field'>
           <label class='td-label'>角色身份 (Role)</label>
           <select class='td-select' id='td-aire-role'>
             <option value='system' ${cur.role === 'system' ? 'selected' : ''}>System</option>
             <option value='user' ${cur.role === 'user' ? 'selected' : ''}>User</option>
             <option value='assistant' ${cur.role === 'assistant' ? 'selected' : ''}>Assistant</option>
           </select>
         </div>`
      : `<div class='td-field'>
           <label class='td-label'>主要关键词（逗号或换行分隔）</label>
           <input class='td-input' id='td-aire-keys' type='text' value='${escapeHtml(cur.keys || '')}' />
         </div>`;

    selectLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>手动编辑检视结果 · ${escapeHtml(cur.name || `结果 #${sp.rIdx + 1}`)}</div>
          <div class='td-modal-head-actions'>
            <button type='button' class='td-icon-btn' data-action='ai-edit-undo' title='撤销 (后退)' ${sp.historyIdx <= 0 ? 'disabled' : ''}>${ICONS.undo}</button>
            <button type='button' class='td-icon-btn' data-action='ai-edit-redo' title='重做 (前进)' ${sp.historyIdx >= sp.history.length - 1 ? 'disabled' : ''}>${ICONS.redo}</button>
            <button type='button' class='td-icon-btn' data-action='ai-edit-copy' title='复制正文'>${ICONS.copy}</button>
            <button type='button' class='td-icon-btn' data-action='close-select-popup' title='关闭'>${ICONS.close}</button>
          </div>
        </div>
        <div class='td-modal-body'>
          <div style='display:flex;gap:8px;align-items:center;'>
            <div class='td-field' style='flex:1;'>
              <label class='td-label'>条目名称</label>
              <input class='td-input' id='td-aire-name' type='text' value='${escapeHtml(cur.name || '')}' />
            </div>
            <div style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'>
              <input type='checkbox' class='td-checkbox' id='td-aire-enabled' ${cur.enabled ? 'checked' : ''} /><span>启用</span>
            </div>
          </div>
          ${extraFieldHtml}
          <div class='td-field' style='flex:1;display:flex;flex-direction:column;min-height:170px;'>
            <label class='td-label'>条目正文（支持顶部撤销/重做）</label>
            ${renderQuickInsertHtml('td-aire-content')}
            ${renderSearchableTextareaHtml({ id: 'td-aire-content', value: cur.content || '', minHeight: '170px' })}
          </div>
        </div>
        <div class='td-modal-foot'>
          <button type='button' class='td-btn' data-action='close-select-popup'>取消</button>
          <button type='button' class='td-btn primary' data-action='ai-edit-save'>${ICONS.save} 保存到检视结果</button>
        </div>
      </div>`;
    bindEditorSearchEvents(selectLayerEl);
    updateAiEditHistoryButtons(selectLayerEl, sp);
    uiCtx.syncOverlayBounds();
    return true;
  },

  onSnippetInsert(layerEl) {
    if (state.selectPopup?.type === 'aiResultEdit') {
      pushAiEditSnapshot(layerEl, state.selectPopup, true);
      return true;
    }
    return false;
  },

  renderPreview(previewLayerEl) {
    if (state.previewCtx?.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
      const ai = state.previewCtx;
      if (ai.step === 'review') {
        const acceptedList = (ai.results || []).filter((x) => x.accepted);
        const modCnt = acceptedList.filter((x) => x.writeMode !== 'add').length;
        const addCnt = acceptedList.filter((x) => x.writeMode === 'add').length;
        const reviewRows = (ai.results || []).map((r, rIdx) => {
          const isAdd = r.writeMode === 'add';
          const lines = computeLineDiff(isAdd ? '' : (r.oldPrompt?.content || ''), r.newContent || '');
          const tagHtml = r.isAiNew
            ? "<span class='td-mode-tag ok'>AI 新增</span>"
            : (isAdd ? "<span class='td-mode-tag single'>新增写入</span>" : "<span class='td-mode-tag multi'>覆盖修改</span>");
          return `
            <div class='td-mgr-row ${r.accepted ? 'is-active' : ''}'>
              <div class='td-mgr-row-head'>
                <div style='display:flex;align-items:center;gap:6px;min-width:0;flex:1;'>
                  <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                  ${tagHtml}
                  ${r.manualEdited ? "<span class='td-mode-tag multi'>已手动编辑</span>" : ''}
                  ${!r.isAiNew ? `<span class='td-idx-badge'>#${r.index + 1}</span>` : ''}
                  <span class='td-mgr-row-title' title='${escapeHtml(r.newName)}'>${escapeHtml(r.newName)}</span>
                </div>
                <span class='td-src-badge'>${escapeHtml(r.newRole)} · ${r.newEnabled ? '开' : '关'}</span>
              </div>
              <div style='display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;'>
                ${r.note ? `<span style='font-size:11.5px;color:var(--td-text-muted);flex:1;'>AI 说明：${escapeHtml(r.note)}</span>` : '<span></span>'}
                <div style='display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;'>
                  <button type='button' class='td-btn sm primary' data-action='ai-edit-result' data-ridx='${rIdx}'>${ICONS.edit} 手动编辑</button>
                  ${!r.isAiNew ? `<button type='button' class='td-btn sm ${isAdd ? 'warn' : ''}' data-action='ai-toggle-write-mode' data-ridx='${rIdx}'>${isAdd ? '切换为覆盖原条目' : '新增条目写入'}</button>` : ''}
                  ${isAdd ? `<button type='button' class='td-btn sm' data-action='ai-toggle-target-list' data-ridx='${rIdx}'>目标: ${r.targetList === 'prompts_unused' ? '未添加池' : '主列表'}</button>` : ''}
                </div>
              </div>
              <div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>
            </div>`;
        }).join('');

        const hasAiNotes = !!(ai.summary && ai.summary.trim()) || (ai.results || []).some((x) => x.note && x.note.trim());
        previewLayerEl.classList.add('is-open');
        previewLayerEl.innerHTML = `
          <div class='td-modal td-modal-tall'>
            <div class='td-modal-head'><div class='td-modal-title'>检视 AI 结果 (${acceptedList.length}/${(ai.results || []).length})</div><div class='td-modal-head-actions'><button type='button' class='td-btn xs ${hasAiNotes ? 'warn' : ''}' data-action='ai-open-notes' title='查看 AI 返回的说明与指导信息'>${ICONS.help} 说明</button><button class='td-icon-btn' data-action='open-help' data-help-key='aiEdit' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div></div>
            <div class='td-modal-body td-picker-body'><div class='td-picker-list td-scroll'>${reviewRows}</div></div>
            <div class='td-modal-foot'><button class='td-btn' data-action='ai-back-setup'>返回修改需求</button><button class='td-btn primary' data-action='ai-apply-results'>${ICONS.check} 写回（改 ${modCnt} · 新增 ${addCnt}）</button></div>
          </div>`;
        uiCtx.syncOverlayBounds();
        return true;
      }

      const pList = state.modal.data.prompts || [], uList = state.modal.data.prompts_unused || [];
      const items = [
        ...pList.map((p, i) => ({ key: `prompts::${i}`, listName: 'prompts', index: i, label: `[主列表 #${i + 1}] ${p.name || p.id}` })),
        ...uList.map((p, i) => ({ key: `prompts_unused::${i}`, listName: 'prompts_unused', index: i, label: `[未添加 #${i + 1}] ${p.name || p.id}` })),
      ];
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = renderAiEditSetupHtml({ title: 'AI 智能编辑预设条目', ai, items, itemLabelFn: (it) => it.label });
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (state.previewCtx?.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
      const ai = state.previewCtx;
      if (ai.step === 'review') {
        const acceptedList = (ai.results || []).filter((x) => x.accepted);
        const modCnt = acceptedList.filter((x) => x.writeMode !== 'add').length;
        const addCnt = acceptedList.filter((x) => x.writeMode === 'add').length;
        const reviewRows = (ai.results || []).map((r, rIdx) => {
          const isAdd = r.writeMode === 'add';
          const lines = computeLineDiff(isAdd ? '' : (r.oldContent || ''), r.newContent || '');
          const tagHtml = r.isAiNew
            ? "<span class='td-mode-tag ok'>AI 新增</span>"
            : (isAdd ? "<span class='td-mode-tag single'>新增写入</span>" : "<span class='td-mode-tag multi'>覆盖修改</span>");
          return `
            <div class='td-mgr-row ${r.accepted ? 'is-active' : ''}'>
              <div class='td-mgr-row-head'>
                <div style='display:flex;align-items:center;gap:6px;min-width:0;flex:1;'>
                  <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                  ${tagHtml}
                  ${!r.isAiNew ? `<span class='td-idx-badge'>#${r.index + 1}</span>` : ''}
                  ${r.manualEdited ? "<span class='td-mode-tag multi'>已手动编辑</span>" : ''}
                  <span class='td-mgr-row-title' title='${escapeHtml(r.newName)}'>${escapeHtml(r.newName)}</span>
                </div>
                <span class='td-src-badge'>${r.newEnabled ? '开' : '关'}</span>
              </div>
              ${r.newKeys !== r.oldKeys && r.newKeys ? `<div style='font-size:11.5px;color:var(--td-single);'>关键词：${escapeHtml(r.newKeys)}</div>` : ''}
              <div style='display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;'>
                ${r.note ? `<span style='font-size:11.5px;color:var(--td-text-muted);flex:1;'>AI 说明：${escapeHtml(r.note)}</span>` : '<span></span>'}
                <div style='display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;'>
                  <button type='button' class='td-btn sm primary' data-action='ai-edit-result' data-ridx='${rIdx}'>${ICONS.edit} 手动编辑</button>
                  ${!r.isAiNew ? `<button type='button' class='td-btn sm ${isAdd ? 'warn' : ''}' data-action='ai-toggle-write-mode' data-ridx='${rIdx}'>${isAdd ? '切换为覆盖原条目' : '新增条目写入'}</button>` : ''}
                </div>
              </div>
              <div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>
            </div>`;
        }).join('');

        const hasAiNotes = !!(ai.summary && ai.summary.trim()) || (ai.results || []).some((x) => x.note && x.note.trim());
        previewLayerEl.classList.add('is-open');
        previewLayerEl.innerHTML = `
          <div class='td-modal td-modal-tall'>
            <div class='td-modal-head'><div class='td-modal-title'>检视 AI 世界书结果 (${acceptedList.length}/${(ai.results || []).length})</div><div class='td-modal-head-actions'><button type='button' class='td-btn xs ${hasAiNotes ? 'warn' : ''}' data-action='ai-open-notes' title='查看 AI 返回的说明与指导信息'>${ICONS.help} 说明</button><button class='td-icon-btn' data-action='open-help' data-help-key='aiEdit' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div></div>
            <div class='td-modal-body td-picker-body'><div class='td-picker-list td-scroll'>${reviewRows}</div></div>
            <div class='td-modal-foot'><button class='td-btn' data-action='ai-back-setup'>返回修改需求</button><button class='td-btn primary' data-action='ai-apply-results'>${ICONS.check} 写回（改 ${modCnt} · 新增 ${addCnt}）</button></div>
          </div>`;
        uiCtx.syncOverlayBounds();
        return true;
      }

      const items = (state.modal.entries || []).map((e, i) => ({
        key: String(i),
        index: i,
        label: `[#${i + 1}] ${e.name || `条目 #${e.uid}`}`,
      }));
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = renderAiEditSetupHtml({ title: `AI 编辑世界书 · ${state.modal.bookName}`, ai, items, itemLabelFn: (it) => it.label });
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  handleClick(e, actionEl, action) {
    const previewLayerEl = uiCtx.getPreviewLayer();

    if (action === 'ai-preview-ref-item' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      e.stopPropagation();
      const ai = state.previewCtx;
      const rk = actionEl.getAttribute('data-key') || '';
      ensureAiSetupDefaults(ai);
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
          metas: [
            it.sourceLabel,
            it.badge,
            `状态: ${p.enabled ? '开启' : '关闭'}`,
            `身份: ${p.role || 'system'}`,
            posLabel,
          ],
          content: typeof p.content === 'string' ? p.content : '（此条目为内置占位符，无正文内容）',
        };
        uiCtx.renderSelectPopup();
      } else if (it.kind === 'worldbook' && it.entry) {
        const entry = it.entry;
        const keysStr = formatKeysInput(entry.strategy?.keys);
        state.selectPopup = {
          type: 'aiItemPreview',
          title: entry.name || `条目 #${entry.uid}`,
          metas: [
            it.sourceLabel,
            it.badge,
            `状态: ${entry.enabled ? '开启' : '关闭'}`,
            keysStr ? `关键词: ${keysStr}` : '无关键词',
          ],
          content: entry.content || '',
        };
        uiCtx.renderSelectPopup();
      }
      return true;
    }

    if (action === 'ai-preview-item' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      e.stopPropagation();
      const k = actionEl.getAttribute('data-key') || '';
      if (state.previewCtx.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
        const [listName, idxStr] = k.split('::');
        const p = state.modal.data[listName]?.[Number(idxStr)];
        if (!p) return true;
        const posLabel = p.position?.type === 'in_chat' ? `@D${p.position.depth ?? 0}` : '相对位置';
        state.selectPopup = {
          type: 'aiItemPreview',
          title: p.name || p.id,
          metas: [
            listName === 'prompts_unused' ? '未添加池' : `主列表 #${Number(idxStr) + 1}`,
            `状态: ${p.enabled ? '开启' : '关闭'}`,
            `身份: ${p.role || 'system'}`,
            posLabel,
          ],
          content: typeof p.content === 'string' ? p.content : '（此条目为内置占位符，无正文内容）',
        };
        uiCtx.renderSelectPopup();
      } else if (state.previewCtx.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
        const idx = Number(k);
        const entry = state.modal.entries?.[idx];
        if (!entry) return true;
        const keysStr = formatKeysInput(entry.strategy?.keys);
        state.selectPopup = {
          type: 'aiItemPreview',
          title: entry.name || `条目 #${entry.uid}`,
          metas: [
            `#${idx + 1}`,
            `状态: ${entry.enabled ? '开启' : '关闭'}`,
            keysStr ? `关键词: ${keysStr}` : '无关键词',
          ],
          content: entry.content || '',
        };
        uiCtx.renderSelectPopup();
      }
      return true;
    }

    if (action === 'ai-toggle-api-box' && state.previewCtx) {
      saveSharedAiApiFieldsFromPreview(previewLayerEl);
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.apiExpanded = !state.previewCtx.apiExpanded;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-toggle-model-manual' && state.previewCtx) {
      saveSharedAiApiFieldsFromPreview(previewLayerEl);
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.manualModelInput = false;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-fetch-models' && state.previewCtx) {
      if (state.previewCtx.fetchingModels) return true;
      const cfg = saveSharedAiApiFieldsFromPreview(previewLayerEl);
      syncAiPreviewDraftInputs(previewLayerEl);
      const apiKey = normalizeApiTargetValue(cfg.proxyPreset);
      state.previewCtx.fetchingModels = true;
      uiCtx.renderPreviewModal();
      fetchModelsForApiTarget(apiKey).then(({ models }) => {
        state.previewCtx.fetchingModels = false;
        state._aiModelsCache = state._aiModelsCache || {};
        state._aiModelsCache[apiKey] = models;
        uiCtx.renderPreviewModal();
        if (models.length > 0) notify('success', `已获取 ${models.length} 个可用模型`);
        else notify('warning', '未拉取到模型列表，可在下拉框末尾选择「手动输入模型名」');
      }).catch((err) => {
        state.previewCtx.fetchingModels = false;
        uiCtx.renderPreviewModal();
        logWarn('拉取模型列表失败', err);
        notify('warning', `拉取模型失败: ${err.message || err}（可手动输入模型名）`);
      });
      return true;
    }
    if (action === 'ai-toggle-ref-box' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.refExpanded = !state.previewCtx.refExpanded;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-toggle-tpl-box' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.tplExpanded = !state.previewCtx.tplExpanded;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-clear-instruction' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.instruction = '';
      const ta = previewLayerEl?.querySelector('#td-ai-instruction');
      if (ta) { ta.value = ''; ta.focus(); }
      actionEl.disabled = true;
      persistAiEditDraft(state.previewCtx);
      return true;
    }
    if (action === 'ai-clear-selected' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.selectedKeys.clear();
      persistAiEditDraft(state.previewCtx);
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-clear-search' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.search = '';
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-ref-set-type' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      ensureAiSetupDefaults(ai);
      syncAiPreviewDraftInputs(previewLayerEl);
      const nextType = actionEl.getAttribute('data-type') === 'worldbook' ? 'worldbook' : 'preset';
      if (ai.refSourceType !== nextType) {
        ai.refSourceType = nextType;
        ai.refOnlySelected = false;
        ai.refSourceName = nextType === 'worldbook' ? (ai.refLastWorldbook || '') : (ai.refLastPreset || '');
        uiCtx.renderPreviewModal();
      }
      return true;
    }
    if (action === 'ai-ref-toggle-selected-view' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      ensureAiSetupDefaults(ai);
      syncAiPreviewDraftInputs(previewLayerEl);
      ai.refOnlySelected = !ai.refOnlySelected;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-toggle-ref' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      ensureAiSetupDefaults(ai);
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
      persistAiEditDraft(ai);
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
    if (action === 'ai-ref-select-enabled' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      ensureAiSetupDefaults(ai);
      const items = ai.refSourceType === 'worldbook'
        ? getWorldbookRefItemsSync(ai, ai.refSourceName).items
        : getPresetRefItems(ai, ai.refSourceName);
      items.forEach((it) => {
        if (it.enabled) {
          ai.refSelectedKeys.add(it.refKey);
          ai.refSelectedData.set(it.refKey, it);
        }
      });
      persistAiEditDraft(ai);
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-ref-clear' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      ensureAiSetupDefaults(ai);
      ai.refSelectedKeys.clear();
      ai.refSelectedData.clear();
      persistAiEditDraft(ai);
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-toggle-tpl-add' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.tplAddOpen = !state.previewCtx.tplAddOpen;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-fill-tpl-from-instr' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const instr = previewLayerEl?.querySelector('#td-ai-instruction')?.value ?? state.previewCtx.instruction ?? '';
      const contentInp = previewLayerEl?.querySelector('#td-ai-tpl-content');
      state.previewCtx.tplDraftContent = instr;
      if (contentInp) contentInp.value = instr;
      return true;
    }
    if (action === 'ai-save-tpl' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const name = (previewLayerEl?.querySelector('#td-ai-tpl-name')?.value || '').trim();
      const content = (previewLayerEl?.querySelector('#td-ai-tpl-content')?.value || '').trim();
      if (!name) { notify('warning', '请输入指令模板名称'); return true; }
      if (!content) { notify('warning', '请输入指令模板内容'); return true; }
      const list = getAiInstructionTemplates().slice();
      list.unshift({ id: genId(), name, content });
      saveAiInstructionTemplates(list);
      state.previewCtx.tplAddOpen = false;
      state.previewCtx.tplDraftName = '';
      state.previewCtx.tplDraftContent = '';
      uiCtx.renderPreviewModal();
      notify('success', `已新增指令模板「${name}」`);
      return true;
    }
    if (action === 'ai-use-tpl' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const tpl = getAiInstructionTemplates().find((x) => x.id === actionEl.getAttribute('data-tpl-id'));
      if (tpl) {
        state.previewCtx.instruction = tpl.content;
        const ta = previewLayerEl?.querySelector('#td-ai-instruction');
        if (ta) { ta.value = tpl.content; ta.focus(); }
        const clrBtn = previewLayerEl?.querySelector("[data-action='ai-clear-instruction']");
        if (clrBtn) clrBtn.disabled = !tpl.content;
        persistAiEditDraft(state.previewCtx);
      }
      return true;
    }
    if (action === 'ai-del-tpl' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      e.stopPropagation();
      const tid = actionEl.getAttribute('data-tpl-id');
      const tpl = getAiInstructionTemplates().find((x) => x.id === tid);
      if (!tpl) return true;
      openConfirm({
        title: '删除指令模板确认',
        message: `确定要删除常用指令模板「${tpl.name}」吗？`,
        confirmText: '确认删除',
        onConfirm: () => {
          saveAiInstructionTemplates(getAiInstructionTemplates().filter((x) => x.id !== tid));
          uiCtx.renderPreviewModal();
          notify('info', `已删除指令模板「${tpl.name}」`);
        },
      });
      return true;
    }
    if (action === 'ai-toggle-item' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const k = actionEl.getAttribute('data-key');
      if (state.previewCtx.selectedKeys.has(k)) state.previewCtx.selectedKeys.delete(k);
      else state.previewCtx.selectedKeys.add(k);
      const labelEl = previewLayerEl?.querySelector("[data-role='ai-selected-label']");
      if (labelEl) labelEl.textContent = `待编辑条目 (已选 ${state.previewCtx.selectedKeys.size})`;
      const clrBtn = previewLayerEl?.querySelector("[data-action='ai-clear-selected']");
      if (clrBtn) clrBtn.disabled = state.previewCtx.selectedKeys.size === 0;
      actionEl.closest('.td-picker-row')?.classList.toggle('checked', state.previewCtx.selectedKeys.has(k));
      persistAiEditDraft(state.previewCtx);
      return true;
    }
    if (action === 'ai-run' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      if (ai.loading) return true;
      ensureAiSetupDefaults(ai);
      const cfg = saveSharedAiApiFieldsFromPreview(previewLayerEl);
      ai.instruction = previewLayerEl?.querySelector('#td-ai-instruction')?.value ?? ai.instruction;
      persistAiEditDraft(ai);

      if (ai.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
        const selectedItems = [];
        ['prompts', 'prompts_unused'].forEach((listName) => {
          (state.modal.data[listName] || []).forEach((p, idx) => {
            const uk = `${listName}::${idx}`;
            if (ai.selectedKeys.has(uk)) selectedItems.push({ uidKey: uk, listName, index: idx, prompt: p });
          });
        });
        ai.loading = true;
        setAiRunBtnLoading(previewLayerEl, true);
        resolveAllSelectedReferenceItems(ai)
          .then((referenceItems) => runAiPresetEdit({ selectedItems, referenceItems, instruction: ai.instruction, apiCfg: cfg }))
          .then(({ results, summary, rawReply }) => {
            ai.loading = false; ai.results = results; ai.summary = summary || ''; ai.rawReply = rawReply || ''; ai.step = 'review'; uiCtx.renderPreviewModal();
            notify('success', `AI 处理完成，返回 ${results.length} 条结果`);
          }).catch((err) => {
            ai.loading = false;
            setAiRunBtnLoading(previewLayerEl, false);
            logError('AI 编辑预设失败', err);
            notify('error', err.message || String(err));
          });
        return true;
      }

      if (ai.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
        const selectedItems = [];
        (state.modal.entries || []).forEach((entry, idx) => {
          if (ai.selectedKeys.has(String(idx))) selectedItems.push({ index: idx, entry });
        });
        ai.loading = true;
        setAiRunBtnLoading(previewLayerEl, true);
        resolveAllSelectedReferenceItems(ai)
          .then((referenceItems) => runAiWorldbookEdit({ selectedItems, referenceItems, instruction: ai.instruction, apiCfg: cfg }))
          .then(({ results, summary, rawReply }) => {
            ai.loading = false; ai.results = results; ai.summary = summary || ''; ai.rawReply = rawReply || ''; ai.step = 'review'; uiCtx.renderPreviewModal();
            notify('success', `AI 处理完成，返回 ${results.length} 条结果`);
          }).catch((err) => {
            ai.loading = false;
            setAiRunBtnLoading(previewLayerEl, false);
            logError('AI 编辑世界书失败', err);
            notify('error', err.message || String(err));
          });
        return true;
      }
    }
    if (action === 'ai-open-notes' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      state.selectPopup = { type: 'aiNotes' };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'ai-copy-notes' && state.selectPopup?.type === 'aiNotes') {
      const txt = formatAiNotesText(state.previewCtx);
      if (!txt) { notify('info', '暂无可复制的说明内容'); return true; }
      copyToClipboard(txt).then(() => notify('success', 'AI 说明已复制到剪贴板')).catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'ai-edit-result' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const rIdx = Number(actionEl.getAttribute('data-ridx'));
      const r = state.previewCtx.results?.[rIdx];
      if (!r) return true;
      state.selectPopup = {
        type: 'aiResultEdit',
        aiType: state.previewCtx.type,
        rIdx,
        history: null,
        historyIdx: 0,
        timer: null,
      };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'ai-edit-undo' && state.selectPopup?.type === 'aiResultEdit') {
      const selectLayerEl = uiCtx.getSelectLayer();
      const sp = state.selectPopup;
      pushAiEditSnapshot(selectLayerEl, sp, true);
      if (sp.historyIdx > 0) {
        sp.historyIdx--;
        applyAiResultEditSnapshot(selectLayerEl, sp, sp.history[sp.historyIdx]);
        updateAiEditHistoryButtons(selectLayerEl, sp);
      }
      return true;
    }
    if (action === 'ai-edit-redo' && state.selectPopup?.type === 'aiResultEdit') {
      const selectLayerEl = uiCtx.getSelectLayer();
      const sp = state.selectPopup;
      if (Array.isArray(sp.history) && sp.historyIdx < sp.history.length - 1) {
        sp.historyIdx++;
        applyAiResultEditSnapshot(selectLayerEl, sp, sp.history[sp.historyIdx]);
        updateAiEditHistoryButtons(selectLayerEl, sp);
      }
      return true;
    }
    if (action === 'ai-edit-copy' && state.selectPopup?.type === 'aiResultEdit') {
      const contentEl = uiCtx.getSelectLayer()?.querySelector('#td-aire-content');
      copyToClipboard(contentEl ? contentEl.value : '').then(() => notify('success', '正文已复制到剪贴板')).catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'ai-edit-save' && state.selectPopup?.type === 'aiResultEdit') {
      const selectLayerEl = uiCtx.getSelectLayer();
      const sp = state.selectPopup;
      pushAiEditSnapshot(selectLayerEl, sp, true);
      const snap = readAiResultEditSnapshot(selectLayerEl, sp.aiType);
      const r = state.previewCtx?.results?.[sp.rIdx];
      if (r) {
        if (snap.name.trim()) r.newName = snap.name.trim();
        r.newEnabled = !!snap.enabled;
        if (sp.aiType === 'pmAiEdit') {
          r.newRole = ['system', 'user', 'assistant'].includes(snap.role) ? snap.role : 'system';
        } else if (sp.aiType === 'wbAiEdit') {
          r.newKeys = snap.keys;
        }
        r.newContent = snap.content;
        r.manualEdited = true;
      }
      if (sp.timer) { clearTimeout(sp.timer); sp.timer = null; }
      state.selectPopup = null;
      uiCtx.renderSelectPopup();
      uiCtx.renderPreviewModal();
      notify('success', `已更新检视条目「${r?.newName || ''}」`);
      return true;
    }
    if (action === 'ai-toggle-accept' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const r = state.previewCtx.results?.[Number(actionEl.getAttribute('data-ridx'))];
      if (r) { r.accepted = !r.accepted; uiCtx.renderPreviewModal(); }
      return true;
    }
    if (action === 'ai-toggle-write-mode' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const r = state.previewCtx.results?.[Number(actionEl.getAttribute('data-ridx'))];
      if (r && !r.isAiNew) {
        r.writeMode = r.writeMode === 'add' ? 'overwrite' : 'add';
        uiCtx.renderPreviewModal();
      }
      return true;
    }
    if (action === 'ai-toggle-target-list' && state.previewCtx?.type === 'pmAiEdit') {
      const r = state.previewCtx.results?.[Number(actionEl.getAttribute('data-ridx'))];
      if (r) {
        r.targetList = r.targetList === 'prompts_unused' ? 'prompts' : 'prompts_unused';
        uiCtx.renderPreviewModal();
      }
      return true;
    }
    if (action === 'ai-back-setup' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      state.previewCtx.step = 'setup'; uiCtx.renderPreviewModal(); return true;
    }
    if (action === 'ai-goto-review' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      saveSharedAiApiFieldsFromPreview(previewLayerEl);
      syncAiPreviewDraftInputs(previewLayerEl);
      if (Array.isArray(state.previewCtx.results) && state.previewCtx.results.length > 0) {
        state.previewCtx.step = 'review';
        uiCtx.renderPreviewModal();
      }
      return true;
    }
    if (action === 'ai-apply-results' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      let updated = 0;
      let added = 0;
      if (state.previewCtx.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
        const addedByList = { prompts: [], prompts_unused: [] };
        (state.previewCtx.results || []).forEach((r) => {
          if (!r.accepted) return;
          if (r.writeMode === 'add') {
            const targetList = r.targetList === 'prompts_unused' ? 'prompts_unused' : 'prompts';
            const newPrompt = buildNewPromptEntry({
              name: r.newName,
              enabled: r.newEnabled,
              role: r.newRole,
              content: r.newContent,
            });
            newPrompt.extra = { tdAiTag: 'AI新增' };
            addedByList[targetList].push(newPrompt);
            added++;
          } else {
            const target = state.modal.data[r.listName]?.[r.index]; if (!target) return;
            target.name = r.newName; target.role = r.newRole; target.enabled = r.newEnabled;
            if (typeof target.content === 'string' || r.newContent.length > 0 || !PRESET_SYSTEM_IDS.has(target.id)) target.content = r.newContent;
            updated++;
          }
        });
        ['prompts', 'prompts_unused'].forEach((ln) => {
          if (addedByList[ln].length > 0) {
            state.modal.data[ln] = state.modal.data[ln] || [];
            state.modal.data[ln].unshift(...addedByList[ln]);
          }
        });
        if (updated + added > 0) state.modal.dirty = true;
        state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
        notify('success', `已写回预设草稿（修改 ${updated} 项，新增 ${added} 项置于顶部，请点击「保存预设」持久化）`);
        return true;
      }
      if (state.previewCtx.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
        let nextUid = (state.modal.entries || []).reduce((mx, x) => Math.max(mx, Number(x.uid) || 0), 0) + 1;
        const addedEntries = [];
        (state.previewCtx.results || []).forEach((r) => {
          if (!r.accepted) return;
          if (r.writeMode === 'add') {
            const newEntry = buildDefaultWorldbookEntry({
              name: r.newName,
              enabled: r.newEnabled,
              keys: parseKeysInput(r.newKeys),
              content: r.newContent,
            });
            newEntry.uid = nextUid++;
            newEntry.extra = { tdAiTag: 'AI新增' };
            addedEntries.push(newEntry);
            added++;
          } else {
            const target = state.modal.entries?.[r.index]; if (!target) return;
            target.name = r.newName; target.enabled = r.newEnabled; target.content = r.newContent;
            target.strategy = target.strategy || { type: 'selective', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' };
            target.strategy.keys = parseKeysInput(r.newKeys);
            updated++;
          }
        });
        if (addedEntries.length > 0) {
          state.modal.entries.unshift(...addedEntries);
        }
        if (updated + added > 0) state.modal.dirty = true;
        state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
        notify('success', `已写回世界书草稿（修改 ${updated} 项，新增 ${added} 项置于顶部，请点击「保存世界书」持久化）`);
        return true;
      }
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    if (state.selectPopup?.type === 'aiResultEdit' && ['td-aire-name', 'td-aire-keys', 'td-aire-content'].includes(id)) {
      const selectLayerEl = uiCtx.getSelectLayer();
      const isLarge = e.inputType === 'insertFromPaste' || e.inputType === 'deleteByCut';
      if (isLarge) pushAiEditSnapshot(selectLayerEl, state.selectPopup, true);
      else scheduleAiEditSnapshot(selectLayerEl, state.selectPopup);
      return true;
    }
    if (id === 'td-ai-instruction' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      state.previewCtx.instruction = target.value;
      const clrBtn = uiCtx.getPreviewLayer()?.querySelector("[data-action='ai-clear-instruction']");
      if (clrBtn) clrBtn.disabled = !target.value;
      scheduleSaveAiEditDraft(state.previewCtx);
      return true;
    }
    if (id === 'td-ai-model' && state.previewCtx) {
      state.store.settings.aiEditConfig.model = target.value;
      saveStore(state.store);
      return true;
    }
    if (id === 'td-ai-tpl-name' && state.previewCtx) { state.previewCtx.tplDraftName = target.value; return true; }
    if (id === 'td-ai-tpl-content' && state.previewCtx) { state.previewCtx.tplDraftContent = target.value; return true; }
    if (id === 'td-ai-ref-search' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) { state.previewCtx.refSearch = target.value; uiCtx.renderPreviewModal(); return true; }
    if (id === 'td-ai-search' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) { state.previewCtx.search = target.value; uiCtx.renderPreviewModal(); return true; }
    return false;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    if (state.selectPopup?.type === 'aiResultEdit' && (id === 'td-aire-enabled' || id === 'td-aire-role')) {
      pushAiEditSnapshot(uiCtx.getSelectLayer(), state.selectPopup, true);
      return true;
    }
    if (id === 'td-ai-ref-source-name' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      ensureAiSetupDefaults(ai);
      syncAiPreviewDraftInputs(uiCtx.getPreviewLayer());
      ai.refSourceName = target.value;
      ai.refOnlySelected = false;
      if (ai.refSourceType === 'worldbook') ai.refLastWorldbook = target.value;
      else ai.refLastPreset = target.value;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (id === 'td-ai-proxy-preset' || id === 'td-ai-jailbreak-preset') {
      saveSharedAiApiFieldsFromPreview(uiCtx.getPreviewLayer());
      syncAiPreviewDraftInputs(uiCtx.getPreviewLayer());
      if (id === 'td-ai-proxy-preset' && state.previewCtx) {
        state.previewCtx.manualModelInput = false;
        uiCtx.renderPreviewModal();
      }
      return true;
    }
    if (id === 'td-ai-model-select' && state.previewCtx) {
      if (target.value === '__manual__') {
        syncAiPreviewDraftInputs(uiCtx.getPreviewLayer());
        state.previewCtx.manualModelInput = true;
        uiCtx.renderPreviewModal();
      } else {
        state.store.settings.aiEditConfig.model = target.value;
        saveStore(state.store);
      }
      return true;
    }
    return false;
  },
};
