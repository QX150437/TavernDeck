import {
  APP_NAME, APP_SHORT, APP_CN, APP_VERSION, ROOT_ID, EXT_BTN_ID, EXT_SETTINGS_ID,
  hasTH, callTH, notify, genId, escapeHtml, cssEscape, makeItemKey,
  cloneItemRef, copyToClipboard, downloadJsonFile, logWarn, logError,
} from './utils.js';
import {
  state, saveStore, ensureSchemesPool, getBoundSchemeIds, getVisibleSchemes,
  getActiveScheme, setActiveSchemeId, findGroupNode, createOrUpdateScheme,
  deleteActiveScheme, createOrUpdateGroup, clearGroupContents, deleteGroup,
  removeEntryFromGroup, setGroupItems, performDrop,
  exportStoreData, importStoreData,
} from './store.js';
import {
  refreshWorldbookCatalog, refreshAllCatalogs, applyItemMutations,
  toggleEntryInGroup, toggleMultiGroupAll, saveEditedEntry,
} from './catalog.js';
import {
  captureCurrentSnapshotData, computeSnapshotDiff, applySnapshot,
} from './snapshot.js';
import {
  hasUnsavedPresetChanges, saveInUseToPreset, buildPresetDiffSession,
  executePresetStitch, findBestMatchingOldPreset,
} from './preset-merge.js';
import { syncNativePresetCollapse, syncTopBarButton } from './native-ui.js';
import {
  ICONS, editHistory, setUiContext, getOrbSize, renderGroupHtml, renderGroupItemsListHtml,
  getPickerSections, updatePickerList, updateSnapshotList, updatePresetMergeBody, renderConfirmModal,
  openConfirm, renderModal, readPreviewSnapshot, applyPreviewSnapshot,
  updatePreviewHistoryButtons, pushEditSnapshot, scheduleEditSnapshot,
  syncPreviewStatusUi, renderPreviewModal,
} from './ui-views.js';
import {
  setUiManagersContext, renderSelectPopupView, renderManagerModalView,
  renderManagerPreviewView, updateWbMergeBody,
  handleManagerClick, handleManagerInput, handleManagerChange,
} from './ui-managers.js';
import {
  initPresetMergeCustomCtx,
  handleMergeUiClick, handleMergeUiInput,
} from './merge-ui.js';

let rootEl = null;
let orbEl = null;
let panelEl = null;
let panelMainEl = null;
let resizeHandleEl = null;
let modalLayerEl = null;
let previewLayerEl = null;
let selectLayerEl = null;
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
let stickyRaf = 0;

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
  if (orbIdleTimer) { clearTimeout(orbIdleTimer); orbIdleTimer = null; }
}

function wakeOrb() {
  clearOrbIdleTimer();
  if (state.orbIdle) { state.orbIdle = false; applyOrbVisualState(); }
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
    return { w: Math.max(290, Math.min(480, Math.round(vp.w - 16))), h: Math.max(360, Math.min(760, Math.round(vp.h * 0.82))) };
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
  const x = saved && typeof saved.x === 'number' ? saved.x : Math.round((vp.w - size.w) / 2);
  const y = saved && typeof saved.y === 'number' ? saved.y : Math.round((vp.h - size.h) / 2);
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

  [modalLayerEl, previewLayerEl, selectLayerEl, confirmLayerEl].forEach((layer) => {
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

export function syncTopBarUI() {
  syncTopBarButton(ICONS.deck, () => setPanelOpen(!state.panelOpen), state.panelOpen);
}

export function syncExtensionButton() {
  try {
    const enabled = !!state.store.settings.enableExtButton;
    const menu = document.getElementById('extensionsMenu');
    const existing = document.getElementById(EXT_BTN_ID);
    if (!enabled) { if (existing) existing.remove(); return; }
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
  } catch (e) {
    logWarn('同步魔法棒扩展菜单按钮失败', e);
  }
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
        <small style='opacity:0.75;'>若悬浮球与顶部/魔法棒按钮均已关闭，可随时在此处打开总控台。</small>
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
  } catch (e) {
    logWarn('挂载扩展设置面板失败', e);
  }
}

export function applyThemeAttributes() {
  if (!rootEl) return;
  const s = state.store.settings;
  rootEl.setAttribute('data-theme', s.theme || 'dark');
  rootEl.setAttribute('data-orb-style', s.orbStyle || 'indigo');
  if (s.groupTextColor) rootEl.style.setProperty('--td-group-color', s.groupTextColor);
  else rootEl.style.removeProperty('--td-group-color');
  if (s.entryTextColor) rootEl.style.setProperty('--td-entry-color', s.entryTextColor);
  else rootEl.style.removeProperty('--td-entry-color');
}

export function renderOrb() {
  if (!rootEl || !orbEl) return;
  applyThemeAttributes();
  const orbImg = state.store.settings.orbImage;
  const orbFit = state.store.settings.orbImageFit === 'contain' ? 'contain' : 'cover';
  if (orbImg) {
    orbEl.innerHTML = `<img class='td-orb-img ${orbFit === 'contain' ? 'fit-contain' : 'fit-cover'}' src='${escapeHtml(orbImg)}' alt='orb' />`;
  } else {
    orbEl.innerHTML = ICONS.deck;
  }
  repositionUI();
  scheduleOrbIdle();
}

function updateStickyGroupHeaders() {
  if (!panelMainEl || !state.panelOpen) return;
  const bodyEl = panelMainEl.querySelector('.td-body');
  if (!bodyEl) return;
  const bodyTop = bodyEl.getBoundingClientRect().top;
  bodyEl.querySelectorAll('.td-group').forEach((grp) => {
    const stickyTop = Array.from(grp.children).find((el) => el.classList.contains('td-group-sticky-top'));
    if (!stickyTop) return;
    if (grp.classList.contains('collapsed')) {
      stickyTop.classList.remove('is-stuck');
      return;
    }
    const gRect = grp.getBoundingClientRect();
    const sRect = stickyTop.getBoundingClientRect();
    const isStuck = gRect.top < bodyTop - 1 && gRect.bottom > bodyTop + sRect.height + 6;
    stickyTop.classList.toggle('is-stuck', isStuck);
  });
}

function bindBodyStickyScroll() {
  const bodyEl = panelMainEl?.querySelector('.td-body');
  if (!bodyEl || bodyEl.dataset.tdStickyBound) return;
  bodyEl.dataset.tdStickyBound = '1';
  bodyEl.addEventListener('scroll', () => {
    if (stickyRaf) return;
    stickyRaf = requestAnimationFrame(() => {
      stickyRaf = 0;
      updateStickyGroupHeaders();
    });
  }, { passive: true });
}

export function syncEntryStatesUI() {
  if (!panelMainEl || !state.panelOpen) return;
  const activeScheme = getActiveScheme();

  panelMainEl.querySelectorAll('.td-item[data-item-key]').forEach((itemEl) => {
    const k = itemEl.getAttribute('data-item-key');
    const entry = state.catalog.byKey.get(k);
    const enabled = entry ? !!entry.enabled : false;
    const sw = itemEl.querySelector('.td-switch');
    if (sw) sw.classList.toggle('on', enabled);
    const dot = itemEl.querySelector('.td-radio-dot');
    if (dot) dot.classList.toggle('on', enabled);
  });

  panelMainEl.querySelectorAll('.td-group[data-group-id]').forEach((groupEl) => {
    const gid = groupEl.getAttribute('data-group-id');
    const found = findGroupNode(activeScheme.groups, gid);
    if (!found) return;
    const g = found.group;
    const items = g.items || [];
    let validCount = 0;
    let activeCount = 0;
    items.forEach((ref) => {
      const entry = state.catalog.byKey.get(ref.key || makeItemKey(ref));
      if (entry) { validCount++; if (entry.enabled) activeCount++; }
    });
    const stickyTop = Array.from(groupEl.children).find((el) => el.classList.contains('td-group-sticky-top'));
    const headEl = stickyTop ? Array.from(stickyTop.children).find((el) => el.classList.contains('td-group-head')) : null;
    if (headEl) {
      const countEl = headEl.querySelector('.td-count-tag');
      if (countEl) countEl.textContent = `${activeCount}/${items.length}`;
      if (g.mode === 'multi') {
        const groupSw = headEl.querySelector("[data-action='toggle-multi-group']");
        if (groupSw) groupSw.classList.toggle('on', validCount > 0 && activeCount === validCount);
      }
    }
  });

  const statStrong = panelMainEl.querySelector('.td-stat-pill strong');
  if (statStrong) {
    statStrong.textContent = String(state.catalog.preset.filter((p) => !!p.enabled).length);
  }
  if (state.previewKey) syncPreviewStatusUi();
  if (state.modal?.type === 'picker') updatePickerList();
}

function updateGroupItemsDom(groupId) {
  if (!panelMainEl || !state.panelOpen) return;
  const found = findGroupNode(getActiveScheme().groups, groupId);
  if (!found) return;
  const groupEl = panelMainEl.querySelector(`.td-group[data-group-id='${groupId}']`);
  if (!groupEl) return;
  const bodyEl = Array.from(groupEl.children).find((el) => el.classList.contains('td-group-body'));
  if (!bodyEl) return;
  let itemsBox = Array.from(bodyEl.children).find((el) => el.classList.contains('td-group-items'));
  const html = renderGroupItemsListHtml(found.group);
  if (itemsBox) {
    itemsBox.innerHTML = html;
  } else if (html) {
    itemsBox = document.createElement('div');
    itemsBox.className = 'td-group-items';
    itemsBox.setAttribute('data-group-id', groupId);
    itemsBox.innerHTML = html;
    bodyEl.insertBefore(itemsBox, bodyEl.firstChild);
  }
  const q = (state.groupSearch[groupId] || '').trim();
  if (q) groupEl.classList.remove('collapsed');
  updateStickyGroupHeaders();
}

function buildGroupListHtml() {
  const activeScheme = getActiveScheme();
  if (activeScheme.groups.length === 0) {
    return `
      <div class='td-empty'>
        <div class='td-empty-icon'>${ICONS.layers}</div>
        <div class='td-empty-title'>方案「${escapeHtml(activeScheme.name)}」暂无分组</div>
        <div class='td-empty-desc'>点击右上角管理栏或工具箱图标，即可新建分组、管理预设与世界书、对比缝合或查看快照日志。</div>
        <button class='td-btn primary' data-action='new-group'>${ICONS.plus} 新建第一个分组</button>
      </div>`;
  }
  return `
    <div class='td-root-dropzone' data-root-pos='top'>拖至此处放到顶部（设为顶级分组）</div>
    ${activeScheme.groups.map((g) => renderGroupHtml(g, 0)).join('')}
    <div class='td-root-dropzone' data-root-pos='bottom'>拖至此处放到底部（设为顶级分组）</div>`;
}

export function renderMainBodyOnly() {
  if (!panelMainEl || !state.panelOpen) return;
  const bodyEl = panelMainEl.querySelector('.td-body');
  if (!bodyEl) { renderMain(); return; }
  const prevScrollTop = bodyEl.scrollTop;
  bodyEl.innerHTML = buildGroupListHtml();
  if (prevScrollTop > 0) bodyEl.scrollTop = prevScrollTop;
  bindBodyStickyScroll();
  updateStickyGroupHeaders();
}

export function renderMain() {
  if (!panelMainEl) return;
  if (!state.panelOpen) { panelMainEl.innerHTML = ''; return; }
  const pool = ensureSchemesPool();
  const visInfo = getVisibleSchemes(state.presetName);
  const activeScheme = getActiveScheme();
  const enabledPresetTotal = state.catalog.preset.filter((p) => !!p.enabled).length;
  const snapCount = (state.store.snapshots || []).length;
  const isFs = !!state.store.settings.fullscreen;
  const showCtrl = !!state.store.settings.showControlBar;
  const showTools = !!state.store.settings.showToolsDrawer && !showCtrl;
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

  panelMainEl.innerHTML = `
    <div class='td-header' data-drag-handle='1'>
      <div class='td-brand'>
        <div class='td-brand-title'>${APP_SHORT} <span class='td-ver'>${APP_VERSION}</span></div>
      </div>
      <div class='td-header-actions'>
        <button class='td-icon-btn ${showTools ? 'is-active' : ''}' data-action='toggle-tools-drawer' title='工具箱（预设/世界书/缝合/快照/日志）'>${ICONS.toolbox}</button>
        <button class='td-icon-btn ${showCtrl ? 'is-active' : ''}' data-action='toggle-control-bar' title='方案与预设栏'>${ICONS.sliders}</button>
        <button class='td-icon-btn' data-action='toggle-fullscreen' title='${isFs ? '退出全屏' : '全屏显示'}'>${isFs ? ICONS.minimize : ICONS.maximize}</button>
        <button class='td-icon-btn' data-action='open-settings' title='设置与主题'>${ICONS.settings}</button>
        <button class='td-icon-btn' data-action='close-panel' title='收起面板'>${ICONS.close}</button>
      </div>
    </div>
    <div class='td-control-drawer ${showTools ? 'is-open' : ''}' id='td-tools-drawer'>
      <div class='td-drawer-grid'>
        <button class='td-btn' data-action='open-preset-manager'>${ICONS.layers} 预设管理</button>
        <button class='td-btn' data-action='open-worldbook-manager'>${ICONS.layers} 世界书管理</button>
        <button class='td-btn' data-action='open-preset-merge'>${ICONS.gitMerge} 预设对比缝合</button>
        <button class='td-btn' data-action='open-wb-merge'>${ICONS.gitMerge} 世界书对比缝合</button>
        <button class='td-btn' data-action='open-snapshots'>${ICONS.camera} 预设快照${snapCount > 0 ? ` (${snapCount})` : ''}</button>
        <button class='td-btn' data-action='open-logs'>${ICONS.code} 运行日志</button>
      </div>
    </div>
    <div class='td-control-drawer ${showCtrl ? 'is-open' : ''}' id='td-scheme-drawer'>
      <div class='td-bar-row'>
        <span class='td-bar-label'>预设</span>
        <select class='td-select' id='td-preset-select'>${presetOptions}</select>
        <button class='td-icon-btn ${visInfo.isBound ? 'accent' : ''}' data-action='open-bindings' title='${visInfo.isBound ? '当前预设已绑定专属方案（点击管理）' : '为当前预设绑定方案（未绑定时显示全部）'}'>${ICONS.link}</button>
        <button class='td-icon-btn' data-action='refresh' title='同步酒馆状态'>${ICONS.refresh}</button>
      </div>
      <div class='td-bar-row'>
        <span class='td-bar-label'>方案</span>
        <select class='td-select' id='td-scheme-select'>${schemeOptions}</select>
        <button class='td-icon-btn accent' data-action='new-scheme' title='新建方案'>${ICONS.plus}</button>
        <button class='td-icon-btn' data-action='duplicate-scheme' title='复制当前方案'>${ICONS.copy}</button>
        <button class='td-icon-btn' data-action='rename-scheme' title='重命名方案'>${ICONS.edit}</button>
        ${pool.length > 1 ? `<button class='td-icon-btn danger' data-action='delete-scheme' title='删除当前方案'>${ICONS.trash}</button>` : ''}
      </div>
      <div class='td-drawer-actions'>
        <div class='td-stat-pill'><span>启用 <strong>${enabledPresetTotal}</strong>/${state.catalog.preset.length}${visInfo.isBound ? ` · 绑定${visInfo.schemes.length}方案` : ''}</span></div>
        <button class='td-btn primary' data-action='new-group'>${ICONS.plus} 新建分组</button>
      </div>
    </div>
    <div class='td-body'>${buildGroupListHtml()}</div>`;

  const nextBody = panelMainEl.querySelector('.td-body');
  if (nextBody && prevScrollTop > 0) nextBody.scrollTop = prevScrollTop;
  bindBodyStickyScroll();
  updateStickyGroupHeaders();
}

function renderPreservingFocus(targetLayer, renderFn) {
  const active = document.activeElement;
  let focusId = '';
  let selStart = null;
  let selEnd = null;
  if (active && targetLayer && targetLayer.contains(active) && active.id) {
    focusId = active.id;
    try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (e) {}
  }
  const scroller = targetLayer?.querySelector('.td-picker-list, .td-modal-body');
  const prevTop = scroller ? scroller.scrollTop : 0;

  renderFn();

  if (prevTop > 0 && targetLayer) {
    const nextScroller = targetLayer.querySelector('.td-picker-list, .td-modal-body');
    if (nextScroller) {
      nextScroller.scrollTop = prevTop;
      requestAnimationFrame(() => { nextScroller.scrollTop = prevTop; });
    }
  }
  if (focusId && targetLayer) {
    const nextEl = targetLayer.querySelector(`#${cssEscape(focusId)}`);
    if (nextEl) {
      nextEl.focus();
      if (typeof selStart === 'number' && typeof nextEl.setSelectionRange === 'function') {
        try { nextEl.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    }
  }
}

export function setPanelOpen(open) {
  state.panelOpen = !!open;
  if (state.panelOpen) {
    wakeOrb();
    panelEl.classList.add('is-open');
    renderMain();
    renderModal();
    renderPreviewModal();
    renderSelectPopupView();
    renderOrb();
    syncTopBarUI();
    refreshAllCatalogs()
      .then(() => {
        if (!state.panelOpen) return;
        renderMain();
        if (state.previewKey) syncPreviewStatusUi();
        if (state.modal?.type === 'picker') updatePickerList();
        if (state.modal?.type === 'snapshots') updateSnapshotList();
      })
      .catch((e) => logWarn('同步数据异常', e));
  } else {
    state.modal = null;
    state.previewKey = null;
    state.previewCtx = null;
    state.snapshotDetailId = null;
    state.selectPopup = null;
    state.confirmModal = null;
    state.activeItemDrawerId = null;
    panelEl.classList.remove('is-open');
    renderMain();
    renderModal();
    renderPreviewModal();
    renderSelectPopupView();
    renderConfirmModal();
    renderOrb();
    syncTopBarUI();
  }
}

function loadOrbImageForCrop(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      if (file.type === 'image/gif' && file.size <= 400 * 1024) {
        resolve({ isGif: true, rawUrl });
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('解析图片失败'));
      img.onload = () => resolve({ isGif: false, img });
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  });
}

function performSwitchPreset(nextPreset) {
  try {
    if (hasTH('loadPreset')) {
      if (callTH('loadPreset', nextPreset) === false) {
        notify('error', `切换预设失败: ${nextPreset}`);
        const sel = panelMainEl?.querySelector('#td-preset-select');
        if (sel) sel.value = state.presetName;
        return;
      }
      setTimeout(() => {
        refreshAllCatalogs().then(() => {
          renderMain();
          renderOrb();
          notify('success', `已切换预设：${state.presetName}`);
        });
      }, 70);
    }
  } catch (err) {
    logError('切换预设出错', err);
    notify('error', '切换预设出错');
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
      if (ok) { renderMain(); if (state.modal?.type === 'snapshots') updateSnapshotList(); }
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
  if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
  if (e.target === confirmLayerEl) {
    const cancelFn = state.confirmModal?.onCancel;
    state.confirmModal = null;
    renderConfirmModal();
    if (typeof cancelFn === 'function') cancelFn();
    return;
  }
  if (e.target === selectLayerEl) { state.selectPopup = null; renderSelectPopupView(); return; }
  if (e.target === modalLayerEl) { state.modal = null; renderModal(); return; }
  if (e.target === previewLayerEl) { state.previewKey = null; state.previewCtx = null; state.snapshotDetailId = null; renderPreviewModal(); return; }

  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.getAttribute('data-action');
  const groupId = actionEl.getAttribute('data-group-id');
  const itemKey = actionEl.getAttribute('data-item-key');

  if (actionEl.closest('[data-stop-collapse]') && action === 'toggle-collapse') return;
  if (action === 'confirm-cancel') {
    const cancelFn = state.confirmModal?.onCancel;
    state.confirmModal = null;
    renderConfirmModal();
    if (typeof cancelFn === 'function') cancelFn();
    return;
  }
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

  if (handleMergeUiClick(e, actionEl, action, previewLayerEl, {
    renderPreviewModal,
    updatePresetMergeBody,
    updateWbMergeBody,
    pushEditSnapshot,
  })) return;

  if (handleManagerClick(e, actionEl, action)) return;

  if (action === 'close-panel') { setPanelOpen(false); return; }
  if (action === 'toggle-tools-drawer') {
    const next = !state.store.settings.showToolsDrawer;
    state.store.settings.showToolsDrawer = next;
    if (next && state.store.settings.showControlBar) {
      state.store.settings.showControlBar = false;
      panelMainEl.querySelector("[data-action='toggle-control-bar']")?.classList.remove('is-active');
      panelMainEl.querySelector('#td-scheme-drawer')?.classList.remove('is-open');
    }
    saveStore(state.store);
    actionEl.classList.toggle('is-active', next);
    panelMainEl.querySelector('#td-tools-drawer')?.classList.toggle('is-open', next);
    return;
  }
  if (action === 'toggle-control-bar') {
    const next = !state.store.settings.showControlBar;
    state.store.settings.showControlBar = next;
    if (next && state.store.settings.showToolsDrawer) {
      state.store.settings.showToolsDrawer = false;
      panelMainEl.querySelector("[data-action='toggle-tools-drawer']")?.classList.remove('is-active');
      panelMainEl.querySelector('#td-tools-drawer')?.classList.remove('is-open');
    }
    saveStore(state.store);
    actionEl.classList.toggle('is-active', next);
    panelMainEl.querySelector('#td-scheme-drawer')?.classList.toggle('is-open', next);
    return;
  }
  if (action === 'toggle-group-menu') {
    e.stopPropagation();
    state.activeGroupMenuId = state.activeGroupMenuId === groupId ? null : groupId;
    renderMainBodyOnly();
    if (state.activeGroupMenuId) {
      const inp = panelMainEl.querySelector(`input[data-role='group-search-input'][data-group-id='${state.activeGroupMenuId}']`);
      if (inp && state.groupSearch[state.activeGroupMenuId]) inp.focus();
    }
    return;
  }
  if (action === 'clear-group-search') {
    e.stopPropagation();
    delete state.groupSearch[groupId];
    const inp = panelMainEl.querySelector(`input[data-role='group-search-input'][data-group-id='${groupId}']`);
    if (inp) { inp.value = ''; inp.focus(); }
    actionEl.remove();
    updateGroupItemsDom(groupId);
    return;
  }
  if (action === 'toggle-item-drawer') {
    e.stopPropagation();
    const drawerId = `${groupId}::${itemKey}`;
    state.activeItemDrawerId = state.activeItemDrawerId === drawerId ? null : drawerId;
    updateGroupItemsDom(groupId);
    return;
  }
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
      renderMain(); renderOrb(); syncTopBarUI();
      if (state.modal?.type === 'picker') updatePickerList();
      if (state.modal?.type === 'snapshots') updateSnapshotList();
      if (state.previewKey) syncPreviewStatusUi();
      notify('success', '已同步全部条目状态');
    });
    return;
  }
  if (action === 'open-settings') { state.modal = { type: 'settings' }; renderModal(); return; }
  if (action === 'open-snapshots') { state.modal = { type: 'snapshots', createMode: 'state', filter: 'current', draftName: '' }; renderModal(); return; }

  if (action === 'open-preset-merge') { state.modal = { type: 'presetMergeSelect', oldName: '', newName: '' }; renderModal(); return; }
  if (action === 'swap-merge-presets' && state.modal?.type === 'presetMergeSelect') {
    const oldSel = modalLayerEl.querySelector('#td-merge-old-select'), newSel = modalLayerEl.querySelector('#td-merge-new-select');
    const a = oldSel ? oldSel.value : state.modal.oldName, b = newSel ? newSel.value : state.modal.newName;
    state.modal.oldName = b; state.modal.newName = a;
    if (oldSel) oldSel.value = b; if (newSel) newSel.value = a;
    return;
  }
  if (action === 'start-preset-merge' && state.modal?.type === 'presetMergeSelect') {
    const oldSel = modalLayerEl.querySelector('#td-merge-old-select'), newSel = modalLayerEl.querySelector('#td-merge-new-select');
    const oldName = oldSel ? oldSel.value : state.modal.oldName, newName = newSel ? newSel.value : state.modal.newName;
    if (!oldName || !newName) { notify('warning', '请选择要对比的两个预设'); return; }
    if (oldName === newName) { notify('warning', '请选择两个不同的预设进行对比'); return; }
    try { state.modal = { type: 'presetMerge', session: buildPresetDiffSession(oldName, newName) }; renderModal(); }
    catch (err) { notify('error', `读取预设失败: ${err.message || err}`); }
    return;
  }
  if (action === 'toggle-merge-controls' && state.modal?.type === 'presetMerge') { state.modal.session.controlsOpen = !state.modal.session.controlsOpen; updatePresetMergeBody(); return; }
  if (action === 'set-merge-filter' && state.modal?.type === 'presetMerge') { state.modal.session.filter = actionEl.getAttribute('data-filter') || 'diff'; updatePresetMergeBody(); return; }
  if (action === 'toggle-merge-expand' && state.modal?.type === 'presetMerge') {
    const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
    if (entry) { entry.expanded = !entry.expanded; updatePresetMergeBody(); }
    return;
  }
  if (action === 'set-merge-choice' && state.modal?.type === 'presetMerge') {
    e.stopPropagation();
    const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
    if (entry) { entry.choice = actionEl.getAttribute('data-choice'); updatePresetMergeBody(); }
    return;
  }
  if (action === 'merge-batch-old' && state.modal?.type === 'presetMerge') { state.modal.session.entries.forEach((it) => { if (it.oldPrompt) it.choice = 'old'; }); updatePresetMergeBody(); notify('info', '已全部选为保留旧版'); return; }
  if (action === 'merge-batch-new' && state.modal?.type === 'presetMerge') { state.modal.session.entries.forEach((it) => { it.choice = 'new'; }); updatePresetMergeBody(); notify('info', '已全部选为采用新版'); return; }
  if (action === 'merge-batch-states' && state.modal?.type === 'presetMerge') {
    let cnt = 0;
    state.modal.session.entries.forEach((it) => {
      if (it.status === 'conflict' && it.oldPrompt && it.newPrompt) {
        const merged = JSON.parse(JSON.stringify(it.newPrompt));
        merged.enabled = !!it.oldPrompt.enabled;
        it.customPrompt = merged; it.choice = 'custom'; cnt++;
      }
    });
    updatePresetMergeBody(); notify('success', `已将 ${cnt} 个冲突条目的开关状态设为旧版，正文保留新版`); return;
  }
  if ((action === 'open-merge-custom' || action === 'open-merge-custom-content-only') && state.modal?.type === 'presetMerge') {
    e.stopPropagation();
    const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
    if (!entry) return;
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = initPresetMergeCustomCtx(entry, {
      contentOnly: action === 'open-merge-custom-content-only',
    });
    renderPreviewModal(); return;
  }
  if (action === 'merge-apply-target' && state.modal?.type === 'presetMerge') {
    const session = state.modal.session;
    openConfirm({
      title: '覆盖目标预设确认', message: `确定要将缝合后的结果直接覆盖保存到预设「${session.newName}」吗？`, confirmText: '确认覆盖保存', confirmClass: 'danger',
      onConfirm: () => executePresetStitch(session, 'overwrite').then(() => { state.modal = null; renderModal(); refreshAllCatalogs().then(() => renderMain()); }).catch((err) => notify('error', err.message || String(err))),
    });
    return;
  }
  if (action === 'merge-save-as' && state.modal?.type === 'presetMerge') {
    const session = state.modal.session;
    const newName = window.prompt('请输入另存为的新预设名称：', `${session.newName}-缝合版`);
    if (!newName || !newName.trim()) return;
    executePresetStitch(session, 'new', newName.trim()).then(() => { state.modal = null; renderModal(); refreshAllCatalogs().then(() => renderMain()); }).catch((err) => notify('error', err.message || String(err)));
    return;
  }

  if (action === 'open-io-center') {
    const pool = ensureSchemesPool();
    state.modal = { type: 'ioCenter', selectedSchemeIds: new Set(pool.map((s) => s.id)), expSnapshots: true, expSettings: true, rawText: '', importPreview: null, impSchemes: true, impSnapshots: true, impSettings: true, impMode: 'merge' };
    renderModal(); return;
  }
  if (action === 'toggle-io-scheme' && state.modal?.type === 'ioCenter') {
    const sid = actionEl.getAttribute('data-scheme-id'), set = state.modal.selectedSchemeIds;
    if (set.has(sid)) set.delete(sid); else set.add(sid);
    actionEl.classList.toggle('on', set.has(sid)); return;
  }
  if (action === 'toggle-io-exp-opt' && state.modal?.type === 'ioCenter') { const k = actionEl.getAttribute('data-key'); state.modal[k] = !state.modal[k]; actionEl.classList.toggle('on', !!state.modal[k]); return; }
  if (action === 'export-all-json') { downloadJsonFile(exportStoreData({ includeAll: true }), `TavernDeck-全量备份-${new Date().toISOString().slice(0, 10)}.json`); notify('success', '已导出全量配置备份'); return; }
  if (action === 'export-partial-json' && state.modal?.type === 'ioCenter') {
    const ids = Array.from(state.modal.selectedSchemeIds);
    if (ids.length === 0 && !state.modal.expSnapshots && !state.modal.expSettings) { notify('warning', '请至少勾选一项要导出的内容'); return; }
    downloadJsonFile(exportStoreData({ schemeIds: ids, includeSnapshots: !!state.modal.expSnapshots, includeSettings: !!state.modal.expSettings }), `TavernDeck-局部备份-${new Date().toISOString().slice(0, 10)}.json`);
    notify('success', '已导出局部配置备份'); return;
  }
  if (action === 'trigger-io-file' && state.modal?.type === 'ioCenter') { modalLayerEl.querySelector('#td-io-file-input')?.click(); return; }
  if (action === 'parse-io-text' && state.modal?.type === 'ioCenter') {
    const ta = modalLayerEl.querySelector('#td-io-text-input'), txt = ta ? ta.value : state.modal.rawText;
    state.modal.rawText = txt;
    try {
      const parsed = JSON.parse(txt);
      if (!parsed || parsed.app !== APP_NAME) throw new Error('非 TavernDeck 备份格式');
      state.modal.importPreview = parsed; state.modal.impSchemes = Array.isArray(parsed.schemes);
      state.modal.impSnapshots = Array.isArray(parsed.snapshots); state.modal.impSettings = !!parsed.settings;
      renderModal();
    } catch (err) { notify('error', `JSON 解析失败: ${err.message || err}`); }
    return;
  }
  if (action === 'toggle-io-imp-opt' && state.modal?.type === 'ioCenter') { const k = actionEl.getAttribute('data-key'); state.modal[k] = !state.modal[k]; actionEl.classList.toggle('on', !!state.modal[k]); return; }
  if (action === 'set-io-imp-mode' && state.modal?.type === 'ioCenter') { state.modal.impMode = actionEl.getAttribute('data-mode') === 'overwrite' ? 'overwrite' : 'merge'; renderModal(); return; }
  if (action === 'confirm-io-import' && state.modal?.type === 'ioCenter') {
    const m = state.modal; if (!m.importPreview) return;
    openConfirm({
      title: '确认导入配置', message: `将以「${m.impMode === 'overwrite' ? '覆盖模式' : '合并模式'}」导入所选配置数据，是否继续？`,
      confirmText: '确认导入', confirmClass: m.impMode === 'overwrite' ? 'danger' : 'primary',
      onConfirm: () => {
        try {
          importStoreData(m.importPreview, { mode: m.impMode, importSchemes: !!m.impSchemes, importSnapshots: !!m.impSnapshots, importSettings: !!m.impSettings });
          state.modal = null; renderModal(); renderOrb(); syncExtensionButton(); syncTopBarUI(); syncNativePresetCollapse(); renderMain(); notify('success', '配置导入成功');
        } catch (err) { notify('error', `导入失败: ${err.message || err}`); }
      },
    });
    return;
  }

  if (action === 'set-snap-mode' && state.modal?.type === 'snapshots') {
    const nextMode = actionEl.getAttribute('data-mode') === 'full' ? 'full' : 'state';
    state.modal.createMode = nextMode;
    modalLayerEl.querySelectorAll("[data-action='set-snap-mode']").forEach((card) => card.classList.toggle('active', card.getAttribute('data-mode') === nextMode));
    return;
  }
  if (action === 'set-snapshot-filter' && state.modal?.type === 'snapshots') { state.modal.filter = actionEl.getAttribute('data-filter') === 'all' ? 'all' : 'current'; updateSnapshotList(); return; }
  if (action === 'create-snapshot' && state.modal?.type === 'snapshots') {
    const inp = modalLayerEl.querySelector('#td-snap-name-input'), customName = (inp ? inp.value : state.modal.draftName || '').trim();
    const snap = captureCurrentSnapshotData(customName, state.modal.createMode);
    state.store.snapshots = state.store.snapshots || []; state.store.snapshots.unshift(snap); saveStore(state.store);
    state.modal.draftName = ''; if (inp) inp.value = '';
    const allChip = modalLayerEl.querySelector("[data-action='set-snapshot-filter'][data-filter='all']");
    if (allChip) allChip.textContent = `全部快照 (${state.store.snapshots.length})`;
    updateSnapshotList(); renderMain(); notify('success', `已保存快照「${snap.name}」`); return;
  }
  if (action === 'apply-snapshot' || action === 'apply-snapshot-from-detail') { promptApplySnapshot(actionEl.getAttribute('data-snap-id')); return; }
  if (action === 'view-snapshot') { state.snapshotDetailId = actionEl.getAttribute('data-snap-id'); state.previewKey = null; state.previewCtx = null; renderPreviewModal(); return; }
  if (action === 'overwrite-snapshot') {
    const snapId = actionEl.getAttribute('data-snap-id'), snap = (state.store.snapshots || []).find((s) => s.id === snapId);
    if (!snap) return;
    openConfirm({
      title: '覆盖快照确认', message: `确定要用当前预设状态覆盖更新快照「${snap.name}」吗？`, confirmText: '确认覆盖', confirmClass: 'warn',
      onConfirm: () => {
        const fresh = captureCurrentSnapshotData(snap.name, snap.mode); fresh.id = snap.id; fresh.createdAt = snap.createdAt;
        const idx = state.store.snapshots.findIndex((s) => s.id === snapId); if (idx >= 0) state.store.snapshots[idx] = fresh;
        saveStore(state.store); updateSnapshotList(); notify('success', `快照「${snap.name}」已更新`);
      },
    });
    return;
  }
  if (action === 'rename-snapshot') {
    const snap = (state.store.snapshots || []).find((s) => s.id === actionEl.getAttribute('data-snap-id'));
    if (snap) { state.modal = { type: 'snapshotRename', snapId: snap.id, name: snap.name, prevModal: state.modal }; renderModal(); }
    return;
  }
  if (action === 'back-to-snapshots' && state.modal?.type === 'snapshotRename') { state.modal = state.modal.prevModal || { type: 'snapshots', createMode: 'state', filter: 'current', draftName: '' }; renderModal(); return; }
  if (action === 'submit-snap-rename' && state.modal?.type === 'snapshotRename') {
    const inp = modalLayerEl.querySelector('#td-snap-rename-input'), name = (inp ? inp.value : state.modal.name || '').trim();
    if (!name) { notify('warning', '请输入快照名称'); return; }
    const snap = (state.store.snapshots || []).find((s) => s.id === state.modal.snapId);
    if (snap) { snap.name = name; snap.updatedAt = Date.now(); saveStore(state.store); }
    state.modal = state.modal.prevModal || { type: 'snapshots', createMode: 'state', filter: 'current', draftName: '' }; renderModal(); notify('success', '快照已重命名'); return;
  }
  if (action === 'delete-snapshot') {
    const snapId = actionEl.getAttribute('data-snap-id'), snap = (state.store.snapshots || []).find((s) => s.id === snapId);
    if (!snap) return;
    openConfirm({
      title: '删除快照确认', message: `确定要永久删除快照「${snap.name}」吗？`, confirmText: '确认删除',
      onConfirm: () => {
        state.store.snapshots = (state.store.snapshots || []).filter((s) => s.id !== snapId); saveStore(state.store);
        const allChip = modalLayerEl.querySelector("[data-action='set-snapshot-filter'][data-filter='all']");
        if (allChip) allChip.textContent = `全部快照 (${state.store.snapshots.length})`;
        updateSnapshotList(); renderMain(); notify('info', '快照已删除');
      },
    });
    return;
  }

  if (action === 'open-bindings') { state.modal = { type: 'bindings', selectedIds: new Set(getBoundSchemeIds(state.presetName)) }; renderModal(); return; }
  if (action === 'toggle-bind-scheme' && state.modal?.type === 'bindings') {
    const sid = actionEl.getAttribute('data-scheme-id'); if (!sid) return;
    const set = state.modal.selectedIds, willCheck = !set.has(sid);
    if (willCheck) set.add(sid); else set.delete(sid);
    actionEl.classList.toggle('checked', willCheck);
    const cb = actionEl.querySelector('.td-checkbox'); if (cb) cb.checked = willCheck; return;
  }
  if (action === 'clear-bindings' && state.modal?.type === 'bindings') {
    state.modal.selectedIds.clear();
    modalLayerEl.querySelectorAll("[data-action='toggle-bind-scheme']").forEach((row) => { row.classList.remove('checked'); const cb = row.querySelector('.td-checkbox'); if (cb) cb.checked = false; });
    return;
  }
  if (action === 'save-bindings' && state.modal?.type === 'bindings') {
    const pKey = state.presetName || '__default__', arr = Array.from(state.modal.selectedIds);
    if (arr.length > 0) state.store.presetBindings[pKey] = arr; else delete state.store.presetBindings[pKey];
    saveStore(state.store); state.modal = null; renderModal(); renderMain();
    notify('success', arr.length > 0 ? `已绑定 ${arr.length} 个方案到当前预设` : '已解除绑定，将显示全部方案'); return;
  }
  if (action === 'new-scheme') { state.modal = { type: 'schemeForm', mode: 'create', schemeId: null, name: '' }; renderModal(); return; }
  if (action === 'rename-scheme') { const s = getActiveScheme(); state.modal = { type: 'schemeForm', mode: 'rename', schemeId: s.id, name: s.name }; renderModal(); return; }
  if (action === 'duplicate-scheme') { const s = getActiveScheme(); state.modal = { type: 'schemeForm', mode: 'duplicate', duplicateFromId: s.id, name: `${s.name} (副本)` }; renderModal(); return; }
  if (action === 'delete-scheme') {
    const s = getActiveScheme();
    openConfirm({ title: '删除方案确认', message: `确定要从全局方案池中永久删除方案「${s.name}」及其包含的所有分组配置吗？`, confirmText: '确认删除', onConfirm: () => { deleteActiveScheme(); renderMain(); } });
    return;
  }
  if (action === 'submit-scheme-form' && state.modal?.type === 'schemeForm') {
    const inp = modalLayerEl.querySelector('#td-scheme-name-input'), bindCb = modalLayerEl.querySelector('#td-scheme-bind-check');
    const name = (inp ? inp.value : state.modal.name || '').trim();
    if (!name) { notify('warning', '请输入方案名称'); if (inp) inp.focus(); return; }
    const bindToCurrent = bindCb ? !!bindCb.checked : !!state.modal.bindToCurrent;
    if (state.modal.mode === 'rename') createOrUpdateScheme({ id: state.modal.schemeId, name });
    else if (state.modal.mode === 'duplicate') createOrUpdateScheme({ duplicateFromId: state.modal.duplicateFromId, name, bindToCurrent });
    else createOrUpdateScheme({ name, bindToCurrent });
    state.modal = null; renderModal(); renderMain(); return;
  }

  if (action === 'new-group') { state.modal = { type: 'groupForm', groupId: null, parentId: null, name: '', mode: 'multi' }; renderModal(); return; }
  if (action === 'new-subgroup') {
    e.stopPropagation(); state.activeGroupMenuId = null;
    const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return;
    state.modal = { type: 'groupForm', groupId: null, parentId: found.group.id, parentName: found.group.name, name: '', mode: 'multi' }; renderModal(); return;
  }
  if (action === 'edit-group') {
    e.stopPropagation(); state.activeGroupMenuId = null;
    const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return;
    state.modal = { type: 'groupForm', groupId: found.group.id, parentId: null, name: found.group.name, mode: found.group.mode }; renderModal(); return;
  }
  if (action === 'delete-group') {
    e.stopPropagation(); state.activeGroupMenuId = null;
    const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return;
    openConfirm({
      title: `管理分组 · ${found.group.name}`, message: '你可以选择仅「清空分组」（保留该分组结构，清空其内部条目和子分组），或「确认删除」该分组。', confirmText: '确认删除',
      extraButton: { text: '清空分组', className: 'warn', onClick: () => { clearGroupContents(groupId); renderMain(); } },
      onConfirm: () => { deleteGroup(groupId); renderMain(); },
    });
    return;
  }
  if (action === 'toggle-collapse') {
    if (e.target.closest('[data-stop-collapse]') || e.target.closest('.td-drag-grip')) return;
    const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return;
    found.group.collapsed = !found.group.collapsed; saveStore(state.store);
    const groupEl = panelMainEl.querySelector(`.td-group[data-group-id='${groupId}']`);
    if (groupEl) {
      groupEl.classList.toggle('collapsed', found.group.collapsed);
      updateStickyGroupHeaders();
    } else renderMainBodyOnly();
    return;
  }
  if (action === 'toggle-multi-group') { e.stopPropagation(); const task = toggleMultiGroupAll(groupId); syncEntryStatesUI(); task.then(() => syncEntryStatesUI()); return; }
  if (action === 'open-picker') {
    e.stopPropagation(); state.activeGroupMenuId = null;
    const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return;
    const g = found.group, selectedMap = new Map();
    (g.items || []).forEach((it) => { const cloned = cloneItemRef(it); if (cloned) selectedMap.set(cloned.key, cloned); });
    state.modal = { type: 'picker', groupId: g.id, source: 'preset', selectedMap, query: '', filter: 'all', selectMode: 'single', rangeAnchorKey: null, rangeAction: true, controlsOpen: false };
    renderModal(); refreshAllCatalogs().then(() => { if (state.modal?.type === 'picker') updatePickerList(); }); return;
  }
  if (action === 'toggle-entry') { e.stopPropagation(); const task = toggleEntryInGroup(groupId, itemKey); syncEntryStatesUI(); task.then(() => syncEntryStatesUI()); return; }
  if (action === 'remove-entry') {
    const entry = state.catalog.byKey.get(itemKey);
    openConfirm({ title: '移除条目确认', message: `确定要将「${entry ? entry.name : itemKey}」从此分组中移除吗？`, confirmText: '确认移除', onConfirm: () => { removeEntryFromGroup(groupId, itemKey); renderMainBodyOnly(); } });
    return;
  }
  if (action === 'preview-entry') { e.stopPropagation(); state.snapshotDetailId = null; state.previewCtx = null; state.previewKey = itemKey; renderPreviewModal(); return; }
  if (action === 'close-preview') { state.previewKey = null; state.previewCtx = null; state.snapshotDetailId = null; renderPreviewModal(); return; }
  if (action === 'preview-undo') { pushEditSnapshot(true); if (editHistory.index > 0) { editHistory.index--; applyPreviewSnapshot(editHistory.stack[editHistory.index]); updatePreviewHistoryButtons(); } return; }
  if (action === 'preview-redo') { if (editHistory.index < editHistory.stack.length - 1) { editHistory.index++; applyPreviewSnapshot(editHistory.stack[editHistory.index]); updatePreviewHistoryButtons(); } return; }
  if (action === 'copy-preview') {
    const contentEl = previewLayerEl.querySelector('#td-edit-content') || previewLayerEl.querySelector('#td-edit-replace-string');
    copyToClipboard(contentEl ? contentEl.value : '').then(() => notify('success', '内容已复制到剪贴板')).catch((err) => { logError('复制预览内容失败', err); notify('error', '复制失败'); });
    return;
  }
  if (action === 'toggle-preview-entry') {
    const item = state.catalog.byKey.get(state.previewKey); if (!item) return;
    const task = applyItemMutations([{ ref: item.ref, enabled: !item.enabled }]); syncEntryStatesUI(); task.then(() => syncEntryStatesUI()); return;
  }
  if (action === 'save-preview-edit') {
    const item = state.catalog.byKey.get(state.previewKey); if (!item) return;
    const targetKey = state.previewKey, snap = readPreviewSnapshot();
    const fields = { name: snap.name || item.name };
    if (previewLayerEl.querySelector('#td-edit-content')) { fields.content = snap.content; fields.allowContent = typeof item.raw.content === 'string' || snap.content.length > 0; }
    if (previewLayerEl.querySelector('#td-edit-find-regex')) fields.find_regex = snap.find_regex;
    if (previewLayerEl.querySelector('#td-edit-replace-string')) fields.replace_string = snap.replace_string;
    openConfirm({
      title: '保存更改确认', message: `确定要将对「${fields.name || item.name}」的修改保存并持久化吗？`, confirmText: '确认保存', confirmClass: 'primary',
      onConfirm: () => saveEditedEntry(targetKey, fields).then((ok) => { if (ok) { renderMain(); renderPreviewModal(); if (state.modal?.type === 'picker') updatePickerList(); } }),
    });
    return;
  }

  if (action === 'close-modal') { state.modal = null; renderModal(); return; }
  if (action === 'set-modal-mode' && state.modal?.type === 'groupForm') {
    const nextMode = actionEl.getAttribute('data-mode') === 'single' ? 'single' : 'multi';
    state.modal.mode = nextMode;
    modalLayerEl.querySelectorAll("[data-action='set-modal-mode']").forEach((card) => card.classList.toggle('active', card.getAttribute('data-mode') === nextMode));
    return;
  }
  if (action === 'submit-group-form' && state.modal?.type === 'groupForm') {
    const inp = modalLayerEl.querySelector('#td-group-name-input');
    const name = (inp ? inp.value : state.modal.name || '').trim();
    if (!name) { notify('warning', '请输入分组名称'); if (inp) inp.focus(); return; }
    createOrUpdateGroup({ id: state.modal.groupId, parentId: state.modal.parentId, name, mode: state.modal.mode });
    state.modal = null; renderModal(); renderMain(); return;
  }

  if (action === 'toggle-picker-controls' && state.modal?.type === 'picker') { state.modal.controlsOpen = !state.modal.controlsOpen; updatePickerList(); return; }
  if (action === 'toggle-picker-select-mode' && state.modal?.type === 'picker') { state.modal.selectMode = state.modal.selectMode === 'range' ? 'single' : 'range'; state.modal.rangeAnchorKey = null; updatePickerList(); return; }
  if (action === 'set-picker-source' && state.modal?.type === 'picker') {
    const nextSrc = actionEl.getAttribute('data-source') || 'preset'; state.modal.source = nextSrc; state.modal.rangeAnchorKey = null;
    if (nextSrc === 'worldbook' && state.catalog.worldbook.groups.length === 0) { updatePickerList(); refreshWorldbookCatalog(false).then(() => { if (state.modal?.type === 'picker') updatePickerList(); }); }
    else updatePickerList();
    return;
  }
  if (action === 'load-all-worldbooks' && state.modal?.type === 'picker') { refreshWorldbookCatalog(true).then(() => { if (state.modal?.type === 'picker') updatePickerList(); }); return; }
  if (action === 'toggle-pick' && state.modal?.type === 'picker') {
    if (e.target.closest("[data-action='preview-entry']")) return;
    const m = state.modal, item = state.catalog.byKey.get(itemKey); if (!item) return;
    const map = m.selectedMap;
    if (m.selectMode === 'range') {
      const visibleKeys = Array.from(modalLayerEl.querySelectorAll('.td-picker-row[data-item-key]')).map((r) => r.getAttribute('data-item-key'));
      if (!m.rangeAnchorKey || !visibleKeys.includes(m.rangeAnchorKey)) {
        const willCheck = !map.has(itemKey);
        if (willCheck) map.set(itemKey, cloneItemRef(item.ref)); else map.delete(itemKey);
        m.rangeAnchorKey = itemKey; m.rangeAction = willCheck; updatePickerList(); return;
      }
      if (m.rangeAnchorKey === itemKey) { m.rangeAnchorKey = null; updatePickerList(); return; }
      const idx1 = visibleKeys.indexOf(m.rangeAnchorKey), idx2 = visibleKeys.indexOf(itemKey);
      for (let i = Math.min(idx1, idx2); i <= Math.max(idx1, idx2); i++) {
        const rk = visibleKeys[i], rItem = state.catalog.byKey.get(rk);
        if (m.rangeAction) { if (rItem) map.set(rk, cloneItemRef(rItem.ref)); } else map.delete(rk);
      }
      m.rangeAnchorKey = null; updatePickerList(); return;
    }
    const willCheck = !map.has(itemKey);
    if (willCheck) map.set(itemKey, cloneItemRef(item.ref)); else map.delete(itemKey);
    actionEl.classList.toggle('checked', willCheck);
    const cb = actionEl.querySelector('.td-checkbox'); if (cb) cb.checked = willCheck;
    const countEl = modalLayerEl.querySelector("[data-role='picker-count']"); if (countEl) countEl.textContent = `已选 ${map.size} 项`;
    const selectedChipEl = modalLayerEl.querySelector("[data-action='set-picker-filter'][data-filter='selected']");
    if (selectedChipEl) selectedChipEl.textContent = `已勾选 (${map.size})`;
    if (m.filter === 'selected') updatePickerList();
    return;
  }
  if (action === 'set-picker-filter' && state.modal?.type === 'picker') { state.modal.filter = actionEl.getAttribute('data-filter'); state.modal.rangeAnchorKey = null; updatePickerList(); return; }
  if (action === 'picker-select-scope' && state.modal?.type === 'picker') {
    const sec = getPickerSections().find((s) => s.scopeKey === actionEl.getAttribute('data-scope-key'));
    if (sec) { sec.items.forEach((it) => state.modal.selectedMap.set(it.key, cloneItemRef(it.ref))); state.modal.rangeAnchorKey = null; updatePickerList(); }
    return;
  }
  if (action === 'picker-select-visible' && state.modal?.type === 'picker') {
    modalLayerEl.querySelectorAll('.td-picker-row[data-item-key]').forEach((r) => { const k = r.getAttribute('data-item-key'), it = state.catalog.byKey.get(k); if (it) state.modal.selectedMap.set(k, cloneItemRef(it.ref)); });
    state.modal.rangeAnchorKey = null; updatePickerList(); return;
  }
  if (action === 'picker-unselect-visible' && state.modal?.type === 'picker') {
    modalLayerEl.querySelectorAll('.td-picker-row[data-item-key]').forEach((r) => state.modal.selectedMap.delete(r.getAttribute('data-item-key')));
    state.modal.rangeAnchorKey = null; updatePickerList(); return;
  }
  if (action === 'save-picker' && state.modal?.type === 'picker') { setGroupItems(state.modal.groupId, state.modal.selectedMap); state.modal = null; renderModal(); renderMain(); notify('success', '分组条目已更新'); return; }

  // 设置交互
  if (action === 'trigger-orb-upload') { modalLayerEl.querySelector('#td-orb-img-input')?.click(); return; }
  if (action === 'clear-orb-image') { state.store.settings.orbImage = ''; saveStore(state.store); renderOrb(); renderModal(); notify('info', '已恢复默认悬浮球图标'); return; }
  if (action === 'toggle-native-preset-collapse') {
    const nextVal = !state.store.settings.collapseNativePresetSettings;
    state.store.settings.collapseNativePresetSettings = nextVal;
    saveStore(state.store); actionEl.classList.toggle('on', nextVal); syncNativePresetCollapse();
    notify('info', nextVal ? '已折叠酒馆原生预设设定区域' : '已展开酒馆原生预设设定区域'); return;
  }
  if (action === 'toggle-entry-switch') {
    const key = actionEl.getAttribute('data-key'), s = state.store.settings;
    const cur = (key === 'enableExtButton' || key === 'enableTopBarButton') ? !!s[key] : s[key] !== false;
    const nextVal = !cur;
    if (!nextVal) {
      const nextOrb = key === 'showOrb' ? false : s.showOrb !== false;
      const nextExt = key === 'enableExtButton' ? false : !!s.enableExtButton;
      const nextTop = key === 'enableTopBarButton' ? false : !!s.enableTopBarButton;
      if (!nextOrb && !nextExt && !nextTop) { notify('warning', '悬浮球、顶部栏按钮与魔法棒拓展按钮至少需保留一项开启'); return; }
    }
    s[key] = nextVal; saveStore(state.store);
    actionEl.classList.toggle('on', nextVal);
    if (key === 'showOrb') applyOrbVisualState();
    if (key === 'enableExtButton') syncExtensionButton();
    if (key === 'enableTopBarButton') {
      syncTopBarUI();
      const posRow = modalLayerEl.querySelector("[data-role='topbar-pos-row']");
      if (posRow) posRow.style.display = nextVal ? 'flex' : 'none';
    }
    return;
  }
  if (action === 'toggle-drag-sort') {
    const nextVal = !state.store.settings.enableDragSort;
    state.store.settings.enableDragSort = nextVal;
    saveStore(state.store); actionEl.classList.toggle('on', nextVal); renderMain(); return;
  }
  if (action === 'toggle-orb-sliders-lock') {
    const nextVal = !state.store.settings.unlockOrbSliders;
    state.store.settings.unlockOrbSliders = nextVal;
    saveStore(state.store);
    actionEl.classList.toggle('on', nextVal);
    const box = modalLayerEl.querySelector("[data-role='orb-sliders-box']");
    const szRange = modalLayerEl.querySelector('#td-size-range');
    const opRange = modalLayerEl.querySelector('#td-opacity-range');
    const szLbl = modalLayerEl.querySelector("[data-role='orb-size-label']");
    const opLbl = modalLayerEl.querySelector("[data-role='opacity-label']");
    if (box) box.classList.toggle('is-locked', !nextVal);
    if (szRange) szRange.disabled = !nextVal;
    if (opRange) opRange.disabled = !nextVal;
    const sz = getOrbSize();
    const op = Math.round((state.store.settings.orbOpacity ?? 0.96) * 100);
    if (szLbl) szLbl.textContent = `悬浮球大小 (${sz}px)${nextVal ? '' : ' · 已锁定'}`;
    if (opLbl) opLbl.textContent = `悬浮球透明度 (${op}%)${nextVal ? '' : ' · 已锁定'}`;
    return;
  }
  if (action === 'apply-panel-preset-default') {
    const def = getDefaultPanelSize();
    const wEl = modalLayerEl.querySelector('#td-panel-width-input');
    const hEl = modalLayerEl.querySelector('#td-panel-height-input');
    if (wEl) wEl.value = String(def.w);
    if (hEl) hEl.value = String(def.h);
    return;
  }
  if (action === 'apply-panel-size') {
    const vp = getViewportRect();
    const maxW = Math.max(280, Math.round(vp.w - 8));
    const maxH = Math.max(280, Math.round(vp.h - 8));
    const rawW = Number(modalLayerEl.querySelector('#td-panel-width-input')?.value);
    const rawH = Number(modalLayerEl.querySelector('#td-panel-height-input')?.value);
    if (Number.isNaN(rawW) || Number.isNaN(rawH)) {
      notify('warning', '请输入有效的长宽数字');
      return;
    }
    const nw = Math.max(280, Math.min(maxW, Math.round(rawW)));
    const nh = Math.max(280, Math.min(maxH, Math.round(rawH)));
    state.store.settings.fullscreen = false;
    state.store.settings.panelSize = { w: nw, h: nh };
    saveStore(state.store);
    repositionUI();
    const wEl = modalLayerEl.querySelector('#td-panel-width-input');
    const hEl = modalLayerEl.querySelector('#td-panel-height-input');
    if (wEl) wEl.value = String(nw);
    if (hEl) hEl.value = String(nh);
    const fsBtn = panelMainEl.querySelector("[data-action='toggle-fullscreen']");
    if (fsBtn) { fsBtn.innerHTML = ICONS.maximize; fsBtn.title = '全屏显示'; }
    notify('success', `已将控制台调整为 ${nw} × ${nh} px`);
    return;
  }
  if (action === 'toggle-collapse-group') {
    const nextVal = !(state.store.settings.collapseGroupActions !== false);
    state.store.settings.collapseGroupActions = nextVal;
    state.activeGroupMenuId = null; saveStore(state.store);
    actionEl.classList.toggle('on', nextVal);
    const sub = modalLayerEl.querySelector("[data-role='collapse-group-sub']");
    if (sub) sub.style.display = nextVal ? 'flex' : 'none';
    renderMainBodyOnly(); return;
  }
  if (action === 'toggle-collapsed-group-item') {
    const name = actionEl.getAttribute('data-item'); if (!name) return;
    const cfg = state.store.settings.collapsedGroupItems || { quickToggle: false, add: true, subgroup: true, edit: true, delete: true };
    cfg[name] = !cfg[name]; state.store.settings.collapsedGroupItems = cfg;
    saveStore(state.store); actionEl.classList.toggle('on', !!cfg[name]); renderMainBodyOnly(); return;
  }
  if (action === 'toggle-collapse-entry') {
    const nextVal = !(state.store.settings.collapseEntryActions !== false);
    state.store.settings.collapseEntryActions = nextVal;
    state.activeItemDrawerId = null; saveStore(state.store);
    actionEl.classList.toggle('on', nextVal);
    const sub = modalLayerEl.querySelector("[data-role='collapse-entry-sub']");
    if (sub) sub.style.display = nextVal ? 'flex' : 'none';
    renderMainBodyOnly(); return;
  }
  if (action === 'toggle-collapsed-entry-item') {
    const name = actionEl.getAttribute('data-item'); if (!name) return;
    const cfg = state.store.settings.collapsedEntryItems || { badge: true, preview: false, remove: true };
    cfg[name] = !cfg[name]; state.store.settings.collapsedEntryItems = cfg; state.activeItemDrawerId = null;
    saveStore(state.store); actionEl.classList.toggle('on', !!cfg[name]); renderMainBodyOnly(); return;
  }
  if (action === 'reset-layout') {
    state.store.settings.orbPosition = null; state.store.settings.panelPosition = null; state.store.settings.panelSize = null;
    state.store.settings.fullscreen = false; state.store.settings.orbSize = 50;
    saveStore(state.store); repositionUI(); renderMain();
    if (state.modal?.type === 'settings') renderModal();
    notify('success', '窗口与悬浮球已重置'); return;
  }
  if (action === 'clear-all-data') {
    openConfirm({
      title: '重置方案数据确认', message: '确定要清空全部方案、分组与预设绑定关系吗？（预设快照将保留）此操作不可撤销。', confirmText: '确认重置',
      onConfirm: () => {
        const defId = genId();
        state.store.schemes = [{ id: defId, name: '默认方案', groups: [] }];
        state.store.presetBindings = {}; state.store.activeSchemeByPreset = {}; state.store.activeSchemeId = defId;
        saveStore(state.store); state.modal = null; renderModal(); renderMain(); notify('info', '已重置全部方案数据');
      },
    });
  }
}

function handleRootInput(e) {
  if (!e.target) return;
  if (handleMergeUiInput(e, previewLayerEl)) return;
  if (handleManagerInput(e)) return;

  const id = e.target.id, role = e.target.getAttribute('data-role') || '';
  if (role === 'group-search-input') {
    const gid = e.target.getAttribute('data-group-id'); if (!gid) return;
    const val = e.target.value; state.groupSearch[gid] = val;
    const wrap = e.target.parentElement;
    if (wrap) {
      let clr = wrap.querySelector('.td-search-clear');
      if (val && !clr) {
        clr = document.createElement('button'); clr.type = 'button'; clr.className = 'td-search-clear';
        clr.setAttribute('data-action', 'clear-group-search'); clr.setAttribute('data-group-id', gid);
        clr.title = '清空'; clr.innerHTML = ICONS.close; wrap.appendChild(clr);
      } else if (!val && clr) clr.remove();
    }
    updateGroupItemsDom(gid); return;
  }
  if (id === 'td-merge-search' && state.modal?.type === 'presetMerge') { state.modal.session.query = e.target.value; updatePresetMergeBody(); return; }
  if (id === 'td-io-text-input' && state.modal?.type === 'ioCenter') { state.modal.rawText = e.target.value; return; }
  if (id === 'td-group-name-input' && state.modal?.type === 'groupForm') { state.modal.name = e.target.value; return; }
  if (id === 'td-scheme-name-input' && state.modal?.type === 'schemeForm') { state.modal.name = e.target.value; return; }
  if (id === 'td-snap-name-input' && state.modal?.type === 'snapshots') { state.modal.draftName = e.target.value; return; }
  if (id === 'td-snap-rename-input' && state.modal?.type === 'snapshotRename') { state.modal.name = e.target.value; return; }
  if (id === 'td-picker-search' && state.modal?.type === 'picker') { state.modal.query = e.target.value; state.modal.rangeAnchorKey = null; updatePickerList(); return; }
  if (id === 'td-size-range') {
    if (!state.store.settings.unlockOrbSliders) return;
    const sz = Math.max(34, Math.min(72, Number(e.target.value) || 50));
    state.store.settings.orbSize = sz; applyOrbVisualState();
    const label = modalLayerEl.querySelector("[data-role='orb-size-label']"); if (label) label.textContent = `悬浮球大小 (${sz}px)`;
    return;
  }
  if (id === 'td-opacity-range') {
    if (!state.store.settings.unlockOrbSliders) return;
    const val = Math.max(35, Math.min(100, Number(e.target.value) || 96)) / 100;
    state.store.settings.orbOpacity = val; orbEl.style.opacity = String(val);
    const label = modalLayerEl.querySelector("[data-role='opacity-label']"); if (label) label.textContent = `悬浮球透明度 (${Math.round(val * 100)}%)`;
    return;
  }
  if (['td-edit-name', 'td-edit-content', 'td-edit-find-regex', 'td-edit-replace-string', 'td-merge-custom-name', 'td-merge-custom-content', 'td-wbm-custom-name', 'td-wbm-custom-keys'].includes(id)) {
    const isLarge = e.inputType === 'insertFromPaste' || e.inputType === 'deleteByCut';
    if (isLarge) pushEditSnapshot(true); else scheduleEditSnapshot();
  }
}

function handleRootChange(e) {
  if (!e.target) return;
  if (handleManagerChange(e)) return;

  const id = e.target.id;
  if (id === 'td-preset-select') {
    const nextPreset = e.target.value; if (!nextPreset || nextPreset === state.presetName) return;
    const prevName = state.presetName;
    if (hasUnsavedPresetChanges(prevName)) {
      openConfirm({
        title: '检测到未保存的预设修改',
        message: `当前预设「${prevName}」的开关或内容与原预设文件不一致，切换至「${nextPreset}」前是否保存？`,
        confirmText: '保存并切换', confirmClass: 'primary',
        extraButton: { text: '仅切换', className: 'warn', onClick: () => performSwitchPreset(nextPreset) },
        onCancel: () => { e.target.value = prevName; },
        onConfirm: () => { saveInUseToPreset(prevName).then(() => performSwitchPreset(nextPreset)).catch((err) => notify('error', `保存失败: ${err.message || err}`)); },
      });
      return;
    }
    performSwitchPreset(nextPreset); return;
  }
  if (id === 'td-orb-img-input') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    loadOrbImageForCrop(file).then((res) => {
      if (res.isGif) {
        state.store.settings.orbImage = res.rawUrl;
        state.store.settings.orbImageFit = 'cover';
        saveStore(state.store); renderOrb(); renderModal(); notify('success', 'GIF 悬浮球图片已应用');
      } else {
        state.previewKey = null;
        state.snapshotDetailId = null;
        state.previewCtx = { type: 'orbCrop', img: res.img, zoom: 1, offsetX: 0, offsetY: 0 };
        renderPreviewModal();
      }
    }).catch((err) => notify('error', err.message || '图片加载失败'));
    return;
  }
  if (id === 'td-io-file-input' && state.modal?.type === 'ioCenter') {
    const file = e.target.files?.[0]; if (!file) return;
    file.text().then((txt) => {
      state.modal.rawText = txt;
      const parsed = JSON.parse(txt);
      if (!parsed || parsed.app !== APP_NAME) throw new Error('非 TavernDeck 备份文件');
      state.modal.importPreview = parsed; state.modal.impSchemes = Array.isArray(parsed.schemes);
      state.modal.impSnapshots = Array.isArray(parsed.snapshots); state.modal.impSettings = !!parsed.settings;
      renderModal();
    }).catch((err) => notify('error', `读取文件失败: ${err.message || err}`));
    return;
  }
  if (id === 'td-merge-settings-cb' && state.modal?.type === 'presetMerge') { state.modal.session.migrateSettings = !!e.target.checked; return; }
  if (id === 'td-merge-old-select' && state.modal?.type === 'presetMergeSelect') { state.modal.oldName = e.target.value; return; }
  if (id === 'td-merge-new-select' && state.modal?.type === 'presetMergeSelect') {
    state.modal.newName = e.target.value;
    const matchedOld = findBestMatchingOldPreset(e.target.value, state.presetNames);
    if (matchedOld) {
      state.modal.oldName = matchedOld;
      const oldSel = modalLayerEl.querySelector('#td-merge-old-select');
      if (oldSel) oldSel.value = matchedOld;
    }
    return;
  }
  if (id === 'td-merge-custom-enabled' && state.previewCtx?.type === 'mergeCustom') { pushEditSnapshot(true); return; }
  if (id === 'td-scheme-select') { setActiveSchemeId(e.target.value); renderMain(); return; }
  if (id === 'td-scheme-bind-check' && state.modal?.type === 'schemeForm') { state.modal.bindToCurrent = !!e.target.checked; return; }
  if (id === 'td-opacity-range' || id === 'td-size-range') saveStore(state.store);
}

function handleRootKeydown(e) {
  if (e.key === 'Enter' && !e.isComposing && e.target) {
    if (e.target.id === 'td-sp-color-input') selectLayerEl.querySelector("[data-action='select-popup-apply-color']")?.click();
    else if (e.target.id === 'td-move-idx-input') selectLayerEl.querySelector("[data-action='move-by-number']")?.click();
    else if (e.target.id === 'td-group-name-input') modalLayerEl.querySelector("[data-action='submit-group-form']")?.click();
    else if (e.target.id === 'td-scheme-name-input') modalLayerEl.querySelector("[data-action='submit-scheme-form']")?.click();
    else if (e.target.id === 'td-snap-rename-input') modalLayerEl.querySelector("[data-action='submit-snap-rename']")?.click();
    else if (e.target.id === 'td-snap-name-input') modalLayerEl.querySelector("[data-action='create-snapshot']")?.click();
    else if (e.target.id === 'td-panel-width-input' || e.target.id === 'td-panel-height-input') {
      modalLayerEl.querySelector("[data-action='apply-panel-size']")?.click();
    }
  }
}

function onOrbPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault(); e.stopPropagation(); wakeOrb();
  orbDragging = true; orbMoved = false; orbEl.classList.add('is-dragging');
  const pos = getOrbPosition();
  orbDragStart = { x: e.clientX, y: e.clientY, orbX: pos.x, orbY: pos.y };
  if (orbEl.setPointerCapture && e.pointerId !== undefined) { try { orbEl.setPointerCapture(e.pointerId); } catch (err) {} }
}

function onOrbPointerMove(e) {
  if (!orbDragging) return;
  const dx = e.clientX - orbDragStart.x, dy = e.clientY - orbDragStart.y;
  if (Math.hypot(dx, dy) > 5) orbMoved = true; if (!orbMoved) return;
  const vp = getViewportRect(), clamped = clampOrbPosition(orbDragStart.orbX + dx, orbDragStart.orbY + dy);
  state.store.settings.orbPosition = clamped;
  orbEl.style.left = `${Math.round(vp.x + clamped.x)}px`; orbEl.style.top = `${Math.round(vp.y + clamped.y)}px`;
}

function onOrbPointerUp(e) {
  if (!orbDragging) return;
  e.preventDefault(); e.stopPropagation(); orbDragging = false; orbEl.classList.remove('is-dragging');
  if (orbMoved) { saveStore(state.store); scheduleOrbIdle(); }
  else { suppressClickUntil = Date.now() + 450; setTimeout(() => setPanelOpen(!state.panelOpen), 45); }
}

function onOrbClick(e) { e.preventDefault(); e.stopPropagation(); }

function onPanelHeaderPointerDown(e) {
  if (state.store.settings.fullscreen || (e.button !== undefined && e.button !== 0)) return;
  const header = e.target.closest('[data-drag-handle]');
  if (!header || e.target.closest('button, a, input, select, [data-action]')) return;
  winDragging = true; const pos = getPanelPosition(getPanelSize());
  winDragStart = { x: e.clientX, y: e.clientY, left: pos.x, top: pos.y };
  if (panelEl.setPointerCapture && e.pointerId !== undefined) { try { panelEl.setPointerCapture(e.pointerId); } catch (err) {} }
}

function onResizePointerDown(e) {
  if (state.store.settings.fullscreen || (e.button !== undefined && e.button !== 0)) return;
  e.stopPropagation(); e.preventDefault(); winResizing = true;
  const size = getPanelSize(), pos = getPanelPosition(size);
  winResizeStart = { x: e.clientX, y: e.clientY, w: size.w, h: size.h, left: pos.x, top: pos.y };
  if (resizeHandleEl.setPointerCapture && e.pointerId !== undefined) { try { resizeHandleEl.setPointerCapture(e.pointerId); } catch (err) {} }
}

function onPanelPointerMove(e) {
  if (winDragging) {
    const vp = getViewportRect(), size = getPanelSize();
    const nx = Math.max(4, Math.min(Math.max(4, vp.w - size.w - 4), Math.round(winDragStart.left + e.clientX - winDragStart.x)));
    const ny = Math.max(4, Math.min(Math.max(4, vp.h - size.h - 4), Math.round(winDragStart.top + e.clientY - winDragStart.y)));
    state.store.settings.panelPosition = { x: nx, y: ny }; panelEl.style.left = `${Math.round(vp.x + nx)}px`; panelEl.style.top = `${Math.round(vp.y + ny)}px`; return;
  }
  if (winResizing) {
    const vp = getViewportRect(), maxW = Math.max(280, vp.w - winResizeStart.left - 4), maxH = Math.max(280, vp.h - winResizeStart.top - 4);
    const nw = Math.max(280, Math.min(maxW, Math.round(winResizeStart.w + e.clientX - winResizeStart.x)));
    const nh = Math.max(280, Math.min(maxH, Math.round(winResizeStart.h + e.clientY - winResizeStart.y)));
    state.store.settings.panelSize = { w: nw, h: nh }; panelEl.style.width = `${nw}px`; panelEl.style.height = `${nh}px`;
  }
}

function onPanelPointerUp() {
  if (winDragging) { winDragging = false; saveStore(state.store); }
  if (winResizing) { winResizing = false; saveStore(state.store); }
}

function clearDragVisuals() {
  if (!panelMainEl) return;
  panelMainEl.querySelectorAll('.td-is-dragging').forEach((el) => el.classList.remove('td-is-dragging'));
  panelMainEl.querySelectorAll('.td-drop-before,.td-drop-after,.td-drop-into,.td-drop-active').forEach((el) => {
    el.classList.remove('td-drop-before', 'td-drop-after', 'td-drop-into', 'td-drop-active');
  });
  panelMainEl.querySelector('.td-body')?.classList.remove('is-dragging-group', 'is-dragging-item');
}

function onSortGripPointerDown(e) {
  if (!state.store.settings.enableDragSort || (e.button !== undefined && e.button !== 0)) return;
  const grip = e.target.closest('.td-drag-grip'); if (!grip) return;
  e.preventDefault(); e.stopPropagation();
  dragOp = {
    type: grip.getAttribute('data-drag-type'), sourceGroupId: grip.getAttribute('data-group-id'),
    itemKey: grip.getAttribute('data-item-key') || '', label: grip.getAttribute('data-drag-label') || '拖拽项',
    startX: e.clientX, startY: e.clientY, active: false, ghostEl: null, dropTarget: null,
  };
}

function onGlobalPointerMove(e) {
  if (!dragOp) return;
  if (!dragOp.active) {
    if (Math.hypot(e.clientX - dragOp.startX, e.clientY - dragOp.startY) < 6) return;
    dragOp.active = true;
    const ghost = document.createElement('div'); ghost.className = 'td-drag-ghost'; ghost.textContent = dragOp.label;
    rootEl.appendChild(ghost); dragOp.ghostEl = ghost;
    panelMainEl.querySelector('.td-body')?.classList.add(dragOp.type === 'group' ? 'is-dragging-group' : 'is-dragging-item');
    if (dragOp.type === 'group') panelMainEl.querySelector(`.td-group[data-group-id='${dragOp.sourceGroupId}']`)?.classList.add('td-is-dragging');
    else panelMainEl.querySelector(`.td-item[data-group-id='${dragOp.sourceGroupId}'][data-item-key='${cssEscape(dragOp.itemKey)}']`)?.classList.add('td-is-dragging');
  }
  if (dragOp.ghostEl) { dragOp.ghostEl.style.left = `${Math.round(e.clientX + 12)}px`; dragOp.ghostEl.style.top = `${Math.round(e.clientY - 18)}px`; }
  const body = panelMainEl.querySelector('.td-body');
  if (body) { const br = body.getBoundingClientRect(); if (e.clientY < br.top + 44) body.scrollTop -= 10; else if (e.clientY > br.bottom - 44) body.scrollTop += 10; }
  panelMainEl.querySelectorAll('.td-drop-before,.td-drop-after,.td-drop-into,.td-drop-active').forEach((el) => {
    el.classList.remove('td-drop-before', 'td-drop-after', 'td-drop-into', 'td-drop-active');
  });
  dragOp.dropTarget = null;
  const hit = document.elementFromPoint(e.clientX, e.clientY); if (!hit || !panelMainEl.contains(hit)) return;

  if (dragOp.type === 'item') {
    const itemEl = hit.closest('.td-item[data-item-key]');
    if (itemEl) {
      const tGroupId = itemEl.getAttribute('data-group-id'), tKey = itemEl.getAttribute('data-item-key');
      if (tGroupId === dragOp.sourceGroupId && tKey === dragOp.itemKey) return;
      const rect = itemEl.getBoundingClientRect(), pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      itemEl.classList.add(pos === 'before' ? 'td-drop-before' : 'td-drop-after');
      dragOp.dropTarget = { kind: 'item', groupId: tGroupId, itemKey: tKey, pos }; return;
    }
    const grpEl = hit.closest('.td-group-head[data-group-id], .td-group-empty[data-group-id], .td-group-items[data-group-id]');
    if (grpEl) {
      const tGroupId = grpEl.getAttribute('data-group-id');
      panelMainEl.querySelector(`.td-group[data-group-id='${tGroupId}'] .td-group-head`)?.classList.add('td-drop-into');
      dragOp.dropTarget = { kind: 'group-append', groupId: tGroupId };
    }
    return;
  }
  if (dragOp.type === 'group') {
    const srcGroupEl = panelMainEl.querySelector(`.td-group[data-group-id='${dragOp.sourceGroupId}']`);
    const rootZone = hit.closest('.td-root-dropzone[data-root-pos]');
    if (rootZone) { rootZone.classList.add('td-drop-active'); dragOp.dropTarget = { kind: 'root', pos: rootZone.getAttribute('data-root-pos') }; return; }
    const headEl = hit.closest('.td-group-head[data-group-id]');
    if (headEl) {
      const tId = headEl.getAttribute('data-group-id'), tGroupEl = headEl.closest('.td-group');
      if (tId === dragOp.sourceGroupId || (srcGroupEl && srcGroupEl.contains(headEl))) return;
      const rect = headEl.getBoundingClientRect(), rel = (e.clientY - rect.top) / Math.max(1, rect.height);
      if (rel < 0.28) { tGroupEl?.classList.add('td-drop-before'); dragOp.dropTarget = { kind: 'group', targetGroupId: tId, pos: 'before' }; }
      else if (rel > 0.72) { tGroupEl?.classList.add('td-drop-after'); dragOp.dropTarget = { kind: 'group', targetGroupId: tId, pos: 'after' }; }
      else { headEl.classList.add('td-drop-into'); dragOp.dropTarget = { kind: 'group', targetGroupId: tId, pos: 'into' }; }
      return;
    }
    const grpEl = hit.closest('.td-group[data-group-id]');
    if (grpEl) {
      const tId = grpEl.getAttribute('data-group-id');
      if (tId === dragOp.sourceGroupId || (srcGroupEl && srcGroupEl.contains(grpEl))) return;
      const rect = grpEl.getBoundingClientRect(), pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      grpEl.classList.add(pos === 'before' ? 'td-drop-before' : 'td-drop-after');
      dragOp.dropTarget = { kind: 'group', targetGroupId: tId, pos };
    }
  }
}

function onGlobalPointerUp() {
  if (!dragOp) return; const op = dragOp; dragOp = null;
  op.ghostEl?.remove(); clearDragVisuals();
  if (op.active && op.dropTarget) { suppressClickUntil = Date.now() + 200; if (performDrop(op)) renderMain(); }
}

function onHostResize() {
  const active = document.activeElement;
  if (active && rootEl && rootEl.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) { syncOverlayBounds(); return; }
  repositionUI();
}

function onHostWandClick(e) { if (e.target?.closest?.('#extensionsMenuButton')) setTimeout(syncExtensionButton, 0); }

export function mountUI() {
  cleanupDOM();
  rootEl = document.createElement('div'); rootEl.id = ROOT_ID;
  orbEl = document.createElement('div'); orbEl.className = 'td-orb'; orbEl.title = `${APP_NAME} ${APP_VERSION}`;
  panelEl = document.createElement('div'); panelEl.className = 'td-panel';
  panelMainEl = document.createElement('div'); panelMainEl.className = 'td-panel-main';
  resizeHandleEl = document.createElement('div'); resizeHandleEl.className = 'td-resize-handle'; resizeHandleEl.innerHTML = ICONS.grip;
  panelEl.appendChild(panelMainEl); panelEl.appendChild(resizeHandleEl);
  modalLayerEl = document.createElement('div'); modalLayerEl.className = 'td-modal-layer';
  previewLayerEl = document.createElement('div'); previewLayerEl.className = 'td-preview-layer';
  selectLayerEl = document.createElement('div'); selectLayerEl.className = 'td-select-layer';
  confirmLayerEl = document.createElement('div'); confirmLayerEl.className = 'td-confirm-layer';
  rootEl.appendChild(orbEl); rootEl.appendChild(panelEl); rootEl.appendChild(modalLayerEl);
  rootEl.appendChild(previewLayerEl); rootEl.appendChild(selectLayerEl); rootEl.appendChild(confirmLayerEl);
  document.body.appendChild(rootEl);

  setUiContext({
    getModalLayer: () => modalLayerEl,
    getPreviewLayer: () => previewLayerEl,
    getSelectLayer: () => selectLayerEl,
    getConfirmLayer: () => confirmLayerEl,
    getViewportRect,
    getPanelSize,
    getDefaultPanelSize,
    syncOverlayBounds,
    renderManagerModal: renderManagerModalView,
    renderManagerPreview: renderManagerPreviewView,
  });

  setUiManagersContext({
    getModalLayer: () => modalLayerEl,
    getPreviewLayer: () => previewLayerEl,
    getSelectLayer: () => selectLayerEl,
    getViewportRect,
    syncOverlayBounds,
    renderMain,
    renderModal: () => renderPreservingFocus(modalLayerEl, renderModal),
    renderPreviewModal: () => renderPreservingFocus(previewLayerEl, renderPreviewModal),
    renderOrb,
    syncTopBarUI,
    applyThemeAttributes,
    openConfirm,
    performSwitchPreset,
  });

  orbEl.addEventListener('pointerdown', onOrbPointerDown);
  orbEl.addEventListener('pointermove', onOrbPointerMove);
  orbEl.addEventListener('pointerup', onOrbPointerUp);
  orbEl.addEventListener('pointercancel', onOrbPointerUp);
  orbEl.addEventListener('click', onOrbClick);
  panelEl.addEventListener('pointerdown', onPanelHeaderPointerDown);
  panelEl.addEventListener('pointerdown', onSortGripPointerDown);
  panelEl.addEventListener('pointermove', onPanelPointerMove);
  panelEl.addEventListener('pointerup', onPanelPointerUp);
  panelEl.addEventListener('pointercancel', onPanelPointerUp);
  resizeHandleEl.addEventListener('pointerdown', onResizePointerDown);
  resizeHandleEl.addEventListener('pointermove', onPanelPointerMove);
  resizeHandleEl.addEventListener('pointerup', onPanelPointerUp);
  resizeHandleEl.addEventListener('pointercancel', onPanelPointerUp);
  rootEl.addEventListener('click', handleRootClickCapture, true);
  rootEl.addEventListener('click', handleRootClick);
  rootEl.addEventListener('input', handleRootInput);
  rootEl.addEventListener('change', handleRootChange);
  rootEl.addEventListener('keydown', handleRootKeydown);
  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerUp);
  window.addEventListener('pointercancel', onGlobalPointerUp);
  document.addEventListener('click', onHostWandClick, true);
  window.addEventListener('resize', onHostResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onHostResize);
    window.visualViewport.addEventListener('scroll', onHostResize);
  }
}

export function cleanupDOM() {
  clearOrbIdleTimer();
  if (editHistory.timer) clearTimeout(editHistory.timer);
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);
  window.removeEventListener('pointercancel', onGlobalPointerUp);
  document.removeEventListener('click', onHostWandClick, true);
  window.removeEventListener('resize', onHostResize);
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onHostResize);
    window.visualViewport.removeEventListener('scroll', onHostResize);
  }
  document.getElementById(EXT_BTN_ID)?.remove();
  document.getElementById(EXT_SETTINGS_ID)?.remove();
  document.getElementById('tavern-deck-top-bar-btn')?.remove();
  document.getElementById(ROOT_ID)?.remove();
  rootEl = orbEl = panelEl = panelMainEl = resizeHandleEl = modalLayerEl = previewLayerEl = selectLayerEl = confirmLayerEl = null;
}
