import {
  APP_NAME, APP_CN, APP_VERSION, STORAGE_KEY, SCHEMA_VERSION, TYPE_LABELS,
  escapeHtml, formatTime, makeItemKey,
} from './utils.js';
import {
  state, ensureSchemesPool, getBoundSchemeIds, getActiveScheme, findGroupNode,
} from './store.js';
import { computeSnapshotDiff } from './snapshot.js';

export const ICONS = {
  deck: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='3' width='7' height='7' rx='1.5'/><rect x='14' y='3' width='7' height='7' rx='1.5'/><rect x='3' y='14' width='7' height='7' rx='1.5'/><circle cx='17.5' cy='17.5' r='3.5'/></svg>",
  plus: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.3' stroke-linecap='round'><path d='M12 5v14M5 12h14'/></svg>",
  folderPlus: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'/><line x1='12' y1='11' x2='12' y2='17'/><line x1='9' y1='14' x2='15' y2='14'/></svg>",
  link: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'/><path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'/></svg>",
  camera: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'/><circle cx='12' cy='13' r='4'/></svg>",
  check: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>",
  settings: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'/></svg>",
  refresh: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='23 4 23 10 17 10'/><path d='M20.49 15a9 9 0 1 1-2.12-9.36L23 10'/></svg>",
  close: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.3' stroke-linecap='round'><path d='M18 6L6 18M6 6l12 12'/></svg>",
  eye: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/></svg>",
  edit: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'/><path d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'/></svg>",
  trash: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'/><path d='M10 11v6M14 11v6'/></svg>",
  chevron: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>",
  copy: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/></svg>",
  undo: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 7v6h6'/><path d='M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'/></svg>",
  redo: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 7v6h-6'/><path d='M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7'/></svg>",
  sun: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='5'/><line x1='12' y1='1' x2='12' y2='3'/><line x1='12' y1='21' x2='12' y2='23'/><line x1='4.22' y1='4.22' x2='5.64' y2='5.64'/><line x1='18.36' y1='18.36' x2='19.78' y2='19.78'/><line x1='1' y1='12' x2='3' y2='12'/><line x1='21' y1='12' x2='23' y2='12'/><line x1='4.22' y1='19.78' x2='5.64' y2='18.36'/><line x1='18.36' y1='5.64' x2='19.78' y2='4.22'/></svg>",
  moon: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'/></svg>",
  layers: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polygon points='12 2 2 7 12 12 22 7 12 2'/><polyline points='2 17 12 22 22 17'/><polyline points='2 12 12 17 22 12'/></svg>",
  maximize: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='15 3 21 3 21 9'/><polyline points='9 21 3 21 3 15'/><line x1='21' y1='3' x2='14' y2='10'/><line x1='3' y1='21' x2='10' y2='14'/></svg>",
  minimize: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='4 14 10 14 10 20'/><polyline points='20 10 14 10 14 4'/><line x1='14' y1='10' x2='21' y2='3'/><line x1='3' y1='21' x2='10' y2='14'/></svg>",
  grip: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round'><path d='M21 13l-8 8M21 18l-3 3'/></svg>",
  gripDots: "<svg viewBox='0 0 24 24' fill='currentColor'><circle cx='9' cy='6' r='1.7'/><circle cx='15' cy='6' r='1.7'/><circle cx='9' cy='12' r='1.7'/><circle cx='15' cy='12' r='1.7'/><circle cx='9' cy='18' r='1.7'/><circle cx='15' cy='18' r='1.7'/></svg>",
  save: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z'/><polyline points='17 21 17 13 7 13 7 21'/><polyline points='7 3 7 8 15 8'/></svg>",
};

export const editHistory = { stack: [], index: -1, timer: null };

let uiCtx = {
  getModalLayer: () => null,
  getPreviewLayer: () => null,
  getConfirmLayer: () => null,
  syncOverlayBounds: () => {},
};

export function setUiContext(ctx) {
  uiCtx = Object.assign(uiCtx, ctx || {});
}

export function getOrbSize() {
  const sz = Number(state.store.settings.orbSize);
  return Math.max(34, Math.min(72, Number.isNaN(sz) ? 50 : sz));
}

export function renderGroupHtml(group, depth) {
  const items = group.items || [];
  const children = group.children || [];
  const dragEnabled = !!state.store.settings.enableDragSort;
  let validCount = 0;
  let activeCount = 0;

  items.forEach((ref) => {
    const entry = state.catalog.byKey.get(ref.key || makeItemKey(ref));
    if (entry) {
      validCount++;
      if (entry.enabled) activeCount++;
    }
  });

  const isMulti = group.mode === 'multi';
  const isAllActive = validCount > 0 && activeCount === validCount;

  let itemsHtml = '';
  if (items.length === 0 && children.length === 0) {
    itemsHtml = `
      <div class='td-group-empty' data-group-id='${escapeHtml(group.id)}'>
        <span>暂无条目</span>
        <button class='td-btn' data-action='open-picker' data-group-id='${escapeHtml(group.id)}'>${ICONS.plus} 添加条目</button>
        <button class='td-btn' data-action='new-subgroup' data-group-id='${escapeHtml(group.id)}'>${ICONS.folderPlus} 子分组</button>
      </div>`;
  } else if (items.length > 0) {
    itemsHtml = items.map((ref) => {
      const k = ref.key || makeItemKey(ref);
      const entry = state.catalog.byKey.get(k);
      const missing = !entry;
      const name = entry ? entry.name : `未找到条目 (${ref.id || ref.uid || k})`;
      const enabled = entry ? !!entry.enabled : false;
      const typeBadge = TYPE_LABELS[ref.type] || ref.type;
      const indicator = isMulti
        ? `<button class='td-switch sm ${enabled ? 'on' : ''}' ${missing ? 'disabled' : ''} title='开关条目'></button>`
        : `<span class='td-radio-dot ${enabled ? 'on' : ''}'></span>`;
      const gripHtml = dragEnabled
        ? `<span class='td-drag-grip' data-drag-type='item' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' data-drag-label='${escapeHtml(name)}' title='按住拖拽移动'>${ICONS.gripDots}</span>`
        : '';

      return `
        <div class='td-item ${missing ? 'missing' : ''}' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}'>
          ${gripHtml}
          <div class='td-item-main' data-action='toggle-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' title='${escapeHtml(name)}'>
            ${indicator}
            <span class='td-item-name'>${escapeHtml(name)}</span>
            <span class='td-src-badge'>${escapeHtml(typeBadge)}</span>
          </div>
          <div class='td-item-ops'>
            ${!missing ? `<button class='td-icon-btn' data-action='preview-entry' data-item-key='${escapeHtml(k)}' title='预览与编辑'>${ICONS.eye}</button>` : ''}
            <button class='td-icon-btn danger' data-action='remove-entry' data-group-id='${escapeHtml(group.id)}' data-item-key='${escapeHtml(k)}' title='从分组移除'>${ICONS.close}</button>
          </div>
        </div>`;
    }).join('');
  }

  const childrenHtml = children.length > 0
    ? `<div class='td-group-children' data-parent-group-id='${escapeHtml(group.id)}'>${children.map((cg) => renderGroupHtml(cg, depth + 1)).join('')}</div>`
    : '';
  const groupQuickCtrl = isMulti
    ? `<button class='td-switch ${isAllActive ? 'on' : ''}' data-action='toggle-multi-group' data-group-id='${escapeHtml(group.id)}' title='${isAllActive ? '一键全关' : '一键全开'}'></button>`
    : '';
  const groupGripHtml = dragEnabled
    ? `<span class='td-drag-grip' data-drag-type='group' data-group-id='${escapeHtml(group.id)}' data-drag-label='${escapeHtml(group.name)}' title='按住拖拽排序或嵌套'>${ICONS.gripDots}</span>`
    : '';

  return `
    <div class='td-group ${depth > 0 ? 'is-nested' : ''} ${group.collapsed ? 'collapsed' : ''}' data-group-id='${escapeHtml(group.id)}'>
      <div class='td-group-head' data-action='toggle-collapse' data-group-id='${escapeHtml(group.id)}'>
        <div class='td-group-left'>
          ${groupGripHtml}
          <span class='td-chevron'>${ICONS.chevron}</span>
          <span class='td-group-name' title='${escapeHtml(group.name)}'>${escapeHtml(group.name)}</span>
          <span class='td-mode-tag ${isMulti ? 'multi' : 'single'}'>${isMulti ? '多选' : '单选'}</span>
          <span class='td-count-tag'>${activeCount}/${items.length}</span>
        </div>
        <div class='td-group-actions' data-stop-collapse='1'>
          ${groupQuickCtrl}
          <button class='td-icon-btn accent' data-action='open-picker' data-group-id='${escapeHtml(group.id)}' title='批量添加条目'>${ICONS.plus}</button>
          <button class='td-icon-btn' data-action='new-subgroup' data-group-id='${escapeHtml(group.id)}' title='添加子分组'>${ICONS.folderPlus}</button>
          <button class='td-icon-btn' data-action='edit-group' data-group-id='${escapeHtml(group.id)}' title='编辑分组'>${ICONS.edit}</button>
          <button class='td-icon-btn danger' data-action='delete-group' data-group-id='${escapeHtml(group.id)}' title='删除或清空分组'>${ICONS.trash}</button>
        </div>
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
    return state.catalog.worldbook.groups
      .map((g) => ({ scopeKey: g.scopeKey, title: g.title, items: g.items.filter(matchItem) }))
      .filter((g) => g.items.length > 0);
  }
  if (src === 'script') {
    return state.catalog.script
      .map((g) => ({ scopeKey: g.scopeKey, title: g.title, items: g.items.filter(matchItem) }))
      .filter((g) => g.items.length > 0);
  }
  if (src === 'regex') {
    return state.catalog.regex
      .map((g) => ({ scopeKey: g.scopeKey, title: g.title, items: g.items.filter(matchItem) }))
      .filter((g) => g.items.length > 0);
  }
  return [];
}

export function updatePickerList() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl || !state.modal || state.modal.type !== 'picker') return;
  const listEl = modalLayerEl.querySelector('.td-picker-list');
  const prevScrollTop = listEl ? listEl.scrollTop : 0;
  const countEl = modalLayerEl.querySelector("[data-role='picker-count']");
  const selectedChipEl = modalLayerEl.querySelector("[data-action='set-picker-filter'][data-filter='selected']");
  const modeBtn = modalLayerEl.querySelector("[data-action='toggle-picker-select-mode']");
  const rangeHintEl = modalLayerEl.querySelector("[data-role='picker-range-hint']");
  const selectedMap = state.modal.selectedMap;
  const src = state.modal.source || 'preset';
  const isRange = state.modal.selectMode === 'range';
  const anchorKey = state.modal.rangeAnchorKey;

  modalLayerEl.querySelectorAll("[data-action='set-picker-source']").forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-source') === src);
  });
  modalLayerEl.querySelectorAll("[data-action='set-picker-filter']").forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === (state.modal.filter || 'all'));
  });
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

export function updateSnapshotList() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl || !state.modal || state.modal.type !== 'snapshots') return;
  const listEl = modalLayerEl.querySelector("[data-role='snapshot-list']");
  if (!listEl) return;
  const filter = state.modal.filter || 'current';
  const snaps = (state.store.snapshots || [])
    .filter((s) => (filter === 'current' ? s.presetName === state.presetName : true))
    .slice()
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  modalLayerEl.querySelectorAll("[data-action='set-snapshot-filter']").forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === filter);
  });

  if (snaps.length === 0) {
    listEl.innerHTML = `<div class='td-group-empty'>${filter === 'current' ? '当前预设暂无快照，点击上方按钮即可创建' : '暂无任何快照'}</div>`;
    return;
  }

  listEl.innerHTML = snaps.map((s) => {
    const isFull = s.mode === 'full';
    const diffs = computeSnapshotDiff(s);
    const extLen = (s.externalStates || []).length;
    const diffTag = diffs.length === 0
      ? "<span class='td-mode-tag ok'>与当前一致</span>"
      : `<span class='td-mode-tag single'>差异 ${diffs.length} 项</span>`;
    return `
      <div class='td-snap-card'>
        <div class='td-snap-head'>
          <div style='min-width:0;flex:1;'>
            <div class='td-snap-title'>${escapeHtml(s.name)}</div>
            <div class='td-snap-meta'>
              <span class='td-mode-tag ${isFull ? 'single' : 'multi'}'>${isFull ? '完整快照' : '开关快照'}</span>
              ${diffTag}
              <span>预设: ${escapeHtml(s.presetName || '未知')}</span>
              <span>启用 ${s.stats ? s.stats.enabledCount : 0}/${s.stats ? s.stats.totalCount : 0}${extLen > 0 ? ` + 外部${extLen}` : ''}</span>
              <span>${escapeHtml(formatTime(s.updatedAt || s.createdAt))}</span>
            </div>
          </div>
        </div>
        <div class='td-snap-actions'>
          <button class='td-btn primary' data-action='apply-snapshot' data-snap-id='${escapeHtml(s.id)}'>${ICONS.check} 恢复快照</button>
          <button class='td-btn' data-action='view-snapshot' data-snap-id='${escapeHtml(s.id)}'>${ICONS.eye} 差异</button>
          <button class='td-btn' data-action='overwrite-snapshot' data-snap-id='${escapeHtml(s.id)}'>更新</button>
          <button class='td-icon-btn' data-action='rename-snapshot' data-snap-id='${escapeHtml(s.id)}' title='重命名'>${ICONS.edit}</button>
          <button class='td-icon-btn danger' data-action='delete-snapshot' data-snap-id='${escapeHtml(s.id)}' title='删除快照'>${ICONS.trash}</button>
        </div>
      </div>`;
  }).join('');
}

export function renderConfirmModal() {
  const confirmLayerEl = uiCtx.getConfirmLayer();
  if (!confirmLayerEl) return;
  const c = state.confirmModal;
  if (!c) {
    confirmLayerEl.classList.remove('is-open');
    confirmLayerEl.innerHTML = '';
    return;
  }
  confirmLayerEl.classList.add('is-open');
  const extraHtml = c.extraButton
    ? `<button class='td-btn ${escapeHtml(c.extraButton.className || 'warn')}' data-action='confirm-extra'>${escapeHtml(c.extraButton.text)}</button>`
    : '';
  confirmLayerEl.innerHTML = `
    <div class='td-modal td-modal-sm'>
      <div class='td-modal-head'>
        <div class='td-modal-title'>${escapeHtml(c.title || '确认操作')}</div>
        <button class='td-icon-btn' data-action='confirm-cancel'>${ICONS.close}</button>
      </div>
      <div class='td-modal-body'>
        <div style='font-size:14px;color:var(--td-text);line-height:1.6;'>${escapeHtml(c.message || '确定要执行此操作吗？')}</div>
      </div>
      <div class='td-modal-foot'>
        <button class='td-btn' data-action='confirm-cancel'>取消</button>
        ${extraHtml}
        <button class='td-btn ${escapeHtml(c.confirmClass || 'danger')}' data-action='confirm-ok'>${escapeHtml(c.confirmText || '确认')}</button>
      </div>
    </div>`;
  uiCtx.syncOverlayBounds();
}

export function openConfirm(opts) {
  state.confirmModal = opts;
  renderConfirmModal();
}

export function renderModal() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl) return;
  const m = state.modal;
  if (!m || !state.panelOpen) {
    modalLayerEl.classList.remove('is-open');
    modalLayerEl.innerHTML = '';
    return;
  }
  modalLayerEl.classList.add('is-open');

  if (m.type === 'snapshots') {
    const mode = m.createMode || 'state';
    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>预设快照管理</div>
          <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          <div class='td-field' style='padding:11px;border-radius:13px;background:var(--td-surface);border:1px solid var(--td-border-strong);'>
            <label class='td-label'>保存当前状态为新快照（当前预设：${escapeHtml(state.presetName)}）</label>
            <input class='td-input' id='td-snap-name-input' type='text' placeholder='输入快照名称（留空自动生成）' value='${escapeHtml(m.draftName || '')}' />
            <div class='td-seg-grid'>
              <button type='button' class='td-seg-card ${mode === 'state' ? 'active' : ''}' data-action='set-snap-mode' data-mode='state'>
                <div class='td-seg-title'>开关状态快照</div>
                <div class='td-seg-desc'>轻量，记录预设及关联条目的开关，可跨版本应用</div>
              </button>
              <button type='button' class='td-seg-card single-card ${mode === 'full' ? 'active' : ''}' data-action='set-snap-mode' data-mode='full'>
                <div class='td-seg-title'>完整预设快照</div>
                <div class='td-seg-desc'>同时完整备份提示词正文与生成参数</div>
              </button>
            </div>
            <button class='td-btn primary' data-action='create-snapshot' style='width:100%;margin-top:2px;'>${ICONS.camera} 保存为新快照</button>
          </div>
          <div class='td-filter-bar'>
            <button class='td-chip' data-action='set-snapshot-filter' data-filter='current'>当前预设快照</button>
            <button class='td-chip' data-action='set-snapshot-filter' data-filter='all'>全部快照 (${(state.store.snapshots || []).length})</button>
          </div>
          <div data-role='snapshot-list' style='display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;'></div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn primary' data-action='close-modal'>完成</button>
        </div>
      </div>`;
    updateSnapshotList();
    uiCtx.syncOverlayBounds();
    return;
  }

  if (m.type === 'snapshotRename') {
    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>重命名快照</div>
          <button class='td-icon-btn' data-action='back-to-snapshots'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          <div class='td-field'>
            <label class='td-label'>快照名称</label>
            <input class='td-input' id='td-snap-rename-input' type='text' value='${escapeHtml(m.name || '')}' />
          </div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='back-to-snapshots'>取消</button>
          <button class='td-btn primary' data-action='submit-snap-rename'>保存</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (m.type === 'schemeForm') {
    const title = m.mode === 'rename' ? '重命名方案' : (m.mode === 'duplicate' ? '复制方案' : '新建方案');
    const showBindOpt = m.mode !== 'rename';
    const bindChecked = typeof m.bindToCurrent === 'boolean' ? m.bindToCurrent : (getBoundSchemeIds(state.presetName).length > 0);
    m.bindToCurrent = bindChecked;
    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${title}</div>
          <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          <div class='td-field'>
            <label class='td-label'>方案名称</label>
            <input class='td-input' id='td-scheme-name-input' type='text' placeholder='例如：日常聊天、战斗模式、纯文风...' value='${escapeHtml(m.name || '')}' />
          </div>
          ${showBindOpt ? `
            <label class='td-setting-row' style='cursor:pointer;'>
              <div>
                <div class='td-setting-title'>同时绑定到当前预设</div>
                <div class='td-setting-desc'>${escapeHtml(state.presetName)}</div>
              </div>
              <input class='td-checkbox' id='td-scheme-bind-check' type='checkbox' ${bindChecked ? 'checked' : ''} />
            </label>` : ''}
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='close-modal'>取消</button>
          <button class='td-btn primary' data-action='submit-scheme-form'>确定</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (m.type === 'bindings') {
    const pool = ensureSchemesPool();
    const selectedSet = m.selectedIds;
    const rowsHtml = pool.map((s) => {
      const checked = selectedSet.has(s.id);
      return `
        <div class='td-picker-row ${checked ? 'checked' : ''}' data-action='toggle-bind-scheme' data-scheme-id='${escapeHtml(s.id)}'>
          <div class='td-picker-left'>
            <input class='td-checkbox' type='checkbox' ${checked ? 'checked' : ''} tabindex='-1' />
            <span class='td-item-name'>${escapeHtml(s.name)}</span>
          </div>
          <span class='td-count-tag'>${(s.groups || []).length} 个分组</span>
        </div>`;
    }).join('');
    modalLayerEl.innerHTML = `
      <div class='td-modal'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>预设方案绑定 · ${escapeHtml(state.presetName)}</div>
          <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          <div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>勾选要绑定到当前预设的方案（支持多选，同一方案也可被多个预设共用）。若全部不选，则控制台默认列出全部方案。</div>
          <div style='display:flex;flex-direction:column;gap:6px;'>${rowsHtml}</div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' style='margin-right:auto;' data-action='clear-bindings'>全部不选(显示全部)</button>
          <button class='td-btn' data-action='close-modal'>取消</button>
          <button class='td-btn primary' data-action='save-bindings'>保存绑定</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (m.type === 'groupForm') {
    const isEdit = !!m.groupId;
    const title = isEdit ? '编辑分组' : (m.parentId ? `新建子分组 · ${m.parentName || ''}` : '新建分组');
    modalLayerEl.innerHTML = `
      <div class='td-modal'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${escapeHtml(title)}</div>
          <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          <div class='td-field'>
            <label class='td-label'>分组名称</label>
            <input class='td-input' id='td-group-name-input' type='text' placeholder='例如：破限预设、文风切换、功能开关...' value='${escapeHtml(m.name || '')}' />
          </div>
          <div class='td-field'>
            <label class='td-label'>分组模式</label>
            <div class='td-seg-grid'>
              <button type='button' class='td-seg-card ${m.mode === 'multi' ? 'active' : ''}' data-action='set-modal-mode' data-mode='multi'>
                <div class='td-seg-title'>多选分组</div>
                <div class='td-seg-desc'>条目自由开关，支持一键全开 / 全关</div>
              </button>
              <button type='button' class='td-seg-card single-card ${m.mode === 'single' ? 'active' : ''}' data-action='set-modal-mode' data-mode='single'>
                <div class='td-seg-title'>单选分组</div>
                <div class='td-seg-desc'>组内条目互斥，开启一项自动关闭其余</div>
              </button>
            </div>
          </div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='close-modal'>取消</button>
          <button class='td-btn primary' data-action='submit-group-form'>${isEdit ? '保存修改' : '创建分组'}</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (m.type === 'picker') {
    const found = findGroupNode(getActiveScheme().groups, m.groupId);
    const group = found ? found.group : null;
    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>批量添加 · ${escapeHtml(group ? group.name : '')}</div>
          <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body td-picker-body'>
          <div class='td-source-tabs'>
            <button class='td-source-tab' data-action='set-picker-source' data-source='preset'>预设条目</button>
            <button class='td-source-tab' data-action='set-picker-source' data-source='worldbook'>世界书</button>
            <button class='td-source-tab' data-action='set-picker-source' data-source='script'>酒馆脚本</button>
            <button class='td-source-tab' data-action='set-picker-source' data-source='regex'>正则条目</button>
          </div>
          <input class='td-input' id='td-picker-search' type='text' placeholder='搜索条目名称、ID 或正文关键字...' value='${escapeHtml(m.query || '')}' />
          <div class='td-filter-bar'>
            <button class='td-chip' data-action='toggle-picker-select-mode'>单选点选</button>
            <button class='td-chip' data-action='set-picker-filter' data-filter='all'>全部</button>
            <button class='td-chip' data-action='set-picker-filter' data-filter='enabled'>已启用</button>
            <button class='td-chip' data-action='set-picker-filter' data-filter='disabled'>未启用</button>
            <button class='td-chip' data-action='set-picker-filter' data-filter='selected'>已勾选 (${m.selectedMap.size})</button>
            <button class='td-chip' data-action='picker-select-visible'>全选当前</button>
            <button class='td-chip' data-action='picker-unselect-visible'>清空当前</button>
          </div>
          <div class='td-range-hint' data-role='picker-range-hint' style='display:none;'></div>
          <div class='td-picker-list td-scroll'></div>
        </div>
        <div class='td-modal-foot'>
          <span data-role='picker-count' style='margin-right:auto;font-size:13px;font-weight:600;color:var(--td-text-muted);'>已选 ${m.selectedMap.size} 项</span>
          <button class='td-btn' data-action='close-modal'>取消</button>
          <button class='td-btn primary' data-action='save-picker'>保存条目</button>
        </div>
      </div>`;
    updatePickerList();
    uiCtx.syncOverlayBounds();
    return;
  }

  if (m.type === 'settings') {
    const theme = state.store.settings.theme;
    const opacity = state.store.settings.orbOpacity ?? 0.96;
    const orbSize = getOrbSize();
    const showOrb = state.store.settings.showOrb !== false;
    const enableExt = !!state.store.settings.enableExtButton;
    const enableDrag = !!state.store.settings.enableDragSort;
    modalLayerEl.innerHTML = `
      <div class='td-modal'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>设置 · ${APP_NAME} (${APP_CN}) ${APP_VERSION}</div>
          <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          <div class='td-field'>
            <label class='td-label'>外观主题</label>
            <div class='td-seg-grid'>
              <button type='button' class='td-seg-card ${theme === 'light' ? 'active' : ''}' data-action='set-theme' data-theme='light'>
                <div class='td-seg-title'>${ICONS.sun} 白天模式</div>
                <div class='td-seg-desc'>明亮通透的浅色界面</div>
              </button>
              <button type='button' class='td-seg-card ${theme === 'dark' ? 'active' : ''}' data-action='set-theme' data-theme='dark'>
                <div class='td-seg-title'>${ICONS.moon} 黑夜模式</div>
                <div class='td-seg-desc'>护眼沉稳的深色质感</div>
              </button>
            </div>
          </div>
          <div class='td-field'>
            <label class='td-label'>触发入口设置（至少保留一项开启，扩展页始终可打开）</label>
            <div class='td-setting-row'>
              <div>
                <div class='td-setting-title'>悬浮球入口</div>
                <div class='td-setting-desc'>无操作自动缩小变淡，靠边自动贴边收纳</div>
              </div>
              <button type='button' class='td-switch ${showOrb ? 'on' : ''}' data-action='toggle-entry-switch' data-key='showOrb'></button>
            </div>
            <div class='td-setting-row'>
              <div>
                <div class='td-setting-title'>左下角魔法棒拓展按钮</div>
                <div class='td-setting-desc'>在魔法棒菜单中添加「总控台」快捷入口</div>
              </div>
              <button type='button' class='td-switch ${enableExt ? 'on' : ''}' data-action='toggle-entry-switch' data-key='enableExtButton'></button>
            </div>
          </div>
          <div class='td-field'>
            <label class='td-label'>交互设置</label>
            <div class='td-setting-row'>
              <div>
                <div class='td-setting-title'>启用拖拽排序与嵌套</div>
                <div class='td-setting-desc'>开启后显示左侧拖拽手柄，可拖动调序、跨组及嵌套子分组</div>
              </div>
              <button type='button' class='td-switch ${enableDrag ? 'on' : ''}' data-action='toggle-drag-sort'></button>
            </div>
          </div>
          <div class='td-field'>
            <label class='td-label' data-role='orb-size-label'>悬浮球大小 (${orbSize}px)</label>
            <input class='td-range' id='td-size-range' type='range' min='34' max='72' value='${orbSize}' />
          </div>
          <div class='td-field'>
            <label class='td-label' data-role='opacity-label'>悬浮球透明度 (${Math.round(opacity * 100)}%)</label>
            <input class='td-range' id='td-opacity-range' type='range' min='35' max='100' value='${Math.round(opacity * 100)}' />
          </div>
          <div class='td-field'>
            <label class='td-label'>布局与数据维护</label>
            <div style='display:flex;gap:8px;flex-wrap:wrap;'>
              <button class='td-btn' data-action='reset-layout'>重置窗口与悬浮球位置/大小</button>
              <button class='td-btn danger' data-action='clear-all-data'>重置全部方案数据</button>
            </div>
          </div>
          <div style='font-size:12px;color:var(--td-text-dim);padding-top:6px;border-top:1px solid var(--td-border);'>
            当前预设：${escapeHtml(state.presetName)}<br />
            数据持久化：酒馆全局变量 (${STORAGE_KEY} · Schema v${SCHEMA_VERSION})
          </div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn primary' data-action='close-modal'>完成</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
  }
}

export function readPreviewSnapshot() {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl) return null;
  const nameEl = previewLayerEl.querySelector('#td-edit-name');
  const contentEl = previewLayerEl.querySelector('#td-edit-content');
  const findEl = previewLayerEl.querySelector('#td-edit-find-regex');
  const repEl = previewLayerEl.querySelector('#td-edit-replace-string');
  return {
    name: nameEl ? nameEl.value : '',
    content: contentEl ? contentEl.value : '',
    find_regex: findEl ? findEl.value : '',
    replace_string: repEl ? repEl.value : '',
  };
}

export function applyPreviewSnapshot(snap) {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl || !snap) return;
  const nameEl = previewLayerEl.querySelector('#td-edit-name');
  const contentEl = previewLayerEl.querySelector('#td-edit-content');
  const findEl = previewLayerEl.querySelector('#td-edit-find-regex');
  const repEl = previewLayerEl.querySelector('#td-edit-replace-string');
  if (nameEl) nameEl.value = snap.name;
  if (contentEl) contentEl.value = snap.content;
  if (findEl) findEl.value = snap.find_regex;
  if (repEl) repEl.value = snap.replace_string;
}

function snapshotsEqual(a, b) {
  return !!a && !!b && a.name === b.name && a.content === b.content && a.find_regex === b.find_regex && a.replace_string === b.replace_string;
}

export function updatePreviewHistoryButtons() {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl) return;
  const undoBtn = previewLayerEl.querySelector("[data-action='preview-undo']");
  const redoBtn = previewLayerEl.querySelector("[data-action='preview-redo']");
  if (undoBtn) undoBtn.disabled = editHistory.index <= 0;
  if (redoBtn) redoBtn.disabled = editHistory.index >= editHistory.stack.length - 1;
}

export function pushEditSnapshot(force) {
  if (editHistory.timer) {
    clearTimeout(editHistory.timer);
    editHistory.timer = null;
  }
  const snap = readPreviewSnapshot();
  if (!snap || snapshotsEqual(editHistory.stack[editHistory.index], snap)) return;
  if (!force || editHistory.index < editHistory.stack.length - 1) {
    editHistory.stack = editHistory.stack.slice(0, editHistory.index + 1);
  }
  editHistory.stack.push(snap);
  if (editHistory.stack.length > 80) editHistory.stack.shift();
  editHistory.index = editHistory.stack.length - 1;
  updatePreviewHistoryButtons();
}

export function scheduleEditSnapshot() {
  if (editHistory.timer) clearTimeout(editHistory.timer);
  editHistory.timer = setTimeout(() => pushEditSnapshot(false), 320);
}

export function syncPreviewStatusUi() {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl || !state.previewKey) return;
  const item = state.catalog.byKey.get(state.previewKey);
  if (!item) return;
  const statusTag = previewLayerEl.querySelector("[data-role='preview-status-tag']");
  const toggleBtn = previewLayerEl.querySelector("[data-action='toggle-preview-entry']");
  if (statusTag) statusTag.textContent = `状态: ${item.enabled ? '已开启' : '已关闭'}`;
  if (toggleBtn) toggleBtn.textContent = item.enabled ? '关闭条目' : '开启条目';
}

export function renderPreviewModal() {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl) return;
  if (editHistory.timer) {
    clearTimeout(editHistory.timer);
    editHistory.timer = null;
  }
  if (!state.panelOpen) {
    previewLayerEl.classList.remove('is-open');
    previewLayerEl.innerHTML = '';
    editHistory.stack = [];
    editHistory.index = -1;
    return;
  }

  if (state.snapshotDetailId) {
    const snap = (state.store.snapshots || []).find((s) => s.id === state.snapshotDetailId);
    if (!snap) {
      state.snapshotDetailId = null;
      previewLayerEl.classList.remove('is-open');
      previewLayerEl.innerHTML = '';
      return;
    }
    const diffs = computeSnapshotDiff(snap);
    const diffHtml = diffs.length === 0
      ? "<div class='td-group-empty'>该快照的开关状态与当前环境完全一致</div>"
      : diffs.map((d) => `
          <div class='td-diff-row'>
            <span style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;'>${escapeHtml(d.name)}</span>
            <span class='td-mode-tag ${d.to ? 'ok' : 'single'}'>${d.from ? '开' : '关'} → ${d.to ? '开' : '关'}</span>
          </div>`).join('');
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>快照差异对比 · ${escapeHtml(snap.name)}</div>
          <button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          <div class='td-preview-meta'>
            <span class='td-meta-tag'>模式: ${snap.mode === 'full' ? '完整预设快照' : '开关状态快照'}</span>
            <span class='td-meta-tag'>来源预设: ${escapeHtml(snap.presetName)}</span>
            <span class='td-meta-tag'>时间: ${escapeHtml(formatTime(snap.updatedAt || snap.createdAt))}</span>
            <span class='td-meta-tag'>差异: ${diffs.length} 项</span>
          </div>
          <div style='display:flex;flex-direction:column;gap:5px;'>${diffHtml}</div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='close-preview'>关闭</button>
          <button class='td-btn primary' data-action='apply-snapshot-from-detail' data-snap-id='${escapeHtml(snap.id)}'>${ICONS.check} 恢复此快照</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (!state.previewKey) {
    previewLayerEl.classList.remove('is-open');
    previewLayerEl.innerHTML = '';
    editHistory.stack = [];
    editHistory.index = -1;
    return;
  }

  const item = state.catalog.byKey.get(state.previewKey);
  if (!item) {
    state.previewKey = null;
    previewLayerEl.classList.remove('is-open');
    previewLayerEl.innerHTML = '';
    return;
  }

  const ref = item.ref;
  const raw = item.raw || {};
  let metaHtml = `<span class='td-meta-tag'>类型: ${escapeHtml(TYPE_LABELS[ref.type] || ref.type)}</span><span class='td-meta-tag' data-role='preview-status-tag'>状态: ${item.enabled ? '已开启' : '已关闭'}</span>`;
  if (item.scopeTitle) metaHtml += `<span class='td-meta-tag'>作用域: ${escapeHtml(item.scopeTitle)}</span>`;

  let fieldsHtml = `<div class='td-field'><label class='td-label'>条目名称</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(item.name || '')}' /></div>`;
  if (ref.type === 'regex') {
    fieldsHtml += `
      <div class='td-field'><label class='td-label'>查找正则 (Find Regex)</label><input class='td-input' id='td-edit-find-regex' type='text' value='${escapeHtml(raw.find_regex || '')}' /></div>
      <div class='td-field' style='flex:1;display:flex;flex-direction:column;'><label class='td-label'>替换为 (Replace String)</label><textarea class='td-textarea td-scroll' id='td-edit-replace-string' style='flex:1;'>${escapeHtml(raw.replace_string || '')}</textarea></div>`;
  } else {
    const isPlaceholder = ref.type === 'preset' && typeof raw.content !== 'string';
    const contentVal = typeof raw.content === 'string' ? raw.content : '';
    fieldsHtml += `
      <div class='td-field' style='flex:1;display:flex;flex-direction:column;'>
        <label class='td-label'>条目内容 ${isPlaceholder ? '（此条为酒馆内置占位符，一般无正文）' : ''}</label>
        <textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;' ${isPlaceholder ? "placeholder='该条目为内置占位符'" : ''}>${escapeHtml(contentVal)}</textarea>
      </div>`;
  }

  previewLayerEl.classList.add('is-open');
  previewLayerEl.innerHTML = `
    <div class='td-modal td-modal-tall'>
      <div class='td-modal-head'>
        <div class='td-modal-title' title='${escapeHtml(item.name)}'>编辑与预览 · ${escapeHtml(item.name)}</div>
        <div style='display:flex;gap:4px;'>
          <button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button>
          <button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button>
          <button class='td-icon-btn' data-action='copy-preview' title='复制内容'>${ICONS.copy}</button>
          <button class='td-icon-btn' data-action='close-preview' title='关闭'>${ICONS.close}</button>
        </div>
      </div>
      <div class='td-modal-body'><div class='td-preview-meta'>${metaHtml}</div>${fieldsHtml}</div>
      <div class='td-modal-foot'>
        <button class='td-btn' data-action='toggle-preview-entry'>${item.enabled ? '关闭条目' : '开启条目'}</button>
        <button class='td-btn' data-action='close-preview'>取消</button>
        <button class='td-btn primary' data-action='save-preview-edit'>${ICONS.save} 保存更改</button>
      </div>
    </div>`;

  editHistory.stack = [readPreviewSnapshot()];
  editHistory.index = 0;
  updatePreviewHistoryButtons();
  uiCtx.syncOverlayBounds();
}
