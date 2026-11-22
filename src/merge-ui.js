import {
  escapeHtml, notify, computeSideLineDiffs, cloneWorldbookEntry,
  formatKeysInput, parseKeysInput, keysSignature,
} from './utils.js';
import { state, saveMergeDraft, clearMergeDraft } from './store.js';
import { WB_POSITION_OPTIONS, buildDefaultWorldbookEntry } from './worldbook-manager.js';

const WB_STYPE_LABELS = { selective: '绿灯(关键词)', constant: '蓝灯(常驻)', vectorized: '向量化' };
const WB_SEC_LOGIC_LABELS = { and_any: '任一包含', and_all: '全部包含', not_any: '全部不含', not_all: '非全含' };
const ROLE_LABELS = { system: 'System', user: 'User', assistant: 'Assistant' };

function formatPresetPositionText(p) {
  if (!p) return '—';
  if (!p.position) return '内置/默认';
  if (p.position.type === 'in_chat') {
    return `@D 深度${p.position.depth ?? 0} · 顺${p.position.order ?? 100}`;
  }
  return '相对位置';
}

function formatWbPositionText(e) {
  if (!e) return '—';
  const pos = e.position || {};
  const opt = WB_POSITION_OPTIONS.find((o) => o.v === pos.type);
  const label = opt ? opt.t : (pos.type || '角色定义之后');
  const depthInfo = pos.type === 'at_depth' ? `(${pos.role || 'system'} @D${pos.depth ?? 4})` : '';
  return `${label}${depthInfo} · 顺${pos.order ?? 100}`;
}

function formatWbRecursionText(e) {
  if (!e) return '—';
  const r = e.recursion || {};
  const parts = [
    `防被递归:${r.prevent_incoming ? '是' : '否'}`,
    `防递归他:${r.prevent_outgoing ? '是' : '否'}`,
  ];
  if (r.delay_until !== null && r.delay_until !== undefined) parts.push(`延迟:${r.delay_until}级`);
  return parts.join(' · ');
}

function formatWbEffectText(e) {
  if (!e) return '—';
  const ef = e.effect || {};
  return `黏:${ef.sticky ?? '-'} / 冷:${ef.cooldown ?? '-'} / 延:${ef.delay ?? '-'}`;
}

export function initPresetMergeCustomCtx(entry, options = {}) {
  const base = JSON.parse(JSON.stringify(
    entry.customPrompt || entry.newPrompt || entry.oldPrompt || {
      id: entry.id,
      name: entry.name,
      enabled: true,
      role: 'system',
      position: { type: 'relative' },
      content: '',
    },
  ));
  const oldText = entry.oldPrompt?.content || '';
  const newText = entry.newPrompt?.content || '';
  const defaultMergeVal = typeof base.content === 'string'
    ? base.content
    : (oldText === newText ? newText : `<<<<<<< 旧版本\n${oldText}\n=======\n${newText}\n>>>>>>> 新版本`);

  return {
    type: 'mergeCustom',
    entry,
    contentOnly: !!options.contentOnly,
    syncScroll: false,
    draft: {
      name: base.name || entry.name || '',
      enabled: base.enabled !== false,
      role: base.role || 'system',
      posType: base.position?.type === 'in_chat' ? 'in_chat' : 'relative',
      depth: base.position?.depth ?? 4,
      order: base.position?.order ?? 100,
      oldContent: oldText,
      newContent: newText,
      content: defaultMergeVal,
    },
  };
}

export function initWbMergeCustomCtx(entry, options = {}) {
  const base = cloneWorldbookEntry(
    entry.customEntry || entry.newEntry || entry.oldEntry || buildDefaultWorldbookEntry({ name: entry.name }),
  );
  const oldText = entry.oldEntry?.content || '';
  const newText = entry.newEntry?.content || '';
  const defaultContent = typeof base.content === 'string'
    ? base.content
    : (oldText === newText ? newText : `<<<<<<< 旧版本\n${oldText}\n=======\n${newText}\n>>>>>>> 新版本`);

  return {
    type: 'wbMergeCustom',
    entry,
    contentOnly: !!options.contentOnly,
    syncScroll: false,
    draft: {
      name: base.name || entry.name || '',
      enabled: !!base.enabled,
      stype: base.strategy?.type || 'selective',
      keys: formatKeysInput(base.strategy?.keys),
      secLogic: base.strategy?.keys_secondary?.logic || 'and_any',
      secKeys: formatKeysInput(base.strategy?.keys_secondary?.keys),
      scanDepth: base.strategy?.scan_depth === 'same_as_global' || base.strategy?.scan_depth === undefined
        ? ''
        : String(base.strategy.scan_depth),
      posType: base.position?.type || 'after_character_definition',
      role: base.position?.role || 'system',
      depth: base.position?.depth ?? 4,
      order: base.position?.order ?? 100,
      probability: base.probability ?? 100,
      sticky: base.effect?.sticky ?? '',
      cooldown: base.effect?.cooldown ?? '',
      delay: base.effect?.delay ?? '',
      preventIncoming: !!base.recursion?.prevent_incoming,
      preventOutgoing: !!base.recursion?.prevent_outgoing,
      delayUntil: base.recursion?.delay_until ?? '',
      oldContent: oldText,
      newContent: newText,
      content: defaultContent,
    },
  };
}

export function syncPresetMergeCustomDraft(previewLayerEl) {
  const ctx = state.previewCtx;
  if (!ctx || ctx.type !== 'mergeCustom' || !previewLayerEl) return;
  const d = ctx.draft;
  const q = (sel) => previewLayerEl.querySelector(sel);
  if (q('#td-merge-custom-name')) d.name = q('#td-merge-custom-name').value;
  if (q('#td-merge-custom-enabled')) d.enabled = !!q('#td-merge-custom-enabled').checked;
  if (q('#td-merge-custom-role')) d.role = q('#td-merge-custom-role').value;
  if (q('#td-merge-custom-postype')) d.posType = q('#td-merge-custom-postype').value;
  if (q('#td-merge-custom-depth')) d.depth = Number(q('#td-merge-custom-depth').value) || 0;
  if (q('#td-merge-custom-order')) d.order = Number(q('#td-merge-custom-order').value) || 0;
  if (q('#td-merge-old-content')) d.oldContent = q('#td-merge-old-content').value;
  if (q('#td-merge-new-content')) d.newContent = q('#td-merge-new-content').value;
  if (q('#td-merge-custom-content')) d.content = q('#td-merge-custom-content').value;
}

export function syncWbMergeCustomDraft(previewLayerEl) {
  const ctx = state.previewCtx;
  if (!ctx || ctx.type !== 'wbMergeCustom' || !previewLayerEl) return;
  const d = ctx.draft;
  const q = (sel) => previewLayerEl.querySelector(sel);
  if (q('#td-wbm-custom-name')) d.name = q('#td-wbm-custom-name').value;
  if (q('#td-wbm-custom-enabled')) d.enabled = !!q('#td-wbm-custom-enabled').checked;
  if (q('#td-wbm-custom-stype')) d.stype = q('#td-wbm-custom-stype').value;
  if (q('#td-wbm-custom-keys')) d.keys = q('#td-wbm-custom-keys').value;
  if (q('#td-wbm-custom-seclogic')) d.secLogic = q('#td-wbm-custom-seclogic').value;
  if (q('#td-wbm-custom-seckeys')) d.secKeys = q('#td-wbm-custom-seckeys').value;
  if (q('#td-wbm-custom-scandepth')) d.scanDepth = q('#td-wbm-custom-scandepth').value;
  if (q('#td-wbm-custom-postype')) d.posType = q('#td-wbm-custom-postype').value;
  if (q('#td-wbm-custom-role')) d.role = q('#td-wbm-custom-role').value;
  if (q('#td-wbm-custom-depth')) d.depth = Number(q('#td-wbm-custom-depth').value) || 0;
  if (q('#td-wbm-custom-order')) d.order = Number(q('#td-wbm-custom-order').value) || 0;
  if (q('#td-wbm-custom-prob')) d.probability = Number(q('#td-wbm-custom-prob').value ?? 100);
  if (q('#td-wbm-custom-sticky')) d.sticky = q('#td-wbm-custom-sticky').value;
  if (q('#td-wbm-custom-cooldown')) d.cooldown = q('#td-wbm-custom-cooldown').value;
  if (q('#td-wbm-custom-delay')) d.delay = q('#td-wbm-custom-delay').value;
  if (q('#td-wbm-custom-previn')) d.preventIncoming = !!q('#td-wbm-custom-previn').checked;
  if (q('#td-wbm-custom-prevout')) d.preventOutgoing = !!q('#td-wbm-custom-prevout').checked;
  if (q('#td-wbm-custom-delayuntil')) d.delayUntil = q('#td-wbm-custom-delayuntil').value;
  if (q('#td-wbm-old-content')) d.oldContent = q('#td-wbm-old-content').value;
  if (q('#td-wbm-new-content')) d.newContent = q('#td-wbm-new-content').value;
  if (q('#td-edit-content')) d.content = q('#td-edit-content').value;
}

function renderDiffLineHtml(lineObj, sideClass) {
  const clsList = ['td-hl-line'];
  if (lineObj.status === 'del') clsList.push('is-del');
  else if (lineObj.status === 'add') clsList.push('is-add');
  else if (lineObj.status === 'mod') clsList.push(sideClass);

  let inner = '';
  if (lineObj.status === 'mod' && Array.isArray(lineObj.spans)) {
    const tokCls = sideClass === 'is-mod-old' ? 'td-hl-tok-del' : 'td-hl-tok-add';
    inner = lineObj.spans.map((sp) => (
      sp.changed ? `<span class='${tokCls}'>${escapeHtml(sp.text)}</span>` : escapeHtml(sp.text)
    )).join('');
  } else {
    inner = escapeHtml(lineObj.text);
  }
  if (!inner) inner = '\u200b';
  return `<div class='${clsList.join(' ')}'>${inner}</div>`;
}

function renderLinesBackdrop(rawText, diffLines, sideClass) {
  const realLines = String(rawText || '').split('\n');
  let di = 0;
  return realLines.map((lineText) => {
    while (di < diffLines.length && diffLines[di].text !== lineText) di++;
    const matched = di < diffLines.length ? diffLines[di++] : { text: lineText, status: 'ctx' };
    return renderDiffLineHtml(matched, sideClass);
  }).join('');
}

function syncBackdropScroll(ta, bd) {
  if (!ta || !bd) return;
  bd.scrollTop = ta.scrollTop;
  bd.scrollLeft = ta.scrollLeft;
}

export function applyMergeCustomSideDiffs(previewLayerEl) {
  if (!previewLayerEl || !state.previewCtx) return;
  const ctx = state.previewCtx;
  const isPreset = ctx.type === 'mergeCustom';
  const oldTa = previewLayerEl.querySelector(isPreset ? '#td-merge-old-content' : '#td-wbm-old-content');
  const newTa = previewLayerEl.querySelector(isPreset ? '#td-merge-new-content' : '#td-wbm-new-content');
  const oldBd = previewLayerEl.querySelector('#td-merge-old-bd');
  const newBd = previewLayerEl.querySelector('#td-merge-new-bd');
  if (!oldTa || !newTa || !oldBd || !newBd) return;

  const { oldLines, newLines } = computeSideLineDiffs(oldTa.value, newTa.value);
  oldBd.innerHTML = renderLinesBackdrop(oldTa.value, oldLines, 'is-mod-old');
  newBd.innerHTML = renderLinesBackdrop(newTa.value, newLines, 'is-mod-new');
  syncBackdropScroll(oldTa, oldBd);
  syncBackdropScroll(newTa, newBd);
}

function renderHlEditorHtml({ wrapClass, backdropId, textareaId, value, placeholder }) {
  return `
    <div class='td-hl-wrap ${wrapClass || ''}'>
      <div class='td-hl-backdrop' id='${backdropId}' aria-hidden='true'></div>
      <textarea class='td-hl-textarea' id='${textareaId}' placeholder='${escapeHtml(placeholder || '')}'>${escapeHtml(value || '')}</textarea>
    </div>`;
}

function buildPresetAttrRows(oldP, newP) {
  const sameName = (oldP?.name || '') === (newP?.name || '');
  const sameEn = !!oldP?.enabled === !!newP?.enabled;
  const sameRole = (oldP?.role || 'system') === (newP?.role || 'system');
  const samePos = JSON.stringify(oldP?.position || null) === JSON.stringify(newP?.position || null);

  return [
    { key: 'name', label: '名称', oldText: oldP ? (oldP.name || oldP.id) : '（无）', newText: newP ? (newP.name || newP.id) : '（无）', isDiff: !sameName, hasOld: !!oldP, hasNew: !!newP },
    { key: 'enabled', label: '开关', oldText: oldP ? (oldP.enabled ? '开启' : '关闭') : '（无）', newText: newP ? (newP.enabled ? '开启' : '关闭') : '（无）', isDiff: !sameEn, hasOld: !!oldP, hasNew: !!newP },
    { key: 'role', label: '身份', oldText: oldP ? (ROLE_LABELS[oldP.role] || oldP.role || 'System') : '（无）', newText: newP ? (ROLE_LABELS[newP.role] || newP.role || 'System') : '（无）', isDiff: !sameRole, hasOld: !!oldP, hasNew: !!newP },
    { key: 'position', label: '位置/深度', oldText: formatPresetPositionText(oldP), newText: formatPresetPositionText(newP), isDiff: !samePos, hasOld: !!oldP, hasNew: !!newP },
  ];
}

function buildWbAttrRows(oldE, newE) {
  const oldSt = oldE?.strategy || {};
  const newSt = newE?.strategy || {};
  const sameName = (oldE?.name || '') === (newE?.name || '');
  const sameEn = !!oldE?.enabled === !!newE?.enabled;
  const sameStype = (oldSt.type || 'selective') === (newSt.type || 'selective');
  const sameKeys = keysSignature(oldSt.keys) === keysSignature(newSt.keys);
  const sameSec = (oldSt.keys_secondary?.logic || 'and_any') === (newSt.keys_secondary?.logic || 'and_any')
    && keysSignature(oldSt.keys_secondary?.keys) === keysSignature(newSt.keys_secondary?.keys);
  const sameScan = (oldSt.scan_depth ?? 'same_as_global') === (newSt.scan_depth ?? 'same_as_global');
  const samePos = JSON.stringify(oldE?.position || null) === JSON.stringify(newE?.position || null);
  const sameProb = (oldE?.probability ?? 100) === (newE?.probability ?? 100);
  const sameRec = JSON.stringify(oldE?.recursion || null) === JSON.stringify(newE?.recursion || null);
  const sameEff = JSON.stringify(oldE?.effect || null) === JSON.stringify(newE?.effect || null);

  return [
    { key: 'name', label: '条目标题', oldText: oldE ? (oldE.name || `#${oldE.uid}`) : '（无）', newText: newE ? (newE.name || `#${newE.uid}`) : '（无）', isDiff: !sameName, hasOld: !!oldE, hasNew: !!newE },
    { key: 'enabled', label: '开关', oldText: oldE ? (oldE.enabled ? '开启' : '关闭') : '（无）', newText: newE ? (newE.enabled ? '开启' : '关闭') : '（无）', isDiff: !sameEn, hasOld: !!oldE, hasNew: !!newE },
    { key: 'stype', label: '触发策略', oldText: oldE ? (WB_STYPE_LABELS[oldSt.type] || '绿灯') : '（无）', newText: newE ? (WB_STYPE_LABELS[newSt.type] || '绿灯') : '（无）', isDiff: !sameStype, hasOld: !!oldE, hasNew: !!newE },
    { key: 'keys', label: '主要关键词', oldText: oldE ? (formatKeysInput(oldSt.keys) || '（空）') : '（无）', newText: newE ? (formatKeysInput(newSt.keys) || '（空）') : '（无）', isDiff: !sameKeys, hasOld: !!oldE, hasNew: !!newE },
    { key: 'position', label: '位置/深度/顺', oldText: formatWbPositionText(oldE), newText: formatWbPositionText(newE), isDiff: !samePos, hasOld: !!oldE, hasNew: !!newE },
    { key: 'probability', label: '触发概率', oldText: oldE ? `${oldE.probability ?? 100}%` : '（无）', newText: newE ? `${newE.probability ?? 100}%` : '（无）', isDiff: !sameProb, hasOld: !!oldE, hasNew: !!newE },
    { key: 'sec', label: '次要关键词', oldText: oldE ? `${WB_SEC_LOGIC_LABELS[oldSt.keys_secondary?.logic || 'and_any']}: ${formatKeysInput(oldSt.keys_secondary?.keys) || '（空）'}` : '（无）', newText: newE ? `${WB_SEC_LOGIC_LABELS[newSt.keys_secondary?.logic || 'and_any']}: ${formatKeysInput(newSt.keys_secondary?.keys) || '（空）'}` : '（无）', isDiff: !sameSec, hasOld: !!oldE, hasNew: !!newE },
    { key: 'scanDepth', label: '扫描深度', oldText: oldE ? (oldSt.scan_depth === 'same_as_global' || oldSt.scan_depth === undefined ? '跟随全局' : String(oldSt.scan_depth)) : '（无）', newText: newE ? (newSt.scan_depth === 'same_as_global' || newSt.scan_depth === undefined ? '跟随全局' : String(newSt.scan_depth)) : '（无）', isDiff: !sameScan, hasOld: !!oldE, hasNew: !!newE },
    { key: 'recursion', label: '递归设置', oldText: formatWbRecursionText(oldE), newText: formatWbRecursionText(newE), isDiff: !sameRec, hasOld: !!oldE, hasNew: !!newE },
    { key: 'effect', label: '黏性/冷却/延', oldText: formatWbEffectText(oldE), newText: formatWbEffectText(newE), isDiff: !sameEff, hasOld: !!oldE, hasNew: !!newE },
  ];
}

function renderAttrDiffBoxHtml(rows, hasOld, hasNew) {
  const diffCount = rows.filter((r) => r.isDiff).length;
  const rowsHtml = rows.map((r) => `
    <div class='td-attr-row ${r.isDiff ? 'is-diff' : ''}'>
      <div class='td-attr-key'>${escapeHtml(r.label)} ${r.isDiff ? "<span class='td-attr-diff-dot'>差异</span>" : ''}</div>
      <div class='td-attr-vals'>
        <span class='td-attr-val is-old' title='${escapeHtml(r.oldText)}'>旧: ${escapeHtml(r.oldText)}</span>
        <span class='td-attr-val is-new' title='${escapeHtml(r.newText)}'>新: ${escapeHtml(r.newText)}</span>
      </div>
      ${r.isDiff ? `
        <div class='td-attr-ops'>
          ${r.hasOld ? `<button type='button' class='td-chip' data-action='merge-apply-attr-one' data-attr='${escapeHtml(r.key)}' data-side='old'>用旧</button>` : ''}
          ${r.hasNew ? `<button type='button' class='td-chip' data-action='merge-apply-attr-one' data-attr='${escapeHtml(r.key)}' data-side='new'>用新</button>` : ''}
        </div>` : ''}
    </div>`).join('');

  return `
    <details class='td-attr-diff-box' ${diffCount > 0 ? 'open' : ''}>
      <summary class='td-attr-diff-head'>
        <span>属性对比（${diffCount > 0 ? `${diffCount} 项不同` : '属性完全一致'}）</span>
        <span class='td-attr-head-btns' onclick='event.stopPropagation()'>
          ${hasOld ? "<button type='button' class='td-chip' data-action='merge-apply-attrs' data-side='old'>属性全用旧版</button>" : ''}
          ${hasNew ? "<button type='button' class='td-chip' data-action='merge-apply-attrs' data-side='new'>属性全用新版</button>" : ''}
        </span>
      </summary>
      <div class='td-attr-diff-list'>${rowsHtml}</div>
    </details>`;
}

function renderContentOnlyAttrNoticeHtml(rows, hasNew) {
  const diffs = rows.filter((r) => r.isDiff);
  if (diffs.length === 0) return '';
  const names = diffs.map((r) => r.label).join('、');
  const tip = hasNew
    ? `检测到属性存在冲突（${names}），「只缝合内容」模式将默认采用新版属性。`
    : `检测到属性存在差异（${names}），因新版无此条目，将沿用旧版/默认属性。`;
  return `<div class='td-attr-warn-banner'>${escapeHtml(tip)}</div>`;
}

export function renderPresetMergeCustomModal(previewLayerEl, icons) {
  const ctx = state.previewCtx;
  const entry = ctx.entry;
  const d = ctx.draft;
  const isInChat = d.posType === 'in_chat';
  const contentOnly = !!ctx.contentOnly;
  const syncScroll = !!ctx.syncScroll;
  const attrRows = buildPresetAttrRows(entry.oldPrompt, entry.newPrompt);

  const attrsSectionHtml = contentOnly
    ? renderContentOnlyAttrNoticeHtml(attrRows, !!entry.newPrompt)
    : `
      ${renderAttrDiffBoxHtml(attrRows, !!entry.oldPrompt, !!entry.newPrompt)}
      <div style='display:flex;gap:8px;align-items:center;'>
        <div class='td-field' style='flex:1;'>
          <label class='td-label'>缝合后条目名称</label>
          <input class='td-input' id='td-merge-custom-name' type='text' value='${escapeHtml(d.name)}' />
        </div>
        <label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'>
          <input type='checkbox' class='td-checkbox' id='td-merge-custom-enabled' ${d.enabled ? 'checked' : ''} /><span>启用</span>
        </label>
      </div>
      <div class='td-form-grid'>
        <div class='td-field'>
          <label class='td-label'>角色身份 (Role)</label>
          <select class='td-select' id='td-merge-custom-role'>
            <option value='system' ${d.role === 'system' ? 'selected' : ''}>System</option>
            <option value='user' ${d.role === 'user' ? 'selected' : ''}>User</option>
            <option value='assistant' ${d.role === 'assistant' ? 'selected' : ''}>Assistant</option>
          </select>
        </div>
        <div class='td-field'>
          <label class='td-label'>插入位置</label>
          <select class='td-select' id='td-merge-custom-postype'>
            <option value='relative' ${!isInChat ? 'selected' : ''}>相对位置 (Relative)</option>
            <option value='in_chat' ${isInChat ? 'selected' : ''}>聊天深度 (In-Chat @D)</option>
          </select>
        </div>
        <div class='td-field'>
          <label class='td-label'>深度 (Depth, @D有效)</label>
          <input class='td-input' id='td-merge-custom-depth' type='number' value='${escapeHtml(d.depth)}' />
        </div>
        <div class='td-field'>
          <label class='td-label'>顺序 (Order, @D有效)</label>
          <input class='td-input' id='td-merge-custom-order' type='number' value='${escapeHtml(d.order)}' />
        </div>
      </div>`;

  const contentEditorsHtml = `
    <div class='td-merge-content-grid ${contentOnly ? 'is-content-only' : ''}'>
      <div class='td-merge-refs'>
        <div class='td-field td-merge-pane'>
          <div style='display:flex;justify-content:space-between;align-items:center;gap:4px;'>
            <label class='td-label'>旧版内容（可编辑 · 红底差异）</label>
            <button type='button' class='td-chip' data-action='merge-fill-text' data-side='old'>整段填入</button>
          </div>
          ${renderHlEditorHtml({
            wrapClass: 'td-hl-ref',
            backdropId: 'td-merge-old-bd',
            textareaId: 'td-merge-old-content',
            value: d.oldContent,
            placeholder: '（旧版无此条目或内容为空，可直接编辑）',
          })}
        </div>
        <div class='td-field td-merge-pane'>
          <div style='display:flex;justify-content:space-between;align-items:center;gap:4px;'>
            <label class='td-label'>新版内容（可编辑 · 绿底差异）</label>
            <button type='button' class='td-chip' data-action='merge-fill-text' data-side='new'>整段填入</button>
          </div>
          ${renderHlEditorHtml({
            wrapClass: 'td-hl-ref',
            backdropId: 'td-merge-new-bd',
            textareaId: 'td-merge-new-content',
            value: d.newContent,
            placeholder: '（新版已删除或内容为空，可直接编辑）',
          })}
        </div>
      </div>
      <div class='td-field td-merge-final-pane'>
        <label class='td-label'>缝合后正文（支持撤销/重做）</label>
        <textarea class='td-textarea td-scroll' id='td-merge-custom-content' style='flex:1;min-height:140px;'>${escapeHtml(d.content)}</textarea>
      </div>
    </div>`;

  previewLayerEl.classList.add('is-open');
  previewLayerEl.innerHTML = `
    <div class='td-modal td-modal-tall ${contentOnly ? 'is-content-only' : ''}'>
      <div class='td-modal-head'>
        <div class='td-modal-title'>${contentOnly ? '只缝合内容' : '手动缝合条目'} · ${escapeHtml(entry.name)}</div>
        <div style='display:flex;gap:4px;align-items:center;'>
          <button type='button' class='td-btn sm ${syncScroll ? 'primary' : ''}' data-action='toggle-merge-sync-scroll' title='开关旧版与新版文本框同步滚动'>${syncScroll ? '同步滚动:开' : '同步滚动'}</button>
          <button type='button' class='td-btn sm ${contentOnly ? 'primary' : ''}' data-action='toggle-merge-content-only'>${contentOnly ? '完整缝合' : '只缝合内容'}</button>
          <button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${icons.undo}</button>
          <button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${icons.redo}</button>
          <button class='td-icon-btn' data-action='close-preview' title='关闭'>${icons.close}</button>
        </div>
      </div>
      <div class='td-modal-body'>
        ${attrsSectionHtml}${contentEditorsHtml}
      </div>
      <div class='td-modal-foot'>
        <button class='td-btn' data-action='close-preview'>取消</button>
        <button class='td-btn primary' data-action='save-merge-custom'>${icons.save} 保存缝合结果</button>
      </div>
    </div>`;

  applyMergeCustomSideDiffs(previewLayerEl);
  bindMergeCustomEvents(previewLayerEl);
}

export function renderWbMergeCustomModal(previewLayerEl, icons) {
  const ctx = state.previewCtx;
  const entry = ctx.entry;
  const d = ctx.draft;
  const contentOnly = !!ctx.contentOnly;
  const syncScroll = !!ctx.syncScroll;
  const attrRows = buildWbAttrRows(entry.oldEntry, entry.newEntry);
  const advDiff = attrRows.some((r) => ['sec', 'scanDepth', 'recursion', 'effect'].includes(r.key) && r.isDiff);
  const posOpts = WB_POSITION_OPTIONS.map((o) => `<option value='${o.v}' ${d.posType === o.v ? 'selected' : ''}>${o.t}</option>`).join('');

  const attrsSectionHtml = contentOnly
    ? renderContentOnlyAttrNoticeHtml(attrRows, !!entry.newEntry)
    : `
      ${renderAttrDiffBoxHtml(attrRows, !!entry.oldEntry, !!entry.newEntry)}
      <div style='display:flex;gap:8px;align-items:center;'>
        <div class='td-field' style='flex:1;'>
          <label class='td-label'>缝合后条目标题</label>
          <input class='td-input' id='td-wbm-custom-name' type='text' value='${escapeHtml(d.name)}' />
        </div>
        <label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'>
          <input type='checkbox' class='td-checkbox' id='td-wbm-custom-enabled' ${d.enabled ? 'checked' : ''} /><span>启用</span>
        </label>
      </div>
      <div class='td-form-grid'>
        <div class='td-field'>
          <label class='td-label'>触发策略</label>
          <select class='td-select' id='td-wbm-custom-stype'>
            <option value='selective' ${d.stype === 'selective' ? 'selected' : ''}>绿灯 (关键词)</option>
            <option value='constant' ${d.stype === 'constant' ? 'selected' : ''}>蓝灯 (常驻)</option>
            <option value='vectorized' ${d.stype === 'vectorized' ? 'selected' : ''}>向量化</option>
          </select>
        </div>
        <div class='td-field'>
          <label class='td-label'>主要关键词（逗号或换行分隔）</label>
          <input class='td-input' id='td-wbm-custom-keys' type='text' value='${escapeHtml(d.keys)}' />
        </div>
        <div class='td-field'>
          <label class='td-label'>插入位置</label>
          <select class='td-select' id='td-wbm-custom-postype'>${posOpts}</select>
        </div>
        <div class='td-field'>
          <label class='td-label'>插入顺序 (Order) / 触发概率 (%)</label>
          <div style='display:grid;grid-template-columns:1fr 1fr;gap:6px;'>
            <input class='td-input' id='td-wbm-custom-order' type='number' value='${escapeHtml(d.order)}' title='插入顺序' />
            <input class='td-input' id='td-wbm-custom-prob' type='number' min='0' max='100' value='${escapeHtml(d.probability)}' title='触发概率%' />
          </div>
        </div>
        <div class='td-field'>
          <label class='td-label'>插入深度 (@D 有效)</label>
          <input class='td-input' id='td-wbm-custom-depth' type='number' value='${escapeHtml(d.depth)}' />
        </div>
        <div class='td-field'>
          <label class='td-label'>深度身份 (@D 有效)</label>
          <select class='td-select' id='td-wbm-custom-role'>
            <option value='system' ${d.role === 'system' ? 'selected' : ''}>System</option>
            <option value='user' ${d.role === 'user' ? 'selected' : ''}>User</option>
            <option value='assistant' ${d.role === 'assistant' ? 'selected' : ''}>Assistant</option>
          </select>
        </div>
      </div>
      <details class='td-attr-diff-box' ${advDiff ? 'open' : ''}>
        <summary class='td-attr-diff-head'><span>高级属性（次要关键词 / 扫描深度 / 递归 / 时效）</span></summary>
        <div style='padding:8px 10px;display:flex;flex-direction:column;gap:8px;'>
          <div class='td-form-grid'>
            <div class='td-field'>
              <label class='td-label'>次要关键词逻辑</label>
              <select class='td-select' id='td-wbm-custom-seclogic'>
                <option value='and_any' ${d.secLogic === 'and_any' ? 'selected' : ''}>任一包含</option>
                <option value='and_all' ${d.secLogic === 'and_all' ? 'selected' : ''}>全部包含</option>
                <option value='not_any' ${d.secLogic === 'not_any' ? 'selected' : ''}>全部不含</option>
                <option value='not_all' ${d.secLogic === 'not_all' ? 'selected' : ''}>非全含</option>
              </select>
            </div>
            <div class='td-field'>
              <label class='td-label'>次要关键词</label>
              <input class='td-input' id='td-wbm-custom-seckeys' type='text' value='${escapeHtml(d.secKeys)}' />
            </div>
            <div class='td-field'>
              <label class='td-label'>扫描深度（留空跟随全局）</label>
              <input class='td-input' id='td-wbm-custom-scandepth' type='number' placeholder='全局' value='${escapeHtml(d.scanDepth)}' />
            </div>
            <div class='td-field'>
              <label class='td-label'>黏性 / 冷却 / 延迟</label>
              <div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;'>
                <input class='td-input' id='td-wbm-custom-sticky' type='number' placeholder='黏' value='${escapeHtml(d.sticky)}' />
                <input class='td-input' id='td-wbm-custom-cooldown' type='number' placeholder='冷' value='${escapeHtml(d.cooldown)}' />
                <input class='td-input' id='td-wbm-custom-delay' type='number' placeholder='延' value='${escapeHtml(d.delay)}' />
              </div>
            </div>
          </div>
          <div style='display:flex;gap:12px;flex-wrap:wrap;align-items:center;'>
            <label style='display:inline-flex;align-items:center;gap:5px;font-size:12px;'><input type='checkbox' class='td-checkbox' id='td-wbm-custom-previn' ${d.preventIncoming ? 'checked' : ''} /> 禁止被递归</label>
            <label style='display:inline-flex;align-items:center;gap:5px;font-size:12px;'><input type='checkbox' class='td-checkbox' id='td-wbm-custom-prevout' ${d.preventOutgoing ? 'checked' : ''} /> 禁止递归其他</label>
            <label style='display:inline-flex;align-items:center;gap:5px;font-size:12px;'>延迟递归级数<input class='td-input' id='td-wbm-custom-delayuntil' type='number' placeholder='无' style='width:72px;height:28px;font-size:12px;' value='${escapeHtml(d.delayUntil)}' /></label>
          </div>
        </div>
      </details>`;

  const contentEditorsHtml = `
    <div class='td-merge-content-grid ${contentOnly ? 'is-content-only' : ''}'>
      <div class='td-merge-refs'>
        <div class='td-field td-merge-pane'>
          <div style='display:flex;justify-content:space-between;align-items:center;gap:4px;'>
            <label class='td-label'>旧版内容（可编辑 · 红底差异）</label>
            <button type='button' class='td-chip' data-action='wbm-fill-text' data-side='old'>整段填入</button>
          </div>
          ${renderHlEditorHtml({
            wrapClass: 'td-hl-ref',
            backdropId: 'td-merge-old-bd',
            textareaId: 'td-wbm-old-content',
            value: d.oldContent,
            placeholder: '（旧版无此条目或内容为空，可直接编辑）',
          })}
        </div>
        <div class='td-field td-merge-pane'>
          <div style='display:flex;justify-content:space-between;align-items:center;gap:4px;'>
            <label class='td-label'>新版内容（可编辑 · 绿底差异）</label>
            <button type='button' class='td-chip' data-action='wbm-fill-text' data-side='new'>整段填入</button>
          </div>
          ${renderHlEditorHtml({
            wrapClass: 'td-hl-ref',
            backdropId: 'td-merge-new-bd',
            textareaId: 'td-wbm-new-content',
            value: d.newContent,
            placeholder: '（新版已删除或内容为空，可直接编辑）',
          })}
        </div>
      </div>
      <div class='td-field td-merge-final-pane'>
        <label class='td-label'>缝合后正文（支持撤销/重做）</label>
        <textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:130px;'>${escapeHtml(d.content)}</textarea>
      </div>
    </div>`;

  previewLayerEl.classList.add('is-open');
  previewLayerEl.innerHTML = `
    <div class='td-modal td-modal-tall ${contentOnly ? 'is-content-only' : ''}'>
      <div class='td-modal-head'>
        <div class='td-modal-title'>${contentOnly ? '只缝合内容' : '手动缝合世界书'} · ${escapeHtml(entry.name)}</div>
        <div style='display:flex;gap:4px;align-items:center;'>
          <button type='button' class='td-btn sm ${syncScroll ? 'primary' : ''}' data-action='toggle-merge-sync-scroll' title='开关旧版与新版文本框同步滚动'>${syncScroll ? '同步滚动:开' : '同步滚动'}</button>
          <button type='button' class='td-btn sm ${contentOnly ? 'primary' : ''}' data-action='toggle-merge-content-only'>${contentOnly ? '完整缝合' : '只缝合内容'}</button>
          <button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${icons.undo}</button>
          <button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${icons.redo}</button>
          <button class='td-icon-btn' data-action='close-preview'>${icons.close}</button>
        </div>
      </div>
      <div class='td-modal-body'>
        ${attrsSectionHtml}${contentEditorsHtml}
      </div>
      <div class='td-modal-foot'>
        <button class='td-btn' data-action='close-preview'>取消</button>
        <button class='td-btn primary' data-action='wbm-save-merge-custom'>${icons.save} 保存缝合结果</button>
      </div>
    </div>`;

  applyMergeCustomSideDiffs(previewLayerEl);
  bindMergeCustomEvents(previewLayerEl);
}

export function bindMergeCustomEvents(previewLayerEl) {
  if (!previewLayerEl || !state.previewCtx) return;
  const ctx = state.previewCtx;
  const isPreset = ctx.type === 'mergeCustom';
  const oldTa = previewLayerEl.querySelector(isPreset ? '#td-merge-old-content' : '#td-wbm-old-content');
  const newTa = previewLayerEl.querySelector(isPreset ? '#td-merge-new-content' : '#td-wbm-new-content');
  const oldBd = previewLayerEl.querySelector('#td-merge-old-bd');
  const newBd = previewLayerEl.querySelector('#td-merge-new-bd');
  let syncing = false;

  if (oldTa && oldBd && !oldTa.dataset.tdScrollBound) {
    oldTa.dataset.tdScrollBound = '1';
    oldTa.addEventListener('scroll', () => {
      syncBackdropScroll(oldTa, oldBd);
      if (!syncing && ctx.syncScroll && newTa) {
        syncing = true;
        newTa.scrollTop = oldTa.scrollTop;
        newTa.scrollLeft = oldTa.scrollLeft;
        syncBackdropScroll(newTa, newBd);
        syncing = false;
      }
    });
  }
  if (newTa && newBd && !newTa.dataset.tdScrollBound) {
    newTa.dataset.tdScrollBound = '1';
    newTa.addEventListener('scroll', () => {
      syncBackdropScroll(newTa, newBd);
      if (!syncing && ctx.syncScroll && oldTa) {
        syncing = true;
        oldTa.scrollTop = newTa.scrollTop;
        oldTa.scrollLeft = newTa.scrollLeft;
        syncBackdropScroll(oldTa, oldBd);
        syncing = false;
      }
    });
  }
}

let draftSaveTimer = null;

export function flushActiveMergeDraft(previewLayerEl, force = false) {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  const ctx = state.previewCtx;
  if (ctx && (ctx.type === 'mergeCustom' || ctx.type === 'wbMergeCustom') && (ctx.edited || force)) {
    const isPreset = ctx.type === 'mergeCustom';
    const session = isPreset
      ? (state.modal?.type === 'presetMerge' ? state.modal.session : null)
      : (state.modal?.type === 'wbMerge' ? state.modal.session : null);
    if (session) {
      if (isPreset) syncPresetMergeCustomDraft(previewLayerEl);
      else syncWbMergeCustomDraft(previewLayerEl);
      session._pendingCustom = {
        entryKey: ctx.entry.key,
        contentOnly: !!ctx.contentOnly,
        draft: JSON.parse(JSON.stringify(ctx.draft)),
      };
      saveMergeDraft(isPreset ? 'preset' : 'worldbook', session);
      return;
    }
  }
  if (state.modal?.type === 'presetMerge' && state.modal.session?.dirty) {
    saveMergeDraft('preset', state.modal.session);
  } else if (state.modal?.type === 'wbMerge' && state.modal.session?.dirty) {
    saveMergeDraft('worldbook', state.modal.session);
  }
}

export function scheduleActiveMergeDraftSave(previewLayerEl) {
  const ctx = state.previewCtx;
  if (!ctx || (ctx.type !== 'mergeCustom' && ctx.type !== 'wbMergeCustom')) return;
  ctx.edited = true;
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    flushActiveMergeDraft(previewLayerEl);
  }, 360);
}

export function discardPendingCustomMergeDraft() {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  if (state.modal?.type === 'presetMerge' && state.modal.session) {
    delete state.modal.session._pendingCustom;
    if (state.modal.session.dirty) saveMergeDraft('preset', state.modal.session);
    else clearMergeDraft('preset');
  } else if (state.modal?.type === 'wbMerge' && state.modal.session) {
    delete state.modal.session._pendingCustom;
    if (state.modal.session.dirty) saveMergeDraft('worldbook', state.modal.session);
    else clearMergeDraft('worldbook');
  }
}

export function handleMergeUiInput(e, previewLayerEl) {
  const ctx = state.previewCtx;
  if (!ctx || !e.target) return false;
  const id = e.target.id || '';
  if (['td-merge-old-content', 'td-merge-new-content', 'td-wbm-old-content', 'td-wbm-new-content'].includes(id)) {
    applyMergeCustomSideDiffs(previewLayerEl);
    scheduleActiveMergeDraftSave(previewLayerEl);
    return true;
  }
  return false;
}

function applyPresetAttrSide(ctx, side, attrKey) {
  const src = side === 'old' ? ctx.entry.oldPrompt : ctx.entry.newPrompt;
  if (!src) return false;
  const d = ctx.draft;
  if (!attrKey || attrKey === 'name') d.name = src.name || src.id || d.name;
  if (!attrKey || attrKey === 'enabled') d.enabled = !!src.enabled;
  if (!attrKey || attrKey === 'role') d.role = src.role || 'system';
  if (!attrKey || attrKey === 'position') {
    d.posType = src.position?.type === 'in_chat' ? 'in_chat' : 'relative';
    d.depth = src.position?.depth ?? 4;
    d.order = src.position?.order ?? 100;
  }
  return true;
}

function applyWbAttrSide(ctx, side, attrKey) {
  const src = side === 'old' ? ctx.entry.oldEntry : ctx.entry.newEntry;
  if (!src) return false;
  const d = ctx.draft;
  if (!attrKey || attrKey === 'name') d.name = src.name || `#${src.uid}`;
  if (!attrKey || attrKey === 'enabled') d.enabled = !!src.enabled;
  if (!attrKey || attrKey === 'stype') d.stype = src.strategy?.type || 'selective';
  if (!attrKey || attrKey === 'keys') d.keys = formatKeysInput(src.strategy?.keys);
  if (!attrKey || attrKey === 'sec') {
    d.secLogic = src.strategy?.keys_secondary?.logic || 'and_any';
    d.secKeys = formatKeysInput(src.strategy?.keys_secondary?.keys);
  }
  if (!attrKey || attrKey === 'scanDepth') {
    d.scanDepth = src.strategy?.scan_depth === 'same_as_global' || src.strategy?.scan_depth === undefined
      ? ''
      : String(src.strategy.scan_depth);
  }
  if (!attrKey || attrKey === 'position') {
    d.posType = src.position?.type || 'after_character_definition';
    d.role = src.position?.role || 'system';
    d.depth = src.position?.depth ?? 4;
    d.order = src.position?.order ?? 100;
  }
  if (!attrKey || attrKey === 'probability') d.probability = src.probability ?? 100;
  if (!attrKey || attrKey === 'recursion') {
    d.preventIncoming = !!src.recursion?.prevent_incoming;
    d.preventOutgoing = !!src.recursion?.prevent_outgoing;
    d.delayUntil = src.recursion?.delay_until ?? '';
  }
  if (!attrKey || attrKey === 'effect') {
    d.sticky = src.effect?.sticky ?? '';
    d.cooldown = src.effect?.cooldown ?? '';
    d.delay = src.effect?.delay ?? '';
  }
  return true;
}

export function saveMergeCustomResult(previewLayerEl, hooks) {
  const ctx = state.previewCtx;
  if (!ctx) return false;

  if (ctx.type === 'mergeCustom') {
    syncPresetMergeCustomDraft(previewLayerEl);
    const d = ctx.draft;
    const entry = ctx.entry;

    let base;
    if (ctx.contentOnly) {
      base = JSON.parse(JSON.stringify(
        entry.newPrompt || entry.customPrompt || entry.oldPrompt || { id: entry.id, name: entry.name, enabled: true, role: 'system', position: { type: 'relative' } },
      ));
      base.content = d.content ?? '';
    } else {
      base = JSON.parse(JSON.stringify(
        entry.customPrompt || entry.newPrompt || entry.oldPrompt || { id: entry.id, role: 'system', position: { type: 'relative' } },
      ));
      if (entry.newPrompt) base.id = entry.newPrompt.id;
      base.name = (d.name || '').trim() || entry.name;
      base.enabled = !!d.enabled;
      base.role = ['system', 'user', 'assistant'].includes(d.role) ? d.role : 'system';
      base.position = d.posType === 'in_chat'
        ? { type: 'in_chat', depth: Number(d.depth) || 0, order: Number(d.order) || 100 }
        : { type: 'relative' };
      base.content = d.content ?? '';
    }

    entry.customPrompt = base;
    entry.choice = 'custom';
    if (state.modal?.type === 'presetMerge' && state.modal.session) {
      delete state.modal.session._pendingCustom;
      state.modal.session.dirty = true;
      saveMergeDraft('preset', state.modal.session);
    }
    state.previewCtx = null;
    hooks.renderPreviewModal();
    hooks.updatePresetMergeBody();
    notify('success', ctx.contentOnly ? '已暂存内容缝合结果（请点击底部「覆盖」或「另存为」写入预设）' : '已暂存该条目缝合结果（请点击底部「覆盖」或「另存为」写入预设）');
    return true;
  }

  if (ctx.type === 'wbMergeCustom') {
    syncWbMergeCustomDraft(previewLayerEl);
    const d = ctx.draft;
    const entry = ctx.entry;

    let base;
    if (ctx.contentOnly) {
      base = cloneWorldbookEntry(
        entry.newEntry || entry.customEntry || entry.oldEntry || buildDefaultWorldbookEntry({ name: entry.name }),
      );
      base.content = d.content ?? '';
    } else {
      base = cloneWorldbookEntry(entry.customEntry || entry.newEntry || entry.oldEntry || buildDefaultWorldbookEntry({}));
      if (entry.newEntry) base.uid = entry.newEntry.uid;
      base.name = (d.name || '').trim() || entry.name;
      base.enabled = !!d.enabled;
      base.strategy = {
        type: d.stype || 'selective',
        keys: parseKeysInput(d.keys || ''),
        keys_secondary: {
          logic: d.secLogic || 'and_any',
          keys: parseKeysInput(d.secKeys || ''),
        },
        scan_depth: String(d.scanDepth ?? '').trim() === '' ? 'same_as_global' : (Number(d.scanDepth) || 0),
      };
      base.position = {
        type: d.posType || 'after_character_definition',
        role: d.role || 'system',
        depth: Number(d.depth) || 4,
        order: Number(d.order) || 100,
      };
      base.probability = Number(d.probability ?? 100);
      const numOrNull = (val) => {
        const s = String(val ?? '').trim();
        return s === '' ? null : Number(s);
      };
      base.effect = {
        sticky: numOrNull(d.sticky),
        cooldown: numOrNull(d.cooldown),
        delay: numOrNull(d.delay),
      };
      base.recursion = {
        prevent_incoming: !!d.preventIncoming,
        prevent_outgoing: !!d.preventOutgoing,
        delay_until: numOrNull(d.delayUntil),
      };
      base.content = d.content ?? '';
    }

    entry.customEntry = base;
    entry.choice = 'custom';
    if (state.modal?.type === 'wbMerge' && state.modal.session) {
      delete state.modal.session._pendingCustom;
      state.modal.session.dirty = true;
      saveMergeDraft('worldbook', state.modal.session);
    }
    state.previewCtx = null;
    hooks.renderPreviewModal();
    hooks.updateWbMergeBody();
    notify('success', ctx.contentOnly ? '已暂存内容缝合结果（请点击底部「覆盖」或「另存为」写入世界书）' : '已暂存缝合结果（请点击底部「覆盖」或「另存为」写入世界书）');
    return true;
  }
  return false;
}

export function handleMergeUiClick(e, actionEl, action, previewLayerEl, hooks) {
  const ctx = state.previewCtx;
  if (!ctx || (ctx.type !== 'mergeCustom' && ctx.type !== 'wbMergeCustom')) return false;

  if (action === 'toggle-merge-sync-scroll') {
    ctx.syncScroll = !ctx.syncScroll;
    actionEl.classList.toggle('primary', ctx.syncScroll);
    actionEl.textContent = ctx.syncScroll ? '同步滚动:开' : '同步滚动';
    return true;
  }

  if (action === 'toggle-merge-content-only') {
    syncPresetMergeCustomDraft(previewLayerEl);
    syncWbMergeCustomDraft(previewLayerEl);
    ctx.contentOnly = !ctx.contentOnly;
    if (ctx.edited) flushActiveMergeDraft(previewLayerEl);
    hooks.renderPreviewModal();
    return true;
  }

  if (action === 'merge-apply-attrs' || action === 'merge-apply-attr-one') {
    const side = actionEl.getAttribute('data-side');
    const attrKey = action === 'merge-apply-attr-one' ? actionEl.getAttribute('data-attr') : null;
    syncPresetMergeCustomDraft(previewLayerEl);
    syncWbMergeCustomDraft(previewLayerEl);
    const ok = ctx.type === 'mergeCustom' ? applyPresetAttrSide(ctx, side, attrKey) : applyWbAttrSide(ctx, side, attrKey);
    if (ok) {
      ctx.edited = true;
      flushActiveMergeDraft(previewLayerEl, true);
      hooks.renderPreviewModal();
      notify('success', `已将${attrKey ? '该属性' : '全部属性'}设为${side === 'old' ? '旧版' : '新版'}`);
    }
    return true;
  }

  if (action === 'merge-fill-text' && ctx.type === 'mergeCustom') {
    const side = actionEl.getAttribute('data-side');
    const srcTa = previewLayerEl.querySelector(side === 'old' ? '#td-merge-old-content' : '#td-merge-new-content');
    const dstTa = previewLayerEl.querySelector('#td-merge-custom-content');
    if (srcTa && dstTa) {
      dstTa.value = srcTa.value;
      ctx.draft.content = srcTa.value;
      ctx.edited = true;
      flushActiveMergeDraft(previewLayerEl, true);
      hooks.pushEditSnapshot(true);
    }
    return true;
  }

  if (action === 'wbm-fill-text' && ctx.type === 'wbMergeCustom') {
    const side = actionEl.getAttribute('data-side');
    const srcTa = previewLayerEl.querySelector(side === 'old' ? '#td-wbm-old-content' : '#td-wbm-new-content');
    const dstTa = previewLayerEl.querySelector('#td-edit-content');
    if (srcTa && dstTa) {
      dstTa.value = srcTa.value;
      ctx.draft.content = srcTa.value;
      ctx.edited = true;
      flushActiveMergeDraft(previewLayerEl, true);
      hooks.pushEditSnapshot(true);
    }
    return true;
  }

  if (action === 'save-merge-custom' && ctx.type === 'mergeCustom') {
    hooks.pushEditSnapshot(true);
    return saveMergeCustomResult(previewLayerEl, hooks);
  }

  if (action === 'wbm-save-merge-custom' && ctx.type === 'wbMergeCustom') {
    hooks.pushEditSnapshot(true);
    return saveMergeCustomResult(previewLayerEl, hooks);
  }

  return false;
}
