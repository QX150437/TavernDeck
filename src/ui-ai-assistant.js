import {
  escapeHtml, notify, computeLineDiff, formatKeysInput, parseKeysInput,
  hasTH, callTH, getST, genId, copyToClipboard, logWarn, logError,
} from './utils.js';
import { state, saveStore } from './store.js';
import { PRESET_SYSTEM_IDS, buildNewPromptEntry, buildDefaultPresetRegex } from './preset-manager.js';
import { buildDefaultWorldbookEntry } from './worldbook-manager.js';
import {
  runAiPresetEdit, runAiWorldbookEdit, stopAiGenerationRequest,
  getAvailableApiTargets, fetchModelsForApiTarget, normalizeApiTargetValue,
} from './ai-preset-edit.js';
import { ICONS, uiCtx, openConfirm } from './ui-common.js';
import {
  getAllSavedPresetNames, getAllWorldbookNames, getPresetRefItems, getWorldbookRefItemsSync,
  hydrateSelectedRefData, resolveAllSelectedReferenceItems, ensureAiRefDefaults,
  renderReferencePickerHtml, handleAiRefClick, handleAiRefChange,
} from './ui-ai-ref.js';
import {
  buildRegexAttrFieldsHtml, readRegexAttrFields, openRegexTestPreview,
} from './ui-regex-test.js';

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

function encodeAiKeySet(type, keySet) {
  const out = [];
  if (!(keySet instanceof Set)) return out;
  if (type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
    keySet.forEach((k) => {
      const [listName, idxStr] = String(k).split('::');
      if (listName === 'regex') {
        const r = state.modal.regexes?.[Number(idxStr)];
        if (!r) return;
        out.push(r.id ? `regex::id::${r.id}` : `regex::idx::${idxStr}`);
        return;
      }
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
    (state.modal.regexes || []).forEach((r, idx) => {
      const k = `regex::${idx}`;
      if (r?.id) map.set(`regex::id::${r.id}`, k);
      map.set(`regex::idx::${idx}`, k);
      map.set(k, k);
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

function getAiJobsMap() {
  if (!(state.aiEditJobs instanceof Map)) state.aiEditJobs = new Map();
  return state.aiEditJobs;
}

function getAiRunIdleLabel(ai) {
  if (!ai?.loading) return '发送给 AI 编辑';
  const sec = Math.max(0, Math.floor((Date.now() - (ai.startedAt || Date.now())) / 1000));
  return `停止生成 (${sec}s)`;
}

function syncAiRunButtonDom(previewLayerEl, ai) {
  const btn = previewLayerEl?.querySelector("[data-action='ai-run']");
  if (!btn || !ai) return;
  btn.disabled = false;
  if (ai.loading) {
    btn.classList.remove('primary');
    btn.classList.add('danger');
    btn.textContent = getAiRunIdleLabel(ai);
    btn.title = '点击手动终止本次 AI 请求';
  } else {
    btn.classList.remove('danger');
    btn.classList.add('primary');
    btn.textContent = '发送给 AI 编辑';
    btn.title = '';
  }
}

function stopAiJobTimer(job) {
  if (job?.timerId) {
    clearInterval(job.timerId);
    job.timerId = null;
  }
}

function startAiJobTimer(job) {
  stopAiJobTimer(job);
  job.timerId = setInterval(() => {
    if (!job.aiCtx?.loading) {
      stopAiJobTimer(job);
      return;
    }
    if (state.panelOpen && state.previewCtx === job.aiCtx) {
      syncAiRunButtonDom(uiCtx.getPreviewLayer(), job.aiCtx);
    }
  }, 1000);
}

function stopAiEditJob(ai) {
  if (!ai || !ai.loading) return;
  const job = getAiJobsMap().get(ai.draftKey);
  if (job) {
    job.cancelled = true;
    stopAiJobTimer(job);
  }
  ai.loading = false;
  try { ai._abortController?.abort(); } catch (e) {}
  if (ai._generationId) stopAiGenerationRequest(ai._generationId);
  ai._abortController = null;
  ai._generationId = '';
  if (state.panelOpen && state.previewCtx === ai) {
    uiCtx.renderPreviewModal();
  }
  notify('info', '已手动终止 AI 编辑请求');
}

function isSameTargetModal(curModal, snap) {
  if (!curModal || !snap || curModal.type !== snap.type) return false;
  if (snap.type === 'presetDetail') return curModal.presetName === snap.presetName;
  if (snap.type === 'worldbookDetail') return curModal.bookName === snap.bookName;
  return false;
}

function isCurrentModalDirty() {
  const m = state.modal;
  if (!m) return false;
  if (m.type === 'presetDetail' || m.type === 'worldbookDetail') return !!m.dirty;
  if ((m.type === 'presetMerge' || m.type === 'wbMerge') && m.session?.dirty) return true;
  return false;
}

function presentCompletedAiJob(job) {
  const ai = job.aiCtx;
  const openReviewNow = () => {
    if (!isSameTargetModal(state.modal, job.modalSnapshot)) {
      state.modal = job.modalSnapshot;
    }
    state.previewKey = null;
    state.snapshotDetailId = null;
    state.selectPopup = null;
    state.previewCtx = ai;
    if (!state.panelOpen) {
      uiCtx.setPanelOpen(true);
    } else {
      uiCtx.renderModal();
      uiCtx.renderPreviewModal();
    }
  };

  if (!state.panelOpen || !state.modal || isSameTargetModal(state.modal, job.modalSnapshot) || !isCurrentModalDirty()) {
    openReviewNow();
    return;
  }

  openConfirm({
    title: 'AI 编辑结果已返回',
    message: `AI 已处理完成并生成 ${ai.results.length} 条结果，当前正在编辑其他未保存内容，是否切换并打开检视界面？`,
    confirmText: '打开检视',
    confirmClass: 'primary',
    onConfirm: () => {
      uiCtx.confirmDiscardDirtyModal(openReviewNow);
    },
  });
}

function formatAiErrorCopyText(errInfo) {
  if (!errInfo) return '';
  const parts = [`【报错信息 (${errInfo.time || ''})】\n${errInfo.message || '未知错误'}`];
  parts.push(`【AI 返回内容】\n${errInfo.rawReply ? errInfo.rawReply : '（AI 未返回任何文本内容）'}`);
  return parts.join('\n\n');
}

export function createAiEditPreviewCtx(type) {
  const draftKey = getAiDraftKey(type);
  const existingJob = draftKey ? getAiJobsMap().get(draftKey) : null;
  if (existingJob?.aiCtx && existingJob.aiCtx.type === type && (
    existingJob.aiCtx.loading
    || existingJob.aiCtx.lastError
    || (Array.isArray(existingJob.aiCtx.results) && existingJob.aiCtx.results.length > 0)
  )) {
    return existingJob.aiCtx;
  }
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

function readAiResultEditSnapshot(selectLayerEl, itemType) {
  const q = (sel) => selectLayerEl?.querySelector(sel);
  return {
    name: q('#td-aire-name')?.value ?? '',
    findRegex: itemType === 'regex' ? (q('#td-aire-find-regex')?.value ?? '') : '',
    content: q('#td-aire-content')?.value ?? '',
  };
}

function aiEditSnapshotsEqual(a, b) {
  return !!a && !!b
    && a.name === b.name
    && a.findRegex === b.findRegex
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
  const findEl = q('#td-aire-find-regex');
  const contentEl = q('#td-aire-content');
  if (nameEl) nameEl.value = snap.name;
  if (findEl && sp.itemType === 'regex') findEl.value = snap.findRegex || '';
  if (contentEl) contentEl.value = snap.content;
  syncEditorSearchHighlights('td-aire-content', selectLayerEl, false);
}

function pushAiEditSnapshot(selectLayerEl, sp, force = false) {
  if (!sp || sp.type !== 'aiResultContentEdit') return;
  if (sp.timer) { clearTimeout(sp.timer); sp.timer = null; }
  const snap = readAiResultEditSnapshot(selectLayerEl, sp.itemType);
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
  if (!sp || sp.type !== 'aiResultContentEdit') return;
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
  ensureAiRefDefaults(ai);
  if (typeof ai.targetFilter !== 'string') ai.targetFilter = 'all';
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

function renderAiEditSetupHtml({ title, ai, items, itemLabelFn }) {
  ensureAiSetupDefaults(ai);
  const templates = getAiInstructionTemplates();
  const q = (ai.search || '').trim().toLowerCase();
  const tFilter = ai.type === 'pmAiEdit' ? (ai.targetFilter || 'all') : 'all';
  const visible = items.filter((it) => {
    if (ai.type === 'pmAiEdit') {
      if (tFilter === 'prompts' && it.listName !== 'prompts') return false;
      if (tFilter === 'unused' && it.listName !== 'prompts_unused') return false;
      if (tFilter === 'regex' && it.listName !== 'regex') return false;
      if (tFilter === 'selected' && !ai.selectedKeys.has(it.key)) return false;
    }
    return !q || itemLabelFn(it).toLowerCase().includes(q);
  });
  const anySubExpanded = !!ai.apiExpanded || !!ai.refExpanded || !!ai.tplExpanded;
  const regexCount = ai.type === 'pmAiEdit' ? items.filter((it) => it.listName === 'regex').length : 0;
  const targetFilterBarHtml = ai.type === 'pmAiEdit' ? `
    <div class='td-filter-bar'>
      <button type='button' class='td-chip sm ${tFilter === 'all' ? 'active' : ''}' data-action='ai-set-target-filter' data-filter='all'>全部 (${items.length})</button>
      <button type='button' class='td-chip sm ${tFilter === 'prompts' ? 'active' : ''}' data-action='ai-set-target-filter' data-filter='prompts'>主列表</button>
      <button type='button' class='td-chip sm ${tFilter === 'unused' ? 'active' : ''}' data-action='ai-set-target-filter' data-filter='unused'>未添加</button>
      <button type='button' class='td-chip sm ${tFilter === 'regex' ? 'active' : ''}' data-action='ai-set-target-filter' data-filter='regex'>正则 (${regexCount})</button>
      <button type='button' class='td-chip sm ${tFilter === 'selected' ? 'active' : ''}' data-action='ai-set-target-filter' data-filter='selected' data-role='ai-target-selected-chip'>已选 (${ai.selectedKeys.size})</button>
    </div>` : '';

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
          ${targetFilterBarHtml}
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
      ${ai.lastError && !ai.loading ? `
        <div class='td-ai-error-bar'>
          <span class='td-ai-error-msg' title='${escapeHtml(ai.lastError.message)}'>上次请求失败：${escapeHtml(ai.lastError.message)}</span>
          <div class='td-ai-error-btns'>
            <button type='button' class='td-btn xs danger' data-action='ai-view-error'>查看报错与返回</button>
            <button type='button' class='td-btn xs' data-action='ai-copy-error'>复制</button>
            <button type='button' class='td-icon-btn' data-action='ai-clear-error' title='清除错误提示' style='width:22px;height:22px;'>${ICONS.close}</button>
          </div>
        </div>` : ''}
      <div class='td-modal-foot'>
        <button class='td-btn' data-action='close-preview'>取消</button>
        ${Array.isArray(ai.results) && ai.results.length > 0 ? `<button type='button' class='td-btn warn' data-action='ai-goto-review' ${ai.loading ? 'disabled' : ''}>返回检视 (${ai.results.length})</button>` : ''}
        <button class='td-btn ${ai.loading ? 'danger' : 'primary'}' data-action='ai-run' title='${ai.loading ? '点击手动终止本次 AI 请求' : ''}'>${escapeHtml(getAiRunIdleLabel(ai))}</button>
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

function renderAiReviewNoteHtml(r, rIdx) {
  const note = typeof r?.note === 'string' ? r.note.trim() : '';
  if (!note) return '';
  const isLong = note.length > 90 || note.includes('\n');
  const expanded = !!r.noteExpanded;
  return `
    <div class='td-ai-note-box ${isLong && !expanded ? 'is-clamped' : ''}' data-ridx='${rIdx}'>
      <div class='td-ai-note-text'><strong class='td-ai-note-label'>AI 说明：</strong>${escapeHtml(note)}</div>
      ${isLong ? `<button type='button' class='td-ai-note-toggle' data-action='ai-toggle-note' data-ridx='${rIdx}'>${expanded ? '收起说明 ▴' : '展开全部 ▾'}</button>` : ''}
    </div>`;
}

export const aiAssistantUiModule = {
  renderSelectPopup(sp, selectLayerEl) {
    if (sp.type === 'aiErrorDetail') {
      const errInfo = state.previewCtx?.lastError;
      if (!errInfo) return false;
      const rawReply = String(errInfo.rawReply || '');
      selectLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>AI 请求报错详情</div>
            <div class='td-modal-head-actions'>
              <button type='button' class='td-icon-btn' data-action='ai-copy-error' title='复制报错与返回内容'>${ICONS.copy}</button>
              <button type='button' class='td-icon-btn' data-action='close-select-popup' title='关闭'>${ICONS.close}</button>
            </div>
          </div>
          <div class='td-modal-body'>
            <div class='td-field'>
              <div class='td-ai-sec-row'>
                <label class='td-label' style='margin:0;'>报错信息${errInfo.time ? ` (${escapeHtml(errInfo.time)})` : ''}</label>
                <button type='button' class='td-chip sm' data-action='ai-copy-err-msg'>复制报错</button>
              </div>
              <div class='td-code-block td-scroll' style='max-height:150px;overflow-y:auto;border-color:rgba(239,68,68,0.45);'>${escapeHtml(errInfo.message || '未知错误')}</div>
            </div>
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;min-height:180px;'>
              <div class='td-ai-sec-row'>
                <label class='td-label' style='margin:0;'>AI 返回的原始内容</label>
                <button type='button' class='td-chip sm' data-action='ai-copy-err-raw' ${rawReply ? '' : 'disabled'}>复制返回内容</button>
              </div>
              <textarea class='td-textarea td-scroll' readonly style='flex:1;min-height:180px;' placeholder='（AI 未返回任何文本内容，可能在接口响应前已失败）'>${escapeHtml(rawReply)}</textarea>
            </div>
          </div>
          <div class='td-modal-foot'>
            <button type='button' class='td-btn' data-action='ai-copy-error'>${ICONS.copy} 复制全部</button>
            <button type='button' class='td-btn primary' data-action='close-select-popup'>关闭</button>
          </div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }
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
                   <div style='font-size:12px;color:var(--td-text-muted);line-height:1.5;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;user-select:text;'>${escapeHtml(r.note.trim())}</div>
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
    if (sp.type === 'aiResultAttrEdit') {
      const pc = state.previewCtx;
      const r = pc?.results?.[sp.rIdx];
      if (!pc || !r || (pc.type !== 'pmAiEdit' && pc.type !== 'wbAiEdit')) return false;
      const isRegex = pc.type === 'pmAiEdit' && r.itemType === 'regex';
      const isPresetPrompt = pc.type === 'pmAiEdit' && !isRegex;

      const attrBodyHtml = isRegex
        ? buildRegexAttrFieldsHtml({
            source: r.newSource || r.oldRegex?.source || {},
            destination: r.newDestination || r.oldRegex?.destination || {},
            run_on_edit: r.newRunOnEdit !== undefined ? r.newRunOnEdit : (r.oldRegex?.run_on_edit ?? true),
            min_depth: r.newMinDepth !== undefined ? r.newMinDepth : (r.oldRegex?.min_depth ?? null),
            max_depth: r.newMaxDepth !== undefined ? r.newMaxDepth : (r.oldRegex?.max_depth ?? null),
            trim_strings: r.newTrimStrings !== undefined ? r.newTrimStrings : (r.oldRegex?.trim_strings || []),
          }, 'td-aire-r')
        : (isPresetPrompt
          ? `<div class='td-field'>
               <label class='td-label'>角色身份 (Role)</label>
               <select class='td-select' id='td-aire-role'>
                 <option value='system' ${r.newRole === 'system' ? 'selected' : ''}>System</option>
                 <option value='user' ${r.newRole === 'user' ? 'selected' : ''}>User</option>
                 <option value='assistant' ${r.newRole === 'assistant' ? 'selected' : ''}>Assistant</option>
               </select>
             </div>`
          : `<div class='td-field'>
               <label class='td-label'>主要关键词（逗号或换行分隔）</label>
               <input class='td-input' id='td-aire-keys' type='text' value='${escapeHtml(r.newKeys || '')}' />
             </div>`);

      selectLayerEl.innerHTML = `
        <div class='td-modal ${isRegex ? 'td-modal-tall' : 'td-modal-sm'}'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>编辑属性 · ${escapeHtml(r.newName || `结果 #${sp.rIdx + 1}`)}</div>
            <button type='button' class='td-icon-btn' data-action='close-select-popup' title='关闭'>${ICONS.close}</button>
          </div>
          <div class='td-modal-body'>
            <div style='display:flex;gap:8px;align-items:center;'>
              <div class='td-field' style='flex:1;'>
                <label class='td-label'>${isRegex ? '正则名称' : '条目名称'}</label>
                <input class='td-input' id='td-aire-name' type='text' value='${escapeHtml(r.newName || '')}' />
              </div>
              <div style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'>
                <input type='checkbox' class='td-checkbox' id='td-aire-enabled' ${r.newEnabled ? 'checked' : ''} /><span>启用</span>
              </div>
            </div>
            ${attrBodyHtml}
          </div>
          <div class='td-modal-foot'>
            <button type='button' class='td-btn' data-action='close-select-popup'>取消</button>
            <button type='button' class='td-btn primary' data-action='ai-edit-attr-save'>${ICONS.save} 保存属性</button>
          </div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (sp.type === 'aiResultContentEdit') {
      const pc = state.previewCtx;
      const r = pc?.results?.[sp.rIdx];
      if (!pc || !r || (pc.type !== 'pmAiEdit' && pc.type !== 'wbAiEdit')) return false;
      const isRegex = pc.type === 'pmAiEdit' && (sp.itemType === 'regex' || r.itemType === 'regex');
      sp.itemType = isRegex ? 'regex' : 'default';

      if (!Array.isArray(sp.history) || sp.history.length === 0) {
        sp.history = [{
          name: r.newName || '',
          findRegex: isRegex ? (r.newFindRegex || '') : '',
          content: isRegex ? (r.newReplaceString || '') : (r.newContent || ''),
        }];
        sp.historyIdx = 0;
      }
      const cur = sp.history[sp.historyIdx] || sp.history[0];

      selectLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>编辑内容 · ${escapeHtml(cur.name || `结果 #${sp.rIdx + 1}`)}</div>
            <div class='td-modal-head-actions'>
              <button type='button' class='td-icon-btn' data-action='ai-edit-undo' title='撤销 (后退)' ${sp.historyIdx <= 0 ? 'disabled' : ''}>${ICONS.undo}</button>
              <button type='button' class='td-icon-btn' data-action='ai-edit-redo' title='重做 (前进)' ${sp.historyIdx >= sp.history.length - 1 ? 'disabled' : ''}>${ICONS.redo}</button>
              <button type='button' class='td-icon-btn' data-action='ai-edit-copy' title='复制正文'>${ICONS.copy}</button>
              <button type='button' class='td-icon-btn' data-action='close-select-popup' title='关闭'>${ICONS.close}</button>
            </div>
          </div>
          <div class='td-modal-body'>
            <div class='td-field'>
              <label class='td-label'>${isRegex ? '正则名称' : '条目名称'}</label>
              <input class='td-input' id='td-aire-name' type='text' value='${escapeHtml(cur.name || '')}' />
            </div>
            ${isRegex ? `
              <div class='td-field'>
                <label class='td-label'>查找正则 (Find Regex)</label>
                <input class='td-input' id='td-aire-find-regex' type='text' value='${escapeHtml(cur.findRegex || '')}' />
              </div>` : ''}
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;min-height:170px;'>
              <label class='td-label'>${isRegex ? '替换为 (Replace String · 支持撤销/重做)' : '条目正文（支持撤销/重做）'}</label>
              ${renderQuickInsertHtml('td-aire-content')}
              ${renderSearchableTextareaHtml({ id: 'td-aire-content', value: cur.content || '', minHeight: '170px' })}
            </div>
          </div>
          <div class='td-modal-foot'>
            <button type='button' class='td-btn' data-action='close-select-popup'>取消</button>
            <button type='button' class='td-btn primary' data-action='ai-edit-content-save'>${ICONS.save} 保存内容</button>
          </div>
        </div>`;
      bindEditorSearchEvents(selectLayerEl);
      updateAiEditHistoryButtons(selectLayerEl, sp);
      uiCtx.syncOverlayBounds();
      return true;
    }
    return false;
  },

  onSnippetInsert(layerEl) {
    if (state.selectPopup?.type === 'aiResultContentEdit') {
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
          const isRegex = r.itemType === 'regex';
          const oldDiffTxt = isRegex
            ? (isAdd ? '' : `查找正则: ${r.oldRegex?.find_regex || ''}\n---\n${r.oldRegex?.replace_string || ''}`)
            : (isAdd ? '' : (r.oldPrompt?.content || ''));
          const newDiffTxt = isRegex
            ? `查找正则: ${r.newFindRegex || ''}\n---\n${r.newReplaceString || ''}`
            : (r.newContent || '');
          const lines = computeLineDiff(oldDiffTxt, newDiffTxt);
          const tagHtml = r.isAiNew
            ? "<span class='td-mode-tag ok'>AI 新增</span>"
            : (isAdd ? "<span class='td-mode-tag single'>新增写入</span>" : "<span class='td-mode-tag multi'>覆盖修改</span>");
          return `
            <div class='td-mgr-row ${r.accepted ? 'is-active' : ''}'>
              <div class='td-mgr-row-head is-wrap-head'>
                <div class='td-mgr-row-left' style='flex-wrap:wrap;row-gap:4px;'>
                  <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                  ${tagHtml}
                  ${isRegex ? "<span class='td-mode-tag single'>正则</span>" : ''}
                  ${r.manualEdited ? "<span class='td-mode-tag multi'>已手动编辑</span>" : ''}
                  ${!r.isAiNew ? `<span class='td-idx-badge'>#${r.index + 1}</span>` : ''}
                  <span class='td-mgr-row-title is-wrap' style='flex:1 1 130px;' title='${escapeHtml(r.newName)}'>${escapeHtml(r.newName)}</span>
                </div>
                <span class='td-src-badge'>${isRegex ? '预设正则' : escapeHtml(r.newRole)} · ${r.newEnabled ? '开' : '关'}</span>
              </div>
              ${renderAiReviewNoteHtml(r, rIdx)}
              <div class='td-mgr-row-actions'>
                <button type='button' class='td-btn sm primary' data-action='ai-edit-result-content' data-ridx='${rIdx}'>${ICONS.eye} 编辑内容</button>
                <button type='button' class='td-btn sm' data-action='ai-edit-result-attrs' data-ridx='${rIdx}'>${ICONS.edit} 属性</button>
                ${isRegex ? `<button type='button' class='td-btn sm' data-action='ai-test-regex' data-ridx='${rIdx}'>测试</button>` : ''}
                ${!r.isAiNew ? `<button type='button' class='td-btn sm ${isAdd ? 'warn' : ''}' data-action='ai-toggle-write-mode' data-ridx='${rIdx}'>${isAdd ? '切换为覆盖原条目' : '新增条目写入'}</button>` : ''}
                ${isAdd && !isRegex ? `<button type='button' class='td-btn sm' data-action='ai-toggle-target-list' data-ridx='${rIdx}'>目标: ${r.targetList === 'prompts_unused' ? '未添加池' : '主列表'}</button>` : ''}
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
      const rList = Array.isArray(state.modal.regexes) ? state.modal.regexes : [];
      const items = [
        ...pList.map((p, i) => ({ key: `prompts::${i}`, listName: 'prompts', index: i, label: `[主列表 #${i + 1}] ${p.name || p.id}` })),
        ...uList.map((p, i) => ({ key: `prompts_unused::${i}`, listName: 'prompts_unused', index: i, label: `[未添加 #${i + 1}] ${p.name || p.id}` })),
        ...rList.map((r, i) => ({ key: `regex::${i}`, listName: 'regex', index: i, label: `[正则 #${i + 1}] ${r.script_name || r.id}` })),
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
              <div class='td-mgr-row-head is-wrap-head'>
                <div class='td-mgr-row-left' style='flex-wrap:wrap;row-gap:4px;'>
                  <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                  ${tagHtml}
                  ${!r.isAiNew ? `<span class='td-idx-badge'>#${r.index + 1}</span>` : ''}
                  ${r.manualEdited ? "<span class='td-mode-tag multi'>已手动编辑</span>" : ''}
                  <span class='td-mgr-row-title is-wrap' style='flex:1 1 130px;' title='${escapeHtml(r.newName)}'>${escapeHtml(r.newName)}</span>
                </div>
                <span class='td-src-badge'>${r.newEnabled ? '开' : '关'}</span>
              </div>
              ${r.newKeys !== r.oldKeys && r.newKeys ? `<div style='font-size:11.5px;color:var(--td-single);word-break:break-word;overflow-wrap:anywhere;'>关键词：${escapeHtml(r.newKeys)}</div>` : ''}
              ${renderAiReviewNoteHtml(r, rIdx)}
              <div class='td-mgr-row-actions'>
                <button type='button' class='td-btn sm primary' data-action='ai-edit-result-content' data-ridx='${rIdx}'>${ICONS.eye} 编辑内容</button>
                <button type='button' class='td-btn sm' data-action='ai-edit-result-attrs' data-ridx='${rIdx}'>${ICONS.edit} 属性</button>
                ${!r.isAiNew ? `<button type='button' class='td-btn sm ${isAdd ? 'warn' : ''}' data-action='ai-toggle-write-mode' data-ridx='${rIdx}'>${isAdd ? '切换为覆盖原条目' : '新增条目写入'}</button>` : ''}
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

    if (handleAiRefClick(e, actionEl, action, {
      previewLayerEl,
      syncDraftInputs: syncAiPreviewDraftInputs,
      persistDraft: persistAiEditDraft,
    })) {
      return true;
    }
    if (action === 'ai-set-target-filter' && state.previewCtx?.type === 'pmAiEdit') {
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.targetFilter = actionEl.getAttribute('data-filter') || 'all';
      uiCtx.renderPreviewModal();
      return true;
    }

    if (action === 'ai-preview-item' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      e.stopPropagation();
      const k = actionEl.getAttribute('data-key') || '';
      if (state.previewCtx.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
        const [listName, idxStr] = k.split('::');
        if (listName === 'regex') {
          const r = state.modal.regexes?.[Number(idxStr)];
          if (!r) return true;
          state.selectPopup = {
            type: 'aiItemPreview',
            title: r.script_name || r.id,
            metas: [
              `预设正则 #${Number(idxStr) + 1}`,
              `状态: ${r.enabled ? '开启' : '关闭'}`,
              r.run_on_edit ? '编辑时运行' : '',
            ],
            content: `查找正则 (Find Regex):\n${r.find_regex || ''}\n\n替换为 (Replace String):\n${r.replace_string || ''}`,
          };
          uiCtx.renderSelectPopup();
          return true;
        }
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
      persistAiEditDraft(state.previewCtx);
      if (state.previewCtx.type === 'pmAiEdit' && state.previewCtx.targetFilter === 'selected') {
        uiCtx.renderPreviewModal();
        return true;
      }
      const labelEl = previewLayerEl?.querySelector("[data-role='ai-selected-label']");
      if (labelEl) labelEl.textContent = `待编辑条目 (已选 ${state.previewCtx.selectedKeys.size})`;
      const selChip = previewLayerEl?.querySelector("[data-role='ai-target-selected-chip']");
      if (selChip) selChip.textContent = `已选 (${state.previewCtx.selectedKeys.size})`;
      const clrBtn = previewLayerEl?.querySelector("[data-action='ai-clear-selected']");
      if (clrBtn) clrBtn.disabled = state.previewCtx.selectedKeys.size === 0;
      actionEl.closest('.td-picker-row')?.classList.toggle('checked', state.previewCtx.selectedKeys.has(k));
      return true;
    }
    if (action === 'ai-run' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      if (ai.loading) {
        if (Date.now() - (ai.startedAt || 0) < 350) return true;
        stopAiEditJob(ai);
        return true;
      }
      ensureAiSetupDefaults(ai);
      const cfg = saveSharedAiApiFieldsFromPreview(previewLayerEl);
      ai.instruction = previewLayerEl?.querySelector('#td-ai-instruction')?.value ?? ai.instruction;
      persistAiEditDraft(ai);

      const isPresetEdit = ai.type === 'pmAiEdit' && state.modal?.type === 'presetDetail';
      const isWbEdit = ai.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail';
      if (!isPresetEdit && !isWbEdit) return true;

      const selectedItems = [];
      if (isPresetEdit) {
        ['prompts', 'prompts_unused'].forEach((listName) => {
          (state.modal.data[listName] || []).forEach((p, idx) => {
            const uk = `${listName}::${idx}`;
            if (ai.selectedKeys.has(uk)) selectedItems.push({ itemType: 'prompt', uidKey: uk, listName, index: idx, prompt: p });
          });
        });
        (state.modal.regexes || []).forEach((r, idx) => {
          const uk = `regex::${idx}`;
          if (ai.selectedKeys.has(uk)) selectedItems.push({ itemType: 'regex', uidKey: uk, listName: 'regex', index: idx, regex: r });
        });
      } else {
        (state.modal.entries || []).forEach((entry, idx) => {
          if (ai.selectedKeys.has(String(idx))) selectedItems.push({ index: idx, entry });
        });
      }

      const draftKey = ai.draftKey || getAiDraftKey(ai.type);
      ai.draftKey = draftKey;
      ai.lastError = null;
      ai.loading = true;
      ai.startedAt = Date.now();
      ai._abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      ai._generationId = `td_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

      const job = {
        draftKey,
        type: ai.type,
        aiCtx: ai,
        modalSnapshot: state.modal,
        cancelled: false,
        timerId: null,
      };
      getAiJobsMap().set(draftKey, job);
      startAiJobTimer(job);
      uiCtx.renderPreviewModal();

      const runner = isPresetEdit ? runAiPresetEdit : runAiWorldbookEdit;
      const errPrefix = isPresetEdit ? 'AI 编辑预设失败' : 'AI 编辑世界书失败';

      resolveAllSelectedReferenceItems(ai)
        .then((referenceItems) => {
          if (job.cancelled) throw Object.assign(new Error('已手动终止 AI 生成'), { isAiAborted: true });
          return runner({
            selectedItems,
            referenceItems,
            instruction: ai.instruction,
            apiCfg: cfg,
            generationId: ai._generationId,
            signal: ai._abortController?.signal,
          });
        })
        .then(({ results, summary, rawReply }) => {
          stopAiJobTimer(job);
          if (job.cancelled) return;
          ai.loading = false;
          ai._abortController = null;
          ai._generationId = '';
          ai.lastError = null;
          ai.results = results;
          ai.summary = summary || '';
          ai.rawReply = rawReply || '';
          ai.step = 'review';
          presentCompletedAiJob(job);
          notify('success', `AI 处理完成，返回 ${results.length} 条结果`);
        })
        .catch((err) => {
          stopAiJobTimer(job);
          ai.loading = false;
          ai._abortController = null;
          ai._generationId = '';
          if (job.cancelled || err?.isAiAborted) {
            if (state.panelOpen && state.previewCtx === ai) uiCtx.renderPreviewModal();
            return;
          }
          const d = new Date();
          const pad = (n) => (n < 10 ? `0${n}` : String(n));
          ai.lastError = {
            message: err?.message || String(err),
            rawReply: typeof err?.rawReply === 'string' ? err.rawReply : '',
            time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
          };
          if (state.panelOpen && state.previewCtx === ai) uiCtx.renderPreviewModal();
          logError(errPrefix, err);
          notify('error', ai.lastError.message);
        });
      return true;
    }
    if (action === 'ai-view-error' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      if (!state.previewCtx.lastError) return true;
      state.selectPopup = { type: 'aiErrorDetail' };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'ai-clear-error' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      state.previewCtx.lastError = null;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-copy-error' && state.previewCtx?.lastError) {
      copyToClipboard(formatAiErrorCopyText(state.previewCtx.lastError))
        .then(() => notify('success', '报错信息与 AI 返回内容已复制'))
        .catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'ai-copy-err-msg' && state.previewCtx?.lastError) {
      copyToClipboard(state.previewCtx.lastError.message || '')
        .then(() => notify('success', '报错信息已复制'))
        .catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'ai-copy-err-raw' && state.previewCtx?.lastError) {
      copyToClipboard(state.previewCtx.lastError.rawReply || '')
        .then(() => notify('success', 'AI 返回内容已复制'))
        .catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'ai-toggle-note' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const rIdx = Number(actionEl.getAttribute('data-ridx'));
      const r = state.previewCtx.results?.[rIdx];
      if (!r) return true;
      r.noteExpanded = !r.noteExpanded;
      const box = actionEl.closest('.td-ai-note-box');
      if (box) {
        box.classList.toggle('is-clamped', !r.noteExpanded);
        actionEl.textContent = r.noteExpanded ? '收起说明 ▴' : '展开全部 ▾';
      } else {
        uiCtx.renderPreviewModal();
      }
      return true;
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
    if (action === 'ai-edit-result-content' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const rIdx = Number(actionEl.getAttribute('data-ridx'));
      const r = state.previewCtx.results?.[rIdx];
      if (!r) return true;
      state.selectPopup = {
        type: 'aiResultContentEdit',
        aiType: state.previewCtx.type,
        itemType: r.itemType === 'regex' ? 'regex' : 'default',
        rIdx,
        history: null,
        historyIdx: 0,
        timer: null,
      };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'ai-edit-result-attrs' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const rIdx = Number(actionEl.getAttribute('data-ridx'));
      const r = state.previewCtx.results?.[rIdx];
      if (!r) return true;
      state.selectPopup = {
        type: 'aiResultAttrEdit',
        aiType: state.previewCtx.type,
        itemType: r.itemType === 'regex' ? 'regex' : 'default',
        rIdx,
      };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'ai-test-regex' && state.previewCtx?.type === 'pmAiEdit') {
      const rIdx = Number(actionEl.getAttribute('data-ridx'));
      const r = state.previewCtx.results?.[rIdx];
      if (!r || r.itemType !== 'regex') return true;
      const ai = state.previewCtx;
      openRegexTestPreview({
        title: r.newName || 'AI 正则结果',
        findRegex: r.newFindRegex || '',
        replaceString: r.newReplaceString || '',
        trimStrings: r.newTrimStrings || r.oldRegex?.trim_strings || [],
        returnPreviewCtx: ai,
        onApplyBack: (next) => {
          r.newFindRegex = next.find_regex;
          r.newReplaceString = next.replace_string;
          r.manualEdited = true;
        },
      });
      return true;
    }
    if (action === 'ai-edit-undo' && state.selectPopup?.type === 'aiResultContentEdit') {
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
    if (action === 'ai-edit-redo' && state.selectPopup?.type === 'aiResultContentEdit') {
      const selectLayerEl = uiCtx.getSelectLayer();
      const sp = state.selectPopup;
      if (Array.isArray(sp.history) && sp.historyIdx < sp.history.length - 1) {
        sp.historyIdx++;
        applyAiResultEditSnapshot(selectLayerEl, sp, sp.history[sp.historyIdx]);
        updateAiEditHistoryButtons(selectLayerEl, sp);
      }
      return true;
    }
    if (action === 'ai-edit-copy' && state.selectPopup?.type === 'aiResultContentEdit') {
      const contentEl = uiCtx.getSelectLayer()?.querySelector('#td-aire-content');
      copyToClipboard(contentEl ? contentEl.value : '').then(() => notify('success', '正文已复制到剪贴板')).catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'ai-edit-content-save' && state.selectPopup?.type === 'aiResultContentEdit') {
      const selectLayerEl = uiCtx.getSelectLayer();
      const sp = state.selectPopup;
      pushAiEditSnapshot(selectLayerEl, sp, true);
      const snap = readAiResultEditSnapshot(selectLayerEl, sp.itemType);
      const r = state.previewCtx?.results?.[sp.rIdx];
      if (r) {
        if (snap.name.trim()) r.newName = snap.name.trim();
        if (sp.aiType === 'pmAiEdit' && r.itemType === 'regex') {
          r.newFindRegex = snap.findRegex;
          r.newReplaceString = snap.content;
        } else {
          r.newContent = snap.content;
        }
        r.manualEdited = true;
      }
      if (sp.timer) { clearTimeout(sp.timer); sp.timer = null; }
      state.selectPopup = null;
      uiCtx.renderSelectPopup();
      uiCtx.renderPreviewModal();
      notify('success', `已更新检视内容「${r?.newName || ''}」`);
      return true;
    }
    if (action === 'ai-edit-attr-save' && state.selectPopup?.type === 'aiResultAttrEdit') {
      const selectLayerEl = uiCtx.getSelectLayer();
      const sp = state.selectPopup;
      const r = state.previewCtx?.results?.[sp.rIdx];
      if (r) {
        const nameVal = (selectLayerEl?.querySelector('#td-aire-name')?.value ?? '').trim();
        if (nameVal) r.newName = nameVal;
        r.newEnabled = !!selectLayerEl?.querySelector('#td-aire-enabled')?.checked;
        if (sp.aiType === 'pmAiEdit' && r.itemType === 'regex') {
          const attrs = readRegexAttrFields(selectLayerEl, 'td-aire-r');
          r.newSource = attrs.source;
          r.newDestination = attrs.destination;
          r.newRunOnEdit = attrs.run_on_edit;
          r.newMinDepth = attrs.min_depth;
          r.newMaxDepth = attrs.max_depth;
          r.newTrimStrings = attrs.trim_strings;
        } else if (sp.aiType === 'pmAiEdit') {
          const roleVal = selectLayerEl?.querySelector('#td-aire-role')?.value || 'system';
          r.newRole = ['system', 'user', 'assistant'].includes(roleVal) ? roleVal : 'system';
        } else if (sp.aiType === 'wbAiEdit') {
          r.newKeys = selectLayerEl?.querySelector('#td-aire-keys')?.value ?? '';
        }
        r.manualEdited = true;
      }
      state.selectPopup = null;
      uiCtx.renderSelectPopup();
      uiCtx.renderPreviewModal();
      notify('success', `已更新检视属性「${r?.newName || ''}」`);
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
        const addedByList = { prompts: [], prompts_unused: [], regex: [] };
        (state.previewCtx.results || []).forEach((r) => {
          if (!r.accepted) return;
          if (r.itemType === 'regex') {
            if (r.writeMode === 'add') {
              const newReg = buildDefaultPresetRegex({
                script_name: r.newName,
                enabled: r.newEnabled,
                find_regex: r.newFindRegex || '',
                replace_string: r.newReplaceString || '',
                source: r.newSource,
                destination: r.newDestination,
                run_on_edit: r.newRunOnEdit,
                min_depth: r.newMinDepth,
                max_depth: r.newMaxDepth,
                trim_strings: r.newTrimStrings,
              });
              addedByList.regex.push(newReg);
              added++;
            } else {
              const target = state.modal.regexes?.[r.index]; if (!target) return;
              target.script_name = r.newName;
              target.enabled = !!r.newEnabled;
              target.find_regex = r.newFindRegex ?? '';
              target.replace_string = r.newReplaceString ?? '';
              if (r.newSource) target.source = JSON.parse(JSON.stringify(r.newSource));
              if (r.newDestination) target.destination = JSON.parse(JSON.stringify(r.newDestination));
              if (r.newRunOnEdit !== undefined) target.run_on_edit = !!r.newRunOnEdit;
              if (r.newMinDepth !== undefined) target.min_depth = r.newMinDepth;
              if (r.newMaxDepth !== undefined) target.max_depth = r.newMaxDepth;
              if (Array.isArray(r.newTrimStrings)) target.trim_strings = r.newTrimStrings.slice();
              updated++;
            }
            return;
          }
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
        if (addedByList.regex.length > 0) {
          state.modal.regexes = Array.isArray(state.modal.regexes) ? state.modal.regexes : [];
          state.modal.regexes.unshift(...addedByList.regex);
          state.modal.tab = 'regex';
        }
        if (updated + added > 0) state.modal.dirty = true;
        if (state.previewCtx.draftKey) getAiJobsMap().delete(state.previewCtx.draftKey);
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
        if (state.previewCtx.draftKey) getAiJobsMap().delete(state.previewCtx.draftKey);
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
    if (state.selectPopup?.type === 'aiResultContentEdit' && ['td-aire-name', 'td-aire-find-regex', 'td-aire-content'].includes(id)) {
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

    if (handleAiRefChange(target, { syncDraftInputs: syncAiPreviewDraftInputs })) {
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
