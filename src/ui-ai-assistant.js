import {
  escapeHtml, notify, computeLineDiff, formatKeysInput, parseKeysInput,
  hasTH, callTH, getST, logWarn, logError,
} from './utils.js';
import { state, saveStore } from './store.js';
import { PRESET_SYSTEM_IDS } from './preset-manager.js';
import {
  runAiPresetEdit, runAiWorldbookEdit,
  getAvailableApiTargets, fetchModelsForApiTarget, normalizeApiTargetValue,
} from './ai-preset-edit.js';
import { ICONS, uiCtx } from './ui-common.js';

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
    if (instrEl) pc.instruction = instrEl.value;
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
    <div style='display:flex;flex-direction:column;gap:8px;padding:7px 10px;border-radius:10px;background:var(--td-surface);border:1px solid var(--td-border);flex-shrink:0;'>
      <div style='display:flex;align-items:center;justify-content:space-between;gap:8px;'>
        <span style='font-size:12px;color:var(--td-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;' title='${escapeHtml(summary)}'>${escapeHtml(summary)}</span>
        <button type='button' class='td-chip ${expanded ? 'active' : ''}' data-action='ai-toggle-api-box'>${expanded ? '收起配置' : '配置 API'}</button>
      </div>
      ${expanded ? renderSharedAiApiFieldsHtml() : ''}
    </div>`;
}

function renderAiEditSetupHtml({ title, ai, items, itemLabelFn }) {
  const q = (ai.search || '').trim().toLowerCase();
  const visible = items.filter((it) => !q || itemLabelFn(it).toLowerCase().includes(q));
  const expanded = !!ai.apiExpanded;

  return `
    <div class='td-modal td-modal-tall'>
      <div class='td-modal-head'><div class='td-modal-title'>${escapeHtml(title)}</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
      <div class='td-modal-body ${expanded ? '' : 'td-picker-body'}'>
        ${renderCollapsibleAiApiBoxHtml(ai)}
        <div class='td-field' style='flex-shrink:0;'><label class='td-label'>修改指令</label><textarea class='td-textarea' id='td-ai-instruction' style='min-height:60px;height:66px;font-family:inherit;' placeholder='输入修改指令...'>${escapeHtml(ai.instruction || '')}</textarea></div>
        <div class='td-field' style='flex:1;min-height:${expanded ? '200px' : '0'};display:flex;flex-direction:column;'>
          <div style='display:flex;justify-content:space-between;align-items:center;gap:6px;flex-shrink:0;'>
            <label class='td-label' data-role='ai-selected-label'>勾选待编辑条目 (已选 ${ai.selectedKeys.size} 项)</label>
            <input class='td-input' id='td-ai-search' type='text' placeholder='筛选...' value='${escapeHtml(ai.search || '')}' style='width:140px;height:28px;font-size:12px;' />
          </div>
          <div class='td-picker-list td-scroll' style='border:1px solid var(--td-border);border-radius:10px;padding:6px;min-height:140px;'>
            ${visible.map((it) => {
              const checked = ai.selectedKeys.has(it.key);
              return `
                <div class='td-picker-row ${checked ? 'checked' : ''}' style='min-height:38px;padding:6px 10px;'>
                  <label class='td-picker-left' style='cursor:pointer;'>
                    <input type='checkbox' class='td-checkbox' data-action='ai-toggle-item' data-key='${escapeHtml(it.key)}' ${checked ? 'checked' : ''} />
                    <span class='td-item-name' title='${escapeHtml(itemLabelFn(it))}'>${escapeHtml(itemLabelFn(it))}</span>
                  </label>
                  <button type='button' class='td-icon-btn' data-action='ai-preview-item' data-key='${escapeHtml(it.key)}' title='预览条目内容'>${ICONS.eye}</button>
                </div>`;
            }).join('')}
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
        const reviewRows = (ai.results || []).map((r, rIdx) => {
          const lines = computeLineDiff(r.oldPrompt?.content || '', r.newContent || '');
          return `
            <div class='td-mgr-row ${r.accepted ? 'is-active' : ''}'>
              <div class='td-mgr-row-head'>
                <label style='display:flex;align-items:center;gap:8px;min-width:0;flex:1;cursor:pointer;'>
                  <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                  <span class='td-idx-badge'>#${r.index + 1}</span>
                  <span class='td-mgr-row-title'>${escapeHtml(r.newName)}</span>
                </label>
                <span class='td-src-badge'>${escapeHtml(r.newRole)} · ${r.newEnabled ? '开' : '关'}</span>
              </div>
              ${r.note ? `<div style='font-size:11.5px;color:var(--td-text-muted);'>AI 说明：${escapeHtml(r.note)}</div>` : ''}
              <div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>
            </div>`;
        }).join('');

        previewLayerEl.classList.add('is-open');
        previewLayerEl.innerHTML = `
          <div class='td-modal td-modal-tall'>
            <div class='td-modal-head'><div class='td-modal-title'>检视 AI 修改结果 (${(ai.results || []).filter((x) => x.accepted).length}/${(ai.results || []).length})</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
            <div class='td-modal-body td-picker-body'><div class='td-picker-list td-scroll'>${reviewRows}</div></div>
            <div class='td-modal-foot'><button class='td-btn' data-action='ai-back-setup'>返回修改需求</button><button class='td-btn primary' data-action='ai-apply-results'>${ICONS.check} 写回已勾选条目</button></div>
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
        const reviewRows = (ai.results || []).map((r, rIdx) => {
          const lines = computeLineDiff(r.oldContent || '', r.newContent || '');
          return `
            <div class='td-mgr-row ${r.accepted ? 'is-active' : ''}'>
              <div class='td-mgr-row-head'>
                <label style='display:flex;align-items:center;gap:8px;min-width:0;flex:1;cursor:pointer;'>
                  <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                  <span class='td-idx-badge'>#${r.index + 1}</span>
                  <span class='td-mgr-row-title'>${escapeHtml(r.newName)}</span>
                </label>
                <span class='td-src-badge'>${r.newEnabled ? '开' : '关'}</span>
              </div>
              ${r.newKeys !== r.oldKeys ? `<div style='font-size:11.5px;color:var(--td-single);'>关键词：${escapeHtml(r.newKeys)}</div>` : ''}
              ${r.note ? `<div style='font-size:11.5px;color:var(--td-text-muted);'>AI 说明：${escapeHtml(r.note)}</div>` : ''}
              <div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>
            </div>`;
        }).join('');

        previewLayerEl.classList.add('is-open');
        previewLayerEl.innerHTML = `
          <div class='td-modal td-modal-tall'>
            <div class='td-modal-head'><div class='td-modal-title'>检视 AI 世界书修改 (${(ai.results || []).filter((x) => x.accepted).length}/${(ai.results || []).length})</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
            <div class='td-modal-body td-picker-body'><div class='td-picker-list td-scroll'>${reviewRows}</div></div>
            <div class='td-modal-foot'><button class='td-btn' data-action='ai-back-setup'>返回修改需求</button><button class='td-btn primary' data-action='ai-apply-results'>${ICONS.check} 写回已勾选条目</button></div>
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
    if (action === 'ai-toggle-item' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const k = actionEl.getAttribute('data-key');
      if (state.previewCtx.selectedKeys.has(k)) state.previewCtx.selectedKeys.delete(k);
      else state.previewCtx.selectedKeys.add(k);
      const labelEl = previewLayerEl?.querySelector("[data-role='ai-selected-label']");
      if (labelEl) labelEl.textContent = `3. 勾选待编辑条目 (已选 ${state.previewCtx.selectedKeys.size} 项)`;
      actionEl.closest('.td-picker-row')?.classList.toggle('checked', state.previewCtx.selectedKeys.has(k));
      return true;
    }
    if (action === 'ai-run' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      const ai = state.previewCtx;
      if (ai.loading) return true;
      const cfg = saveSharedAiApiFieldsFromPreview(previewLayerEl);
      ai.instruction = previewLayerEl?.querySelector('#td-ai-instruction')?.value ?? ai.instruction;

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
        runAiPresetEdit({ selectedItems, instruction: ai.instruction, apiCfg: cfg }).then(({ results }) => {
          ai.loading = false; ai.results = results; ai.step = 'review'; uiCtx.renderPreviewModal();
          notify('success', `AI 编辑完成，返回 ${results.length} 条修改建议`);
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
        runAiWorldbookEdit({ selectedItems, instruction: ai.instruction, apiCfg: cfg }).then(({ results }) => {
          ai.loading = false; ai.results = results; ai.step = 'review'; uiCtx.renderPreviewModal();
          notify('success', `AI 编辑完成，返回 ${results.length} 条修改建议`);
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
    if (action === 'ai-back-setup' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      state.previewCtx.step = 'setup'; uiCtx.renderPreviewModal(); return true;
    }
    if (action === 'ai-apply-results' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
      let applied = 0;
      if (state.previewCtx.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
        (state.previewCtx.results || []).forEach((r) => {
          if (!r.accepted) return;
          const target = state.modal.data[r.listName]?.[r.index]; if (!target) return;
          target.name = r.newName; target.role = r.newRole; target.enabled = r.newEnabled;
          if (typeof target.content === 'string' || r.newContent.length > 0 || !PRESET_SYSTEM_IDS.has(target.id)) target.content = r.newContent;
          applied++;
        });
        if (applied > 0) state.modal.dirty = true;
        state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
        notify('success', `已将 ${applied} 个 AI 修改结果写回预设草稿（请点击「保存预设」持久化）`);
        return true;
      }
      if (state.previewCtx.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
        (state.previewCtx.results || []).forEach((r) => {
          if (!r.accepted) return;
          const target = state.modal.entries?.[r.index]; if (!target) return;
          target.name = r.newName; target.enabled = r.newEnabled; target.content = r.newContent;
          target.strategy = target.strategy || { type: 'selective', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' };
          target.strategy.keys = parseKeysInput(r.newKeys);
          applied++;
        });
        if (applied > 0) state.modal.dirty = true;
        state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
        notify('success', `已将 ${applied} 个 AI 修改结果写回世界书草稿（请点击「保存世界书」持久化）`);
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
