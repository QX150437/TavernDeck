import {
  APP_NAME, APP_CN, APP_VERSION, ROOT_ID, EXT_BTN_ID, EXT_SETTINGS_ID,
  hasTH, callTH, notify, genId, escapeHtml, cssEscape, cloneItemRef, copyToClipboard,
} from './utils.js';
import {
  state, saveStore, ensureSchemesPool, getBoundSchemeIds, getVisibleSchemes,
  getActiveScheme, setActiveSchemeId, findGroupNode, createOrUpdateScheme,
  deleteActiveScheme, createOrUpdateGroup, clearGroupContents, deleteGroup,
  removeEntryFromGroup, setGroupItems, performDrop,
} from './store.js';
import {
  refreshWorldbookCatalog, refreshAllCatalogs, applyItemMutations,
  toggleEntryInGroup, toggleMultiGroupAll, saveEditedEntry,
} from './catalog.js';
import {
  captureCurrentSnapshotData, computeSnapshotDiff, applySnapshot,
} from './snapshot.js';
import {
  ICONS, editHistory, setUiContext, getOrbSize, renderGroupHtml,
  getPickerSections, updatePickerList, updateSnapshotList, renderConfirmModal,
  openConfirm, renderModal, readPreviewSnapshot, applyPreviewSnapshot,
  updatePreviewHistoryButtons, pushEditSnapshot, scheduleEditSnapshot,
  syncPreviewStatusUi, renderPreviewModal,
} from './ui-views.js';

let rootEl = null;
let orbEl = null;
let panelEl = null;
let panelMainEl = null;
let resizeHandleEl = null;
let modalLayerEl = null;
let previewLayerEl = null;
let confirmLayerEl = null;

let orbIdleTimer = null;
let suppressClickUntil = 0;

let orbDragging = false;
let orbMoved = false;
let orbDragStart = { x: 0, y: 0, orbX: 0, orbY: 0 };

let winDragging = false;
let winDragStart = { x: 0, y: 0, left: 0, top: 0 };

let winResizing = false;
let winResizeStart = { x: 0, y: 0, w: 0, h: 0, left: 0, top: 0 };

let dragOp = null;

function getViewportRect() {
  const vv = window.visualViewport;
  return {
    x: vv && typeof vv.offsetLeft === 'number' ? vv.offsetLeft : 0,
    y: vv && typeof vv.offsetTop === 'number' ? vv.offsetTop : 0,
    w: (vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 1200,
    h: (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 800,
  };
}

function isMobileViewport() {
  return (window.innerWidth || 1200) <= 640;
}

function clampOrbPosition(x, y) {
  const vp = getViewportRect();
  const sz = getOrbSize();
  return {
    x: Math.max(6, Math.min(vp.w - sz - 6, Math.round(x))),
    y: Math.max(6, Math.min(vp.h - sz - 6, Math.round(y))),
  };
}

function getOrbPosition() {
  const saved = state.store.settings.orbPosition;
  const sz = getOrbSize();
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    return clampOrbPosition(saved.x, saved.y);
  }
  const vp = getViewportRect();
  return clampOrbPosition(vp.w - sz - 14, 110);
}

function getIdleOrbCoords(pos, vp, sz) {
  const EDGE = 46;
  const hideOffset = Math.round(sz * 0.34);
  let x = pos.x;
  let y = pos.y;
  if (pos.x <= EDGE) x = -hideOffset;
  else if (pos.x >= vp.w - sz - EDGE) x = vp.w - sz + hideOffset;
  else if (pos.y <= EDGE) y = -hideOffset;
  else if (pos.y >= vp.h - sz - EDGE) y = vp.h - sz + hideOffset;
  return { x, y };
}

function clearOrbIdleTimer() {
  if (orbIdleTimer) {
    clearTimeout(orbIdleTimer);
    orbIdleTimer = null;
  }
}

function wakeOrb() {
  clearOrbIdleTimer();
  if (state.orbIdle) {
    state.orbIdle = false;
    applyOrbVisualState();
  }
}

function scheduleOrbIdle() {
  clearOrbIdleTimer();
  if (state.panelOpen || orbDragging || !state.store.settings.showOrb) return;
  orbIdleTimer = setTimeout(() => {
    if (!state.panelOpen && !orbDragging && state.store.settings.showOrb) {
      state.orbIdle = true;
      applyOrbVisualState();
    }
  }, 2800);
}

export function applyOrbVisualState() {
  if (!orbEl) return;
  const showOrb = state.store.settings.showOrb !== false;
  orbEl.classList.toggle('is-hidden', !showOrb);
  if (!showOrb) return;

  const vp = getViewportRect();
  const sz = getOrbSize();
  const basePos = getOrbPosition();
  const opacity = state.store.settings.orbOpacity ?? 0.96;

  orbEl.style.width = `${sz}px`;
  orbEl.style.height = `${sz}px`;
  const svg = orbEl.querySelector('svg');
  if (svg) {
    const iconSz = Math.round(sz * 0.44);
    svg.style.width = `${iconSz}px`;
    svg.style.height = `${iconSz}px`;
  }
  orbEl.style.opacity = String(opacity);
  orbEl.classList.toggle('is-open', state.panelOpen);
  orbEl.classList.toggle('is-idle', !!state.orbIdle && !state.panelOpen && !orbDragging);

  const drawPos = state.orbIdle && !state.panelOpen && !orbDragging
    ? getIdleOrbCoords(basePos, vp, sz)
    : basePos;
  orbEl.style.left = `${Math.round(vp.x + drawPos.x)}px`;
  orbEl.style.top = `${Math.round(vp.y + drawPos.y)}px`;
}

function getDefaultPanelSize() {
  const vp = getViewportRect();
  if (isMobileViewport()) {
    return {
      w: Math.max(290, Math.min(480, Math.round(vp.w - 16))),
      h: Math.max(360, Math.min(760, Math.round(vp.h * 0.82))),
    };
  }
  return { w: Math.min(500, vp.w - 24), h: Math.min(680, vp.h - 32) };
}

function getPanelSize() {
  const vp = getViewportRect();
  const saved = state.store.settings.panelSize;
  const def = getDefaultPanelSize();
  const rawW = saved && typeof saved.w === 'number' ? saved.w : def.w;
  const rawH = saved && typeof saved.h === 'number' ? saved.h : def.h;
  return {
    w: Math.max(280, Math.min(vp.w - 8, Math.round(rawW))),
    h: Math.max(280, Math.min(vp.h - 8, Math.round(rawH))),
  };
}

function getPanelPosition(size) {
  const vp = getViewportRect();
  const saved = state.store.settings.panelPosition;
  let x;
  let y;
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    x = saved.x;
    y = saved.y;
  } else {
    x = Math.round((vp.w - size.w) / 2);
    y = Math.round((vp.h - size.h) / 2);
  }
  return {
    x: Math.max(4, Math.min(Math.max(4, vp.w - size.w - 4), Math.round(x))),
    y: Math.max(4, Math.min(Math.max(4, vp.h - size.h - 4), Math.round(y))),
  };
}

export function syncOverlayBounds() {
  const vp = getViewportRect();
  const pad = isMobileViewport() ? 16 : 24;
  const maxModalH = Math.max(220, Math.round(vp.h - pad));
  const tallModalH = Math.min(760, maxModalH);

  [modalLayerEl, previewLayerEl, confirmLayerEl].forEach((layer) => {
    if (!layer) return;
    layer.style.left = `${Math.round(vp.x)}px`;
    layer.style.top = `${Math.round(vp.y)}px`;
    layer.style.width = `${Math.round(vp.w)}px`;
    layer.style.height = `${Math.round(vp.h)}px`;
    const modal = layer.querySelector('.td-modal');
    if (modal) {
      modal.style.maxHeight = `${maxModalH}px`;
      if (modal.classList.contains('td-modal-tall')) modal.style.height = `${tallModalH}px`;
      else modal.style.height = '';
    }
  });
}

export function repositionUI() {
  if (!rootEl || !orbEl || !panelEl) return;
  const vp = getViewportRect();
  applyOrbVisualState();
  if (state.panelOpen) {
    const isFs = !!state.store.settings.fullscreen;
    panelEl.classList.toggle('is-fullscreen', isFs);
    if (isFs) {
      panelEl.style.left = `${Math.round(vp.x)}px`;
      panelEl.style.top = `${Math.round(vp.y)}px`;
      panelEl.style.width = `${Math.round(vp.w)}px`;
      panelEl.style.height = `${Math.round(vp.h)}px`;
    } else {
      const size = getPanelSize();
      const pos = getPanelPosition(size);
      panelEl.style.width = `${size.w}px`;
      panelEl.style.height = `${size.h}px`;
      panelEl.style.left = `${Math.round(vp.x + pos.x)}px`;
      panelEl.style.top = `${Math.round(vp.y + pos.y)}px`;
    }
  }
  syncOverlayBounds();
}

export function syncExtensionButton() {
  try {
    const enabled = !!state.store.settings.enableExtButton;
    const menu = document.getElementById('extensionsMenu');
    const existing = document.getElementById(EXT_BTN_ID);
    if (!enabled) {
      if (existing) existing.remove();
      return;
    }
    if (!menu || existing) return;

    const btn = document.createElement('div');
    btn.id = EXT_BTN_ID;
    btn.className = 'list-group-item flex-container flexGap5 interactable';
    btn.setAttribute('tabindex', '0');
    btn.style.cursor = 'pointer';
    btn.innerHTML = `<span style='display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;color:#6366f1;flex-shrink:0;'>${ICONS.deck}</span><span>总控台</span>`;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      suppressClickUntil = Date.now() + 450;
      try {
        if (window.$ && window.$('#extensionsMenu').length) window.$('#extensionsMenu').hide();
        else menu.style.display = 'none';
      } catch (err) {
        menu.style.display = 'none';
      }
      setTimeout(() => setPanelOpen(!state.panelOpen), 40);
    });
    menu.appendChild(btn);
  } catch (e) {}
}

export function mountExtensionSettingsPanel() {
  try {
    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!container || document.getElementById(EXT_SETTINGS_ID)) return;
    const wrap = document.createElement('div');
    wrap.id = EXT_SETTINGS_ID;
    wrap.className = 'inline-drawer';
    wrap.innerHTML = `
      <div class='inline-drawer-toggle inline-drawer-header'>
        <b>${APP_NAME} · ${APP_CN} ${APP_VERSION}</b>
        <div class='inline-drawer-icon fa-solid fa-circle-chevron-down down'></div>
      </div>
      <div class='inline-drawer-content'>
        <div style='display:flex;gap:8px;flex-wrap:wrap;padding:6px 0;'>
          <button type='button' class='menu_button' id='td-ext-open-btn'>打开总控台</button>
          <button type='button' class='menu_button' id='td-ext-reset-btn'>重置悬浮球与窗口</button>
        </div>
        <small style='opacity:0.75;'>若悬浮球与魔法棒按钮均已关闭，可随时在此处打开总控台。</small>
      </div>`;
    container.appendChild(wrap);
    wrap.querySelector('#td-ext-open-btn')?.addEventListener('click', () => setPanelOpen(!state.panelOpen));
    wrap.querySelector('#td-ext-reset-btn')?.addEventListener('click', () => {
      state.store.settings.orbPosition = null;
      state.store.settings.panelPosition = null;
      state.store.settings.panelSize = null;
      state.store.settings.fullscreen = false;
      state.store.settings.showOrb = true;
      state.store.settings.orbSize = 50;
      saveStore(state.store);
      repositionUI();
      if (state.panelOpen) renderMain();
      notify('success', '窗口与悬浮球已重置');
    });
  } catch (e) {}
}

export function renderOrb() {
  if (!rootEl || !orbEl) return;
  const theme = state.store.settings.theme === 'light' ? 'light' : 'dark';
  rootEl.setAttribute('data-theme', theme);
  orbEl.innerHTML = ICONS.deck;
  repositionUI();
  scheduleOrbIdle();
}

export function renderMain() {
  if (!panelMainEl) return;
  if (!state.panelOpen) {
    panelMainEl.innerHTML = '';
    return;
  }
  const pool = ensureSchemesPool();
  const visInfo = getVisibleSchemes(state.presetName);
  const activeScheme = getActiveScheme();
  const enabledPresetTotal = state.catalog.preset.filter((p) => !!p.enabled).length;
  const snapCount = (state.store.snapshots || []).length;
  const isFs = !!state.store.settings.fullscreen;
  const prevBody = panelMainEl.querySelector('.td-body');
  const prevScrollTop = prevBody ? prevBody.scrollTop : 0;

  const presetList = state.presetNames.slice();
  if (state.presetName && !presetList.includes(state.presetName)) presetList.unshift(state.presetName);
  const presetOptions = presetList
    .map((pName) => `<option value='${escapeHtml(pName)}' ${pName === state.presetName ? 'selected' : ''}>${escapeHtml(pName)}</option>`)
    .join('');
  const schemeOptions = visInfo.schemes
    .map((s) => `<option value='${escapeHtml(s.id)}' ${s.id === activeScheme.id ? 'selected' : ''}>${escapeHtml(s.name)} (${(s.groups || []).length} 组)</option>`)
    .join('');

  const bodyHtml = activeScheme.groups.length === 0
    ? `
      <div class='td-empty'>
        <div class='td-empty-icon'>${ICONS.layers}</div>
        <div class='td-empty-title'>方案「${escapeHtml(activeScheme.name)}」暂无分组</div>
        <div class='td-empty-desc'>可在当前方案下新建多级分组，并自由组合预设、世界书、脚本与正则条目。</div>
        <button class='td-btn primary' data-action='new-group'>${ICONS.plus} 新建第一个分组</button>
      </div>`
    : `
      <div class='td-root-dropzone' data-root-pos='top'>拖至此处放到顶部（设为顶级分组）</div>
      ${activeScheme.groups.map((g) => renderGroupHtml(g, 0)).join('')}
      <div class='td-root-dropzone' data-root-pos='bottom'>拖至此处放到底部（设为顶级分组）</div>`;

  panelMainEl.innerHTML = `
    <div class='td-header' data-drag-handle='1'>
      <div class='td-brand'>
        <div class='td-brand-logo'>${ICONS.deck}</div>
        <div class='td-brand-title'>${APP_NAME} <span class='td-ver'>${APP_VERSION}</span></div>
      </div>
      <div class='td-header-actions'>
        <button class='td-icon-btn' data-action='toggle-fullscreen' title='${isFs ? '退出全屏' : '全屏显示'}'>${isFs ? ICONS.minimize : ICONS.maximize}</button>
        <button class='td-icon-btn' data-action='refresh' title='同步状态'>${ICONS.refresh}</button>
        <button class='td-icon-btn' data-action='open-settings' title='设置与主题'>${ICONS.settings}</button>
        <button class='td-icon-btn' data-action='close-panel' title='收起面板'>${ICONS.close}</button>
      </div>
    </div>
    <div class='td-control-bars'>
      <div class='td-bar-row'>
        <span class='td-bar-label'>预设</span>
        <select class='td-select' id='td-preset-select'>${presetOptions}</select>
        <button class='td-icon-btn ${visInfo.isBound ? 'accent' : ''}' data-action='open-bindings' title='${visInfo.isBound ? '当前预设已绑定专属方案（点击管理）' : '为当前预设绑定方案（未绑定时显示全部）'}'>${ICONS.link}</button>
      </div>
      <div class='td-bar-row'>
        <span class='td-bar-label'>方案</span>
        <select class='td-select' id='td-scheme-select'>${schemeOptions}</select>
        <button class='td-icon-btn accent' data-action='new-scheme' title='新建方案'>${ICONS.plus}</button>
        <button class='td-icon-btn' data-action='duplicate-scheme' title='复制当前方案'>${ICONS.copy}</button>
        <button class='td-icon-btn' data-action='rename-scheme' title='重命名方案'>${ICONS.edit}</button>
        ${pool.length > 1 ? `<button class='td-icon-btn danger' data-action='delete-scheme' title='删除当前方案'>${ICONS.trash}</button>` : ''}
      </div>
    </div>
    <div class='td-toolbar'>
      <div class='td-stat-pill'><span>启用 <strong>${enabledPresetTotal}</strong>/${state.catalog.preset.length}${visInfo.isBound ? ` · 绑定${visInfo.schemes.length}方案` : ''}</span></div>
      <div class='td-toolbar-btns'>
        <button class='td-btn' data-action='open-snapshots' title='管理预设快照'>${ICONS.camera} 快照${snapCount > 0 ? ` (${snapCount})` : ''}</button>
        <button class='td-btn primary' data-action='new-group'>${ICONS.plus} 新建分组</button>
      </div>
    </div>
    <div class='td-body'>${bodyHtml}</div>`;

  const nextBody = panelMainEl.querySelector('.td-body');
  if (nextBody && prevScrollTop > 0) nextBody.scrollTop = prevScrollTop;
}

export function setPanelOpen(open) {
  state.panelOpen = !!open;
  if (state.panelOpen) {
    wakeOrb();
    panelEl.classList.add('is-open');
    renderMain();
    renderModal();
    renderPreviewModal();
    renderOrb();
    refreshAllCatalogs()
      .then(() => {
        if (!state.panelOpen) return;
        renderMain();
        if (state.previewKey) syncPreviewStatusUi();
        if (state.modal && state.modal.type === 'picker') updatePickerList();
        if (state.modal && state.modal.type === 'snapshots') updateSnapshotList();
      })
      .catch((e) => console.warn(`[${APP_NAME}] 同步数据异常:`, e));
  } else {
    state.modal = null;
    state.previewKey = null;
    state.snapshotDetailId = null;
    state.confirmModal = null;
    panelEl.classList.remove('is-open');
    renderMain();
    renderModal();
    renderPreviewModal();
    renderConfirmModal();
    renderOrb();
  }
}

function promptApplySnapshot(snapId) {
  const snap = (state.store.snapshots || []).find((s) => s.id === snapId);
  if (!snap) return;
  const diffs = computeSnapshotDiff(snap);
  const diffTip = `与当前状态共有 ${diffs.length} 项开关差异。`;
  const finishApply = (full) => {
    state.snapshotDetailId = null;
    renderPreviewModal();
    applySnapshot(snap, full).then((ok) => {
      if (ok) {
        renderMain();
        if (state.modal && state.modal.type === 'snapshots') updateSnapshotList();
      }
    });
  };
  if (snap.mode === 'full' && snap.fullPresetData) {
    openConfirm({
      title: `恢复完整快照 · ${snap.name}`,
      message: `此快照为完整预设快照（来自「${snap.presetName}」）。${diffTip} 请选择恢复方式：`,
      confirmText: '完整还原预设',
      confirmClass: 'danger',
      extraButton: { text: '仅恢复开关状态', className: 'primary', onClick: () => finishApply(false) },
      onConfirm: () => finishApply(true),
    });
  } else {
    openConfirm({
      title: `恢复开关快照 · ${snap.name}`,
      message: `确定要将快照「${snap.name}」的开关状态应用到当前预设「${state.presetName}」吗？${diffTip}`,
      confirmText: '确认恢复',
      confirmClass: 'primary',
      onConfirm: () => finishApply(false),
    });
  }
}

function handleRootClickCapture(e) {
  if (Date.now() < suppressClickUntil && e.target && !e.target.closest('.td-orb')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function handleRootClick(e) {
  if (Date.now() < suppressClickUntil) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.target === confirmLayerEl) { state.confirmModal = null; renderConfirmModal(); return; }
  if (e.target === modalLayerEl) { state.modal = null; renderModal(); return; }
  if (e.target === previewLayerEl) { state.previewKey = null; state.snapshotDetailId = null; renderPreviewModal(); return; }

  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.getAttribute('data-action');
  const groupId = actionEl.getAttribute('data-group-id');
  const itemKey = actionEl.getAttribute('data-item-key');

  if (actionEl.closest('[data-stop-collapse]') && action === 'toggle-collapse') return;
  if (action === 'confirm-cancel') { state.confirmModal = null; renderConfirmModal(); return; }
  if (action === 'confirm-extra') {
    const fn = state.confirmModal?.extraButton?.onClick;
    state.confirmModal = null;
    renderConfirmModal();
    if (typeof fn === 'function') fn();
    return;
  }
  if (action === 'confirm-ok') {
    const fn = state.confirmModal?.onConfirm;
    state.confirmModal = null;
    renderConfirmModal();
    if (typeof fn === 'function') fn();
    return;
  }

  if (action === 'close-panel') { setPanelOpen(false); return; }
  if (action === 'toggle-fullscreen') {
    state.store.settings.fullscreen = !state.store.settings.fullscreen;
    saveStore(state.store);
    repositionUI();
    const fsBtn = panelMainEl.querySelector("[data-action='toggle-fullscreen']");
    if (fsBtn) {
      const isFs = !!state.store.settings.fullscreen;
      fsBtn.innerHTML = isFs ? ICONS.minimize : ICONS.maximize;
      fsBtn.title = isFs ? '退出全屏' : '全屏显示';
    }
    return;
  }
  if (action === 'refresh') {
    refreshAllCatalogs().then(() => {
      renderMain();
      renderOrb();
      if (state.modal?.type === 'picker') updatePickerList();
      if (state.modal?.type === 'snapshots') updateSnapshotList();
      if (state.previewKey) syncPreviewStatusUi();
      notify('success', '已同步全部条目状态');
    });
    return;
  }
  if (action === 'open-settings') { state.modal = { type: 'settings' }; renderModal(); return; }
  if (action === 'open-snapshots') { state.modal = { type: 'snapshots', createMode: 'state', filter: 'current', draftName: '' }; renderModal(); return; }
  if (action === 'set-snap-mode' && state.modal?.type === 'snapshots') {
    const nextMode = actionEl.getAttribute('data-mode') === 'full' ? 'full' : 'state';
    state.modal.createMode = nextMode;
    modalLayerEl.querySelectorAll("[data-action='set-snap-mode']").forEach((card) => {
      card.classList.toggle('active', card.getAttribute('data-mode') === nextMode);
    });
    return;
  }
  if (action === 'set-snapshot-filter' && state.modal?.ty
