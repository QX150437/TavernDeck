import {
  TYPE_LABELS, escapeHtml, makeItemKey, cloneItemRef,
  hasTH, callTH, notify, copyToClipboard, logError,
} from './utils.js';
import {
  state, saveStore, ensureSchemesPool, getBoundSchemeIds,
  getActiveScheme, setActiveSchemeId, findGroupNode,
  createOrUpdateScheme, deleteActiveScheme, createOrUpdateGroup,
  clearGroupContents, deleteGroup, removeEntryFromGroup, setGroupItems,
} from './store.js';
import {
  refreshWorldbookCatalog, refreshAllCatalogs,
  toggleEntryInGroup, toggleMultiGroupAll, saveEditedEntry,
} from './catalog.js';
import { hasUnsavedPresetChanges, saveInUseToPreset } from './preset-merge.js';
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

  const visibleRefs = !gQuery
    ? items
    : items.filter((ref) => {
        const k = ref.key || makeItemKey(ref);
        const entry = state.catalog.byKey.get(k);
        const nameStr = (entry ? entry.name : String(ref.id || ref.uid || k)).toLowerCase();
        return nameStr.includes(gQuery) || k.toLowerCase().includes(gQuery);
      });

  if (items.length > 0 && visibleRefs.length === 0) {
    return `<div class='td-group-empty' data-group-id='${escapeHtml(group.id)}'>未搜到匹配「${escapeHtml(state.groupSearch[group.id])}」的条目</div>`;
  }

  return visibleRefs.map((ref) => {
    const k = ref.key || makeItemKey(ref);
    const entry = state.catalog.byKey.get(k);
    const missing = !entry;
    const name = entry ? entry.name : `未找到条目 (${ref.id || ref.uid || k})`;
    const enabled = entry ? !!entry.enabled : false;
    const typeBadge = TYPE_LABELS[ref.type] || ref.type;
    const drawerId = `${group.id}::${k}`;
    const drawerOpen = hasAnyFolded && state.activeItemDrawerId === drawerId;

    const controlBtn = isMulti
      ? `<button type='button' class='td-switch sm ${enabled ? 'on' : ''}' data-action='toggle-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' ${missing ? 'disabled' : ''} title='点击开关条目'></button>`
      : `<button type='button' class='td-radio-btn' data-action='toggle-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' ${missing ? 'disabled' : ''} title='点击切换选中'><span class='td-radio-dot ${enabled ? 'on' : ''}'></span></button>`;

    const gripHtml = dragEnabled && !gQuery
      ? `<span class='td-drag-grip' data-drag-type='item' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' data-drag-label='${escapeHtml(name)}' title='按住拖拽移动'>${ICONS.gripDots}</span>`
      : '';

    const inlineOps = [
      !foldBadge ? `<span class='td-src-badge'>${escapeHtml(typeBadge)}</span>` : '',
      !foldPreview && !missing ? `<button class='td-icon-btn' data-action='preview-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' title='预览与编辑'>${ICONS.eye}</button>` : '',
      !foldRemove ? `<button class='td-icon-btn danger' data-action='remove-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' title='从分组移除'>${ICONS.close}</button>` : '',
      controlBtn,
      hasAnyFolded ? `<button class='td-icon-btn ${drawerOpen ? 'is-active' : ''}' data-action='toggle-item-drawer' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' title='更多操作'>${ICONS.more}</button>` : '',
    ].join('');

    const drawerHtml = drawerOpen
      ? `
        <div class='td-item-drawer'>
          ${foldBadge ? `<span class='td-src-badge'>类型: ${escapeHtml(typeBadge)}</span>` : ''}
          ${foldPreview && !missing ? `<button class='td-group-menu-btn' style='flex:0 1 auto;' data-action='preview-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}'>${ICONS.eye} 预览与编辑</button>` : ''}
          ${foldRemove ? `<button class='td-group-menu-btn danger' style='flex:0 1 auto;' data-action='remove-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}'>${ICONS.close} 移除</button>` : ''}
        </div>`
      : '';

    return `
      <div class='td-item-wrap' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}'>
        <div class='td-item ${missing ? 'missing' : ''}' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}'>
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

  let validCount = 0;
  let activeCount = 0;
  items.forEach((ref) => {
    const entry = state.catalog.byKey.get(ref.key || makeItemKey(ref));
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
            const checked = selectedMap.has(item.key);
            const isAnchor = isRange && anchorKey === item.key;
            const folderSub = item.folder ? `[${item.folder}] ` : '';
            return `
              <div class='td-picker-row ${checked ? 'checked' : ''} ${isAnchor ? 'range-anchor' : ''}' data-action='toggle-pick' data-item-key='${escapeHtml(item.key)}'>
                <div class='td-picker-left'>
                  <input class='td-checkbox' type='checkbox' ${checked ? 'checked' : ''} tabindex='-1' />
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
      const showBindOpt = m.mode !== 'rename';
      const bindChecked = typeof m.bindToCurrent === 'boolean' ? m.bindToCurrent : (getBoundSchemeIds(state.presetName).length > 0);
      m.bindToCurrent = bindChecked;
      modalLayerEl.innerHTML = `<div class='td-modal td-modal-sm'><div class='td-modal-head'><div class='td-modal-title'>${title}</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div><div class='td-modal-body'><div class='td-field'><label class='td-label'>方案名称</label><input class='td-input' id='td-scheme-name-input' type='text' placeholder='例如：日常聊天、战斗模式、纯文风...' value='${escapeHtml(m.name || '')}' /></div>${showBindOpt ? `<label class='td-setting-row' style='cursor:pointer;'><div><div class='td-setting-title'>同时绑定到当前预设</div><div class='td-setting-desc'>${escapeHtml(state.presetName)}</div></div><input class='td-checkbox' id='td-scheme-bind-check' type='checkbox' ${bindChecked ? 'checked' : ''} /></label>` : ''}</div><div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='submit-scheme-form'>确定</button></div></div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'bindings') {
      const pool = ensureSchemesPool(), selectedSet = m.selectedIds;
      const rowsHtml = pool.map((s) => `<div class='td-picker-row ${selectedSet.has(s.id) ? 'checked' : ''}' data-action='toggle-bind-scheme' data-scheme-id='${escapeHtml(s.id)}'><div class='td-picker-left'><input class='td-checkbox' type='checkbox' ${selectedSet.has(s.id) ? 'checked' : ''} tabindex='-1' /><span class='td-item-name'>${escapeHtml(s.name)}</span></div><span class='td-count-tag'>${(s.groups || []).length} 个分组</span></div>`).join('');
      modalLayerEl.innerHTML = `<div class='td-modal'><div class='td-modal-head'><div class='td-modal-title'>预设方案绑定 · ${escapeHtml(state.presetName)}</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div><div class='td-modal-body'><div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>勾选要绑定到当前预设的方案（支持多选，同一方案也可被多个预设共用）。若全部不选，则控制台默认列出全部方案。</div><div style='display:flex;flex-direction:column;gap:6px;'>${rowsHtml}</div></div><div class='td-modal-foot'><button class='td-btn' style='margin-right:auto;' data-action='clear-bindings'>全部不选(显示全部)</button><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='save-bindings'>保存绑定</button></div></div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'groupForm') {
      const isEdit = !!m.groupId, title = isEdit ? '编辑分组' : (m.parentId ? `新建子分组 · ${m.parentName || ''}` : '新建分组');
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-sm'>
          <div class='td-modal-head'><div class='td-modal-title'>${escapeHtml(title)}</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
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
            <div style='display:flex;gap:4px;align-items:center;'><button class='td-btn' data-action='toggle-picker-controls'>${ICONS.sliders} 筛选与来源</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
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
    if (action === 'toggle-bind-scheme' && state.modal?.type === 'bindings') {
      const sid = actionEl.getAttribute('data-scheme-id'); if (!sid) return true;
      const set = state.modal.selectedIds, willCheck = !set.has(sid);
      if (willCheck) set.add(sid); else set.delete(sid);
      actionEl.classList.toggle('checked', willCheck);
      const cb = actionEl.querySelector('.td-checkbox'); if (cb) cb.checked = willCheck;
      return true;
    }
    if (action === 'clear-bindings' && state.modal?.type === 'bindings') {
      state.modal.selectedIds.clear();
      modalLayerEl?.querySelectorAll("[data-action='toggle-bind-scheme']").forEach((row) => {
        row.classList.remove('checked');
        const cb = row.querySelector('.td-checkbox');
        if (cb) cb.checked = false;
      });
      return true;
    }
    if (action === 'save-bindings' && state.modal?.type === 'bindings') {
      const pKey = state.presetName || '__default__', arr = Array.from(state.modal.selectedIds);
      if (arr.length > 0) state.store.presetBindings[pKey] = arr; else delete state.store.presetBindings[pKey];
      saveStore(state.store); state.modal = null; uiCtx.renderModal(); uiCtx.renderMain();
      notify('success', arr.length > 0 ? `已绑定 ${arr.length} 个方案到当前预设` : '已解除绑定，将显示全部方案');
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
      const inp = modalLayerEl?.querySelector('#td-scheme-name-input'), bindCb = modalLayerEl?.querySelector('#td-scheme-bind-check');
      const name = (inp ? inp.value : state.modal.name || '').trim();
      if (!name) { notify('warning', '请输入方案名称'); if (inp) inp.focus(); return true; }
      const bindToCurrent = bindCb ? !!bindCb.checked : !!state.modal.bindToCurrent;
      if (state.modal.mode === 'rename') createOrUpdateScheme({ id: state.modal.schemeId, name });
      else if (state.modal.mode === 'duplicate') createOrUpdateScheme({ duplicateFromId: state.modal.duplicateFromId, name, bindToCurrent });
      else createOrUpdateScheme({ name, bindToCurrent });
      state.modal = null; uiCtx.renderModal(); uiCtx.renderMain();
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
      state.snapshotDetailId = null; state.snapshotDetailCtx = null; state.previewCtx = null; state.previewKey = itemKey;
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
      if (previewLayerEl?.querySelector('#td-edit-content')) { fields.content = snap.content; fields.allowContent = typeof item.raw.content === 'string' || snap.content.length > 0; }
      if (previewLayerEl?.querySelector('#td-edit-find-regex')) fields.find_regex = snap.find_regex;
      if (previewLayerEl?.querySelector('#td-edit-replace-string')) fields.replace_string = snap.replace_string;
      openConfirm({
        title: '保存更改确认', message: `确定要将对「${fields.name || item.name}」的修改保存并持久化吗？`, confirmText: '确认保存', confirmClass: 'primary',
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
      if (e.target.closest("[data-action='preview-entry']")) return true;
      const m = state.modal, item = state.catalog.byKey.get(itemKey); if (!item) return true;
      const map = m.selectedMap;
      if (m.selectMode === 'range') {
        const visibleKeys = Array.from(modalLayerEl.querySelectorAll('.td-picker-row[data-item-key]')).map((r) => r.getAttribute('data-item-key'));
        if (!m.rangeAnchorKey || !visibleKeys.includes(m.rangeAnchorKey)) {
          const willCheck = !map.has(itemKey);
          if (willCheck) map.set(itemKey, cloneItemRef(item.ref)); else map.delete(itemKey);
          m.rangeAnchorKey = itemKey; m.rangeAction = willCheck; updatePickerList(); return true;
        }
        if (m.rangeAnchorKey === itemKey) { m.rangeAnchorKey = null; updatePickerList(); return true; }
        const idx1 = visibleKeys.indexOf(m.rangeAnchorKey), idx2 = visibleKeys.indexOf(itemKey);
        for (let i = Math.min(idx1, idx2); i <= Math.max(idx1, idx2); i++) {
          const rk = visibleKeys[i], rItem = state.catalog.byKey.get(rk);
          if (m.rangeAction) { if (rItem) map.set(rk, cloneItemRef(rItem.ref)); } else map.delete(rk);
        }
        m.rangeAnchorKey = null; updatePickerList(); return true;
      }
      const willCheck = !map.has(itemKey);
      if (willCheck) map.set(itemKey, cloneItemRef(item.ref)); else map.delete(itemKey);
      actionEl.classList.toggle('checked', willCheck);
      const cb = actionEl.querySelector('.td-checkbox'); if (cb) cb.checked = willCheck;
      const countEl = modalLayerEl.querySelector("[data-role='picker-count']"); if (countEl) countEl.textContent = `已选 ${map.size} 项`;
      const selectedChipEl = modalLayerEl.querySelector("[data-action='set-picker-filter'][data-filter='selected']");
      if (selectedChipEl) selectedChipEl.textContent = `已勾选 (${map.size})`;
      if (m.filter === 'selected') updatePickerList();
      return true;
    }
    if (action === 'set-picker-filter' && state.modal?.type === 'picker') { state.modal.filter = actionEl.getAttribute('data-filter'); state.modal.rangeAnchorKey = null; updatePickerList(); return true; }
    if (action === 'picker-select-scope' && state.modal?.type === 'picker') {
      const sec = getPickerSections().find((s) => s.scopeKey === actionEl.getAttribute('data-scope-key'));
      if (sec) { sec.items.forEach((it) => state.modal.selectedMap.set(it.key, cloneItemRef(it.ref))); state.modal.rangeAnchorKey = null; updatePickerList(); }
      return true;
    }
    if (action === 'picker-select-visible' && state.modal?.type === 'picker') {
      modalLayerEl.querySelectorAll('.td-picker-row[data-item-key]').forEach((r) => { const k = r.getAttribute('data-item-key'), it = state.catalog.byKey.get(k); if (it) state.modal.selectedMap.set(k, cloneItemRef(it.ref)); });
      state.modal.rangeAnchorKey = null; updatePickerList(); return true;
    }
    if (action === 'picker-unselect-visible' && state.modal?.type === 'picker') {
      modalLayerEl.querySelectorAll('.td-picker-row[data-item-key]').forEach((r) => state.modal.selectedMap.delete(r.getAttribute('data-item-key')));
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
        openConfirm({
          title: '检测到未保存的预设修改',
          message: `当前预设「${prevName}」的开关或内容与原预设文件不一致，切换至「${nextPreset}」前是否保存？`,
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
    if (id === 'td-scheme-bind-check' && state.modal?.type === 'schemeForm') { state.modal.bindToCurrent = !!target.checked; return true; }
    return false;
  },
};
