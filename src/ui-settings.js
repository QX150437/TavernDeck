import {
  APP_NAME, APP_CN, APP_VERSION, STORAGE_KEY, SCHEMA_VERSION,
  escapeHtml, genId, notify, normalizeColorInput,
  syncNotifyRuntimeConfig, showToastElement, logWarn, logError,
} from './utils.js';
import { state, saveStore } from './store.js';
import {
  syncNativePresetCollapse, syncNativeToastHook, getTopBarPositionOptions,
} from './native-ui.js';
import { insertFromUnusedAt, movePromptsBatchBeforeIndex } from './preset-manager.js';
import { moveWorldbookEntriesBatchBeforeIndex } from './worldbook-manager.js';
import {
  ICONS, THEME_OPTIONS, ORB_STYLE_OPTIONS, TEXT_COLOR_PRESETS,
  TOAST_THEME_OPTIONS, NATIVE_TOAST_THEME_OPTIONS, NATIVE_TOAST_POS_OPTIONS,
  uiCtx, getOrbSize, openConfirm,
} from './ui-common.js';

let cropDrag = null;

function drawOrbCropCanvas() {
  const previewLayerEl = uiCtx.getPreviewLayer();
  if (!previewLayerEl || state.previewCtx?.type !== 'orbCrop') return;
  const canvas = previewLayerEl.querySelector('#td-crop-canvas');
  const crop = state.previewCtx;
  if (!canvas || !crop.img) return;

  const size = 240;
  const ctx2d = canvas.getContext('2d');
  ctx2d.clearRect(0, 0, size, size);

  const img = crop.img;
  const baseScale = Math.max(size / (img.width || size), size / (img.height || size));
  const scale = baseScale * (crop.zoom || 1);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const dx = (size - drawW) / 2 + (crop.offsetX || 0);
  const dy = (size - drawH) / 2 + (crop.offsetY || 0);

  ctx2d.drawImage(img, dx, dy, drawW, drawH);

  ctx2d.save();
  ctx2d.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx2d.beginPath();
  ctx2d.rect(0, 0, size, size);
  ctx2d.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2, true);
  ctx2d.fill('evenodd');
  ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.88)';
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  ctx2d.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  ctx2d.stroke();
  ctx2d.restore();
}

function exportCroppedOrbDataUrl(crop) {
  const outSize = 180;
  const stageSize = 240;
  const radiusRatio = (stageSize / 2 - 8) / (stageSize / 2);
  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx2d = canvas.getContext('2d');

  ctx2d.beginPath();
  ctx2d.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2);
  ctx2d.clip();

  const img = crop.img;
  const baseScale = Math.max(stageSize / (img.width || stageSize), stageSize / (img.height || stageSize));
  const scale = baseScale * (crop.zoom || 1);
  const factor = (outSize / stageSize) / radiusRatio;

  const drawW = img.width * scale * factor;
  const drawH = img.height * scale * factor;
  const dx = (outSize - drawW) / 2 + (crop.offsetX || 0) * factor;
  const dy = (outSize - drawH) / 2 + (crop.offsetY || 0) * factor;

  ctx2d.drawImage(img, dx, dy, drawW, drawH);
  try {
    const webp = canvas.toDataURL('image/webp', 0.9);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } catch (e) {
    logWarn('转换 WebP 头像失败，降级使用 PNG', e);
    return canvas.toDataURL('image/png');
  }
}

function bindOrbCropPointerEvents(previewLayerEl) {
  const stage = previewLayerEl?.querySelector('#td-crop-stage');
  if (!stage || stage.dataset.tdBound) return;
  stage.dataset.tdBound = '1';

  stage.addEventListener('pointerdown', (e) => {
    if (state.previewCtx?.type !== 'orbCrop') return;
    e.preventDefault();
    cropDrag = {
      x: e.clientX,
      y: e.clientY,
      ox: state.previewCtx.offsetX || 0,
      oy: state.previewCtx.offsetY || 0,
    };
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  });
  stage.addEventListener('pointermove', (e) => {
    if (!cropDrag || state.previewCtx?.type !== 'orbCrop') return;
    state.previewCtx.offsetX = cropDrag.ox + (e.clientX - cropDrag.x);
    state.previewCtx.offsetY = cropDrag.oy + (e.clientY - cropDrag.y);
    drawOrbCropCanvas();
  });
  const endDrag = () => { cropDrag = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
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

function applyMoveTargetPick(sp, rawIdx) {
  const m = state.modal;
  const beforeIdx = Number(rawIdx);
  if (!m || Number.isNaN(beforeIdx)) return;

  if (sp.type === 'moveWbTarget' && m.type === 'worldbookDetail') {
    if (moveWorldbookEntriesBatchBeforeIndex(m.entries, sp.fromIndices, beforeIdx)) {
      m.dirty = true;
      if (m.selectedIdx instanceof Set) m.selectedIdx.clear();
      notify('success', '已调整世界书条目顺序');
    } else {
      notify('info', '条目位置未发生变化');
    }
    state.selectPopup = null;
    renderSelectPopup();
    uiCtx.renderModal();
    return;
  }

  if (m.type !== 'presetDetail') return;
  if (sp.mode === 'insertFromUnused') {
    const cnt = insertFromUnusedAt(m.data, sp.fromIndices, beforeIdx);
    if (cnt > 0) {
      m.dirty = true;
      if (m.selectedIdx instanceof Set) m.selectedIdx.clear();
      notify('success', `已将 ${cnt} 个条目加入主列表`);
    }
  } else {
    const list = m.data[sp.listName];
    if (movePromptsBatchBeforeIndex(list, sp.fromIndices, beforeIdx)) {
      m.dirty = true;
      if (m.selectedIdx instanceof Set) m.selectedIdx.clear();
      notify('success', '已调整条目顺序');
    } else {
      notify('info', '条目位置未发生变化');
    }
  }
  state.selectPopup = null;
  renderSelectPopup();
  uiCtx.renderModal();
}

export function renderSelectPopup() {
  const layer = uiCtx.getSelectLayer();
  if (!layer) return;
  const sp = state.selectPopup;
  if (!sp || !state.panelOpen) {
    layer.classList.remove('is-open');
    layer.innerHTML = '';
    return;
  }
  layer.classList.add('is-open');

  const modules = uiCtx.getModules ? uiCtx.getModules() : [];
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    if (mod && typeof mod.renderSelectPopup === 'function' && mod.renderSelectPopup(sp, layer)) {
      return;
    }
  }

  if (sp.type === 'aiItemPreview') {
    const metaTags = (sp.metas || []).filter(Boolean)
      .map((t) => `<span class='td-meta-tag'>${escapeHtml(t)}</span>`)
      .join('');
    layer.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>内容预览 · ${escapeHtml(sp.title || '')}</div>
          <button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button>
        </div>
        <div class='td-modal-body'>
          ${metaTags ? `<div class='td-preview-meta'>${metaTags}</div>` : ''}
          <div class='td-field' style='flex:1;display:flex;flex-direction:column;'>
            <label class='td-label'>条目正文内容</label>
            <textarea class='td-textarea td-scroll' readonly style='flex:1;min-height:240px;'>${escapeHtml(sp.content || '')}</textarea>
          </div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn primary' data-action='close-select-popup'>关闭</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (sp.type === 'tdToastTheme' || sp.type === 'nativeToastTheme') {
    const isNative = sp.type === 'nativeToastTheme';
    const opts = isNative ? NATIVE_TOAST_THEME_OPTIONS : TOAST_THEME_OPTIONS;
    const curVal = isNative
      ? (state.store.settings.nativeToastTheme || 'glass')
      : (state.store.settings.tdToastTheme || 'panel');
    const itemsHtml = opts.map((o) => `
      <button type='button' class='td-select-option ${o.id === curVal ? 'active' : ''}' data-action='select-popup-pick' data-value='${escapeHtml(o.id)}'>
        <span class='td-select-option-left'>
          <span class='td-swatch' style='background:${escapeHtml(o.swatch)};'></span>
          <span style='min-width:0;display:flex;flex-direction:column;gap:2px;'>
            <span class='td-select-option-name'>${escapeHtml(o.name)}</span>
            <span style='font-size:11px;color:var(--td-text-muted);'>${escapeHtml(o.desc || '')}</span>
          </span>
        </span>
        ${o.id === curVal ? "<span class='td-mode-tag multi'>当前</span>" : ''}
      </button>`).join('');

    layer.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>${isNative ? '选择酒馆通知主题' : '选择插件通知主题'}</div><button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button></div>
        <div class='td-modal-body'><div class='td-select-list td-scroll' style='max-height:380px;overflow-y:auto;'>${itemsHtml}</div></div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (sp.type === 'nativeToastPosition') {
    const curVal = state.store.settings.nativeToastPosition || 'top-right';
    const itemsHtml = NATIVE_TOAST_POS_OPTIONS.map((o) => `
      <button type='button' class='td-select-option ${o.id === curVal ? 'active' : ''}' data-action='select-popup-pick' data-value='${escapeHtml(o.id)}'>
        <span class='td-select-option-left'><span class='td-select-option-name'>${escapeHtml(o.name)}</span></span>
        ${o.id === curVal ? "<span class='td-mode-tag multi'>当前</span>" : ''}
      </button>`).join('');

    layer.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>选择酒馆通知显示位置</div><button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button></div>
        <div class='td-modal-body'><div class='td-select-list'>${itemsHtml}</div></div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (sp.type === 'theme') {
    const curVal = state.store.settings.theme || 'dark';
    const itemsHtml = THEME_OPTIONS.map((o) => `
      <button type='button' class='td-select-option ${o.id === curVal ? 'active' : ''}' data-action='select-popup-pick' data-value='${escapeHtml(o.id)}'>
        <span class='td-select-option-left'><span class='td-swatch' style='background:${escapeHtml(o.swatch)};'></span><span class='td-select-option-name'>${escapeHtml(o.name)}</span></span>
        ${o.id === curVal ? "<span class='td-mode-tag multi'>当前</span>" : ''}
      </button>`).join('');

    layer.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>选择界面主题</div><button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button></div>
        <div class='td-modal-body'><div class='td-select-list'>${itemsHtml}</div></div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (sp.type === 'orbStyle') {
    const curVal = state.store.settings.orbStyle || 'indigo';
    const isPreset = ORB_STYLE_OPTIONS.some((o) => o.id === curVal);
    const customVal = isPreset ? '' : curVal;
    const nativeVal = /^#[0-9a-fA-F]{6}$/.test(customVal) ? customVal : '#6366f1';
    const itemsHtml = ORB_STYLE_OPTIONS.map((o) => `
      <button type='button' class='td-select-option ${o.id === curVal ? 'active' : ''}' data-action='select-popup-pick' data-value='${escapeHtml(o.id)}'>
        <span class='td-select-option-left'><span class='td-swatch' style='background:${escapeHtml(o.swatch)};'></span><span class='td-select-option-name'>${escapeHtml(o.name)}</span></span>
        ${o.id === curVal ? "<span class='td-mode-tag multi'>当前</span>" : ''}
      </button>`).join('');

    layer.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>选择悬浮球颜色样式</div><button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          <div class='td-field' style='padding:10px;border-radius:11px;background:var(--td-surface);border:1px solid var(--td-border-strong);'>
            <label class='td-label'>自定义颜色（支持粘贴 #RRGGBB / rgb(...) / 颜色名）</label>
            <div style='display:flex;align-items:center;gap:6px;'>
              <input type='color' class='td-color-native' id='td-sp-color-native' value='${escapeHtml(nativeVal)}' />
              <input type='text' class='td-input' id='td-sp-color-input' placeholder='粘贴颜色值，留空恢复默认' value='${escapeHtml(customVal)}' style='flex:1;font-family:ui-monospace,monospace;font-size:13.5px;' />
              <button type='button' class='td-btn primary' data-action='select-popup-apply-color'>应用</button>
            </div>
          </div>
          <div class='td-select-list td-scroll' style='max-height:310px;overflow-y:auto;'>${itemsHtml}</div>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (sp.type === 'topBarPosition') {
    const opts = getTopBarPositionOptions();
    const curVal = state.store.settings.topBarPosition || 'after_extensions';
    const itemsHtml = opts.map((o) => `
      <button type='button' class='td-select-option ${o.id === curVal ? 'active' : ''}' data-action='select-popup-pick' data-value='${escapeHtml(o.id)}'>
        <span class='td-select-option-left'><span class='td-select-option-name'>${escapeHtml(o.name)}</span></span>
        ${o.id === curVal ? "<span class='td-mode-tag multi'>当前</span>" : ''}
      </button>`).join('');

    layer.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>选择顶部栏嵌入位置</div><button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button></div>
        <div class='td-modal-body'><div class='td-select-list td-scroll' style='max-height:360px;overflow-y:auto;'>${itemsHtml}</div></div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if ((sp.type === 'movePromptTarget' && state.modal?.type === 'presetDetail')
    || (sp.type === 'moveWbTarget' && state.modal?.type === 'worldbookDetail')) {
    const isWb = sp.type === 'moveWbTarget';
    const targetList = isWb
      ? (state.modal.entries || [])
      : (sp.mode === 'insertFromUnused' ? (state.modal.data.prompts || []) : (state.modal.data[sp.listName] || []));
    const fromSet = new Set(sp.fromIndices || []);
    const isInsert = !isWb && sp.mode === 'insertFromUnused';
    const title = isInsert
      ? `加入主列表（${fromSet.size} 项）· 选择插入位置`
      : (fromSet.size > 1 ? `批量移动 ${fromSet.size} 个条目` : `移动 #${(sp.fromIndices?.[0] ?? 0) + 1} 条目`);

    const itemsHtml = targetList.map((item, idx) => {
      const isSelf = !isInsert && fromSet.has(idx);
      const label = isWb ? (item.name || `条目 #${item.uid}`) : (item.name || item.id);
      return `
        <button type='button' class='td-select-option ${isSelf ? 'active' : ''}' data-action='select-popup-pick' data-value='${idx}'>
          <span class='td-select-option-left'>
            <span class='td-idx-badge'>#${idx + 1}</span>
            <span class='td-select-option-name'>放在「${escapeHtml(label)}」之前</span>
          </span>
          ${isSelf ? "<span class='td-mode-tag single'>已选</span>" : ''}
        </button>`;
    }).join('');

    layer.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>${escapeHtml(title)}</div><button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          <div style='display:grid;grid-template-columns:1fr 1fr;gap:6px;'>
            <button type='button' class='td-btn primary' data-action='select-popup-pick' data-value='0'>移到最头部 (#1前)</button>
            <button type='button' class='td-btn primary' data-action='select-popup-pick' data-value='${targetList.length}'>移到最尾部 (末尾)</button>
          </div>
          <div style='display:flex;gap:6px;align-items:center;'>
            <input type='number' class='td-input' id='td-move-idx-input' min='1' max='${Math.max(1, targetList.length + 1)}' placeholder='输入目标序号 (1-${targetList.length + 1})' style='flex:1;height:34px;font-size:13.5px;' />
            <button type='button' class='td-btn sm' data-action='move-by-number'>移到此序号前</button>
          </div>
          <div class='td-select-list td-scroll' style='max-height:300px;overflow-y:auto;'>
            ${itemsHtml || "<div class='td-group-empty'>主列表暂无条目</div>"}
          </div>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return;
  }

  if (sp.type === 'groupTextColor' || sp.type === 'entryTextColor') {
    const isGroup = sp.type === 'groupTextColor';
    const curColor = isGroup ? (state.store.settings.groupTextColor || '') : (state.store.settings.entryTextColor || '');
    const title = isGroup ? '选择分组文字颜色' : '选择条目文字颜色';
    const nativeVal = /^#[0-9a-fA-F]{6}$/.test(curColor) ? curColor : '#6366f1';

    const itemsHtml = TEXT_COLOR_PRESETS.map((c) => {
      const active = curColor.toLowerCase() === c.value.toLowerCase();
      return `
        <button type='button' class='td-select-option ${active ? 'active' : ''}' data-action='select-popup-pick' data-value='${escapeHtml(c.value)}'>
          <span class='td-select-option-left'><span class='td-swatch' style='background:${escapeHtml(c.value || 'var(--td-text)')};'></span><span class='td-select-option-name'>${escapeHtml(c.name)}</span></span>
          <span class='td-select-option-code'>${escapeHtml(c.value || '跟随主题')}</span>
        </button>`;
    }).join('');

    layer.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>${title}</div><button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          <div class='td-field' style='padding:10px;border-radius:11px;background:var(--td-surface);border:1px solid var(--td-border-strong);'>
            <label class='td-label'>自定义颜色（支持粘贴 #RRGGBB / rgb(...) / 颜色名）</label>
            <div style='display:flex;align-items:center;gap:6px;'>
              <input type='color' class='td-color-native' id='td-sp-color-native' value='${escapeHtml(nativeVal)}' />
              <input type='text' class='td-input' id='td-sp-color-input' placeholder='粘贴颜色值，留空恢复默认' value='${escapeHtml(curColor)}' style='flex:1;font-family:ui-monospace,monospace;font-size:13.5px;' />
              <button type='button' class='td-btn primary' data-action='select-popup-apply-color'>应用</button>
            </div>
          </div>
          <div class='td-select-list td-scroll' style='max-height:310px;overflow-y:auto;'>${itemsHtml}</div>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
  }
}

export const settingsUiModule = {
  renderModal(m, modalLayerEl) {
    if (m.type !== 'settings') return false;
    const prevScroll = modalLayerEl.querySelector('.td-modal-body')?.scrollTop || 0;
    const s = state.store.settings;
    const themeObj = THEME_OPTIONS.find((t) => t.id === (s.theme || 'dark')) || THEME_OPTIONS[0];
    const orbStyleVal = s.orbStyle || 'indigo';
    const orbStylePreset = ORB_STYLE_OPTIONS.find((o) => o.id === orbStyleVal);
    const orbSwatch = orbStylePreset ? orbStylePreset.swatch : orbStyleVal;
    const orbStyleLabel = orbStylePreset ? orbStylePreset.name : `自定义 (${orbStyleVal})`;
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
    const takeoverNativeToast = !!s.takeoverNativeToast;
    const nativeToastThemeObj = NATIVE_TOAST_THEME_OPTIONS.find((o) => o.id === (s.nativeToastTheme || 'glass')) || NATIVE_TOAST_THEME_OPTIONS[0];
    const nativeToastPosObj = NATIVE_TOAST_POS_OPTIONS.find((o) => o.id === (s.nativeToastPosition || 'top-right')) || NATIVE_TOAST_POS_OPTIONS[0];
    const tdToastThemeObj = TOAST_THEME_OPTIONS.find((o) => o.id === (s.tdToastTheme || 'panel')) || TOAST_THEME_OPTIONS[0];
    const tdSilentToast = !!s.tdSilentToast;
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
            <div class='td-setting-row'><div style='display:flex;align-items:center;gap:10px;'><span class='td-swatch' style='background:${escapeHtml(orbSwatch)};'></span><div><div class='td-setting-title'>悬浮球颜色样式</div><div class='td-setting-desc'>当前：${escapeHtml(orbStyleLabel)}</div></div></div><button type='button' class='td-btn sm' data-action='open-select-popup' data-select-type='orbStyle'>选择</button></div>
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
            <label class='td-label'>插件通知优化（徽标：TD · 顶部居中）</label>
            <div class='td-setting-row'>
              <div style='display:flex;align-items:center;gap:10px;min-width:0;flex:1;'>
                <span class='td-swatch' style='background:${escapeHtml(tdToastThemeObj.swatch)};'></span>
                <div>
                  <div class='td-setting-title'>插件通知 UI 主题</div>
                  <div class='td-setting-desc'>当前：${escapeHtml(tdToastThemeObj.name)}</div>
                </div>
              </div>
              <div style='display:flex;gap:5px;flex-shrink:0;'>
                <button type='button' class='td-btn sm' data-action='preview-td-toast'>测试</button>
                <button type='button' class='td-btn sm' data-action='open-select-popup' data-select-type='tdToastTheme'>选择</button>
              </div>
            </div>
            <div class='td-setting-row'>
              <div>
                <div class='td-setting-title'>静默通知</div>
                <div class='td-setting-desc'>开启后仅警告和报错信息才弹窗通知，普通/成功提示仅记入运行日志</div>
              </div>
              <button type='button' class='td-switch ${tdSilentToast ? 'on' : ''}' data-action='toggle-td-silent-toast'></button>
            </div>
          </div>

          <div class='td-field'>
            <label class='td-label'>酒馆原生界面辅助</label>
            <div class='td-setting-row'>
              <div>
                <div class='td-setting-title'>折叠酒馆原生预设设定区域</div>
                <div class='td-setting-desc'>将酒馆预设下拉框下方的原生设定区域折叠，保留预设条目（可随时点横条原样展开）</div>
              </div>
              <button type='button' class='td-switch ${collapseNative ? 'on' : ''}' data-action='toggle-native-preset-collapse'></button>
            </div>
            <div class='td-setting-row'>
              <div>
                <div class='td-setting-title'>接管酒馆全部 UI 通知</div>
                <div class='td-setting-desc'>开启后替换酒馆原生通知弹窗（徽标：ST，默认右上角以防与插件通知混淆）</div>
              </div>
              <button type='button' class='td-switch ${takeoverNativeToast ? 'on' : ''}' data-action='toggle-native-toast-takeover'></button>
            </div>
            <div class='td-setting-row' data-role='native-toast-sub' style='display:${takeoverNativeToast ? 'flex' : 'none'};'>
              <div style='display:flex;align-items:center;gap:10px;min-width:0;flex:1;'>
                <span class='td-swatch' style='background:${escapeHtml(nativeToastThemeObj.swatch)};'></span>
                <div>
                  <div class='td-setting-title'>酒馆通知 UI 主题</div>
                  <div class='td-setting-desc'>当前：${escapeHtml(nativeToastThemeObj.name)}</div>
                </div>
              </div>
              <div style='display:flex;gap:5px;flex-shrink:0;'>
                <button type='button' class='td-btn sm' data-action='preview-native-toast'>测试</button>
                <button type='button' class='td-btn sm' data-action='open-select-popup' data-select-type='nativeToastTheme'>选择</button>
              </div>
            </div>
            <div class='td-setting-row' data-role='native-toast-pos-sub' style='display:${takeoverNativeToast ? 'flex' : 'none'};'>
              <div>
                <div class='td-setting-title'>酒馆通知显示位置</div>
                <div class='td-setting-desc'>当前：${escapeHtml(nativeToastPosObj.name)}</div>
              </div>
              <button type='button' class='td-btn sm' data-action='open-select-popup' data-select-type='nativeToastPosition'>选择位置</button>
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
    return true;
  },

  renderPreview(previewLayerEl) {
    if (state.previewCtx?.type !== 'orbCrop') return false;
    const crop = state.previewCtx;
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>裁剪悬浮球图片</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
        <div class='td-modal-body' style='align-items:center;'>
          <div style='font-size:12px;color:var(--td-text-muted);text-align:center;'>拖动图片调整中心位置，滑动下方滑块缩放大小</div>
          <div class='td-crop-stage' id='td-crop-stage'><canvas class='td-crop-canvas' id='td-crop-canvas' width='240' height='240'></canvas></div>
          <div style='width:100%;'>
            <label class='td-label' data-role='crop-zoom-label'>缩放倍数 (${Math.round((crop.zoom || 1) * 100)}%)</label>
            <input class='td-range' id='td-crop-zoom' type='range' min='50' max='300' value='${Math.round((crop.zoom || 1) * 100)}' />
          </div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='orb-crop-reset'>重置居中</button>
          <button class='td-btn' data-action='close-preview'>取消</button>
          <button class='td-btn primary' data-action='orb-crop-confirm'>${ICONS.check} 保存头像</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    bindOrbCropPointerEvents(previewLayerEl);
    drawOrbCropCanvas();
    return true;
  },

  handleClick(e, actionEl, action) {
    const panelMainEl = uiCtx.getPanelMainEl();
    const modalLayerEl = uiCtx.getModalLayer();
    const previewLayerEl = uiCtx.getPreviewLayer();
    const selectLayerEl = uiCtx.getSelectLayer();

    if (action === 'open-settings') { state.modal = { type: 'settings' }; uiCtx.renderModal(); return true; }
    if (action === 'trigger-orb-upload') { modalLayerEl?.querySelector('#td-orb-img-input')?.click(); return true; }
    if (action === 'clear-orb-image') { state.store.settings.orbImage = ''; saveStore(state.store); uiCtx.renderOrb(); uiCtx.renderModal(); notify('info', '已恢复默认悬浮球图标'); return true; }

    if (action === 'orb-crop-reset' && state.previewCtx?.type === 'orbCrop') {
      state.previewCtx.zoom = 1;
      state.previewCtx.offsetX = 0;
      state.previewCtx.offsetY = 0;
      const zr = previewLayerEl?.querySelector('#td-crop-zoom');
      if (zr) zr.value = '100';
      const zl = previewLayerEl?.querySelector("[data-role='crop-zoom-label']");
      if (zl) zl.textContent = '缩放倍数 (100%)';
      drawOrbCropCanvas();
      return true;
    }
    if (action === 'orb-crop-confirm' && state.previewCtx?.type === 'orbCrop') {
      try {
        const dataUrl = exportCroppedOrbDataUrl(state.previewCtx);
        state.store.settings.orbImage = dataUrl;
        state.store.settings.orbImageFit = 'cover';
        saveStore(state.store);
        state.previewCtx = null;
        uiCtx.renderPreviewModal();
        uiCtx.renderOrb();
        if (state.modal?.type === 'settings') uiCtx.renderModal();
        notify('success', '悬浮球图片已裁剪并应用');
      } catch (err) {
        logError('裁剪悬浮球图片失败', err);
        notify('error', `裁剪失败: ${err.message || err}`);
      }
      return true;
    }

    if (action === 'open-select-popup') { state.selectPopup = { type: actionEl.getAttribute('data-select-type') }; renderSelectPopup(); return true; }
    if (action === 'close-select-popup') { state.selectPopup = null; renderSelectPopup(); return true; }
    if (action === 'move-by-number'
      && (state.selectPopup?.type === 'movePromptTarget' || state.selectPopup?.type === 'moveWbTarget')) {
      const val = Number(selectLayerEl?.querySelector('#td-move-idx-input')?.value);
      if (Number.isNaN(val) || val < 1) { notify('warning', '请输入有效序号（>= 1）'); return true; }
      applyMoveTargetPick(state.selectPopup, val - 1);
      return true;
    }
    if (action === 'select-popup-pick' && state.selectPopup) {
      const val = actionEl.getAttribute('data-value') || '', t = state.selectPopup.type;
      if (t === 'movePromptTarget' || t === 'moveWbTarget') { applyMoveTargetPick(state.selectPopup, val); return true; }
      if (t === 'theme') state.store.settings.theme = val || 'dark';
      else if (t === 'orbStyle') state.store.settings.orbStyle = val || 'indigo';
      else if (t === 'groupTextColor') state.store.settings.groupTextColor = val;
      else if (t === 'entryTextColor') state.store.settings.entryTextColor = val;
      else if (t === 'topBarPosition') state.store.settings.topBarPosition = val || 'after_extensions';
      else if (t === 'tdToastTheme') state.store.settings.tdToastTheme = val || 'panel';
      else if (t === 'nativeToastTheme') state.store.settings.nativeToastTheme = val || 'glass';
      else if (t === 'nativeToastPosition') state.store.settings.nativeToastPosition = val || 'top-right';
      saveStore(state.store); uiCtx.applyThemeAttributes(); uiCtx.syncTopBarUI();
      state.selectPopup = null; renderSelectPopup();
      if (state.modal?.type === 'settings') uiCtx.renderModal();
      return true;
    }
    if (action === 'select-popup-apply-color' && state.selectPopup) {
      const inp = selectLayerEl?.querySelector('#td-sp-color-input'), parsed = normalizeColorInput(inp ? inp.value : '');
      if (!parsed.ok) { notify('warning', '颜色格式无效，支持 #RRGGBB、rgb(...) 或标准颜色名'); return true; }
      if (state.selectPopup.type === 'groupTextColor') state.store.settings.groupTextColor = parsed.value;
      else if (state.selectPopup.type === 'orbStyle') state.store.settings.orbStyle = parsed.value || 'indigo';
      else state.store.settings.entryTextColor = parsed.value;
      saveStore(state.store); uiCtx.applyThemeAttributes();
      state.selectPopup = null; renderSelectPopup();
      if (state.modal?.type === 'settings') uiCtx.renderModal();
      notify('success', parsed.value ? `已应用颜色 ${parsed.value}` : '已恢复默认颜色');
      return true;
    }

    if (action === 'toggle-td-silent-toast') {
      const nextVal = !state.store.settings.tdSilentToast;
      state.store.settings.tdSilentToast = nextVal;
      saveStore(state.store);
      syncNotifyRuntimeConfig(state.store.settings);
      actionEl.classList.toggle('on', nextVal);
      notify(nextVal ? 'warning' : 'info', nextVal ? '已开启静默通知：仅警告和报错弹窗' : '已关闭静默通知：恢复全部插件弹窗', { forceShow: true });
      return true;
    }
    if (action === 'preview-td-toast') {
      notify('success', '这是一条 TavernDeck 插件通知预览', { forceShow: true });
      return true;
    }
    if (action === 'toggle-native-preset-collapse') {
      const nextVal = !state.store.settings.collapseNativePresetSettings;
      state.store.settings.collapseNativePresetSettings = nextVal;
      saveStore(state.store); actionEl.classList.toggle('on', nextVal); syncNativePresetCollapse();
      notify('info', nextVal ? '已折叠酒馆原生预设设定区域' : '已展开酒馆原生预设设定区域');
      return true;
    }
    if (action === 'toggle-native-toast-takeover') {
      const nextVal = !state.store.settings.takeoverNativeToast;
      state.store.settings.takeoverNativeToast = nextVal;
      saveStore(state.store);
      actionEl.classList.toggle('on', nextVal);
      syncNativeToastHook();
      const themeRow = modalLayerEl?.querySelector("[data-role='native-toast-sub']");
      const posRow = modalLayerEl?.querySelector("[data-role='native-toast-pos-sub']");
      if (themeRow) themeRow.style.display = nextVal ? 'flex' : 'none';
      if (posRow) posRow.style.display = nextVal ? 'flex' : 'none';
      if (nextVal) {
        const t = (typeof toastr !== 'undefined' ? toastr : null) || window.toastr;
        if (t && typeof t.info === 'function') t.info('酒馆原生通知已由 TavernDeck 接管美化', 'SillyTavern');
        else showToastElement({ channel: 'native', kind: 'info', title: 'SillyTavern', message: '酒馆原生通知已由 TavernDeck 接管美化', sourceBadge: 'ST' });
      } else {
        notify('info', '已恢复酒馆原生通知样式');
      }
      return true;
    }
    if (action === 'preview-native-toast') {
      const t = (typeof toastr !== 'undefined' ? toastr : null) || window.toastr;
      if (t && typeof t.info === 'function' && state.store.settings.takeoverNativeToast) {
        t.info('这是一条模拟的酒馆原生 UI 通知预览', 'SillyTavern');
      } else {
        showToastElement({ channel: 'native', kind: 'info', title: 'SillyTavern', message: '这是一条模拟的酒馆原生 UI 通知预览', sourceBadge: 'ST' });
      }
      return true;
    }
    if (action === 'toggle-entry-switch') {
      const key = actionEl.getAttribute('data-key'), s = state.store.settings;
      const cur = (key === 'enableExtButton' || key === 'enableTopBarButton') ? !!s[key] : s[key] !== false;
      const nextVal = !cur;
      if (!nextVal) {
        const nextOrb = key === 'showOrb' ? false : s.showOrb !== false;
        const nextExt = key === 'enableExtButton' ? false : !!s.enableExtButton;
        const nextTop = key === 'enableTopBarButton' ? false : !!s.enableTopBarButton;
        if (!nextOrb && !nextExt && !nextTop) { notify('warning', '悬浮球、顶部栏按钮与魔法棒拓展按钮至少需保留一项开启'); return true; }
      }
      s[key] = nextVal; saveStore(state.store);
      actionEl.classList.toggle('on', nextVal);
      if (key === 'showOrb') uiCtx.applyOrbVisualState();
      if (key === 'enableExtButton') uiCtx.syncExtensionButton();
      if (key === 'enableTopBarButton') {
        uiCtx.syncTopBarUI();
        const posRow = modalLayerEl?.querySelector("[data-role='topbar-pos-row']");
        if (posRow) posRow.style.display = nextVal ? 'flex' : 'none';
      }
      return true;
    }
    if (action === 'toggle-drag-sort') {
      const nextVal = !state.store.settings.enableDragSort;
      state.store.settings.enableDragSort = nextVal;
      saveStore(state.store); actionEl.classList.toggle('on', nextVal); uiCtx.renderMain();
      return true;
    }
    if (action === 'toggle-orb-sliders-lock') {
      const nextVal = !state.store.settings.unlockOrbSliders;
      state.store.settings.unlockOrbSliders = nextVal;
      saveStore(state.store);
      actionEl.classList.toggle('on', nextVal);
      const box = modalLayerEl?.querySelector("[data-role='orb-sliders-box']");
      const szRange = modalLayerEl?.querySelector('#td-size-range');
      const opRange = modalLayerEl?.querySelector('#td-opacity-range');
      const szLbl = modalLayerEl?.querySelector("[data-role='orb-size-label']");
      const opLbl = modalLayerEl?.querySelector("[data-role='opacity-label']");
      if (box) box.classList.toggle('is-locked', !nextVal);
      if (szRange) szRange.disabled = !nextVal;
      if (opRange) opRange.disabled = !nextVal;
      const sz = getOrbSize();
      const op = Math.round((state.store.settings.orbOpacity ?? 0.96) * 100);
      if (szLbl) szLbl.textContent = `悬浮球大小 (${sz}px)${nextVal ? '' : ' · 已锁定'}`;
      if (opLbl) opLbl.textContent = `悬浮球透明度 (${op}%)${nextVal ? '' : ' · 已锁定'}`;
      return true;
    }
    if (action === 'apply-panel-preset-default') {
      const def = uiCtx.getDefaultPanelSize();
      const wEl = modalLayerEl?.querySelector('#td-panel-width-input');
      const hEl = modalLayerEl?.querySelector('#td-panel-height-input');
      if (wEl) wEl.value = String(def.w);
      if (hEl) hEl.value = String(def.h);
      return true;
    }
    if (action === 'apply-panel-size') {
      const vp = uiCtx.getViewportRect();
      const maxW = Math.max(280, Math.round(vp.w - 8));
      const maxH = Math.max(280, Math.round(vp.h - 8));
      const rawW = Number(modalLayerEl?.querySelector('#td-panel-width-input')?.value);
      const rawH = Number(modalLayerEl?.querySelector('#td-panel-height-input')?.value);
      if (Number.isNaN(rawW) || Number.isNaN(rawH)) {
        notify('warning', '请输入有效的长宽数字');
        return true;
      }
      const nw = Math.max(280, Math.min(maxW, Math.round(rawW)));
      const nh = Math.max(280, Math.min(maxH, Math.round(rawH)));
      state.store.settings.fullscreen = false;
      state.store.settings.panelSize = { w: nw, h: nh };
      saveStore(state.store);
      uiCtx.repositionUI();
      const wEl = modalLayerEl?.querySelector('#td-panel-width-input');
      const hEl = modalLayerEl?.querySelector('#td-panel-height-input');
      if (wEl) wEl.value = String(nw);
      if (hEl) hEl.value = String(nh);
      const fsBtn = panelMainEl?.querySelector("[data-action='toggle-fullscreen']");
      if (fsBtn) { fsBtn.innerHTML = ICONS.maximize; fsBtn.title = '全屏显示'; }
      notify('success', `已将控制台调整为 ${nw} × ${nh} px`);
      return true;
    }
    if (action === 'toggle-collapse-group') {
      const nextVal = !(state.store.settings.collapseGroupActions !== false);
      state.store.settings.collapseGroupActions = nextVal;
      state.activeGroupMenuId = null; saveStore(state.store);
      actionEl.classList.toggle('on', nextVal);
      const sub = modalLayerEl?.querySelector("[data-role='collapse-group-sub']");
      if (sub) sub.style.display = nextVal ? 'flex' : 'none';
      uiCtx.renderMainBodyOnly();
      return true;
    }
    if (action === 'toggle-collapsed-group-item') {
      const name = actionEl.getAttribute('data-item'); if (!name) return true;
      const cfg = state.store.settings.collapsedGroupItems || { quickToggle: false, add: true, subgroup: true, edit: true, delete: true };
      cfg[name] = !cfg[name]; state.store.settings.collapsedGroupItems = cfg;
      saveStore(state.store); actionEl.classList.toggle('on', !!cfg[name]); uiCtx.renderMainBodyOnly();
      return true;
    }
    if (action === 'toggle-collapse-entry') {
      const nextVal = !(state.store.settings.collapseEntryActions !== false);
      state.store.settings.collapseEntryActions = nextVal;
      state.activeItemDrawerId = null; saveStore(state.store);
      actionEl.classList.toggle('on', nextVal);
      const sub = modalLayerEl?.querySelector("[data-role='collapse-entry-sub']");
      if (sub) sub.style.display = nextVal ? 'flex' : 'none';
      uiCtx.renderMainBodyOnly();
      return true;
    }
    if (action === 'toggle-collapsed-entry-item') {
      const name = actionEl.getAttribute('data-item'); if (!name) return true;
      const cfg = state.store.settings.collapsedEntryItems || { badge: true, preview: false, remove: true };
      cfg[name] = !cfg[name]; state.store.settings.collapsedEntryItems = cfg; state.activeItemDrawerId = null;
      saveStore(state.store); actionEl.classList.toggle('on', !!cfg[name]); uiCtx.renderMainBodyOnly();
      return true;
    }
    if (action === 'reset-layout') {
      state.store.settings.orbPosition = null; state.store.settings.panelPosition = null; state.store.settings.panelSize = null;
      state.store.settings.fullscreen = false; state.store.settings.orbSize = 50;
      saveStore(state.store); uiCtx.repositionUI(); uiCtx.renderMain();
      if (state.modal?.type === 'settings') uiCtx.renderModal();
      notify('success', '窗口与悬浮球已重置');
      return true;
    }
    if (action === 'clear-all-data') {
      openConfirm({
        title: '重置方案数据确认', message: '确定要清空全部方案、分组与预设绑定关系吗？（预设快照将保留）此操作不可撤销。', confirmText: '确认重置',
        onConfirm: () => {
          const defId = genId();
          state.store.schemes = [{ id: defId, name: '默认方案', groups: [] }];
          state.store.presetBindings = {}; state.store.activeSchemeByPreset = {}; state.store.activeSchemeId = defId;
          saveStore(state.store); state.modal = null; uiCtx.renderModal(); uiCtx.renderMain(); notify('info', '已重置全部方案数据');
        },
      });
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    const modalLayerEl = uiCtx.getModalLayer();
    const orbEl = uiCtx.getOrbEl();

    if (id === 'td-crop-zoom' && state.previewCtx?.type === 'orbCrop') {
      const z = Math.max(50, Math.min(300, Number(target.value) || 100));
      state.previewCtx.zoom = z / 100;
      const lbl = uiCtx.getPreviewLayer()?.querySelector("[data-role='crop-zoom-label']");
      if (lbl) lbl.textContent = `缩放倍数 (${z}%)`;
      drawOrbCropCanvas();
      return true;
    }
    if (id === 'td-sp-color-native') { const txt = uiCtx.getSelectLayer()?.querySelector('#td-sp-color-input'); if (txt) txt.value = target.value; return true; }
    if (id === 'td-sp-color-input') { const nat = uiCtx.getSelectLayer()?.querySelector('#td-sp-color-native'); if (nat && /^#[0-9a-fA-F]{6}$/.test(target.value.trim())) nat.value = target.value.trim(); return true; }
    if (id === 'td-size-range') {
      if (!state.store.settings.unlockOrbSliders) return true;
      const sz = Math.max(34, Math.min(72, Number(target.value) || 50));
      state.store.settings.orbSize = sz; uiCtx.applyOrbVisualState();
      const label = modalLayerEl?.querySelector("[data-role='orb-size-label']"); if (label) label.textContent = `悬浮球大小 (${sz}px)`;
      return true;
    }
    if (id === 'td-opacity-range') {
      if (!state.store.settings.unlockOrbSliders) return true;
      const val = Math.max(35, Math.min(100, Number(target.value) || 96)) / 100;
      state.store.settings.orbOpacity = val; if (orbEl) orbEl.style.opacity = String(val);
      const label = modalLayerEl?.querySelector("[data-role='opacity-label']"); if (label) label.textContent = `悬浮球透明度 (${Math.round(val * 100)}%)`;
      return true;
    }
    return false;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    if (id === 'td-orb-img-input') {
      const file = target.files?.[0];
      target.value = '';
      if (!file) return true;
      loadOrbImageForCrop(file).then((res) => {
        if (res.isGif) {
          state.store.settings.orbImage = res.rawUrl;
          state.store.settings.orbImageFit = 'cover';
          saveStore(state.store); uiCtx.renderOrb(); uiCtx.renderModal(); notify('success', 'GIF 悬浮球图片已应用');
        } else {
          state.previewKey = null;
          state.snapshotDetailId = null;
          state.previewCtx = { type: 'orbCrop', img: res.img, zoom: 1, offsetX: 0, offsetY: 0 };
          uiCtx.renderPreviewModal();
        }
      }).catch((err) => { logError('加载悬浮球图片失败', err); notify('error', err.message || '图片加载失败'); });
      return true;
    }
    if (id === 'td-opacity-range' || id === 'td-size-range') { saveStore(state.store); return true; }
    return false;
  },
};
