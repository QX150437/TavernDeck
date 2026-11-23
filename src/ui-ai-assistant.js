import {
  escapeHtml, notify, computeLineDiff, formatKeysInput, parseKeysInput,
  hasTH, callTH, getST, genId, logWarn, logError,
} from './utils.js';
import { state, saveStore } from './store.js';
import { PRESET_SYSTEM_IDS, buildNewPromptEntry } from './preset-manager.js';
import { buildDefaultWorldbookEntry } from './worldbook-manager.js';
import {
  runAiPresetEdit, runAiWorldbookEdit,
  getAvailableApiTargets, fetchModelsForApiTarget, normalizeApiTargetValue,
} from './ai-preset-edit.js';
import { ICONS, uiCtx, openConfirm } from './ui-common.js';

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

function renderReferencePickerHtml(ai, items, itemLabelFn) {
  const refOpen = !!ai.refExpanded;
  const rq = (ai.refSearch || '').trim().toLowerCase();
  const visible = refOpen ? items.filter((it) => !rq || itemLabelFn(it).toLowerCase().includes(rq)) : [];

  return `
    <div class='td-ai-ref-box'>
      <div class='td-ai-ref-head'>
        <span class='td-ai-compact-summary' data-role='ai-ref-summary'>参考条目（默认折叠 · 已选 ${ai.refSelectedKeys.size} 项）</span>
        <button type='button' class='td-chip sm ${refOpen ? 'active' : ''}' data-action='ai-toggle-ref-box'>${refOpen ? '收起参考' : '展开参考'}</button>
      </div>
      ${refOpen ? `
        <div class='td-ai-ref-body'>
          <div style='display:flex;gap:5px;align-items:center;'>
            <input class='td-input' id='td-ai-ref-search' type='text' placeholder='筛选参考条目...' value='${escapeHtml(ai.refSearch || '')}' style='flex:1;height:28px;font-size:12px;' />
            <button type='button' class='td-chip sm' data-action='ai-ref-select-enabled'>全选启用</button>
            <button type='button' class='td-chip sm' data-action='ai-ref-clear'>清空</button>
          </div>
          <div class='td-picker-list td-scroll' style='max-height:160px;min-height:80px;border:1px solid var(--td-border);border-radius:9px;padding:5px;'>
            ${visible.map((it) => {
              const checked = ai.refSelectedKeys.has(it.key);
              return `
                <div class='td-picker-row ${checked ? 'checked' : ''}' style='min-height:34px;padding:5px 8px;'>
                  <label class='td-picker-left' style='cursor:pointer;'>
                    <input type='checkbox' class='td-checkbox' data-action='ai-toggle-ref' data-key='${escapeHtml(it.key)}' ${checked ? 'checked' : ''} />
                    <span class='td-item-name' style='font-size:12.5px;' title='${escapeHtml(itemLabelFn(it))}'>${escapeHtml(itemLabelFn(it))}</span>
                  </label>
                  <button type='button' class='td-icon-btn' data-action='ai-preview-item' data-key='${escapeHtml(it.key)}' title='预览条目内容'>${ICONS.eye}</button>
                </div>`;
            }).join('') || "<div class='td-group-empty'>无匹配参考条目</div>"}
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
        ${renderReferencePickerHtml(ai, items, itemLabelFn)}
        <div class='td-field' style='flex-shrink:0;gap:5px;'>
          <div class='td-ai-sec-row'>
            <label class='td-label' style='margin:0;'>修改 / 生成指令</label>
            <button type='button' class='td-chip sm ${ai.tplExpanded ? 'active' : ''}' data-action='ai-toggle-tpl-box'>指令模板 (${templates.length}) ${ai.tplExpanded ? '▴' : '▾'}</button>
          </div>
          ${ai.tplExpanded ? renderInstructionTemplatesHtml(ai, templates) : ''}
          <textarea class='td-textarea' id='td-ai-instruction' style='min-height:52px;height:56px;padding:7px 10px;font-size:13px;font-family:inherit;' placeholder='输入修改指令，或展开右上角指令模板；若仅选参考条目，可要求 AI 新增条目...'>${escapeHtml(ai.instruction || '')}</textarea>
        </div>
        <div class='td-field' style='flex:1;min-height:${anySubExpanded ? '200px' : '0'};display:flex;flex-direction:column;gap:5px;'>
          <div class='td-ai-sec-row'>
            <div style='display:flex;align-items:center;gap:5px;min-width:0;'>
              <label class='td-label' data-role='ai-selected-label' style='margin:0;white-space:nowrap;'>待编辑条目 (已选 ${ai.selectedKeys.size})</label>
              ${ai.selectedKeys.size > 0 ? `<button type='button' class='td-chip sm' data-action='ai-clear-selected'>清空</button>` : ''}
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
                  <label class='td-picker-left' style='cursor:pointer;'>
                    <input type='checkbox' class='td-checkbox' data-action='ai-toggle-item' data-key='${escapeHtml(it.key)}' ${checked ? 'checked' : ''} />
                    <span class='td-item-name' style='font-size:13px;' title='${escapeHtml(itemLabelFn(it))}'>${escapeHtml(itemLabelFn(it))}</span>
                  </label>
                  <button type='button' class='td-icon-btn' data-action='ai-preview-item' data-key='${escapeHtml(it.key)}' title='预览条目内容'>${ICONS.eye}</button>
                </div>`;
            }).join('') || "<div class='td-group-empty'>无匹配条目</div>"}
          </div>
        </div>
      </div>
      <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='ai-run' ${ai.loading ? 'disabled' : ''}>${ai.loading ? 'AI 处理中，请稍候...' : '发送给 AI 编辑'}</button></div>
    </div>`;
}

export function setAiRunBtnLoading(previewLayerEl, loading, selector = "[data-action='ai-run']", idleText = '发送给 AI 编辑') {
  const btn = previewLayerEl?.querySelector(selector);
  if (!btn) return;
  btn.disabled = !!loading;
  btn.textContent = loading ? 'AI 处理中，请稍候...' : idleText;
}

export const aiAssistantUiModule = {
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
                <label style='display:flex;align-items:center;gap:6px;min-width:0;flex:1;cursor:pointer;'>
                  <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                  ${tagHtml}
                  ${!r.isAiNew ? `<span class='td-idx-badge'>#${r.index + 1}</span>` : ''}
                  <span class='td-mgr-row-title' title='${escapeHtml(r.newName)}'>${escapeHtml(r.newName)}</span>
                </label>
                <span class='td-src-badge'>${escapeHtml(r.newRole)} · ${r.newEnabled ? '开' : '关'}</span>
              </div>
              <div style='display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;'>
                ${r.note ? `<span style='font-size:11.5px;color:var(--td-text-muted);flex:1;'>AI 说明：${escapeHtml(r.note)}</span>` : '<span></span>'}
                <div style='display:flex;gap:4px;flex-shrink:0;'>
                  ${!r.isAiNew ? `<button type='button' class='td-btn sm ${isAdd ? 'warn' : ''}' data-action='ai-toggle-write-mode' data-ridx='${rIdx}'>${isAdd ? '切换为覆盖原条目' : '新增条目写入'}</button>` : ''}
                  ${isAdd ? `<button type='button' class='td-btn sm' data-action='ai-toggle-target-list' data-ridx='${rIdx}'>目标: ${r.targetList === 'prompts_unused' ? '未添加池' : '主列表'}</button>` : ''}
                </div>
              </div>
              <div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>
            </div>`;
        }).join('');

        previewLayerEl.classList.add('is-open');
        previewLayerEl.innerHTML = `
          <div class='td-modal td-modal-tall'>
            <div class='td-modal-head'><div class='td-modal-title'>检视 AI 结果 (${acceptedList.length}/${(ai.results || []).length})</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='aiEdit' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div></div>
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
                <label style='display:flex;align-items:center;gap:6px;min-width:0;flex:1;cursor:pointer;'>
                  <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                  ${tagHtml}
                  ${!r.isAiNew ? `<span class='td-idx-badge'>#${r.index + 1}</span>` : ''}
                  <span class='td-mgr-row-title' title='${escapeHtml(r.newName)}'>${escapeHtml(r.newName)}</span>
                </label>
                <span class='td-src-badge'>${r.newEnabled ? '开' : '关'}</span>
              </div>
              ${r.newKeys !== r.oldKeys && r.newKeys ? `<div style='font-size:11.5px;color:var(--td-single);'>关键词：${escapeHtml(r.newKeys)}</div>` : ''}
              <div style='display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;'>
                ${r.note ? `<span style='font-size:11.5px;color:var(--td-text-muted);flex:1;'>AI 说明：${escapeHtml(r.note)}</span>` : '<span></span>'}
                ${!r.isAiNew ? `<button type='button' class='td-btn sm ${isAdd ? 'warn' : ''}' data-action='ai-toggle-write-mode' data-ridx='${rIdx}'>${isAdd ? '切换为覆盖原条目' : '新增条目写入'}</button>` : ''}
              </div>
              <div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>
            </div>`;
        }).join('');

        previewLayerEl.classList.add('is-open');
        previewLayerEl.innerHTML = `
          <div class='td-modal td-modal-tall'>
            <div class='td-modal-head'><div class='td-modal-title'>检视 AI 世界书结果 (${acceptedList.length}/${(ai.results || []).length})</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='aiEdit' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div></div>
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
    if (action === 'ai-clear-selected' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.selectedKeys.clear();
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-clear-search' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.search = '';
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-toggle-ref' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      ensureAiSetupDefaults(state.previewCtx);
      const k = actionEl.getAttribute('data-key');
      if (state.previewCtx.refSelectedKeys.has(k)) state.previewCtx.refSelectedKeys.delete(k);
      else state.previewCtx.refSelectedKeys.add(k);
      const sumEl = previewLayerEl?.querySelector("[data-role='ai-ref-summary']");
      if (sumEl) sumEl.textContent = `给 AI 参考的条目（默认折叠 · 已选 ${state.previewCtx.refSelectedKeys.size} 项）`;
      actionEl.closest('.td-picker-row')?.classList.toggle('checked', state.previewCtx.refSelectedKeys.has(k));
      return true;
    }
    if (action === 'ai-ref-select-enabled' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      ensureAiSetupDefaults(state.previewCtx);
      if (state.previewCtx.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
        ['prompts', 'prompts_unused'].forEach((ln) => {
          (state.modal.data[ln] || []).forEach((p, idx) => {
            if (p?.enabled) state.previewCtx.refSelectedKeys.add(`${ln}::${idx}`);
          });
        });
      } else if (state.previewCtx.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
        (state.modal.entries || []).forEach((ent, idx) => {
          if (ent?.enabled) state.previewCtx.refSelectedKeys.add(String(idx));
        });
      }
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'ai-ref-clear' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      ensureAiSetupDefaults(state.previewCtx);
      state.previewCtx.refSelectedKeys.clear();
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
      actionEl.closest('.td-picker-row')?.classList.toggle('checked', state.previewCtx.selectedKeys.has(k));
      return true;
    }
    if (action === 'ai-run' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      if (ai.loading) return true;
      ensureAiSetupDefaults(ai);
      const cfg = saveSharedAiApiFieldsFromPreview(previewLayerEl);
      ai.instruction = previewLayerEl?.querySelector('#td-ai-instruction')?.value ?? ai.instruction;

      if (ai.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
        const selectedItems = [];
        const referenceItems = [];
        ['prompts', 'prompts_unused'].forEach((listName) => {
          (state.modal.data[listName] || []).forEach((p, idx) => {
            const uk = `${listName}::${idx}`;
            if (ai.selectedKeys.has(uk)) selectedItems.push({ uidKey: uk, listName, index: idx, prompt: p });
            if (ai.refSelectedKeys.has(uk)) referenceItems.push({ uidKey: uk, listName, index: idx, prompt: p });
          });
        });
        ai.loading = true;
        setAiRunBtnLoading(previewLayerEl, true);
        runAiPresetEdit({ selectedItems, referenceItems, instruction: ai.instruction, apiCfg: cfg }).then(({ results }) => {
          ai.loading = false; ai.results = results; ai.step = 'review'; uiCtx.renderPreviewModal();
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
        const referenceItems = [];
        (state.modal.entries || []).forEach((entry, idx) => {
          if (ai.selectedKeys.has(String(idx))) selectedItems.push({ index: idx, entry });
          if (ai.refSelectedKeys.has(String(idx))) referenceItems.push({ index: idx, entry });
        });
        ai.loading = true;
        setAiRunBtnLoading(previewLayerEl, true);
        runAiWorldbookEdit({ selectedItems, referenceItems, instruction: ai.instruction, apiCfg: cfg }).then(({ results }) => {
          ai.loading = false; ai.results = results; ai.step = 'review'; uiCtx.renderPreviewModal();
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
    if (id === 'td-ai-instruction' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) { state.previewCtx.instruction = target.value; return true; }
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
