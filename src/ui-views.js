
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
              <span
