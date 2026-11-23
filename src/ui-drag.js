import { cssEscape } from './utils.js';
import { state, saveStore, performDrop } from './store.js';
import { uiCtx, getOrbSize, setSuppressClickUntil } from './ui-common.js';

let orbIdleTimer = null;
let orbDragging = false;
let orbMoved = false;
let orbDragStart = { x: 0, y: 0, orbX: 0, orbY: 0 };
let winDragging = false;
let winDragStart = { x: 0, y: 0, left: 0, top: 0 };
let winResizing = false;
let winResizeStart = { x: 0, y: 0, w: 0, h: 0, left: 0, top: 0 };
let dragOp = null;
let stickyRaf = 0;

export function getViewportRect() {
  const vv = window.visualViewport;
  return {
    x: vv && typeof vv.offsetLeft === 'number' ? vv.offsetLeft : 0,
    y: vv && typeof vv.offsetTop === 'number' ? vv.offsetTop : 0,
    w: (vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 1200,
    h: (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 800,
  };
}

export function isMobileViewport() {
  return (window.innerWidth || 1200) <= 640;
}

export function clampOrbPosition(x, y) {
  const vp = getViewportRect();
  const sz = getOrbSize();
  return {
    x: Math.max(6, Math.min(vp.w - sz - 6, Math.round(x))),
    y: Math.max(6, Math.min(vp.h - sz - 6, Math.round(y))),
  };
}

export function getOrbPosition() {
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

export function clearOrbIdleTimer() {
  if (orbIdleTimer) { clearTimeout(orbIdleTimer); orbIdleTimer = null; }
}

export function wakeOrb() {
  clearOrbIdleTimer();
  if (state.orbIdle) { state.orbIdle = false; applyOrbVisualState(); }
}

export function scheduleOrbIdle() {
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
  const orbEl = uiCtx.getOrbEl();
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

export function getDefaultPanelSize() {
  const vp = getViewportRect();
  if (isMobileViewport()) {
    return { w: Math.max(290, Math.min(480, Math.round(vp.w - 16))), h: Math.max(360, Math.min(760, Math.round(vp.h * 0.82))) };
  }
  return { w: Math.min(500, vp.w - 24), h: Math.min(680, vp.h - 32) };
}

export function getPanelSize() {
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

export function getPanelPosition(size) {
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

  [
    uiCtx.getModalLayer(),
    uiCtx.getPreviewLayer(),
    uiCtx.getSelectLayer(),
    uiCtx.getConfirmLayer(),
    uiCtx.getHelpLayer(),
  ].forEach((layer) => {
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
  const rootEl = uiCtx.getRootEl();
  const orbEl = uiCtx.getOrbEl();
  const panelEl = uiCtx.getPanelEl();
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

export function updateStickyGroupHeaders() {
  const panelMainEl = uiCtx.getPanelMainEl();
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
    const isStuck = gRect.top < bodyTop - 0.5 && gRect.bottom > bodyTop + sRect.height + 6;
    stickyTop.classList.toggle('is-stuck', isStuck);
  });
}

export function bindBodyStickyScroll() {
  const panelMainEl = uiCtx.getPanelMainEl();
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

function onOrbPointerDown(e) {
  const orbEl = uiCtx.getOrbEl();
  if (!orbEl || (e.button !== undefined && e.button !== 0)) return;
  e.preventDefault(); e.stopPropagation(); wakeOrb();
  orbDragging = true; orbMoved = false; orbEl.classList.add('is-dragging');
  const pos = getOrbPosition();
  orbDragStart = { x: e.clientX, y: e.clientY, orbX: pos.x, orbY: pos.y };
  if (orbEl.setPointerCapture && e.pointerId !== undefined) { try { orbEl.setPointerCapture(e.pointerId); } catch (err) {} }
}

function onOrbPointerMove(e) {
  const orbEl = uiCtx.getOrbEl();
  if (!orbDragging || !orbEl) return;
  const dx = e.clientX - orbDragStart.x, dy = e.clientY - orbDragStart.y;
  if (Math.hypot(dx, dy) > 5) orbMoved = true; if (!orbMoved) return;
  const vp = getViewportRect(), clamped = clampOrbPosition(orbDragStart.orbX + dx, orbDragStart.orbY + dy);
  state.store.settings.orbPosition = clamped;
  orbEl.style.left = `${Math.round(vp.x + clamped.x)}px`; orbEl.style.top = `${Math.round(vp.y + clamped.y)}px`;
}

function onOrbPointerUp(e) {
  const orbEl = uiCtx.getOrbEl();
  if (!orbDragging) return;
  e.preventDefault(); e.stopPropagation(); orbDragging = false; orbEl?.classList.remove('is-dragging');
  if (orbMoved) { saveStore(state.store); scheduleOrbIdle(); }
  else { setSuppressClickUntil(Date.now() + 450); setTimeout(() => uiCtx.setPanelOpen(!state.panelOpen), 45); }
}

function onOrbClick(e) { e.preventDefault(); e.stopPropagation(); }

function onPanelHeaderPointerDown(e) {
  const panelEl = uiCtx.getPanelEl();
  if (!panelEl || state.store.settings.fullscreen || (e.button !== undefined && e.button !== 0)) return;
  const header = e.target.closest('[data-drag-handle]');
  if (!header || e.target.closest('button, a, input, select, [data-action]')) return;
  winDragging = true; const pos = getPanelPosition(getPanelSize());
  winDragStart = { x: e.clientX, y: e.clientY, left: pos.x, top: pos.y };
  if (panelEl.setPointerCapture && e.pointerId !== undefined) { try { panelEl.setPointerCapture(e.pointerId); } catch (err) {} }
}

function onResizePointerDown(e) {
  const resizeHandleEl = uiCtx.getResizeHandleEl();
  if (!resizeHandleEl || state.store.settings.fullscreen || (e.button !== undefined && e.button !== 0)) return;
  e.stopPropagation(); e.preventDefault(); winResizing = true;
  const size = getPanelSize(), pos = getPanelPosition(size);
  winResizeStart = { x: e.clientX, y: e.clientY, w: size.w, h: size.h, left: pos.x, top: pos.y };
  if (resizeHandleEl.setPointerCapture && e.pointerId !== undefined) { try { resizeHandleEl.setPointerCapture(e.pointerId); } catch (err) {} }
}

function onPanelPointerMove(e) {
  const panelEl = uiCtx.getPanelEl();
  if (!panelEl) return;
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
  const panelMainEl = uiCtx.getPanelMainEl();
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
  const rootEl = uiCtx.getRootEl();
  const panelMainEl = uiCtx.getPanelMainEl();
  if (!dragOp || !rootEl || !panelMainEl) return;
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
  if (op.active && op.dropTarget) { setSuppressClickUntil(Date.now() + 200); if (performDrop(op)) uiCtx.renderMain(); }
}

function onHostResize() {
  const rootEl = uiCtx.getRootEl();
  const active = document.activeElement;
  if (active && rootEl && rootEl.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) { syncOverlayBounds(); return; }
  repositionUI();
}

export function bindDragListeners() {
  const orbEl = uiCtx.getOrbEl();
  const panelEl = uiCtx.getPanelEl();
  const resizeHandleEl = uiCtx.getResizeHandleEl();

  orbEl?.addEventListener('pointerdown', onOrbPointerDown);
  orbEl?.addEventListener('pointermove', onOrbPointerMove);
  orbEl?.addEventListener('pointerup', onOrbPointerUp);
  orbEl?.addEventListener('pointercancel', onOrbPointerUp);
  orbEl?.addEventListener('click', onOrbClick);

  panelEl?.addEventListener('pointerdown', onPanelHeaderPointerDown);
  panelEl?.addEventListener('pointerdown', onSortGripPointerDown);
  panelEl?.addEventListener('pointermove', onPanelPointerMove);
  panelEl?.addEventListener('pointerup', onPanelPointerUp);
  panelEl?.addEventListener('pointercancel', onPanelPointerUp);

  resizeHandleEl?.addEventListener('pointerdown', onResizePointerDown);
  resizeHandleEl?.addEventListener('pointermove', onPanelPointerMove);
  resizeHandleEl?.addEventListener('pointerup', onPanelPointerUp);
  resizeHandleEl?.addEventListener('pointercancel', onPanelPointerUp);

  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerUp);
  window.addEventListener('pointercancel', onGlobalPointerUp);
  window.addEventListener('resize', onHostResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onHostResize);
    window.visualViewport.addEventListener('scroll', onHostResize);
  }
}

export function unbindDragListeners() {
  clearOrbIdleTimer();
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);
  window.removeEventListener('pointercancel', onGlobalPointerUp);
  window.removeEventListener('resize', onHostResize);
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onHostResize);
    window.visualViewport.removeEventListener('scroll', onHostResize);
  }
}
