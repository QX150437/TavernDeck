import { escapeHtml, notify, logError } from './utils.js';
import { state } from './store.js';
import { refreshAllCatalogs } from './catalog.js';
import { saveInUseToPreset } from './preset-merge.js';
import {
  PRESET_SYSTEM_IDS, PRESET_SETTING_FIELDS, getPresetSummaryList, getPresetDetail,
  savePresetDetail, createNewPresetSafe, renameSavedPresetSafe, deleteSavedPresetSafe,
  exportPresetFile, importPresetFromFile, buildNewPromptEntry,
} from './preset-manager.js';
import {
  ICONS, uiCtx, openConfirm, confirmDiscardDirtyModal,
  editHistory, readPreviewSnapshot, updatePreviewHistoryButtons, pushEditSnapshot,
} from './ui-common.js';

function syncPresetDetailDirty(m) {
  if (!m || m.type !== 'presetDetail') return false;
  if (typeof m.savedSnapshot === 'string') {
    m.dirty = JSON.stringify(m.data) !== m.savedSnapshot;
  }
  return !!m.dirty;
}

export const presetsUiModule = {
  confirmDirty(onProceed) {
    const m = state.modal;
    if (!m || m.type !== 'presetDetail' || !syncPresetDetailDirty(m)) return false;
    const targetName = m.presetName === 'in_use' ? `实时预设 (${state.presetName})` : m.presetName;
    openConfirm({
      title: '未保存修改确认',
      message: `预设「${targetName}」有未保存的修改，关闭后修改将会丢失，是否保存？`,
      confirmText: '放弃修改',
      confirmClass: 'danger',
      extraButton: {
        text: '保存并关闭',
        className: 'primary',
        onClick: () => {
          savePresetDetail(m.presetName, m.data, true)
            .then(() => {
              m.savedSnapshot = JSON.stringify(m.data);
              m.dirty = false;
              notify('success', `已保存预设「${m.presetName}」`);
              return refreshAllCatalogs();
            })
            .then(() => {
              uiCtx.renderMain();
              onProceed();
            })
            .catch((err) => {
              logError('保存预设详情失败', err);
              notify('error', `保存失败: ${err.message || err}`);
            });
        },
      },
      onConfirm: onProceed,
    });
    return true;
  },

  renderModal(m, modalLayerEl) {
    if (m.type === 'presetManager') {
      const info = getPresetSummaryList();
      const q = (m.query || '').trim().toLowerCase();
      const filtered = info.list.filter((p) => !q || p.name.toLowerCase().includes(q));
      const rowsHtml = filtered.map((p) => `
        <div class='td-mgr-row ${p.isLoaded ? 'is-active' : ''}'>
          <div class='td-mgr-row-head'>
            <div class='td-mgr-row-title' title='${escapeHtml(p.name)}'>${escapeHtml(p.name)}</div>
            <div style='display:flex;gap:4px;flex-shrink:0;'>
              ${p.isLoaded ? "<span class='td-mode-tag ok'>使用中</span>" : ''}
              ${p.isDirty ? "<span class='td-mode-tag single'>有未保存修改</span>" : ''}
            </div>
          </div>
          <div class='td-mgr-row-sub'><span>启用 ${p.enabledCount}/${p.promptCount} 条</span>${p.unusedCount > 0 ? `<span>· 未添加池 ${p.unusedCount} 条</span>` : ''}</div>
          <div class='td-mgr-row-actions'>
            ${!p.isLoaded ? `<button class='td-btn sm primary' data-action='pm-load' data-name='${escapeHtml(p.name)}'>加载</button>` : ''}
            ${p.isDirty ? `<button class='td-btn sm warn' data-action='pm-save-inuse-back' data-name='${escapeHtml(p.name)}'>保存实时修改</button>` : ''}
            <button class='td-btn sm' data-action='pm-open-detail' data-name='${escapeHtml(p.name)}'>${ICONS.edit} 条目与参数</button>
            <button class='td-btn sm' data-action='pm-duplicate' data-name='${escapeHtml(p.name)}'>复制</button>
            <button class='td-btn sm' data-action='pm-rename' data-name='${escapeHtml(p.name)}'>重命名</button>
            <button class='td-btn sm' data-action='pm-export' data-name='${escapeHtml(p.name)}'>导出</button>
            <button class='td-btn sm danger' data-action='pm-delete' data-name='${escapeHtml(p.name)}'>删除</button>
          </div>
        </div>`).join('');

      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.layers} 预设管理 (${info.list.length})</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-mgr-topbar'>
              <input class='td-input' id='td-pm-search' type='text' placeholder='搜索预设名称...' value='${escapeHtml(m.query || '')}' />
              <button class='td-btn sm primary' data-action='pm-create'>${ICONS.plus} 新建</button>
              <button class='td-icon-btn ${m.toolsOpen ? 'is-active' : ''}' data-action='pm-toggle-tools' title='更多工具'>${ICONS.more}</button>
            </div>
            <div class='td-mgr-subtools ${m.toolsOpen ? 'is-open' : ''}'>
              <button class='td-btn sm' data-action='pm-save-inuse-as'>${ICONS.save} 另存实时预设</button>
              <button class='td-btn sm' data-action='pm-open-detail' data-name='in_use'>${ICONS.sliders} 编辑实时预设</button>
              <button class='td-btn sm' data-action='pm-trigger-import'>${ICONS.upload} 导入 (.json)</button>
              <input type='file' id='td-pm-import-file' accept='.json,application/json' style='display:none;' />
            </div>
            <div class='td-picker-list td-scroll'>${rowsHtml || "<div class='td-group-empty'>未找到匹配的预设</div>"}</div>
          </div>
          <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>完成</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'presetDetail') {
      const data = m.data, tab = m.tab || 'prompts', q = (m.query || '').trim().toLowerCase();
      const listName = tab === 'unused' ? 'prompts_unused' : 'prompts';
      const list = Array.isArray(data[listName]) ? data[listName] : [];
      const batchMode = !!m.batchMode;
      const selectedSet = m.selectedIdx instanceof Set ? m.selectedIdx : (m.selectedIdx = new Set());

      let bodyHtml = '';
      if (tab === 'settings') {
        const s = data.settings || {};
        const fieldsHtml = PRESET_SETTING_FIELDS.map((f) => {
          const val = s[f.key];
          if (f.type === 'bool') return `<div class='td-setting-row'><div class='td-setting-title' style='font-size:12.5px;'>${escapeHtml(f.label)}</div><input type='checkbox' class='td-checkbox' data-pm-setting='${escapeHtml(f.key)}' data-ftype='bool' ${val ? 'checked' : ''} /></div>`;
          if (f.type === 'select') {
            const opts = f.options.map((o) => `<option value='${escapeHtml(o.v)}' ${String(val) === o.v ? 'selected' : ''}>${escapeHtml(o.t)}</option>`).join('');
            return `<div class='td-field'><label class='td-label'>${escapeHtml(f.label)}</label><select class='td-select' data-pm-setting='${escapeHtml(f.key)}' data-ftype='select'>${opts}</select></div>`;
          }
          return `<div class='td-field'><label class='td-label'>${escapeHtml(f.label)}</label><input class='td-input' type='number' step='${f.step || 1}' min='${f.min ?? ''}' max='${f.max ?? ''}' data-pm-setting='${escapeHtml(f.key)}' data-ftype='number' value='${escapeHtml(val ?? '')}' /></div>`;
        }).join('');
        bodyHtml = `<div class='td-picker-list td-scroll'><div class='td-form-grid'>${fieldsHtml}</div></div>`;
      } else {
        const indexed = list.map((p, idx) => ({ p, idx })).filter(({ p, idx }) => {
          if (!q) return true;
          return `#${idx + 1}`.includes(q)
            || (p.name || '').toLowerCase().includes(q)
            || (p.id || '').toLowerCase().includes(q)
            || (p.content || '').toLowerCase().includes(q);
        });
        const rows = indexed.map(({ p, idx }) => {
          const isSys = PRESET_SYSTEM_IDS.has(p.id);
          const posLabel = p.position?.type === 'in_chat' ? `@D${p.position.depth ?? 0}` : '相对';
          const checked = selectedSet.has(idx);
          return `
            <div class='td-mgr-row ${batchMode && checked ? 'is-active' : ''}' data-idx='${idx}'>
              <div class='td-mgr-row-head'>
                <div style='display:flex;align-items:center;gap:7px;min-width:0;flex:1;'>
                  ${batchMode ? `<input type='checkbox' class='td-checkbox' data-action='pm-batch-check' data-idx='${idx}' ${checked ? 'checked' : ''} />` : ''}
                  <span class='td-idx-badge'>#${idx + 1}</span>
                  <button type='button' class='td-switch sm ${p.enabled ? 'on' : ''}' data-action='pm-toggle-prompt' data-list='${listName}' data-idx='${idx}'></button>
                  <span class='td-mgr-row-title' title='${escapeHtml(p.name || p.id)}'>${escapeHtml(p.name || p.id)}</span>
                </div>
                <span class='td-src-badge'>${escapeHtml(p.role || 'system')} · ${posLabel}</span>
              </div>
              <div class='td-mgr-row-actions'>
                <button class='td-btn sm primary' data-action='pm-edit-content' data-list='${listName}' data-idx='${idx}'>${ICONS.eye} 编辑内容</button>
                <button class='td-btn sm' data-action='pm-edit-prompt' data-list='${listName}' data-idx='${idx}'>${ICONS.edit} 属性</button>
                <button class='td-btn sm' data-action='pm-move-before' data-list='${listName}' data-idx='${idx}'>移动到...</button>
                ${!isSys ? `<button class='td-btn sm' data-action='pm-swap-pool' data-list='${listName}' data-idx='${idx}'>${tab === 'prompts' ? '移入未添加' : '加入列表'}</button>` : ''}
                ${!isSys ? `<button class='td-btn sm danger' data-action='pm-del-prompt' data-list='${listName}' data-idx='${idx}'>删除</button>` : ''}
              </div>
            </div>`;
        }).join('');
        bodyHtml = `
          <div class='td-mgr-topbar'>
            <input class='td-input' id='td-pm-detail-search' type='text' placeholder='搜索序号、名称、ID 或正文...' value='${escapeHtml(m.query || '')}' />
            <button class='td-btn sm primary' data-action='pm-add-prompt' data-list='${listName}'>${ICONS.plus} 新增</button>
            <button class='td-icon-btn ${m.toolsOpen || batchMode ? 'is-active' : ''}' data-action='pm-detail-toggle-tools' title='跳转、批量移动与 AI 编辑'>${ICONS.more}</button>
          </div>
          <div class='td-mgr-subtools ${m.toolsOpen || batchMode ? 'is-open' : ''}'>
            <div style='display:inline-flex;align-items:center;gap:4px;'>
              <input class='td-input' id='td-pm-jump-idx' type='number' min='1' max='${Math.max(1, list.length)}' placeholder='序号' value='${escapeHtml(m.jumpVal || '')}' style='width:68px;height:27px;padding:0 6px;font-size:12px;text-align:center;' />
              <button class='td-btn sm' data-action='pm-jump-idx' title='跳转到指定序号'>跳转</button>
            </div>
            <button class='td-btn sm ${batchMode ? 'primary' : ''}' data-action='pm-toggle-batch'>${batchMode ? `退出批量 (已选 ${selectedSet.size})` : '批量选择移动'}</button>
            ${batchMode ? `<button class='td-btn sm warn' data-action='pm-batch-move'>批量移动到...</button>` : ''}
            ${batchMode && tab === 'unused' ? `<button class='td-btn sm primary' data-action='pm-batch-join'>批量加入主列表</button>` : ''}
            <button class='td-btn sm warn' data-action='pm-open-ai-edit'>${ICONS.sliders} AI 智能编辑</button>
          </div>
          <div class='td-picker-list td-scroll'>${rows || "<div class='td-group-empty'>暂无匹配条目</div>"}</div>`;
      }

      const isDirty = syncPresetDetailDirty(m);
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>预设编辑 · ${escapeHtml(m.presetName === 'in_use' ? `实时预设 (${state.presetName})` : m.presetName)}</div>
            <div style='display:flex;gap:4px;'><button class='td-btn sm' data-action='pm-back-list'>返回</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-source-tabs cols-3'>
              <button class='td-source-tab ${tab === 'prompts' ? 'active' : ''}' data-action='pm-detail-tab' data-tab='prompts'>提示词 (${data.prompts.length})</button>
              <button class='td-source-tab ${tab === 'unused' ? 'active' : ''}' data-action='pm-detail-tab' data-tab='unused'>未添加 (${data.prompts_unused.length})</button>
              <button class='td-source-tab ${tab === 'settings' ? 'active' : ''}' data-action='pm-detail-tab' data-tab='settings'>生成参数</button>
            </div>
            ${bodyHtml}
          </div>
          <div class='td-modal-foot'><span data-role='pm-dirty-label' style='margin-right:auto;font-size:11.5px;color:var(--td-text-muted);'>${isDirty ? '有未保存修改' : '已同步'}</span><button class='td-btn' data-action='pm-back-list'>返回</button><button class='td-btn primary' data-action='pm-save-detail'>${ICONS.save} 保存预设</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  renderPreview(previewLayerEl) {
    if (state.previewCtx?.type === 'pmContentEdit' && state.modal?.type === 'presetDetail') {
      const p = state.previewCtx.prompt;
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>编辑条目内容 · #${state.previewCtx.idx + 1} ${escapeHtml(p.name || p.id)}</div>
            <div style='display:flex;gap:4px;'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body'>
            <div class='td-field'><label class='td-label'>条目名称</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(p.name || '')}' /></div>
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;'><label class='td-label'>提示词正文（支持撤销/重做）</label><textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:220px;'>${escapeHtml(typeof p.content === 'string' ? p.content : '')}</textarea></div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='pm-save-content'>${ICONS.save} 应用到预设</button></div>
        </div>`;
      editHistory.stack = [readPreviewSnapshot()];
      editHistory.index = 0;
      updatePreviewHistoryButtons();
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (state.previewCtx?.type === 'pmPromptEdit') {
      const p = state.previewCtx.prompt, isInChat = p.position?.type === 'in_chat';
      const isPlaceholder = PRESET_SYSTEM_IDS.has(p.id) && typeof p.content !== 'string';
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>${state.previewCtx.isNew ? '新增预设条目' : `条目属性 · ${escapeHtml(p.name || p.id)}`}</div>
            <div style='display:flex;gap:4px;'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body'>
            <div style='display:flex;gap:8px;align-items:center;'><div class='td-field' style='flex:1;'><label class='td-label'>条目名称</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(p.name || '')}' /></div><label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'><input type='checkbox' class='td-checkbox' id='td-pm-p-enabled' ${p.enabled ? 'checked' : ''} /><span>启用</span></label></div>
            <div class='td-form-grid'>
              <div class='td-field'><label class='td-label'>角色身份 (Role)</label><select class='td-select' id='td-pm-p-role'><option value='system' ${p.role === 'system' ? 'selected' : ''}>System</option><option value='user' ${p.role === 'user' ? 'selected' : ''}>User</option><option value='assistant' ${p.role === 'assistant' ? 'selected' : ''}>Assistant</option></select></div>
              <div class='td-field'><label class='td-label'>插入位置</label><select class='td-select' id='td-pm-p-postype'><option value='relative' ${!isInChat ? 'selected' : ''}>相对位置 (Relative)</option><option value='in_chat' ${isInChat ? 'selected' : ''}>聊天深度 (In-Chat @D)</option></select></div>
              <div class='td-field'><label class='td-label'>深度 (Depth, @D有效)</label><input class='td-input' id='td-pm-p-depth' type='number' value='${escapeHtml(p.position?.depth ?? 4)}' /></div>
              <div class='td-field'><label class='td-label'>顺序 (Order, @D有效)</label><input class='td-input' id='td-pm-p-order' type='number' value='${escapeHtml(p.position?.order ?? 100)}' /></div>
            </div>
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;'><label class='td-label'>提示词正文 ${isPlaceholder ? '（占位符条目一般留空）' : '（支持撤销/重做）'}</label><textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:150px;'>${escapeHtml(typeof p.content === 'string' ? p.content : '')}</textarea></div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='pm-save-prompt'>${ICONS.save} 确认</button></div>
        </div>`;
      editHistory.stack = [readPreviewSnapshot()];
      editHistory.index = 0;
      updatePreviewHistoryButtons();
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  handleClick(e, actionEl, action) {
    const modalLayerEl = uiCtx.getModalLayer();
    const previewLayerEl = uiCtx.getPreviewLayer();

    if (action === 'open-preset-manager') { state.modal = { type: 'presetManager', query: '', toolsOpen: false }; uiCtx.renderModal(); return true; }
    if (action === 'pm-toggle-tools' && state.modal?.type === 'presetManager') { state.modal.toolsOpen = !state.modal.toolsOpen; uiCtx.renderModal(); return true; }
    if (action === 'pm-load') { uiCtx.performSwitchPreset(actionEl.getAttribute('data-name')); setTimeout(() => { if (state.modal?.type === 'presetManager') uiCtx.renderModal(); }, 180); return true; }
    if (action === 'pm-save-inuse-back') { saveInUseToPreset(actionEl.getAttribute('data-name')).then(() => uiCtx.renderModal()).catch((err) => { logError('保存实时修改回预设失败', err); notify('error', err.message || String(err)); }); return true; }
    if (action === 'pm-create') {
      const name = window.prompt('请输入新建预设名称：', ''); if (!name || !name.trim()) return true;
      createNewPresetSafe(name.trim()).then(() => refreshAllCatalogs()).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('新建预设失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'pm-save-inuse-as') {
      const name = window.prompt('将当前实时预设另存为：', `${state.presetName || '预设'}-副本`); if (!name || !name.trim()) return true;
      createNewPresetSafe(name.trim(), 'in_use').then(() => refreshAllCatalogs()).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('另存预设失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'pm-duplicate') {
      const src = actionEl.getAttribute('data-name'); const name = window.prompt(`复制预设「${src}」为：`, `${src}-副本`); if (!name || !name.trim()) return true;
      createNewPresetSafe(name.trim(), src).then(() => refreshAllCatalogs()).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('复制预设失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'pm-rename') {
      const oldName = actionEl.getAttribute('data-name'); const newName = window.prompt(`重命名预设「${oldName}」为：`, oldName);
      if (!newName || !newName.trim() || newName.trim() === oldName) return true;
      renameSavedPresetSafe(oldName, newName.trim()).then(() => refreshAllCatalogs()).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('重命名预设失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'pm-export') { try { exportPresetFile(actionEl.getAttribute('data-name')); } catch (err) { logError('导出预设失败', err); notify('error', err.message || String(err)); } return true; }
    if (action === 'pm-trigger-import') { modalLayerEl?.querySelector('#td-pm-import-file')?.click(); return true; }
    if (action === 'pm-delete') {
      const name = actionEl.getAttribute('data-name');
      openConfirm({
        title: '删除预设确认', message: `确定要永久删除预设「${name}」吗？`, confirmText: '确认删除',
        onConfirm: () => deleteSavedPresetSafe(name).then(() => refreshAllCatalogs()).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('删除预设失败', err); notify('error', err.message || String(err)); }),
      });
      return true;
    }
    if (action === 'pm-open-detail') {
      const name = actionEl.getAttribute('data-name');
      try {
        const detailData = getPresetDetail(name);
        state.modal = { type: 'presetDetail', presetName: name, data: detailData, savedSnapshot: JSON.stringify(detailData), tab: 'prompts', query: '', dirty: false, toolsOpen: false, batchMode: false, selectedIdx: new Set() };
        uiCtx.renderModal();
      }
      catch (err) { logError('读取预设详情失败', err); notify('error', err.message || String(err)); }
      return true;
    }
    if (action === 'pm-back-list' && state.modal?.type === 'presetDetail') {
      confirmDiscardDirtyModal(() => {
        state.modal = { type: 'presetManager', query: '', toolsOpen: false };
        uiCtx.renderModal();
      });
      return true;
    }
    if (action === 'pm-detail-tab' && state.modal?.type === 'presetDetail') { state.modal.tab = actionEl.getAttribute('data-tab') || 'prompts'; state.modal.selectedIdx = new Set(); uiCtx.renderModal(); return true; }
    if (action === 'pm-detail-toggle-tools' && state.modal?.type === 'presetDetail') { state.modal.toolsOpen = !state.modal.toolsOpen; uiCtx.renderModal(); return true; }
    if (action === 'pm-jump-idx' && state.modal?.type === 'presetDetail') {
      const listName = state.modal.tab === 'unused' ? 'prompts_unused' : 'prompts';
      const list = state.modal.data[listName] || [];
      const num = Number(modalLayerEl?.querySelector('#td-pm-jump-idx')?.value);
      if (Number.isNaN(num) || num < 1 || num > list.length) {
        notify('warning', `请输入 1 ~ ${list.length} 之间的有效序号`);
        return true;
      }
      const targetIdx = Math.floor(num) - 1;
      const scrollToRow = () => {
        const box = modalLayerEl?.querySelector('.td-picker-list');
        const row = box?.querySelector(`.td-mgr-row[data-idx='${targetIdx}']`);
        if (!box || !row) return;
        const boxRect = box.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        box.scrollTo({ top: box.scrollTop + (rowRect.top - boxRect.top) - 8, behavior: 'smooth' });
        row.style.transition = 'box-shadow 0.25s ease';
        row.style.boxShadow = '0 0 0 2px var(--td-accent)';
        setTimeout(() => { if (row.isConnected) row.style.boxShadow = ''; }, 1600);
      };
      if (!modalLayerEl?.querySelector(`.td-mgr-row[data-idx='${targetIdx}']`) && (state.modal.query || '').trim()) {
        state.modal.query = '';
        uiCtx.renderModal();
        requestAnimationFrame(scrollToRow);
      } else {
        scrollToRow();
      }
      return true;
    }
    if (action === 'pm-toggle-batch' && state.modal?.type === 'presetDetail') {
      state.modal.batchMode = !state.modal.batchMode; state.modal.selectedIdx = new Set(); uiCtx.renderModal(); return true;
    }
    if (action === 'pm-batch-check' && state.modal?.type === 'presetDetail') {
      const idx = Number(actionEl.getAttribute('data-idx'));
      if (state.modal.selectedIdx.has(idx)) state.modal.selectedIdx.delete(idx);
      else state.modal.selectedIdx.add(idx);
      actionEl.closest('.td-mgr-row')?.classList.toggle('is-active', state.modal.selectedIdx.has(idx));
      const batchBtn = modalLayerEl?.querySelector("[data-action='pm-toggle-batch']");
      if (batchBtn) batchBtn.textContent = `退出批量 (已选 ${state.modal.selectedIdx.size})`;
      return true;
    }
    if (action === 'pm-batch-move' && state.modal?.type === 'presetDetail') {
      const indices = Array.from(state.modal.selectedIdx || []);
      if (indices.length === 0) { notify('warning', '请先勾选要移动的条目'); return true; }
      const listName = state.modal.tab === 'unused' ? 'prompts_unused' : 'prompts';
      state.selectPopup = { type: 'movePromptTarget', mode: 'move', listName, fromIndices: indices };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'pm-batch-join' && state.modal?.type === 'presetDetail' && state.modal.tab === 'unused') {
      const indices = Array.from(state.modal.selectedIdx || []);
      if (indices.length === 0) { notify('warning', '请先勾选要加入主列表的条目'); return true; }
      state.selectPopup = { type: 'movePromptTarget', mode: 'insertFromUnused', listName: 'prompts', fromIndices: indices };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'pm-toggle-prompt' && state.modal?.type === 'presetDetail') {
      const list = state.modal.data[actionEl.getAttribute('data-list')], idx = Number(actionEl.getAttribute('data-idx'));
      if (list && list[idx]) {
        list[idx].enabled = !list[idx].enabled;
        const isDirty = syncPresetDetailDirty(state.modal);
        actionEl.classList.toggle('on', !!list[idx].enabled);
        const dirtyEl = modalLayerEl?.querySelector("[data-role='pm-dirty-label']");
        if (dirtyEl) dirtyEl.textContent = isDirty ? '有未保存修改' : '已同步';
      }
      return true;
    }
    if (action === 'pm-move-before' && state.modal?.type === 'presetDetail') {
      state.selectPopup = { type: 'movePromptTarget', mode: 'move', listName: actionEl.getAttribute('data-list'), fromIndices: [Number(actionEl.getAttribute('data-idx'))] };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'pm-swap-pool' && state.modal?.type === 'presetDetail') {
      const listName = actionEl.getAttribute('data-list'), idx = Number(actionEl.getAttribute('data-idx'));
      const p = state.modal.data[listName]?.[idx]; if (!p) return true;
      if (listName === 'prompts_unused') {
        state.selectPopup = { type: 'movePromptTarget', mode: 'insertFromUnused', listName: 'prompts', fromIndices: [idx] };
        uiCtx.renderSelectPopup();
        return true;
      }
      openConfirm({
        title: '移入未添加池确认', message: `确定要将条目 #${idx + 1}「${p.name || p.id}」移入未添加池吗？`, confirmText: '确认移动', confirmClass: 'warn',
        onConfirm: () => {
          const [moved] = state.modal.data.prompts.splice(idx, 1);
          if (moved) { state.modal.data.prompts_unused.push(moved); state.modal.dirty = true; uiCtx.renderModal(); }
        },
      });
      return true;
    }
    if (action === 'pm-del-prompt' && state.modal?.type === 'presetDetail') {
      const listName = actionEl.getAttribute('data-list'), idx = Number(actionEl.getAttribute('data-idx'));
      const p = state.modal.data[listName]?.[idx]; if (!p) return true;
      openConfirm({
        title: '删除预设条目确认', message: `确定要从当前预设中永久删除条目 #${idx + 1}「${p.name || p.id}」吗？`, confirmText: '确认删除',
        onConfirm: () => { state.modal.data[listName].splice(idx, 1); state.modal.dirty = true; uiCtx.renderModal(); },
      });
      return true;
    }
    if (action === 'pm-edit-content' && state.modal?.type === 'presetDetail') {
      const listName = actionEl.getAttribute('data-list') || 'prompts', idx = Number(actionEl.getAttribute('data-idx'));
      const p = state.modal.data[listName]?.[idx]; if (!p) return true;
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'pmContentEdit', listName, idx, prompt: JSON.parse(JSON.stringify(p)) };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'pm-save-content' && state.previewCtx?.type === 'pmContentEdit' && state.modal?.type === 'presetDetail') {
      pushEditSnapshot(true);
      const snap = readPreviewSnapshot(), target = state.modal.data[state.previewCtx.listName]?.[state.previewCtx.idx];
      if (target && snap) {
        if (snap.name.trim()) target.name = snap.name.trim();
        if (typeof target.content === 'string' || snap.content.length > 0 || !PRESET_SYSTEM_IDS.has(target.id)) target.content = snap.content;
        state.modal.dirty = true;
      }
      state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
      return true;
    }
    if (action === 'pm-add-prompt' && state.modal?.type === 'presetDetail') {
      const listName = actionEl.getAttribute('data-list') || 'prompts';
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'pmPromptEdit', listName, idx: -1, isNew: true, prompt: buildNewPromptEntry({}) };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'pm-edit-prompt' && state.modal?.type === 'presetDetail') {
      const listName = actionEl.getAttribute('data-list') || 'prompts', idx = Number(actionEl.getAttribute('data-idx'));
      const p = state.modal.data[listName]?.[idx]; if (!p) return true;
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'pmPromptEdit', listName, idx, isNew: false, prompt: JSON.parse(JSON.stringify(p)) };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'pm-save-prompt' && state.previewCtx?.type === 'pmPromptEdit' && state.modal?.type === 'presetDetail') {
      pushEditSnapshot(true);
      const snap = readPreviewSnapshot(), p = JSON.parse(JSON.stringify(state.previewCtx.prompt));
      p.name = (snap?.name || '').trim() || p.name || '未命名条目';
      p.enabled = !!previewLayerEl?.querySelector('#td-pm-p-enabled')?.checked;
      p.role = previewLayerEl?.querySelector('#td-pm-p-role')?.value || 'system';
      const posType = previewLayerEl?.querySelector('#td-pm-p-postype')?.value || 'relative';
      if (!PRESET_SYSTEM_IDS.has(p.id) || p.position) {
        p.position = posType === 'in_chat'
          ? { type: 'in_chat', depth: Number(previewLayerEl?.querySelector('#td-pm-p-depth')?.value) || 0, order: Number(previewLayerEl?.querySelector('#td-pm-p-order')?.value) || 100 }
          : { type: 'relative' };
      }
      const contentVal = snap?.content ?? '';
      if (typeof p.content === 'string' || contentVal.length > 0 || !PRESET_SYSTEM_IDS.has(p.id)) p.content = contentVal;
      const targetList = state.modal.data[state.previewCtx.listName];
      if (state.previewCtx.isNew) targetList.push(p); else targetList[state.previewCtx.idx] = p;
      state.modal.dirty = true; state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
      return true;
    }
    if (action === 'pm-save-detail' && state.modal?.type === 'presetDetail') {
      savePresetDetail(state.modal.presetName, state.modal.data, true).then(() => {
        state.modal.savedSnapshot = JSON.stringify(state.modal.data);
        state.modal.dirty = false; notify('success', `已保存预设「${state.modal.presetName}」`); return refreshAllCatalogs();
      }).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('保存预设详情失败', err); notify('error', `保存失败: ${err.message || err}`); });
      return true;
    }
    if (action === 'pm-open-ai-edit' && state.modal?.type === 'presetDetail') {
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'pmAiEdit', step: 'setup', selectedKeys: new Set(), instruction: '', search: '', loading: false, results: [] };
      uiCtx.renderPreviewModal();
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    if (id === 'td-pm-search' && state.modal?.type === 'presetManager') { state.modal.query = target.value; uiCtx.renderModal(); return true; }
    if (id === 'td-pm-detail-search' && state.modal?.type === 'presetDetail') { state.modal.query = target.value; uiCtx.renderModal(); return true; }
    if (id === 'td-pm-jump-idx' && state.modal?.type === 'presetDetail') { state.modal.jumpVal = target.value; return true; }
    return false;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';

    if (target.hasAttribute('data-pm-setting') && state.modal?.type === 'presetDetail') {
      const key = target.getAttribute('data-pm-setting'), ftype = target.getAttribute('data-ftype');
      if (ftype === 'bool') state.modal.data.settings[key] = !!target.checked;
      else if (ftype === 'number') state.modal.data.settings[key] = Number(target.value);
      else state.modal.data.settings[key] = target.value;
      const isDirty = syncPresetDetailDirty(state.modal);
      const dirtyEl = uiCtx.getModalLayer()?.querySelector("[data-role='pm-dirty-label']");
      if (dirtyEl) dirtyEl.textContent = isDirty ? '有未保存修改' : '已同步';
      return true;
    }

    if (id === 'td-pm-import-file') {
      const file = target.files?.[0]; if (!file) return true;
      importPresetFromFile(file).then(() => refreshAllCatalogs()).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('导入预设文件失败', err); notify('error', err.message || String(err)); });
      return true;
    }

    return false;
  },
};
