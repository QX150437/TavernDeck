import { escapeHtml, notify, computeLineDiff, logError } from './utils.js';
import { state } from './store.js';
import { refreshAllCatalogs } from './catalog.js';
import { saveInUseToPreset } from './preset-merge.js';
import {
  PRESET_SYSTEM_IDS, PRESET_SETTING_FIELDS, getPresetSummaryList, getPresetDetail,
  savePresetDetail, createNewPresetSafe, renameSavedPresetSafe, deleteSavedPresetSafe,
  exportPresetFile, buildNewPromptEntry,
} from './preset-manager.js';
import {
  ICONS, uiCtx, openConfirm, confirmDiscardDirtyModal,
  editHistory, readPreviewSnapshot, updatePreviewHistoryButtons, pushEditSnapshot,
} from './ui-common.js';
import { renderQuickInsertHtml } from './ui-snippets.js';
import { renderSearchableTextareaHtml, bindEditorSearchEvents } from './ui-editor-search.js';

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
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.layers} 预设管理 (${info.list.length})</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='presetManager' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div>
          <div class='td-modal-body td-picker-body' style='gap:7px;'>
            <div class='td-compact-bar'>
              <input class='td-input' id='td-pm-search' type='text' placeholder='搜索预设名称...' value='${escapeHtml(m.query || '')}' style='flex:1;min-width:110px;height:30px;font-size:12.5px;border-radius:8px;' />
              <button class='td-btn xs' data-action='pm-save-inuse-as' style='min-height:30px;'>${ICONS.save} 另存实时预设</button>
              <button class='td-btn xs' data-action='pm-open-detail' data-name='in_use' style='min-height:30px;'>${ICONS.sliders} 编辑实时预设</button>
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
                  ${p.extra?.tdAiTag ? `<span class='td-mode-tag ok'>${escapeHtml(p.extra.tdAiTag)}</span>` : ''}
                  <span class='td-mgr-row-title' title='${escapeHtml(p.name || p.id)}'>${escapeHtml(p.name || p.id)}</span>
                </div>
                <div style='display:flex;align-items:center;gap:7px;flex-shrink:0;'>
                  <span class='td-src-badge'>${escapeHtml(p.role || 'system')} · ${posLabel}</span>
                  <button type='button' class='td-switch sm ${p.enabled ? 'on' : ''}' data-action='pm-toggle-prompt' data-list='${listName}' data-idx='${idx}'></button>
                </div>
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
          <div class='td-compact-bar'>
            <div class='td-search-input-wrap' style='flex:1;min-width:105px;'>
              <input class='td-input' id='td-pm-detail-search' type='text' placeholder='搜索序号/名称/正文...' value='${escapeHtml(m.query || '')}' style='height:30px;font-size:12.5px;padding:0 ${m.query ? '24px' : '9px'} 0 9px;border-radius:8px;' />
              ${m.query ? `<button type='button' class='td-search-clear' data-action='pm-clear-detail-search' title='清空搜索' style='width:22px;height:22px;right:3px;'>${ICONS.close}</button>` : ''}
            </div>
            <div class='td-jump-group'>
              <input class='td-input' id='td-pm-jump-idx' type='number' min='1' max='${Math.max(1, list.length)}' placeholder='#序号' value='${escapeHtml(m.jumpVal || '')}' />
              <button type='button' class='td-btn xs' data-action='pm-jump-idx' title='跳转到指定序号'>跳转</button>
            </div>
            <button type='button' class='td-btn sm primary' data-action='pm-add-prompt' data-list='${listName}' style='min-height:30px;'>${ICONS.plus} 新增</button>
          </div>
          <div class='td-compact-actions'>
            <button type='button' class='td-btn xs ${batchMode ? 'primary' : ''}' data-action='pm-toggle-batch'>${batchMode ? `退出批量 (${selectedSet.size})` : '批量移动'}</button>
            ${batchMode ? `<button type='button' class='td-btn xs warn' data-action='pm-batch-move'>移动所选</button>` : ''}
            ${batchMode && tab === 'unused' ? `<button type='button' class='td-btn xs primary' data-action='pm-batch-join'>加入主列表</button>` : ''}
            <button type='button' class='td-btn xs' data-action='pm-open-diff-compare'>${ICONS.gitMerge} Diff 比对${batchMode && selectedSet.size >= 2 ? ` (${selectedSet.size})` : ''}</button>
            <button type='button' class='td-btn xs' data-action='pm-open-var-check'>${ICONS.code} 变量检测</button>
            <button type='button' class='td-btn xs warn' data-action='pm-open-ai-edit'>${ICONS.sliders} AI 编辑</button>
          </div>
          <div class='td-picker-list td-scroll'>${rows || "<div class='td-group-empty'>暂无匹配条目</div>"}</div>`;
      }

      const isDirty = syncPresetDetailDirty(m);
      const detailTitle = `预设编辑 · ${m.presetName === 'in_use' ? `实时预设 (${state.presetName})` : m.presetName}`;
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title' title='${escapeHtml(detailTitle)}'>${escapeHtml(detailTitle)}</div>
            <div class='td-modal-head-actions'><button class='td-btn sm' data-action='pm-open-snapshots'>${ICONS.camera} 快照</button><button class='td-btn sm' data-action='pm-back-list'>返回</button><button class='td-icon-btn' data-action='open-help' data-help-key='presetDetail' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
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
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;min-height:0;'><label class='td-label'>提示词正文（支持撤销/重做）</label>${renderQuickInsertHtml('td-edit-content')}${renderSearchableTextareaHtml({ id: 'td-edit-content', value: typeof p.content === 'string' ? p.content : '', minHeight: '200px' })}</div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='pm-save-content'>${ICONS.save} 应用到预设</button></div>
        </div>`;
      bindEditorSearchEvents(previewLayerEl);
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
            <div class='td-modal-head-actions'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='open-help' data-help-key='pmPromptEdit' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body'>
            <div style='display:flex;gap:8px;align-items:center;'><div class='td-field' style='flex:1;'><label class='td-label'>条目名称</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(p.name || '')}' /></div><label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'><input type='checkbox' class='td-checkbox' id='td-pm-p-enabled' ${p.enabled ? 'checked' : ''} /><span>启用</span></label></div>
            <div class='td-form-grid'>
              <div class='td-field'><label class='td-label'>角色身份 (Role)</label><select class='td-select' id='td-pm-p-role'><option value='system' ${p.role === 'system' ? 'selected' : ''}>System</option><option value='user' ${p.role === 'user' ? 'selected' : ''}>User</option><option value='assistant' ${p.role === 'assistant' ? 'selected' : ''}>Assistant</option></select></div>
              <div class='td-field'><label class='td-label'>插入位置</label><select class='td-select' id='td-pm-p-postype'><option value='relative' ${!isInChat ? 'selected' : ''}>相对位置 (Relative)</option><option value='in_chat' ${isInChat ? 'selected' : ''}>聊天深度 (In-Chat @D)</option></select></div>
              <div class='td-field'><label class='td-label'>深度 (Depth, @D有效)</label><input class='td-input' id='td-pm-p-depth' type='number' value='${escapeHtml(p.position?.depth ?? 4)}' /></div>
              <div class='td-field'><label class='td-label'>顺序 (Order, @D有效)</label><input class='td-input' id='td-pm-p-order' type='number' value='${escapeHtml(p.position?.order ?? 100)}' /></div>
            </div>
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;min-height:180px;'><label class='td-label'>提示词正文 ${isPlaceholder ? '（占位符条目一般留空）' : '（支持撤销/重做）'}</label>${renderQuickInsertHtml('td-edit-content')}${renderSearchableTextareaHtml({ id: 'td-edit-content', value: typeof p.content === 'string' ? p.content : '', minHeight: '150px' })}</div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='pm-save-prompt'>${ICONS.save} 确认</button></div>
        </div>`;
      bindEditorSearchEvents(previewLayerEl);
      editHistory.stack = [readPreviewSnapshot()];
      editHistory.index = 0;
      updatePreviewHistoryButtons();
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (state.previewCtx?.type === 'pmDiffCompare' && state.modal?.type === 'presetDetail') {
      const dc = state.previewCtx;
      const allEntries = [];
      ['prompts', 'prompts_unused'].forEach((ln) => {
        (state.modal.data[ln] || []).forEach((p, idx) => {
          const key = `${ln}::${idx}`;
          const prefix = ln === 'prompts_unused' ? '池' : '主';
          allEntries.push({
            key,
            listName: ln,
            idx,
            prompt: p,
            badge: `${prefix}#${idx + 1}`,
            name: p.name || p.id || `条目 #${idx + 1}`,
            label: `[${prefix}#${idx + 1}] ${p.name || p.id || `条目 #${idx + 1}`}`,
            content: typeof p.content === 'string' ? p.content : '',
          });
        });
      });
      const entryByKey = new Map(allEntries.map((x) => [x.key, x]));
      dc.selectedKeys = (dc.selectedKeys || []).filter((k) => entryByKey.has(k));
      const selectedSet = new Set(dc.selectedKeys);

      if (dc.step === 'compare' && dc.selectedKeys.length >= 2) {
        const selectedItems = dc.selectedKeys.map((k) => entryByKey.get(k)).filter(Boolean);
        if (!selectedSet.has(dc.baseKey)) dc.baseKey = selectedItems[0].key;
        if (!selectedSet.has(dc.pairKeyA)) dc.pairKeyA = selectedItems[0].key;
        if (!selectedSet.has(dc.pairKeyB) || dc.pairKeyB === dc.pairKeyA) {
          dc.pairKeyB = (selectedItems.find((x) => x.key !== dc.pairKeyA) || selectedItems[1]).key;
        }
        const compareMode = selectedItems.length > 2 && dc.compareMode === 'pair' ? 'pair' : 'base';
        const onlyDiff = !!dc.onlyDiffLines;
        if (!(dc.collapsedKeys instanceof Set)) dc.collapsedKeys = new Set();

        let pairs = [];
        let topBarHtml = '';
        if (selectedItems.length === 2) {
          const baseItem = entryByKey.get(dc.baseKey) || selectedItems[0];
          const targetItem = selectedItems.find((x) => x.key !== baseItem.key) || selectedItems[1];
          pairs = [{ base: baseItem, target: targetItem }];
          const opts = selectedItems.map((it) => `<option value='${escapeHtml(it.key)}' ${it.key === baseItem.key ? 'selected' : ''}>${escapeHtml(it.label)}</option>`).join('');
          topBarHtml = `
            <div class='td-diff-ctl-row'>
              <span class='td-bar-label' style='width:auto;'>基准(A)</span>
              <select class='td-select' id='td-pm-diff-base-sel' style='height:30px;font-size:12px;'>${opts}</select>
              <button type='button' class='td-btn sm' data-action='pm-diff-swap-ab'>${ICONS.swap} 互换 A/B</button>
            </div>`;
        } else if (compareMode === 'pair') {
          const itemA = entryByKey.get(dc.pairKeyA) || selectedItems[0];
          const itemB = entryByKey.get(dc.pairKeyB) || selectedItems[1];
          pairs = [{ base: itemA, target: itemB }];
          const optsA = selectedItems.map((it) => `<option value='${escapeHtml(it.key)}' ${it.key === itemA.key ? 'selected' : ''}>${escapeHtml(it.label)}</option>`).join('');
          const optsB = selectedItems.map((it) => `<option value='${escapeHtml(it.key)}' ${it.key === itemB.key ? 'selected' : ''}>${escapeHtml(it.label)}</option>`).join('');
          topBarHtml = `
            <div class='td-form-grid' style='gap:6px;'>
              <div class='td-field' style='gap:3px;'><span class='td-label' style='font-size:11px;'>基准条目 (A · -)</span><select class='td-select' id='td-pm-diff-pair-a' style='height:30px;font-size:12px;'>${optsA}</select></div>
              <div class='td-field' style='gap:3px;'><span class='td-label' style='font-size:11px;'>对比条目 (B · +)</span><select class='td-select' id='td-pm-diff-pair-b' style='height:30px;font-size:12px;'>${optsB}</select></div>
            </div>`;
        } else {
          const baseItem = entryByKey.get(dc.baseKey) || selectedItems[0];
          pairs = selectedItems.filter((x) => x.key !== baseItem.key).map((target) => ({ base: baseItem, target }));
          const opts = selectedItems.map((it) => `<option value='${escapeHtml(it.key)}' ${it.key === baseItem.key ? 'selected' : ''}>${escapeHtml(it.label)}</option>`).join('');
          topBarHtml = `
            <div class='td-diff-ctl-row'>
              <span class='td-bar-label' style='width:auto;'>基准(-)</span>
              <select class='td-select' id='td-pm-diff-base-sel' style='height:30px;font-size:12px;'>${opts}</select>
            </div>`;
        }

        const cardsHtml = pairs.map(({ base, target }) => {
          const isSame = base.content === target.content;
          const allLines = isSame ? [] : computeLineDiff(base.content, target.content);
          const delCnt = allLines.filter((l) => l.type === 'del').length;
          const addCnt = allLines.filter((l) => l.type === 'add').length;
          const showLines = onlyDiff ? allLines.filter((l) => l.type !== 'ctx') : allLines;
          const isCollapsed = pairs.length > 1 && dc.collapsedKeys.has(target.key);
          return `
            <div class='td-merge-card'>
              <div class='td-merge-head' data-action='pm-diff-toggle-card' data-key='${escapeHtml(target.key)}'>
                <span class='td-idx-badge'>${escapeHtml(target.badge)}</span>
                <span class='td-merge-title' title='${escapeHtml(target.name)}'>${escapeHtml(target.name)}</span>
                ${isSame
                  ? "<span class='td-mode-tag ok'>正文一致</span>"
                  : `<span class='td-mode-tag single'>-${delCnt} / +${addCnt}</span>`}
                ${selectedItems.length > 2 && compareMode === 'base'
                  ? `<button type='button' class='td-btn xs' data-action='pm-diff-set-base' data-key='${escapeHtml(target.key)}' title='以此条目作为基准'>设为基准</button>`
                  : ''}
              </div>
              ${!isCollapsed ? `
                <div class='td-merge-body'>
                  <div style='font-size:11px;color:var(--td-text-muted);'>对比基准：${escapeHtml(base.label)} → ${escapeHtml(target.label)}（仅正文）</div>
                  ${isSame
                    ? "<div class='td-group-empty' style='padding:10px;'>两条目提示词正文完全一致</div>"
                    : `<div class='td-diff-box td-scroll' style='max-height:${pairs.length === 1 ? 'none' : '240px'};flex:1;'>${showLines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`}
                </div>` : ''}
            </div>`;
        }).join('');

        previewLayerEl.classList.add('is-open');
        previewLayerEl.innerHTML = `
          <div class='td-modal td-modal-tall'>
            <div class='td-modal-head'>
              <div class='td-modal-title'>正文 Diff 比对 (已选 ${selectedItems.length} 项)</div>
              <div class='td-modal-head-actions'>
                <button type='button' class='td-icon-btn' data-action='open-help' data-help-key='pmDiffCompare' title='功能说明'>${ICONS.help}</button>
                <button type='button' class='td-icon-btn' data-action='close-preview' title='关闭'>${ICONS.close}</button>
              </div>
            </div>
            <div class='td-modal-body td-picker-body' style='gap:7px;'>
              <div style='font-size:11.5px;color:var(--td-text-muted);flex-shrink:0;'>仅比对提示词正文（<span style='color:#f87171;'>- 基准条目</span> / <span style='color:#34d399;'>+ 对比条目</span>）</div>
              ${topBarHtml}
              <div class='td-filter-bar'>
                ${selectedItems.length > 2 ? `
                  <button type='button' class='td-chip ${compareMode === 'base' ? 'active' : ''}' data-action='pm-diff-set-mode' data-mode='base'>基准对照全部 (${selectedItems.length - 1})</button>
                  <button type='button' class='td-chip ${compareMode === 'pair' ? 'active' : ''}' data-action='pm-diff-set-mode' data-mode='pair'>任意两条互比</button>` : ''}
                <button type='button' class='td-chip ${onlyDiff ? 'active' : ''}' data-action='pm-diff-toggle-only-diff'>${onlyDiff ? '✓ 仅看差异行' : '仅看差异行'}</button>
                <button type='button' class='td-chip' data-action='pm-diff-back-select'>重选条目 (${selectedItems.length})</button>
              </div>
              <div class='td-picker-list td-scroll'>${cardsHtml}</div>
            </div>
            <div class='td-modal-foot'>
              <button type='button' class='td-btn' data-action='pm-diff-back-select'>修改选择</button>
              <button type='button' class='td-btn primary' data-action='close-preview'>完成</button>
            </div>
          </div>`;
        uiCtx.syncOverlayBounds();
        return true;
      }

      dc.step = 'select';
      const scope = dc.scopeFilter || 'all';
      const q = (dc.search || '').trim().toLowerCase();
      const visible = allEntries.filter((it) => {
        if (scope === 'prompts' && it.listName !== 'prompts') return false;
        if (scope === 'unused' && it.listName !== 'prompts_unused') return false;
        if (scope === 'selected' && !selectedSet.has(it.key)) return false;
        if (!q) return true;
        return it.badge.toLowerCase().includes(q) || it.name.toLowerCase().includes(q) || it.content.toLowerCase().includes(q);
      });

      const rowsHtml = visible.map((it) => {
        const checked = selectedSet.has(it.key);
        const orderIdx = checked ? dc.selectedKeys.indexOf(it.key) + 1 : 0;
        const isBase = checked && (dc.baseKey ? dc.baseKey === it.key : orderIdx === 1);
        return `
          <div class='td-picker-row ${checked ? 'checked' : ''}' style='min-height:40px;padding:7px 10px;' data-action='pm-diff-toggle-key' data-key='${escapeHtml(it.key)}'>
            <div class='td-picker-left'>
              <input type='checkbox' class='td-checkbox' ${checked ? 'checked' : ''} tabindex='-1' />
              <span class='td-idx-badge'>${escapeHtml(it.badge)}</span>
              <span class='td-item-name' style='font-size:13px;' title='${escapeHtml(it.name)}'>${escapeHtml(it.name)}</span>
            </div>
            <div style='display:flex;align-items:center;gap:5px;flex-shrink:0;'>
              ${isBase ? "<span class='td-mode-tag single'>基准</span>" : (checked ? `<button type='button' class='td-btn xs' data-action='pm-diff-set-base' data-key='${escapeHtml(it.key)}'>设为基准</button>` : '')}
              <span class='td-src-badge'>${it.prompt.enabled ? '开' : '关'} · ${it.content.length}字</span>
            </div>
          </div>`;
      }).join('') || "<div class='td-group-empty'>无匹配条目</div>";

      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>自由 Diff 比对 · 选择条目（仅正文）</div>
            <div class='td-modal-head-actions'>
              <button type='button' class='td-icon-btn' data-action='open-help' data-help-key='pmDiffCompare' title='功能说明'>${ICONS.help}</button>
              <button type='button' class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button>
            </div>
          </div>
          <div class='td-modal-body td-picker-body' style='gap:7px;'>
            <div style='font-size:12px;color:var(--td-text-muted);flex-shrink:0;'>自由勾选 2 个或更多条目（可跨主列表与未添加池），仅比对条目提示词正文。</div>
            <input class='td-input' id='td-pm-diff-search' type='text' placeholder='搜索序号、条目名称或正文内容...' value='${escapeHtml(dc.search || '')}' style='height:34px;font-size:13px;' />
            <div class='td-filter-bar'>
              <button type='button' class='td-chip ${scope === 'all' ? 'active' : ''}' data-action='pm-diff-set-scope' data-scope='all'>全部</button>
              <button type='button' class='td-chip ${scope === 'prompts' ? 'active' : ''}' data-action='pm-diff-set-scope' data-scope='prompts'>主列表</button>
              <button type='button' class='td-chip ${scope === 'unused' ? 'active' : ''}' data-action='pm-diff-set-scope' data-scope='unused'>未添加池</button>
              <button type='button' class='td-chip ${scope === 'selected' ? 'active' : ''}' data-action='pm-diff-set-scope' data-scope='selected'>已选 (${dc.selectedKeys.length})</button>
              ${dc.selectedKeys.length > 0 ? `<button type='button' class='td-chip' data-action='pm-diff-clear-sel'>清空已选</button>` : ''}
            </div>
            <div class='td-picker-list td-scroll'>${rowsHtml}</div>
          </div>
          <div class='td-modal-foot'>
            <span style='margin-right:auto;font-size:12px;color:var(--td-text-muted);'>已选 ${dc.selectedKeys.length} 项（至少选 2 项）</span>
            <button type='button' class='td-btn' data-action='close-preview'>取消</button>
            <button type='button' class='td-btn primary' data-action='pm-diff-start' ${dc.selectedKeys.length < 2 ? 'disabled' : ''}>开始比对 (${dc.selectedKeys.length})</button>
          </div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  handleClick(e, actionEl, action) {
    const modalLayerEl = uiCtx.getModalLayer();
    const previewLayerEl = uiCtx.getPreviewLayer();

    if (action === 'open-preset-manager') { state.modal = { type: 'presetManager', query: '' }; uiCtx.renderModal(); return true; }
    if (action === 'pm-load') { uiCtx.performSwitchPreset(actionEl.getAttribute('data-name')); setTimeout(() => { if (state.modal?.type === 'presetManager') uiCtx.renderModal(); }, 180); return true; }
    if (action === 'pm-save-inuse-back') { saveInUseToPreset(actionEl.getAttribute('data-name')).then(() => uiCtx.renderModal()).catch((err) => { logError('保存实时修改回预设失败', err); notify('error', err.message || String(err)); }); return true; }
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
    if (action === 'pm-open-snapshots' && state.modal?.type === 'presetDetail') {
      const targetPreset = state.modal.presetName === 'in_use' ? state.presetName : state.modal.presetName;
      state.selectPopup = {
        type: 'quickSnapshot',
        kind: 'preset',
        targetName: targetPreset,
        mode: 'state',
        name: '',
        note: '',
      };
      uiCtx.renderSelectPopup();
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
    if (action === 'pm-clear-detail-search' && state.modal?.type === 'presetDetail') { state.modal.query = ''; uiCtx.renderModal(); return true; }
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
    if (action === 'pm-open-var-check' && state.modal?.type === 'presetDetail') {
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'pmVarCheck', tab: 'vars', filter: 'all', query: '', targetSpec: '' };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'pm-open-ai-edit' && state.modal?.type === 'presetDetail') {
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'pmAiEdit', step: 'setup', selectedKeys: new Set(), refSelectedKeys: new Set(), refExpanded: false, refSearch: '', instruction: '', search: '', loading: false, results: [] };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'pm-open-diff-compare' && state.modal?.type === 'presetDetail') {
      state.previewKey = null; state.snapshotDetailId = null;
      const listName = state.modal.tab === 'unused' ? 'prompts_unused' : 'prompts';
      const batchKeys = state.modal.batchMode && state.modal.selectedIdx?.size >= 2
        ? Array.from(state.modal.selectedIdx).sort((a, b) => a - b).map((i) => `${listName}::${i}`)
        : [];
      state.previewCtx = {
        type: 'pmDiffCompare',
        step: batchKeys.length >= 2 ? 'compare' : 'select',
        selectedKeys: batchKeys,
        baseKey: batchKeys[0] || '',
        pairKeyA: batchKeys[0] || '',
        pairKeyB: batchKeys[1] || '',
        compareMode: 'base',
        scopeFilter: 'all',
        search: '',
        onlyDiffLines: false,
        collapsedKeys: new Set(),
      };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (state.previewCtx?.type === 'pmDiffCompare' && state.modal?.type === 'presetDetail') {
      const dc = state.previewCtx;
      if (action === 'pm-diff-set-base') {
        e.stopPropagation();
        const k = actionEl.getAttribute('data-key');
        if (k) {
          if (!dc.selectedKeys.includes(k)) dc.selectedKeys.push(k);
          dc.baseKey = k;
          uiCtx.renderPreviewModal();
        }
        return true;
      }
      if (action === 'pm-diff-toggle-key') {
        if (e.target.closest("[data-action='pm-diff-set-base']")) return true;
        const k = actionEl.getAttribute('data-key');
        if (!k) return true;
        const idx = dc.selectedKeys.indexOf(k);
        if (idx >= 0) {
          dc.selectedKeys.splice(idx, 1);
          if (dc.baseKey === k) dc.baseKey = dc.selectedKeys[0] || '';
        } else {
          dc.selectedKeys.push(k);
          if (!dc.baseKey) dc.baseKey = k;
        }
        uiCtx.renderPreviewModal();
        return true;
      }
      if (action === 'pm-diff-set-scope') { dc.scopeFilter = actionEl.getAttribute('data-scope') || 'all'; uiCtx.renderPreviewModal(); return true; }
      if (action === 'pm-diff-clear-sel') { dc.selectedKeys = []; dc.baseKey = ''; uiCtx.renderPreviewModal(); return true; }
      if (action === 'pm-diff-start') {
        if (dc.selectedKeys.length < 2) { notify('warning', '请至少选择 2 个条目进行比对'); return true; }
        dc.step = 'compare';
        if (!dc.selectedKeys.includes(dc.baseKey)) dc.baseKey = dc.selectedKeys[0];
        dc.pairKeyA = dc.baseKey;
        dc.pairKeyB = dc.selectedKeys.find((k) => k !== dc.pairKeyA) || dc.selectedKeys[1];
        uiCtx.renderPreviewModal();
        return true;
      }
      if (action === 'pm-diff-back-select') { dc.step = 'select'; uiCtx.renderPreviewModal(); return true; }
      if (action === 'pm-diff-set-mode') { dc.compareMode = actionEl.getAttribute('data-mode') === 'pair' ? 'pair' : 'base'; uiCtx.renderPreviewModal(); return true; }
      if (action === 'pm-diff-swap-ab') {
        const other = dc.selectedKeys.find((k) => k !== dc.baseKey);
        if (other) { dc.baseKey = other; uiCtx.renderPreviewModal(); }
        return true;
      }
      if (action === 'pm-diff-toggle-only-diff') { dc.onlyDiffLines = !dc.onlyDiffLines; uiCtx.renderPreviewModal(); return true; }
      if (action === 'pm-diff-toggle-card') {
        if (e.target.closest("[data-action='pm-diff-set-base']")) return true;
        const k = actionEl.getAttribute('data-key');
        if (!k) return true;
        if (!(dc.collapsedKeys instanceof Set)) dc.collapsedKeys = new Set();
        if (dc.collapsedKeys.has(k)) dc.collapsedKeys.delete(k);
        else dc.collapsedKeys.add(k);
        uiCtx.renderPreviewModal();
        return true;
      }
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
    if (id === 'td-pm-diff-search' && state.previewCtx?.type === 'pmDiffCompare') { state.previewCtx.search = target.value; uiCtx.renderPreviewModal(); return true; }
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

    if (state.previewCtx?.type === 'pmDiffCompare') {
      const dc = state.previewCtx;
      if (id === 'td-pm-diff-base-sel') { dc.baseKey = target.value; uiCtx.renderPreviewModal(); return true; }
      if (id === 'td-pm-diff-pair-a') { dc.pairKeyA = target.value; uiCtx.renderPreviewModal(); return true; }
      if (id === 'td-pm-diff-pair-b') { dc.pairKeyB = target.value; uiCtx.renderPreviewModal(); return true; }
    }

    return false;
  },
};
