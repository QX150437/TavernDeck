import {
  TYPE_LABELS, escapeHtml, makeItemKey, cloneItemRef,
  hasTH, callTH, notify, copyToClipboard, computeLineDiff, logError,
} from './utils.js';
import {
  state, saveStore, ensureSchemesPool, getBoundSchemeIds, getVisibleSchemes,
  getActiveScheme, getSchemeSources, setPresetBindingsForPreset, removeSchemeSource,
  setActiveSchemeId, findGroupNode,
  createOrUpdateScheme, deleteActiveScheme, createOrUpdateGroup,
  clearGroupContents, deleteGroup, removeEntryFromGroup, setGroupItems,
} from './store.js';
import {
  refreshWorldbookCatalog, refreshAllCatalogs, resolveGroupItemStatus,
  toggleEntryInGroup, toggleMultiGroupAll, saveEditedEntry,
} from './catalog.js';
import { hasUnsavedPresetChanges, saveInUseToPreset, describePresetChanges } from './preset-merge.js';
import { getPresetDetail } from './preset-manager.js';
import { ICONS, uiCtx, openConfirm, readPreviewSnapshot } from './ui-common.js';

const SOURCE_LABELS = { preset: '预设条目', worldbook: '世界书', script: '酒馆脚本', regex: '正则条目' };
const FILTER_LABELS = { all: '全部', enabled: '已启用', disabled: '未启用', selected: '已勾选' };

export function renderGroupItemsListHtml(group) {
  const items = group.items || [];
  const children = group.children || [];
  const dragEnabled = !!state.store.settings.enableDragSort;
  const gQuery = (state.groupSearch[group.id] || '').trim().toLowerCase();
  const isMulti = group.mode === 'multi';

  const collapseEnabled = state.store.settings.collapseEntryActions !== false;
  const collapsedCfg = state.store.settings.collapsedEntryItems || { badge: true, preview: false, remove: true };
  const foldBadge = collapseEnabled && !!collapsedCfg.badge;
  const foldPreview = collapseEnabled && !!collapsedCfg.preview;
  const foldRemove = collapseEnabled && !!collapsedCfg.remove;
  const hasAnyFolded = collapseEnabled && (foldBadge || foldPreview || foldRemove);

  if (items.length === 0 && children.length === 0) {
    return `
      <div class='td-group-empty' data-group-id='${escapeHtml(group.id)}'>
        <span>暂无条目</span>
        <button class='td-btn' data-action='open-picker' data-group-id='${escapeHtml(group.id)}'>${ICONS.plus} 添加条目</button>
        <button class='td-btn' data-action='new-subgroup' data-group-id='${escapeHtml(group.id)}'>${ICONS.folderPlus} 子分组</button>
      </div>`;
  }

  const activeScheme = getActiveScheme();
  const visibleRefs = !gQuery
    ? items
    : items.filter((ref) => {
        const st = resolveGroupItemStatus(ref, activeScheme);
        const entry = st.entry;
        const nameStr = (entry ? entry.name : String(ref.name || ref.id || ref.uid || st.key)).toLowerCase();
        return nameStr.includes(gQuery) || st.key.toLowerCase().includes(gQuery);
      });

  if (items.length > 0 && visibleRefs.length === 0) {
    return `<div class='td-group-empty' data-group-id='${escapeHtml(group.id)}'>未搜到匹配「${escapeHtml(state.groupSearch[group.id])}」的条目</div>`;
  }

  return visibleRefs.map((ref) => {
    const st = resolveGroupItemStatus(ref, activeScheme);
    const k = st.key;
    const entry = st.entry;
    const isOtherPreset = !!st.blockedReason;
    const missing = !entry && !isOtherPreset;
    const unavailable = !entry;
    const name = entry ? entry.name : (isOtherPreset ? (ref.name || ref.id) : `未找到条目 (${ref.name || ref.id || ref.uid || k})`);
    const enabled = entry ? !!entry.enabled : false;
    const typeBadge = isOtherPreset ? st.blockedBadge : (TYPE_LABELS[ref.type] || ref.type);
    const drawerId = `${group.id}::${k}`;
    const drawerOpen = hasAnyFolded && state.activeItemDrawerId === drawerId;
    const disableTitle = isOtherPreset ? st.blockedReason : '';

    const controlBtn = isMulti
      ? `<button type='button' class='td-switch sm ${enabled ? 'on' : ''}' data-action='toggle-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' ${unavailable ? 'disabled' : ''} title='${escapeHtml(disableTitle || '点击开关条目')}'></button>`
      : `<button type='button' class='td-radio-btn' data-action='toggle-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' ${unavailable ? 'disabled' : ''} title='${escapeHtml(disableTitle || '点击切换选中')}'><span class='td-radio-dot ${enabled ? 'on' : ''}'></span></button>`;

    const gripHtml = dragEnabled && !gQuery
      ? `<span class='td-drag-grip' data-drag-type='item' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' data-drag-label='${escapeHtml(name)}' title='按住拖拽移动'>${ICONS.gripDots}</span>`
      : '';

    const inlineOps = [
      (!foldBadge || isOtherPreset) ? `<span class='td-src-badge'>${escapeHtml(typeBadge)}</span>` : '',
      !foldPreview && !unavailable ? `<button class='td-icon-btn' data-action='preview-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' title='预览与编辑'>${ICONS.eye}</button>` : '',
      !foldRemove ? `<button class='td-icon-btn danger' data-action='remove-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' title='从分组移除'>${ICONS.close}</button>` : '',
      controlBtn,
      hasAnyFolded ? `<button class='td-icon-btn ${drawerOpen ? 'is-active' : ''}' data-action='toggle-item-drawer' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' title='更多操作'>${ICONS.more}</button>` : '',
    ].join('');

    const drawerHtml = drawerOpen
      ? `
        <div class='td-item-drawer'>
          ${foldBadge && !isOtherPreset ? `<span class='td-src-badge'>类型: ${escapeHtml(typeBadge)}</span>` : ''}
          ${foldPreview && !unavailable ? `<button class='td-group-menu-btn' style='flex:0 1 auto;' data-action='preview-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}'>${ICONS.eye} 预览与编辑</button>` : ''}
          ${foldRemove ? `<button class='td-group-menu-btn danger' style='flex:0 1 auto;' data-action='remove-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}'>${ICONS.close} 移除</button>` : ''}
        </div>`
      : '';

    return `
      <div class='td-item-wrap' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}'>
        <div class='td-item ${missing ? 'missing' : ''} ${isOtherPreset ? 'is-other-preset' : ''}' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' ${disableTitle ? `title='${escapeHtml(disableTitle)}'` : ''}>
          ${gripHtml}
          <div class='td-item-main'>
            <span class='td-item-name' title='${escapeHtml(name)}'>${escapeHtml(name)}</span>
          </div>
          <div class='td-item-ops'>${inlineOps}</div>
        </div>
        ${drawerHtml}
      </div>`;
  }).join('');
}

export function renderGroupHtml(group, depth) {
  const items = group.items || [];
  const children = group.children || [];
  const dragEnabled = !!state.store.settings.enableDragSort;
  const gQueryRaw = state.groupSearch[group.id] || '';
  const gQuery = gQueryRaw.trim();

  const collapseGrp = state.store.settings.collapseGroupActions !== false;
  const grpCfg = state.store.settings.collapsedGroupItems || { quickToggle: false, add: true, subgroup: true, edit: true, delete: true };
  const foldQuick = collapseGrp && !!grpCfg.quickToggle;
  const foldAdd = collapseGrp && !!grpCfg.add;
  const foldSub = collapseGrp && !!grpCfg.subgroup;
  const foldEdit = collapseGrp && !!grpCfg.edit;
  const foldDel = collapseGrp && !!grpCfg.delete;
  const hasAnyGrpFolded = collapseGrp && (foldQuick || foldAdd || foldSub || foldEdit || foldDel);

  const activeScheme = getActiveScheme();
  let validCount = 0;
  let activeCount = 0;
  items.forEach((ref) => {
    const entry = resolveGroupItemStatus(ref, activeScheme).entry;
    if (entry) { validCount++; if (entry.enabled) activeCount++; }
  });

  const isMulti = group.mode === 'multi';
  const isMemory = isMulti && !!group.meta?.memoryToggle;
  const isExclusive = !!group.meta?.exclusiveChildren;
  const isAllActive = validCount > 0 && activeCount === validCount;
  const isSwitchOn = isMemory ? (validCount > 0 && activeCount > 0) : isAllActive;
  const menuOpen = state.activeGroupMenuId === group.id;
  const isCollapsed = !!group.collapsed && !gQuery;

  const itemsHtml = renderGroupItemsListHtml(group);
  const childrenHtml = children.length > 0
    ? `<div class='td-group-children' data-parent-group-id='${escapeHtml(group.id)}'>${children.map((cg) => renderGroupHtml(cg, depth + 1)).join('')}</div>`
    : '';

  const switchTitle = isMemory
    ? (isSwitchOn ? '记忆开关：点击记住当前并关闭' : '记忆开关：点击恢复上次启用状态')
    : (isAllActive ? '一键全关' : '一键全开');
  const quickSwitch = isMulti
    ? `<button class='td-switch ${isSwitchOn ? 'on' : ''}' data-action='toggle-multi-group' data-group-id='${escapeHtml(group.id)}' title='${switchTitle}'></button>`
    : '';

  const groupInlineActions = [
    !foldQuick ? quickSwitch : '',
    !foldAdd ? `<button class='td-icon-btn accent' data-action='open-picker' data-group-id='${escapeHtml(group.id)}' title='添加条目'>${ICONS.plus}</button>` : '',
    !foldSub ? `<button class='td-icon-btn' data-action='new-subgroup' data-group-id='${escapeHtml(group.id)}' title='子分组'>${ICONS.folderPlus}</button>` : '',
    !foldEdit ? `<button class='td-icon-btn' data-action='edit-group' data-group-id='${escapeHtml(group.id)}' title='编辑分组'>${ICONS.edit}</button>` : '',
    !foldDel ? `<button class='td-icon-btn danger' data-action='delete-group' data-group-id='${escapeHtml(group.id)}' title='删除分组'>${ICONS.trash}</button>` : '',
    `<button class='td-icon-btn ${menuOpen || gQuery ? 'is-active' : ''}' data-action='toggle-group-menu' data-group-id='${escapeHtml(group.id)}' title='${hasAnyGrpFolded ? '搜索与更多操作' : '组内搜索'}'>${ICONS.more}</button>`,
  ].join('');

  const groupGripHtml = dragEnabled
    ? `<span class='td-drag-grip' data-drag-type='group' data-group-id='${escapeHtml(group.id)}' data-drag-label='${escapeHtml(group.name)}' title='按住拖拽排序或嵌套'>${ICONS.gripDots}</span>`
    : '';

  const foldedMenuBtns = [
    foldQuick && isMulti ? `<button class='td-group-menu-btn' data-action='toggle-multi-group' data-group-id='${escapeHtml(group.id)}'>${isSwitchOn ? (isMemory ? '记忆关闭' : '一键全关') : (isMemory ? '记忆恢复' : '一键全开')}</button>` : '',
    foldAdd ? `<button class='td-group-menu-btn' data-action='open-picker' data-group-id='${escapeHtml(group.id)}'>${ICONS.plus} 添加条目</button>` : '',
    foldSub ? `<button class='td-group-menu-btn' data-action='new-subgroup' data-group-id='${escapeHtml(group.id)}'>${ICONS.folderPlus} 子分组</button>` : '',
    foldEdit ? `<button class='td-group-menu-btn' data-action='edit-group' data-group-id='${escapeHtml(group.id)}'>${ICONS.edit} 编辑</button>` : '',
    foldDel ? `<button class='td-group-menu-btn danger' data-action='delete-group' data-group-id='${escapeHtml(group.id)}'>${ICONS.trash} 删除</button>` : '',
  ].filter(Boolean).join('');

  const menuBarHtml = menuOpen
    ? `
      <div class='td-group-menu' data-stop-collapse='1'>
        <div class='td-search-input-wrap'>
          <input class='td-search-input' data-role='group-search-input' data-group-id='${escapeHtml(group.id)}' type='text' placeholder='搜索当前分组条目（不含子分组）...' value='${escapeHtml(gQueryRaw)}' />
          ${gQueryRaw ? `<button type='button' class='td-search-clear' data-action='clear-group-search' data-group-id='${escapeHtml(group.id)}' title='清空'>${ICONS.close}</button>` : ''}
        </div>
        ${foldedMenuBtns ? `<div class='td-group-menu-btns'>${foldedMenuBtns}</div>` : ''}
      </div>`
    : '';

  return `
    <div class='td-group ${depth > 0 ? 'is-nested' : ''} ${isCollapsed ? 'collapsed' : ''}' data-group-id='${escapeHtml(group.id)}'>
      <div class='td-group-sticky-top' style='--td-sticky-z:${20 + Math.min(depth, 6) * 2};'>
        <div class='td-group-head' data-action='toggle-collapse' data-group-id='${escapeHtml(group.id)}'>
          <div class='td-group-left'>
            ${groupGripHtml}
            <span class='td-chevron'>${ICONS.chevron}</span>
            <span class='td-group-name' title='${escapeHtml(group.name)}'>${escapeHtml(group.name)}</span>
            <span class='td-mode-tag ${isMulti ? 'multi' : 'single'}'>${isMulti ? (isMemory ? '多选·记忆' : '多选') : '单选'}</span>
            ${isExclusive ? "<span class='td-mode-tag single'>子组互斥</span>" : ''}
            <span class='td-count-tag'>${activeCount}/${items.length}</span>
          </div>
          <div class='td-group-actions' data-stop-collapse='1'>${groupInlineActions}</div>
        </div>
        ${menuBarHtml}
      </div>
      <div class='td-group-body'>
        ${itemsHtml ? `<div class='td-group-items' data-group-id='${escapeHtml(group.id)}'>${itemsHtml}</div>` : ''}
        ${childrenHtml}
      </div>
    </div>`;
}

export function getPickerSections() {
  const m = state.modal;
  if (!m || m.type !== 'picker') return [];
  const src = m.source || 'preset';
  const q = (m.query || '').trim().toLowerCase();
  const filter = m.filter || 'all';
  const selectedMap = m.selectedMap;

  const matchItem = (item) => {
    if (filter === 'enabled' && !item.enabled) return false;
    if (filter === 'disabled' && item.enabled) return false;
    if (filter === 'selected' && !selectedMap.has(item.key)) return false;
    if (!q) return true;
    const n = (item.name || '').toLowerCase();
    const k = (item.key || '').toLowerCase();
    let extra = '';
    if (item.raw && typeof item.raw.content === 'string') extra = item.raw.content.toLowerCase();
    else if (item.raw && typeof item.raw.find_regex === 'string') extra = item.raw.find_regex.toLowerCase();
    return n.includes(q) || k.includes(q) || extra.includes(q);
  };

  if (src === 'preset') {
    return [{ scopeKey: 'preset-main', title: `当前预设条目 · ${state.presetName}`, items: state.catalog.preset.filter(matchItem) }];
  }
  if (src === 'worldbook') {
    return state.catalog.worldbook.groups.map((g) => ({ scopeKey: g.scopeKey, title: g.title, items: g.items.filter(matchItem) })).filter((g) => g.items.length > 0);
  }
  if (src === 'script') {
    return state.catalog.script.map((g) => ({ scopeKey: g.scopeKey, title: g.title, items: g.items.filter(matchItem) })).filter((g) => g.items.length > 0);
  }
  if (src === 'regex') {
    return state.catalog.regex.map((g) => ({ scopeKey: g.scopeKey, title: g.title, items: g.items.filter(matchItem) })).filter((g) => g.items.length > 0);
  }
  return [];
}

export function updatePickerList() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl || !state.modal || state.modal.type !== 'picker') return;
  const listEl = modalLayerEl.querySelector('.td-picker-list');
  const prevScrollTop = listEl ? listEl.scrollTop : 0;
  const countEl = modalLayerEl.querySelector("[data-role='picker-count']");
  const summaryEl = modalLayerEl.querySelector("[data-role='picker-summary-text']");
  const ctrlBox = modalLayerEl.querySelector('.td-picker-controls');
  const toggleCtrlBtn = modalLayerEl.querySelector("[data-action='toggle-picker-controls']");
  const selectedChipEl = modalLayerEl.querySelector("[data-action='set-picker-filter'][data-filter='selected']");
  const modeBtn = modalLayerEl.querySelector("[data-action='toggle-picker-select-mode']");
  const rangeHintEl = modalLayerEl.querySelector("[data-role='picker-range-hint']");
  const selectedMap = state.modal.selectedMap;
  const src = state.modal.source || 'preset';
  const filter = state.modal.filter || 'all';
  const isRange = state.modal.selectMode === 'range';
  const anchorKey = state.modal.rangeAnchorKey;
  const ctrlOpen = !!state.modal.controlsOpen;

  if (ctrlBox) ctrlBox.classList.toggle('is-open', ctrlOpen);
  if (toggleCtrlBtn) toggleCtrlBtn.classList.toggle('is-active', ctrlOpen);
  if (summaryEl) {
    const qText = (state.modal.query || '').trim();
    summaryEl.textContent = `数据源: ${SOURCE_LABELS[src] || src} · ${FILTER_LABELS[filter] || '全部'}${qText ? ` · 搜"${qText}"` : ''}`;
  }

  modalLayerEl.querySelectorAll("[data-action='set-picker-source']").forEach((tab) => tab.classList.toggle('active', tab.getAttribute('data-source') === src));
  modalLayerEl.querySelectorAll("[data-action='set-picker-filter']").forEach((chip) => chip.classList.toggle('active', chip.getAttribute('data-filter') === filter));
  if (modeBtn) {
    modeBtn.classList.toggle('range-on', isRange);
    modeBtn.textContent = isRange ? '范围选择：开' : '单选点选';
  }
  if (rangeHintEl) {
    rangeHintEl.style.display = isRange ? 'block' : 'none';
    if (isRange) {
      if (anchorKey) {
        const anchorItem = state.catalog.byKey.get(anchorKey);
        rangeHintEl.textContent = `起点「${anchorItem ? anchorItem.name : anchorKey}」· 点击终点将${state.modal.rangeAction ? '批量选中' : '批量取消'}区间（再点起点取消）`;
      } else {
        rangeHintEl.textContent = '范围选择模式：先点击起点条目，再点击终点条目即可批量选区';
      }
    }
  }

  if (listEl) {
    if (src === 'worldbook' && state.loadingWorldbooks) {
      listEl.innerHTML = "<div class='td-group-empty'>正在加载世界书条目...</div>";
    } else {
      const sections = getPickerSections();
      let html = '';
      if (sections.length === 0 || sections.every((s) => s.items.length === 0)) {
        html = "<div class='td-group-empty'>当前数据源下没有匹配的条目</div>";
      } else {
        html = sections.map((sec) => {
          const rows = sec.items.map((item) => {
            const checked = selectedMap.has(item.key) || (!!item.legacyKey && selectedMap.has(item.legacyKey));
            const isAnchor = isRange && anchorKey === item.key;
            const folderSub = item.folder ? `[${item.folder}] ` : '';
            return `
              <div class='td-picker-row ${checked ? 'checked' : ''} ${isAnchor ? 'range-anchor' : ''}' data-item-key='${escapeHtml(item.key)}'>
                <div class='td-picker-left'>
                  <input class='td-checkbox' type='checkbox' data-action='toggle-pick' data-item-key='${escapeHtml(item.key)}' ${checked ? 'checked' : ''} />
                  <span class='td-item-name' title='${escapeHtml(folderSub + item.name)}'>${escapeHtml(folderSub + item.name)}</span>
                  ${isAnchor ? "<span class='td-mode-tag single'>起点</span>" : ''}
                  ${item.enabled ? "<span class='td-mode-tag multi'>启用</span>" : ''}
                </div>
                <button class='td-icon-btn' data-action='preview-entry' data-item-key='${escapeHtml(item.key)}' title='预览与编辑'>${ICONS.eye}</button>
              </div>`;
          }).join('');
          return `
            <div class='td-scope-head'>
              <span>${escapeHtml(sec.title)} (${sec.items.length})</span>
              <button class='td-chip' data-action='picker-select-scope' data-scope-key='${escapeHtml(sec.scopeKey)}'>全选本组</button>
            </div>
            ${rows}`;
        }).join('');
      }
      if (src === 'worldbook' && state.catalog.worldbook.unloadedBooks.length > 0) {
        html += `<div style='padding:10px 4px;text-align:center;'><button class='td-btn' data-action='load-all-worldbooks'>加载其余 ${state.catalog.worldbook.unloadedBooks.length} 本未绑定世界书</button></div>`;
      }
      listEl.innerHTML = html;
      if (prevScrollTop > 0) listEl.scrollTop = prevScrollTop;
    }
  }
  if (countEl) countEl.textContent = `已选 ${selectedMap.size} 项`;
  if (selectedChipEl) selectedChipEl.textContent = `已勾选 (${selectedMap.size})`;
}

export const groupsUiModule = {
  renderModal(m, modalLayerEl) {
    if (m.type === 'schemeForm') {
      const title = m.mode === 'rename' ? '重命名方案' : (m.mode === 'duplicate' ? '复制方案' : '新建方案');
      const curScheme = m.mode === 'rename' ? ensureSchemesPool().find((s) => s.id === m.schemeId) : null;
      const curSources = curScheme ? getSchemeSources(curScheme) : [];
      const tipHtml = m.mode === 'rename'
        ? `<div class='td-field'>
             <label class='td-label'>当前方案来源 (${curSources.length})</label>
             ${curSources.length > 0
               ? `<div class='td-scheme-sources-wrap td-scroll' style='max-height:120px;overflow-y:auto;padding:8px;border-radius:10px;background:var(--td-surface);border:1px solid var(--td-border);'>
                    ${curSources.map((src) => `
                      <span class='td-scheme-src-chip ${src === state.presetName ? 'is-current' : ''}' title='${escapeHtml(src)}'>
                        <span class='td-scheme-src-name'>${escapeHtml(src)}</span>
                        <button type='button' class='td-scheme-src-del' data-action='unbind-scheme-source' data-scheme-id='${escapeHtml(curScheme.id)}' data-source='${escapeHtml(src)}' title='解除源「${escapeHtml(src)}」'>×</button>
                      </span>`).join('')}
                  </div>`
               : `<div style='font-size:12px;color:var(--td-text-muted);line-height:1.5;'>未绑定源（可在各预设下通过 🔗 绑定按钮指定）</div>`}
           </div>`
        : `<div style='font-size:12px;color:var(--td-text-muted);line-height:1.5;'>新方案默认不指定源；如需限定仅作用于特定预设，请在创建后通过 🔗 绑定按钮绑定（支持绑定多个来源预设）。</div>`;
      modalLayerEl.innerHTML = `<div class='td-modal td-modal-sm'><div class='td-modal-head'><div class='td-modal-title'>${title}</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div><div class='td-modal-body'><div class='td-field'><label class='td-label'>方案名称</label><input class='td-input' id='td-scheme-name-input' type='text' placeholder='例如：日常聊天、战斗模式、纯文风...' value='${escapeHtml(m.name || '')}' /></div>${tipHtml}</div><div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='submit-scheme-form'>确定</button></div></div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'bindings') {
      const pool = ensureSchemesPool(), selectedSet = m.selectedIds;
      const rowsHtml = pool.map((s) => {
        const sources = getSchemeSources(s);
        const sourcesHtml = sources.length > 0
          ? `<div class='td-scheme-sources-wrap'>${sources.map((src) => `
              <span class='td-scheme-src-chip ${src === state.presetName ? 'is-current' : ''}' title='${escapeHtml(src)}'>
                <span class='td-scheme-src-name'>${escapeHtml(src)}</span>
                <button type='button' class='td-scheme-src-del' data-action='unbind-scheme-source' data-scheme-id='${escapeHtml(s.id)}' data-source='${escapeHtml(src)}' title='单独解除源「${escapeHtml(src)}」'>×</button>
              </span>`).join('')}</div>`
          : `<span style='font-size:11.5px;color:var(--td-text-dim);'>未指定源</span>`;
        return `
          <div class='td-bind-card ${selectedSet.has(s.id) ? 'checked' : ''}'>
            <div class='td-bind-card-head'>
              <div class='td-picker-left'>
                <input class='td-checkbox' type='checkbox' data-action='toggle-bind-scheme' data-scheme-id='${escapeHtml(s.id)}' ${selectedSet.has(s.id) ? 'checked' : ''} />
                <span class='td-item-name' title='${escapeHtml(s.name)}'>${escapeHtml(s.name)}</span>
              </div>
              <span class='td-count-tag'>${(s.groups || []).length} 组</span>
            </div>
            <div class='td-bind-card-sources'>
              <span class='td-scheme-sources-label'>来源</span>
              ${sourcesHtml}
            </div>
          </div>`;
      }).join('');
      modalLayerEl.innerHTML = `<div class='td-modal'><div class='td-modal-head'><div class='td-modal-title'>预设方案绑定 · ${escapeHtml(state.presetName)}</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='bindings' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div><div class='td-modal-body'><div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>勾选即可将当前预设「${escapeHtml(state.presetName)}」指定为对应方案的源（支持多源共用）；点击各来源标签右侧的 × 可单独解除对应预设的源。若当前预设未绑定任何方案，默认列出全部方案。</div><div class='td-bind-list'>${rowsHtml}</div></div><div class='td-modal-foot'><button class='td-btn' style='margin-right:auto;' data-action='clear-bindings'>全部不选(解绑)</button><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='save-bindings'>保存绑定</button></div></div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'groupForm') {
      const isEdit = !!m.groupId, title = isEdit ? '编辑分组' : (m.parentId ? `新建子分组 · ${m.parentName || ''}` : '新建分组');
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-sm'>
          <div class='td-modal-head'><div class='td-modal-title'>${escapeHtml(title)}</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='groupForm' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div>
          <div class='td-modal-body'>
            <div class='td-field'><label class='td-label'>分组名称</label><input class='td-input' id='td-group-name-input' type='text' placeholder='例如：破限预设、文风切换、功能开关...' value='${escapeHtml(m.name || '')}' /></div>
            <div class='td-field'><label class='td-label'>分组模式</label><div class='td-seg-grid'><button type='button' class='td-seg-card ${m.mode === 'multi' ? 'active' : ''}' data-action='set-modal-mode' data-mode='multi'><div class='td-seg-title'>多选分组</div><div class='td-seg-desc'>条目自由开关，支持一键全开 / 全关</div></button><button type='button' class='td-seg-card single-card ${m.mode === 'single' ? 'active' : ''}' data-action='set-modal-mode' data-mode='single'><div class='td-seg-title'>单选分组</div><div class='td-seg-desc'>组内条目互斥，开启一项自动关闭其余</div></button></div></div>
            <div class='td-field'>
              <label class='td-label'>扩展联动选项</label>
              <div class='td-setting-row' data-role='group-memory-opt-row' style='display:${m.mode === 'multi' ? 'flex' : 'none'};'>
                <div><div class='td-setting-title'>记忆总开关</div><div class='td-setting-desc'>关闭本组时记住已开启的条目，再次开启时按记忆恢复</div></div>
                <button type='button' class='td-switch ${m.memoryToggle ? 'on' : ''}' data-action='toggle-modal-group-opt' data-opt='memoryToggle'></button>
              </div>
              <div class='td-setting-row'>
                <div><div class='td-setting-title'>子分组互斥（套件单选）</div><div class='td-setting-desc'>激活任一子分组或子组内条目时，自动关闭同级其他子分组</div></div>
                <button type='button' class='td-switch ${m.exclusiveChildren ? 'on' : ''}' data-action='toggle-modal-group-opt' data-opt='exclusiveChildren'></button>
              </div>
            </div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='submit-group-form'>${isEdit ? '保存修改' : '创建分组'}</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'picker') {
      const found = findGroupNode(getActiveScheme().groups, m.groupId), group = found ? found.group : null;
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>添加 · ${escapeHtml(group ? group.name : '')}</div>
            <div class='td-modal-head-actions'><button class='td-btn' data-action='toggle-picker-controls'>${ICONS.sliders} 筛选与来源</button><button class='td-icon-btn' data-action='open-help' data-help-key='picker' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-picker-summary'><span data-role='picker-summary-text' style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'></span><button class='td-chip' data-action='toggle-picker-select-mode'>单选点选</button></div>
            <div class='td-picker-controls'>
              <div class='td-source-tabs'><button class='td-source-tab' data-action='set-picker-source' data-source='preset'>预设条目</button><button class='td-source-tab' data-action='set-picker-source' data-source='worldbook'>世界书</button><button class='td-source-tab' data-action='set-picker-source' data-source='script'>酒馆脚本</button><button class='td-source-tab' data-action='set-picker-source' data-source='regex'>正则条目</button></div>
              <input class='td-input' id='td-picker-search' type='text' placeholder='搜索条目名称、ID 或正文关键字...' value='${escapeHtml(m.query || '')}' />
              <div class='td-filter-bar'><button class='td-chip' data-action='set-picker-filter' data-filter='all'>全部</button><button class='td-chip' data-action='set-picker-filter' data-filter='enabled'>已启用</button><button class='td-chip' data-action='set-picker-filter' data-filter='disabled'>未启用</button><button class='td-chip' data-action='set-picker-filter' data-filter='selected'>已勾选 (${m.selectedMap.size})</button><button class='td-chip' data-action='picker-select-visible'>全选当前</button><button class='td-chip' data-action='picker-unselect-visible'>清空当前</button></div>
            </div>
            <div class='td-range-hint' data-role='picker-range-hint' style='display:none;'></div>
            <div class='td-picker-list td-scroll'></div>
          </div>
          <div class='td-modal-foot'><span data-role='picker-count' style='margin-right:auto;font-size:13px;font-weight:600;color:var(--td-text-muted);'>已选 ${m.selectedMap.size} 项</span><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='save-picker'>保存条目</button></div>
        </div>`;
      updatePickerList();
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  handleClick(e, actionEl, action) {
    const panelMainEl = uiCtx.getPanelMainEl();
    const modalLayerEl = uiCtx.getModalLayer();
    const previewLayerEl = uiCtx.getPreviewLayer();
    const groupId = actionEl.getAttribute('data-group-id');
    const itemKey = actionEl.getAttribute('data-item-key');

    if (action === 'toggle-group-menu') {
      e.stopPropagation();
      state.activeGroupMenuId = state.activeGroupMenuId === groupId ? null : groupId;
      uiCtx.renderMainBodyOnly();
      if (state.activeGroupMenuId) {
        const inp = panelMainEl?.querySelector(`input[data-role='group-search-input'][data-group-id='${state.activeGroupMenuId}']`);
        if (inp && state.groupSearch[state.activeGroupMenuId]) inp.focus();
      }
      return true;
    }
    if (action === 'clear-group-search') {
      e.stopPropagation();
      delete state.groupSearch[groupId];
      const inp = panelMainEl?.querySelector(`input[data-role='group-search-input'][data-group-id='${groupId}']`);
      if (inp) { inp.value = ''; inp.focus(); }
      actionEl.remove();
      uiCtx.updateGroupItemsDom(groupId);
      return true;
    }
    if (action === 'toggle-item-drawer') {
      e.stopPropagation();
      const drawerId = `${groupId}::${itemKey}`;
      state.activeItemDrawerId = state.activeItemDrawerId === drawerId ? null : drawerId;
      uiCtx.updateGroupItemsDom(groupId);
      return true;
    }

    if (action === 'open-bindings') { state.modal = { type: 'bindings', selectedIds: new Set(getBoundSchemeIds(state.presetName)) }; uiCtx.renderModal(); return true; }
    if (action === 'unbind-scheme-source') {
      e.stopPropagation();
      const sid = actionEl.getAttribute('data-scheme-id');
      const src = actionEl.getAttribute('data-source');
      if (!sid || !src) return true;
      if (state.modal?.type === 'schemeForm') {
        const inp = modalLayerEl?.querySelector('#td-scheme-name-input');
        if (inp) state.modal.name = inp.value;
      }
      const scheme = ensureSchemesPool().find((s) => s.id === sid);
      if (removeSchemeSource(sid, src)) {
        const curPresetKey = state.presetName || '__default__';
        if (state.modal?.type === 'bindings' && src === curPresetKey) {
          state.modal.selectedIds.delete(sid);
        }
        uiCtx.renderMain();
        if (state.modal?.type === 'bindings' || state.modal?.type === 'schemeForm') {
          uiCtx.renderModal();
        }
        notify('info', `已解除方案「${scheme ? scheme.name : sid}」的源「${src}」`);
      }
      return true;
    }
    if (action === 'toggle-bind-scheme' && state.modal?.type === 'bindings') {
      const sid = actionEl.getAttribute('data-scheme-id'); if (!sid) return true;
      const set = state.modal.selectedIds, willCheck = !set.has(sid);
      if (willCheck) set.add(sid); else set.delete(sid);
      actionEl.checked = willCheck;
      actionEl.closest('.td-bind-card, .td-picker-row')?.classList.toggle('checked', willCheck);
      return true;
    }
    if (action === 'clear-bindings' && state.modal?.type === 'bindings') {
      state.modal.selectedIds.clear();
      modalLayerEl?.querySelectorAll("[data-action='toggle-bind-scheme']").forEach((cb) => {
        cb.checked = false;
        cb.closest('.td-bind-card, .td-picker-row')?.classList.remove('checked');
      });
      return true;
    }
    if (action === 'save-bindings' && state.modal?.type === 'bindings') {
      const pKey = state.presetName || '__default__';
      const arr = setPresetBindingsForPreset(pKey, Array.from(state.modal.selectedIds));
      state.modal = null; uiCtx.renderModal(); uiCtx.renderMain();
      notify('success', arr.length > 0 ? `已将「${pKey}」指定为 ${arr.length} 个方案的源` : `已解除「${pKey}」对应的方案源绑定`);
      return true;
    }
    if (action === 'new-scheme') { state.modal = { type: 'schemeForm', mode: 'create', schemeId: null, name: '' }; uiCtx.renderModal(); return true; }
    if (action === 'rename-scheme') { const s = getActiveScheme(); state.modal = { type: 'schemeForm', mode: 'rename', schemeId: s.id, name: s.name }; uiCtx.renderModal(); return true; }
    if (action === 'duplicate-scheme') { const s = getActiveScheme(); state.modal = { type: 'schemeForm', mode: 'duplicate', duplicateFromId: s.id, name: `${s.name} (副本)` }; uiCtx.renderModal(); return true; }
    if (action === 'delete-scheme') {
      const s = getActiveScheme();
      openConfirm({ title: '删除方案确认', message: `确定要从全局方案池中永久删除方案「${s.name}」及其包含的所有分组配置吗？`, confirmText: '确认删除', onConfirm: () => { deleteActiveScheme(); uiCtx.renderMain(); } });
      return true;
    }
    if (action === 'submit-scheme-form' && state.modal?.type === 'schemeForm') {
      const inp = modalLayerEl?.querySelector('#td-scheme-name-input');
      const name = (inp ? inp.value : state.modal.name || '').trim();
      if (!name) { notify('warning', '请输入方案名称'); if (inp) inp.focus(); return true; }
      const mode = state.modal.mode;
      if (mode === 'rename') createOrUpdateScheme({ id: state.modal.schemeId, name });
      else if (mode === 'duplicate') createOrUpdateScheme({ duplicateFromId: state.modal.duplicateFromId, name });
      else createOrUpdateScheme({ name });
      state.modal = null; uiCtx.renderModal(); uiCtx.renderMain();
      if (mode !== 'rename' && getVisibleSchemes(state.presetName).isBound) {
        notify('info', `已创建无源方案「${name}」，请点击 🔗 绑定按钮将其绑定到当前预设`);
      }
      return true;
    }

    if (action === 'new-group') { state.modal = { type: 'groupForm', groupId: null, parentId: null, name: '', mode: 'multi', memoryToggle: false, exclusiveChildren: false }; uiCtx.renderModal(); return true; }
    if (action === 'new-subgroup') {
      e.stopPropagation(); state.activeGroupMenuId = null;
      const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return true;
      state.modal = { type: 'groupForm', groupId: null, parentId: found.group.id, parentName: found.group.name, name: '', mode: 'multi', memoryToggle: false, exclusiveChildren: false }; uiCtx.renderModal();
      return true;
    }
    if (action === 'edit-group') {
      e.stopPropagation(); state.activeGroupMenuId = null;
      const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return true;
      state.modal = {
        type: 'groupForm',
        groupId: found.group.id,
        parentId: null,
        name: found.group.name,
        mode: found.group.mode,
        memoryToggle: !!found.group.meta?.memoryToggle,
        exclusiveChildren: !!found.group.meta?.exclusiveChildren,
      };
      uiCtx.renderModal();
      return true;
    }
    if (action === 'delete-group') {
      e.stopPropagation(); state.activeGroupMenuId = null;
      const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return true;
      openConfirm({
        title: `管理分组 · ${found.group.name}`, message: '你可以选择仅「清空分组」（保留该分组结构，清空其内部条目和子分组），或「确认删除」该分组。', confirmText: '确认删除',
        extraButton: { text: '清空分组', className: 'warn', onClick: () => { clearGroupContents(groupId); uiCtx.renderMain(); } },
        onConfirm: () => { deleteGroup(groupId); uiCtx.renderMain(); },
      });
      return true;
    }
    if (action === 'toggle-collapse') {
      if (e.target.closest('[data-stop-collapse]') || e.target.closest('.td-drag-grip')) return true;
      const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return true;
      found.group.collapsed = !found.group.collapsed; saveStore(state.store);
      const groupEl = panelMainEl?.querySelector(`.td-group[data-group-id='${groupId}']`);
      if (groupEl) {
        groupEl.classList.toggle('collapsed', found.group.collapsed);
        uiCtx.repositionUI();
      } else uiCtx.renderMainBodyOnly();
      return true;
    }
    if (action === 'toggle-multi-group') { e.stopPropagation(); const task = toggleMultiGroupAll(groupId); uiCtx.syncEntryStatesUI(); task.then(() => uiCtx.syncEntryStatesUI()); return true; }
    if (action === 'open-picker') {
      e.stopPropagation(); state.activeGroupMenuId = null;
      const found = findGroupNode(getActiveScheme().groups, groupId); if (!found) return true;
      const g = found.group, selectedMap = new Map();
      (g.items || []).forEach((it) => { const cloned = cloneItemRef(it); if (cloned) selectedMap.set(cloned.key, cloned); });
      state.modal = { type: 'picker', groupId: g.id, source: 'preset', selectedMap, query: '', filter: 'all', selectMode: 'single', rangeAnchorKey: null, rangeAction: true, controlsOpen: false };
      uiCtx.renderModal(); refreshAllCatalogs().then(() => { if (state.modal?.type === 'picker') updatePickerList(); });
      return true;
    }
    if (action === 'toggle-entry') { e.stopPropagation(); const task = toggleEntryInGroup(groupId, itemKey); uiCtx.syncEntryStatesUI(); task.then(() => uiCtx.syncEntryStatesUI()); return true; }
    if (action === 'remove-entry') {
      const entry = state.catalog.byKey.get(itemKey);
      openConfirm({ title: '移除条目确认', message: `确定要将「${entry ? entry.name : itemKey}」从此分组中移除吗？`, confirmText: '确认移除', onConfirm: () => { removeEntryFromGroup(groupId, itemKey); uiCtx.renderMainBodyOnly(); } });
      return true;
    }
    if (action === 'preview-entry') {
      e.stopPropagation();
      let resolvedKey = itemKey;
      if (!state.catalog.byKey.has(resolvedKey) && groupId) {
        const found = findGroupNode(getActiveScheme().groups, groupId);
        const refInGroup = (found?.group?.items || []).find((it) => (it.key || makeItemKey(it)) === itemKey);
        const st = resolveGroupItemStatus(refInGroup || { key: itemKey }, getActiveScheme());
        if (st.entry) resolvedKey = st.entry.key;
      }
      state.snapshotDetailId = null; state.snapshotDetailCtx = null; state.previewCtx = null; state.previewKey = resolvedKey;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'copy-preview') {
      const contentEl = previewLayerEl?.querySelector('#td-edit-content') || previewLayerEl?.querySelector('#td-edit-replace-string');
      copyToClipboard(contentEl ? contentEl.value : '').then(() => notify('success', '内容已复制到剪贴板')).catch((err) => { logError('复制预览内容失败', err); notify('error', '复制失败'); });
      return true;
    }
    if (action === 'save-preview-edit') {
      const item = state.catalog.byKey.get(state.previewKey); if (!item) return true;
      const targetKey = state.previewKey, snap = readPreviewSnapshot();
      const fields = { name: snap.name || item.name };
      const changeDetails = [];
      if (fields.name !== (item.name || '')) {
        changeDetails.push(`名称:「${item.name || ''}」→「${fields.name}」`);
      }
      if (previewLayerEl?.querySelector('#td-edit-content')) {
        fields.content = snap.content;
        fields.allowContent = typeof item.raw.content === 'string' || snap.content.length > 0;
        const oldC = typeof item.raw.content === 'string' ? item.raw.content : '';
        if (oldC !== snap.content) {
          const diffs = computeLineDiff(oldC, snap.content);
          const addCnt = diffs.filter((d) => d.type === 'add').length;
          const delCnt = diffs.filter((d) => d.type === 'del').length;
          changeDetails.push(`正文修改 (${oldC.length}→${snap.content.length}字, +${addCnt}/-${delCnt}行)`);
        }
      }
      if (previewLayerEl?.querySelector('#td-edit-find-regex')) {
        fields.find_regex = snap.find_regex;
        if ((item.raw.find_regex || '') !== snap.find_regex) {
          changeDetails.push(`查找正则:「${item.raw.find_regex || ''}」→「${snap.find_regex}」`);
        }
      }
      if (previewLayerEl?.querySelector('#td-edit-replace-string')) {
        fields.replace_string = snap.replace_string;
        const oldR = item.raw.replace_string || '';
        if (oldR !== snap.replace_string) {
          changeDetails.push(`替换文本修改 (${oldR.length}→${snap.replace_string.length}字)`);
        }
      }
      openConfirm({
        title: '保存更改确认',
        message: changeDetails.length > 0
          ? `确定要将对「${fields.name || item.name}」的以下修改保存并持久化吗？`
          : `未检测到「${fields.name || item.name}」有内容变动，确定仍要保存吗？`,
        details: changeDetails,
        confirmText: '确认保存',
        confirmClass: 'primary',
        onConfirm: () => saveEditedEntry(targetKey, fields).then((ok) => { if (ok) { uiCtx.renderMain(); uiCtx.renderPreviewModal(); if (state.modal?.type === 'picker') updatePickerList(); } }),
      });
      return true;
    }

    if (action === 'set-modal-mode' && state.modal?.type === 'groupForm') {
      const nextMode = actionEl.getAttribute('data-mode') === 'single' ? 'single' : 'multi';
      state.modal.mode = nextMode;
      modalLayerEl?.querySelectorAll("[data-action='set-modal-mode']").forEach((card) => card.classList.toggle('active', card.getAttribute('data-mode') === nextMode));
      const memRow = modalLayerEl?.querySelector("[data-role='group-memory-opt-row']");
      if (memRow) memRow.style.display = nextMode === 'multi' ? 'flex' : 'none';
      return true;
    }
    if (action === 'toggle-modal-group-opt' && state.modal?.type === 'groupForm') {
      const opt = actionEl.getAttribute('data-opt');
      if (opt === 'memoryToggle' || opt === 'exclusiveChildren') {
        state.modal[opt] = !state.modal[opt];
        actionEl.classList.toggle('on', !!state.modal[opt]);
      }
      return true;
    }
    if (action === 'submit-group-form' && state.modal?.type === 'groupForm') {
      const inp = modalLayerEl?.querySelector('#td-group-name-input');
      const name = (inp ? inp.value : state.modal.name || '').trim();
      if (!name) { notify('warning', '请输入分组名称'); if (inp) inp.focus(); return true; }
      createOrUpdateGroup({
        id: state.modal.groupId,
        parentId: state.modal.parentId,
        name,
        mode: state.modal.mode,
        memoryToggle: !!state.modal.memoryToggle,
        exclusiveChildren: !!state.modal.exclusiveChildren,
      });
      state.modal = null; uiCtx.renderModal(); uiCtx.renderMain();
      return true;
    }

    if (action === 'toggle-picker-controls' && state.modal?.type === 'picker') { state.modal.controlsOpen = !state.modal.controlsOpen; updatePickerList(); return true; }
    if (action === 'toggle-picker-select-mode' && state.modal?.type === 'picker') { state.modal.selectMode = state.modal.selectMode === 'range' ? 'single' : 'range'; state.modal.rangeAnchorKey = null; updatePickerList(); return true; }
    if (action === 'set-picker-source' && state.modal?.type === 'picker') {
      const nextSrc = actionEl.getAttribute('data-source') || 'preset'; state.modal.source = nextSrc; state.modal.rangeAnchorKey = null;
      if (nextSrc === 'worldbook' && state.catalog.worldbook.groups.length === 0) { updatePickerList(); refreshWorldbookCatalog(false).then(() => { if (state.modal?.type === 'picker') updatePickerList(); }); }
      else updatePickerList();
      return true;
    }
    if (action === 'load-all-worldbooks' && state.modal?.type === 'picker') { refreshWorldbookCatalog(true).then(() => { if (state.modal?.type === 'picker') updatePickerList(); }); return true; }
    if (action === 'toggle-pick' && state.modal?.type === 'picker') {
      const m = state.modal, item = state.catalog.byKey.get(itemKey); if (!item) return true;
      const map = m.selectedMap;
      if (m.selectMode === 'range') {
        const visibleKeys = Array.from(modalLayerEl.querySelectorAll('.td-picker-row[data-item-key]')).map((r) => r.getAttribute('data-item-key'));
        if (!m.rangeAnchorKey || !visibleKeys.includes(m.rangeAnchorKey)) {
          const willCheck = !(map.has(itemKey) || (!!item.legacyKey && map.has(item.legacyKey)));
          if (item.legacyKey) map.delete(item.legacyKey);
          if (willCheck) map.set(itemKey, cloneItemRef(item.ref)); else map.delete(itemKey);
          m.rangeAnchorKey = itemKey; m.rangeAction = willCheck; updatePickerList(); return true;
        }
        if (m.rangeAnchorKey === itemKey) { m.rangeAnchorKey = null; updatePickerList(); return true; }
        const idx1 = visibleKeys.indexOf(m.rangeAnchorKey), idx2 = visibleKeys.indexOf(itemKey);
        for (let i = Math.min(idx1, idx2); i <= Math.max(idx1, idx2); i++) {
          const rk = visibleKeys[i], rItem = state.catalog.byKey.get(rk);
          if (rItem?.legacyKey) map.delete(rItem.legacyKey);
          if (m.rangeAction) { if (rItem) map.set(rk, cloneItemRef(rItem.ref)); } else map.delete(rk);
        }
        m.rangeAnchorKey = null; updatePickerList(); return true;
      }
      const willCheck = !(map.has(itemKey) || (!!item.legacyKey && map.has(item.legacyKey)));
      if (item.legacyKey) map.delete(item.legacyKey);
      if (willCheck) map.set(itemKey, cloneItemRef(item.ref)); else map.delete(itemKey);
      actionEl.checked = willCheck;
      actionEl.closest('.td-picker-row')?.classList.toggle('checked', willCheck);
      const countEl = modalLayerEl.querySelector("[data-role='picker-count']"); if (countEl) countEl.textContent = `已选 ${map.size} 项`;
      const selectedChipEl = modalLayerEl.querySelector("[data-action='set-picker-filter'][data-filter='selected']");
      if (selectedChipEl) selectedChipEl.textContent = `已勾选 (${map.size})`;
      if (m.filter === 'selected') updatePickerList();
      return true;
    }
    if (action === 'set-picker-filter' && state.modal?.type === 'picker') { state.modal.filter = actionEl.getAttribute('data-filter'); state.modal.rangeAnchorKey = null; updatePickerList(); return true; }
    if (action === 'picker-select-scope' && state.modal?.type === 'picker') {
      const sec = getPickerSections().find((s) => s.scopeKey === actionEl.getAttribute('data-scope-key'));
      if (sec) {
        sec.items.forEach((it) => {
          if (it.legacyKey) state.modal.selectedMap.delete(it.legacyKey);
          state.modal.selectedMap.set(it.key, cloneItemRef(it.ref));
        });
        state.modal.rangeAnchorKey = null; updatePickerList();
      }
      return true;
    }
    if (action === 'picker-select-visible' && state.modal?.type === 'picker') {
      modalLayerEl.querySelectorAll('.td-picker-row[data-item-key]').forEach((r) => {
        const k = r.getAttribute('data-item-key'), it = state.catalog.byKey.get(k);
        if (it) {
          if (it.legacyKey) state.modal.selectedMap.delete(it.legacyKey);
          state.modal.selectedMap.set(k, cloneItemRef(it.ref));
        }
      });
      state.modal.rangeAnchorKey = null; updatePickerList(); return true;
    }
    if (action === 'picker-unselect-visible' && state.modal?.type === 'picker') {
      modalLayerEl.querySelectorAll('.td-picker-row[data-item-key]').forEach((r) => {
        const k = r.getAttribute('data-item-key'), it = state.catalog.byKey.get(k);
        state.modal.selectedMap.delete(k);
        if (it?.legacyKey) state.modal.selectedMap.delete(it.legacyKey);
      });
      state.modal.rangeAnchorKey = null; updatePickerList(); return true;
    }
    if (action === 'save-picker' && state.modal?.type === 'picker') {
      setGroupItems(state.modal.groupId, state.modal.selectedMap);
      state.modal = null; uiCtx.renderModal(); uiCtx.renderMain();
      notify('success', '分组条目已更新');
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id, role = target.getAttribute('data-role') || '';
    if (role === 'group-search-input') {
      const gid = target.getAttribute('data-group-id'); if (!gid) return true;
      const val = target.value; state.groupSearch[gid] = val;
      const wrap = target.parentElement;
      if (wrap) {
        let clr = wrap.querySelector('.td-search-clear');
        if (val && !clr) {
          clr = document.createElement('button'); clr.type = 'button'; clr.className = 'td-search-clear';
          clr.setAttribute('data-action', 'clear-group-search'); clr.setAttribute('data-group-id', gid);
          clr.title = '清空'; clr.innerHTML = ICONS.close; wrap.appendChild(clr);
        } else if (!val && clr) clr.remove();
      }
      uiCtx.updateGroupItemsDom(gid);
      return true;
    }
    if (id === 'td-group-name-input' && state.modal?.type === 'groupForm') { state.modal.name = target.value; return true; }
    if (id === 'td-scheme-name-input' && state.modal?.type === 'schemeForm') { state.modal.name = target.value; return true; }
    if (id === 'td-picker-search' && state.modal?.type === 'picker') { state.modal.query = target.value; state.modal.rangeAnchorKey = null; updatePickerList(); return true; }
    return false;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id;
    if (id === 'td-preset-select') {
      const nextPreset = target.value; if (!nextPreset || nextPreset === state.presetName) return true;
      const prevName = state.presetName;
      if (hasUnsavedPresetChanges(prevName)) {
        let diffDetails = [];
        try {
          diffDetails = describePresetChanges(getPresetDetail(prevName), getPresetDetail('in_use')).lines;
        } catch (err) {}
        openConfirm({
          title: '检测到未保存的预设修改',
          message: `当前预设「${prevName}」与原预设文件存在以下变动，切换至「${nextPreset}」前是否保存？`,
          details: diffDetails,
          confirmText: '保存并切换', confirmClass: 'primary',
          extraButton: { text: '仅切换', className: 'warn', onClick: () => uiCtx.performSwitchPreset(nextPreset) },
          onCancel: () => { target.value = prevName; },
          onConfirm: () => { saveInUseToPreset(prevName).then(() => uiCtx.performSwitchPreset(nextPreset)).catch((err) => { logError('保存预设修改失败', err); notify('error', `保存失败: ${err.message || err}`); }); },
        });
        return true;
      }
      uiCtx.performSwitchPreset(nextPreset);
      return true;
    }
    if (id === 'td-scheme-select') { setActiveSchemeId(target.value); uiCtx.renderMain(); return true; }
    return false;
  },
};
