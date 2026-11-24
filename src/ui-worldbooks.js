import {
  escapeHtml, notify, cloneWorldbookEntry, formatKeysInput, parseKeysInput,
  callTH, logError,
} from './utils.js';
import { state, serializeRegExpDeep } from './store.js';
import { refreshWorldbookCatalog } from './catalog.js';
import {
  WB_POSITION_OPTIONS, getWorldbookBindingsSnapshot, toggleGlobalWorldbook,
  toggleCharPrimaryWorldbook, toggleCharAdditionalWorldbook, bindChatWorldbookSafe,
  createWorldbookSafe, renameWorldbookSafe,
  deleteWorldbookSafe, exportWorldbookFile,
  buildDefaultWorldbookEntry, disableAllRecursionInEntries,
} from './worldbook-manager.js';
import {
  ICONS, uiCtx, openConfirm, confirmDiscardDirtyModal,
  editHistory, readPreviewSnapshot, updatePreviewHistoryButtons, pushEditSnapshot,
} from './ui-common.js';
import { renderQuickInsertHtml } from './ui-snippets.js';
import { renderSearchableTextareaHtml, bindEditorSearchEvents } from './ui-editor-search.js';

function serializeWbEntries(entries) {
  return JSON.stringify(serializeRegExpDeep(entries || []));
}

function syncWbDetailDirty(m) {
  if (!m || m.type !== 'worldbookDetail') return false;
  if (typeof m.savedSnapshot === 'string') {
    m.dirty = serializeWbEntries(m.entries) !== m.savedSnapshot;
  }
  return !!m.dirty;
}

export const worldbooksUiModule = {
  confirmDirty(onProceed) {
    const m = state.modal;
    if (!m || m.type !== 'worldbookDetail' || !syncWbDetailDirty(m)) return false;
    openConfirm({
      title: '未保存修改确认',
      message: `世界书「${m.bookName}」有未保存的修改，关闭后修改将会丢失，是否保存？`,
      confirmText: '放弃修改',
      confirmClass: 'danger',
      extraButton: {
        text: '保存并关闭',
        className: 'primary',
        onClick: () => {
          callTH('replaceWorldbook', m.bookName, m.entries, { render: 'debounced' })
            .then(() => {
              m.savedSnapshot = serializeWbEntries(m.entries);
              m.dirty = false;
              notify('success', `已保存世界书「${m.bookName}」`);
              return refreshWorldbookCatalog(false);
            })
            .then(() => {
              uiCtx.renderMain();
              onProceed();
            })
            .catch((err) => {
              logError('保存世界书失败', err);
              notify('error', `保存世界书失败: ${err.message || err}`);
            });
        },
      },
      onConfirm: onProceed,
    });
    return true;
  },

  renderModal(m, modalLayerEl) {
    if (m.type === 'worldbookManager') {
      const snap = getWorldbookBindingsSnapshot(), filter = m.filter || 'all', q = (m.query || '').trim().toLowerCase();
      const books = snap.allBooks.filter((name) => {
        if (q && !name.toLowerCase().includes(q)) return false;
        if (filter === 'global') return snap.globalSet.has(name);
        if (filter === 'char') return snap.charPrimary === name || snap.charAdditionalSet.has(name);
        if (filter === 'chat') return snap.chatBook === name;
        return true;
      });

      const rowsHtml = books.map((name) => {
        const isGlobal = snap.globalSet.has(name), isCharPri = snap.charPrimary === name, isCharAdd = snap.charAdditionalSet.has(name), isChat = snap.chatBook === name;
        const isBound = isGlobal || isCharPri || isCharAdd || isChat;
        return `
          <div class='td-mgr-row ${isBound ? 'is-active' : ''}'>
            <div class='td-mgr-row-head'>
              <div class='td-mgr-row-title' title='${escapeHtml(name)}'>${escapeHtml(name)}</div>
              <div style='display:flex;gap:4px;flex-wrap:wrap;flex-shrink:0;'>
                ${isGlobal ? "<span class='td-mode-tag ok'>全局</span>" : ''}
                ${isCharPri ? "<span class='td-mode-tag multi'>角色主</span>" : ''}
                ${isCharAdd ? "<span class='td-mode-tag multi'>角色附加</span>" : ''}
                ${isChat ? "<span class='td-mode-tag single'>聊天</span>" : ''}
              </div>
            </div>
            <div class='td-mgr-row-actions'>
              <button class='td-btn sm ${isGlobal ? 'primary' : ''}' data-action='wbm-toggle-global' data-name='${escapeHtml(name)}'>${isGlobal ? '取消全局' : '全局启用'}</button>
              ${snap.hasCharacter ? `<button class='td-btn sm ${isCharPri ? 'primary' : ''}' data-action='wbm-toggle-char-pri' data-name='${escapeHtml(name)}'>${isCharPri ? '取消主书' : '角色主书'}</button>` : ''}
              ${snap.hasCharacter ? `<button class='td-btn sm ${isCharAdd ? 'primary' : ''}' data-action='wbm-toggle-char-add' data-name='${escapeHtml(name)}'>${isCharAdd ? '移除附加' : '角色附加'}</button>` : ''}
              <button class='td-btn sm ${isChat ? 'warn' : ''}' data-action='wbm-toggle-chat' data-name='${escapeHtml(name)}' ${!snap.inChat ? 'title="需先进入角色卡聊天"' : ''}>${isChat ? '解绑聊天' : '绑定聊天'}</button>
              <button class='td-btn sm' data-action='wbm-open-detail' data-name='${escapeHtml(name)}'>${ICONS.edit} 条目</button>
              <button class='td-btn sm' data-action='wbm-duplicate' data-name='${escapeHtml(name)}'>复制</button>
              <button class='td-btn sm' data-action='wbm-rename' data-name='${escapeHtml(name)}'>重命名</button>
              <button class='td-btn sm' data-action='wbm-export' data-name='${escapeHtml(name)}'>导出</button>
              <button class='td-btn sm danger' data-action='wbm-delete' data-name='${escapeHtml(name)}'>删除</button>
            </div>
          </div>`;
      }).join('');

      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.layers} 世界书管理 (${snap.allBooks.length})</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='worldbookManager' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div>
          <div class='td-modal-body td-picker-body' style='gap:7px;'>
            <div class='td-compact-bar'>
              <input class='td-input' id='td-wbm-search' type='text' placeholder='搜索世界书名称...' value='${escapeHtml(m.query || '')}' style='flex:1;min-width:110px;height:30px;font-size:12.5px;border-radius:8px;' />
              <button class='td-btn sm primary' data-action='wbm-create' style='min-height:30px;'>${ICONS.plus} 新建</button>
            </div>
            <div class='td-filter-bar td-snap-filter-bar'>
              <button class='td-chip ${filter === 'all' ? 'active' : ''}' data-action='wbm-set-filter' data-filter='all'>全部 (${snap.allBooks.length})</button>
              <button class='td-chip ${filter === 'global' ? 'active' : ''}' data-action='wbm-set-filter' data-filter='global'>全局 (${snap.globalList.length})</button>
              <button class='td-chip ${filter === 'char' ? 'active' : ''}' data-action='wbm-set-filter' data-filter='char'>当前角色 (${(snap.charPrimary ? 1 : 0) + snap.charAdditional.length})</button>
              <button class='td-chip ${filter === 'chat' ? 'active' : ''}' data-action='wbm-set-filter' data-filter='chat'>当前聊天 (${snap.chatBook ? 1 : 0})</button>
            </div>
            <div class='td-picker-list td-scroll'>${rowsHtml || "<div class='td-group-empty'>未找到匹配的世界书</div>"}</div>
          </div>
          <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>完成</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'worldbookDetail') {
      const entries = m.entries || [], q = (m.query || '').trim().toLowerCase();
      const batchMode = !!m.batchMode;
      const selectedSet = m.selectedIdx instanceof Set ? m.selectedIdx : (m.selectedIdx = new Set());
      const indexed = entries.map((e, idx) => ({ e, idx })).filter(({ e, idx }) => {
        if (!q) return true;
        return `#${idx + 1}`.includes(q)
          || (e.name || '').toLowerCase().includes(q)
          || (e.content || '').toLowerCase().includes(q)
          || formatKeysInput(e.strategy?.keys).toLowerCase().includes(q);
      });

      const rows = indexed.map(({ e, idx }) => {
        const stype = e.strategy?.type || 'selective';
        const stMeta = stype === 'constant'
          ? { cls: 'is-constant', label: '蓝灯 (常驻)' }
          : (stype === 'vectorized'
            ? { cls: 'is-vectorized', label: '向量化' }
            : { cls: 'is-selective', label: '绿灯 (关键词)' });
        const keysText = formatKeysInput(e.strategy?.keys);
        const checked = selectedSet.has(idx);
        return `
          <div class='td-mgr-row ${batchMode && checked ? 'is-active' : ''}' data-idx='${idx}'>
            <div class='td-mgr-row-head is-wrap-head'>
              <div class='td-mgr-row-left'>
                ${batchMode ? `<input type='checkbox' class='td-checkbox' data-action='wbd-batch-check' data-idx='${idx}' ${checked ? 'checked' : ''} />` : ''}
                <span class='td-idx-badge'>#${idx + 1}</span>
                ${e.extra?.tdAiTag ? `<span class='td-mode-tag ok'>${escapeHtml(e.extra.tdAiTag)}</span>` : ''}
                <span class='td-mgr-row-title is-wrap' title='${escapeHtml(e.name || `条目 #${e.uid}`)}'>${escapeHtml(e.name || `条目 #${e.uid}`)}</span>
              </div>
              <div style='display:flex;align-items:center;gap:7px;flex-shrink:0;'>
                <span class='td-src-badge td-wb-badge' title='${escapeHtml(stMeta.label)}'><span class='td-wb-led ${stMeta.cls}' aria-label='${escapeHtml(stMeta.label)}'></span><span>顺${e.position?.order ?? 100}</span></span>
                <button type='button' class='td-switch sm ${e.enabled ? 'on' : ''}' data-action='wbd-toggle-entry' data-idx='${idx}'></button>
              </div>
            </div>
            ${keysText ? `<div class='td-mgr-row-sub' style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>关键词: ${escapeHtml(keysText)}</div>` : ''}
            <div class='td-mgr-row-actions'>
              <button class='td-btn sm primary' data-action='wbd-edit-content' data-idx='${idx}'>${ICONS.eye} 编辑内容</button>
              <button class='td-btn sm' data-action='wbd-edit-entry' data-idx='${idx}'>${ICONS.edit} 完整属性</button>
              <button class='td-btn sm' data-action='wbd-move-before' data-idx='${idx}'>移动到...</button>
              <button class='td-btn sm' data-action='wbd-dup-entry' data-idx='${idx}'>复制</button>
              <button class='td-btn sm danger' data-action='wbd-del-entry' data-idx='${idx}'>删除</button>
            </div>
          </div>`;
      }).join('');

      const isDirty = syncWbDetailDirty(m);
      const wbDetailTitle = `世界书条目 · ${m.bookName} (${entries.length})`;
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title' title='${escapeHtml(wbDetailTitle)}'>${escapeHtml(wbDetailTitle)}</div>
            <div class='td-modal-head-actions'><button class='td-btn sm' data-action='wbd-open-snapshots'>${ICONS.camera} 快照</button><button class='td-btn sm' data-action='wbd-back-list'>返回</button><button class='td-icon-btn' data-action='open-help' data-help-key='worldbookDetail' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-compact-bar'>
              <div class='td-search-input-wrap' style='flex:1;min-width:105px;'>
                <input class='td-input' id='td-wbd-search' type='text' placeholder='搜索序号/标题/关键词...' value='${escapeHtml(m.query || '')}' style='height:30px;font-size:12.5px;padding:0 ${m.query ? '24px' : '9px'} 0 9px;border-radius:8px;' />
                ${m.query ? `<button type='button' class='td-search-clear' data-action='wbd-clear-search' title='清空搜索' style='width:22px;height:22px;right:3px;'>${ICONS.close}</button>` : ''}
              </div>
              <div class='td-jump-group'>
                <input class='td-input' id='td-wbd-jump-idx' type='number' min='1' max='${Math.max(1, entries.length)}' placeholder='#序号' value='${escapeHtml(m.jumpVal || '')}' />
                <button type='button' class='td-btn xs' data-action='wbd-jump-idx' title='跳转到指定序号'>跳转</button>
              </div>
              <button type='button' class='td-btn sm primary' data-action='wbd-add-entry' style='min-height:30px;'>${ICONS.plus} 新增</button>
            </div>
            <div class='td-compact-actions'>
              <button type='button' class='td-btn xs ${batchMode ? 'primary' : ''}' data-action='wbd-toggle-batch'>${batchMode ? `退出批量 (${selectedSet.size})` : '批量移动'}</button>
              ${batchMode ? `<button type='button' class='td-btn xs warn' data-action='wbd-batch-move'>移动所选</button>` : ''}
              <button type='button' class='td-btn xs' data-action='wbd-batch-enable' data-val='1' title='开启当前筛选可见条目'>全开</button>
              <button type='button' class='td-btn xs' data-action='wbd-batch-enable' data-val='0' title='关闭当前筛选可见条目'>全关</button>
              <button type='button' class='td-btn xs warn' data-action='wbd-disable-recursion' title='一键禁止全部条目递归'>禁递归</button>
              <button type='button' class='td-btn xs warn' data-action='wbd-open-ai-edit'>${ICONS.sliders} AI 编辑</button>
            </div>
            <div class='td-picker-list td-scroll'>${rows || "<div class='td-group-empty'>暂无匹配的世界书条目</div>"}</div>
          </div>
          <div class='td-modal-foot'><span data-role='wbd-dirty-label' style='margin-right:auto;font-size:11.5px;color:var(--td-text-muted);'>${isDirty ? '有未保存修改' : '已同步'}</span><button class='td-btn' data-action='wbd-back-list'>返回</button><button class='td-btn primary' data-action='wbd-save-book'>${ICONS.save} 保存世界书</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  renderPreview(previewLayerEl) {
    if (state.previewCtx?.type === 'wbContentEdit' && state.modal?.type === 'worldbookDetail') {
      const e = state.previewCtx.entry;
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>编辑世界书内容 · ${escapeHtml(e.name || `#${e.uid}`)}</div>
            <div style='display:flex;gap:4px;'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body'>
            <div class='td-field'><label class='td-label'>条目标题</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(e.name || '')}' /></div>
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;min-height:0;'><label class='td-label'>条目正文（支持撤销/重做）</label>${renderQuickInsertHtml('td-edit-content')}${renderSearchableTextareaHtml({ id: 'td-edit-content', value: e.content || '', minHeight: '200px' })}</div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='wb-save-content'>${ICONS.save} 应用到世界书</button></div>
        </div>`;
      bindEditorSearchEvents(previewLayerEl);
      editHistory.stack = [readPreviewSnapshot()];
      editHistory.index = 0;
      updatePreviewHistoryButtons();
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (state.previewCtx?.type === 'wbEntryEdit') {
      const e = state.previewCtx.entry, stype = e.strategy?.type || 'selective', secLogic = e.strategy?.keys_secondary?.logic || 'and_any';
      const posType = e.position?.type || 'after_character_definition', posRole = e.position?.role || 'system';
      const scanDepthVal = e.strategy?.scan_depth === 'same_as_global' || e.strategy?.scan_depth === undefined ? '' : String(e.strategy.scan_depth);
      const posOpts = WB_POSITION_OPTIONS.map((o) => `<option value='${o.v}' ${posType === o.v ? 'selected' : ''}>${o.t}</option>`).join('');
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>${state.previewCtx.isNew ? '新增世界书条目' : `编辑世界书条目 · ${escapeHtml(e.name || `#${e.uid}`)}`}</div>
            <div class='td-modal-head-actions'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='open-help' data-help-key='wbEntryEdit' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body'>
            <div style='display:flex;gap:8px;align-items:center;'><div class='td-field' style='flex:1;'><label class='td-label'>条目标题</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(e.name || '')}' /></div><label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'><input type='checkbox' class='td-checkbox' id='td-wbe-enabled' ${e.enabled ? 'checked' : ''} /><span>启用</span></label></div>
            <div class='td-form-grid'>
              <div class='td-field'><label class='td-label'>触发策略</label><select class='td-select' id='td-wbe-stype'><option value='selective' ${stype === 'selective' ? 'selected' : ''}>绿灯 (关键词)</option><option value='constant' ${stype === 'constant' ? 'selected' : ''}>蓝灯 (常驻)</option><option value='vectorized' ${stype === 'vectorized' ? 'selected' : ''}>向量化</option></select></div>
              <div class='td-field'><label class='td-label'>插入位置</label><select class='td-select' id='td-wbe-postype'>${posOpts}</select></div>
              <div class='td-field'><label class='td-label'>插入深度 (@D 时有效)</label><input class='td-input' id='td-wbe-depth' type='number' value='${escapeHtml(e.position?.depth ?? 4)}' /></div>
              <div class='td-field'><label class='td-label'>深度身份 (@D 时有效)</label><select class='td-select' id='td-wbe-role'><option value='system' ${posRole === 'system' ? 'selected' : ''}>System</option><option value='user' ${posRole === 'user' ? 'selected' : ''}>User</option><option value='assistant' ${posRole === 'assistant' ? 'selected' : ''}>Assistant</option></select></div>
              <div class='td-field'><label class='td-label'>插入顺序 (Order)</label><input class='td-input' id='td-wbe-order' type='number' value='${escapeHtml(e.position?.order ?? 100)}' /></div>
              <div class='td-field'><label class='td-label'>触发概率 (%)</label><input class='td-input' id='td-wbe-prob' type='number' min='0' max='100' value='${escapeHtml(e.probability ?? 100)}' /></div>
            </div>
            <div class='td-field'><label class='td-label'>主要关键词（逗号或换行分隔，支持 /正则/i）</label><input class='td-input' id='td-wbe-keys' type='text' value='${escapeHtml(formatKeysInput(e.strategy?.keys))}' /></div>
            <div class='td-form-grid'>
              <div class='td-field'><label class='td-label'>次要关键词逻辑</label><select class='td-select' id='td-wbe-seclogic'><option value='and_any' ${secLogic === 'and_any' ? 'selected' : ''}>任一包含</option><option value='and_all' ${secLogic === 'and_all' ? 'selected' : ''}>全部包含</option><option value='not_any' ${secLogic === 'not_any' ? 'selected' : ''}>全部不含</option><option value='not_all' ${secLogic === 'not_all' ? 'selected' : ''}>非全含</option></select></div>
              <div class='td-field'><label class='td-label'>次要关键词</label><input class='td-input' id='td-wbe-seckeys' type='text' value='${escapeHtml(formatKeysInput(e.strategy?.keys_secondary?.keys))}' /></div>
            </div>
            <div class='td-form-grid'>
              <div class='td-field'><label class='td-label'>扫描深度（留空跟随全局）</label><input class='td-input' id='td-wbe-scandepth' type='number' placeholder='全局' value='${escapeHtml(scanDepthVal)}' /></div>
              <div class='td-field'><label class='td-label'>黏性 / 冷却 / 延迟</label><div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;'><input class='td-input' id='td-wbe-sticky' type='number' placeholder='黏' value='${escapeHtml(e.effect?.sticky ?? '')}' /><input class='td-input' id='td-wbe-cooldown' type='number' placeholder='冷' value='${escapeHtml(e.effect?.cooldown ?? '')}' /><input class='td-input' id='td-wbe-delay' type='number' placeholder='延' value='${escapeHtml(e.effect?.delay ?? '')}' /></div></div>
            </div>
            <div style='display:flex;gap:12px;flex-wrap:wrap;'>
              <label style='display:inline-flex;align-items:center;gap:5px;font-size:12px;'><input type='checkbox' class='td-checkbox' id='td-wbe-previn' ${e.recursion?.prevent_incoming ? 'checked' : ''} /> 禁止被递归激活</label>
              <label style='display:inline-flex;align-items:center;gap:5px;font-size:12px;'><input type='checkbox' class='td-checkbox' id='td-wbe-prevout' ${e.recursion?.prevent_outgoing ? 'checked' : ''} /> 禁止递归激活其他</label>
            </div>
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;min-height:180px;'><label class='td-label'>条目正文（支持撤销/重做）</label>${renderQuickInsertHtml('td-edit-content')}${renderSearchableTextareaHtml({ id: 'td-edit-content', value: e.content || '', minHeight: '140px' })}</div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='wb-save-entry'>${ICONS.save} 确认</button></div>
        </div>`;
      bindEditorSearchEvents(previewLayerEl);
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

    if (action === 'wbd-open-snapshots' && state.modal?.type === 'worldbookDetail') {
      state.selectPopup = {
        type: 'quickSnapshot',
        kind: 'worldbook',
        targetName: state.modal.bookName,
        mode: 'state',
        name: '',
        note: '',
      };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'open-worldbook-manager') { state.modal = { type: 'worldbookManager', filter: 'all', query: '' }; uiCtx.renderModal(); return true; }
    if (action === 'wbm-set-filter' && state.modal?.type === 'worldbookManager') { state.modal.filter = actionEl.getAttribute('data-filter') || 'all'; uiCtx.renderModal(); return true; }
    if (action === 'wbm-toggle-global') { toggleGlobalWorldbook(actionEl.getAttribute('data-name')).then(() => refreshWorldbookCatalog(false)).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('切换全局世界书失败', err); notify('error', err.message || String(err)); }); return true; }
    if (action === 'wbm-toggle-char-pri') { toggleCharPrimaryWorldbook(actionEl.getAttribute('data-name')).then(() => refreshWorldbookCatalog(false)).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('切换角色卡主世界书失败', err); notify('error', err.message || String(err)); }); return true; }
    if (action === 'wbm-toggle-char-add') { toggleCharAdditionalWorldbook(actionEl.getAttribute('data-name')).then(() => refreshWorldbookCatalog(false)).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('切换角色卡附加世界书失败', err); notify('error', err.message || String(err)); }); return true; }
    if (action === 'wbm-toggle-chat') {
      const name = actionEl.getAttribute('data-name'), snap = getWorldbookBindingsSnapshot();
      bindChatWorldbookSafe(snap.chatBook === name ? '' : name).then(() => refreshWorldbookCatalog(false)).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('绑定/解绑聊天世界书失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'wbm-create') {
      const name = window.prompt('请输入新建世界书名称：', ''); if (!name || !name.trim()) return true;
      createWorldbookSafe(name.trim()).then(() => refreshWorldbookCatalog(false)).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('新建世界书失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'wbm-duplicate') {
      const src = actionEl.getAttribute('data-name'); const name = window.prompt(`复制世界书「${src}」为：`, `${src}-副本`); if (!name || !name.trim()) return true;
      createWorldbookSafe(name.trim(), src).then(() => refreshWorldbookCatalog(false)).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('复制世界书失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'wbm-rename') {
      const oldName = actionEl.getAttribute('data-name'); const newName = window.prompt(`重命名世界书「${oldName}」为：`, oldName);
      if (!newName || !newName.trim() || newName.trim() === oldName) return true;
      renameWorldbookSafe(oldName, newName.trim()).then(() => refreshWorldbookCatalog(false)).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('重命名世界书失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'wbm-export') { exportWorldbookFile(actionEl.getAttribute('data-name')).catch((err) => { logError('导出世界书失败', err); notify('error', err.message || String(err)); }); return true; }
    if (action === 'wbm-delete') {
      const name = actionEl.getAttribute('data-name');
      openConfirm({
        title: '删除世界书确认', message: `确定要永久删除世界书「${name}」吗？`, confirmText: '确认删除',
        onConfirm: () => deleteWorldbookSafe(name).then(() => refreshWorldbookCatalog(false)).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('删除世界书失败', err); notify('error', err.message || String(err)); }),
      });
      return true;
    }
    if (action === 'wbm-open-detail') {
      const name = actionEl.getAttribute('data-name');
      callTH('getWorldbook', name).then((entries) => {
        const clonedEntries = (entries || []).map(cloneWorldbookEntry);
        state.modal = { type: 'worldbookDetail', bookName: name, entries: clonedEntries, savedSnapshot: serializeWbEntries(clonedEntries), query: '', dirty: false, toolsOpen: false, batchMode: false, selectedIdx: new Set() };
        uiCtx.renderModal();
      }).catch((err) => { logError(`读取世界书「${name}」失败`, err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'wbd-clear-search' && state.modal?.type === 'worldbookDetail') { state.modal.query = ''; uiCtx.renderModal(); return true; }
    if (action === 'wbd-jump-idx' && state.modal?.type === 'worldbookDetail') {
      const list = state.modal.entries || [];
      const num = Number(modalLayerEl?.querySelector('#td-wbd-jump-idx')?.value);
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
    if (action === 'wbd-toggle-batch' && state.modal?.type === 'worldbookDetail') {
      state.modal.batchMode = !state.modal.batchMode; state.modal.selectedIdx = new Set(); uiCtx.renderModal(); return true;
    }
    if (action === 'wbd-batch-check' && state.modal?.type === 'worldbookDetail') {
      const idx = Number(actionEl.getAttribute('data-idx'));
      if (state.modal.selectedIdx.has(idx)) state.modal.selectedIdx.delete(idx);
      else state.modal.selectedIdx.add(idx);
      actionEl.closest('.td-mgr-row')?.classList.toggle('is-active', state.modal.selectedIdx.has(idx));
      const batchBtn = modalLayerEl?.querySelector("[data-action='wbd-toggle-batch']");
      if (batchBtn) batchBtn.textContent = `退出批量 (已选 ${state.modal.selectedIdx.size})`;
      return true;
    }
    if (action === 'wbd-batch-move' && state.modal?.type === 'worldbookDetail') {
      const indices = Array.from(state.modal.selectedIdx || []);
      if (indices.length === 0) { notify('warning', '请先勾选要移动的条目'); return true; }
      state.selectPopup = { type: 'moveWbTarget', fromIndices: indices };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'wbd-move-before' && state.modal?.type === 'worldbookDetail') {
      state.selectPopup = { type: 'moveWbTarget', fromIndices: [Number(actionEl.getAttribute('data-idx'))] };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'wbd-back-list' && state.modal?.type === 'worldbookDetail') {
      confirmDiscardDirtyModal(() => {
        state.modal = { type: 'worldbookManager', filter: 'all', query: '', toolsOpen: false };
        uiCtx.renderModal();
      });
      return true;
    }
    if (action === 'wbd-toggle-entry' && state.modal?.type === 'worldbookDetail') {
      const idx = Number(actionEl.getAttribute('data-idx'));
      if (state.modal.entries[idx]) {
        state.modal.entries[idx].enabled = !state.modal.entries[idx].enabled;
        const isDirty = syncWbDetailDirty(state.modal);
        actionEl.classList.toggle('on', !!state.modal.entries[idx].enabled);
        const dirtyEl = modalLayerEl?.querySelector("[data-role='wbd-dirty-label']");
        if (dirtyEl) dirtyEl.textContent = isDirty ? '有未保存修改' : '已同步';
      }
      return true;
    }
    if (action === 'wbd-batch-enable' && state.modal?.type === 'worldbookDetail') {
      const val = actionEl.getAttribute('data-val') === '1', q = (state.modal.query || '').trim().toLowerCase();
      state.modal.entries.forEach((entry) => {
        if (!q || (entry.name || '').toLowerCase().includes(q) || (entry.content || '').toLowerCase().includes(q) || formatKeysInput(entry.strategy?.keys).toLowerCase().includes(q)) entry.enabled = val;
      });
      state.modal.dirty = true; uiCtx.renderModal();
      return true;
    }
    if (action === 'wbd-disable-recursion' && state.modal?.type === 'worldbookDetail') {
      const changed = disableAllRecursionInEntries(state.modal.entries);
      if (changed > 0) state.modal.dirty = true;
      uiCtx.renderModal();
      notify('success', changed > 0 ? `已将 ${changed} 个条目的递归全部禁止（请点击「保存世界书」生效）` : '所有条目已处于禁止递归状态');
      return true;
    }
    if (action === 'wbd-dup-entry' && state.modal?.type === 'worldbookDetail') {
      const idx = Number(actionEl.getAttribute('data-idx')), src = state.modal.entries[idx];
      if (src) {
        const copy = cloneWorldbookEntry(src);
        copy.uid = state.modal.entries.reduce((mx, x) => Math.max(mx, Number(x.uid) || 0), 0) + 1;
        copy.name = `${copy.name || '条目'} (副本)`;
        state.modal.entries.splice(idx + 1, 0, copy); state.modal.dirty = true;
        if (state.modal.selectedIdx instanceof Set) state.modal.selectedIdx.clear();
        uiCtx.renderModal();
      }
      return true;
    }
    if (action === 'wbd-del-entry' && state.modal?.type === 'worldbookDetail') {
      const idx = Number(actionEl.getAttribute('data-idx')), entry = state.modal.entries[idx]; if (!entry) return true;
      openConfirm({
        title: '删除世界书条目确认', message: `确定要删除条目「${entry.name || `#${entry.uid}`}」吗？`, confirmText: '确认删除',
        onConfirm: () => {
          state.modal.entries.splice(idx, 1); state.modal.dirty = true;
          if (state.modal.selectedIdx instanceof Set) state.modal.selectedIdx.clear();
          uiCtx.renderModal();
        },
      });
      return true;
    }
    if (action === 'wbd-edit-content' && state.modal?.type === 'worldbookDetail') {
      const idx = Number(actionEl.getAttribute('data-idx')), eObj = state.modal.entries[idx]; if (!eObj) return true;
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'wbContentEdit', idx, entry: cloneWorldbookEntry(eObj) };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'wb-save-content' && state.previewCtx?.type === 'wbContentEdit' && state.modal?.type === 'worldbookDetail') {
      pushEditSnapshot(true);
      const snap = readPreviewSnapshot(), target = state.modal.entries[state.previewCtx.idx];
      if (target && snap) { if (snap.name.trim()) target.name = snap.name.trim(); target.content = snap.content; state.modal.dirty = true; }
      state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
      return true;
    }
    if (action === 'wbd-add-entry' && state.modal?.type === 'worldbookDetail') {
      const nextUid = state.modal.entries.reduce((mx, x) => Math.max(mx, Number(x.uid) || 0), 0) + 1;
      const entry = buildDefaultWorldbookEntry({}); entry.uid = nextUid;
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'wbEntryEdit', idx: -1, isNew: true, entry };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'wbd-edit-entry' && state.modal?.type === 'worldbookDetail') {
      const idx = Number(actionEl.getAttribute('data-idx')), eObj = state.modal.entries[idx]; if (!eObj) return true;
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'wbEntryEdit', idx, isNew: false, entry: cloneWorldbookEntry(eObj) };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'wb-save-entry' && state.previewCtx?.type === 'wbEntryEdit' && state.modal?.type === 'worldbookDetail') {
      pushEditSnapshot(true);
      const snap = readPreviewSnapshot(), eObj = cloneWorldbookEntry(state.previewCtx.entry);
      eObj.name = (snap?.name || '').trim() || '未命名条目';
      eObj.enabled = !!previewLayerEl?.querySelector('#td-wbe-enabled')?.checked;
      eObj.strategy = {
        type: previewLayerEl?.querySelector('#td-wbe-stype')?.value || 'selective',
        keys: parseKeysInput(previewLayerEl?.querySelector('#td-wbe-keys')?.value || ''),
        keys_secondary: { logic: previewLayerEl?.querySelector('#td-wbe-seclogic')?.value || 'and_any', keys: parseKeysInput(previewLayerEl?.querySelector('#td-wbe-seckeys')?.value || '') },
        scan_depth: (() => { const raw = (previewLayerEl?.querySelector('#td-wbe-scandepth')?.value || '').trim(); return raw === '' ? 'same_as_global' : (Number(raw) || 0); })(),
      };
      eObj.position = {
        type: previewLayerEl?.querySelector('#td-wbe-postype')?.value || 'after_character_definition',
        role: previewLayerEl?.querySelector('#td-wbe-role')?.value || 'system',
        depth: Number(previewLayerEl?.querySelector('#td-wbe-depth')?.value) || 4,
        order: Number(previewLayerEl?.querySelector('#td-wbe-order')?.value) || 100,
      };
      eObj.probability = Number(previewLayerEl?.querySelector('#td-wbe-prob')?.value ?? 100);
      const numOrNull = (sel) => { const v = (previewLayerEl?.querySelector(sel)?.value || '').trim(); return v === '' ? null : Number(v); };
      eObj.effect = { sticky: numOrNull('#td-wbe-sticky'), cooldown: numOrNull('#td-wbe-cooldown'), delay: numOrNull('#td-wbe-delay') };
      eObj.recursion = Object.assign({}, eObj.recursion || { delay_until: null }, {
        prevent_incoming: !!previewLayerEl?.querySelector('#td-wbe-previn')?.checked,
        prevent_outgoing: !!previewLayerEl?.querySelector('#td-wbe-prevout')?.checked,
      });
      eObj.content = snap?.content ?? '';
      if (state.previewCtx.isNew) state.modal.entries.push(eObj); else state.modal.entries[state.previewCtx.idx] = eObj;
      state.modal.dirty = true; state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
      return true;
    }
    if (action === 'wbd-save-book' && state.modal?.type === 'worldbookDetail') {
      callTH('replaceWorldbook', state.modal.bookName, state.modal.entries, { render: 'debounced' }).then(() => {
        state.modal.savedSnapshot = serializeWbEntries(state.modal.entries);
        state.modal.dirty = false; notify('success', `已保存世界书「${state.modal.bookName}」`); return refreshWorldbookCatalog(false);
      }).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('保存世界书失败', err); notify('error', `保存世界书失败: ${err.message || err}`); });
      return true;
    }
    if (action === 'wbd-open-ai-edit' && state.modal?.type === 'worldbookDetail') {
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = { type: 'wbAiEdit', step: 'setup', selectedKeys: new Set(), refSelectedKeys: new Set(), refExpanded: false, refSearch: '', instruction: '', search: '', loading: false, results: [] };
      uiCtx.renderPreviewModal();
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    if (id === 'td-wbm-search' && state.modal?.type === 'worldbookManager') { state.modal.query = target.value; uiCtx.renderModal(); return true; }
    if (id === 'td-wbd-search' && state.modal?.type === 'worldbookDetail') { state.modal.query = target.value; uiCtx.renderModal(); return true; }
    if (id === 'td-wbd-jump-idx' && state.modal?.type === 'worldbookDetail') { state.modal.jumpVal = target.value; return true; }
    return false;
  },

  handleChange() {
    return false;
  },
};
