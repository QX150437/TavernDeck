import {
  APP_NAME, APP_CN, APP_VERSION, STORAGE_KEY, SCHEMA_VERSION, TYPE_LABELS,
  escapeHtml, formatTime, makeItemKey,
} from './utils.js';
import {
  state, ensureSchemesPool, getBoundSchemeIds, getActiveScheme, findGroupNode,
} from './store.js';
import { computeSnapshotDiff } from './snapshot.js';
import { computeLineDiff, findBestMatchingOldPreset } from './preset-merge.js';
import { getTopBarPositionOptions } from './native-ui.js';
import {
  renderPresetMergeCustomModal,
  syncPresetMergeCustomDraft, syncWbMergeCustomDraft,
} from './merge-ui.js';

export const ICONS = {
  deck: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='3' width='7' height='7' rx='1.5'/><rect x='14' y='3' width='7' height='7' rx='1.5'/><rect x='3' y='14' width='7' height='7' rx='1.5'/><circle cx='17.5' cy='17.5' r='3.5'/></svg>",
  sliders: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><line x1='4' y1='21' x2='4' y2='14'/><line x1='4' y1='10' x2='4' y2='3'/><line x1='12' y1='21' x2='12' y2='12'/><line x1='12' y1='8' x2='12' y2='3'/><line x1='20' y1='21' x2='20' y2='16'/><line x1='20' y1='12' x2='20' y2='3'/><line x1='1' y1='14' x2='7' y2='14'/><line x1='9' y1='8' x2='15' y2='8'/><line x1='17' y1='16' x2='23' y2='16'/></svg>",
  toolbox: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='7' width='18' height='13' rx='2'/><path d='M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><path d='M3 13h18'/></svg>",
  code: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='16 18 22 12 16 6'/><polyline points='8 6 2 12 8 18'/></svg>",
  gitMerge: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='18' cy='18' r='3'/><circle cx='6' cy='6' r='3'/><path d='M6 21V9a9 9 0 0 0 9 9'/></svg>",
  swap: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='17 1 21 5 17 9'/><path d='M3 11V9a4 4 0 0 1 4-4h14'/><polyline points='7 23 3 19 7 15'/><path d='M21 13v2a4 4 0 0 1-4 4H3'/></svg>",
  more: "<svg viewBox='0 0 24 24' fill='currentColor'><circle cx='5' cy='12' r='1.9'/><circle cx='12' cy='12' r='1.9'/><circle cx='19' cy='12' r='1.9'/></svg>",
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
  download: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/></svg>",
  upload: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='17 8 12 3 7 8'/><line x1='12' y1='3' x2='12' y2='15'/></svg>",
  layers: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polygon points='12 2 2 7 12 12 22 7 12 2'/><polyline points='2 17 12 22 22 17'/><polyline points='2 12 12 17 22 12'/></svg>",
  maximize: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='15 3 21 3 21 9'/><polyline points='9 21 3 21 3 15'/><line x1='21' y1='3' x2='14' y2='10'/><line x1='3' y1='21' x2='10' y2='14'/></svg>",
  minimize: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='4 14 10 14 10 20'/><polyline points='20 10 14 10 14 4'/><line x1='14' y1='10' x2='21' y2='3'/><line x1='3' y1='21' x2='10' y2='14'/></svg>",
  grip: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round'><path d='M21 13l-8 8M21 18l-3 3'/></svg>",
  gripDots: "<svg viewBox='0 0 24 24' fill='currentColor'><circle cx='9' cy='6' r='1.7'/><circle cx='15' cy='6' r='1.7'/><circle cx='9' cy='12' r='1.7'/><circle cx='15' cy='12' r='1.7'/><circle cx='9' cy='18' r='1.7'/><circle cx='15' cy='18' r='1.7'/></svg>",
  save: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z'/><polyline points='17 21 17 13 7 13 7 21'/><polyline points='7 3 7 8 15 8'/></svg>",
};

const SOURCE_LABELS = { preset: '预设条目', worldbook: '世界书', script: '酒馆脚本', regex: '正则条目' };
const FILTER_LABELS = { all: '全部', enabled: '已启用', disabled: '未启用', selected: '已勾选' };
const MERGE_FILTER_LABELS = { diff: '仅看差异', conflict: '冲突', added: '新增', removed: '删除', all: '全部' };

export const THEME_OPTIONS = [
  { id: 'dark', name: '暗夜深邃', swatch: '#151821' },
  { id: 'light', name: '极简白天', swatch: '#ffffff' },
  { id: 'parchment', name: '复古羊皮', swatch: '#f4ead2' },
  { id: 'forest', name: '翡翠秘境', swatch: '#10211c' },
  { id: 'cyber', name: '赛博霓虹', swatch: '#191438' },
];

export const ORB_STYLE_OPTIONS = [
  { id: 'indigo', name: '幻紫星云', swatch: 'linear-gradient(135deg,#6366f1,#8b5cf6)' },
  { id: 'amber', name: '鎏金琥珀', swatch: 'linear-gradient(135deg,#d97706,#9a5b25)' },
  { id: 'emerald', name: '翡翠森林', swatch: 'linear-gradient(135deg,#059669,#0d9488)' },
  { id: 'crimson', name: '绯红宝石', swatch: 'linear-gradient(135deg,#ec4899,#be123c)' },
  { id: 'glass', name: '液态玻璃', swatch: 'linear-gradient(135deg,#cbd5e1,#64748b)' },
];

export const TEXT_COLOR_PRESETS = [
  { name: '默认 (跟随主题)', value: '' },
  { name: '琥珀金', value: '#f59e0b' },
  { name: '翡翠绿', value: '#10b981' },
  { name: '天空蓝', value: '#38bdf8' },
  { name: '星云紫', value: '#a78bfa' },
  { name: '樱花粉', value: '#f472b6' },
  { name: '珊瑚红', value: '#f87171' },
  { name: '羊皮褐', value: '#b45309' },
  { name: '象牙白', value: '#f8fafc' },
  { name: '石墨灰', value: '#334155' },
];

export const editHistory = { stack: [], index: -1, timer: null };

let uiCtx = {
  getModalLayer: () => null,
  getPreviewLayer: () => null,
  getSelectLayer: () => null,
  getConfirmLayer: () => null,
  getViewportRect: () => ({ x: 0, y: 0, w: window.innerWidth || 1200, h: window.innerHeight || 800 }),
  getPanelSize: () => ({ w: 420, h: 560 }),
  getDefaultPanelSize: () => ({ w: 420, h: 560 }),
  syncOverlayBounds: () => {},
  renderManagerModal: () => false,
  renderManagerPreview: () => false,
};

export function setUiContext(ctx) {
  uiCtx = Object.assign(uiCtx, ctx || {});
}

export function getOrbSize() {
  const sz = Number(state.store.settings.orbSize);
  return Math.max(34, Math.min(72, Number.isNaN(sz) ? 50 : sz));
}

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
            ${controlBtn}
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
  const isAllActive = validCount > 0 && activeCount === validCount;
  const menuOpen = state.activeGroupMenuId === group.id;
  const isCollapsed = !!group.collapsed && !gQuery;

  const itemsHtml = renderGroupItemsListHtml(group);
  const childrenHtml = children.length > 0
    ? `<div class='td-group-children' data-parent-group-id='${escapeHtml(group.id)}'>${children.map((cg) => renderGroupHtml(cg, depth + 1)).join('')}</div>`
    : '';

  const quickSwitch = isMulti
    ? `<button class='td-switch ${isAllActive ? 'on' : ''}' data-action='toggle-multi-group' data-group-id='${escapeHtml(group.id)}' title='${isAllActive ? '一键全关' : '一键全开'}'></button>`
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
    foldQuick && isMulti ? `<button class='td-group-menu-btn' data-action='toggle-multi-group' data-group-id='${escapeHtml(group.id)}'>${isAllActive ? '一键全关' : '一键全开'}</button>` : '',
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
            <span class='td-mode-tag ${isMulti ? 'multi' : 'single'}'>${isMulti ? '多选' : '单选'}</span>
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

  modalLayerEl.querySelectorAll("[data-action='set-snapshot-filter']").forEach((chip) => chip.classList.toggle('active', chip.getAttribute('data-filter') === filter));

  if (snaps.length === 0) {
    listEl.innerHTML = `<div class='td-group-empty'>${filter === 'current' ? '当前预设暂无快照，点击上方按钮即可创建' : '暂无任何快照'}</div>`;
    return;
  }

  listEl.innerHTML = snaps.map((s) => {
    const isFull = s.mode === 'full';
    const diffs = computeSnapshotDiff(s);
    const extLen = (s.externalStates || []).length;
    const diffTag = diffs.length === 0 ? "<span class='td-mode-tag ok'>与当前一致</span>" : `<span class='td-mode-tag single'>差异 ${diffs.length} 项</span>`;
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

export function updatePresetMergeBody() {
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
    return (it.name || '').toLowerCase().includes(q)
      || (it.oldPrompt?.content || '').toLowerCase().includes(q)
      || (it.newPrompt?.content || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    box.innerHTML = "<div class='td-group-empty'>当前筛选条件下没有条目</div>";
    return;
  }

  const prevScroll = box.scrollTop;
  box.innerHTML = filtered.map((it) => {
    const tag = it.status === 'conflict'
      ? "<span class='td-mode-tag single'>冲突差异</span>"
      : (it.status === 'added'
        ? "<span class='td-mode-tag ok'>新版新增</span>"
        : (it.status === 'removed' ? "<span class='td-mode-tag del'>新版删除</span>" : "<span class='td-mode-tag multi'>一致</span>"));

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

      const actionsHtml = it.status === 'same' ? '' : `
        <div class='td-merge-actions'>
          ${it.oldPrompt ? `<button type='button' class='td-merge-choice ${it.choice === 'old' ? 'active-old' : ''}' data-action='set-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='old'>保留旧版 (Current)</button>` : ''}
          <button type='button' class='td-merge-choice ${it.choice === 'new' ? 'active-new' : ''}' data-action='set-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='new'>${it.status === 'removed' ? '确认删除 (新版)' : '采用新版 (Incoming)'}</button>
          <button type='button' class='td-merge-choice ${it.choice === 'custom' ? 'active-custom' : ''}' data-action='open-merge-custom' data-entry-key='${escapeHtml(it.key)}'>编辑缝合</button>
          <button type='button' class='td-merge-choice' data-action='open-merge-custom-content-only' data-entry-key='${escapeHtml(it.key)}'>只缝合内容</button>
        </div>`;

      bodyHtml = `<div class='td-merge-body'><div style='font-size:11.5px;color:var(--td-text-muted);'>差异原因：${escapeHtml(it.diffReasons.join(' · ') || '无差异')}</div>${actionsHtml}${diffHtml}</div>`;
    }

    return `<div class='td-merge-card'><div class='td-merge-head' data-action='toggle-merge-expand' data-entry-key='${escapeHtml(it.key)}'>${tag}<span class='td-merge-title' title='${escapeHtml(it.name)}'>${escapeHtml(it.name)}</span>${choiceTag}</div>${bodyHtml}</div>`;
  }).join('');
  if (prevScroll > 0) box.scrollTop = prevScroll;
}

export function renderConfirmModal() {
  const confirmLayerEl = uiCtx.getConfirmLayer();
  if (!confirmLayerEl) return;
  const c = state.confirmModal;
  if (!c) { confirmLayerEl.classList.remove('is-open'); confirmLayerEl.innerHTML = ''; return; }
  confirmLayerEl.classList.add('is-open');
  const extraHtml = c.extraButton
    ? `<button class='td-btn ${escapeHtml(c.extraButton.className || 'warn')}' data-action='confirm-extra'>${escapeHtml(c.extraButton.text)}</button>`
    : '';
  confirmLayerEl.innerHTML = `
    <div class='td-modal td-modal-sm'>
      <div class='td-modal-head'><div class='td-modal-title'>${escapeHtml(c.title || '确认操作')}</div><button class='td-icon-btn' data-action='confirm-cancel'>${ICONS.close}</button></div>
      <div class='td-modal-body'><div style='font-size:14px;color:var(--td-text);line-height:1.6;'>${escapeHtml(c.message || '确定要执行此操作吗？')}</div></div>
      <div class='td-modal-foot'><button class='td-btn' data-action='confirm-cancel'>取消</button>${extraHtml}<button class='td-btn ${escapeHtml(c.confirmClass || 'danger')}' data-action='confirm-ok'>${escapeHtml(c.confirmText || '确认')}</button></div>
    </div>`;
  uiCtx.syncOverlayBounds();
}

export function openConfirm(opts) { state.confirmModal = opts; renderConfirmModal(); }

export function renderModal() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl) return;
  const m = state.modal;
  if (!m || !state.panelOpen) { modalLayerEl.classList.remove('is-open'); modalLayerEl.innerHTML = ''; return; }
  modalLayerEl.classList.add('is-open');

  const prevScroll = m.type === 'settings'
    ? (modalLayerEl.querySelector('.td-modal-body')?.scrollTop || 0)
    : 0;

  if (uiCtx.renderManagerModal(m)) return;

  if (m.type === 'presetMergeSelect') {
    const list = state.presetNames.filter((n) => n && n !== 'in_use');
    if (state.presetName && state.presetName !== 'in_use' && !list.includes(state.presetName)) list.unshift(state.presetName);
    const newVal = (m.newName && list.includes(m.newName)) ? m.newName : (state.presetName && state.presetName !== 'in_use' ? state.presetName : (list[0] || ''));
    const oldVal = (m.oldName && list.includes(m.oldName)) ? m.oldName : findBestMatchingOldPreset(newVal, list);
    m.oldName = oldVal; m.newName = newVal;
    const optsHtml = (sel) => list.map((n) => `<option value='${escapeHtml(n)}' ${n === sel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
    modalLayerEl.innerHTML = `
      <div class='td-modal'>
        <div class='td-modal-head'><div class='td-modal-title'>${ICONS.gitMerge} 预设版本对比与缝合</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          <div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>默认将「当前预设」设为新版预设，并自动模糊匹配最相近的旧版预设（也可手动更改或一键交换）。</div>
          <div class='td-field'><label class='td-label'>旧版本预设（Current · 修改来源）</label><select class='td-select' id='td-merge-old-select'>${optsHtml(oldVal)}</select></div>
          <div style='display:flex;justify-content:center;'><button type='button' class='td-btn sm' data-action='swap-merge-presets'>${ICONS.swap} 交换旧版 / 新版</button></div>
          <div class='td-field'><label class='td-label'>新版本预设（Incoming · 导入的目标新版）</label><select class='td-select' id='td-merge-new-select'>${optsHtml(newVal)}</select></div>
        </div>
        <div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='start-preset-merge'>开始对比与缝合</button></div>
      </div>`;
    uiCtx.syncOverlayBounds(); return;
  }

  if (m.type === 'presetMerge') {
    const s = m.session;
    const titleStr = `${s.oldName} ⇄ ${s.newName}`;
    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title td-title-clickable' data-action='show-full-title' data-full-title='${escapeHtml(titleStr)}' title='点击查看完整标题'>${escapeHtml(titleStr)}</div>
          <div style='display:flex;gap:4px;align-items:center;'><button class='td-btn sm' data-action='toggle-merge-controls'>${ICONS.sliders} 筛选与批量</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        </div>
        <div class='td-modal-body td-picker-body'>
          <div class='td-picker-summary'><span data-role='merge-summary-text' style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'></span></div>
          <div class='td-picker-controls'>
            <div class='td-filter-bar'>
              <button class='td-chip' data-action='set-merge-filter' data-filter='diff'>差异 (${s.stats.conflict + s.stats.added + s.stats.removed})</button>
              <button class='td-chip' data-action='set-merge-filter' data-filter='conflict'>冲突 (${s.stats.conflict})</button>
              <button class='td-chip' data-action='set-merge-filter' data-filter='added'>新增 (${s.stats.added})</button>
              <button class='td-chip' data-action='set-merge-filter' data-filter='removed'>删除 (${s.stats.removed})</button>
              <button class='td-chip' data-action='set-merge-filter' data-filter='all'>全部 (${s.entries.length})</button>
            </div>
            <div class='td-filter-bar'><button class='td-btn sm' data-action='merge-batch-states'>仅迁移旧版开关</button><button class='td-btn sm' data-action='merge-batch-old'>全选保留旧版</button><button class='td-btn sm' data-action='merge-batch-new'>全选采用新版</button></div>
            <input class='td-input' id='td-merge-search' type='text' placeholder='搜索差异条目名称或内容...' value='${escapeHtml(s.query || '')}' />
          </div>
          <div class='td-picker-list td-scroll' data-role='merge-list'></div>
        </div>
        <div class='td-modal-foot'><label style='margin-right:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;'><input type='checkbox' class='td-checkbox' id='td-merge-settings-cb' ${s.migrateSettings ? 'checked' : ''} /><span>迁移旧版参数</span></label><button class='td-btn' data-action='merge-save-as'>另存为新预设</button><button class='td-btn primary' data-action='merge-apply-target'>覆盖新版预设</button></div>
      </div>`;
    updatePresetMergeBody(); uiCtx.syncOverlayBounds(); return;
  }

  if (m.type === 'ioCenter') {
    const pool = ensureSchemesPool(), snaps = state.store.snapshots || [];
    const schemeChecks = pool.map((s) => `<button type='button' class='td-check-pill ${m.selectedSchemeIds.has(s.id) ? 'on' : ''}' data-action='toggle-io-scheme' data-scheme-id='${escapeHtml(s.id)}'>${escapeHtml(s.name)}</button>`).join('');
    const imp = m.importPreview;
    const importBoxHtml = imp ? `
      <div class='td-field' style='padding:10px;border-radius:11px;background:var(--td-surface);border:1px solid var(--td-accent);'>
        <div style='font-size:13px;font-weight:700;'>解析成功：${Array.isArray(imp.schemes) ? imp.schemes.length : 0} 个方案 · ${Array.isArray(imp.snapshots) ? imp.snapshots.length : 0} 个快照 · ${imp.settings ? '含外观设置' : '不含设置'}</div>
        <div class='td-check-pills'>
          ${Array.isArray(imp.schemes) ? `<button type='button' class='td-check-pill ${m.impSchemes ? 'on' : ''}' data-action='toggle-io-imp-opt' data-key='impSchemes'>导入方案</button>` : ''}
          ${Array.isArray(imp.snapshots) ? `<button type='button' class='td-check-pill ${m.impSnapshots ? 'on' : ''}' data-action='toggle-io-imp-opt' data-key='impSnapshots'>导入快照</button>` : ''}
          ${imp.settings ? `<button type='button' class='td-check-pill ${m.impSettings ? 'on' : ''}' data-action='toggle-io-imp-opt' data-key='impSettings'>导入设置</button>` : ''}
        </div>
        <div class='td-seg-grid'>
          <button type='button' class='td-seg-card ${m.impMode === 'merge' ? 'active' : ''}' data-action='set-io-imp-mode' data-mode='merge'><div class='td-seg-title'>合并导入</div><div class='td-seg-desc'>保留现有数据并追加</div></button>
          <button type='button' class='td-seg-card single-card ${m.impMode === 'overwrite' ? 'active' : ''}' data-action='set-io-imp-mode' data-mode='overwrite'><div class='td-seg-title'>覆盖导入</div><div class='td-seg-desc'>替换所选分类旧数据</div></button>
        </div>
        <button type='button' class='td-btn primary' data-action='confirm-io-import'>执行导入</button>
      </div>` : '';

    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'><div class='td-modal-title'>导入与导出中心</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          <div class='td-field' style='padding:11px;border-radius:12px;background:var(--td-surface);border:1px solid var(--td-border-strong);'>
            <label class='td-label'>导出备份（全部或局部勾选）</label>
            <div style='display:flex;gap:8px;flex-wrap:wrap;'><button type='button' class='td-btn primary' data-action='export-all-json'>${ICONS.download} 导出全部数据 (.json)</button></div>
            <span class='td-label' style='margin-top:4px;'>局部导出勾选方案：</span>
            <div class='td-check-pills'>${schemeChecks}</div>
            <div class='td-check-pills'><button type='button' class='td-check-pill ${m.expSnapshots ? 'on' : ''}' data-action='toggle-io-exp-opt' data-key='expSnapshots'>包含快照 (${snaps.length})</button><button type='button' class='td-check-pill ${m.expSettings ? 'on' : ''}' data-action='toggle-io-exp-opt' data-key='expSettings'>包含外观与习惯设置</button></div>
            <button type='button' class='td-btn' data-action='export-partial-json'>${ICONS.download} 导出所选局部数据</button>
          </div>
          <div class='td-field' style='padding:11px;border-radius:12px;background:var(--td-surface);border:1px solid var(--td-border-strong);'>
            <label class='td-label'>从文件或 JSON 文本导入</label>
            <div style='display:flex;gap:8px;flex-wrap:wrap;'><button type='button' class='td-btn' data-action='trigger-io-file'>${ICONS.upload} 选择 JSON 文件</button><input type='file' id='td-io-file-input' accept='.json,application/json' style='display:none;' /><button type='button' class='td-btn' data-action='parse-io-text'>解析下方粘贴文本</button></div>
            <textarea class='td-textarea' id='td-io-text-input' style='min-height:90px;' placeholder='也可以直接粘贴备份 JSON 文本后点击「解析」...'>${escapeHtml(m.rawText || '')}</textarea>
          </div>
          ${importBoxHtml}
        </div>
        <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>完成</button></div>
      </div>`;
    uiCtx.syncOverlayBounds(); return;
  }

  if (m.type === 'snapshots') {
    const mode = m.createMode || 'state';
    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'><div class='td-modal-title'>预设快照管理</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          <div class='td-field' style='padding:11px;border-radius:13px;background:var(--td-surface);border:1px solid var(--td-border-strong);'>
            <label class='td-label'>保存当前状态为新快照（当前预设：${escapeHtml(state.presetName)}）</label>
            <input class='td-input' id='td-snap-name-input' type='text' placeholder='输入快照名称（留空自动生成）' value='${escapeHtml(m.draftName || '')}' />
            <div class='td-seg-grid'><button type='button' class='td-seg-card ${mode === 'state' ? 'active' : ''}' data-action='set-snap-mode' data-mode='state'><div class='td-seg-title'>开关状态快照</div><div class='td-seg-desc'>轻量，记录预设及关联条目的开关，可跨版本应用</div></button><button type='button' class='td-seg-card single-card ${mode === 'full' ? 'active' : ''}' data-action='set-snap-mode' data-mode='full'><div class='td-seg-title'>完整预设快照</div><div class='td-seg-desc'>同时完整备份提示词正文与生成参数</div></button></div>
            <button class='td-btn primary' data-action='create-snapshot' style='width:100%;margin-top:2px;'>${ICONS.camera} 保存为新快照</button>
          </div>
          <div class='td-filter-bar'><button class='td-chip' data-action='set-snapshot-filter' data-filter='current'>当前预设快照</button><button class='td-chip' data-action='set-snapshot-filter' data-filter='all'>全部快照 (${(state.store.snapshots || []).length})</button></div>
          <div data-role='snapshot-list' style='display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;'></div>
        </div>
        <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>完成</button></div>
      </div>`;
    updateSnapshotList(); uiCtx.syncOverlayBounds(); return;
  }

  if (m.type === 'snapshotRename') {
    modalLayerEl.innerHTML = `<div class='td-modal td-modal-sm'><div class='td-modal-head'><div class='td-modal-title'>重命名快照</div><button class='td-icon-btn' data-action='back-to-snapshots'>${ICONS.close}</button></div><div class='td-modal-body'><div class='td-field'><label class='td-label'>快照名称</label><input class='td-input' id='td-snap-rename-input' type='text' value='${escapeHtml(m.name || '')}' /></div></div><div class='td-modal-foot'><button class='td-btn' data-action='back-to-snapshots'>取消</button><button class='td-btn primary' data-action='submit-snap-rename'>保存</button></div></div>`;
    uiCtx.syncOverlayBounds(); return;
  }

  if (m.type === 'schemeForm') {
    const title = m.mode === 'rename' ? '重命名方案' : (m.mode === 'duplicate' ? '复制方案' : '新建方案');
    const showBindOpt = m.mode !== 'rename';
    const bindChecked = typeof m.bindToCurrent === 'boolean' ? m.bindToCurrent : (getBoundSchemeIds(state.presetName).length > 0);
    m.bindToCurrent = bindChecked;
    modalLayerEl.innerHTML = `<div class='td-modal td-modal-sm'><div class='td-modal-head'><div class='td-modal-title'>${title}</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div><div class='td-modal-body'><div class='td-field'><label class='td-label'>方案名称</label><input class='td-input' id='td-scheme-name-input' type='text' placeholder='例如：日常聊天、战斗模式、纯文风...' value='${escapeHtml(m.name || '')}' /></div>${showBindOpt ? `<label class='td-setting-row' style='cursor:pointer;'><div><div class='td-setting-title'>同时绑定到当前预设</div><div class='td-setting-desc'>${escapeHtml(state.presetName)}</div></div><input class='td-checkbox' id='td-scheme-bind-check' type='checkbox' ${bindChecked ? 'checked' : ''} /></label>` : ''}</div><div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='submit-scheme-form'>确定</button></div></div>`;
    uiCtx.syncOverlayBounds(); return;
  }

  if (m.type === 'bindings') {
    const pool = ensureSchemesPool(), selectedSet = m.selectedIds;
    const rowsHtml = pool.map((s) => `<div class='td-picker-row ${selectedSet.has(s.id) ? 'checked' : ''}' data-action='toggle-bind-scheme' data-scheme-id='${escapeHtml(s.id)}'><div class='td-picker-left'><input class='td-checkbox' type='checkbox' ${selectedSet.has(s.id) ? 'checked' : ''} tabindex='-1' /><span class='td-item-name'>${escapeHtml(s.name)}</span></div><span class='td-count-tag'>${(s.groups || []).length} 个分组</span></div>`).join('');
    modalLayerEl.innerHTML = `<div class='td-modal'><div class='td-modal-head'><div class='td-modal-title'>预设方案绑定 · ${escapeHtml(state.presetName)}</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div><div class='td-modal-body'><div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>勾选要绑定到当前预设的方案（支持多选，同一方案也可被多个预设共用）。若全部不选，则控制台默认列出全部方案。</div><div style='display:flex;flex-direction:column;gap:6px;'>${rowsHtml}</div></div><div class='td-modal-foot'><button class='td-btn' style='margin-right:auto;' data-action='clear-bindings'>全部不选(显示全部)</button><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='save-bindings'>保存绑定</button></div></div>`;
    uiCtx.syncOverlayBounds(); return;
  }

  if (m.type === 'groupForm') {
    const isEdit = !!m.groupId, title = isEdit ? '编辑分组' : (m.parentId ? `新建子分组 · ${m.parentName || ''}` : '新建分组');
    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>${escapeHtml(title)}</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          <div class='td-field'><label class='td-label'>分组名称</label><input class='td-input' id='td-group-name-input' type='text' placeholder='例如：破限预设、文风切换、功能开关...' value='${escapeHtml(m.name || '')}' /></div>
          <div class='td-field'><label class='td-label'>分组模式</label><div class='td-seg-grid'><button type='button' class='td-seg-card ${m.mode === 'multi' ? 'active' : ''}' data-action='set-modal-mode' data-mode='multi'><div class='td-seg-title'>多选分组</div><div class='td-seg-desc'>条目自由开关，支持一键全开 / 全关</div></button><button type='button' class='td-seg-card single-card ${m.mode === 'single' ? 'active' : ''}' data-action='set-modal-mode' data-mode='single'><div class='td-seg-title'>单选分组</div><div class='td-seg-desc'>组内条目互斥，开启一项自动关闭其余</div></button></div></div>
        </div>
        <div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='submit-group-form'>${isEdit ? '保存修改' : '创建分组'}</button></div>
      </div>`;
    uiCtx.syncOverlayBounds(); return;
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
    updatePickerList(); uiCtx.syncOverlayBounds(); return;
  }

  if (m.type === 'settings') {
    const s = state.store.settings;
    const themeObj = THEME_OPTIONS.find((t) => t.id === (s.theme || 'dark')) || THEME_OPTIONS[0];
    const orbStyleObj = ORB_STYLE_OPTIONS.find((o) => o.id === (s.orbStyle || 'indigo')) || ORB_STYLE_OPTIONS[0];
    const topPosOpts = getTopBarPositionOptions();
    const topPosName = (topPosOpts.find((o) => o.id === (s.topBarPosition || 'after_extensions')) || topPosOpts[0]).name;
    const gColor = s.groupTextColor || '';
    const eColor = s.entryTextColor || '';
    const orbImg = s.orbImage || '';
    const orbFit = s.orbImageFit === 'contain' ? 'contain' : 'cover';
    const opacity = s.orbOpacity ?? 0.96, orbSize = getOrbSize();
    const unlockOrb = !!s.unlockOrbSliders;
    const showOrb = s.showOrb !== false, enableExt = !!s.enableExtButton, enableTopBar = !!s.enableTopBarButton;
    const enableDrag = !!s.enableDragSort, collapseNative = !!s.collapseNativePresetSettings;
    const collapseGrp = s.collapseGroupActions !== false, grpCfg = s.collapsedGroupItems || {};
    const collapseEntry = s.collapseEntryActions !== false, entryCfg = s.collapsedEntryItems || {};

    const vp = uiCtx.getViewportRect();
    const curPanelSize = uiCtx.getPanelSize();
    const defPanelSize = uiCtx.getDefaultPanelSize();
    const maxW = Math.max(280, Math.round(vp.w - 8));
    const maxH = Math.max(280, Math.round(vp.h - 8));

    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'><div class='td-modal-title'>设置 · ${APP_NAME} (${APP_CN}) ${APP_VERSION}</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        <div class='td-modal-body' style='overflow-anchor:none;'>
          <div class='td-field'>
            <label class='td-label'>外观与文字颜色</label>
            <div class='td-setting-row'><div style='display:flex;align-items:center;gap:10px;'><span class='td-swatch' style='background:${themeObj.swatch};'></span><div><div class='td-setting-title'>界面主题</div><div class='td-setting-desc'>当前：${escapeHtml(themeObj.name)}</div></div></div><button type='button' class='td-btn sm' data-action='open-select-popup' data-select-type='theme'>选择</button></div>
            <div class='td-setting-row'><div style='display:flex;align-items:center;gap:10px;'><span class='td-swatch' style='background:${orbStyleObj.swatch};'></span><div><div class='td-setting-title'>悬浮球颜色样式</div><div class='td-setting-desc'>当前：${escapeHtml(orbStyleObj.name)}</div></div></div><button type='button' class='td-btn sm' data-action='open-select-popup' data-select-type='orbStyle'>选择</button></div>
            <div class='td-setting-row'><div style='display:flex;align-items:center;gap:10px;'><span class='td-swatch' style='background:${escapeHtml(gColor || 'var(--td-text)')};'></span><div><div class='td-setting-title'>分组文字颜色</div><div class='td-setting-desc'>当前：${escapeHtml(gColor || '跟随主题默认')}</div></div></div><button type='button' class='td-btn sm' data-action='open-select-popup' data-select-type='groupTextColor'>选择</button></div>
            <div class='td-setting-row'><div style='display:flex;align-items:center;gap:10px;'><span class='td-swatch' style='background:${escapeHtml(eColor || 'var(--td-text)')};'></span><div><div class='td-setting-title'>条目文字颜色</div><div class='td-setting-desc'>当前：${escapeHtml(eColor || '跟随主题默认')}</div></div></div><button type='button' class='td-btn sm' data-action='open-select-popup' data-select-type='entryTextColor'>选择</button></div>
          </div>

          <div class='td-field'>
            <label class='td-label'>悬浮球图标</label>
            <div class='td-setting-row'>
              <div style='display:flex;align-items:center;gap:10px;min-width:0;flex:1;'>
                <div class='td-orb-preview-box'>${orbImg ? `<img class='td-orb-img ${orbFit === 'contain' ? 'fit-contain' : 'fit-cover'}' src='${escapeHtml(orbImg)}' />` : ICONS.deck}</div>
                <div class='td-setting-title'>${orbImg ? '自定义图标' : '默认图标'}</div>
              </div>
              <div style='display:flex;gap:5px;flex-wrap:wrap;flex-shrink:0;'>
                <button type='button' class='td-btn sm' data-action='trigger-orb-upload'>${ICONS.upload} 上传并裁剪</button>
                <input type='file' id='td-orb-img-input' accept='image/*' style='display:none;' />
                ${orbImg ? `<button type='button' class='td-btn sm danger' data-action='clear-orb-image'>恢复</button>` : ''}
              </div>
            </div>
          </div>

          <div class='td-field'>
            <label class='td-label'>酒馆原生界面辅助</label>
            <div class='td-setting-row'>
              <div>
                <div class='td-setting-title'>折叠酒馆原生预设设定区域</div>
                <div class='td-setting-desc'>将酒馆右侧预设下拉框与提示词列表之间的参数区域折叠（可随时点横条展开）</div>
              </div>
              <button type='button' class='td-switch ${collapseNative ? 'on' : ''}' data-action='toggle-native-preset-collapse'></button>
            </div>
          </div>

          <div class='td-field'>
            <label class='td-label'>触发入口设置（至少保留一项开启）</label>
            <div class='td-setting-row'><div><div class='td-setting-title'>悬浮球入口</div><div class='td-setting-desc'>无操作自动缩小变淡，靠边自动贴边收纳</div></div><button type='button' class='td-switch ${showOrb ? 'on' : ''}' data-action='toggle-entry-switch' data-key='showOrb'></button></div>
            <div class='td-setting-row'><div><div class='td-setting-title'>嵌入酒馆顶部导航栏</div><div class='td-setting-desc'>在酒馆最顶部图标栏中插入总控台快捷按钮</div></div><button type='button' class='td-switch ${enableTopBar ? 'on' : ''}' data-action='toggle-entry-switch' data-key='enableTopBarButton'></button></div>
            <div class='td-setting-row' data-role='topbar-pos-row' style='display:${enableTopBar ? 'flex' : 'none'};'><div><div class='td-setting-title'>顶部栏嵌入位置</div><div class='td-setting-desc'>当前：${escapeHtml(topPosName)}</div></div><button type='button' class='td-btn sm' data-action='open-select-popup' data-select-type='topBarPosition'>选择位置</button></div>
            <div class='td-setting-row'><div><div class='td-setting-title'>左下角魔法棒拓展按钮</div><div class='td-setting-desc'>在魔法棒菜单中添加「总控台」快捷入口</div></div><button type='button' class='td-switch ${enableExt ? 'on' : ''}' data-action='toggle-entry-switch' data-key='enableExtButton'></button></div>
          </div>

          <div class='td-field'>
            <label class='td-label'>按钮收纳分类设置</label>
            <div class='td-setting-row'><div><div class='td-setting-title'>分组按钮收纳</div><div class='td-setting-desc'>默认常驻「一键开关」，其余按钮收进分组「⋯」</div></div><button type='button' class='td-switch ${collapseGrp ? 'on' : ''}' data-action='toggle-collapse-group'></button></div>
            <div class='td-field' data-role='collapse-group-sub' style='display:${collapseGrp ? 'flex' : 'none'};padding:8px 10px;border-radius:10px;background:var(--td-surface);border:1px solid var(--td-border);'><span class='td-label'>勾选要收纳进分组「⋯」的按钮（未勾选则常驻显示）：</span><div class='td-check-pills'><button type='button' class='td-check-pill ${grpCfg.quickToggle ? 'on' : ''}' data-action='toggle-collapsed-group-item' data-item='quickToggle'>一键开关</button><button type='button' class='td-check-pill ${grpCfg.add ? 'on' : ''}' data-action='toggle-collapsed-group-item' data-item='add'>添加条目</button><button type='button' class='td-check-pill ${grpCfg.subgroup ? 'on' : ''}' data-action='toggle-collapsed-group-item' data-item='subgroup'>添加子分组</button><button type='button' class='td-check-pill ${grpCfg.edit ? 'on' : ''}' data-action='toggle-collapsed-group-item' data-item='edit'>编辑分组</button><button type='button' class='td-check-pill ${grpCfg.delete ? 'on' : ''}' data-action='toggle-collapsed-group-item' data-item='delete'>删除分组</button></div></div>
            <div class='td-setting-row'><div><div class='td-setting-title'>条目按钮收纳</div><div class='td-setting-desc'>默认常驻「预览」，其余元素收进条目「⋯」</div></div><button type='button' class='td-switch ${collapseEntry ? 'on' : ''}' data-action='toggle-collapse-entry'></button></div>
            <div class='td-field' data-role='collapse-entry-sub' style='display:${collapseEntry ? 'flex' : 'none'};padding:8px 10px;border-radius:10px;background:var(--td-surface);border:1px solid var(--td-border);'><span class='td-label'>勾选要收纳进条目「⋯」的元素（未勾选则常驻显示）：</span><div class='td-check-pills'><button type='button' class='td-check-pill ${entryCfg.badge ? 'on' : ''}' data-action='toggle-collapsed-entry-item' data-item='badge'>来源标签</button><button type='button' class='td-check-pill ${entryCfg.preview ? 'on' : ''}' data-action='toggle-collapsed-entry-item' data-item='preview'>预览与编辑</button><button type='button' class='td-check-pill ${entryCfg.remove ? 'on' : ''}' data-action='toggle-collapsed-entry-item' data-item='remove'>移除按钮</button></div></div>
          </div>

          <div class='td-field'>
            <label class='td-label'>交互、控制台尺寸与悬浮球</label>
            <div class='td-setting-row'><div><div class='td-setting-title'>启用拖拽排序与嵌套</div><div class='td-setting-desc'>开启后显示左侧拖拽手柄，可拖动调序、跨组及嵌套子分组</div></div><button type='button' class='td-switch ${enableDrag ? 'on' : ''}' data-action='toggle-drag-sort'></button></div>

            <div class='td-size-box'>
              <div class='td-size-box-head'>
                <span class='td-setting-title'>控制台窗口自定义尺寸 (px)</span>
                <button type='button' class='td-chip' data-action='apply-panel-preset-default'>填入推荐值</button>
              </div>
              <div class='td-size-inputs'>
                <div class='td-size-input-col'>
                  <span class='td-label'>宽度 (280 ~ ${maxW})</span>
                  <input class='td-input' id='td-panel-width-input' type='number' min='280' max='${maxW}' value='${curPanelSize.w}' />
                </div>
                <div class='td-size-input-col'>
                  <span class='td-label'>高度 (280 ~ ${maxH})</span>
                  <input class='td-input' id='td-panel-height-input' type='number' min='280' max='${maxH}' value='${curPanelSize.h}' />
                </div>
                <button type='button' class='td-btn primary' data-action='apply-panel-size' style='height:38px;align-self:flex-end;'>应用</button>
              </div>
              <div class='td-setting-desc'>参考：当前屏幕 ${Math.round(vp.w)} × ${Math.round(vp.h)} px · 默认推荐 ${defPanelSize.w} × ${defPanelSize.h} px（手机建议宽度 330~380，电脑建议 460~620）</div>
            </div>

            <div class='td-setting-row'>
              <div>
                <div class='td-setting-title'>解锁悬浮球大小/透明度拖动</div>
                <div class='td-setting-desc'>防止滑动设置页时误触滑块，仅开启后允许拖动调节</div>
              </div>
              <button type='button' class='td-switch ${unlockOrb ? 'on' : ''}' data-action='toggle-orb-sliders-lock'></button>
            </div>
            <div class='td-slider-lock-box ${unlockOrb ? '' : 'is-locked'}' data-role='orb-sliders-box'>
              <label class='td-label' data-role='orb-size-label'>悬浮球大小 (${orbSize}px)${unlockOrb ? '' : ' · 已锁定'}</label>
              <input class='td-range' id='td-size-range' type='range' min='34' max='72' value='${orbSize}' ${unlockOrb ? '' : 'disabled'} />
              <label class='td-label' data-role='opacity-label'>悬浮球透明度 (${Math.round(opacity * 100)}%)${unlockOrb ? '' : ' · 已锁定'}</label>
              <input class='td-range' id='td-opacity-range' type='range' min='35' max='100' value='${Math.round(opacity * 100)}' ${unlockOrb ? '' : 'disabled'} />
            </div>
          </div>

          <div class='td-field'>
            <label class='td-label'>数据备份、日志与维护</label>
            <div style='display:flex;gap:8px;flex-wrap:wrap;'>
              <button class='td-btn primary' data-action='open-io-center'>${ICONS.download} 导入 / 导出配置</button>
              <button class='td-btn' data-action='open-logs'>${ICONS.code} 查看运行日志</button>
              <button class='td-btn' data-action='reset-layout'>重置窗口与悬浮球</button>
              <button class='td-btn danger' data-action='clear-all-data'>重置全部方案数据</button>
            </div>
          </div>
          <div style='font-size:12px;color:var(--td-text-dim);padding-top:6px;border-top:1px solid var(--td-border);'>当前预设：${escapeHtml(state.presetName)}<br />数据持久化：酒馆全局变量 (${STORAGE_KEY} · Schema v${SCHEMA_VERSION})</div>
        </div>
        <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>完成</button></div>
      </div>`;

    if (prevScroll > 0) {
      const nextBody = modalLayerEl.querySelector('.td-modal-body');
      if (nextBody) {
        nextBody.scrollTop = prevScroll;
        requestAnimationFrame(() => { nextBody.scrollTop = prevScroll; });
      }
    }
    uiCtx.syncOverlayBounds();
  }
}

export function readPreviewSnapshot() {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl) return null;
  if (state.previewCtx?.type === 'mergeCustom') {
    syncPresetMergeCustomDraft(previewLayerEl);
    const d = state.previewCtx.draft;
    return {
      name: d.name || '',
      content: d.content || '',
      find_regex: JSON.stringify({ enabled: d.enabled, role: d.role, posType: d.posType, depth: d.depth, order: d.order }),
      replace_string: '',
    };
  }
  if (state.previewCtx?.type === 'wbMergeCustom') {
    syncWbMergeCustomDraft(previewLayerEl);
    const d = state.previewCtx.draft;
    return {
      name: d.name || '',
      content: d.content || '',
      find_regex: d.keys || '',
      replace_string: JSON.stringify({ enabled: d.enabled, stype: d.stype, posType: d.posType, order: d.order, depth: d.depth }),
    };
  }
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
  if (state.previewCtx?.type === 'mergeCustom') {
    const nameEl = previewLayerEl.querySelector('#td-merge-custom-name');
    const contentEl = previewLayerEl.querySelector('#td-merge-custom-content');
    if (nameEl) nameEl.value = snap.name;
    if (contentEl) contentEl.value = snap.content;
    state.previewCtx.draft.name = snap.name;
    state.previewCtx.draft.content = snap.content;
    try {
      const meta = JSON.parse(snap.find_regex || '{}');
      const enEl = previewLayerEl.querySelector('#td-merge-custom-enabled');
      if (enEl && typeof meta.enabled === 'boolean') enEl.checked = meta.enabled;
    } catch (e) {}
    return;
  }
  if (state.previewCtx?.type === 'wbMergeCustom') {
    const nameEl = previewLayerEl.querySelector('#td-wbm-custom-name');
    const contentEl = previewLayerEl.querySelector('#td-edit-content');
    const keysEl = previewLayerEl.querySelector('#td-wbm-custom-keys');
    if (nameEl) nameEl.value = snap.name;
    if (contentEl) contentEl.value = snap.content;
    if (keysEl) keysEl.value = snap.find_regex;
    state.previewCtx.draft.name = snap.name;
    state.previewCtx.draft.content = snap.content;
    state.previewCtx.draft.keys = snap.find_regex;
    return;
  }
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
  if (editHistory.timer) { clearTimeout(editHistory.timer); editHistory.timer = null; }
  const snap = readPreviewSnapshot();
  if (!snap || snapshotsEqual(editHistory.stack[editHistory.index], snap)) return;
  if (!force || editHistory.index < editHistory.stack.length - 1) editHistory.stack = editHistory.stack.slice(0, editHistory.index + 1);
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
  if (statusTag) statusTag.textContent = `状态: ${item.enabled ? '已开启' : '已关闭'}`;
}

export function renderPreviewModal() {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl) return;
  if (editHistory.timer) { clearTimeout(editHistory.timer); editHistory.timer = null; }
  if (!state.panelOpen) { previewLayerEl.classList.remove('is-open'); previewLayerEl.innerHTML = ''; editHistory.stack = []; editHistory.index = -1; return; }

  if (uiCtx.renderManagerPreview()) return;

  if (state.previewCtx?.type === 'mergeCustom') {
    renderPresetMergeCustomModal(previewLayerEl, ICONS);
    editHistory.stack = [readPreviewSnapshot()];
    editHistory.index = 0;
    updatePreviewHistoryButtons();
    uiCtx.syncOverlayBounds();
    return;
  }

  if (state.snapshotDetailId) {
    const snap = (state.store.snapshots || []).find((s) => s.id === state.snapshotDetailId);
    if (!snap) { state.snapshotDetailId = null; previewLayerEl.classList.remove('is-open'); previewLayerEl.innerHTML = ''; return; }
    const diffs = computeSnapshotDiff(snap);
    const diffHtml = diffs.length === 0 ? "<div class='td-group-empty'>该快照的开关状态与当前环境完全一致</div>" : diffs.map((d) => `<div class='td-diff-row'><span style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;'>${escapeHtml(d.name)}</span><span class='td-mode-tag ${d.to ? 'ok' : 'single'}'>${d.from ? '开' : '关'} → ${d.to ? '开' : '关'}</span></div>`).join('');
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `<div class='td-modal td-modal-tall'><div class='td-modal-head'><div class='td-modal-title'>快照差异对比 · ${escapeHtml(snap.name)}</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div><div class='td-modal-body'><div class='td-preview-meta'><span class='td-meta-tag'>模式: ${snap.mode === 'full' ? '完整预设快照' : '开关状态快照'}</span><span class='td-meta-tag'>来源预设: ${escapeHtml(snap.presetName)}</span><span class='td-meta-tag'>时间: ${escapeHtml(formatTime(snap.updatedAt || snap.createdAt))}</span><span class='td-meta-tag'>差异: ${diffs.length} 项</span></div><div style='display:flex;flex-direction:column;gap:5px;'>${diffHtml}</div></div><div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>关闭</button><button class='td-btn primary' data-action='apply-snapshot-from-detail' data-snap-id='${escapeHtml(snap.id)}'>${ICONS.check} 恢复此快照</button></div></div>`;
    uiCtx.syncOverlayBounds(); return;
  }

  if (!state.previewKey) { previewLayerEl.classList.remove('is-open'); previewLayerEl.innerHTML = ''; editHistory.stack = []; editHistory.index = -1; return; }
  const item = state.catalog.byKey.get(state.previewKey);
  if (!item) { state.previewKey = null; previewLayerEl.classList.remove('is-open'); previewLayerEl.innerHTML = ''; return; }

  const ref = item.ref, raw = item.raw || {};
  let metaHtml = `<span class='td-meta-tag'>类型: ${escapeHtml(TYPE_LABELS[ref.type] || ref.type)}</span><span class='td-meta-tag' data-role='preview-status-tag'>状态: ${item.enabled ? '已开启' : '已关闭'}</span>`;
  if (item.scopeTitle) metaHtml += `<span class='td-meta-tag'>作用域: ${escapeHtml(item.scopeTitle)}</span>`;

  let fieldsHtml = `<div class='td-field'><label class='td-label'>条目名称</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(item.name || '')}' /></div>`;
  if (ref.type === 'regex') {
    fieldsHtml += `<div class='td-field'><label class='td-label'>查找正则 (Find Regex)</label><input class='td-input' id='td-edit-find-regex' type='text' value='${escapeHtml(raw.find_regex || '')}' /></div><div class='td-field' style='flex:1;display:flex;flex-direction:column;'><label class='td-label'>替换为 (Replace String)</label><textarea class='td-textarea td-scroll' id='td-edit-replace-string' style='flex:1;'>${escapeHtml(raw.replace_string || '')}</textarea></div>`;
  } else {
    const isPlaceholder = ref.type === 'preset' && typeof raw.content !== 'string', contentVal = typeof raw.content === 'string' ? raw.content : '';
    fieldsHtml += `<div class='td-field' style='flex:1;display:flex;flex-direction:column;'><label class='td-label'>条目内容 ${isPlaceholder ? '（此条为酒馆内置占位符，一般无正文）' : ''}</label><textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;' ${isPlaceholder ? "placeholder='该条目为内置占位符'" : ''}>${escapeHtml(contentVal)}</textarea></div>`;
  }

  previewLayerEl.classList.add('is-open');
  previewLayerEl.innerHTML = `<div class='td-modal td-modal-tall'><div class='td-modal-head'><div class='td-modal-title' title='${escapeHtml(item.name)}'>编辑与预览 · ${escapeHtml(item.name)}</div><div style='display:flex;gap:4px;'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='copy-preview' title='复制内容'>${ICONS.copy}</button><button class='td-icon-btn' data-action='close-preview' title='关闭'>${ICONS.close}</button></div></div><div class='td-modal-body'><div class='td-preview-meta'>${metaHtml}</div>${fieldsHtml}</div><div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='save-preview-edit'>${ICONS.save} 保存更改</button></div></div>`;
  editHistory.stack = [readPreviewSnapshot()]; editHistory.index = 0;
  updatePreviewHistoryButtons(); uiCtx.syncOverlayBounds();
}
