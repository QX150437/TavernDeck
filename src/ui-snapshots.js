import { escapeHtml, formatTime, genId, cloneWorldbookEntries, hasTH, callTH, notify, logError } from './utils.js';
import { state, saveStore, hasSnapshotPayload, getSnapshotPayloadSizeBytes, deleteSnapshotPayload, setSnapshotPayload } from './store.js';
import {
  captureCurrentSnapshotData, captureWorldbookSnapshotData,
  computeSnapshotDiff, computeDetailedSnapshotDiff, applySnapshot,
  applySelectiveSnapshot, saveSnapshotAsNewTarget, exportSingleSnapshotAsStandardJson,
} from './snapshot.js';
import { ICONS, uiCtx, formatByteSize, openConfirm } from './ui-common.js';

export function updateSnapshotList() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl || !state.modal || state.modal.type !== 'snapshots') return;
  const listEl = modalLayerEl.querySelector("[data-role='snapshot-list']");
  if (!listEl) return;

  const m = state.modal;
  const kind = m.kind === 'worldbook' ? 'worldbook' : 'preset';
  const filter = m.filter || 'current';
  const q = (m.search || '').trim().toLowerCase();
  const targetFilterName = kind === 'worldbook' ? (m.targetBook || '') : (state.presetName || '');

  const allByKind = (state.store.snapshots || []).filter((s) => (s.kind || 'preset') === kind);
  const snaps = allByKind
    .filter((s) => {
      const tName = s.targetName || s.presetName || '';
      if (filter === 'current' && targetFilterName && tName !== targetFilterName) return false;
      if (filter === 'manual' && s.auto) return false;
      if (filter === 'auto' && !s.auto) return false;
      if (!q) return true;
      return (s.name || '').toLowerCase().includes(q)
        || (s.note || '').toLowerCase().includes(q)
        || tName.toLowerCase().includes(q);
    })
    .slice()
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });

  modalLayerEl.querySelectorAll("[data-action='set-snapshot-filter']").forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === filter);
  });

  if (snaps.length === 0) {
    listEl.innerHTML = `<div class='td-group-empty'>${filter === 'current' ? `当前${kind === 'worldbook' ? '世界书' : '预设'}暂无快照，点击上方按钮即可创建` : '暂无匹配的快照'}</div>`;
    return;
  }

  const compareBaseId = m.compareBaseId || null;

  listEl.innerHTML = snaps.map((s) => {
    const isFull = s.mode === 'full';
    const hasPayload = isFull && hasSnapshotPayload(s);
    const rawSize = isFull ? getSnapshotPayloadSizeBytes(s) : 0;
    const sizeText = rawSize > 0 ? formatByteSize(rawSize) : '';
    const diffs = computeSnapshotDiff(s);
    const tName = s.targetName || s.presetName || '未知';
    const sameTarget = !targetFilterName || tName === targetFilterName;
    const diffTag = !sameTarget
      ? "<span class='td-src-badge'>跨目标</span>"
      : (diffs.length === 0
        ? "<span class='td-mode-tag ok'>开关一致</span>"
        : `<span class='td-mode-tag single'>开关差异 ${diffs.length}</span>`);
    const isExpanded = m.expandedCardId === s.id;
    const isCompareBase = compareBaseId === s.id;
    const canCompare = compareBaseId && !isCompareBase;

    return `
      <div class='td-snap-card ${s.pinned ? 'is-pinned' : ''} ${isCompareBase ? 'is-compare-base' : ''}'>
        <div class='td-snap-head'>
          <div style='min-width:0;flex:1;'>
            <div class='td-snap-title'>${s.pinned ? '★ ' : ''}${escapeHtml(s.name)}</div>
            ${s.note ? `<div class='td-snap-note'>${escapeHtml(s.note)}</div>` : ''}
            <div class='td-snap-meta'>
              ${s.auto ? "<span class='td-mode-tag single'>自动备份</span>" : ''}
              <span class='td-mode-tag ${isFull ? 'single' : 'multi'}'>${isFull ? (hasPayload ? '完整快照' : '完整(载荷缺失)') : '开关快照'}${sizeText ? ` · ${sizeText}` : ''}</span>
              ${diffTag}
              <span>${kind === 'worldbook' ? '世界书' : '预设'}: ${escapeHtml(tName)}</span>
              <span>启用 ${s.stats ? s.stats.enabledCount : 0}/${s.stats ? s.stats.totalCount : 0}</span>
              <span>${escapeHtml(formatTime(s.updatedAt || s.createdAt))}</span>
            </div>
          </div>
        </div>
        <div class='td-snap-actions'>
          <button class='td-btn sm primary' data-action='apply-snapshot' data-snap-id='${escapeHtml(s.id)}'>${ICONS.check} 恢复</button>
          <button class='td-btn sm' data-action='view-snapshot' data-snap-id='${escapeHtml(s.id)}'>${ICONS.eye} 差异/局部</button>
          ${canCompare
            ? `<button class='td-btn sm warn' data-action='compare-snapshot-with' data-snap-id='${escapeHtml(s.id)}'>与它对比</button>`
            : `<button class='td-btn sm ${isCompareBase ? 'warn' : ''}' data-action='compare-snapshot-pick' data-snap-id='${escapeHtml(s.id)}'>${isCompareBase ? '待选对比...' : '对比'}</button>`}
          <button class='td-icon-btn ${isExpanded ? 'is-active' : ''}' data-action='toggle-snap-card-menu' data-snap-id='${escapeHtml(s.id)}' title='更多操作'>${ICONS.more}</button>
        </div>
        ${isExpanded ? `
          <div class='td-snap-extra-actions'>
            <button class='td-btn sm' data-action='pin-snapshot' data-snap-id='${escapeHtml(s.id)}'>${s.pinned ? '取消置顶' : '置顶'}</button>
            <button class='td-btn sm' data-action='overwrite-snapshot' data-snap-id='${escapeHtml(s.id)}'>更新覆盖</button>
            <button class='td-btn sm' data-action='rename-snapshot' data-snap-id='${escapeHtml(s.id)}'>${ICONS.edit} 名称/备注</button>
            <button class='td-btn sm' data-action='export-snapshot' data-snap-id='${escapeHtml(s.id)}'>${ICONS.download} 导出</button>
            <button class='td-btn sm danger' data-action='delete-snapshot' data-snap-id='${escapeHtml(s.id)}'>${ICONS.trash} 删除</button>
          </div>` : ''}
      </div>`;
  }).join('');
}

function promptSaveSnapshotAsNew(snap) {
  if (!snap) return;
  const isWb = snap.kind === 'worldbook';
  const defaultName = `${snap.targetName || snap.presetName || '快照'}-还原版`;
  const newName = window.prompt(`将完整快照另存为新${isWb ? '世界书' : '预设'}名称：`, defaultName);
  if (!newName || !newName.trim()) return;
  saveSnapshotAsNewTarget(snap, newName.trim())
    .then(() => {
      uiCtx.renderMain();
      if (state.modal?.type === 'snapshots') uiCtx.renderModal();
    })
    .catch((err) => {
      logError('快照另存为失败', err);
      notify('error', err.message || String(err));
    });
}

function promptApplySnapshot(snapId) {
  const snap = (state.store.snapshots || []).find((s) => s.id === snapId);
  if (!snap) return;
  const hasFull = snap.mode === 'full' && hasSnapshotPayload(snap);
  const finishApply = (full) => {
    state.snapshotDetailId = null;
    state.snapshotDetailCtx = null;
    uiCtx.renderPreviewModal();
    applySnapshot(snap, full).then((ok) => {
      if (ok) {
        uiCtx.renderMain();
        if (state.modal?.type === 'snapshots') uiCtx.renderModal();
      }
    });
  };

  if (snap.kind === 'worldbook') {
    const bookName = snap.targetName;
    const allBooks = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
    const exists = allBooks.includes(bookName);
    if (!exists) {
      if (hasFull) {
        openConfirm({
          title: `原世界书已不存在 · ${bookName}`,
          message: `世界书「${bookName}」当前未找到。你可以直接重建该世界书，或另存为新名称：`,
          confirmText: `重建「${bookName}」`,
          confirmClass: 'primary',
          extraButton: { text: '另存为新世界书', className: 'warn', onClick: () => promptSaveSnapshotAsNew(snap) },
          onConfirm: () => finishApply(true),
        });
      } else {
        notify('warning', `世界书「${bookName}」已不存在，且该快照仅含开关状态，无法重建`);
      }
      return;
    }

    const diffs = computeSnapshotDiff(snap);
    const diffTip = `与当前「${bookName}」共有 ${diffs.length} 项开关差异。（恢复前会自动备份当前状态）`;
    if (hasFull) {
      openConfirm({
        title: `恢复完整世界书快照 · ${snap.name}`,
        message: `${diffTip}\n请选择恢复方式：`,
        confirmText: '完整覆盖世界书',
        confirmClass: 'danger',
        extraButtons: [
          { text: '仅恢复开关状态', className: 'primary', onClick: () => finishApply(false) },
          { text: '另存为新世界书', className: 'warn', onClick: () => promptSaveSnapshotAsNew(snap) },
        ],
        onConfirm: () => finishApply(true),
      });
    } else {
      openConfirm({
        title: `恢复世界书开关快照 · ${snap.name}`,
        message: `确定要将快照开关状态恢复到世界书「${bookName}」吗？\n${diffTip}`,
        confirmText: '确认恢复',
        confirmClass: 'primary',
        onConfirm: () => finishApply(false),
      });
    }
    return;
  }

  const diffs = computeSnapshotDiff(snap);
  const srcName = snap.targetName || snap.presetName || '未知';
  const isCross = srcName && state.presetName && srcName !== state.presetName;
  const crossWarn = isCross
    ? `\n⚠️ 跨预设提示：此快照来自「${srcName}」，当前正在使用的是「${state.presetName}」。`
    : '';
  const diffTip = `与当前状态共有 ${diffs.length} 项开关差异。（恢复前会自动生成撤回备份）`;

  if (hasFull) {
    openConfirm({
      title: `恢复完整预设快照 · ${snap.name}`,
      message: `此快照为完整预设快照（来自「${srcName}」）。${diffTip}${crossWarn}\n请选择恢复方式：`,
      confirmText: isCross ? '仍还原到当前预设' : '完整还原预设',
      confirmClass: 'danger',
      extraButtons: [
        { text: '仅恢复开关状态', className: 'primary', onClick: () => finishApply(false) },
        { text: '另存为新预设', className: 'warn', onClick: () => promptSaveSnapshotAsNew(snap) },
      ],
      onConfirm: () => finishApply(true),
    });
  } else {
    openConfirm({
      title: `恢复开关快照 · ${snap.name}`,
      message: `确定要将快照「${snap.name}」的开关状态应用到当前预设「${state.presetName}」吗？\n${diffTip}${crossWarn}`,
      confirmText: '确认恢复',
      confirmClass: 'primary',
      onConfirm: () => finishApply(false),
    });
  }
}

export const snapshotsUiModule = {
  renderSelectPopup(sp, selectLayerEl) {
    if (sp.type !== 'quickSnapshot') return false;
    const m = state.modal;
    if (!m) return false;
    const isWb = sp.kind === 'worldbook';
    const targetName = sp.targetName || (isWb ? m.bookName : (m.presetName === 'in_use' ? state.presetName : m.presetName));
    const mode = sp.mode === 'full' ? 'full' : 'state';

    selectLayerEl.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${ICONS.camera} 新建${isWb ? '世界书' : '预设'}快照</div>
          <button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          <div style='font-size:12px;color:var(--td-text-muted);'>目标：<strong>${escapeHtml(targetName)}</strong>${m.dirty ? " <span class='td-mode-tag single'>含当前未保存编辑</span>" : ''}</div>
          <div class='td-field'>
            <input class='td-input' id='td-qsnap-name' type='text' placeholder='快照名称（留空自动生成）' value='${escapeHtml(sp.name || '')}' style='height:34px;font-size:13.5px;' />
            <input class='td-input' id='td-qsnap-note' type='text' placeholder='备注说明（可选）' value='${escapeHtml(sp.note || '')}' style='height:34px;font-size:13.5px;' />
          </div>
          <div class='td-seg-grid'>
            <button type='button' class='td-seg-card ${mode === 'state' ? 'active' : ''}' data-action='qsnap-set-mode' data-mode='state' style='padding:8px 10px;'>
              <div class='td-seg-title' style='font-size:12.5px;'>开关状态快照</div>
              <div class='td-seg-desc'>极轻量，记录条目启用状态</div>
            </button>
            <button type='button' class='td-seg-card single-card ${mode === 'full' ? 'active' : ''}' data-action='qsnap-set-mode' data-mode='full' style='padding:8px 10px;'>
              <div class='td-seg-title' style='font-size:12.5px;'>${isWb ? '完整世界书快照' : '完整预设快照'}</div>
              <div class='td-seg-desc'>${isWb ? '含全部条目正文与策略' : '含全部正文与生成参数'}</div>
            </button>
          </div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='close-select-popup'>取消</button>
          <button class='td-btn primary' data-action='qsnap-confirm'>${ICONS.camera} 保存快照</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return true;
  },

  renderModal(m, modalLayerEl) {
    if (m.type === 'snapshots') {
      const kind = m.kind === 'worldbook' ? 'worldbook' : 'preset';
      const mode = m.createMode || 'state';
      const allSnaps = state.store.snapshots || [];
      const presetSnaps = allSnaps.filter((s) => (s.kind || 'preset') === 'preset');
      const wbSnaps = allSnaps.filter((s) => s.kind === 'worldbook');

      const allBooks = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
      if (kind === 'worldbook' && (!m.targetBook || !allBooks.includes(m.targetBook))) {
        m.targetBook = (state.catalog.worldbook?.groups?.[0]?.bookName) || allBooks[0] || '';
      }
      const targetName = kind === 'worldbook' ? (m.targetBook || '') : (state.presetName || '');
      const curKindSnaps = kind === 'worldbook' ? wbSnaps : presetSnaps;
      const latestForTarget = curKindSnaps
        .filter((s) => (s.targetName || s.presetName) === targetName)
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
      const latestDiffs = latestForTarget ? computeSnapshotDiff(latestForTarget) : null;

      const undoSnap = state.lastUndoSnapshotId ? allSnaps.find((s) => s.id === state.lastUndoSnapshotId) : null;
      const undoBannerHtml = undoSnap ? `
        <div class='td-undo-banner'>
          <span style='flex:1;min-width:150px;'>已留存恢复前备份：${escapeHtml(undoSnap.name)}</span>
          <button type='button' class='td-btn sm warn' data-action='undo-last-restore'>${ICONS.undo} 一键撤回上次恢复</button>
        </div>` : '';

      const compareBase = m.compareBaseId ? allSnaps.find((s) => s.id === m.compareBaseId) : null;
      const compareBannerHtml = compareBase ? `
        <div class='td-compare-banner'>
          <span style='flex:1;min-width:150px;'>已选对比基准「${escapeHtml(compareBase.name)}」，请点击另一条快照上的「与它对比」</span>
          <button type='button' class='td-btn sm' data-action='cancel-snap-compare'>取消对比</button>
        </div>` : '';

      const statusHint = latestForTarget
        ? (latestDiffs.length === 0
          ? `当前「${targetName}」与最近快照「${latestForTarget.name}」开关一致`
          : `当前「${targetName}」与最近快照相比有 ${latestDiffs.length} 项开关变动`)
        : '';

      const wbOptsHtml = allBooks.length > 0
        ? allBooks.map((b) => `<option value='${escapeHtml(b)}' ${b === m.targetBook ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('')
        : `<option value=''>（暂无世界书）</option>`;

      const createOpen = !!m.createOpen;

      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>${ICONS.camera} 快照中心</div>
            <div class='td-modal-head-actions'>
              <button type='button' class='td-btn sm ${createOpen ? 'primary' : ''}' data-action='toggle-snap-create-box'>${createOpen ? '收起新建' : `${ICONS.plus} 新建快照`}</button>
              <button class='td-icon-btn' data-action='open-help' data-help-key='snapshots' title='功能说明'>${ICONS.help}</button>
              <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
            </div>
          </div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-source-tabs' style='grid-template-columns:1fr 1fr;'>
              <button type='button' class='td-source-tab ${kind === 'preset' ? 'active' : ''}' data-action='set-snap-kind' data-kind='preset'>预设快照 (${presetSnaps.length})</button>
              <button type='button' class='td-source-tab ${kind === 'worldbook' ? 'active' : ''}' data-action='set-snap-kind' data-kind='worldbook'>世界书快照 (${wbSnaps.length})</button>
            </div>
            ${undoBannerHtml}
            ${compareBannerHtml}
            ${createOpen ? `
              <div class='td-field' style='padding:10px;border-radius:13px;background:var(--td-surface);border:1px solid var(--td-border-strong);flex-shrink:0;'>
                ${kind === 'worldbook'
                  ? `<div style='display:flex;align-items:center;gap:6px;'><span class='td-bar-label' style='width:auto;'>目标世界书</span><select class='td-select' id='td-snap-wb-select'>${wbOptsHtml}</select></div>`
                  : `<label class='td-label'>当前预设：${escapeHtml(state.presetName || '未知')}</label>`}
                <div style='display:grid;grid-template-columns:1.1fr 1fr;gap:6px;'>
                  <input class='td-input' id='td-snap-name-input' type='text' placeholder='快照名称（留空自动生成）' value='${escapeHtml(m.draftName || '')}' style='height:34px;font-size:13.5px;' />
                  <input class='td-input' id='td-snap-note-input' type='text' placeholder='备注说明（可选）' value='${escapeHtml(m.draftNote || '')}' style='height:34px;font-size:13.5px;' />
                </div>
                <div class='td-seg-grid'>
                  <button type='button' class='td-seg-card ${mode === 'state' ? 'active' : ''}' data-action='set-snap-mode' data-mode='state' style='padding:7px 10px;'>
                    <div class='td-seg-title' style='font-size:12.5px;'>开关状态快照</div>
                    <div class='td-seg-desc'>极轻量，记录条目启用状态</div>
                  </button>
                  <button type='button' class='td-seg-card single-card ${mode === 'full' ? 'active' : ''}' data-action='set-snap-mode' data-mode='full' style='padding:7px 10px;'>
                    <div class='td-seg-title' style='font-size:12.5px;'>${kind === 'worldbook' ? '完整世界书快照' : '完整预设快照'}</div>
                    <div class='td-seg-desc'>${kind === 'worldbook' ? '含全部条目正文、关键词与策略' : '含全部提示词正文与生成参数'}</div>
                  </button>
                </div>
                <button class='td-btn primary' data-action='create-snapshot' style='width:100%;'>${ICONS.camera} 保存为新${kind === 'worldbook' ? '世界书' : '预设'}快照</button>
              </div>` : ''}
            ${statusHint ? `<div style='font-size:11.5px;color:var(--td-text-muted);padding:0 2px;flex-shrink:0;'>${escapeHtml(statusHint)}</div>` : ''}
            <div class='td-mgr-topbar'>
              <input class='td-input' id='td-snap-search-input' type='text' placeholder='搜索快照名称、备注或来源...' value='${escapeHtml(m.search || '')}' />
            </div>
            <div class='td-filter-bar td-snap-filter-bar'>
              <button class='td-chip' data-action='set-snapshot-filter' data-filter='current'>${kind === 'worldbook' ? '所选世界书' : '当前预设'}</button>
              <button class='td-chip' data-action='set-snapshot-filter' data-filter='all'>全部 (${curKindSnaps.length})</button>
              <button class='td-chip' data-action='set-snapshot-filter' data-filter='manual'>仅手动 (${curKindSnaps.filter((s) => !s.auto).length})</button>
              <button class='td-chip' data-action='set-snapshot-filter' data-filter='auto'>自动备份 (${curKindSnaps.filter((s) => s.auto).length})</button>
            </div>
            <div data-role='snapshot-list' class='td-picker-list td-scroll'></div>
          </div>
          <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>完成</button></div>
        </div>`;
      updateSnapshotList();
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'snapshotRename') {
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-sm'>
          <div class='td-modal-head'><div class='td-modal-title'>编辑快照信息</div><button class='td-icon-btn' data-action='back-to-snapshots'>${ICONS.close}</button></div>
          <div class='td-modal-body'>
            <div class='td-field'><label class='td-label'>快照名称</label><input class='td-input' id='td-snap-rename-input' type='text' value='${escapeHtml(m.name || '')}' /></div>
            <div class='td-field'><label class='td-label'>备注说明</label><input class='td-input' id='td-snap-rename-note-input' type='text' placeholder='输入版本特点或修改摘要（可选）' value='${escapeHtml(m.note || '')}' /></div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='back-to-snapshots'>取消</button><button class='td-btn primary' data-action='submit-snap-rename'>保存</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  renderPreview(previewLayerEl) {
    if (!state.snapshotDetailId || !state.snapshotDetailCtx) return false;
    const dctx = state.snapshotDetailCtx;
    const snap = (state.store.snapshots || []).find((s) => s.id === state.snapshotDetailId);
    const diff = dctx.diff;
    if (!snap || !diff) {
      state.snapshotDetailId = null;
      state.snapshotDetailCtx = null;
      previewLayerEl.classList.remove('is-open');
      previewLayerEl.innerHTML = '';
      return true;
    }

    const baseSnap = dctx.compareBaseId ? (state.store.snapshots || []).find((s) => s.id === dctx.compareBaseId) : null;
    const isCompare = !!baseSnap;
    const sel = dctx.selectedDiffIds instanceof Set ? dctx.selectedDiffIds : (dctx.selectedDiffIds = new Set());
    const expSet = dctx.expandedContentIds instanceof Set ? dctx.expandedContentIds : (dctx.expandedContentIds = new Set());
    const tName = snap.targetName || snap.presetName || '未知';
    const isFull = snap.mode === 'full' && diff.hasFullPayload;

    const renderSection = (title, itemsHtml, count) => count > 0
      ? `<div class='td-diff-sec'><div class='td-diff-sec-head'>${escapeHtml(title)} (${count})</div>${itemsHtml}</div>`
      : '';

    const switchRowsHtml = diff.switchDiffs.map((d) => {
      const checked = sel.has(d.diffId);
      return `
        <div class='td-diff-check-row'>
          ${!isCompare && d.restorable ? `<input type='checkbox' class='td-checkbox' data-action='toggle-snap-diff-check' data-diff-id='${escapeHtml(d.diffId)}' ${checked ? 'checked' : ''} />` : ''}
          <span style='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>${escapeHtml(d.name)}</span>
          <span class='td-mode-tag ${d.to ? 'ok' : 'single'}'>${d.from ? '开' : '关'} → ${d.to ? '开' : '关'}</span>
        </div>`;
    }).join('');

    const contentRowsHtml = diff.contentDiffs.map((d) => {
      const checked = sel.has(d.diffId);
      const isExp = expSet.has(d.diffId);
      const linesHtml = isExp && d.lineDiffs.length > 0
        ? `<div class='td-diff-box td-scroll' style='margin-top:6px;'>${d.lineDiffs.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`
        : '';
      return `
        <div class='td-diff-check-card'>
          <div class='td-diff-check-row' style='border:none;padding:0;background:transparent;'>
            ${!isCompare && d.restorable ? `<input type='checkbox' class='td-checkbox' data-action='toggle-snap-diff-check' data-diff-id='${escapeHtml(d.diffId)}' ${checked ? 'checked' : ''} />` : ''}
            <span style='flex:1;min-width:0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>${escapeHtml(d.name)}</span>
            ${d.contentChanged ? `<button type='button' class='td-chip' data-action='toggle-snap-diff-expand' data-diff-id='${escapeHtml(d.diffId)}'>${isExp ? '收起文本对比' : '查看文本对比'}</button>` : ''}
          </div>
          ${d.metaChanges.length > 0 ? `<div style='font-size:11.5px;color:var(--td-single);margin-top:4px;'>${escapeHtml(d.metaChanges.join(' · '))}</div>` : ''}
          ${linesHtml}
        </div>`;
    }).join('');

    const settingRowsHtml = diff.settingDiffs.map((d) => {
      const checked = sel.has(d.diffId);
      return `
        <div class='td-diff-check-row'>
          ${!isCompare && d.restorable ? `<input type='checkbox' class='td-checkbox' data-action='toggle-snap-diff-check' data-diff-id='${escapeHtml(d.diffId)}' ${checked ? 'checked' : ''} />` : ''}
          <span style='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>${escapeHtml(d.label)}</span>
          <span class='td-mode-tag multi' style='max-width:52%;overflow:hidden;text-overflow:ellipsis;'>${escapeHtml(String(d.from))} → ${escapeHtml(String(d.to))}</span>
        </div>`;
    }).join('');

    const structRowsHtml = diff.structDiffs.map((d) => {
      const checked = sel.has(d.diffId);
      const isSnapOnly = d.change === 'in_snap_only';
      const label = isSnapOnly
        ? (isCompare ? '仅目标快照有' : '快照独有(可补回)')
        : (isCompare ? '仅基准快照有' : '当前新增(快照无)');
      return `
        <div class='td-diff-check-row'>
          ${!isCompare && d.restorable ? `<input type='checkbox' class='td-checkbox' data-action='toggle-snap-diff-check' data-diff-id='${escapeHtml(d.diffId)}' ${checked ? 'checked' : ''} />` : ''}
          <span style='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>${escapeHtml(d.name)}</span>
          <span class='td-mode-tag ${isSnapOnly ? 'ok' : 'del'}'>${label}</span>
        </div>`;
    }).join('');

    const bodyDiffsHtml = diff.missingBook
      ? `<div class='td-attr-warn-banner'>目标世界书「${escapeHtml(tName)}」当前已不存在，无法对比差异。${isFull ? '你可以直接点击底部按钮「重建/另存为新世界书」。' : ''}</div>`
      : (diff.totalCount === 0
        ? `<div class='td-group-empty'>${isCompare ? '两份快照内容完全一致' : '该快照与当前状态完全一致'}</div>`
        : [
            renderSection('条目开关差异', switchRowsHtml, diff.switchDiffs.length),
            renderSection('生成参数差异', settingRowsHtml, diff.settingDiffs.length),
            renderSection('正文与属性差异', contentRowsHtml, diff.contentDiffs.length),
            renderSection('条目结构增删', structRowsHtml, diff.structDiffs.length),
          ].join(''));

    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${isCompare ? `快照对比 · ${escapeHtml(baseSnap.name)} ⇄ ${escapeHtml(snap.name)}` : `快照差异与局部恢复 · ${escapeHtml(snap.name)}`}</div>
          <div class='td-modal-head-actions'>
            <button class='td-icon-btn' data-action='open-help' data-help-key='snapshotDetail' title='功能说明'>${ICONS.help}</button>
            <button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button>
          </div>
        </div>
        <div class='td-modal-body'>
          <div class='td-preview-meta'>
            <span class='td-meta-tag'>类型: ${snap.kind === 'worldbook' ? '世界书' : '预设'}</span>
            <span class='td-meta-tag'>模式: ${snap.mode === 'full' ? (diff.hasFullPayload ? '完整快照' : '完整(载荷缺失)') : '开关状态快照'}</span>
            <span class='td-meta-tag'>来源: ${escapeHtml(tName)}</span>
            <span class='td-meta-tag'>差异: ${diff.totalCount} 项</span>
          </div>
          ${!isCompare && diff.totalCount > 0 && !diff.missingBook ? `
            <div class='td-filter-bar'>
              <button type='button' class='td-chip' data-action='snap-diff-select' data-mode='all'>全选可恢复</button>
              <button type='button' class='td-chip' data-action='snap-diff-select' data-mode='switch'>仅选开关</button>
              ${diff.settingDiffs.length > 0 ? `<button type='button' class='td-chip' data-action='snap-diff-select' data-mode='setting'>仅选参数</button>` : ''}
              ${diff.contentDiffs.length > 0 ? `<button type='button' class='td-chip' data-action='snap-diff-select' data-mode='content'>仅选正文</button>` : ''}
              <button type='button' class='td-chip' data-action='snap-diff-select' data-mode='none'>全不选</button>
            </div>` : ''}
          <div style='display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;'>${bodyDiffsHtml}</div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='close-preview'>关闭</button>
          ${!isCompare && isFull ? `<button class='td-btn' data-action='save-snap-as-new' data-snap-id='${escapeHtml(snap.id)}'>另存为新${snap.kind === 'worldbook' ? '世界书' : '预设'}</button>` : ''}
          ${!isCompare && diff.totalCount > 0 && !diff.missingBook ? `<button class='td-btn warn' data-action='apply-selective-snapshot' data-snap-id='${escapeHtml(snap.id)}' data-role='snap-selective-btn' ${sel.size === 0 ? 'disabled' : ''}>恢复所选差异 (${sel.size})</button>` : ''}
          ${!isCompare && !diff.missingBook ? `<button class='td-btn primary' data-action='apply-snapshot-from-detail' data-snap-id='${escapeHtml(snap.id)}'>${ICONS.check} 恢复此快照</button>` : ''}
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return true;
  },

  handleClick(e, actionEl, action) {
    const modalLayerEl = uiCtx.getModalLayer();
    if (state.selectPopup?.type === 'quickSnapshot') {
      const sp = state.selectPopup;
      const selectLayerEl = uiCtx.getSelectLayer();
      if (action === 'qsnap-set-mode') {
        sp.mode = actionEl.getAttribute('data-mode') === 'full' ? 'full' : 'state';
        selectLayerEl?.querySelectorAll("[data-action='qsnap-set-mode']").forEach((card) => {
          card.classList.toggle('active', card.getAttribute('data-mode') === sp.mode);
        });
        return true;
      }
      if (action === 'qsnap-confirm') {
        if (sp._saving) return true;
        const nameInp = selectLayerEl?.querySelector('#td-qsnap-name');
        const noteInp = selectLayerEl?.querySelector('#td-qsnap-note');
        const customName = (nameInp ? nameInp.value : sp.name || '').trim();
        const customNote = (noteInp ? noteInp.value : sp.note || '').trim();
        const mode = sp.mode === 'full' ? 'full' : 'state';
        const m = state.modal;
        const snapId = genId();
        sp._saving = true;

        (async () => {
          let snap = null;
          if (sp.kind === 'worldbook' && m?.type === 'worldbookDetail') {
            const entries = cloneWorldbookEntries(m.entries || []);
            let enabledCount = 0;
            const entryStates = entries.map((ent) => {
              const en = !!ent.enabled;
              if (en) enabledCount++;
              return { uid: Number(ent.uid), name: String(ent.name || `条目 #${ent.uid}`), enabled: en };
            });
            const saved = mode === 'full' ? await setSnapshotPayload(snapId, { fullWorldbookData: entries }) : { fileName: '', bytes: 0 };
            snap = {
              id: snapId,
              kind: 'worldbook',
              name: customName || `${m.bookName} · ${formatTime(Date.now())}`,
              note: customNote,
              pinned: false,
              auto: false,
              targetName: m.bookName,
              presetName: m.bookName,
              mode,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              payloadBytes: saved.bytes,
              ...(saved.fileName ? { payloadFile: saved.fileName } : {}),
              stats: { enabledCount, totalCount: entryStates.length },
              entryStates,
            };
          } else if (sp.kind === 'preset' && m?.type === 'presetDetail') {
            const pName = m.presetName === 'in_use' ? (state.presetName || '当前预设') : m.presetName;
            const pData = m.data || {};
            const prompts = Array.isArray(pData.prompts) ? pData.prompts : [];
            let enabledCount = 0;
            const promptStates = prompts.map((p) => {
              const en = !!p.enabled;
              if (en) enabledCount++;
              return { id: String(p.id), name: String(p.name || p.id), enabled: en };
            });
            const saved = mode === 'full'
              ? await setSnapshotPayload(snapId, {
                  fullPresetData: {
                    settings: JSON.parse(JSON.stringify(pData.settings || {})),
                    prompts: JSON.parse(JSON.stringify(prompts)),
                    prompts_unused: JSON.parse(JSON.stringify(pData.prompts_unused || [])),
                  },
                })
              : { fileName: '', bytes: 0 };
            snap = {
              id: snapId,
              kind: 'preset',
              name: customName || `${pName} · ${formatTime(Date.now())}`,
              note: customNote,
              pinned: false,
              auto: false,
              targetName: pName,
              presetName: pName,
              mode,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              payloadBytes: saved.bytes,
              ...(saved.fileName ? { payloadFile: saved.fileName } : {}),
              stats: {
                enabledCount,
                totalCount: promptStates.length,
                unusedCount: Array.isArray(pData.prompts_unused) ? pData.prompts_unused.length : 0,
              },
              promptStates,
            };
          }

          if (snap) {
            state.store.snapshots = state.store.snapshots || [];
            state.store.snapshots.unshift(snap);
            saveStore(state.store);
            state.selectPopup = null;
            uiCtx.renderSelectPopup();
            uiCtx.renderMain();
            notify('success', `已保存${sp.kind === 'worldbook' ? '世界书' : '预设'}快照「${snap.name}」`);
          }
        })().catch((err) => {
          sp._saving = false;
          logError('新建快照失败', err);
          notify('error', err.message || String(err));
        });
        return true;
      }
    }

    if (action === 'open-snapshots') {
      state.modal = {
        type: 'snapshots',
        kind: 'preset',
        targetBook: '',
        createMode: 'state',
        filter: 'current',
        search: '',
        draftName: '',
        draftNote: '',
        createOpen: false,
        expandedCardId: null,
        compareBaseId: null,
      };
      uiCtx.renderModal();
      return true;
    }
    if (action === 'toggle-snap-create-box' && state.modal?.type === 'snapshots') {
      state.modal.createOpen = state.modal.createOpen === false;
      uiCtx.renderModal();
      return true;
    }
    if (action === 'set-snap-kind' && state.modal?.type === 'snapshots') {
      const nextKind = actionEl.getAttribute('data-kind') === 'worldbook' ? 'worldbook' : 'preset';
      state.modal.kind = nextKind;
      state.modal.compareBaseId = null;
      state.modal.expandedCardId = null;
      uiCtx.renderModal();
      return true;
    }
    if (action === 'set-snap-mode' && state.modal?.type === 'snapshots') {
      const nextMode = actionEl.getAttribute('data-mode') === 'full' ? 'full' : 'state';
      state.modal.createMode = nextMode;
      modalLayerEl?.querySelectorAll("[data-action='set-snap-mode']").forEach((card) => card.classList.toggle('active', card.getAttribute('data-mode') === nextMode));
      return true;
    }
    if (action === 'set-snapshot-filter' && state.modal?.type === 'snapshots') {
      const f = actionEl.getAttribute('data-filter') || 'current';
      state.modal.filter = ['current', 'all', 'manual', 'auto'].includes(f) ? f : 'current';
      updateSnapshotList();
      return true;
    }
    if (action === 'create-snapshot' && state.modal?.type === 'snapshots') {
      const nameInp = modalLayerEl?.querySelector('#td-snap-name-input');
      const noteInp = modalLayerEl?.querySelector('#td-snap-note-input');
      const customName = (nameInp ? nameInp.value : state.modal.draftName || '').trim();
      const customNote = (noteInp ? noteInp.value : state.modal.draftNote || '').trim();

      if (state.modal.kind === 'worldbook') {
        const bookName = modalLayerEl?.querySelector('#td-snap-wb-select')?.value || state.modal.targetBook;
        if (!bookName) { notify('warning', '请先选择目标世界书'); return true; }
        captureWorldbookSnapshotData(bookName, customName, state.modal.createMode, { note: customNote })
          .then((snap) => {
            state.store.snapshots = state.store.snapshots || [];
            state.store.snapshots.unshift(snap);
            saveStore(state.store);
            state.modal.draftName = '';
            state.modal.draftNote = '';
            uiCtx.renderModal();
            uiCtx.renderMain();
            notify('success', `已保存世界书快照「${snap.name}」`);
          })
          .catch((err) => { logError('创建世界书快照失败', err); notify('error', err.message || String(err)); });
        return true;
      }

      captureCurrentSnapshotData(customName, state.modal.createMode, { note: customNote })
        .then((snap) => {
          state.store.snapshots = state.store.snapshots || [];
          state.store.snapshots.unshift(snap);
          saveStore(state.store);
          state.modal.draftName = '';
          state.modal.draftNote = '';
          uiCtx.renderModal();
          uiCtx.renderMain();
          notify('success', `已保存快照「${snap.name}」`);
        })
        .catch((err) => { logError('创建预设快照失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'undo-last-restore') {
      const snap = (state.store.snapshots || []).find((s) => s.id === state.lastUndoSnapshotId);
      if (!snap) { notify('warning', '未找到可撤回的备份快照'); return true; }
      openConfirm({
        title: '撤回上次恢复确认',
        message: `确定要用备份「${snap.name}」还原回恢复前的状态吗？`,
        confirmText: '确认撤回',
        confirmClass: 'warn',
        onConfirm: () => {
          applySnapshot(snap, snap.mode === 'full', { skipAutoBackup: true }).then((ok) => {
            if (ok) {
              state.lastUndoSnapshotId = null;
              uiCtx.renderMain();
              if (state.modal?.type === 'snapshots') uiCtx.renderModal();
            }
          });
        },
      });
      return true;
    }
    if (action === 'toggle-snap-card-menu' && state.modal?.type === 'snapshots') {
      const sid = actionEl.getAttribute('data-snap-id');
      state.modal.expandedCardId = state.modal.expandedCardId === sid ? null : sid;
      updateSnapshotList();
      return true;
    }
    if (action === 'pin-snapshot') {
      const snap = (state.store.snapshots || []).find((s) => s.id === actionEl.getAttribute('data-snap-id'));
      if (snap) {
        snap.pinned = !snap.pinned;
        saveStore(state.store);
        updateSnapshotList();
      }
      return true;
    }
    if (action === 'export-snapshot') {
      const snap = (state.store.snapshots || []).find((s) => s.id === actionEl.getAttribute('data-snap-id'));
      if (snap) {
        exportSingleSnapshotAsStandardJson(snap).catch((err) => {
          logError('导出快照失败', err);
          notify('error', err.message || String(err));
        });
      }
      return true;
    }
    if (action === 'compare-snapshot-pick' && state.modal?.type === 'snapshots') {
      const sid = actionEl.getAttribute('data-snap-id');
      state.modal.compareBaseId = state.modal.compareBaseId === sid ? null : sid;
      uiCtx.renderModal();
      return true;
    }
    if (action === 'cancel-snap-compare' && state.modal?.type === 'snapshots') {
      state.modal.compareBaseId = null;
      uiCtx.renderModal();
      return true;
    }
    if (action === 'view-snapshot' || action === 'compare-snapshot-with') {
      const snapId = actionEl.getAttribute('data-snap-id');
      const snap = (state.store.snapshots || []).find((s) => s.id === snapId);
      if (!snap) return true;
      const compareBaseId = action === 'compare-snapshot-with' ? (state.modal?.compareBaseId || null) : null;
      const baseSnap = compareBaseId ? (state.store.snapshots || []).find((s) => s.id === compareBaseId) : null;
      if (action === 'compare-snapshot-with' && state.modal?.type === 'snapshots') {
        state.modal.compareBaseId = null;
        uiCtx.renderModal();
      }
      computeDetailedSnapshotDiff(snap, baseSnap).then((diff) => {
        const selectedDiffIds = new Set();
        if (!baseSnap) {
          diff.switchDiffs.forEach((d) => { if (d.restorable) selectedDiffIds.add(d.diffId); });
          diff.contentDiffs.forEach((d) => { if (d.restorable) selectedDiffIds.add(d.diffId); });
          diff.settingDiffs.forEach((d) => { if (d.restorable) selectedDiffIds.add(d.diffId); });
          diff.structDiffs.forEach((d) => { if (d.change === 'in_snap_only' && d.restorable) selectedDiffIds.add(d.diffId); });
        }
        state.snapshotDetailId = snap.id;
        state.snapshotDetailCtx = {
          snapId: snap.id,
          compareBaseId: baseSnap ? baseSnap.id : null,
          diff,
          selectedDiffIds,
          expandedContentIds: new Set(),
        };
        state.previewKey = null;
        state.previewCtx = null;
        uiCtx.renderPreviewModal();
      }).catch((err) => {
        logError('计算快照差异失败', err);
        notify('error', err.message || String(err));
      });
      return true;
    }
    if (action === 'toggle-snap-diff-expand' && state.snapshotDetailCtx) {
      const did = actionEl.getAttribute('data-diff-id');
      const set = state.snapshotDetailCtx.expandedContentIds;
      if (set.has(did)) set.delete(did);
      else set.add(did);
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'snap-diff-select' && state.snapshotDetailCtx) {
      const mode = actionEl.getAttribute('data-mode');
      const { diff, selectedDiffIds } = state.snapshotDetailCtx;
      selectedDiffIds.clear();
      if (mode === 'all' || mode === 'switch') {
        diff.switchDiffs.forEach((d) => { if (d.restorable) selectedDiffIds.add(d.diffId); });
      }
      if (mode === 'all' || mode === 'setting') {
        diff.settingDiffs.forEach((d) => { if (d.restorable) selectedDiffIds.add(d.diffId); });
      }
      if (mode === 'all' || mode === 'content') {
        diff.contentDiffs.forEach((d) => { if (d.restorable) selectedDiffIds.add(d.diffId); });
      }
      if (mode === 'all') {
        diff.structDiffs.forEach((d) => { if (d.change === 'in_snap_only' && d.restorable) selectedDiffIds.add(d.diffId); });
      }
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'apply-selective-snapshot' && state.snapshotDetailCtx) {
      const snap = (state.store.snapshots || []).find((s) => s.id === actionEl.getAttribute('data-snap-id'));
      const { diff, selectedDiffIds } = state.snapshotDetailCtx;
      if (!snap || selectedDiffIds.size === 0) return true;
      openConfirm({
        title: '局部恢复差异确认',
        message: `确定要将选中的 ${selectedDiffIds.size} 项差异恢复到「${snap.kind === 'worldbook' ? snap.targetName : state.presetName}」吗？（恢复前会自动生成撤回备份）`,
        confirmText: '确认局部恢复',
        confirmClass: 'warn',
        onConfirm: () => {
          applySelectiveSnapshot(snap, diff, selectedDiffIds).then((ok) => {
            if (ok) {
              state.snapshotDetailId = null;
              state.snapshotDetailCtx = null;
              uiCtx.renderPreviewModal();
              uiCtx.renderMain();
              if (state.modal?.type === 'snapshots') uiCtx.renderModal();
            }
          });
        },
      });
      return true;
    }
    if (action === 'save-snap-as-new') {
      const snap = (state.store.snapshots || []).find((s) => s.id === actionEl.getAttribute('data-snap-id'));
      promptSaveSnapshotAsNew(snap);
      return true;
    }
    if (action === 'apply-snapshot' || action === 'apply-snapshot-from-detail') {
      promptApplySnapshot(actionEl.getAttribute('data-snap-id'));
      return true;
    }
    if (action === 'overwrite-snapshot') {
      const snapId = actionEl.getAttribute('data-snap-id'), snap = (state.store.snapshots || []).find((s) => s.id === snapId);
      if (!snap) return true;
      const isWb = snap.kind === 'worldbook';
      const curTarget = isWb ? snap.targetName : state.presetName;
      const crossTip = !isWb && snap.targetName && snap.targetName !== state.presetName
        ? `\n⚠️ 注意：该快照原属于「${snap.targetName}」，覆盖后来源将更新为当前预设「${state.presetName}」。`
        : '';
      openConfirm({
        title: '覆盖快照确认',
        message: `确定要用当前${isWb ? `世界书「${curTarget}」` : `预设「${curTarget}」`}的状态覆盖更新快照「${snap.name}」吗？${crossTip}`,
        confirmText: '确认覆盖',
        confirmClass: 'warn',
        onConfirm: () => {
          const applyFresh = (fresh) => {
            fresh.note = snap.note || '';
            fresh.pinned = !!snap.pinned;
            fresh.auto = false;
            const idx = state.store.snapshots.findIndex((s) => s.id === snapId);
            if (idx >= 0) state.store.snapshots[idx] = fresh;
            saveStore(state.store);
            updateSnapshotList();
            notify('success', `快照「${snap.name}」已更新`);
          };
          if (isWb) {
            captureWorldbookSnapshotData(snap.targetName, snap.name, snap.mode, { id: snap.id, createdAt: snap.createdAt, prevFileName: snap.payloadFile })
              .then(applyFresh)
              .catch((err) => { logError('覆盖世界书快照失败', err); notify('error', err.message || String(err)); });
          } else {
            captureCurrentSnapshotData(snap.name, snap.mode, { id: snap.id, createdAt: snap.createdAt, prevFileName: snap.payloadFile })
              .then(applyFresh)
              .catch((err) => { logError('覆盖预设快照失败', err); notify('error', err.message || String(err)); });
          }
        },
      });
      return true;
    }
    if (action === 'rename-snapshot') {
      const snap = (state.store.snapshots || []).find((s) => s.id === actionEl.getAttribute('data-snap-id'));
      if (snap) {
        state.modal = { type: 'snapshotRename', snapId: snap.id, name: snap.name, note: snap.note || '', prevModal: state.modal };
        uiCtx.renderModal();
      }
      return true;
    }
    if (action === 'back-to-snapshots' && state.modal?.type === 'snapshotRename') {
      state.modal = state.modal.prevModal || { type: 'snapshots', kind: 'preset', createMode: 'state', filter: 'current', draftName: '', draftNote: '' };
      uiCtx.renderModal();
      return true;
    }
    if (action === 'submit-snap-rename' && state.modal?.type === 'snapshotRename') {
      const inp = modalLayerEl?.querySelector('#td-snap-rename-input');
      const noteInp = modalLayerEl?.querySelector('#td-snap-rename-note-input');
      const name = (inp ? inp.value : state.modal.name || '').trim();
      const note = (noteInp ? noteInp.value : state.modal.note || '').trim();
      if (!name) { notify('warning', '请输入快照名称'); return true; }
      const snap = (state.store.snapshots || []).find((s) => s.id === state.modal.snapId);
      if (snap) { snap.name = name; snap.note = note; snap.updatedAt = Date.now(); saveStore(state.store); }
      state.modal = state.modal.prevModal || { type: 'snapshots', kind: 'preset', createMode: 'state', filter: 'current', draftName: '', draftNote: '' };
      uiCtx.renderModal();
      notify('success', '快照信息已更新');
      return true;
    }
    if (action === 'delete-snapshot') {
      const snapId = actionEl.getAttribute('data-snap-id'), snap = (state.store.snapshots || []).find((s) => s.id === snapId);
      if (!snap) return true;
      openConfirm({
        title: '删除快照确认', message: `确定要永久删除快照「${snap.name}」吗？`, confirmText: '确认删除',
        onConfirm: () => {
          deleteSnapshotPayload(snap, { strict: true }).then(() => {
            state.store.snapshots = (state.store.snapshots || []).filter((s) => s.id !== snapId);
            if (state.lastUndoSnapshotId === snapId) state.lastUndoSnapshotId = null;
            if (state.modal?.compareBaseId === snapId) state.modal.compareBaseId = null;
            saveStore(state.store);
            uiCtx.renderModal();
            uiCtx.renderMain();
            notify('info', '快照已删除');
          }).catch((err) => {
            logError('删除快照文件失败', err);
            notify('error', `删除后端文件失败: ${err.message || err}`);
          });
        },
      });
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id;
    if (id === 'td-qsnap-name' && state.selectPopup?.type === 'quickSnapshot') { state.selectPopup.name = target.value; return true; }
    if (id === 'td-qsnap-note' && state.selectPopup?.type === 'quickSnapshot') { state.selectPopup.note = target.value; return true; }
    if (id === 'td-snap-name-input' && state.modal?.type === 'snapshots') { state.modal.draftName = target.value; return true; }
    if (id === 'td-snap-note-input' && state.modal?.type === 'snapshots') { state.modal.draftNote = target.value; return true; }
    if (id === 'td-snap-search-input' && state.modal?.type === 'snapshots') { state.modal.search = target.value; updateSnapshotList(); return true; }
    if (id === 'td-snap-rename-input' && state.modal?.type === 'snapshotRename') { state.modal.name = target.value; return true; }
    if (id === 'td-snap-rename-note-input' && state.modal?.type === 'snapshotRename') { state.modal.note = target.value; return true; }
    return false;
  },

  renderQuickCreateModal(kind, targetName) {
    const isWb = kind === 'worldbook';
    const m = state.modal;
    const mode = m.quickSnapMode === 'full' ? 'full' : 'state';
    const dName = m.quickSnapName || '';
    const dNote = m.quickSnapNote || '';
    return `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${ICONS.camera} 新建${isWb ? '世界书' : '预设'}快照</div>
          <button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          <div class='td-field'>
            <label class='td-label'>目标${isWb ? '世界书' : '预设'}：${escapeHtml(targetName || '当前')}</label>
            <input class='td-input' id='td-qsnap-name' type='text' placeholder='快照名称（留空自动生成）' value='${escapeHtml(dName)}' />
            <input class='td-input' id='td-qsnap-note' type='text' placeholder='备注说明（可选）' value='${escapeHtml(dNote)}' />
          </div>
          <div class='td-seg-grid'>
            <button type='button' class='td-seg-card ${mode === 'state' ? 'active' : ''}' data-action='qsnap-set-mode' data-mode='state' style='padding:8px 10px;'>
              <div class='td-seg-title' style='font-size:12.5px;'>开关状态快照</div>
              <div class='td-seg-desc'>极轻量，记录条目启用状态</div>
            </button>
            <button type='button' class='td-seg-card single-card ${mode === 'full' ? 'active' : ''}' data-action='qsnap-set-mode' data-mode='full' style='padding:8px 10px;'>
              <div class='td-seg-title' style='font-size:12.5px;'>${isWb ? '完整世界书快照' : '完整预设快照'}</div>
              <div class='td-seg-desc'>${isWb ? '含全部条目正文、关键词与策略' : '含全部提示词正文与生成参数'}</div>
            </button>
          </div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='close-select-popup'>取消</button>
          <button class='td-btn primary' data-action='qsnap-confirm'>${ICONS.camera} 保存快照</button>
        </div>
      </div>`;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    const previewLayerEl = uiCtx.getPreviewLayer();
    if (target.id === 'td-snap-wb-select' && state.modal?.type === 'snapshots') {
      state.modal.targetBook = target.value;
      uiCtx.renderModal();
      return true;
    }
    if (target.getAttribute('data-action') === 'toggle-snap-diff-check' && state.snapshotDetailCtx) {
      const did = target.getAttribute('data-diff-id');
      const set = state.snapshotDetailCtx.selectedDiffIds;
      if (target.checked) set.add(did);
      else set.delete(did);
      const btn = previewLayerEl?.querySelector("[data-role='snap-selective-btn']");
      if (btn) {
        btn.textContent = `恢复所选差异 (${set.size})`;
        btn.disabled = set.size === 0;
      }
      return true;
    }
    return false;
  },
};
