import {
  APP_NAME, APP_SHORT, APP_CN, APP_VERSION, ROOT_ID, EXT_BTN_ID, EXT_SETTINGS_ID,
  hasTH, callTH, notify, escapeHtml, cssEscape, makeItemKey,
  logWarn, logError, syncNotifyRuntimeConfig,
} from './utils.js';
import { setDevUiContext, recordOpStep } from './dev-tools.js';
import {
  state, saveStore, ensureSchemesPool, getVisibleSchemes, getActiveScheme, getSchemeSources, findGroupNode,
  flushBackendLogQueue,
} from './store.js';
import { refreshAllCatalogs, resolveGroupItemStatus } from './catalog.js';
import { syncTopBarButton } from './native-ui.js';
import { isInActiveChat } from './worldbook-manager.js';
import {
  flushActiveMergeDraft, scheduleActiveMergeDraftSave, discardPendingCustomMergeDraft,
} from './merge-ui.js';
import {
  ICONS, ORB_STYLE_OPTIONS, editHistory, setUiContext,
  getSuppressClickUntil, setSuppressClickUntil, confirmDiscardDirtyModal, openConfirm,
  applyPreviewSnapshot, updatePreviewHistoryButtons, pushEditSnapshot, scheduleEditSnapshot,
} from './ui-common.js';
import { handleQuickInsertClick } from './ui-snippets.js';
import {
  syncEditorSearchHighlights, handleEditorSearchClick,
  handleEditorSearchInput, handleEditorSearchKeydown,
} from './ui-editor-search.js';
import { presetVarsUiModule } from './ui-preset-vars.js';
import {
  getViewportRect, getDefaultPanelSize, getPanelSize, syncOverlayBounds, repositionUI,
  wakeOrb, scheduleOrbIdle, applyOrbVisualState, updateStickyGroupHeaders, bindBodyStickyScroll,
  bindDragListeners, unbindDragListeners,
} from './ui-drag.js';
import {
  renderConfirmModal, renderModal, syncPreviewStatusUi, renderPreviewModal,
} from './ui-views.js';
import { groupsUiModule, renderGroupHtml, renderGroupItemsListHtml, updatePickerList } from './ui-groups.js';
import { snapshotsUiModule, updateSnapshotList } from './ui-snapshots.js';
import { mergeDialogsUiModule } from './ui-merge-dialogs.js';
import { mergePanelUiModule, updateDualMergeBody } from './ui-merge-panel.js';
import { presetsUiModule } from './ui-presets.js';
import { regexTestUiModule } from './ui-regex-test.js';
import { worldbooksUiModule } from './ui-worldbooks.js';
import { aiAssistantUiModule, flushAiEditDraft } from './ui-ai-assistant.js';
import { mvuUiModule } from './ui-mvu.js';
import { settingsUiModule, renderSelectPopup } from './ui-settings.js';
import { toolsUiModule } from './ui-tools.js';
import { helpUiModule, renderHelpModal } from './ui-help.js';

const UI_MODULES = [
  helpUiModule,
  mergeDialogsUiModule,
  mergePanelUiModule,
  groupsUiModule,
  snapshotsUiModule,
  presetsUiModule,
  regexTestUiModule,
  presetVarsUiModule,
  worldbooksUiModule,
  aiAssistantUiModule,
  mvuUiModule,
  settingsUiModule,
  toolsUiModule,
];

let rootEl = null;
let orbEl = null;
let panelEl = null;
let panelMainEl = null;
let resizeHandleEl = null;
let modalLayerEl = null;
let previewLayerEl = null;
let selectLayerEl = null;
let confirmLayerEl = null;
let helpLayerEl = null;

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
      setSuppressClickUntil(Date.now() + 450);
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
  const orbVal = s.orbStyle || 'indigo';
  const isPresetOrb = ORB_STYLE_OPTIONS.some((o) => o.id === orbVal);
  if (isPresetOrb) {
    rootEl.setAttribute('data-orb-style', orbVal);
    rootEl.style.removeProperty('--td-orb-bg');
    rootEl.style.removeProperty('--td-orb-shadow');
    rootEl.style.removeProperty('--td-orb-color');
  } else {
    rootEl.setAttribute('data-orb-style', 'custom');
    rootEl.style.setProperty('--td-orb-bg', orbVal);
    rootEl.style.setProperty('--td-orb-shadow', '0 10px 28px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.25) inset');
    let iconColor = '#ffffff';
    const hex = orbVal.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      if (0.299 * r + 0.587 * g + 0.114 * b > 186) iconColor = '#0f172a';
    }
    rootEl.style.setProperty('--td-orb-color', iconColor);
  }
  if (s.groupTextColor) rootEl.style.setProperty('--td-group-color', s.groupTextColor);
  else rootEl.style.removeProperty('--td-group-color');
  if (s.entryTextColor) rootEl.style.setProperty('--td-entry-color', s.entryTextColor);
  else rootEl.style.removeProperty('--td-entry-color');
  syncNotifyRuntimeConfig(s);
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

export function syncEntryStatesUI() {
  if (!panelMainEl || !state.panelOpen) return;
  const activeScheme = getActiveScheme();

  panelMainEl.querySelectorAll('.td-item[data-item-key]').forEach((itemEl) => {
    const k = itemEl.getAttribute('data-item-key');
    const gid = itemEl.getAttribute('data-group-id');
    const found = gid ? findGroupNode(activeScheme.groups, gid) : null;
    const refInGroup = found ? (found.group.items || []).find((it) => (it.key || makeItemKey(it)) === k) : null;
    const entry = refInGroup
      ? resolveGroupItemStatus(refInGroup, activeScheme).entry
      : state.catalog.byKey.get(k);
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
      const entry = resolveGroupItemStatus(ref, activeScheme).entry;
      if (entry) { validCount++; if (entry.enabled) activeCount++; }
    });
    const stickyTop = Array.from(groupEl.children).find((el) => el.classList.contains('td-group-sticky-top'));
    const headEl = stickyTop ? Array.from(stickyTop.children).find((el) => el.classList.contains('td-group-head')) : null;
    if (headEl) {
      const countEl = headEl.querySelector('.td-count-tag');
      if (countEl) countEl.textContent = `${activeCount}/${items.length}`;
      if (g.mode === 'multi') {
        const groupSw = headEl.querySelector("[data-action='toggle-multi-group']");
        const isSwitchOn = g.meta?.memoryToggle
          ? (validCount > 0 && activeCount > 0)
          : (validCount > 0 && activeCount === validCount);
        if (groupSw) groupSw.classList.toggle('on', isSwitchOn);
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
  const inCharChat = (state.hasCharacter || (hasTH('getCurrentCharacterName') && !!callTH('getCurrentCharacterName'))) && isInActiveChat();
  const prevBody = panelMainEl.querySelector('.td-body');
  const prevScrollTop = prevBody ? prevBody.scrollTop : 0;

  const presetList = (state.presetNames || []).filter((n) => n && n !== 'in_use');
  if (state.presetName && state.presetName !== 'in_use' && !presetList.includes(state.presetName)) {
    presetList.unshift(state.presetName);
  }
  const presetOptions = presetList
    .map((pName) => `<option value='${escapeHtml(pName)}' ${pName === state.presetName ? 'selected' : ''}>${escapeHtml(pName)}</option>`)
    .join('');
  const activeSources = getSchemeSources(activeScheme);
  const schemeOptions = visInfo.schemes
    .map((s) => {
      const srcs = getSchemeSources(s);
      const srcSuffix = srcs.length > 0 ? ` · ${srcs.length}源` : '';
      return `<option value='${escapeHtml(s.id)}' ${s.id === activeScheme.id ? 'selected' : ''}>${escapeHtml(s.name)} (${(s.groups || []).length} 组${srcSuffix})</option>`;
    })
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
        <button class='td-icon-btn' data-action='open-help' data-help-key='main' title='功能说明'>${ICONS.help}</button>
        <button class='td-icon-btn' data-action='close-panel' title='收起面板'>${ICONS.close}</button>
      </div>
    </div>
    <div class='td-control-drawer ${showTools ? 'is-open' : ''}' id='td-tools-drawer'>
      <div class='td-drawer-grid'>
        <button class='td-btn' data-action='open-preset-manager'>${ICONS.layers} 预设管理</button>
        <button class='td-btn' data-action='open-worldbook-manager'>${ICONS.layers} 世界书管理</button>
        <button class='td-btn' data-action='open-preset-merge'>${ICONS.gitMerge} 预设对比缝合</button>
        <button class='td-btn' data-action='open-wb-merge'>${ICONS.gitMerge} 世界书对比缝合</button>
        <button class='td-btn' data-action='open-snapshots'>${ICONS.camera} 快照中心${snapCount > 0 ? ` (${snapCount})` : ''}</button>
        <button class='td-btn' data-action='open-logs'>${ICONS.code} 运行日志</button>
        ${inCharChat ? `<button class='td-btn' data-action='open-mvu-viewer'>${ICONS.eye} MVU 变量查看</button>` : ''}
        <button class='td-btn ${inCharChat ? '' : 'full'}' data-action='open-storage-manager'>${ICONS.database} 存储空间</button>
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
        <div class='td-stat-pill' title='${escapeHtml(activeSources.length > 0 ? `当前方案来源：${activeSources.join('、')}` : '当前方案未绑定源')}'><span>启用 <strong>${enabledPresetTotal}</strong>/${state.catalog.preset.length} · ${activeSources.length > 0 ? `已绑 ${activeSources.length} 源` : '未指定源'}</span></div>
        <button class='td-btn primary' data-action='new-group'>${ICONS.plus} 新建分组</button>
      </div>
      ${activeSources.length > 0 ? `
        <div class='td-scheme-sources-row'>
          <span class='td-scheme-sources-label'>来源</span>
          <div class='td-scheme-sources-wrap td-scroll'>
            ${activeSources.map((src) => `
              <span class='td-scheme-src-chip ${src === state.presetName ? 'is-current' : ''}' title='${escapeHtml(src)}'>
                <span class='td-scheme-src-name'>${escapeHtml(src)}</span>
                <button type='button' class='td-scheme-src-del' data-action='unbind-scheme-source' data-scheme-id='${escapeHtml(activeScheme.id)}' data-source='${escapeHtml(src)}' title='解除源「${escapeHtml(src)}」'>×</button>
              </span>`).join('')}
          </div>
        </div>` : ''}
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
  const prevBodyTop = targetLayer?.querySelector('.td-modal-body')?.scrollTop || 0;
  const prevListTop = targetLayer?.querySelector('.td-picker-list')?.scrollTop || 0;
  const prevSnapDiffTop = targetLayer?.querySelector("[data-role='snap-diff-scroll']")?.scrollTop || 0;
  const prevDualSrcTop = targetLayer?.querySelector("[data-role='dual-list-source']")?.scrollTop || 0;
  const prevDualBaseTop = targetLayer?.querySelector("[data-role='dual-list-base']")?.scrollTop || 0;

  renderFn();

  if (targetLayer) {
    const restoreScroll = () => {
      if (prevBodyTop > 0) {
        const nextBody = targetLayer.querySelector('.td-modal-body');
        if (nextBody) nextBody.scrollTop = prevBodyTop;
      }
      if (prevListTop > 0) {
        const nextList = targetLayer.querySelector('.td-picker-list');
        if (nextList) nextList.scrollTop = prevListTop;
      }
      if (prevSnapDiffTop > 0) {
        const nextSnapDiff = targetLayer.querySelector("[data-role='snap-diff-scroll']");
        if (nextSnapDiff) nextSnapDiff.scrollTop = prevSnapDiffTop;
      }
      const nextDualSrc = targetLayer.querySelector("[data-role='dual-list-source']");
      if (nextDualSrc && prevDualSrcTop > 0) {
        nextDualSrc._tdIgnoreScroll = true;
        nextDualSrc.scrollTop = prevDualSrcTop;
        nextDualSrc._tdLastTop = nextDualSrc.scrollTop;
        requestAnimationFrame(() => { nextDualSrc._tdIgnoreScroll = false; });
      }
      const nextDualBase = targetLayer.querySelector("[data-role='dual-list-base']");
      if (nextDualBase && prevDualBaseTop > 0) {
        nextDualBase._tdIgnoreScroll = true;
        nextDualBase.scrollTop = prevDualBaseTop;
        nextDualBase._tdLastTop = nextDualBase.scrollTop;
        requestAnimationFrame(() => { nextDualBase._tdIgnoreScroll = false; });
      }
    };
    restoreScroll();
    requestAnimationFrame(restoreScroll);
  }
  if (focusId && targetLayer) {
    const nextEl = targetLayer.querySelector(`#${cssEscape(focusId)}`);
    if (nextEl) {
      nextEl.focus({ preventScroll: true });
      if (typeof selStart === 'number' && typeof nextEl.setSelectionRange === 'function') {
        try { nextEl.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    }
  }
}

function describeCurrentUiLocation() {
  if (!state.panelOpen) return '悬浮球/后台';
  const parts = ['主面板'];
  const m = state.modal;
  if (m) {
    const modalLabelMap = {
      presetManager: '预设管理',
      presetDetail: `预设编辑(${m.presetName || ''})`,
      worldbookManager: '世界书管理',
      worldbookDetail: `世界书条目(${m.bookName || ''})`,
      snapshots: '快照中心',
      snapshotRename: '重命名快照',
      presetMergeSelect: '预设缝合选择',
      presetMerge: '预设对比缝合',
      wbMergeSelect: '世界书缝合选择',
      wbMerge: '世界书对比缝合',
      mvuViewer: 'MVU变量查看',
      settings: '设置',
      storageManager: '存储空间',
      logs: '运行日志',
      ioCenter: '导入导出中心',
      picker: '条目选择器',
      bindings: '方案绑定',
      groupForm: '分组表单',
      schemeForm: '方案表单',
    };
    parts.push(modalLabelMap[m.type] || m.type);
  }
  if (state.snapshotDetailId) parts.push('快照差异详情');
  else if (state.previewCtx?.type) parts.push(state.previewCtx.type);
  else if (state.previewKey) parts.push('条目预览编辑');
  if (state.selectPopup?.type) parts.push(`二级弹窗:${state.selectPopup.type}`);
  if (state.confirmModal) parts.push('确认弹窗');
  if (state.helpTopic) parts.push(`帮助:${state.helpTopic}`);
  return parts.join(' > ');
}

export function setPanelOpen(open, force = false) {
  if (!open && state.panelOpen && !force) {
    confirmDiscardDirtyModal(() => setPanelOpen(false, true));
    return;
  }
  recordOpStep(open ? '打开总控台面板' : '关闭总控台面板');
  state.panelOpen = !!open;
  if (state.panelOpen) {
    wakeOrb();
    panelEl.classList.add('is-open');
    renderMain();
    renderModal();
    renderPreviewModal();
    renderSelectPopup();
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
    state.snapshotDetailCtx = null;
    state.selectPopup = null;
    state.confirmModal = null;
    state.helpTopic = null;
    state.activeItemDrawerId = null;
    panelEl.classList.remove('is-open');
    renderMain();
    renderModal();
    renderPreviewModal();
    renderSelectPopup();
    renderConfirmModal();
    renderHelpModal();
    renderOrb();
    syncTopBarUI();
  }
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

function handleRootClickCapture(e) {
  if (Date.now() < getSuppressClickUntil() && e.target && !e.target.closest('.td-orb')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function handleRootClick(e) {
  if (Date.now() < getSuppressClickUntil()) { e.preventDefault(); e.stopPropagation(); return; }
  if (e.target === helpLayerEl) {
    state.helpTopic = null;
    renderHelpModal();
    return;
  }
  if (e.target === confirmLayerEl) {
    const cancelFn = state.confirmModal?.onCancel;
    state.confirmModal = null;
    renderConfirmModal();
    if (typeof cancelFn === 'function') cancelFn();
    return;
  }
  const requestClosePreview = () => {
    const doClose = () => {
      if (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit') {
        flushAiEditDraft(previewLayerEl);
        if (!state.previewCtx.loading && state.previewCtx.draftKey && state.aiEditJobs instanceof Map) {
          if (state.previewCtx.step === 'review' || (Array.isArray(state.previewCtx.results) && state.previewCtx.results.length > 0)) {
            state.aiEditJobs.delete(state.previewCtx.draftKey);
          }
        }
      }
      if (state.previewCtx?.returnPreviewCtx) {
        state.previewCtx = state.previewCtx.returnPreviewCtx;
        renderPreservingFocus(previewLayerEl, renderPreviewModal);
        return;
      }
      if (state.previewCtx?.returnPreviewKey) {
        state.previewKey = state.previewCtx.returnPreviewKey;
        state.previewCtx = null;
        renderPreservingFocus(previewLayerEl, renderPreviewModal);
        return;
      }
      const prevType = state.previewCtx?.type;
      discardPendingCustomMergeDraft();
      state.previewKey = null;
      state.previewCtx = null;
      state.snapshotDetailId = null;
      state.snapshotDetailCtx = null;
      renderPreviewModal();
      if ((prevType?.startsWith('merge') || prevType === 'wbMergeCustom')
        && (state.modal?.type === 'presetMerge' || state.modal?.type === 'wbMerge')
        && state.modal.session?.v === 3) {
        updateDualMergeBody(state.modal.session.kind);
      }
    };
    const pc = state.previewCtx;
    const hasAiReview = pc && !pc.loading && (
      ((pc.type === 'pmAiEdit' || pc.type === 'wbAiEdit') && (pc.step === 'review' || (Array.isArray(pc.results) && pc.results.length > 0)))
      || (pc.type === 'mvuAiUpdate' && (pc.step === 'review' || !!pc.replyText))
    );
    if (hasAiReview) {
      openConfirm({
        title: '关闭检视窗口确认',
        message: '当前 AI 生成的检视结果尚未写回，关闭后本次结果将会丢失，确定要关闭吗？',
        confirmText: '确认关闭',
        confirmClass: 'danger',
        onConfirm: doClose,
      });
      return;
    }
    doClose();
  };

  if (e.target === selectLayerEl) {
    if (state.selectPopup?.timer) clearTimeout(state.selectPopup.timer);
    state.selectPopup = null;
    renderSelectPopup();
    return;
  }
  if (e.target === modalLayerEl) {
    confirmDiscardDirtyModal(() => {
      state.modal = null;
      renderModal();
    });
    return;
  }
  if (e.target === previewLayerEl) {
    requestClosePreview();
    return;
  }

  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) {
    const titleEl = e.target.closest('.td-modal-title, .td-dual-pane-title, .td-brand-title');
    if (titleEl && (titleEl.scrollWidth > titleEl.clientWidth || titleEl.scrollHeight > titleEl.clientHeight + 1)) {
      const fullText = (titleEl.getAttribute('data-full-title') || titleEl.getAttribute('title') || titleEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (fullText) notify('info', fullText, { title: '完整标题', forceShow: true, duration: 4500 });
    }
    return;
  }
  const action = actionEl.getAttribute('data-action');
  setDevUiContext(describeCurrentUiLocation());
  const btnLabel = (actionEl.getAttribute('title') || actionEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
  const targetHint = actionEl.getAttribute('data-name')
    || actionEl.getAttribute('data-snap-id')
    || actionEl.getAttribute('data-item-key')
    || actionEl.getAttribute('data-group-id')
    || '';
  recordOpStep(`点击${btnLabel ? `「${btnLabel}」` : ''} [${action}]`, targetHint);

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
  if (action === 'confirm-extra-idx') {
    const idx = Number(actionEl.getAttribute('data-idx'));
    const fn = state.confirmModal?.extraButtons?.[idx]?.onClick;
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
  if (action === 'show-full-title') {
    const fullTitle = (actionEl.getAttribute('data-full-title') || actionEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (fullTitle) notify('info', fullTitle, { title: '完整标题', forceShow: true, duration: 4500 });
    return;
  }

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
  if (action === 'close-modal') {
    confirmDiscardDirtyModal(() => {
      state.modal = null;
      renderModal();
    });
    return;
  }
  if (action === 'close-preview') {
    requestClosePreview();
    return;
  }
  if (action === 'preview-undo') {
    pushEditSnapshot(true);
    if (editHistory.index > 0) {
      editHistory.index--;
      applyPreviewSnapshot(editHistory.stack[editHistory.index]);
      updatePreviewHistoryButtons();
      syncEditorSearchHighlights('td-edit-content', previewLayerEl, false);
      syncEditorSearchHighlights('td-edit-replace-string', previewLayerEl, false);
    }
    return;
  }
  if (action === 'preview-redo') {
    if (editHistory.index < editHistory.stack.length - 1) {
      editHistory.index++;
      applyPreviewSnapshot(editHistory.stack[editHistory.index]);
      updatePreviewHistoryButtons();
      syncEditorSearchHighlights('td-edit-content', previewLayerEl, false);
      syncEditorSearchHighlights('td-edit-replace-string', previewLayerEl, false);
    }
    return;
  }
  if (action.startsWith('es-') && handleEditorSearchClick(e, actionEl, action, actionEl.closest('.td-modal') || previewLayerEl)) {
    return;
  }
  if (action.startsWith('qi-') && handleQuickInsertClick(e, actionEl, action, {
    previewLayerEl: actionEl.closest('.td-modal') || previewLayerEl,
    onAfterInsert: () => {
      if (selectLayerEl && selectLayerEl.contains(actionEl)) {
        UI_MODULES.forEach((mod) => mod?.onSnippetInsert?.(selectLayerEl));
      } else {
        pushEditSnapshot(true);
      }
    },
    openConfirm,
  })) {
    return;
  }

  for (let i = 0; i < UI_MODULES.length; i++) {
    const mod = UI_MODULES[i];
    if (mod && typeof mod.handleClick === 'function' && mod.handleClick(e, actionEl, action)) {
      return;
    }
  }
}

function handleRootInput(e) {
  if (!e.target) return;
  if ((previewLayerEl && previewLayerEl.contains(e.target)) || (selectLayerEl && selectLayerEl.contains(e.target))) {
    const esContainer = e.target.closest('.td-modal') || previewLayerEl;
    if (handleEditorSearchInput(e, esContainer)) return;
    if (previewLayerEl && previewLayerEl.contains(e.target) && (state.previewCtx?.type === 'mergeCustom' || state.previewCtx?.type === 'wbMergeCustom')) {
      scheduleActiveMergeDraftSave(previewLayerEl);
    }
  }

  for (let i = 0; i < UI_MODULES.length; i++) {
    const mod = UI_MODULES[i];
    if (mod && typeof mod.handleInput === 'function' && mod.handleInput(e)) {
      return;
    }
  }

  const id = e.target.id || '';
  if (['td-edit-name', 'td-edit-content', 'td-edit-find-regex', 'td-edit-replace-string', 'td-merge-custom-name', 'td-merge-custom-content', 'td-wbm-custom-name', 'td-wbm-custom-keys'].includes(id)) {
    const isLarge = e.inputType === 'insertFromPaste' || e.inputType === 'deleteByCut';
    if (isLarge) pushEditSnapshot(true);
    else scheduleEditSnapshot();
  }
}

function handleRootChange(e) {
  if (!e.target) return;
  setDevUiContext(describeCurrentUiLocation());
  const ctrlId = e.target.id || e.target.getAttribute('data-action') || e.target.tagName;
  recordOpStep(`修改控件 (${ctrlId})`);
  if (previewLayerEl && previewLayerEl.contains(e.target)
    && (state.previewCtx?.type === 'mergeCustom' || state.previewCtx?.type === 'wbMergeCustom')) {
    scheduleActiveMergeDraftSave(previewLayerEl);
  }

  for (let i = 0; i < UI_MODULES.length; i++) {
    const mod = UI_MODULES[i];
    if (mod && typeof mod.handleChange === 'function' && mod.handleChange(e)) {
      return;
    }
  }
}

function handleRootKeydown(e) {
  const esContainer = e.target?.closest?.('.td-modal') || previewLayerEl;
  if (esContainer && handleEditorSearchKeydown(e, esContainer)) return;
  if (e.key === 'Enter' && !e.isComposing && e.target) {
    if (e.target.id === 'td-sp-color-input') selectLayerEl.querySelector("[data-action='select-popup-apply-color']")?.click();
    else if (e.target.id === 'td-move-idx-input') selectLayerEl.querySelector("[data-action='move-by-number']")?.click();
    else if (e.target.id === 'td-pm-jump-idx') modalLayerEl.querySelector("[data-action='pm-jump-idx']")?.click();
    else if (e.target.id === 'td-wbd-jump-idx') modalLayerEl.querySelector("[data-action='wbd-jump-idx']")?.click();
    else if (e.target.id === 'td-group-name-input') modalLayerEl.querySelector("[data-action='submit-group-form']")?.click();
    else if (e.target.id === 'td-scheme-name-input') modalLayerEl.querySelector("[data-action='submit-scheme-form']")?.click();
    else if (e.target.id === 'td-snap-rename-input') modalLayerEl.querySelector("[data-action='submit-snap-rename']")?.click();
    else if (e.target.id === 'td-snap-name-input') modalLayerEl.querySelector("[data-action='create-snapshot']")?.click();
    else if (e.target.id === 'td-mig-target-idx') {
      selectLayerEl.querySelector("[data-action='confirm-merge-migrate']")?.click();
    }
    else if (e.target.id === 'td-qsnap-name' || e.target.id === 'td-qsnap-note') {
      selectLayerEl.querySelector("[data-action='qsnap-confirm']")?.click();
    }
    else if (e.target.id === 'td-panel-width-input' || e.target.id === 'td-panel-height-input') {
      modalLayerEl.querySelector("[data-action='apply-panel-size']")?.click();
    }
  }
}

function onHostWandClick(e) { if (e.target?.closest?.('#extensionsMenuButton')) setTimeout(syncExtensionButton, 0); }

function onHostBeforeUnload() {
  if (previewLayerEl) {
    flushActiveMergeDraft(previewLayerEl);
    flushAiEditDraft(previewLayerEl);
  }
  flushBackendLogQueue();
}

function onHostVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    if (previewLayerEl) {
      flushActiveMergeDraft(previewLayerEl);
      flushAiEditDraft(previewLayerEl);
    }
    flushBackendLogQueue();
  }
}

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
  helpLayerEl = document.createElement('div'); helpLayerEl.className = 'td-help-layer';
  rootEl.appendChild(orbEl); rootEl.appendChild(panelEl); rootEl.appendChild(modalLayerEl);
  rootEl.appendChild(previewLayerEl); rootEl.appendChild(selectLayerEl); rootEl.appendChild(confirmLayerEl);
  rootEl.appendChild(helpLayerEl);
  document.body.appendChild(rootEl);

  setUiContext({
    getRootEl: () => rootEl,
    getOrbEl: () => orbEl,
    getPanelEl: () => panelEl,
    getPanelMainEl: () => panelMainEl,
    getResizeHandleEl: () => resizeHandleEl,
    getModalLayer: () => modalLayerEl,
    getPreviewLayer: () => previewLayerEl,
    getSelectLayer: () => selectLayerEl,
    getConfirmLayer: () => confirmLayerEl,
    getHelpLayer: () => helpLayerEl,
    getModules: () => UI_MODULES,
    getViewportRect,
    getPanelSize,
    getDefaultPanelSize,
    syncOverlayBounds,
    repositionUI,
    applyOrbVisualState,
    renderOrb,
    renderMain,
    renderMainBodyOnly,
    updateGroupItemsDom,
    syncEntryStatesUI,
    renderModal: () => renderPreservingFocus(modalLayerEl, renderModal),
    renderPreviewModal: () => renderPreservingFocus(previewLayerEl, renderPreviewModal),
    renderSelectPopup,
    renderConfirmModal,
    renderHelpModal,
    syncTopBarUI,
    syncExtensionButton,
    applyThemeAttributes,
    performSwitchPreset,
    setPanelOpen,
  });

  bindDragListeners();
  rootEl.addEventListener('click', handleRootClickCapture, true);
  rootEl.addEventListener('click', handleRootClick);
  rootEl.addEventListener('input', handleRootInput);
  rootEl.addEventListener('change', handleRootChange);
  rootEl.addEventListener('keydown', handleRootKeydown);
  document.addEventListener('click', onHostWandClick, true);
  window.addEventListener('beforeunload', onHostBeforeUnload);
  window.addEventListener('pagehide', onHostBeforeUnload);
  document.addEventListener('visibilitychange', onHostVisibilityChange);
}

export function cleanupDOM() {
  unbindDragListeners();
  if (editHistory.timer) clearTimeout(editHistory.timer);
  document.removeEventListener('click', onHostWandClick, true);
  window.removeEventListener('beforeunload', onHostBeforeUnload);
  window.removeEventListener('pagehide', onHostBeforeUnload);
  document.removeEventListener('visibilitychange', onHostVisibilityChange);
  document.getElementById(EXT_BTN_ID)?.remove();
  document.getElementById(EXT_SETTINGS_ID)?.remove();
  document.getElementById('tavern-deck-top-bar-btn')?.remove();
  document.getElementById(ROOT_ID)?.remove();
  rootEl = orbEl = panelEl = panelMainEl = resizeHandleEl = modalLayerEl = previewLayerEl = selectLayerEl = confirmLayerEl = helpLayerEl = null;
}
