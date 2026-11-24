import {
  escapeHtml, notify, findBestMatchingName, computeLineDiff,
  cloneWorldbookEntry, formatKeysInput, hasTH, callTH, logError,
} from './utils.js';
import { state, saveMergeDraft, clearMergeDraft } from './store.js';
import { refreshAllCatalogs, refreshWorldbookCatalog } from './catalog.js';
import { PRESET_SYSTEM_IDS } from './preset-manager.js';
import {
  buildPresetDiffSession, executePresetStitch, findBestMatchingOldPreset,
  buildDualPresetSession, recomputePresetSessionDirty, pushPresetSessionUndo,
  undoPresetSession, redoPresetSession, findPresetCounterpart, computePresetGlobalDiff,
  saveDualPresetSide, hydratePresetMergeDraft, describePresetChanges,
} from './preset-merge.js';
import {
  buildWorldbookDiffSession, executeWorldbookStitch,
  buildDualWorldbookSession, recomputeWbSessionDirty, pushWbSessionUndo,
  undoWbSession, redoWbSession, findWbCounterpart, computeWbGlobalDiff,
  saveDualWbSide, hydrateWbMergeDraft, describeWorldbookChanges,
} from './worldbook-merge.js';
import {
  initPresetMergeCustomCtx, renderPresetMergeCustomModal,
  initWbMergeCustomCtx, renderWbMergeCustomModal,
  handleMergeUiClick, handleMergeUiInput,
} from './merge-ui.js';
import {
  ICONS, uiCtx, openConfirm, editHistory, readPreviewSnapshot,
  updatePreviewHistoryButtons, pushEditSnapshot,
} from './ui-common.js';

const MERGE_FILTER_LABELS = { diff: '仅看差异', conflict: '冲突', added: '新增', removed: '删除', all: '全部' };

function persistDualDraft(session) {
  const kind = session.kind === 'worldbook' ? 'worldbook' : 'preset';
  if (session.dirty) saveMergeDraft(kind, session);
  else clearMergeDraft(kind);
}

function getDualPaneEntriesHtml(session, side) {
  const isPreset = session.kind === 'preset';
  const list = side === 'source' ? session.sourceEntries : session.baseEntries;
  const query = ((side === 'source' ? session.sourceQuery : session.baseQuery) || '').trim().toLowerCase();
  const batchMode = side === 'source' ? !!session.sourceBatch : !!session.baseBatch;
  const selectedSet = side === 'source' ? session.sourceSelected : session.baseSelected;
  const pairMode = !!session.pairPickMode;
  const pairPickedKey = side === 'source' ? session.pairSourceKey : session.pairBaseKey;
  const marks = session.diffMarks;

  const filtered = list.map((item, idx) => ({ item, idx })).filter(({ item, idx }) => {
    if (!query) return true;
    const d = item.data || {};
    const nm = (d.name || d.id || `#${d.uid}` || '').toLowerCase();
    const ct = (d.content || '').toLowerCase();
    const ks = !isPreset ? formatKeysInput(d.strategy?.keys).toLowerCase() : '';
    return `#${idx + 1}`.includes(query) || nm.includes(query) || ct.includes(query) || ks.includes(query);
  });

  if (filtered.length === 0) return "<div class='td-group-empty'>暂无匹配条目</div>";

  return filtered.map(({ item, idx }) => {
    const d = item.data || {};
    const title = d.name || d.id || `条目 #${d.uid}`;
    const checked = batchMode && selectedSet.has(item._key);
    const isPairPicked = pairMode && pairPickedKey === item._key;
    const mark = marks ? marks.get(item._key) : null;
    const diffTag = mark === 'conflict'
      ? "<span class='td-mode-tag single'>差异</span>"
      : (mark === 'sourceOnly'
        ? "<span class='td-mode-tag ok'>仅 A</span>"
        : (mark === 'baseOnly' ? "<span class='td-mode-tag del'>仅 B</span>" : ''));
    const mt = item._migTag;
    const migTag = mt
      ? (mt.type === 'in'
        ? `<span class='td-mode-tag multi'>自${escapeHtml(mt.from)}迁入</span>`
        : `<span class='td-mode-tag ok'>已迁至${escapeHtml(mt.to)}</span>`)
      : '';
    const pairAttrs = pairMode
      ? `data-action='dual-pair-select' data-side='${side}' data-key='${escapeHtml(item._key)}'`
      : '';

    return `
      <div class='td-dual-row ${checked ? 'is-active' : ''} ${pairMode ? 'is-pair-pickable' : ''} ${isPairPicked ? 'is-pair-picked' : ''}' ${pairAttrs} data-key='${escapeHtml(item._key)}'>
        <div class='td-dual-row-main'>
          ${batchMode ? `<input type='checkbox' class='td-checkbox' data-action='dual-batch-check' data-side='${side}' data-key='${escapeHtml(item._key)}' ${checked ? 'checked' : ''} />` : ''}
          <span class='td-idx-badge'>#${idx + 1}</span>
          <span class='td-dual-row-title' title='${escapeHtml(title)}'>${escapeHtml(title)}</span>
          ${migTag}
          ${diffTag}
          ${isPairPicked ? "<span class='td-mode-tag single'>已选</span>" : ''}
        </div>
        <div class='td-dual-row-ops'>
          <button type='button' class='td-btn sm' data-action='dual-edit-entry' data-side='${side}' data-key='${escapeHtml(item._key)}'>编辑</button>
          <button type='button' class='td-btn sm' data-action='dual-migrate-one' data-side='${side}' data-key='${escapeHtml(item._key)}'>迁移</button>
          ${!(isPreset && PRESET_SYSTEM_IDS.has(d.id)) ? `<button type='button' class='td-btn sm danger' data-action='dual-delete-one' data-side='${side}' data-key='${escapeHtml(item._key)}'>删除</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function renderDualMidBarHtml(session) {
  const isPreset = session.kind === 'preset';
  const pairMode = !!session.pairPickMode;
  const syncOn = !!session.syncScroll;
  const saveOpen = !!session.saveMenuOpen;
  const isGlobalDiffOpen = state.previewCtx?.type === 'mergeGlobalDiff';
  const srcIdx = session.pairSourceKey ? session.sourceEntries.findIndex((x) => x._key === session.pairSourceKey) : -1;
  const baseIdx = session.pairBaseKey ? session.baseEntries.findIndex((x) => x._key === session.pairBaseKey) : -1;

  return `
    <div class='td-dual-midbar'>
      <div class='td-dual-midbar-row'>
        <button type='button' class='td-btn sm ${pairMode ? 'warn' : ''}' data-action='dual-pair-pick'>${pairMode ? '取消选对' : '1对1缝合'}</button>
        <button type='button' class='td-btn sm ${syncOn ? 'primary' : ''}' data-action='dual-toggle-sync-scroll'>同屏滚动</button>
        <button type='button' class='td-btn sm ${isGlobalDiffOpen ? 'primary' : ''}' data-action='dual-global-diff'>全局Diff</button>
        <button type='button' class='td-icon-btn' data-action='dual-undo' title='撤销' ${session.undoStack?.length ? '' : 'disabled'}>${ICONS.undo}</button>
        <button type='button' class='td-icon-btn' data-action='dual-redo' title='重做' ${session.redoStack?.length ? '' : 'disabled'}>${ICONS.redo}</button>
        <button type='button' class='td-btn sm ${session.dirty ? 'primary' : (saveOpen ? 'warn' : '')}' data-action='dual-toggle-save-menu' style='margin-left:auto;'>保存${session.dirty ? '*' : ''}</button>
        <button type='button' class='td-icon-btn' data-action='open-help' data-help-key='dualMerge' title='功能说明'>${ICONS.help}</button>
        <button type='button' class='td-icon-btn' data-action='close-modal' title='关闭'>${ICONS.close}</button>
      </div>
      ${pairMode ? `
        <div class='td-dual-midbar-sub' style='color:var(--td-single);font-weight:600;'>
          <span>1对1缝合：请分别点击选择 A(${srcIdx >= 0 ? `#${srcIdx + 1}` : '未选'}) 与 B(${baseIdx >= 0 ? `#${baseIdx + 1}` : '未选'})</span>
        </div>` : ''}
      ${saveOpen ? (() => {
        const pDir = session.migrateSettingsDir || (session.migrateSettings ? 'a2b' : 'none');
        return `
          <div class='td-dual-midbar-sub is-col'>
            ${isPreset ? `
              <div class='td-dual-param-row'>
                <span style='color:var(--td-text-muted);font-weight:600;'>参数同步：</span>
                <span class='td-dual-param-chk'>
                  <input type='checkbox' class='td-checkbox sm' data-action='dual-toggle-param-dir' data-dir='a2b' ${pDir === 'a2b' ? 'checked' : ''} />
                  <span>A 参数 → B</span>
                </span>
                <span class='td-dual-param-chk'>
                  <input type='checkbox' class='td-checkbox sm' data-action='dual-toggle-param-dir' data-dir='b2a' ${pDir === 'b2a' ? 'checked' : ''} />
                  <span>B 参数 → A</span>
                </span>
              </div>` : ''}
            <div class='td-dual-save-row'>
              <button type='button' class='td-btn sm ${session.sourceDirty ? 'warn' : ''}' data-action='dual-save-source'>保存 A</button>
              <button type='button' class='td-btn sm' data-action='dual-save-source-as'>A 另存</button>
              <button type='button' class='td-btn sm ${session.baseDirty ? 'primary' : ''}' data-action='dual-save-base'>保存 B</button>
              <button type='button' class='td-btn sm' data-action='dual-save-base-as'>B 另存</button>
            </div>
          </div>`;
      })() : ''}
    </div>`;
}

function bindDualScrollSync(modalLayerEl, session) {
  if (!modalLayerEl || !session || session.v !== 3) return;
  const srcEl = modalLayerEl.querySelector("[data-role='dual-list-source']");
  const baseEl = modalLayerEl.querySelector("[data-role='dual-list-base']");
  if (!srcEl || !baseEl) return;

  srcEl._tdLastTop = srcEl.scrollTop;
  baseEl._tdLastTop = baseEl.scrollTop;

  if (!srcEl.dataset.tdSyncBound) {
    srcEl.dataset.tdSyncBound = '1';
    srcEl.addEventListener('scroll', () => {
      const cur = srcEl.scrollTop;
      const prev = srcEl._tdLastTop ?? cur;
      const delta = cur - prev;
      srcEl._tdLastTop = cur;
      if (session.syncScroll && Math.abs(delta) >= 0.5 && !srcEl._tdIgnoreScroll) {
        const maxBase = Math.max(0, baseEl.scrollHeight - baseEl.clientHeight);
        const nextBase = Math.max(0, Math.min(maxBase, baseEl.scrollTop + delta));
        baseEl._tdIgnoreScroll = true;
        baseEl.scrollTop = nextBase;
        baseEl._tdLastTop = baseEl.scrollTop;
        requestAnimationFrame(() => { baseEl._tdIgnoreScroll = false; });
      }
    }, { passive: true });
  }

  if (!baseEl.dataset.tdSyncBound) {
    baseEl.dataset.tdSyncBound = '1';
    baseEl.addEventListener('scroll', () => {
      const cur = baseEl.scrollTop;
      const prev = baseEl._tdLastTop ?? cur;
      const delta = cur - prev;
      baseEl._tdLastTop = cur;
      if (session.syncScroll && Math.abs(delta) >= 0.5 && !baseEl._tdIgnoreScroll) {
        const maxSrc = Math.max(0, srcEl.scrollHeight - srcEl.clientHeight);
        const nextSrc = Math.max(0, Math.min(maxSrc, srcEl.scrollTop + delta));
        srcEl._tdIgnoreScroll = true;
        srcEl.scrollTop = nextSrc;
        srcEl._tdLastTop = srcEl.scrollTop;
        requestAnimationFrame(() => { srcEl._tdIgnoreScroll = false; });
      }
    }, { passive: true });
  }
}

function renderDualPaneHtml(session, side) {
  const isSource = side === 'source';
  const name = isSource ? session.sourceName : session.baseName;
  const list = isSource ? session.sourceEntries : session.baseEntries;
  const query = isSource ? (session.sourceQuery || '') : (session.baseQuery || '');
  const batchMode = isSource ? !!session.sourceBatch : !!session.baseBatch;
  const selectedCount = (isSource ? session.sourceSelected : session.baseSelected).size;
  const activePane = session.activePane || 'both';
  const isHidden = (activePane === 'source' && !isSource) || (activePane === 'base' && isSource);
  const isExpanded = activePane === side;

  return `
    <div class='td-dual-pane ${isHidden ? 'is-hidden' : ''} ${isExpanded ? 'is-expanded' : ''}' data-side='${side}'>
      <div class='td-dual-pane-head'>
        <div style='display:flex;align-items:center;gap:6px;min-width:0;flex:1;'>
          <span class='td-mode-tag ${isSource ? 'single' : 'multi'}'>${isSource ? 'A' : 'B'}</span>
          <span class='td-dual-pane-title' title='${escapeHtml(name)}'>${escapeHtml(name)}</span>
          <span class='td-count-tag' data-role='pane-count-${side}'>${list.length}条</span>
        </div>
        <div style='display:flex;align-items:center;gap:4px;flex-shrink:0;'>
          <button type='button' class='td-btn sm ${batchMode ? 'primary' : ''}' data-action='dual-batch-toggle' data-side='${side}'>${batchMode ? '退出批量' : '批量迁移'}</button>
          <button type='button' class='td-icon-btn' data-action='dual-toggle-expand-pane' data-side='${side}' title='${isExpanded ? '恢复双栏' : '展开此栏'}'>${isExpanded ? ICONS.minimize : ICONS.maximize}</button>
        </div>
      </div>
      <div class='td-dual-pane-tools'>
        <input class='td-input td-dual-search' data-role='dual-search' data-side='${side}' type='text' placeholder='搜索序号、名称或内容...' value='${escapeHtml(query)}' />
        ${batchMode ? `
          <div style='display:flex;gap:4px;align-items:center;flex-wrap:wrap;width:100%;'>
            <button type='button' class='td-chip' data-action='dual-batch-all' data-side='${side}'>全选可见</button>
            <button type='button' class='td-chip' data-action='dual-batch-none' data-side='${side}'>清空</button>
            <button type='button' class='td-btn sm primary' data-action='dual-batch-migrate' data-side='${side}' data-role='pane-mig-btn-${side}' ${selectedCount === 0 ? 'disabled' : ''}>迁移已选 (${selectedCount})</button>
            <button type='button' class='td-btn sm danger' data-action='dual-batch-remove' data-side='${side}' data-role='pane-del-btn-${side}' ${selectedCount === 0 ? 'disabled' : ''}>移除 (${selectedCount})</button>
          </div>` : ''}
      </div>
      <div class='td-dual-pane-list td-scroll' data-role='dual-list-${side}'>${getDualPaneEntriesHtml(session, side)}</div>
    </div>`;
}

export function updateDualMergeBody(kind) {
  const modalLayerEl = uiCtx.getModalLayer();
  const modalType = kind === 'worldbook' ? 'wbMerge' : 'presetMerge';
  if (!modalLayerEl || !state.modal || state.modal.type !== modalType) return;
  const session = state.modal.session;
  if (session.v !== 3) {
    if (kind === 'worldbook') updateLegacyWbMergeBody();
    else updateLegacyPresetMergeBody();
    return;
  }

  ['source', 'base'].forEach((side) => {
    const paneEl = modalLayerEl.querySelector(`.td-dual-pane[data-side='${side}']`);
    if (!paneEl) return;
    const listEl = paneEl.querySelector(`[data-role='dual-list-${side}']`);
    const prevTop = listEl ? listEl.scrollTop : 0;
    const activePane = session.activePane || 'both';
    const isHidden = (activePane === 'source' && side !== 'source') || (activePane === 'base' && side !== 'base');
    const isExpanded = activePane === side;
    paneEl.classList.toggle('is-hidden', isHidden);
    paneEl.classList.toggle('is-expanded', isExpanded);
    const expBtn = paneEl.querySelector("[data-action='dual-toggle-expand-pane']");
    if (expBtn) {
      expBtn.innerHTML = isExpanded ? ICONS.minimize : ICONS.maximize;
      expBtn.title = isExpanded ? '恢复双栏' : '展开此栏';
    }
    const cntEl = paneEl.querySelector(`[data-role='pane-count-${side}']`);
    const list = side === 'source' ? session.sourceEntries : session.baseEntries;
    if (cntEl) cntEl.textContent = `${list.length}条`;

    const selCount = (side === 'source' ? session.sourceSelected : session.baseSelected).size;
    const migBtn = paneEl.querySelector(`[data-role='pane-mig-btn-${side}']`);
    const delBtn = paneEl.querySelector(`[data-role='pane-del-btn-${side}']`);
    if (migBtn) { migBtn.textContent = `迁移已选 (${selCount})`; migBtn.disabled = selCount === 0; }
    if (delBtn) { delBtn.textContent = `移除 (${selCount})`; delBtn.disabled = selCount === 0; }

    if (listEl) {
      listEl.innerHTML = getDualPaneEntriesHtml(session, side);
      if (prevTop > 0) {
        listEl._tdIgnoreScroll = true;
        listEl.scrollTop = prevTop;
        listEl._tdLastTop = listEl.scrollTop;
        requestAnimationFrame(() => { listEl._tdIgnoreScroll = false; });
      }
    }
  });

  const midWrap = modalLayerEl.querySelector("[data-role='dual-midbar-wrap']");
  if (midWrap) midWrap.innerHTML = renderDualMidBarHtml(session);
  bindDualScrollSync(modalLayerEl, session);
}

function updateLegacyPresetMergeBody() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl || !state.modal || state.modal.type !== 'presetMerge') return;
  const session = state.modal.session;
  const box = modalLayerEl.querySelector("[data-role='merge-list']");
  const ctrlBox = modalLayerEl.querySelector('.td-picker-controls');
  const toggleBtn = modalLayerEl.querySelector("[data-action='toggle-merge-controls']");
  const summaryEl = modalLayerEl.querySelector("[data-role='merge-summary-text']");
  if (!box) return;
  if (ctrlBox) ctrlBox.classList.toggle('is-open', !!session.controlsOpen);
  if (toggleBtn) toggleBtn.classList.toggle('is-active', !!session.controlsOpen);
  const dirtyEl = modalLayerEl.querySelector("[data-role='pm-merge-dirty']");
  if (dirtyEl) {
    const customCnt = session.entries.filter((e) => e.choice === 'custom').length;
    dirtyEl.textContent = session.dirty ? `有未应用缝合${customCnt > 0 ? `（含手动缝合 ${customCnt} 项）` : ''} · 尚未写入` : '';
    dirtyEl.style.display = session.dirty ? 'block' : 'none';
  }
  if (summaryEl) {
    const totalDiff = session.stats.conflict + session.stats.added + session.stats.removed;
    const qText = (session.query || '').trim();
    summaryEl.textContent = `${MERGE_FILTER_LABELS[session.filter] || '差异'} · 冲突${session.stats.conflict}/增${session.stats.added}/删${session.stats.removed}${totalDiff === 0 ? ' (完全一致)' : ''}${qText ? ` · 搜"${qText}"` : ''}`;
  }
  modalLayerEl.querySelectorAll("[data-action='set-merge-filter']").forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === session.filter);
  });
  const q = (session.query || '').trim().toLowerCase();
  const filtered = session.entries.filter((it) => {
    if (session.filter === 'diff' && it.status === 'same') return false;
    if (session.filter === 'conflict' && it.status !== 'conflict') return false;
    if (session.filter === 'added' && it.status !== 'added') return false;
    if (session.filter === 'removed' && it.status !== 'removed') return false;
    if (!q) return true;
    return (it.name || '').toLowerCase().includes(q) || (it.oldPrompt?.content || '').toLowerCase().includes(q) || (it.newPrompt?.content || '').toLowerCase().includes(q);
  });
  if (filtered.length === 0) { box.innerHTML = "<div class='td-group-empty'>当前筛选条件下没有条目</div>"; return; }
  const prevScroll = box.scrollTop;
  box.innerHTML = filtered.map((it) => {
    const tag = it.status === 'conflict' ? "<span class='td-mode-tag single'>冲突差异</span>" : (it.status === 'added' ? "<span class='td-mode-tag ok'>新版新增</span>" : (it.status === 'removed' ? "<span class='td-mode-tag del'>新版删除</span>" : "<span class='td-mode-tag multi'>一致</span>"));
    const choiceLabel = it.choice === 'old' ? '保留旧版' : (it.choice === 'custom' ? '手动缝合' : '采用新版');
    const choiceTag = it.status === 'same' ? '' : `<span class='td-src-badge'>裁决: ${choiceLabel}</span>`;
    let bodyHtml = '';
    if (it.expanded) {
      let diffHtml = '';
      if (it.status === 'conflict' && (it.oldPrompt?.content || '') !== (it.newPrompt?.content || '')) {
        const lines = computeLineDiff(it.oldPrompt?.content || '', it.newPrompt?.content || '');
        diffHtml = `<div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`;
      } else if (it.status === 'added' && it.newPrompt?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line add'>${escapeHtml(it.newPrompt.content)}</div></div>`;
      } else if (it.status === 'removed' && it.oldPrompt?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line del'>${escapeHtml(it.oldPrompt.content)}</div></div>`;
      }
      const actionsHtml = it.status === 'same' ? '' : `<div class='td-merge-actions'>${it.oldPrompt ? `<button type='button' class='td-merge-choice ${it.choice === 'old' ? 'active-old' : ''}' data-action='set-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='old'>保留旧版</button>` : ''}<button type='button' class='td-merge-choice ${it.choice === 'new' ? 'active-new' : ''}' data-action='set-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='new'>${it.status === 'removed' ? '确认删除' : '采用新版'}</button><button type='button' class='td-merge-choice ${it.choice === 'custom' ? 'active-custom' : ''}' data-action='open-merge-custom' data-entry-key='${escapeHtml(it.key)}'>编辑缝合</button><button type='button' class='td-merge-choice' data-action='open-merge-custom-content-only' data-entry-key='${escapeHtml(it.key)}'>只缝合内容</button></div>`;
      bodyHtml = `<div class='td-merge-body'><div style='font-size:11.5px;color:var(--td-text-muted);'>差异原因：${escapeHtml(it.diffReasons.join(' · ') || '无差异')}</div>${actionsHtml}${diffHtml}</div>`;
    }
    return `<div class='td-merge-card'><div class='td-merge-head' data-action='toggle-merge-expand' data-entry-key='${escapeHtml(it.key)}'>${tag}<span class='td-merge-title' title='${escapeHtml(it.name)}'>${escapeHtml(it.name)}</span>${choiceTag}</div>${bodyHtml}</div>`;
  }).join('');
  if (prevScroll > 0) box.scrollTop = prevScroll;
}

function updateLegacyWbMergeBody() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl || !state.modal || state.modal.type !== 'wbMerge') return;
  const session = state.modal.session;
  const box = modalLayerEl.querySelector("[data-role='wb-merge-list']");
  const ctrlBox = modalLayerEl.querySelector('.td-picker-controls');
  const toggleBtn = modalLayerEl.querySelector("[data-action='toggle-wb-merge-controls']");
  const summaryEl = modalLayerEl.querySelector("[data-role='wb-merge-summary-text']");
  if (!box) return;
  if (ctrlBox) ctrlBox.classList.toggle('is-open', !!session.controlsOpen);
  if (toggleBtn) toggleBtn.classList.toggle('is-active', !!session.controlsOpen);
  const dirtyEl = modalLayerEl.querySelector("[data-role='wb-merge-dirty']");
  if (dirtyEl) {
    const customCnt = session.entries.filter((e) => e.choice === 'custom').length;
    dirtyEl.textContent = session.dirty ? `有未应用缝合${customCnt > 0 ? `（含手动缝合 ${customCnt} 项）` : ''} · 尚未写入` : '';
    dirtyEl.style.display = session.dirty ? 'block' : 'none';
  }
  if (summaryEl) {
    const totalDiff = session.stats.conflict + session.stats.added + session.stats.removed;
    const qText = (session.query || '').trim();
    summaryEl.textContent = `冲突${session.stats.conflict}/增${session.stats.added}/删${session.stats.removed}${totalDiff === 0 ? ' (完全一致)' : ''}${qText ? ` · 搜"${qText}"` : ''}`;
  }
  modalLayerEl.querySelectorAll("[data-action='set-wb-merge-filter']").forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === session.filter);
  });
  const q = (session.query || '').trim().toLowerCase();
  const filtered = session.entries.filter((it) => {
    if (session.filter === 'diff' && it.status === 'same') return false;
    if (session.filter === 'conflict' && it.status !== 'conflict') return false;
    if (session.filter === 'added' && it.status !== 'added') return false;
    if (session.filter === 'removed' && it.status !== 'removed') return false;
    if (!q) return true;
    return (it.name || '').toLowerCase().includes(q) || (it.oldEntry?.content || '').toLowerCase().includes(q) || (it.newEntry?.content || '').toLowerCase().includes(q) || formatKeysInput(it.newEntry?.strategy?.keys).toLowerCase().includes(q);
  });
  if (filtered.length === 0) { box.innerHTML = "<div class='td-group-empty'>当前筛选条件下没有世界书条目</div>"; return; }
  const prevScroll = box.scrollTop;
  box.innerHTML = filtered.map((it) => {
    const tag = it.status === 'conflict' ? "<span class='td-mode-tag single'>冲突差异</span>" : (it.status === 'added' ? "<span class='td-mode-tag ok'>新版新增</span>" : (it.status === 'removed' ? "<span class='td-mode-tag del'>新版删除</span>" : "<span class='td-mode-tag multi'>一致</span>"));
    const choiceLabel = it.choice === 'old' ? '保留旧版' : (it.choice === 'custom' ? '手动缝合' : '采用新版');
    const choiceTag = it.status === 'same' ? '' : `<span class='td-src-badge'>裁决: ${choiceLabel}</span>`;
    let bodyHtml = '';
    if (it.expanded) {
      let diffHtml = '';
      if (it.status === 'conflict' && (it.oldEntry?.content || '') !== (it.newEntry?.content || '')) {
        const lines = computeLineDiff(it.oldEntry?.content || '', it.newEntry?.content || '');
        diffHtml = `<div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`;
      } else if (it.status === 'added' && it.newEntry?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line add'>${escapeHtml(it.newEntry.content)}</div></div>`;
      } else if (it.status === 'removed' && it.oldEntry?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line del'>${escapeHtml(it.oldEntry.content)}</div></div>`;
      }
      const actionsHtml = it.status === 'same' ? '' : `<div class='td-merge-actions'>${it.oldEntry ? `<button type='button' class='td-merge-choice ${it.choice === 'old' ? 'active-old' : ''}' data-action='set-wb-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='old'>保留旧版</button>` : ''}<button type='button' class='td-merge-choice ${it.choice === 'new' ? 'active-new' : ''}' data-action='set-wb-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='new'>${it.status === 'removed' ? '确认删除' : '采用新版'}</button><button type='button' class='td-merge-choice ${it.choice === 'custom' ? 'active-custom' : ''}' data-action='open-wb-merge-custom' data-entry-key='${escapeHtml(it.key)}'>编辑缝合</button><button type='button' class='td-merge-choice' data-action='open-wb-merge-custom-content-only' data-entry-key='${escapeHtml(it.key)}'>只缝合内容</button></div>`;
      bodyHtml = `<div class='td-merge-body'><div style='font-size:11.5px;color:var(--td-text-muted);'>差异原因：${escapeHtml(it.diffReasons.join(' · ') || '无差异')}</div>${actionsHtml}${diffHtml}</div>`;
    }
    return `<div class='td-merge-card'><div class='td-merge-head' data-action='toggle-wb-merge-expand' data-entry-key='${escapeHtml(it.key)}'>${tag}<span class='td-merge-title' title='${escapeHtml(it.name)}'>${escapeHtml(it.name)}</span>${choiceTag}</div>${bodyHtml}</div>`;
  }).join('');
  if (prevScroll > 0) box.scrollTop = prevScroll;
}

export function updatePresetMergeBody() { updateDualMergeBody('preset'); }
export function updateWbMergeBody() { updateDualMergeBody('worldbook'); }

export const mergePanelUiModule = {
  confirmDirty(onProceed) {
    const m = state.modal;
    if (!m || (m.type !== 'presetMerge' && m.type !== 'wbMerge') || !m.session?.dirty) return false;
    const isPreset = m.type === 'presetMerge';
    const draftKey = isPreset ? 'preset' : 'worldbook';
    const sName = m.session.sourceName || m.session.oldName;
    const bName = m.session.baseName || m.session.newName;
    openConfirm({
      title: '未保存的缝合修改',
      message: `${isPreset ? '预设' : '世界书'}对比缝合「${sName} ⇄ ${bName}」已有修改尚未写入，直接关闭不会生效，是否暂存草稿？`,
      confirmText: '放弃并关闭',
      confirmClass: 'danger',
      extraButton: {
        text: '暂存草稿并关闭',
        className: 'primary',
        onClick: () => {
          saveMergeDraft(draftKey, m.session);
          notify('info', '已暂存缝合草稿，下次打开对比缝合可继续');
          onProceed();
        },
      },
      onConfirm: () => {
        const curDraft = state.mergeDrafts && state.mergeDrafts[draftKey];
        if (curDraft && (curDraft === m.session || ((curDraft.sourceName || curDraft.oldName) === sName && (curDraft.baseName || curDraft.newName) === bName))) {
          clearMergeDraft(draftKey);
        }
        onProceed();
      },
    });
    return true;
  },

  renderModal(m, modalLayerEl) {
    if (m.type === 'presetMergeSelect') {
      const list = state.presetNames.filter((n) => n && n !== 'in_use');
      if (state.presetName && state.presetName !== 'in_use' && !list.includes(state.presetName)) list.unshift(state.presetName);
      const baseVal = (m.baseName && list.includes(m.baseName)) ? m.baseName : (state.presetName && state.presetName !== 'in_use' ? state.presetName : (list[0] || ''));
      const sourceVal = (m.sourceName && list.includes(m.sourceName)) ? m.sourceName : findBestMatchingOldPreset(baseVal, list);
      m.sourceName = sourceVal; m.baseName = baseVal;
      const draft = state.mergeDrafts?.preset;
      const draftHtml = draft ? `
        <div class='td-attr-warn-banner' style='display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;'>
          <span style='flex:1;min-width:160px;'>有未保存的缝合草稿：${escapeHtml(draft.sourceName || draft.oldName)} ⇄ ${escapeHtml(draft.baseName || draft.newName)}${draft._pendingCustom ? '（含未保存的条目编辑）' : ''}</span>
          <span style='display:flex;gap:6px;'>
            <button type='button' class='td-btn sm primary' data-action='resume-preset-merge'>继续上次缝合</button>
            <button type='button' class='td-btn sm' data-action='discard-preset-merge-draft'>丢弃</button>
          </span>
        </div>` : '';
      const optsHtml = (sel) => list.map((n) => `<option value='${escapeHtml(n)}' ${n === sel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
      modalLayerEl.innerHTML = `
        <div class='td-modal'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.gitMerge} 预设对比缝合</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='mergeSelect' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div>
          <div class='td-modal-body'>
            ${draftHtml}
            <div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>选择要进行双向对比与缝合的两个预设（A 与 B 均可独立编辑、互迁条目及保存）。</div>
            <div class='td-field'><label class='td-label'>预设 A（上方窗口）</label><select class='td-select' id='td-merge-source-select'>${optsHtml(sourceVal)}</select></div>
            <div style='display:flex;justify-content:center;'><button type='button' class='td-btn sm' data-action='swap-merge-presets'>${ICONS.swap} 交换 A / B</button></div>
            <div class='td-field'><label class='td-label'>预设 B（下方窗口 · 默认当前预设）</label><select class='td-select' id='td-merge-base-select'>${optsHtml(baseVal)}</select></div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='start-preset-merge'>开始缝合</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'presetMerge') {
      const s = m.session;
      if (s.v !== 3) {
        const titleStr = `${s.oldName} ⇄ ${s.newName}`;
        modalLayerEl.innerHTML = `<div class='td-modal td-modal-tall'><div class='td-modal-head'><div class='td-modal-title td-title-clickable' data-action='show-full-title' data-full-title='${escapeHtml(titleStr)}'>${escapeHtml(titleStr)}</div><div style='display:flex;gap:4px;'><button class='td-btn sm' data-action='toggle-merge-controls'>${ICONS.sliders} 筛选与批量</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div><div class='td-modal-body td-picker-body'><div class='td-picker-summary'><span data-role='merge-summary-text'></span></div><div class='td-picker-controls'><div class='td-filter-bar'><button class='td-chip' data-action='set-merge-filter' data-filter='diff'>差异</button><button class='td-chip' data-action='set-merge-filter' data-filter='conflict'>冲突</button><button class='td-chip' data-action='set-merge-filter' data-filter='added'>新增</button><button class='td-chip' data-action='set-merge-filter' data-filter='removed'>删除</button><button class='td-chip' data-action='set-merge-filter' data-filter='all'>全部</button></div><div class='td-filter-bar'><button class='td-btn sm' data-action='merge-batch-states'>仅迁移旧版开关</button><button class='td-btn sm' data-action='merge-batch-old'>全选保留旧版</button><button class='td-btn sm' data-action='merge-batch-new'>全选采用新版</button></div><input class='td-input' id='td-merge-search' type='text' value='${escapeHtml(s.query || '')}' /></div><div class='td-picker-list td-scroll' data-role='merge-list'></div></div><div class='td-modal-foot' style='flex-wrap:wrap;'><span data-role='pm-merge-dirty' style='width:100%;font-size:11.5px;font-weight:600;color:var(--td-single);display:none;'></span><div style='margin-right:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;'><input type='checkbox' class='td-checkbox' id='td-merge-settings-cb' ${s.migrateSettings ? 'checked' : ''} /><span>迁移旧版参数</span></div><button class='td-btn' data-action='merge-save-as'>另存为新预设</button><button class='td-btn primary' data-action='merge-apply-target'>覆盖新版预设</button></div></div>`;
        updateLegacyPresetMergeBody();
        uiCtx.syncOverlayBounds();
        return true;
      }

      modalLayerEl.innerHTML = `
        <div class='td-dual-shell'>
          ${renderDualPaneHtml(s, 'source')}
          <div data-role='dual-midbar-wrap'>${renderDualMidBarHtml(s)}</div>
          ${renderDualPaneHtml(s, 'base')}
        </div>`;
      bindDualScrollSync(modalLayerEl, s);
      return true;
    }

    if (m.type === 'wbMergeSelect') {
      const books = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
      const baseVal = (m.baseName && books.includes(m.baseName)) ? m.baseName : (books[0] || '');
      const sourceVal = (m.sourceName && books.includes(m.sourceName)) ? m.sourceName : findBestMatchingName(baseVal, books);
      m.sourceName = sourceVal; m.baseName = baseVal;
      const draft = state.mergeDrafts?.worldbook;
      const draftHtml = draft ? `
        <div class='td-attr-warn-banner' style='display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;'>
          <span style='flex:1;min-width:160px;'>有未保存的缝合草稿：${escapeHtml(draft.sourceName || draft.oldName)} ⇄ ${escapeHtml(draft.baseName || draft.newName)}${draft._pendingCustom ? '（含未保存的条目编辑）' : ''}</span>
          <span style='display:flex;gap:6px;'>
            <button type='button' class='td-btn sm primary' data-action='resume-wb-merge'>继续上次缝合</button>
            <button type='button' class='td-btn sm' data-action='discard-wb-merge-draft'>丢弃</button>
          </span>
        </div>` : '';
      const optsHtml = (sel) => books.map((n) => `<option value='${escapeHtml(n)}' ${n === sel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
      modalLayerEl.innerHTML = `
        <div class='td-modal'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.gitMerge} 世界书对比缝合</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='mergeSelect' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div>
          <div class='td-modal-body'>
            ${draftHtml}
            ${books.length < 2
              ? "<div class='td-empty'><div class='td-empty-title'>世界书数量不足</div><div class='td-empty-desc'>至少需要 2 本世界书才能进行对比与缝合。</div></div>"
              : `<div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>选择要进行双向对比与缝合的两本世界书（A 与 B 均可独立编辑、互迁条目及保存）。</div>
                 <div class='td-field'><label class='td-label'>世界书 A（上方窗口）</label><select class='td-select' id='td-wb-merge-source-select'>${optsHtml(sourceVal)}</select></div>
                 <div style='display:flex;justify-content:center;'><button type='button' class='td-btn sm' data-action='swap-wb-merge'>${ICONS.swap} 交换 A / B</button></div>
                 <div class='td-field'><label class='td-label'>世界书 B（下方窗口）</label><select class='td-select' id='td-wb-merge-base-select'>${optsHtml(baseVal)}</select></div>`}
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button>${books.length >= 2 ? `<button class='td-btn primary' data-action='start-wb-merge'>开始缝合</button>` : ''}</div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'wbMerge') {
      const s = m.session;
      if (s.v !== 3) {
        const titleStr = `${s.oldName} ⇄ ${s.newName}`;
        modalLayerEl.innerHTML = `<div class='td-modal td-modal-tall'><div class='td-modal-head'><div class='td-modal-title td-title-clickable' data-action='show-full-title' data-full-title='${escapeHtml(titleStr)}'>${escapeHtml(titleStr)}</div><div style='display:flex;gap:4px;'><button class='td-btn sm' data-action='toggle-wb-merge-controls'>${ICONS.sliders} 筛选与批量</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div><div class='td-modal-body td-picker-body'><div class='td-picker-summary'><span data-role='wb-merge-summary-text'></span></div><div class='td-picker-controls'><div class='td-filter-bar'><button class='td-chip' data-action='set-wb-merge-filter' data-filter='diff'>差异</button><button class='td-chip' data-action='set-wb-merge-filter' data-filter='conflict'>冲突</button><button class='td-chip' data-action='set-wb-merge-filter' data-filter='added'>新增</button><button class='td-chip' data-action='set-wb-merge-filter' data-filter='removed'>删除</button><button class='td-chip' data-action='set-wb-merge-filter' data-filter='all'>全部</button></div><div class='td-filter-bar'><button class='td-btn sm' data-action='wb-merge-batch-states'>仅迁移旧版开关</button><button class='td-btn sm' data-action='wb-merge-batch-old'>全选保留旧版</button><button class='td-btn sm' data-action='wb-merge-batch-new'>全选采用新版</button></div><input class='td-input' id='td-wb-merge-search' type='text' value='${escapeHtml(s.query || '')}' /></div><div class='td-picker-list td-scroll' data-role='wb-merge-list'></div></div><div class='td-modal-foot' style='flex-wrap:wrap;'><span data-role='wb-merge-dirty' style='margin-right:auto;font-size:11.5px;font-weight:600;color:var(--td-single);display:none;'></span><button class='td-btn' data-action='wb-merge-save-as'>另存为新世界书</button><button class='td-btn primary' data-action='wb-merge-apply-target'>覆盖新版世界书</button></div></div>`;
        updateLegacyWbMergeBody();
        uiCtx.syncOverlayBounds();
        return true;
      }

      modalLayerEl.innerHTML = `
        <div class='td-dual-shell'>
          ${renderDualPaneHtml(s, 'source')}
          <div data-role='dual-midbar-wrap'>${renderDualMidBarHtml(s)}</div>
          ${renderDualPaneHtml(s, 'base')}
        </div>`;
      bindDualScrollSync(modalLayerEl, s);
      return true;
    }

    return false;
  },

  renderPreview(previewLayerEl) {
    if (state.previewCtx?.type === 'mergeCustom') {
      renderPresetMergeCustomModal(previewLayerEl, ICONS);
      editHistory.stack = [readPreviewSnapshot()];
      editHistory.index = 0;
      updatePreviewHistoryButtons();
      uiCtx.syncOverlayBounds();
      return true;
    }
    if (state.previewCtx?.type === 'wbMergeCustom') {
      renderWbMergeCustomModal(previewLayerEl, ICONS);
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

    if (handleMergeUiClick(e, actionEl, action, previewLayerEl, {
      renderPreviewModal: uiCtx.renderPreviewModal,
      updatePresetMergeBody,
      updateWbMergeBody,
      pushEditSnapshot,
    })) return true;

    if (action === 'open-preset-merge') { state.modal = { type: 'presetMergeSelect', sourceName: '', baseName: '' }; uiCtx.renderModal(); return true; }
    if (action === 'resume-preset-merge' && state.mergeDrafts?.preset) {
      const rawDraft = state.mergeDrafts.preset;
      try {
        const session = hydratePresetMergeDraft(rawDraft);
        if (rawDraft.v !== 2 && rawDraft.v !== 3) saveMergeDraft('preset', session);
        state.modal = { type: 'presetMerge', session };
        uiCtx.renderModal();
        if (session._pendingCustom) {
          const pc = session._pendingCustom;
          if (session.v === 3) {
            const sItem = pc.srcRef ? session.sourceEntries.find((x) => x.origRef === pc.srcRef) : null;
            const bItem = pc.targetKey ? session.baseEntries.find((x) => x._key === pc.targetKey) : null;
            state.previewKey = null; state.snapshotDetailId = null;
            state.previewCtx = {
              type: 'mergeCustom',
              isDualV3: true,
              targetSide: pc.targetSide || 'base',
              targetKey: pc.targetKey || null,
              srcKey: sItem?._key || null,
              baseKey: bItem?._key || null,
              srcRef: pc.srcRef || null,
              baseRef: pc.baseRef || null,
              entry: {
                key: bItem?._key || sItem?._key || 'draft',
                id: bItem?.data?.id || sItem?.data?.id || '',
                name: pc.entryName || bItem?.data?.name || sItem?.data?.name || '条目',
                oldPrompt: sItem ? JSON.parse(JSON.stringify(sItem.data)) : null,
                newPrompt: bItem ? JSON.parse(JSON.stringify(bItem.data)) : null,
                customPrompt: null,
              },
              contentOnly: !!pc.contentOnly,
              syncScroll: false,
              edited: true,
              draft: JSON.parse(JSON.stringify(pc.draft)),
            };
            uiCtx.renderPreviewModal();
          } else {
            const entry = session.entries.find((x) => x.key === pc.entryKey);
            if (entry) {
              state.previewKey = null; state.snapshotDetailId = null;
              state.previewCtx = { type: 'mergeCustom', entry, contentOnly: !!pc.contentOnly, syncScroll: false, edited: true, draft: JSON.parse(JSON.stringify(pc.draft)) };
              uiCtx.renderPreviewModal();
            }
          }
        }
        notify('info', '已恢复上次未完成的预设缝合草稿');
      } catch (err) {
        logError('恢复预设缝合草稿失败', err);
        notify('error', `恢复草稿失败（可能原预设已删除或改名）: ${err.message || err}`);
      }
      return true;
    }
    if (action === 'discard-preset-merge-draft') { clearMergeDraft('preset'); uiCtx.renderModal(); return true; }
    if (action === 'swap-merge-presets' && state.modal?.type === 'presetMergeSelect') {
      const srcSel = modalLayerEl?.querySelector('#td-merge-source-select'), baseSel = modalLayerEl?.querySelector('#td-merge-base-select');
      const a = srcSel ? srcSel.value : state.modal.sourceName, b = baseSel ? baseSel.value : state.modal.baseName;
      state.modal.sourceName = b; state.modal.baseName = a;
      if (srcSel) srcSel.value = b; if (baseSel) baseSel.value = a;
      return true;
    }
    if (action === 'start-preset-merge' && state.modal?.type === 'presetMergeSelect') {
      const srcSel = modalLayerEl?.querySelector('#td-merge-source-select'), baseSel = modalLayerEl?.querySelector('#td-merge-base-select');
      const sourceName = srcSel ? srcSel.value : state.modal.sourceName, baseName = baseSel ? baseSel.value : state.modal.baseName;
      if (!sourceName || !baseName) { notify('warning', '请选择要缝合的两个预设'); return true; }
      if (sourceName === baseName) { notify('warning', '请选择两个不同的预设进行对比缝合'); return true; }
      try { state.modal = { type: 'presetMerge', session: buildDualPresetSession(sourceName, baseName) }; uiCtx.renderModal(); }
      catch (err) { logError('读取预设失败', err); notify('error', `读取预设失败: ${err.message || err}`); }
      return true;
    }

    if (action === 'open-wb-merge') { state.modal = { type: 'wbMergeSelect', sourceName: '', baseName: '' }; uiCtx.renderModal(); return true; }
    if (action === 'resume-wb-merge' && state.mergeDrafts?.worldbook) {
      const rawDraft = state.mergeDrafts.worldbook;
      hydrateWbMergeDraft(rawDraft).then((session) => {
        if (rawDraft.v !== 2 && rawDraft.v !== 3) saveMergeDraft('worldbook', session);
        state.modal = { type: 'wbMerge', session };
        uiCtx.renderModal();
        if (session._pendingCustom) {
          const pc = session._pendingCustom;
          if (session.v === 3) {
            const sItem = pc.srcRef ? session.sourceEntries.find((x) => x.origRef === pc.srcRef) : null;
            const bItem = pc.targetKey ? session.baseEntries.find((x) => x._key === pc.targetKey) : null;
            state.previewKey = null; state.snapshotDetailId = null;
            state.previewCtx = {
              type: 'wbMergeCustom',
              isDualV3: true,
              targetSide: pc.targetSide || 'base',
              targetKey: pc.targetKey || null,
              srcKey: sItem?._key || null,
              baseKey: bItem?._key || null,
              srcRef: pc.srcRef || null,
              baseRef: pc.baseRef || null,
              entry: {
                key: bItem?._key || sItem?._key || 'draft',
                uid: bItem?.data?.uid ?? sItem?.data?.uid ?? 0,
                name: pc.entryName || bItem?.data?.name || sItem?.data?.name || '条目',
                oldEntry: sItem ? cloneWorldbookEntry(sItem.data) : null,
                newEntry: bItem ? cloneWorldbookEntry(bItem.data) : null,
                customEntry: null,
              },
              contentOnly: !!pc.contentOnly,
              syncScroll: false,
              edited: true,
              draft: JSON.parse(JSON.stringify(pc.draft)),
            };
            uiCtx.renderPreviewModal();
          } else {
            const entry = session.entries.find((x) => x.key === pc.entryKey);
            if (entry) {
              state.previewKey = null; state.snapshotDetailId = null;
              state.previewCtx = { type: 'wbMergeCustom', entry, contentOnly: !!pc.contentOnly, syncScroll: false, edited: true, draft: JSON.parse(JSON.stringify(pc.draft)) };
              uiCtx.renderPreviewModal();
            }
          }
        }
        notify('info', '已恢复上次未完成的世界书缝合草稿');
      }).catch((err) => {
        logError('恢复世界书缝合草稿失败', err);
        notify('error', `恢复草稿失败（可能原世界书已删除或改名）: ${err.message || err}`);
      });
      return true;
    }
    if (action === 'discard-wb-merge-draft') { clearMergeDraft('worldbook'); uiCtx.renderModal(); return true; }
    if (action === 'swap-wb-merge' && state.modal?.type === 'wbMergeSelect') {
      const srcSel = modalLayerEl?.querySelector('#td-wb-merge-source-select'), baseSel = modalLayerEl?.querySelector('#td-wb-merge-base-select');
      const a = srcSel ? srcSel.value : state.modal.sourceName, b = baseSel ? baseSel.value : state.modal.baseName;
      state.modal.sourceName = b; state.modal.baseName = a; if (srcSel) srcSel.value = b; if (baseSel) baseSel.value = a;
      return true;
    }
    if (action === 'start-wb-merge' && state.modal?.type === 'wbMergeSelect') {
      const sourceName = modalLayerEl?.querySelector('#td-wb-merge-source-select')?.value || state.modal.sourceName;
      const baseName = modalLayerEl?.querySelector('#td-wb-merge-base-select')?.value || state.modal.baseName;
      if (!sourceName || !baseName || sourceName === baseName) { notify('warning', '请选择两本不同的世界书'); return true; }
      buildDualWorldbookSession(sourceName, baseName).then((session) => { state.modal = { type: 'wbMerge', session }; uiCtx.renderModal(); })
        .catch((err) => { logError('读取对比世界书失败', err); notify('error', `读取世界书失败: ${err.message || err}`); });
      return true;
    }

    const session = (state.modal?.type === 'presetMerge' || state.modal?.type === 'wbMerge') ? state.modal.session : null;
    if (session?.v === 3) {
      const isPreset = session.kind === 'preset';
      const side = actionEl.getAttribute('data-side');
      const key = actionEl.getAttribute('data-key');

      if (action === 'dual-toggle-expand-pane') {
        session.activePane = session.activePane === side ? 'both' : side;
        updateDualMergeBody(session.kind);
        return true;
      }
      if (action === 'dual-toggle-sync-scroll') {
        session.syncScroll = !session.syncScroll;
        updateDualMergeBody(session.kind);
        return true;
      }
      if (action === 'dual-toggle-save-menu') {
        session.saveMenuOpen = !session.saveMenuOpen;
        updateDualMergeBody(session.kind);
        return true;
      }
      if (action === 'dual-pair-pick') {
        session.pairPickMode = !session.pairPickMode;
        session.pairSourceKey = null;
        session.pairBaseKey = null;
        if (session.pairPickMode) {
          session.activePane = 'both';
          session.sourceBatch = false;
          session.baseBatch = false;
          session.sourceSelected.clear();
          session.baseSelected.clear();
          uiCtx.renderModal();
        } else {
          updateDualMergeBody(session.kind);
        }
        return true;
      }
      if (action === 'dual-pair-select') {
        if (!session.pairPickMode) return true;
        if (side === 'source') session.pairSourceKey = session.pairSourceKey === key ? null : key;
        else session.pairBaseKey = session.pairBaseKey === key ? null : key;
        if (session.pairSourceKey && session.pairBaseKey) {
          const sk = session.pairSourceKey;
          const bk = session.pairBaseKey;
          session.pairPickMode = false;
          session.pairSourceKey = null;
          session.pairBaseKey = null;
          state.previewKey = null;
          state.snapshotDetailId = null;
          state.previewCtx = { type: 'mergeEntryDiff', kind: session.kind, sourceKey: sk, baseKey: bk };
          updateDualMergeBody(session.kind);
          uiCtx.renderPreviewModal();
        } else {
          updateDualMergeBody(session.kind);
        }
        return true;
      }
      if (action === 'dual-batch-toggle') {
        session.pairPickMode = false;
        session.pairSourceKey = null;
        session.pairBaseKey = null;
        if (side === 'source') { session.sourceBatch = !session.sourceBatch; session.sourceSelected.clear(); }
        else { session.baseBatch = !session.baseBatch; session.baseSelected.clear(); }
        uiCtx.renderModal();
        return true;
      }
      if (action === 'dual-batch-check') {
        const set = side === 'source' ? session.sourceSelected : session.baseSelected;
        if (set.has(key)) set.delete(key); else set.add(key);
        actionEl.closest('.td-dual-row')?.classList.toggle('is-active', set.has(key));
        const migBtn = modalLayerEl?.querySelector(`[data-role='pane-mig-btn-${side}']`);
        const delBtn = modalLayerEl?.querySelector(`[data-role='pane-del-btn-${side}']`);
        if (migBtn) { migBtn.textContent = `迁移已选 (${set.size})`; migBtn.disabled = set.size === 0; }
        if (delBtn) { delBtn.textContent = `移除 (${set.size})`; delBtn.disabled = set.size === 0; }
        return true;
      }
      if (action === 'dual-batch-all') {
        const set = side === 'source' ? session.sourceSelected : session.baseSelected;
        modalLayerEl?.querySelectorAll(`[data-role='dual-list-${side}'] .td-dual-row[data-key]`).forEach((row) => {
          set.add(row.getAttribute('data-key'));
        });
        updateDualMergeBody(session.kind);
        return true;
      }
      if (action === 'dual-batch-none') {
        const set = side === 'source' ? session.sourceSelected : session.baseSelected;
        set.clear();
        updateDualMergeBody(session.kind);
        return true;
      }
      if (action === 'dual-batch-migrate' || action === 'dual-migrate-one') {
        e.stopPropagation();
        const keys = action === 'dual-migrate-one' ? [key] : Array.from(side === 'source' ? session.sourceSelected : session.baseSelected);
        if (keys.length === 0) { notify('warning', '请先勾选要迁移的条目'); return true; }
        const dstList = side === 'source' ? session.baseEntries : session.sourceEntries;
        state.selectPopup = {
          type: 'mergeMigrate',
          kind: session.kind,
          fromSide: side,
          selectedKeys: keys,
          targetScope: 'cross',
          crossMode: 'copy',
          overwriteMatch: false,
          placement: dstList.length > 0 ? 'after' : 'before',
          targetIndex1: Math.max(1, dstList.length),
        };
        uiCtx.renderSelectPopup();
        return true;
      }
      if (action === 'dual-delete-one') {
        e.stopPropagation();
        const list = side === 'source' ? session.sourceEntries : session.baseEntries;
        const idx = list.findIndex((x) => x._key === key);
        const item = idx >= 0 ? list[idx] : null;
        if (!item) return true;
        if (isPreset && PRESET_SYSTEM_IDS.has(item.data?.id)) {
          notify('warning', '系统内置占位符条目不可删除');
          return true;
        }
        const itemName = item.data?.name || item.data?.id || `条目 #${item.data?.uid}`;
        const sideLabel = side === 'source' ? `A (${session.sourceName})` : `B (${session.baseName})`;
        openConfirm({
          title: '删除条目确认',
          message: `确定要从 ${sideLabel} 中删除 #${idx + 1}「${itemName}」吗？（可在缝合界面撤销）`,
          confirmText: '确认删除',
          confirmClass: 'danger',
          onConfirm: () => {
            if (isPreset) pushPresetSessionUndo(session); else pushWbSessionUndo(session);
            const rmIdx = list.findIndex((x) => x._key === key);
            if (rmIdx >= 0) list.splice(rmIdx, 1);
            const selSet = side === 'source' ? session.sourceSelected : session.baseSelected;
            selSet?.delete(key);
            if (side === 'source' && session.pairSourceKey === key) session.pairSourceKey = null;
            if (side === 'base' && session.pairBaseKey === key) session.pairBaseKey = null;
            if (isPreset) recomputePresetSessionDirty(session); else recomputeWbSessionDirty(session);
            if (session.diffMarks) {
              session.diffMarks = (isPreset ? computePresetGlobalDiff(session) : computeWbGlobalDiff(session)).markByKey;
            }
            persistDualDraft(session);
            updateDualMergeBody(session.kind);
            notify('info', `已移除「${itemName}」`);
          },
        });
        return true;
      }
      if (action === 'dual-batch-remove') {
        const set = side === 'source' ? session.sourceSelected : session.baseSelected;
        if (set.size === 0) return true;
        openConfirm({
          title: '移除条目确认',
          message: `确定要从当前「${side === 'source' ? session.sourceName : session.baseName}」草稿中移除所选 ${set.size} 个条目吗？（系统内置占位符将自动跳过保护）`,
          confirmText: '确认移除',
          onConfirm: () => {
            if (isPreset) pushPresetSessionUndo(session); else pushWbSessionUndo(session);
            const list = side === 'source' ? session.sourceEntries : session.baseEntries;
            const kept = list.filter((it) => !set.has(it._key) || (isPreset && PRESET_SYSTEM_IDS.has(it.data?.id)));
            list.splice(0, list.length, ...kept);
            set.clear();
            if (isPreset) recomputePresetSessionDirty(session); else recomputeWbSessionDirty(session);
            if (session.diffMarks) {
              session.diffMarks = (isPreset ? computePresetGlobalDiff(session) : computeWbGlobalDiff(session)).markByKey;
            }
            persistDualDraft(session);
            uiCtx.renderModal();
          },
        });
        return true;
      }
      if (action === 'dual-toggle-enabled') {
        const list = side === 'source' ? session.sourceEntries : session.baseEntries;
        const item = list.find((x) => x._key === key);
        if (!item) return true;
        if (isPreset) pushPresetSessionUndo(session); else pushWbSessionUndo(session);
        item.data.enabled = !item.data.enabled;
        if (isPreset) recomputePresetSessionDirty(session); else recomputeWbSessionDirty(session);
        persistDualDraft(session);
        updateDualMergeBody(session.kind);
        return true;
      }
      if (action === 'dual-edit-entry') {
        e.stopPropagation();
        const list = side === 'source' ? session.sourceEntries : session.baseEntries;
        const item = list.find((x) => x._key === key);
        if (!item) return true;
        state.previewKey = null; state.snapshotDetailId = null;
        state.previewCtx = {
          type: 'mergeEntryEdit',
          kind: session.kind,
          side,
          itemKey: key,
          draftData: isPreset ? JSON.parse(JSON.stringify(item.data)) : cloneWorldbookEntry(item.data),
        };
        uiCtx.renderPreviewModal();
        return true;
      }
      if (action === 'dual-diff-entry') {
        const list = side === 'source' ? session.sourceEntries : session.baseEntries;
        const otherList = side === 'source' ? session.baseEntries : session.sourceEntries;
        const item = list.find((x) => x._key === key);
        if (!item) return true;
        const other = isPreset ? findPresetCounterpart(item, otherList) : findWbCounterpart(item, otherList);
        state.previewKey = null; state.snapshotDetailId = null;
        state.previewCtx = {
          type: 'mergeEntryDiff',
          kind: session.kind,
          sourceKey: side === 'source' ? item._key : (other ? other._key : null),
          baseKey: side === 'base' ? item._key : (other ? other._key : null),
        };
        uiCtx.renderPreviewModal();
        return true;
      }
      if (action === 'dual-global-diff') {
        const diffRes = isPreset ? computePresetGlobalDiff(session) : computeWbGlobalDiff(session);
        session.diffMarks = diffRes.markByKey;
        state.previewKey = null; state.snapshotDetailId = null;
        state.previewCtx = { type: 'mergeGlobalDiff', kind: session.kind, filter: 'diff' };
        updateDualMergeBody(session.kind);
        uiCtx.renderPreviewModal();
        return true;
      }
      if (action === 'dual-undo') {
        const ok = isPreset ? undoPresetSession(session) : undoWbSession(session);
        if (ok) { persistDualDraft(session); uiCtx.renderModal(); }
        return true;
      }
      if (action === 'dual-redo') {
        const ok = isPreset ? redoPresetSession(session) : redoWbSession(session);
        if (ok) { persistDualDraft(session); uiCtx.renderModal(); }
        return true;
      }
      if (action === 'dual-save-source') {
        let diffDetails = [];
        try {
          if (isPreset) {
            const pDir = session.migrateSettingsDir || (session.migrateSettings ? 'a2b' : 'none');
            const nextPreset = {
              prompts: session.sourceEntries.map((x) => x.data),
              settings: pDir === 'b2a' && session.origBasePreset?.settings ? session.origBasePreset.settings : session.origSourcePreset?.settings,
            };
            diffDetails = describePresetChanges(session.origSourcePreset, nextPreset).lines;
          } else {
            const origList = Object.keys(session.origMap || {})
              .filter((k) => k.startsWith('s:'))
              .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
              .map((k) => session.origMap[k].data);
            diffDetails = describeWorldbookChanges(origList, session.sourceEntries.map((x) => x.data)).lines;
          }
        } catch (err) {}
        openConfirm({
          title: '覆盖保存 A 确认',
          message: diffDetails.length > 0
            ? `确定要将 A 侧以下 ${diffDetails.length} 项变动覆盖保存到「${session.sourceName}」吗？（保存前会自动备份）`
            : `确定要将 A 侧内容覆盖保存到「${session.sourceName}」吗？（保存前会自动备份）`,
          details: diffDetails,
          confirmText: '确认覆盖 A',
          confirmClass: 'warn',
          onConfirm: () => {
            const p = isPreset ? saveDualPresetSide(session, 'source', 'overwrite') : saveDualWbSide(session, 'source', 'overwrite');
            p.then(() => {
              if (!session.dirty) clearMergeDraft(session.kind);
              else persistDualDraft(session);
              return isPreset ? refreshAllCatalogs() : refreshWorldbookCatalog(false);
            }).then(() => { uiCtx.renderMain(); uiCtx.renderModal(); }).catch((err) => { logError('保存 A 失败', err); notify('error', err.message || String(err)); });
          },
        });
        return true;
      }
      if (action === 'dual-save-source-as') {
        const newName = window.prompt(`请输入 A 侧另存为的新${isPreset ? '预设' : '世界书'}名称：`, `${session.sourceName}-缝合版`);
        if (!newName || !newName.trim()) return true;
        const p = isPreset ? saveDualPresetSide(session, 'source', 'new', newName.trim()) : saveDualWbSide(session, 'source', 'new', newName.trim());
        p.then(() => (isPreset ? refreshAllCatalogs() : refreshWorldbookCatalog(false)))
          .then(() => uiCtx.renderMain())
          .catch((err) => { logError('另存 A 失败', err); notify('error', err.message || String(err)); });
        return true;
      }
      if (action === 'dual-save-base') {
        let diffDetails = [];
        try {
          if (isPreset) {
            const pDir = session.migrateSettingsDir || (session.migrateSettings ? 'a2b' : 'none');
            const nextPreset = {
              prompts: session.baseEntries.map((x) => x.data),
              settings: pDir === 'a2b' && session.origSourcePreset?.settings ? session.origSourcePreset.settings : session.origBasePreset?.settings,
            };
            diffDetails = describePresetChanges(session.origBasePreset, nextPreset).lines;
          } else {
            const origList = Object.keys(session.origMap || {})
              .filter((k) => k.startsWith('b:'))
              .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
              .map((k) => session.origMap[k].data);
            diffDetails = describeWorldbookChanges(origList, session.baseEntries.map((x) => x.data)).lines;
          }
        } catch (err) {}
        openConfirm({
          title: '覆盖保存 B 确认',
          message: diffDetails.length > 0
            ? `确定要将 B 侧以下 ${diffDetails.length} 项变动覆盖保存到${isPreset ? '预设' : '世界书'}「${session.baseName}」吗？（保存前会自动备份）`
            : `确定要将 B 侧内容覆盖保存到${isPreset ? '预设' : '世界书'}「${session.baseName}」吗？（保存前会自动备份）`,
          details: diffDetails,
          confirmText: '确认覆盖 B',
          confirmClass: 'danger',
          onConfirm: () => {
            const p = isPreset ? saveDualPresetSide(session, 'base', 'overwrite') : saveDualWbSide(session, 'base', 'overwrite');
            p.then(() => {
              if (!session.dirty) clearMergeDraft(session.kind);
              else persistDualDraft(session);
              return isPreset ? refreshAllCatalogs() : refreshWorldbookCatalog(false);
            }).then(() => {
              uiCtx.renderMain();
              if (!session.dirty) { state.modal = null; uiCtx.renderModal(); }
              else uiCtx.renderModal();
            }).catch((err) => { logError('覆盖 B 失败', err); notify('error', err.message || String(err)); });
          },
        });
        return true;
      }
      if (action === 'dual-save-base-as') {
        const newName = window.prompt(`请输入 B 侧另存为的新${isPreset ? '预设' : '世界书'}名称：`, `${session.baseName}-缝合版`);
        if (!newName || !newName.trim()) return true;
        const p = isPreset ? saveDualPresetSide(session, 'base', 'new', newName.trim()) : saveDualWbSide(session, 'base', 'new', newName.trim());
        p.then(() => {
          clearMergeDraft(session.kind);
          state.modal = null;
          uiCtx.renderModal();
          return isPreset ? refreshAllCatalogs() : refreshWorldbookCatalog(false);
        }).then(() => uiCtx.renderMain()).catch((err) => { logError('另存缝合结果失败', err); notify('error', err.message || String(err)); });
        return true;
      }
    }

    if (action === 'toggle-merge-controls' && state.modal?.type === 'presetMerge') { state.modal.session.controlsOpen = !state.modal.session.controlsOpen; updateLegacyPresetMergeBody(); return true; }
    if (action === 'set-merge-filter' && state.modal?.type === 'presetMerge') { state.modal.session.filter = actionEl.getAttribute('data-filter') || 'diff'; updateLegacyPresetMergeBody(); return true; }
    if (action === 'toggle-merge-expand' && state.modal?.type === 'presetMerge') {
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (entry) { entry.expanded = !entry.expanded; updateLegacyPresetMergeBody(); }
      return true;
    }
    if (action === 'set-merge-choice' && state.modal?.type === 'presetMerge') {
      e.stopPropagation();
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (entry) { entry.choice = actionEl.getAttribute('data-choice'); state.modal.session.dirty = true; saveMergeDraft('preset', state.modal.session); updateLegacyPresetMergeBody(); }
      return true;
    }
    if (action === 'merge-batch-old' && state.modal?.type === 'presetMerge') { state.modal.session.entries.forEach((it) => { if (it.oldPrompt) it.choice = 'old'; }); state.modal.session.dirty = true; saveMergeDraft('preset', state.modal.session); updateLegacyPresetMergeBody(); return true; }
    if (action === 'merge-batch-new' && state.modal?.type === 'presetMerge') { state.modal.session.entries.forEach((it) => { it.choice = 'new'; }); state.modal.session.dirty = true; saveMergeDraft('preset', state.modal.session); updateLegacyPresetMergeBody(); return true; }
    if (action === 'merge-batch-states' && state.modal?.type === 'presetMerge') {
      state.modal.session.entries.forEach((it) => {
        if (it.status === 'conflict' && it.oldPrompt && it.newPrompt) {
          const merged = JSON.parse(JSON.stringify(it.newPrompt)); merged.enabled = !!it.oldPrompt.enabled;
          it.customPrompt = merged; it.choice = 'custom';
        }
      });
      state.modal.session.dirty = true; saveMergeDraft('preset', state.modal.session); updateLegacyPresetMergeBody();
      return true;
    }
    if ((action === 'open-merge-custom' || action === 'open-merge-custom-content-only') && state.modal?.type === 'presetMerge') {
      e.stopPropagation();
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (!entry) return true;
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = initPresetMergeCustomCtx(entry, { contentOnly: action === 'open-merge-custom-content-only' });
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'merge-apply-target' && state.modal?.type === 'presetMerge') {
      const s = state.modal.session;
      openConfirm({
        title: '覆盖目标预设确认', message: `确定要覆盖保存到预设「${s.newName}」吗？`, confirmText: '确认覆盖保存', confirmClass: 'danger',
        onConfirm: () => executePresetStitch(s, 'overwrite').then(() => { s.dirty = false; delete s._pendingCustom; clearMergeDraft('preset'); state.modal = null; uiCtx.renderModal(); refreshAllCatalogs().then(() => uiCtx.renderMain()); }).catch((err) => { logError('覆盖失败', err); notify('error', err.message || String(err)); }),
      });
      return true;
    }
    if (action === 'merge-save-as' && state.modal?.type === 'presetMerge') {
      const s = state.modal.session;
      const newName = window.prompt('请输入另存为的新预设名称：', `${s.newName}-缝合版`);
      if (!newName || !newName.trim()) return true;
      executePresetStitch(s, 'new', newName.trim()).then(() => { s.dirty = false; delete s._pendingCustom; clearMergeDraft('preset'); state.modal = null; uiCtx.renderModal(); refreshAllCatalogs().then(() => uiCtx.renderMain()); }).catch((err) => { logError('另存失败', err); notify('error', err.message || String(err)); });
      return true;
    }

    if (action === 'toggle-wb-merge-controls' && state.modal?.type === 'wbMerge') { state.modal.session.controlsOpen = !state.modal.session.controlsOpen; updateLegacyWbMergeBody(); return true; }
    if (action === 'set-wb-merge-filter' && state.modal?.type === 'wbMerge') { state.modal.session.filter = actionEl.getAttribute('data-filter') || 'diff'; updateLegacyWbMergeBody(); return true; }
    if (action === 'toggle-wb-merge-expand' && state.modal?.type === 'wbMerge') {
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (entry) { entry.expanded = !entry.expanded; updateLegacyWbMergeBody(); }
      return true;
    }
    if (action === 'set-wb-merge-choice' && state.modal?.type === 'wbMerge') {
      e.stopPropagation();
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (entry) { entry.choice = actionEl.getAttribute('data-choice'); state.modal.session.dirty = true; saveMergeDraft('worldbook', state.modal.session); updateLegacyWbMergeBody(); }
      return true;
    }
    if (action === 'wb-merge-batch-old' && state.modal?.type === 'wbMerge') { state.modal.session.entries.forEach((it) => { if (it.oldEntry) it.choice = 'old'; }); state.modal.session.dirty = true; saveMergeDraft('worldbook', state.modal.session); updateLegacyWbMergeBody(); return true; }
    if (action === 'wb-merge-batch-new' && state.modal?.type === 'wbMerge') { state.modal.session.entries.forEach((it) => { it.choice = 'new'; }); state.modal.session.dirty = true; saveMergeDraft('worldbook', state.modal.session); updateLegacyWbMergeBody(); return true; }
    if (action === 'wb-merge-batch-states' && state.modal?.type === 'wbMerge') {
      state.modal.session.entries.forEach((it) => {
        if (it.status === 'conflict' && it.oldEntry && it.newEntry) {
          const merged = cloneWorldbookEntry(it.newEntry); merged.enabled = !!it.oldEntry.enabled;
          it.customEntry = merged; it.choice = 'custom';
        }
      });
      state.modal.session.dirty = true; saveMergeDraft('worldbook', state.modal.session); updateLegacyWbMergeBody();
      return true;
    }
    if ((action === 'open-wb-merge-custom' || action === 'open-wb-merge-custom-content-only') && state.modal?.type === 'wbMerge') {
      e.stopPropagation();
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (!entry) return true;
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = initWbMergeCustomCtx(entry, { contentOnly: action === 'open-wb-merge-custom-content-only' });
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'wb-merge-apply-target' && state.modal?.type === 'wbMerge') {
      const s = state.modal.session;
      openConfirm({
        title: '覆盖目标世界书确认', message: `确定要覆盖保存到世界书「${s.newName}」吗？`, confirmText: '确认覆盖', confirmClass: 'danger',
        onConfirm: () => executeWorldbookStitch(s, 'overwrite').then(() => { s.dirty = false; delete s._pendingCustom; clearMergeDraft('worldbook'); state.modal = null; uiCtx.renderModal(); refreshWorldbookCatalog(false).then(() => uiCtx.renderMain()); }).catch((err) => { logError('覆盖失败', err); notify('error', err.message || String(err)); }),
      });
      return true;
    }
    if (action === 'wb-merge-save-as' && state.modal?.type === 'wbMerge') {
      const s = state.modal.session;
      const newName = window.prompt('请输入另存为的新世界书名称：', `${s.newName}-缝合版`);
      if (!newName || !newName.trim()) return true;
      executeWorldbookStitch(s, 'new', newName.trim()).then(() => { s.dirty = false; delete s._pendingCustom; clearMergeDraft('worldbook'); state.modal = null; uiCtx.renderModal(); refreshWorldbookCatalog(false).then(() => uiCtx.renderMain()); }).catch((err) => { logError('另存失败', err); notify('error', err.message || String(err)); });
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    const previewLayerEl = uiCtx.getPreviewLayer();
    if (handleMergeUiInput(e, previewLayerEl)) return true;
    const id = target.id || '';
    const role = target.getAttribute('data-role') || '';
    if (role === 'dual-search' && (state.modal?.type === 'presetMerge' || state.modal?.type === 'wbMerge')) {
      const side = target.getAttribute('data-side');
      if (side === 'source') state.modal.session.sourceQuery = target.value;
      else state.modal.session.baseQuery = target.value;
      updateDualMergeBody(state.modal.session.kind);
      return true;
    }
    if (id === 'td-merge-search' && state.modal?.type === 'presetMerge') { state.modal.session.query = target.value; updateLegacyPresetMergeBody(); return true; }
    if (id === 'td-wb-merge-search' && state.modal?.type === 'wbMerge') { state.modal.session.query = target.value; updateLegacyWbMergeBody(); return true; }
    return false;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    const modalLayerEl = uiCtx.getModalLayer();

    if (target.getAttribute('data-action') === 'dual-toggle-param-dir' && state.modal?.type === 'presetMerge') {
      const s = state.modal.session;
      if (s?.v === 3) {
        const dir = target.getAttribute('data-dir') === 'b2a' ? 'b2a' : 'a2b';
        pushPresetSessionUndo(s);
        s.migrateSettingsDir = target.checked ? dir : 'none';
        recomputePresetSessionDirty(s);
        persistDualDraft(s);
        updateDualMergeBody('preset');
      }
      return true;
    }
    if (id === 'td-merge-settings-cb' && state.modal?.type === 'presetMerge') {
      const s = state.modal.session;
      if (s.v === 3) {
        pushPresetSessionUndo(s);
        s.migrateSettingsDir = target.checked ? 'a2b' : 'none';
        recomputePresetSessionDirty(s);
        persistDualDraft(s);
        updateDualMergeBody('preset');
      } else {
        s.migrateSettings = !!target.checked;
        s.dirty = true;
        saveMergeDraft('preset', s);
        updateLegacyPresetMergeBody();
      }
      return true;
    }
    if (id === 'td-merge-source-select' && state.modal?.type === 'presetMergeSelect') { state.modal.sourceName = target.value; return true; }
    if (id === 'td-merge-base-select' && state.modal?.type === 'presetMergeSelect') {
      state.modal.baseName = target.value;
      const matched = findBestMatchingOldPreset(target.value, state.presetNames);
      if (matched) {
        state.modal.sourceName = matched;
        const srcSel = modalLayerEl?.querySelector('#td-merge-source-select');
        if (srcSel) srcSel.value = matched;
      }
      return true;
    }
    if (id === 'td-merge-custom-enabled' && state.previewCtx?.type === 'mergeCustom') { pushEditSnapshot(true); return true; }

    if (id === 'td-wb-merge-source-select' && state.modal?.type === 'wbMergeSelect') { state.modal.sourceName = target.value; return true; }
    if (id === 'td-wb-merge-base-select' && state.modal?.type === 'wbMergeSelect') {
      state.modal.baseName = target.value;
      const books = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
      const matched = findBestMatchingName(target.value, books);
      if (matched) {
        state.modal.sourceName = matched;
        const srcSel = modalLayerEl?.querySelector('#td-wb-merge-source-select');
        if (srcSel) srcSel.value = matched;
      }
      return true;
    }

    return false;
  },
};
