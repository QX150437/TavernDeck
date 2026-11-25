import { TYPE_LABELS, escapeHtml } from './utils.js';
import { state } from './store.js';
import {
  ICONS, uiCtx, editHistory, readPreviewSnapshot, updatePreviewHistoryButtons,
} from './ui-common.js';
import { renderQuickInsertHtml } from './ui-snippets.js';
import { renderSearchableTextareaHtml, bindEditorSearchEvents } from './ui-editor-search.js';
import { updatePickerList } from './ui-groups.js';
import { updateSnapshotList } from './ui-snapshots.js';

export { updatePickerList, updateSnapshotList };

export function renderConfirmModal() {
  const confirmLayerEl = uiCtx.getConfirmLayer();
  if (!confirmLayerEl) return;
  const c = state.confirmModal;
  if (!c) { confirmLayerEl.classList.remove('is-open'); confirmLayerEl.innerHTML = ''; return; }
  confirmLayerEl.classList.add('is-open');
  const extraHtml = c.extraButton
    ? `<button class='td-btn ${escapeHtml(c.extraButton.className || 'warn')}' data-action='confirm-extra'>${escapeHtml(c.extraButton.text)}</button>`
    : '';
  const extrasHtml = Array.isArray(c.extraButtons)
    ? c.extraButtons.map((btn, idx) => `<button class='td-btn ${escapeHtml(btn.className || 'warn')}' data-action='confirm-extra-idx' data-idx='${idx}'>${escapeHtml(btn.text)}</button>`).join('')
    : '';
  const detailsArr = Array.isArray(c.details) ? c.details.filter(Boolean) : [];
  const detailsHtml = detailsArr.length > 0
    ? `<div class='td-confirm-details td-scroll'>${detailsArr.map((line) => `<div class='td-confirm-detail-line'>• ${escapeHtml(line)}</div>`).join('')}</div>`
    : '';
  confirmLayerEl.innerHTML = `
    <div class='td-modal ${detailsArr.length > 0 ? '' : 'td-modal-sm'}'>
      <div class='td-modal-head'><div class='td-modal-title'>${escapeHtml(c.title || '确认操作')}</div><button class='td-icon-btn' data-action='confirm-cancel'>${ICONS.close}</button></div>
      <div class='td-modal-body'><div style='font-size:14px;color:var(--td-text);line-height:1.6;white-space:pre-line;'>${escapeHtml(c.message || '确定要执行此操作吗？')}</div>${detailsHtml}</div>
      <div class='td-modal-foot'><button class='td-btn' data-action='confirm-cancel'>取消</button>${extraHtml}${extrasHtml}<button class='td-btn ${escapeHtml(c.confirmClass || 'danger')}' data-action='confirm-ok'>${escapeHtml(c.confirmText || '确认')}</button></div>
    </div>`;
  uiCtx.syncOverlayBounds();
}

export function renderModal() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl) return;
  const m = state.modal;
  if (!m || !state.panelOpen) { modalLayerEl.classList.remove('is-open'); modalLayerEl.innerHTML = ''; return; }
  modalLayerEl.classList.add('is-open');

  const modules = uiCtx.getModules ? uiCtx.getModules() : [];
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    if (mod && typeof mod.renderModal === 'function' && mod.renderModal(m, modalLayerEl)) {
      return;
    }
  }
}

export function syncPreviewStatusUi() {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl || !state.previewKey) return;
  const item = state.catalog.byKey.get(state.previewKey);
  if (!item) return;
  const statusTag = previewLayerEl.querySelector("[data-role='preview-status-tag']");
  if (statusTag) statusTag.textContent = `状态: ${item.enabled ? '已开启' : '已关闭'}`;
}

export function renderPreviewModal() {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl) return;
  if (editHistory.timer) { clearTimeout(editHistory.timer); editHistory.timer = null; }
  if (!state.panelOpen) {
    previewLayerEl.classList.remove('is-open');
    previewLayerEl.innerHTML = '';
    editHistory.stack = [];
    editHistory.index = -1;
    return;
  }

  const modules = uiCtx.getModules ? uiCtx.getModules() : [];
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    if (mod && typeof mod.renderPreview === 'function' && mod.renderPreview(previewLayerEl)) {
      return;
    }
  }

  if (!state.previewKey) {
    previewLayerEl.classList.remove('is-open');
    previewLayerEl.innerHTML = '';
    editHistory.stack = [];
    editHistory.index = -1;
    return;
  }
  const item = state.catalog.byKey.get(state.previewKey);
  if (!item) {
    state.previewKey = null;
    previewLayerEl.classList.remove('is-open');
    previewLayerEl.innerHTML = '';
    return;
  }

  const ref = item.ref, raw = item.raw || {};
  let metaHtml = `<span class='td-meta-tag'>类型: ${escapeHtml(TYPE_LABELS[ref.type] || ref.type)}</span><span class='td-meta-tag' data-role='preview-status-tag'>状态: ${item.enabled ? '已开启' : '已关闭'}</span>`;
  if (item.scopeTitle) metaHtml += `<span class='td-meta-tag'>作用域: ${escapeHtml(item.scopeTitle)}</span>`;

  let fieldsHtml = `<div class='td-field'><label class='td-label'>条目名称</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(item.name || '')}' /></div>`;
  if (ref.type === 'regex') {
    fieldsHtml += `<div class='td-field'><label class='td-label'>查找正则 (Find Regex)</label><input class='td-input' id='td-edit-find-regex' type='text' value='${escapeHtml(raw.find_regex || '')}' /></div><div class='td-field' style='flex:1;display:flex;flex-direction:column;min-height:0;'><label class='td-label'>替换为 (Replace String)</label>${renderQuickInsertHtml('td-edit-replace-string')}${renderSearchableTextareaHtml({ id: 'td-edit-replace-string', value: raw.replace_string || '', minHeight: '160px' })}</div>`;
  } else {
    const isPlaceholder = ref.type === 'preset' && typeof raw.content !== 'string', contentVal = typeof raw.content === 'string' ? raw.content : '';
    const isPresetOrWb = ref.type === 'preset' || ref.type === 'worldbook';
    const editorHtml = isPresetOrWb
      ? renderSearchableTextareaHtml({ id: 'td-edit-content', value: contentVal, placeholder: isPlaceholder ? '该条目为内置占位符' : '', minHeight: '160px' })
      : `<textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;'>${escapeHtml(contentVal)}</textarea>`;
    fieldsHtml += `<div class='td-field' style='flex:1;display:flex;flex-direction:column;min-height:0;'><label class='td-label'>条目内容 ${isPlaceholder ? '（此条为酒馆内置占位符，一般无正文）' : ''}</label>${renderQuickInsertHtml('td-edit-content')}${editorHtml}</div>`;
  }

  previewLayerEl.classList.add('is-open');
  previewLayerEl.innerHTML = `<div class='td-modal td-modal-tall'><div class='td-modal-head'><div class='td-modal-title' title='编辑与预览 · ${escapeHtml(item.name)}'>编辑与预览 · ${escapeHtml(item.name)}</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='copy-preview' title='复制内容'>${ICONS.copy}</button><button class='td-icon-btn' data-action='open-help' data-help-key='entryPreview' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview' title='关闭'>${ICONS.close}</button></div></div><div class='td-modal-body'><div class='td-preview-meta'>${metaHtml}</div>${fieldsHtml}</div><div class='td-modal-foot'>${ref.type === 'regex' ? `<button type='button' class='td-btn' data-action='preview-test-regex' style='margin-right:auto;'>测试正则</button>` : ''}<button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='save-preview-edit'>${ICONS.save} 保存更改</button></div></div>`;
  bindEditorSearchEvents(previewLayerEl);
  editHistory.stack = [readPreviewSnapshot()];
  editHistory.index = 0;
  updatePreviewHistoryButtons();
  uiCtx.syncOverlayBounds();
}
