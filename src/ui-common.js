import { state } from './store.js';
import { syncPresetMergeCustomDraft, syncWbMergeCustomDraft } from './merge-ui.js';

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
  database: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><ellipse cx='12' cy='5' rx='9' ry='3'/><path d='M21 12c0 1.66-4 3-9 3s-9-1.34-9-3'/><path d='M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5'/></svg>",
  help: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10'/><path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'/><line x1='12' y1='17' x2='12.01' y2='17'/></svg>",
};

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

export const TOAST_THEME_OPTIONS = [
  { id: 'panel', name: '跟随控制台主题', desc: '自适应暗夜/白天/羊皮/翡翠/赛博配色', swatch: 'linear-gradient(135deg,#6366f1,#151821)' },
  { id: 'glass', name: '磨砂玻璃', desc: '高透模糊玻璃拟态与细腻亮边框', swatch: 'linear-gradient(135deg,rgba(255,255,255,0.5),rgba(148,163,184,0.35))' },
  { id: 'pill', name: '灵动胶囊', desc: '圆润紧凑胶囊造型，轻盈悬浮', swatch: 'linear-gradient(135deg,#38bdf8,#6366f1)' },
  { id: 'card', name: '极简色条', desc: '实底卡片搭配左侧 4px 状态强调色条', swatch: 'linear-gradient(90deg,#10b981 0%,#10b981 30%,#1e2230 30%)' },
  { id: 'neon', name: '霓虹赛博', desc: '深邃暗底搭配状态色发光霓虹边框', swatch: 'linear-gradient(135deg,#ec4899,#06b6d4)' },
  { id: 'ink', name: '复古羊皮', desc: '温润暖色纸感，古典褐金描边', swatch: '#f4ead2' },
];

export const NATIVE_TOAST_THEME_OPTIONS = [
  { id: 'glass', name: '磨砂玻璃（推荐）', desc: '通透毛玻璃质感，百搭酒馆背景', swatch: 'linear-gradient(135deg,rgba(255,255,255,0.5),rgba(148,163,184,0.35))' },
  { id: 'pill', name: '灵动胶囊', desc: '圆润紧凑胶囊造型，存在感适中', swatch: 'linear-gradient(135deg,#38bdf8,#6366f1)' },
  { id: 'card', name: '极简色条', desc: '左侧状态强调色条，层级分明', swatch: 'linear-gradient(90deg,#f59e0b 0%,#f59e0b 30%,#1e2230 30%)' },
  { id: 'neon', name: '霓虹赛博', desc: '深邃暗底搭配状态色发光描边', swatch: 'linear-gradient(135deg,#ec4899,#06b6d4)' },
  { id: 'ink', name: '复古羊皮', desc: '温润羊皮纸色调，古典质感', swatch: '#f4ead2' },
  { id: 'follow', name: '跟随插件通知主题', desc: '与 TavernDeck 插件通知保持一致', swatch: 'linear-gradient(135deg,#6366f1,#8b5cf6)' },
];

export const NATIVE_TOAST_POS_OPTIONS = [
  { id: 'top-right', name: '右上角（默认 · 与插件错开防混淆）' },
  { id: 'top-center', name: '顶部居中（与插件同区堆叠）' },
  { id: 'bottom-right', name: '右下角（不遮挡顶部栏）' },
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

let suppressClickUntil = 0;

export function getSuppressClickUntil() {
  return suppressClickUntil;
}

export function setSuppressClickUntil(ts) {
  suppressClickUntil = Number(ts) || 0;
}

export const uiCtx = {
  getRootEl: () => null,
  getOrbEl: () => null,
  getPanelEl: () => null,
  getPanelMainEl: () => null,
  getResizeHandleEl: () => null,
  getModalLayer: () => null,
  getPreviewLayer: () => null,
  getSelectLayer: () => null,
  getConfirmLayer: () => null,
  getHelpLayer: () => null,
  getModules: () => [],
  getViewportRect: () => ({ x: 0, y: 0, w: window.innerWidth || 1200, h: window.innerHeight || 800 }),
  getPanelSize: () => ({ w: 420, h: 560 }),
  getDefaultPanelSize: () => ({ w: 420, h: 560 }),
  syncOverlayBounds: () => {},
  repositionUI: () => {},
  applyOrbVisualState: () => {},
  renderOrb: () => {},
  renderMain: () => {},
  renderMainBodyOnly: () => {},
  updateGroupItemsDom: () => {},
  syncEntryStatesUI: () => {},
  renderModal: () => {},
  renderPreviewModal: () => {},
  renderSelectPopup: () => {},
  renderConfirmModal: () => {},
  renderHelpModal: () => {},
  openConfirm: () => {},
  syncTopBarUI: () => {},
  syncExtensionButton: () => {},
  applyThemeAttributes: () => {},
  performSwitchPreset: () => {},
  setPanelOpen: () => {},
};

export function setUiContext(nextCtx) {
  Object.assign(uiCtx, nextCtx || {});
}

export function getOrbSize() {
  const sz = Number(state.store.settings.orbSize);
  return Math.max(34, Math.min(72, Number.isNaN(sz) ? 50 : sz));
}

export function formatByteSize(bytes) {
  if (!bytes || bytes <= 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

export function openConfirm(opts) {
  state.confirmModal = opts;
  uiCtx.renderConfirmModal();
}

export function confirmDiscardDirtyModal(onProceed) {
  const modules = uiCtx.getModules ? uiCtx.getModules() : [];
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    if (mod && typeof mod.confirmDirty === 'function' && mod.confirmDirty(onProceed)) {
      return;
    }
  }
  onProceed();
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
