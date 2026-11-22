import {
  escapeHtml, notify, normalizeColorInput, findBestMatchingName,
  computeLineDiff, cloneWorldbookEntry, formatKeysInput, parseKeysInput,
  hasTH, callTH, getST, copyToClipboard, downloadTextFile, logWarn, logError,
} from './utils.js';
import { state, saveStore, saveMergeDraft, clearMergeDraft } from './store.js';
import { refreshAllCatalogs, refreshWorldbookCatalog } from './catalog.js';
import { saveInUseToPreset } from './preset-merge.js';
import { buildWorldbookDiffSession, executeWorldbookStitch } from './worldbook-merge.js';
import {
  PRESET_SYSTEM_IDS, PRESET_SETTING_FIELDS, getPresetSummaryList, getPresetDetail,
  savePresetDetail, createNewPresetSafe, renameSavedPresetSafe, deleteSavedPresetSafe,
  exportPresetFile, importPresetFromFile, buildNewPromptEntry,
  movePromptsBatchBeforeIndex, insertFromUnusedAt,
} from './preset-manager.js';
import {
  WB_POSITION_OPTIONS, getWorldbookBindingsSnapshot, toggleGlobalWorldbook,
  toggleCharPrimaryWorldbook, toggleCharAdditionalWorldbook, bindChatWorldbookSafe,
  createOrBindChatWorldbookSafe, createWorldbookSafe, renameWorldbookSafe,
  deleteWorldbookSafe, exportWorldbookFile, importWorldbookFromFile,
  buildDefaultWorldbookEntry, disableAllRecursionInEntries,
  moveWorldbookEntriesBatchBeforeIndex, isInActiveChat,
} from './worldbook-manager.js';
import { getTopBarPositionOptions } from './native-ui.js';
import {
  runAiPresetEdit, runAiWorldbookEdit, runAiMvuUpdate,
  getAvailableApiTargets, fetchModelsForApiTarget, normalizeApiTargetValue,
} from './ai-preset-edit.js';
import { getDevLogs, clearDevLogs, formatLogsReport } from './dev-tools.js';
import {
  ICONS, THEME_OPTIONS, ORB_STYLE_OPTIONS, TEXT_COLOR_PRESETS,
  TOAST_THEME_OPTIONS, NATIVE_TOAST_THEME_OPTIONS, NATIVE_TOAST_POS_OPTIONS,
  editHistory, readPreviewSnapshot, pushEditSnapshot, updatePreviewHistoryButtons,
} from './ui-views.js';
import { initWbMergeCustomCtx, renderWbMergeCustomModal } from './merge-ui.js';

let ctx = {
  getModalLayer: () => null,
  getPreviewLayer: () => null,
  getSelectLayer: () => null,
  getViewportRect: () => ({ x: 0, y: 0, w: window.innerWidth || 1200, h: window.innerHeight || 800 }),
  syncOverlayBounds: () => {},
  renderMain: () => {},
  renderModal: () => {},
  renderPreviewModal: () => {},
  renderOrb: () => {},
  syncTopBarUI: () => {},
  applyThemeAttributes: () => {},
  openConfirm: () => {},
  performSwitchPreset: () => {},
};

let cropDrag = null;

export function setUiManagersContext(nextCtx) {
  ctx = Object.assign(ctx, nextCtx || {});
}

export function confirmDiscardDirtyModal(onProceed) {
  const m = state.modal;
  if (m && (m.type === 'presetMerge' || m.type === 'wbMerge') && m.session?.dirty) {
    const isPreset = m.type === 'presetMerge';
    const draftKey = isPreset ? 'preset' : 'worldbook';
    ctx.openConfirm({
      title: '未应用的缝合结果',
      message: `${isPreset ? '预设' : '世界书'}对比缝合「${m.session.oldName} ⇄ ${m.session.newName}」已有缝合修改，但尚未点击「覆盖」或「另存为」写入目标。直接关闭不会生效，是否暂存草稿？`,
      confirmText: '放弃并关闭',
      confirmClass: 'danger',
      extraButton: {
        text: '暂存草稿并关闭',
        className: 'primary',
        onClick: () => {
          saveMergeDraft(draftKey, m.session);
          notify('info', '已暂存缝合草稿，下次打开对比缝合可继续');
          onProceed();
        },
      },
      onConfirm: () => {
        if (state.mergeDrafts && state.mergeDrafts[draftKey] === m.session) {
          clearMergeDraft(draftKey);
        }
        onProceed();
      },
    });
    return;
  }
  if (!m || !m.dirty || (m.type !== 'presetDetail' && m.type !== 'worldbookDetail')) {
    onProceed();
    return;
  }
  const isPreset = m.type === 'presetDetail';
  const targetName = isPreset
    ? (m.presetName === 'in_use' ? `实时预设 (${state.presetName})` : m.presetName)
    : m.bookName;
  ctx.openConfirm({
    title: '未保存修改确认',
    message: `${isPreset ? '预设' : '世界书'}「${targetName}」有未保存的修改，关闭后修改将会丢失，是否保存？`,
    confirmText: '放弃修改',
    confirmClass: 'danger',
    extraButton: {
      text: '保存并关闭',
      className: 'primary',
      onClick: () => {
        if (isPreset) {
          savePresetDetail(m.presetName, m.data, true)
            .then(() => {
              m.dirty = false;
              notify('success', `已保存预设「${m.presetName}」`);
              return refreshAllCatalogs();
            })
            .then(() => {
              ctx.renderMain();
              onProceed();
            })
            .catch((err) => {
              logError('保存预设详情失败', err);
              notify('error', `保存失败: ${err.message || err}`);
            });
        } else {
          callTH('replaceWorldbook', m.bookName, m.entries, { render: 'debounced' })
            .then(() => {
              m.dirty = false;
              notify('success', `已保存世界书「${m.bookName}」`);
              return refreshWorldbookCatalog(false);
            })
            .then(() => {
              ctx.renderMain();
              onProceed();
            })
            .catch((err) => {
              logError('保存世界书失败', err);
              notify('error', `保存世界书失败: ${err.message || err}`);
            });
        }
      },
    },
    onConfirm: onProceed,
  });
}

export function drawOrbCropCanvas() {
  const previewLayerEl = ctx.getPreviewLayer();
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

export function bindOrbCropPointerEvents(previewLayerEl) {
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

export function renderSelectPopupView() {
  const layer = ctx.getSelectLayer();
  if (!layer) return;
  const sp = state.selectPopup;
  if (!sp || !state.panelOpen) {
    layer.classList.remove('is-open');
    layer.innerHTML = '';
    return;
  }
  layer.classList.add('is-open');

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
    ctx.syncOverlayBounds();
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
    ctx.syncOverlayBounds();
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
    ctx.syncOverlayBounds();
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
    ctx.syncOverlayBounds();
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
    ctx.syncOverlayBounds();
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
    ctx.syncOverlayBounds();
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
    ctx.syncOverlayBounds();
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
    ctx.syncOverlayBounds();
  }
}

export function updateWbMergeBody() {
  const modalLayerEl = ctx.getModalLayer();
  if (!modalLayerEl || !state.modal || state.modal.type !== 'wbMerge') return;
  const session = state.modal.session;
  const box = modalLayerEl.querySelector("[data-role='wb-merge-list']");
  const ctrlBox = modalLayerEl.querySelector('.td-picker-controls');
  const toggleBtn = modalLayerEl.querySelector("[data-action='toggle-wb-merge-controls']");
  const summaryEl = modalLayerEl.querySelector("[data-role='wb-merge-summary-text']");
  if (!box) return;

  if (ctrlBox) ctrlBox.classList.toggle('is-open', !!session.controlsOpen);
  if (toggleBtn) toggleBtn.classList.toggle('is-active', !!session.controlsOpen);
  const dirtyEl = modalLayerEl.querySelector("[data-role='wb-merge-dirty']");
  if (dirtyEl) {
    const customCnt = session.entries.filter((e) => e.choice === 'custom').length;
    dirtyEl.textContent = session.dirty
      ? `有未应用缝合${customCnt > 0 ? `（含手动缝合 ${customCnt} 项）` : ''} · 尚未写入`
      : '';
    dirtyEl.style.display = session.dirty ? 'block' : 'none';
  }
  if (summaryEl) {
    const totalDiff = session.stats.conflict + session.stats.added + session.stats.removed;
    const qText = (session.query || '').trim();
    summaryEl.textContent = `冲突${session.stats.conflict}/增${session.stats.added}/删${session.stats.removed}${totalDiff === 0 ? ' (完全一致)' : ''}${qText ? ` · 搜"${qText}"` : ''}`;
  }

  modalLayerEl.querySelectorAll("[data-action='set-wb-merge-filter']").forEach((chip) => {
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
      || (it.oldEntry?.content || '').toLowerCase().includes(q)
      || (it.newEntry?.content || '').toLowerCase().includes(q)
      || formatKeysInput(it.newEntry?.strategy?.keys).toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    box.innerHTML = "<div class='td-group-empty'>当前筛选条件下没有世界书条目</div>";
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
      if (it.status === 'conflict' && (it.oldEntry?.content || '') !== (it.newEntry?.content || '')) {
        const lines = computeLineDiff(it.oldEntry?.content || '', it.newEntry?.content || '');
        diffHtml = `<div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`;
      } else if (it.status === 'added' && it.newEntry?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line add'>${escapeHtml(it.newEntry.content)}</div></div>`;
      } else if (it.status === 'removed' && it.oldEntry?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line del'>${escapeHtml(it.oldEntry.content)}</div></div>`;
      }

      const actionsHtml = it.status === 'same' ? '' : `
        <div class='td-merge-actions'>
          ${it.oldEntry ? `<button type='button' class='td-merge-choice ${it.choice === 'old' ? 'active-old' : ''}' data-action='set-wb-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='old'>保留旧版</button>` : ''}
          <button type='button' class='td-merge-choice ${it.choice === 'new' ? 'active-new' : ''}' data-action='set-wb-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='new'>${it.status === 'removed' ? '确认删除' : '采用新版'}</button>
          <button type='button' class='td-merge-choice ${it.choice === 'custom' ? 'active-custom' : ''}' data-action='open-wb-merge-custom' data-entry-key='${escapeHtml(it.key)}'>编辑缝合</button>
          <button type='button' class='td-merge-choice' data-action='open-wb-merge-custom-content-only' data-entry-key='${escapeHtml(it.key)}'>只缝合内容</button>
        </div>`;

      bodyHtml = `<div class='td-merge-body'><div style='font-size:11.5px;color:var(--td-text-muted);'>差异原因：${escapeHtml(it.diffReasons.join(' · ') || '无差异')}</div>${actionsHtml}${diffHtml}</div>`;
    }

    return `<div class='td-merge-card'><div class='td-merge-head' data-action='toggle-wb-merge-expand' data-entry-key='${escapeHtml(it.key)}'>${tag}<span class='td-merge-title' title='${escapeHtml(it.name)}'>${escapeHtml(it.name)}</span>${choiceTag}</div>${bodyHtml}</div>`;
  }).join('');
  if (prevScroll > 0) box.scrollTop = prevScroll;
}

function readMvuViewerState(m) {
  const charName = hasTH('getCurrentCharacterName') ? (callTH('getCurrentCharacterName') || '') : '';
  const inCharChat = !!(charName && isInActiveChat());
  if (!inCharChat) return { inCharChat: false, charName: '' };

  let lastMsgId = -1;
  try {
    if (hasTH('getLastMessageId')) lastMsgId = Number(callTH('getLastMessageId'));
    if (Number.isNaN(lastMsgId)) lastMsgId = -1;
  } catch (e) { lastMsgId = -1; }

  const hasMvuApi = !!(typeof window !== 'undefined' && window.Mvu && typeof window.Mvu.getMvuData === 'function');
  const tryReadFloor = (msgId) => {
    try {
      const opt = { type: 'message', message_id: msgId };
      if (hasMvuApi) return window.Mvu.getMvuData(opt);
      if (hasTH('getVariables')) return callTH('getVariables', opt);
    } catch (e) {}
    return null;
  };

  let rawData = null;
  let resolvedFloor = lastMsgId;
  let autoBacktracked = false;

  if (lastMsgId >= 0) {
    if (m.floor === 'latest' || m.floor === undefined || m.floor === null) {
      rawData = tryReadFloor(lastMsgId);
      if (!rawData || (typeof rawData === 'object' && !rawData.stat_data)) {
        for (let id = lastMsgId - 1; id >= 0; id--) {
          const cand = tryReadFloor(id);
          if (cand && typeof cand === 'object' && cand.stat_data) {
            rawData = cand;
            resolvedFloor = id;
            autoBacktracked = true;
            break;
          }
        }
      }
    } else {
      resolvedFloor = Math.max(0, Math.min(lastMsgId, Math.floor(Number(m.floor) || 0)));
      rawData = tryReadFloor(resolvedFloor);
    }
  }

  const charScopeId = getMvuCharScopeId(charName);
  const chatKey = getMvuChatKey(charName);
  const hasStatData = !!(rawData && typeof rawData === 'object' && rawData.stat_data && typeof rawData.stat_data === 'object');
  const displayObj = (m.onlyStatData && hasStatData) ? rawData.stat_data : rawData;
  return { inCharChat: true, charName, charScopeId, chatKey, hasMvuApi, lastMsgId, resolvedFloor, autoBacktracked, hasStatData, rawData, displayObj };
}

function extractMvuSnippetFromMessage(text) {
  const s = String(text || '');
  if (!s) return '';
  const unclosed = s.match(/<UpdateVariable[^>]*>([\s\S]*)$/i);
  if (unclosed && !/<\/UpdateVariable>/i.test(unclosed[0])) {
    return unclosed[1].trim();
  }
  const closed = s.match(/<UpdateVariable[^>]*>([\s\S]*?)<\/UpdateVariable>/i);
  if (closed && closed[1]) return closed[1].trim();
  const lines = s.split('\n').filter((l) => /^\s*_\.(set|add|insert|delete|move)\s*\(/.test(l));
  return lines.join('\n').trim();
}

function collectWorldbookMvuRuleCandidates() {
  const out = [];
  (state.catalog.worldbook?.groups || []).forEach((grp) => {
    (grp.items || []).forEach((item) => {
      const raw = item.raw;
      if (!raw || !raw.content) return;
      const nm = String(item.name || '');
      const ct = String(raw.content || '');
      const autoMatched = !!raw.enabled && (
        /UpdateVariable|_\.(set|add|insert|delete|move)\s*\(/i.test(ct)
        || (/变量|mvu/i.test(nm) && !/^\s*\[?initvar\]?/i.test(nm))
      );
      out.push({
        key: item.key,
        bookName: grp.bookName || grp.title || '',
        name: nm || `条目 #${item.uid}`,
        content: ct,
        enabled: !!raw.enabled,
        autoMatched,
      });
    });
  });
  return out;
}

async function saveFloorMvuData(floorId, nextData) {
  const opt = { type: 'message', message_id: floorId };
  if (typeof window !== 'undefined' && window.Mvu && typeof window.Mvu.replaceMvuData === 'function') {
    await window.Mvu.replaceMvuData(nextData, opt);
  } else if (hasTH('replaceVariables')) {
    callTH('replaceVariables', nextData, opt);
  } else {
    throw new Error('当前环境不支持 replaceMvuData 或 replaceVariables');
  }
  if (hasTH('refreshOneMessage')) {
    try { await callTH('refreshOneMessage', floorId); } catch (e) { logWarn('刷新楼层显示失败', e); }
  }
}

async function parseMvuCommandsPreview(cmdText, baseMvuData) {
  if (typeof window === 'undefined' || !window.Mvu || typeof window.Mvu.parseMessage !== 'function') {
    throw new Error('未检测到全局 window.Mvu.parseMessage 接口，请确认已启用 MVU 变量框架脚本');
  }
  const oldCopy = JSON.parse(JSON.stringify(baseMvuData || { initialized_lorebooks: {}, stat_data: {} }));
  const nextData = await window.Mvu.parseMessage(String(cmdText || ''), oldCopy);
  if (!nextData) {
    throw new Error('未解析出有效的变量更新（请检查是否包含合法的 _.set / _.add 等命令）');
  }
  const oldStat = JSON.stringify(oldCopy.stat_data ?? oldCopy, null, 2);
  const newStat = JSON.stringify(nextData.stat_data ?? nextData, null, 2);
  return { nextData, diffLines: computeLineDiff(oldStat, newStat) };
}

const STAR_OUTLINE_SVG = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/></svg>";
const STAR_FILLED_SVG = "<svg viewBox='0 0 24 24' fill='currentColor' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/></svg>";

function getMvuCharScopeId(charName) {
  try {
    if (hasTH('getCurrentCharacterId')) {
      const cid = callTH('getCurrentCharacterId');
      if (cid) return String(cid);
    }
  } catch (e) {}
  return String(charName || '__default__');
}

function getMvuChatKey(charName) {
  const charScope = getMvuCharScopeId(charName);
  let chatId = '';
  try {
    const st = getST();
    chatId = String(st?.getCurrentChatId?.() || st?.chatId || '').trim();
  } catch (e) {}
  return `${charScope}::${chatId || '__default__'}`;
}

function getMvuStarredList(chatKey) {
  const ext = (state.store.extensions = state.store.extensions || {});
  const map = (ext.mvuStarred = ext.mvuStarred || {});
  return Array.isArray(map[chatKey]) ? map[chatKey] : [];
}

function getOtherChatStarredCandidates(charScopeId, curChatKey) {
  const ext = state.store.extensions || {};
  const map = ext.mvuStarred || {};
  const prefix = `${charScopeId}::`;
  const merged = [];
  const seen = new Set();
  Object.keys(map).forEach((k) => {
    if (k !== curChatKey && k.startsWith(prefix) && Array.isArray(map[k])) {
      map[k].forEach((sk) => {
        if (!seen.has(sk)) { seen.add(sk); merged.push(sk); }
      });
    }
  });
  return merged;
}

function toggleMvuStarKey(chatKey, starKey) {
  const ext = (state.store.extensions = state.store.extensions || {});
  const map = (ext.mvuStarred = ext.mvuStarred || {});
  const list = Array.isArray(map[chatKey]) ? map[chatKey].slice() : [];
  const idx = list.indexOf(starKey);
  let starred = false;
  if (idx >= 0) list.splice(idx, 1);
  else { list.push(starKey); starred = true; }
  if (list.length > 0) map[chatKey] = list;
  else delete map[chatKey];
  saveStore(state.store);
  return starred;
}

function formatPartsDisplay(parts) {
  let out = '';
  (parts || []).forEach((p) => {
    const s = String(p);
    if (/^\d+$/.test(s) && out) out += `[${s}]`;
    else out += (out ? `.${s}` : s);
  });
  return out;
}

function getByPathParts(rootObj, parts) {
  let cur = rootObj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return { found: false, val: undefined };
    const k = parts[i];
    if (Array.isArray(cur)) {
      const idx = Number(k);
      if (Number.isNaN(idx) || idx < 0 || idx >= cur.length) return { found: false, val: undefined };
      cur = cur[idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, k)) return { found: false, val: undefined };
      cur = cur[k];
    }
  }
  return { found: true, val: cur };
}

function makeMvuStarInfo(pathParts, isStatRoot, hasStatData) {
  if (isStatRoot) return { starKey: `stat:${JSON.stringify(pathParts)}`, editInStat: true };
  if (hasStatData && pathParts[0] === 'stat_data' && pathParts.length > 1) {
    return { starKey: `stat:${JSON.stringify(pathParts.slice(1))}`, editInStat: true };
  }
  return { starKey: `raw:${JSON.stringify(pathParts)}`, editInStat: false };
}

function setByPathParts(rootObj, parts, newVal) {
  let cur = rootObj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur?.[parts[i]];
    if (cur === undefined || cur === null) throw new Error('目标路径不存在');
  }
  const lastKey = parts[parts.length - 1];
  if (Array.isArray(cur)) cur[Number(lastKey)] = newVal;
  else cur[lastKey] = newVal;
}

function matchesMvuFilter(path, val, q) {
  if (!q) return true;
  if (path.toLowerCase().includes(q)) return true;
  if (val === null || val === undefined || typeof val !== 'object') {
    return String(val).toLowerCase().includes(q);
  }
  const entries = Array.isArray(val) ? val.map((v, i) => [String(i), v]) : Object.entries(val);
  return entries.some(([k, v]) => matchesMvuFilter(`${path}.${k}`, v, q));
}

function collectMvuContainerPaths(obj, parts, outSet) {
  if (!obj || typeof obj !== 'object') return;
  const entries = Array.isArray(obj) ? obj.map((v, i) => [String(i), v]) : Object.entries(obj);
  entries.forEach(([k, v]) => {
    if (v && typeof v === 'object') {
      const nextParts = [...parts, k];
      outSet.add(JSON.stringify(nextParts));
      collectMvuContainerPaths(v, nextParts, outSet);
    }
  });
}

function renderMvuTreeHtml(obj, pathParts, displayPrefix, q, collapsedSet, nodeList, opts = {}) {
  const { starredSet = new Set(), isStatRoot = true, hasStatData = true } = opts;
  if (!obj || typeof obj !== 'object') {
    return `<div class='td-mvu-row'><span class='td-mvu-key'>值</span><span class='td-mvu-val'>${escapeHtml(String(obj))}</span></div>`;
  }
  const isArr = Array.isArray(obj);
  const entries = isArr ? obj.map((v, i) => [String(i), v]) : Object.entries(obj);
  if (entries.length === 0) return "<div class='td-group-empty'>当前变量对象为空</div>";

  const html = entries.map(([k, v]) => {
    const nextParts = [...pathParts, k];
    const keyId = JSON.stringify(nextParts);
    const displayPath = displayPrefix ? (isArr ? `${displayPrefix}[${k}]` : `${displayPrefix}.${k}`) : k;
    if (q && !matchesMvuFilter(displayPath, v, q)) return '';

    const { starKey, editInStat } = makeMvuStarInfo(nextParts, isStatRoot, hasStatData);
    const isStarred = starredSet.has(starKey);
    const canStar = isStatRoot || nextParts[0] !== 'stat_data' || nextParts.length > 1;
    const nid = String(nodeList.length);
    nodeList.push({
      keyId,
      starKey,
      displayPath,
      pathParts: editInStat && !isStatRoot ? nextParts.slice(1) : nextParts,
      editInStat,
      val: v,
    });

    const starBtn = canStar
      ? `<button type='button' class='td-icon-btn td-mvu-star ${isStarred ? 'is-starred' : ''}' data-action='mvu-toggle-star' data-starkey='${escapeHtml(starKey)}' title='${isStarred ? '取消加精' : '加精重点关注'}'>${isStarred ? STAR_FILLED_SVG : STAR_OUTLINE_SVG}</button>`
      : '';

    if (v !== null && typeof v === 'object') {
      const childIsArr = Array.isArray(v);
      const count = childIsArr ? v.length : Object.keys(v).length;
      const isCollapsed = !q && collapsedSet.has(keyId);
      const tuplePreview = childIsArr && count > 0 && count <= 2 && v.every((x) => x === null || typeof x !== 'object')
        ? `= ${v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' · ')}`
        : '';
      return `
        <div class='td-mvu-node ${isCollapsed ? 'is-collapsed' : ''}'>
          <div class='td-mvu-head' data-action='mvu-toggle-node' data-nid='${nid}'>
            <span class='td-chevron'>${ICONS.chevron}</span>
            <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(k)}</span>
            ${tuplePreview ? `<span class='td-mvu-preview' title='${escapeHtml(tuplePreview)}'>${escapeHtml(tuplePreview)}</span>` : ''}
            <span class='td-mvu-badge'>${childIsArr ? `[${count}]` : `{${count}}`}</span>
            ${starBtn}
            <button type='button' class='td-icon-btn' data-action='mvu-copy-val' data-nid='${nid}' title='复制此节点'>${ICONS.copy}</button>
          </div>
          ${isCollapsed ? '' : `<div class='td-mvu-children'>${renderMvuTreeHtml(v, nextParts, displayPath, q, collapsedSet, nodeList, opts)}</div>`}
        </div>`;
    }

    const typeCls = typeof v === 'number' ? 'is-num' : (typeof v === 'boolean' ? 'is-bool' : (v === null || v === undefined ? 'is-null' : 'is-str'));
    const valText = typeof v === 'string' ? (v === '' ? '""' : v) : String(v);
    return `
      <div class='td-mvu-row'>
        <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(k)}</span>
        <span class='td-mvu-val ${typeCls}' title='${escapeHtml(valText)}'>${escapeHtml(valText)}</span>
        <div class='td-mvu-ops'>
          ${starBtn}
          <button type='button' class='td-icon-btn' data-action='mvu-edit-val' data-nid='${nid}' title='修改数值'>${ICONS.edit}</button>
          <button type='button' class='td-icon-btn' data-action='mvu-copy-val' data-nid='${nid}' title='复制数值'>${ICONS.copy}</button>
        </div>
      </div>`;
  }).join('');

  return html || "<div class='td-group-empty'>未匹配到相关变量</div>";
}

function renderMvuStarredListHtml(starredList, info, q, collapsedSet, nodeList, starredSet) {
  if (!starredList || starredList.length === 0) {
    const otherStars = getOtherChatStarredCandidates(info.charScopeId, info.chatKey);
    return `
      <div class='td-empty'>
        <div class='td-empty-title'>当前聊天暂无加精变量</div>
        <div class='td-empty-desc'>各聊天的加精列表相互独立。在「全部变量」中点击任意变量右侧的星标 ☆ 即可加精重点关注，下次打开本聊天将默认展示。</div>
        <div style='display:flex;gap:8px;flex-wrap:wrap;justify-content:center;'>
          <button type='button' class='td-btn primary' data-action='mvu-set-view' data-view='all'>前往全部变量添加</button>
          ${otherStars.length > 0 ? `<button type='button' class='td-btn' data-action='mvu-import-char-stars'>导入同卡其他聊天的加精 (${otherStars.length})</button>` : ''}
        </div>
      </div>`;
  }

  const exportMap = {};
  const html = starredList.map((starKey) => {
    const isStat = starKey.startsWith('stat:');
    let parts = [];
    try { parts = JSON.parse(starKey.slice(isStat ? 5 : 4)); } catch (e) { return ''; }
    if (!Array.isArray(parts) || parts.length === 0) return '';

    const displayPath = formatPartsDisplay(parts);
    const rootObj = isStat ? info.rawData?.stat_data : info.rawData;
    const { found, val } = getByPathParts(rootObj, parts);

    if (q) {
      if (found) {
        if (!matchesMvuFilter(displayPath, val, q)) return '';
      } else if (!displayPath.toLowerCase().includes(q)) {
        return '';
      }
    }

    if (found) exportMap[displayPath] = val;
    const keyId = `starred::${starKey}`;
    const nid = String(nodeList.length);
    nodeList.push({
      keyId,
      starKey,
      displayPath,
      pathParts: parts,
      editInStat: isStat,
      val: found ? val : undefined,
    });

    const starBtn = `<button type='button' class='td-icon-btn td-mvu-star is-starred' data-action='mvu-toggle-star' data-starkey='${escapeHtml(starKey)}' title='取消加精'>${STAR_FILLED_SVG}</button>`;

    if (!found) {
      return `
        <div class='td-mvu-row is-missing'>
          <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(displayPath)}</span>
          <span class='td-mvu-val is-null'>（当前楼层暂无）</span>
          <div class='td-mvu-ops'>${starBtn}</div>
        </div>`;
    }

    if (val !== null && typeof val === 'object') {
      const childIsArr = Array.isArray(val);
      const count = childIsArr ? val.length : Object.keys(val).length;
      const isCollapsed = !q && collapsedSet.has(keyId);
      const tuplePreview = childIsArr && count > 0 && count <= 2 && val.every((x) => x === null || typeof x !== 'object')
        ? `= ${val.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' · ')}`
        : '';
      return `
        <div class='td-mvu-node ${isCollapsed ? 'is-collapsed' : ''}'>
          <div class='td-mvu-head' data-action='mvu-toggle-node' data-nid='${nid}'>
            <span class='td-chevron'>${ICONS.chevron}</span>
            <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(displayPath)}</span>
            ${tuplePreview ? `<span class='td-mvu-preview' title='${escapeHtml(tuplePreview)}'>${escapeHtml(tuplePreview)}</span>` : ''}
            <span class='td-mvu-badge'>${childIsArr ? `[${count}]` : `{${count}}`}</span>
            ${starBtn}
            <button type='button' class='td-icon-btn' data-action='mvu-copy-val' data-nid='${nid}' title='复制此节点'>${ICONS.copy}</button>
          </div>
          ${isCollapsed ? '' : `<div class='td-mvu-children'>${renderMvuTreeHtml(val, parts, displayPath, '', collapsedSet, nodeList, { starredSet, isStatRoot: isStat, hasStatData: info.hasStatData })}</div>`}
        </div>`;
    }

    const typeCls = typeof val === 'number' ? 'is-num' : (typeof val === 'boolean' ? 'is-bool' : (val === null || val === undefined ? 'is-null' : 'is-str'));
    const valText = typeof val === 'string' ? (val === '' ? '""' : val) : String(val);
    return `
      <div class='td-mvu-row'>
        <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(displayPath)}</span>
        <span class='td-mvu-val ${typeCls}' title='${escapeHtml(valText)}'>${escapeHtml(valText)}</span>
        <div class='td-mvu-ops'>
          ${starBtn}
          <button type='button' class='td-icon-btn' data-action='mvu-edit-val' data-nid='${nid}' title='修改数值'>${ICONS.edit}</button>
          <button type='button' class='td-icon-btn' data-action='mvu-copy-val' data-nid='${nid}' title='复制数值'>${ICONS.copy}</button>
        </div>
      </div>`;
  }).join('');

  return {
    exportMap,
    html: html || "<div class='td-group-empty'>未匹配到相关加精变量</div>",
  };
}

export function renderManagerModalView(m) {
  const modalLayerEl = ctx.getModalLayer();
  if (!modalLayerEl || !m) return false;

  if (m.type === 'mvuViewer') {
    const info = readMvuViewerState(m);
    if (!info.inCharChat) {
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-sm'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.eye} MVU 变量查看</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          <div class='td-modal-body'><div class='td-empty'><div class='td-empty-title'>未进入角色卡聊天</div><div class='td-empty-desc'>该功能仅在进入角色卡聊天后展示相关变量信息与数值。</div></div></div>
          <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>关闭</button></div>
        </div>`;
      ctx.syncOverlayBounds();
      return true;
    }

    const starredList = getMvuStarredList(info.chatKey);
    const starredSet = new Set(starredList);
    if (m._chatKey && m._chatKey !== info.chatKey) {
      m.floor = 'latest';
      m.collapsed = new Set();
      m.viewMode = starredList.length > 0 ? 'starred' : 'all';
    }
    if (!m.viewMode) m.viewMode = starredList.length > 0 ? 'starred' : 'all';
    const viewMode = m.viewMode === 'starred' ? 'starred' : 'all';

    m._charScopeId = info.charScopeId;
    m._chatKey = info.chatKey;
    m._resolvedFloor = info.resolvedFloor;
    m._lastMsgId = info.lastMsgId;
    m._rawData = info.rawData;
    m._hasStatData = info.hasStatData;
    m._displayObj = info.displayObj;
    m._nodes = [];
    if (!(m.collapsed instanceof Set)) m.collapsed = new Set();

    const q = (m.query || '').trim().toLowerCase();
    const floorBarHtml = `
      <div style='display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0;'>
        <span class='td-bar-label' style='width:auto;'>楼层</span>
        <button type='button' class='td-btn sm' data-action='mvu-floor-step' data-step='-1' ${info.resolvedFloor <= 0 ? 'disabled' : ''}>上一楼</button>
        <input class='td-input' id='td-mvu-floor-input' type='number' min='0' max='${Math.max(0, info.lastMsgId)}' value='${info.resolvedFloor >= 0 ? info.resolvedFloor : 0}' style='width:68px;height:28px;font-size:12.5px;text-align:center;' ${info.lastMsgId < 0 ? 'disabled' : ''} />
        <button type='button' class='td-btn sm' data-action='mvu-floor-step' data-step='1' ${info.resolvedFloor >= info.lastMsgId ? 'disabled' : ''}>下一楼</button>
        <button type='button' class='td-btn sm ${m.floor === 'latest' ? 'primary' : ''}' data-action='mvu-floor-step' data-step='latest' ${info.lastMsgId < 0 ? 'disabled' : ''}>最新${info.lastMsgId >= 0 ? ` (#${info.lastMsgId})` : ''}</button>
        ${info.autoBacktracked ? `<span class='td-mode-tag single'>已定位最近变量楼层 #${info.resolvedFloor}</span>` : ''}
      </div>`;

    let treeHtml = '';
    if (viewMode === 'starred') {
      if (info.lastMsgId < 0 || !info.rawData) {
        m._starredExportObj = {};
        treeHtml = `<div class='td-group-empty'>${info.lastMsgId < 0 ? '当前聊天暂无消息楼层' : '当前楼层暂无 MVU 变量数据'}</div>`;
      } else {
        const res = renderMvuStarredListHtml(starredList, info, q, m.collapsed, m._nodes, starredSet);
        if (typeof res === 'string') {
          m._starredExportObj = {};
          treeHtml = res;
        } else {
          m._starredExportObj = res.exportMap;
          treeHtml = res.html;
        }
      }
    } else {
      m._starredExportObj = null;
      const isStatRoot = !!(m.onlyStatData && info.hasStatData);
      treeHtml = info.displayObj
        ? renderMvuTreeHtml(info.displayObj, [], '', q, m.collapsed, m._nodes, { starredSet, isStatRoot, hasStatData: info.hasStatData })
        : `<div class='td-group-empty'>${info.lastMsgId < 0 ? '当前聊天暂无消息楼层' : '当前楼层暂无 MVU 变量数据'}</div>`;
    }
    const noFloor = info.lastMsgId < 0 || info.resolvedFloor < 0;

    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${ICONS.eye} MVU 楼层变量 · ${escapeHtml(info.charName)}</div>
          <div style='display:flex;gap:4px;'>
            <button class='td-icon-btn' data-action='mvu-refresh' title='刷新变量'>${ICONS.refresh}</button>
            <button class='td-icon-btn' data-action='mvu-copy-json' title='复制当前 JSON'>${ICONS.copy}</button>
            <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
          </div>
        </div>
        <div class='td-modal-body td-picker-body'>
          ${floorBarHtml}
          <div class='td-mgr-topbar'>
            <input class='td-input' id='td-mvu-search' type='text' placeholder='搜索变量名、路径或数值...' value='${escapeHtml(m.query || '')}' />
          </div>
          <div class='td-filter-bar'>
            <button type='button' class='td-chip ${viewMode === 'starred' ? 'active' : ''}' data-action='mvu-set-view' data-view='starred'>★ 加精 (${starredList.length})</button>
            <button type='button' class='td-chip ${viewMode === 'all' ? 'active' : ''}' data-action='mvu-set-view' data-view='all'>全部变量</button>
            ${viewMode === 'all' && info.hasStatData ? `<button type='button' class='td-chip ${m.onlyStatData ? 'active' : ''}' data-action='mvu-toggle-only-stat'>仅 stat_data</button>` : ''}
            <button type='button' class='td-chip' data-action='mvu-toggle-expand-all'>${m.collapsed.size > 0 ? '全部展开' : '全部折叠'}</button>
          </div>
          <div class='td-picker-list td-scroll'>${treeHtml}</div>
        </div>
        <div class='td-modal-foot' style='justify-content:flex-start;'>
          <div style='display:flex;gap:6px;flex-wrap:wrap;'>
            <button class='td-btn sm' data-action='mvu-open-cmd-edit' ${noFloor ? 'disabled' : ''}>${ICONS.code} 命令补全</button>
            <button class='td-btn sm' data-action='mvu-open-json-edit' ${noFloor ? 'disabled' : ''}>${ICONS.edit} 编辑 JSON</button>
            <button class='td-btn sm warn' data-action='mvu-open-ai-update' ${noFloor ? 'disabled' : ''}>${ICONS.sliders} AI 更新/补全</button>
          </div>
        </div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  if (m.type === 'logs') {
    const levelFilter = m.filter || 'ALL';
    const allLogs = getDevLogs('ALL');
    const logs = getDevLogs(levelFilter);

    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'><div class='td-modal-title'>${ICONS.code} 运行日志 (${allLogs.length})</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        <div class='td-modal-body td-picker-body'>
          <div class='td-filter-bar'>
            <button class='td-chip ${levelFilter === 'ALL' ? 'active' : ''}' data-action='logs-set-filter' data-filter='ALL'>全部 (${allLogs.length})</button>
            <button class='td-chip ${levelFilter === 'ERR' ? 'active' : ''}' data-action='logs-set-filter' data-filter='ERR'>错误</button>
            <button class='td-chip ${levelFilter === 'WARN' ? 'active' : ''}' data-action='logs-set-filter' data-filter='WARN'>警告</button>
            <button class='td-chip ${levelFilter === 'INFO' ? 'active' : ''}' data-action='logs-set-filter' data-filter='INFO'>信息</button>
          </div>
          <div style='display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;'>
            <button class='td-btn sm' data-action='logs-refresh'>${ICONS.refresh} 刷新</button>
            <button class='td-btn sm' data-action='logs-copy'>${ICONS.copy} 复制</button>
            <button class='td-btn sm primary' data-action='logs-export'>${ICONS.download} 导出 (.txt)</button>
            <button class='td-btn sm danger' data-action='logs-clear'>清空</button>
          </div>
          <div class='td-picker-list td-scroll'>
            ${logs.length === 0
              ? "<div class='td-group-empty'>当前筛选下暂无日志记录</div>"
              : logs.map((l) => {
                  const cls = l.level === 'ERR' ? 'is-err' : (l.level === 'WARN' ? 'is-warn' : 'is-info');
                  return `<div class='td-log-row ${cls}'><span class='td-log-badge'>${escapeHtml(l.level)}</span><span>[${escapeHtml(l.time)}] ${escapeHtml(l.message)}</span></div>`;
                }).join('')}
          </div>
        </div>
        <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>关闭</button></div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  if (m.type === 'wbMergeSelect') {
    const books = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
    const newVal = (m.newName && books.includes(m.newName)) ? m.newName : (books[0] || '');
    const oldVal = (m.oldName && books.includes(m.oldName)) ? m.oldName : findBestMatchingName(newVal, books);
    m.oldName = oldVal; m.newName = newVal;
    const draft = state.mergeDrafts?.worldbook;
    const draftHtml = draft ? `
      <div class='td-attr-warn-banner' style='display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;'>
        <span style='flex:1;min-width:160px;'>有未应用的缝合草稿：${escapeHtml(draft.oldName)} ⇄ ${escapeHtml(draft.newName)}${draft._pendingCustom ? '（含未保存的条目编辑）' : ''}</span>
        <span style='display:flex;gap:6px;'>
          <button type='button' class='td-btn sm primary' data-action='resume-wb-merge'>继续上次缝合</button>
          <button type='button' class='td-btn sm' data-action='discard-wb-merge-draft'>丢弃</button>
        </span>
      </div>` : '';
    const optsHtml = (sel) => books.map((n) => `<option value='${escapeHtml(n)}' ${n === sel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
    modalLayerEl.innerHTML = `
      <div class='td-modal'>
        <div class='td-modal-head'><div class='td-modal-title'>${ICONS.gitMerge} 世界书对比与缝合</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          ${draftHtml}
          ${books.length < 2
            ? "<div class='td-empty'><div class='td-empty-title'>世界书数量不足</div><div class='td-empty-desc'>至少需要 2 本世界书才能进行对比与缝合。</div></div>"
            : `<div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>选择旧版世界书与新版世界书，将自动按名称与 UID 匹配条目并生成逐行差异对比。</div>
               <div class='td-field'><label class='td-label'>旧版本世界书（Current · 修改来源）</label><select class='td-select' id='td-wb-merge-old-select'>${optsHtml(oldVal)}</select></div>
               <div style='display:flex;justify-content:center;'><button type='button' class='td-btn sm' data-action='swap-wb-merge'>${ICONS.swap} 交换旧版 / 新版</button></div>
               <div class='td-field'><label class='td-label'>新版本世界书（Incoming · 目标新版）</label><select class='td-select' id='td-wb-merge-new-select'>${optsHtml(newVal)}</select></div>`}
        </div>
        <div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button>${books.length >= 2 ? `<button class='td-btn primary' data-action='start-wb-merge'>开始对比与缝合</button>` : ''}</div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  if (m.type === 'wbMerge') {
    const s = m.session;
    const titleStr = `${s.oldName} ⇄ ${s.newName}`;
    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title td-title-clickable' data-action='show-full-title' data-full-title='${escapeHtml(titleStr)}' title='点击查看完整标题'>${escapeHtml(titleStr)}</div>
          <div style='display:flex;gap:4px;align-items:center;'><button class='td-btn sm' data-action='toggle-wb-merge-controls'>${ICONS.sliders} 筛选与批量</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        </div>
        <div class='td-modal-body td-picker-body'>
          <div class='td-picker-summary'><span data-role='wb-merge-summary-text' style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'></span></div>
          <div class='td-picker-controls'>
            <div class='td-filter-bar'>
              <button class='td-chip' data-action='set-wb-merge-filter' data-filter='diff'>差异 (${s.stats.conflict + s.stats.added + s.stats.removed})</button>
              <button class='td-chip' data-action='set-wb-merge-filter' data-filter='conflict'>冲突 (${s.stats.conflict})</button>
              <button class='td-chip' data-action='set-wb-merge-filter' data-filter='added'>新增 (${s.stats.added})</button>
              <button class='td-chip' data-action='set-wb-merge-filter' data-filter='removed'>删除 (${s.stats.removed})</button>
              <button class='td-chip' data-action='set-wb-merge-filter' data-filter='all'>全部 (${s.entries.length})</button>
            </div>
            <div class='td-filter-bar'><button class='td-btn sm' data-action='wb-merge-batch-states'>仅迁移旧版开关</button><button class='td-btn sm' data-action='wb-merge-batch-old'>全选保留旧版</button><button class='td-btn sm' data-action='wb-merge-batch-new'>全选采用新版</button></div>
            <input class='td-input' id='td-wb-merge-search' type='text' placeholder='搜索世界书条目名称、关键词或正文...' value='${escapeHtml(s.query || '')}' />
          </div>
          <div class='td-picker-list td-scroll' data-role='wb-merge-list'></div>
        </div>
        <div class='td-modal-foot' style='flex-wrap:wrap;'>
          <span data-role='wb-merge-dirty' style='margin-right:auto;font-size:11.5px;font-weight:600;color:var(--td-single);display:none;'></span>
          <button class='td-btn' data-action='wb-merge-save-as'>另存为新世界书</button><button class='td-btn primary' data-action='wb-merge-apply-target'>覆盖新版世界书</button>
        </div>
      </div>`;
    updateWbMergeBody();
    ctx.syncOverlayBounds();
    return true;
  }

  if (m.type === 'presetManager') {
    const info = getPresetSummaryList();
    const q = (m.query || '').trim().toLowerCase();
    const filtered = info.list.filter((p) => !q || p.name.toLowerCase().includes(q));
    const rowsHtml = filtered.map((p) => `
      <div class='td-mgr-row ${p.isLoaded ? 'is-active' : ''}'>
        <div class='td-mgr-row-head'>
          <div class='td-mgr-row-title' title='${escapeHtml(p.name)}'>${escapeHtml(p.name)}</div>
          <div style='display:flex;gap:4px;flex-shrink:0;'>
            ${p.isLoaded ? "<span class='td-mode-tag ok'>使用中</span>" : ''}
            ${p.isDirty ? "<span class='td-mode-tag single'>有未保存修改</span>" : ''}
          </div>
        </div>
        <div class='td-mgr-row-sub'><span>启用 ${p.enabledCount}/${p.promptCount} 条</span>${p.unusedCount > 0 ? `<span>· 未添加池 ${p.unusedCount} 条</span>` : ''}</div>
        <div class='td-mgr-row-actions'>
          ${!p.isLoaded ? `<button class='td-btn sm primary' data-action='pm-load' data-name='${escapeHtml(p.name)}'>加载</button>` : ''}
          ${p.isDirty ? `<button class='td-btn sm warn' data-action='pm-save-inuse-back' data-name='${escapeHtml(p.name)}'>保存实时修改</button>` : ''}
          <button class='td-btn sm' data-action='pm-open-detail' data-name='${escapeHtml(p.name)}'>${ICONS.edit} 条目与参数</button>
          <button class='td-btn sm' data-action='pm-duplicate' data-name='${escapeHtml(p.name)}'>复制</button>
          <button class='td-btn sm' data-action='pm-rename' data-name='${escapeHtml(p.name)}'>重命名</button>
          <button class='td-btn sm' data-action='pm-export' data-name='${escapeHtml(p.name)}'>导出</button>
          <button class='td-btn sm danger' data-action='pm-delete' data-name='${escapeHtml(p.name)}'>删除</button>
        </div>
      </div>`).join('');

    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'><div class='td-modal-title'>${ICONS.layers} 预设管理 (${info.list.length})</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        <div class='td-modal-body td-picker-body'>
          <div class='td-mgr-topbar'>
            <input class='td-input' id='td-pm-search' type='text' placeholder='搜索预设名称...' value='${escapeHtml(m.query || '')}' />
            <button class='td-btn sm primary' data-action='pm-create'>${ICONS.plus} 新建</button>
            <button class='td-icon-btn ${m.toolsOpen ? 'is-active' : ''}' data-action='pm-toggle-tools' title='更多工具'>${ICONS.more}</button>
          </div>
          <div class='td-mgr-subtools ${m.toolsOpen ? 'is-open' : ''}'>
            <button class='td-btn sm' data-action='pm-save-inuse-as'>${ICONS.save} 另存实时预设</button>
            <button class='td-btn sm' data-action='pm-open-detail' data-name='in_use'>${ICONS.sliders} 编辑实时预设</button>
            <button class='td-btn sm' data-action='pm-trigger-import'>${ICONS.upload} 导入 (.json)</button>
            <input type='file' id='td-pm-import-file' accept='.json,application/json' style='display:none;' />
          </div>
          <div class='td-picker-list td-scroll'>${rowsHtml || "<div class='td-group-empty'>未找到匹配的预设</div>"}</div>
        </div>
        <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>完成</button></div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  if (m.type === 'presetDetail') {
    const data = m.data, tab = m.tab || 'prompts', q = (m.query || '').trim().toLowerCase();
    const listName = tab === 'unused' ? 'prompts_unused' : 'prompts';
    const list = Array.isArray(data[listName]) ? data[listName] : [];
    const batchMode = !!m.batchMode;
    const selectedSet = m.selectedIdx instanceof Set ? m.selectedIdx : (m.selectedIdx = new Set());

    let bodyHtml = '';
    if (tab === 'settings') {
      const s = data.settings || {};
      const fieldsHtml = PRESET_SETTING_FIELDS.map((f) => {
        const val = s[f.key];
        if (f.type === 'bool') return `<div class='td-setting-row'><div class='td-setting-title' style='font-size:12.5px;'>${escapeHtml(f.label)}</div><input type='checkbox' class='td-checkbox' data-pm-setting='${escapeHtml(f.key)}' data-ftype='bool' ${val ? 'checked' : ''} /></div>`;
        if (f.type === 'select') {
          const opts = f.options.map((o) => `<option value='${escapeHtml(o.v)}' ${String(val) === o.v ? 'selected' : ''}>${escapeHtml(o.t)}</option>`).join('');
          return `<div class='td-field'><label class='td-label'>${escapeHtml(f.label)}</label><select class='td-select' data-pm-setting='${escapeHtml(f.key)}' data-ftype='select'>${opts}</select></div>`;
        }
        return `<div class='td-field'><label class='td-label'>${escapeHtml(f.label)}</label><input class='td-input' type='number' step='${f.step || 1}' min='${f.min ?? ''}' max='${f.max ?? ''}' data-pm-setting='${escapeHtml(f.key)}' data-ftype='number' value='${escapeHtml(val ?? '')}' /></div>`;
      }).join('');
      bodyHtml = `<div class='td-picker-list td-scroll'><div class='td-form-grid'>${fieldsHtml}</div></div>`;
    } else {
      const indexed = list.map((p, idx) => ({ p, idx })).filter(({ p, idx }) => {
        if (!q) return true;
        return `#${idx + 1}`.includes(q)
          || (p.name || '').toLowerCase().includes(q)
          || (p.id || '').toLowerCase().includes(q)
          || (p.content || '').toLowerCase().includes(q);
      });
      const rows = indexed.map(({ p, idx }) => {
        const isSys = PRESET_SYSTEM_IDS.has(p.id);
        const posLabel = p.position?.type === 'in_chat' ? `@D${p.position.depth ?? 0}` : '相对';
        const checked = selectedSet.has(idx);
        return `
          <div class='td-mgr-row ${batchMode && checked ? 'is-active' : ''}' data-idx='${idx}'>
            <div class='td-mgr-row-head'>
              <div style='display:flex;align-items:center;gap:7px;min-width:0;flex:1;'>
                ${batchMode ? `<input type='checkbox' class='td-checkbox' data-action='pm-batch-check' data-idx='${idx}' ${checked ? 'checked' : ''} />` : ''}
                <span class='td-idx-badge'>#${idx + 1}</span>
                <button type='button' class='td-switch sm ${p.enabled ? 'on' : ''}' data-action='pm-toggle-prompt' data-list='${listName}' data-idx='${idx}'></button>
                <span class='td-mgr-row-title' title='${escapeHtml(p.name || p.id)}'>${escapeHtml(p.name || p.id)}</span>
              </div>
              <span class='td-src-badge'>${escapeHtml(p.role || 'system')} · ${posLabel}</span>
            </div>
            <div class='td-mgr-row-actions'>
              <button class='td-btn sm primary' data-action='pm-edit-content' data-list='${listName}' data-idx='${idx}'>${ICONS.eye} 编辑内容</button>
              <button class='td-btn sm' data-action='pm-edit-prompt' data-list='${listName}' data-idx='${idx}'>${ICONS.edit} 属性</button>
              <button class='td-btn sm' data-action='pm-move-before' data-list='${listName}' data-idx='${idx}'>移动到...</button>
              ${!isSys ? `<button class='td-btn sm' data-action='pm-swap-pool' data-list='${listName}' data-idx='${idx}'>${tab === 'prompts' ? '移入未添加' : '加入列表'}</button>` : ''}
              ${!isSys ? `<button class='td-btn sm danger' data-action='pm-del-prompt' data-list='${listName}' data-idx='${idx}'>删除</button>` : ''}
            </div>
          </div>`;
      }).join('');
      bodyHtml = `
        <div class='td-mgr-topbar'>
          <input class='td-input' id='td-pm-detail-search' type='text' placeholder='搜索序号、名称、ID 或正文...' value='${escapeHtml(m.query || '')}' />
          <button class='td-btn sm primary' data-action='pm-add-prompt' data-list='${listName}'>${ICONS.plus} 新增</button>
          <button class='td-icon-btn ${m.toolsOpen || batchMode ? 'is-active' : ''}' data-action='pm-detail-toggle-tools' title='跳转、批量移动与 AI 编辑'>${ICONS.more}</button>
        </div>
        <div class='td-mgr-subtools ${m.toolsOpen || batchMode ? 'is-open' : ''}'>
          <div style='display:inline-flex;align-items:center;gap:4px;'>
            <input class='td-input' id='td-pm-jump-idx' type='number' min='1' max='${Math.max(1, list.length)}' placeholder='序号' value='${escapeHtml(m.jumpVal || '')}' style='width:68px;height:27px;padding:0 6px;font-size:12px;text-align:center;' />
            <button class='td-btn sm' data-action='pm-jump-idx' title='跳转到指定序号'>跳转</button>
          </div>
          <button class='td-btn sm ${batchMode ? 'primary' : ''}' data-action='pm-toggle-batch'>${batchMode ? `退出批量 (已选 ${selectedSet.size})` : '批量选择移动'}</button>
          ${batchMode ? `<button class='td-btn sm warn' data-action='pm-batch-move'>批量移动到...</button>` : ''}
          ${batchMode && tab === 'unused' ? `<button class='td-btn sm primary' data-action='pm-batch-join'>批量加入主列表</button>` : ''}
          <button class='td-btn sm warn' data-action='pm-open-ai-edit'>${ICONS.sliders} AI 智能编辑</button>
        </div>
        <div class='td-picker-list td-scroll'>${rows || "<div class='td-group-empty'>暂无匹配条目</div>"}</div>`;
    }

    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>预设编辑 · ${escapeHtml(m.presetName === 'in_use' ? `实时预设 (${state.presetName})` : m.presetName)}</div>
          <div style='display:flex;gap:4px;'><button class='td-btn sm' data-action='pm-back-list'>返回</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        </div>
        <div class='td-modal-body td-picker-body'>
          <div class='td-source-tabs cols-3'>
            <button class='td-source-tab ${tab === 'prompts' ? 'active' : ''}' data-action='pm-detail-tab' data-tab='prompts'>提示词 (${data.prompts.length})</button>
            <button class='td-source-tab ${tab === 'unused' ? 'active' : ''}' data-action='pm-detail-tab' data-tab='unused'>未添加 (${data.prompts_unused.length})</button>
            <button class='td-source-tab ${tab === 'settings' ? 'active' : ''}' data-action='pm-detail-tab' data-tab='settings'>生成参数</button>
          </div>
          ${bodyHtml}
        </div>
        <div class='td-modal-foot'><span data-role='pm-dirty-label' style='margin-right:auto;font-size:11.5px;color:var(--td-text-muted);'>${m.dirty ? '有未保存修改' : '已同步'}</span><button class='td-btn' data-action='pm-back-list'>返回</button><button class='td-btn primary' data-action='pm-save-detail'>${ICONS.save} 保存预设</button></div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  if (m.type === 'worldbookManager') {
    const snap = getWorldbookBindingsSnapshot(), filter = m.filter || 'all', q = (m.query || '').trim().toLowerCase();
    const books = snap.allBooks.filter((name) => {
      if (q && !name.toLowerCase().includes(q)) return false;
      if (filter === 'global') return snap.globalSet.has(name);
      if (filter === 'char') return snap.charPrimary === name || snap.charAdditionalSet.has(name);
      if (filter === 'chat') return snap.chatBook === name;
      return true;
    });

    const rowsHtml = books.map((name) => {
      const isGlobal = snap.globalSet.has(name), isCharPri = snap.charPrimary === name, isCharAdd = snap.charAdditionalSet.has(name), isChat = snap.chatBook === name;
      const isBound = isGlobal || isCharPri || isCharAdd || isChat;
      return `
        <div class='td-mgr-row ${isBound ? 'is-active' : ''}'>
          <div class='td-mgr-row-head'>
            <div class='td-mgr-row-title' title='${escapeHtml(name)}'>${escapeHtml(name)}</div>
            <div style='display:flex;gap:4px;flex-wrap:wrap;flex-shrink:0;'>
              ${isGlobal ? "<span class='td-mode-tag ok'>全局</span>" : ''}
              ${isCharPri ? "<span class='td-mode-tag multi'>角色主</span>" : ''}
              ${isCharAdd ? "<span class='td-mode-tag multi'>角色附加</span>" : ''}
              ${isChat ? "<span class='td-mode-tag single'>聊天</span>" : ''}
            </div>
          </div>
          <div class='td-mgr-row-actions'>
            <button class='td-btn sm ${isGlobal ? 'primary' : ''}' data-action='wbm-toggle-global' data-name='${escapeHtml(name)}'>${isGlobal ? '取消全局' : '全局启用'}</button>
            ${snap.hasCharacter ? `<button class='td-btn sm ${isCharPri ? 'primary' : ''}' data-action='wbm-toggle-char-pri' data-name='${escapeHtml(name)}'>${isCharPri ? '取消主书' : '角色主书'}</button>` : ''}
            ${snap.hasCharacter ? `<button class='td-btn sm ${isCharAdd ? 'primary' : ''}' data-action='wbm-toggle-char-add' data-name='${escapeHtml(name)}'>${isCharAdd ? '移除附加' : '角色附加'}</button>` : ''}
            <button class='td-btn sm ${isChat ? 'warn' : ''}' data-action='wbm-toggle-chat' data-name='${escapeHtml(name)}' ${!snap.inChat ? 'title="需先进入角色卡聊天"' : ''}>${isChat ? '解绑聊天' : '绑定聊天'}</button>
            <button class='td-btn sm' data-action='wbm-open-detail' data-name='${escapeHtml(name)}'>${ICONS.edit} 条目</button>
            <button class='td-btn sm' data-action='wbm-duplicate' data-name='${escapeHtml(name)}'>复制</button>
            <button class='td-btn sm' data-action='wbm-rename' data-name='${escapeHtml(name)}'>重命名</button>
            <button class='td-btn sm' data-action='wbm-export' data-name='${escapeHtml(name)}'>导出</button>
            <button class='td-btn sm danger' data-action='wbm-delete' data-name='${escapeHtml(name)}'>删除</button>
          </div>
        </div>`;
    }).join('');

    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'><div class='td-modal-title'>${ICONS.layers} 世界书管理 (${snap.allBooks.length})</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        <div class='td-modal-body td-picker-body'>
          <div class='td-mgr-topbar'>
            <input class='td-input' id='td-wbm-search' type='text' placeholder='搜索世界书名称...' value='${escapeHtml(m.query || '')}' />
            <button class='td-btn sm primary' data-action='wbm-create'>${ICONS.plus} 新建</button>
            <button class='td-icon-btn ${m.toolsOpen ? 'is-active' : ''}' data-action='wbm-toggle-tools' title='筛选与更多工具'>${ICONS.more}</button>
          </div>
          <div class='td-mgr-subtools ${m.toolsOpen ? 'is-open' : ''}'>
            <div class='td-filter-bar' style='width:100%;'>
              <button class='td-chip ${filter === 'all' ? 'active' : ''}' data-action='wbm-set-filter' data-filter='all'>全部 (${snap.allBooks.length})</button>
              <button class='td-chip ${filter === 'global' ? 'active' : ''}' data-action='wbm-set-filter' data-filter='global'>全局 (${snap.globalList.length})</button>
              <button class='td-chip ${filter === 'char' ? 'active' : ''}' data-action='wbm-set-filter' data-filter='char'>当前角色 (${(snap.charPrimary ? 1 : 0) + snap.charAdditional.length})</button>
              <button class='td-chip ${filter === 'chat' ? 'active' : ''}' data-action='wbm-set-filter' data-filter='chat'>当前聊天 (${snap.chatBook ? 1 : 0})</button>
            </div>
            <button class='td-btn sm' data-action='wbm-create-chat'>${ICONS.link} 新建/绑定聊天世界书</button>
            <button class='td-btn sm' data-action='wbm-trigger-import'>${ICONS.upload} 导入 (.json)</button>
            <input type='file' id='td-wbm-import-file' accept='.json,application/json' style='display:none;' />
          </div>
          <div class='td-picker-list td-scroll'>${rowsHtml || "<div class='td-group-empty'>未找到匹配的世界书</div>"}</div>
        </div>
        <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>完成</button></div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  if (m.type === 'worldbookDetail') {
    const entries = m.entries || [], q = (m.query || '').trim().toLowerCase();
    const batchMode = !!m.batchMode;
    const selectedSet = m.selectedIdx instanceof Set ? m.selectedIdx : (m.selectedIdx = new Set());
    const indexed = entries.map((e, idx) => ({ e, idx })).filter(({ e, idx }) => {
      if (!q) return true;
      return `#${idx + 1}`.includes(q)
        || (e.name || '').toLowerCase().includes(q)
        || (e.content || '').toLowerCase().includes(q)
        || formatKeysInput(e.strategy?.keys).toLowerCase().includes(q);
    });

    const rows = indexed.map(({ e, idx }) => {
      const stype = e.strategy?.type || 'selective';
      const stBadge = stype === 'constant' ? '蓝灯' : (stype === 'vectorized' ? '向量' : '绿灯');
      const keysText = formatKeysInput(e.strategy?.keys);
      const checked = selectedSet.has(idx);
      return `
        <div class='td-mgr-row ${batchMode && checked ? 'is-active' : ''}' data-idx='${idx}'>
          <div class='td-mgr-row-head'>
            <div style='display:flex;align-items:center;gap:7px;min-width:0;flex:1;'>
              ${batchMode ? `<input type='checkbox' class='td-checkbox' data-action='wbd-batch-check' data-idx='${idx}' ${checked ? 'checked' : ''} />` : ''}
              <span class='td-idx-badge'>#${idx + 1}</span>
              <button type='button' class='td-switch sm ${e.enabled ? 'on' : ''}' data-action='wbd-toggle-entry' data-idx='${idx}'></button>
              <span class='td-mgr-row-title' title='${escapeHtml(e.name || `条目 #${e.uid}`)}'>${escapeHtml(e.name || `条目 #${e.uid}`)}</span>
            </div>
            <span class='td-src-badge'>${stBadge} · 顺${e.position?.order ?? 100}</span>
          </div>
          ${keysText ? `<div class='td-mgr-row-sub' style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>关键词: ${escapeHtml(keysText)}</div>` : ''}
          <div class='td-mgr-row-actions'>
            <button class='td-btn sm primary' data-action='wbd-edit-content' data-idx='${idx}'>${ICONS.eye} 编辑内容</button>
            <button class='td-btn sm' data-action='wbd-edit-entry' data-idx='${idx}'>${ICONS.edit} 完整属性</button>
            <button class='td-btn sm' data-action='wbd-move-before' data-idx='${idx}'>移动到...</button>
            <button class='td-btn sm' data-action='wbd-dup-entry' data-idx='${idx}'>复制</button>
            <button class='td-btn sm danger' data-action='wbd-del-entry' data-idx='${idx}'>删除</button>
          </div>
        </div>`;
    }).join('');

    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>世界书条目 · ${escapeHtml(m.bookName)} (${entries.length})</div>
          <div style='display:flex;gap:4px;'><button class='td-btn sm' data-action='wbd-back-list'>返回</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
        </div>
        <div class='td-modal-body td-picker-body'>
          <div class='td-mgr-topbar'>
            <input class='td-input' id='td-wbd-search' type='text' placeholder='搜索序号、条目标题、关键词或正文...' value='${escapeHtml(m.query || '')}' />
            <button class='td-btn sm primary' data-action='wbd-add-entry'>${ICONS.plus} 新增</button>
            <button class='td-icon-btn ${m.toolsOpen || batchMode ? 'is-active' : ''}' data-action='wbd-toggle-tools' title='跳转、批量移动与 AI 编辑'>${ICONS.more}</button>
          </div>
          <div class='td-mgr-subtools ${m.toolsOpen || batchMode ? 'is-open' : ''}'>
            <div style='display:inline-flex;align-items:center;gap:4px;'>
              <input class='td-input' id='td-wbd-jump-idx' type='number' min='1' max='${Math.max(1, entries.length)}' placeholder='序号' value='${escapeHtml(m.jumpVal || '')}' style='width:68px;height:27px;padding:0 6px;font-size:12px;text-align:center;' />
              <button class='td-btn sm' data-action='wbd-jump-idx' title='跳转到指定序号'>跳转</button>
            </div>
            <button class='td-btn sm ${batchMode ? 'primary' : ''}' data-action='wbd-toggle-batch'>${batchMode ? `退出批量 (已选 ${selectedSet.size})` : '批量选择移动'}</button>
            ${batchMode ? `<button class='td-btn sm warn' data-action='wbd-batch-move'>批量移动到...</button>` : ''}
            <button class='td-btn sm' data-action='wbd-batch-enable' data-val='1'>全开可见</button>
            <button class='td-btn sm' data-action='wbd-batch-enable' data-val='0'>全关可见</button>
            <button class='td-btn sm warn' data-action='wbd-disable-recursion'>一键禁止递归</button>
            <button class='td-btn sm warn' data-action='wbd-open-ai-edit'>${ICONS.sliders} AI 智能编辑</button>
          </div>
          <div class='td-picker-list td-scroll'>${rows || "<div class='td-group-empty'>暂无匹配的世界书条目</div>"}</div>
        </div>
        <div class='td-modal-foot'><span data-role='wbd-dirty-label' style='margin-right:auto;font-size:11.5px;color:var(--td-text-muted);'>${m.dirty ? '有未保存修改' : '已同步'}</span><button class='td-btn' data-action='wbd-back-list'>返回</button><button class='td-btn primary' data-action='wbd-save-book'>${ICONS.save} 保存世界书</button></div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  return false;
}

function renderSharedAiApiFieldsHtml() {
  const cfg = state.store.settings.aiEditConfig || { proxyPreset: '', jailbreakPreset: '', model: '' };
  const curApi = normalizeApiTargetValue(cfg.proxyPreset);
  if (curApi !== String(cfg.proxyPreset || '')) cfg.proxyPreset = curApi;

  const { profiles, proxies } = getAvailableApiTargets();
  const presetList = hasTH('getPresetNames') ? (callTH('getPresetNames') || []).filter((n) => n && n !== 'in_use') : [];
  const allApiValues = new Set([...profiles.map((p) => p.value), ...proxies.map((p) => p.value)]);
  const hasMissingApi = !!curApi && !allApiValues.has(curApi);

  const profileOpts = profiles.map((p) => (
    `<option value='${escapeHtml(p.value)}' ${p.value === curApi ? 'selected' : ''}>${escapeHtml(p.name)}${p.model ? ` (${escapeHtml(p.model)})` : ''}</option>`
  )).join('');
  const proxyOpts = proxies.map((p) => (
    `<option value='${escapeHtml(p.value)}' ${p.value === curApi ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  )).join('');

  const apiSelectHtml = [
    `<option value='' ${!curApi ? 'selected' : ''}>（跟随酒馆当前连接）</option>`,
    hasMissingApi ? `<option value='${escapeHtml(curApi)}' selected>${escapeHtml(curApi.replace(/^(profile|proxy):/, ''))} (未找到)</option>` : '',
    profileOpts ? `<optgroup label='连接配置 (Connection Profiles · ${profiles.length})'>${profileOpts}</optgroup>` : '',
    proxyOpts ? `<optgroup label='代理预设 (Proxy Presets · ${proxies.length})'>${proxyOpts}</optgroup>` : '',
  ].join('');

  const cache = (state._aiModelsCache = state._aiModelsCache || {});
  const cachedModels = Array.isArray(cache[curApi]) ? cache[curApi] : [];
  const curProfile = curApi.startsWith('profile:') ? profiles.find((p) => p.value === curApi) : null;
  const curModel = String(cfg.model || '');
  const modelList = [];
  const pushM = (m) => { const s = String(m || '').trim(); if (s && !modelList.includes(s)) modelList.push(s); };
  if (curProfile?.model) pushM(curProfile.model);
  cachedModels.forEach(pushM);
  if (curModel) pushM(curModel);

  const manualMode = !!state.previewCtx?.manualModelInput;
  const modelControlHtml = manualMode
    ? `<div style='display:flex;gap:5px;align-items:center;min-width:0;width:100%;'>
         <input class='td-input' id='td-ai-model' type='text' placeholder='输入模型名，留空用默认' value='${escapeHtml(curModel)}' style='flex:1;min-width:0;width:0;height:34px;' />
         <button type='button' class='td-btn sm' style='flex-shrink:0;' data-action='ai-toggle-model-manual' title='切换回下拉列表'>列表</button>
       </div>`
    : `<div style='display:flex;gap:5px;align-items:center;min-width:0;width:100%;'>
         <select class='td-select' id='td-ai-model-select' style='flex:1;min-width:0;width:0;'>
           <option value='' ${!curModel ? 'selected' : ''}>（默认${curProfile?.model ? `: ${escapeHtml(curProfile.model)}` : ''}）</option>
           ${modelList.map((m) => `<option value='${escapeHtml(m)}' ${m === curModel ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
           <option value='__manual__'>✎ 手动输入模型名...</option>
         </select>
         <button type='button' class='td-btn sm' style='flex-shrink:0;' data-action='ai-fetch-models' title='从当前 API 拉取可用模型列表'>${state.previewCtx?.fetchingModels ? '拉取中...' : '拉取'}</button>
       </div>`;

  const jbOpts = [
    `<option value=''>（不使用破甲预设）</option>`,
    ...presetList.map((pn) => `<option value='${escapeHtml(pn)}' ${pn === cfg.jailbreakPreset ? 'selected' : ''}>${escapeHtml(pn)}</option>`),
  ].join('');

  return `
    <div class='td-form-grid'>
      <div class='td-field'>
        <span class='td-label' style='font-size:11.5px;'>API 连接 / 代理预设（免存 Key）</span>
        <select class='td-select' id='td-ai-proxy-preset' style='width:100%;min-width:0;'>${apiSelectHtml}</select>
      </div>
      <div class='td-field'>
        <span class='td-label' style='font-size:11.5px;'>覆盖模型名（可拉取或留空默认）</span>
        ${modelControlHtml}
      </div>
    </div>
    <div class='td-field'>
      <span class='td-label' style='font-size:11.5px;'>破甲预设（NSFW 场景可选）</span>
      <select class='td-select' id='td-ai-jailbreak-preset' style='width:100%;min-width:0;'>${jbOpts}</select>
    </div>`;
}

function saveSharedAiApiFieldsFromPreview(previewLayerEl) {
  const cfg = state.store.settings.aiEditConfig || (state.store.settings.aiEditConfig = { proxyPreset: '', jailbreakPreset: '', model: '' });
  const proxyEl = previewLayerEl?.querySelector('#td-ai-proxy-preset');
  const jbEl = previewLayerEl?.querySelector('#td-ai-jailbreak-preset');
  const modelInputEl = previewLayerEl?.querySelector('#td-ai-model');
  const modelSelEl = previewLayerEl?.querySelector('#td-ai-model-select');
  if (proxyEl) cfg.proxyPreset = normalizeApiTargetValue(proxyEl.value);
  if (jbEl) cfg.jailbreakPreset = jbEl.value;
  if (modelInputEl) cfg.model = modelInputEl.value;
  else if (modelSelEl && modelSelEl.value !== '__manual__') cfg.model = modelSelEl.value;
  saveStore(state.store);
  return cfg;
}

function syncAiPreviewDraftInputs(previewLayerEl) {
  const pc = state.previewCtx;
  if (!pc || !previewLayerEl) return;
  if (pc.type === 'pmAiEdit' || pc.type === 'wbAiEdit') {
    const instrEl = previewLayerEl.querySelector('#td-ai-instruction');
    if (instrEl) pc.instruction = instrEl.value;
  } else if (pc.type === 'mvuAiUpdate') {
    const mc = previewLayerEl.querySelector('#td-mvu-ai-msgcount');
    const fl = previewLayerEl.querySelector('#td-mvu-ai-floor');
    const ir = previewLayerEl.querySelector('#td-mvu-ai-include-rules');
    const it = previewLayerEl.querySelector('#td-mvu-ai-include-trunc');
    const ins = previewLayerEl.querySelector('#td-mvu-ai-instruction');
    if (mc) pc.msgCount = Number(mc.value) || 2;
    if (fl && !Number.isNaN(Number(fl.value))) pc.targetFloor = Math.max(0, Math.min(pc.lastMsgId, Math.floor(Number(fl.value))));
    if (ir) pc.includeRules = !!ir.checked;
    if (it) pc.includeTruncated = !!it.checked;
    if (ins) pc.instruction = ins.value;
  }
}

function getSharedAiSummaryText() {
  const cfg = state.store.settings.aiEditConfig || { proxyPreset: '', jailbreakPreset: '', model: '' };
  const curApi = normalizeApiTargetValue(cfg.proxyPreset);
  const { profiles } = getAvailableApiTargets();
  let apiLabel = '当前连接';
  let curProfile = null;
  if (curApi.startsWith('profile:')) {
    const pid = curApi.slice(8);
    curProfile = profiles.find((p) => p.value === curApi);
    apiLabel = curProfile ? curProfile.name : pid;
  } else if (curApi.startsWith('proxy:')) {
    apiLabel = curApi.slice(6);
  }
  let modelLabel = String(cfg.model || '').trim();
  if (!modelLabel) {
    if (curProfile?.model) modelLabel = curProfile.model;
    else if (!curApi) {
      try { modelLabel = String(getST()?.getChatCompletionModel?.() || '').trim(); } catch (e) {}
    }
  }
  if (!modelLabel) modelLabel = '默认模型';
  const jbName = String(cfg.jailbreakPreset || '').trim();
  return jbName ? `${apiLabel} · ${modelLabel} · ${jbName}` : `${apiLabel} · ${modelLabel}`;
}

function renderCollapsibleAiApiBoxHtml(ai) {
  const expanded = !!ai?.apiExpanded;
  const summary = getSharedAiSummaryText();
  return `
    <div style='display:flex;flex-direction:column;gap:8px;padding:7px 10px;border-radius:10px;background:var(--td-surface);border:1px solid var(--td-border);flex-shrink:0;'>
      <div style='display:flex;align-items:center;justify-content:space-between;gap:8px;'>
        <span style='font-size:12px;color:var(--td-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;' title='${escapeHtml(summary)}'>${escapeHtml(summary)}</span>
        <button type='button' class='td-chip ${expanded ? 'active' : ''}' data-action='ai-toggle-api-box'>${expanded ? '收起配置' : '配置 API'}</button>
      </div>
      ${expanded ? renderSharedAiApiFieldsHtml() : ''}
    </div>`;
}

function renderAiEditSetupHtml({ title, ai, items, itemLabelFn }) {
  const q = (ai.search || '').trim().toLowerCase();
  const visible = items.filter((it) => !q || itemLabelFn(it).toLowerCase().includes(q));
  const expanded = !!ai.apiExpanded;

  return `
    <div class='td-modal td-modal-tall'>
      <div class='td-modal-head'><div class='td-modal-title'>${escapeHtml(title)}</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
      <div class='td-modal-body ${expanded ? '' : 'td-picker-body'}'>
        ${renderCollapsibleAiApiBoxHtml(ai)}
        <div class='td-field' style='flex-shrink:0;'><label class='td-label'>修改指令</label><textarea class='td-textarea' id='td-ai-instruction' style='min-height:60px;height:66px;font-family:inherit;' placeholder='输入修改指令...'>${escapeHtml(ai.instruction || '')}</textarea></div>
        <div class='td-field' style='flex:1;min-height:${expanded ? '200px' : '0'};display:flex;flex-direction:column;'>
          <div style='display:flex;justify-content:space-between;align-items:center;gap:6px;flex-shrink:0;'>
            <label class='td-label' data-role='ai-selected-label'>勾选待编辑条目 (已选 ${ai.selectedKeys.size} 项)</label>
            <input class='td-input' id='td-ai-search' type='text' placeholder='筛选...' value='${escapeHtml(ai.search || '')}' style='width:140px;height:28px;font-size:12px;' />
          </div>
          <div class='td-picker-list td-scroll' style='border:1px solid var(--td-border);border-radius:10px;padding:6px;min-height:140px;'>
            ${visible.map((it) => {
              const checked = ai.selectedKeys.has(it.key);
              return `
                <div class='td-picker-row ${checked ? 'checked' : ''}' style='min-height:38px;padding:6px 10px;'>
                  <label class='td-picker-left' style='cursor:pointer;'>
                    <input type='checkbox' class='td-checkbox' data-action='ai-toggle-item' data-key='${escapeHtml(it.key)}' ${checked ? 'checked' : ''} />
                    <span class='td-item-name' title='${escapeHtml(itemLabelFn(it))}'>${escapeHtml(itemLabelFn(it))}</span>
                  </label>
                  <button type='button' class='td-icon-btn' data-action='ai-preview-item' data-key='${escapeHtml(it.key)}' title='预览条目内容'>${ICONS.eye}</button>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='ai-run' ${ai.loading ? 'disabled' : ''}>${ai.loading ? 'AI 处理中，请稍候...' : '发送给 AI 编辑'}</button></div>
    </div>`;
}

function setAiRunBtnLoading(previewLayerEl, loading, selector = "[data-action='ai-run']", idleText = '发送给 AI 编辑') {
  const btn = previewLayerEl?.querySelector(selector);
  if (!btn) return;
  btn.disabled = !!loading;
  btn.textContent = loading ? 'AI 处理中，请稍候...' : idleText;
}

export function renderManagerPreviewView() {
  const previewLayerEl = ctx.getPreviewLayer();
  if (!previewLayerEl || !state.panelOpen || !state.previewCtx) return false;

  if (state.previewCtx.type === 'mvuValEdit' && state.modal?.type === 'mvuViewer') {
    const c = state.previewCtx;
    const typeOpts = [
      { v: 'string', t: '文本 (String)' },
      { v: 'number', t: '数字 (Number)' },
      { v: 'boolean', t: '布尔 (Boolean)' },
      { v: 'null', t: '空值 (Null)' },
      { v: 'json', t: 'JSON 对象/数组' },
    ].map((o) => `<option value='${o.v}' ${c.valType === o.v ? 'selected' : ''}>${o.t}</option>`).join('');
    let inputHtml = '';
    if (c.valType === 'boolean') {
      inputHtml = `<select class='td-select' id='td-mvu-val-input'><option value='true' ${c.draftText === 'true' ? 'selected' : ''}>true</option><option value='false' ${c.draftText !== 'true' ? 'selected' : ''}>false</option></select>`;
    } else if (c.valType === 'null') {
      inputHtml = `<input class='td-input' id='td-mvu-val-input' type='text' value='null' disabled />`;
    } else if (c.valType === 'number') {
      inputHtml = `<input class='td-input' id='td-mvu-val-input' type='number' step='any' value='${escapeHtml(c.draftText)}' />`;
    } else {
      inputHtml = `<textarea class='td-textarea td-scroll' id='td-mvu-val-input' style='min-height:110px;'>${escapeHtml(c.draftText)}</textarea>`;
    }
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-sm'>
        <div class='td-modal-head'><div class='td-modal-title'>修改变量 · 楼层 #${c.floorId}</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          <div class='td-code-block'>${escapeHtml(c.displayPath)}</div>
          <div class='td-field'><label class='td-label'>数据类型</label><select class='td-select' id='td-mvu-val-type'>${typeOpts}</select></div>
          <div class='td-field'><label class='td-label'>变量数值</label>${inputHtml}</div>
        </div>
        <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='mvu-save-val'>${ICONS.save} 写回楼层 #${c.floorId}</button></div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'mvuJsonEdit' && state.modal?.type === 'mvuViewer') {
    const c = state.previewCtx;
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>编辑 JSON · 楼层 #${c.floorId} (${c.editStatOnly ? 'stat_data' : '完整数据'})</div>
          <div style='display:flex;gap:4px;'>
            <button class='td-icon-btn' data-action='preview-undo' title='撤销' disabled>${ICONS.undo}</button>
            <button class='td-icon-btn' data-action='preview-redo' title='重做' disabled>${ICONS.redo}</button>
            <button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button>
          </div>
        </div>
        <div class='td-modal-body'>
          <div class='td-field' style='flex:1;display:flex;flex-direction:column;'>
            <div style='display:flex;justify-content:space-between;align-items:center;'>
              <label class='td-label'>JSON 内容（支持撤销/重做）</label>
              <button type='button' class='td-chip' data-action='mvu-format-json'>格式化 JSON</button>
            </div>
            <textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:240px;'>${escapeHtml(c.jsonText)}</textarea>
          </div>
        </div>
        <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='mvu-save-json'>${ICONS.save} 写回楼层 #${c.floorId}</button></div>
      </div>`;
    editHistory.stack = [readPreviewSnapshot()]; editHistory.index = 0; updatePreviewHistoryButtons();
    ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'mvuCmdEdit' && state.modal?.type === 'mvuViewer') {
    const c = state.previewCtx;
    const diffHtml = c.diffLines
      ? `<div class='td-field'><label class='td-label'>变更预览（stat_data）</label><div class='td-diff-box td-scroll'>${c.diffLines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div></div>`
      : '';
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'><div class='td-modal-title'>MVU 命令补全/执行 · 楼层 #${c.floorId}</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          ${c.detectedTruncated ? `<div class='td-attr-warn-banner'>已自动提取当前楼层消息中的更新命令片段，可直接补全缺失行后解析写回。</div>` : ''}
          <div class='td-field' style='flex:1;display:flex;flex-direction:column;'>
            <label class='td-label'>MVU 更新命令（支持 _.set / _.add / _.insert / _.delete / _.move）</label>
            <textarea class='td-textarea td-scroll' id='td-mvu-cmd-text' style='flex:1;min-height:150px;' placeholder="示例：\n_.set('角色.好感度', 30);\n_.add('角色.体力', -10);">${escapeHtml(c.cmdText || '')}</textarea>
          </div>
          ${diffHtml}
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='close-preview'>取消</button>
          <button class='td-btn' data-action='mvu-cmd-preview'>解析预览变更</button>
          <button class='td-btn primary' data-action='mvu-cmd-apply'>${ICONS.check} 写回楼层 #${c.floorId}</button>
        </div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'mvuAiUpdate' && state.modal?.type === 'mvuViewer') {
    const ai = state.previewCtx;
    if (ai.step === 'review') {
      const diffHtml = ai.parseError
        ? `<div class='td-attr-warn-banner'>解析提示：${escapeHtml(ai.parseError)}（可直接在上方编辑命令后点「重新解析」）</div>`
        : (ai.diffLines
          ? `<div class='td-diff-box td-scroll'>${ai.diffLines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`
          : '');
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>检视 AI 变量更新 · 目标楼层 #${ai.targetFloor}</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
          <div class='td-modal-body'>
            <div class='td-field'>
              <div style='display:flex;justify-content:space-between;align-items:center;'>
                <label class='td-label'>AI 生成的命令（可直接微调）</label>
                <button type='button' class='td-chip' data-action='mvu-ai-reparse'>重新解析</button>
              </div>
              <textarea class='td-textarea td-scroll' id='td-mvu-ai-reply' style='min-height:130px;'>${escapeHtml(ai.replyText || '')}</textarea>
            </div>
            <div class='td-field' style='flex:1;min-height:120px;'>
              <label class='td-label'>预演变更对比（stat_data）</label>
              ${diffHtml}
            </div>
          </div>
          <div class='td-modal-foot'>
            <button class='td-btn' data-action='mvu-ai-back'>返回设置</button>
            <button class='td-btn primary' data-action='mvu-ai-apply' ${ai.previewData ? '' : 'disabled'}>${ICONS.check} 确认写回楼层 #${ai.targetFloor}</button>
          </div>
        </div>`;
      ctx.syncOverlayBounds();
      return true;
    }

    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'><div class='td-modal-title'>AI 更新/补全 MVU · 楼层 #${ai.targetFloor}</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
        <div class='td-modal-body'>
          ${renderCollapsibleAiApiBoxHtml(ai)}
          <div class='td-field'>
            <label class='td-label'>2. 参考上下文设置</label>
            <div class='td-form-grid'>
              <div class='td-field'>
                <span class='td-label' style='font-size:11.5px;'>携带近期消息楼层数</span>
                <select class='td-select' id='td-mvu-ai-msgcount'>
                  <option value='1' ${ai.msgCount === 1 ? 'selected' : ''}>仅最新 1 条楼层</option>
                  <option value='2' ${ai.msgCount === 2 ? 'selected' : ''}>最近 2 条（用户+AI）</option>
                  <option value='4' ${ai.msgCount === 4 ? 'selected' : ''}>最近 4 条对话</option>
                </select>
              </div>
              <div class='td-field'>
                <span class='td-label' style='font-size:11.5px;'>写回目标楼层 ID</span>
                <input class='td-input' id='td-mvu-ai-floor' type='number' min='0' max='${Math.max(0, ai.lastMsgId)}' value='${ai.targetFloor}' />
              </div>
            </div>
            <div style='display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:10px;background:var(--td-surface);border:1px solid var(--td-border);'>
              <div style='display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;'>
                <label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;'>
                  <input type='checkbox' class='td-checkbox' id='td-mvu-ai-include-rules' ${ai.includeRules ? 'checked' : ''} ${ai.allRuleCandidates.length === 0 ? 'disabled' : ''} />
                  <span data-role='mvu-rule-summary'>附带世界书变量规则（${ai.ruleMode === 'manual' ? '手动' : '自动'}: ${ai.selectedRuleKeys.size}/${ai.allRuleCandidates.length} 条）</span>
                </label>
                ${ai.allRuleCandidates.length > 0 ? `
                  <div style='display:flex;gap:4px;'>
                    ${ai.ruleMode === 'manual' ? `<button type='button' class='td-chip' data-action='mvu-ai-rules-auto'>恢复自动</button>` : ''}
                    <button type='button' class='td-chip ${ai.rulesExpanded ? 'active' : ''}' data-action='mvu-ai-toggle-rules-box'>${ai.rulesExpanded ? '收起列表' : '手动选择'}</button>
                  </div>` : ''}
              </div>
              ${ai.rulesExpanded ? `
                <input class='td-input' id='td-mvu-rule-search' type='text' placeholder='筛选世界书条目名称或内容...' value='${escapeHtml(ai.ruleSearch || '')}' style='height:30px;font-size:12.5px;' />
                <div class='td-picker-list td-scroll' style='max-height:190px;min-height:80px;' data-role='mvu-rule-list'>
                  ${ai.allRuleCandidates
                    .filter((r) => {
                      const rq = (ai.ruleSearch || '').trim().toLowerCase();
                      return !rq || r.name.toLowerCase().includes(rq) || r.bookName.toLowerCase().includes(rq) || r.content.toLowerCase().includes(rq);
                    })
                    .map((r) => {
                      const chk = ai.selectedRuleKeys.has(r.key);
                      return `
                        <div class='td-picker-row ${chk ? 'checked' : ''}' style='min-height:36px;padding:5px 8px;'>
                          <label class='td-picker-left' style='cursor:pointer;'>
                            <input type='checkbox' class='td-checkbox' data-action='mvu-ai-toggle-rule' data-key='${escapeHtml(r.key)}' ${chk ? 'checked' : ''} />
                            <span class='td-item-name' style='font-size:12.5px;' title='${escapeHtml(`${r.bookName} / ${r.name}`)}'>[${escapeHtml(r.bookName)}] ${escapeHtml(r.name)}</span>
                          </label>
                          <div style='display:flex;align-items:center;gap:4px;flex-shrink:0;'>
                            ${r.autoMatched ? "<span class='td-mode-tag ok'>自动匹配</span>" : (!r.enabled ? "<span class='td-src-badge'>未启用</span>" : '')}
                            <button type='button' class='td-icon-btn' data-action='mvu-ai-preview-rule' data-key='${escapeHtml(r.key)}' title='预览条目内容'>${ICONS.eye}</button>
                          </div>
                        </div>`;
                    }).join('') || "<div class='td-group-empty'>无匹配条目</div>"}
                </div>` : ''}
            </div>
            ${ai.truncatedSnippet ? `
              <label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;'>
                <input type='checkbox' class='td-checkbox' id='td-mvu-ai-include-trunc' ${ai.includeTruncated ? 'checked' : ''} />
                <span>附带最新消息中的更新命令/截断片段以补全</span>
              </label>` : ''}
          </div>
          <div class='td-field' style='flex:1;display:flex;flex-direction:column;'>
            <label class='td-label'>3. 补充说明（可选，留空则由 AI 自动根据剧情推算）</label>
            <textarea class='td-textarea' id='td-mvu-ai-instruction' style='flex:1;min-height:85px;font-family:inherit;' placeholder='例如：刚刚角色花了50金币，好感度+3；或：只补全被截断的背包物品变更...'>${escapeHtml(ai.instruction || '')}</textarea>
          </div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='close-preview'>取消</button>
          <button class='td-btn primary' data-action='mvu-ai-run' ${ai.loading ? 'disabled' : ''}>${ai.loading ? 'AI 处理中，请稍候...' : '调用 AI 生成更新'}</button>
        </div>
      </div>`;
    ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'orbCrop') {
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
    ctx.syncOverlayBounds();
    bindOrbCropPointerEvents(previewLayerEl);
    drawOrbCropCanvas();
    return true;
  }

  if (state.previewCtx.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
    const ai = state.previewCtx;
    if (ai.step === 'review') {
      const reviewRows = (ai.results || []).map((r, rIdx) => {
        const lines = computeLineDiff(r.oldPrompt?.content || '', r.newContent || '');
        return `
          <div class='td-mgr-row ${r.accepted ? 'is-active' : ''}'>
            <div class='td-mgr-row-head'>
              <label style='display:flex;align-items:center;gap:8px;min-width:0;flex:1;cursor:pointer;'>
                <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                <span class='td-idx-badge'>#${r.index + 1}</span>
                <span class='td-mgr-row-title'>${escapeHtml(r.newName)}</span>
              </label>
              <span class='td-src-badge'>${escapeHtml(r.newRole)} · ${r.newEnabled ? '开' : '关'}</span>
            </div>
            ${r.note ? `<div style='font-size:11.5px;color:var(--td-text-muted);'>AI 说明：${escapeHtml(r.note)}</div>` : ''}
            <div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>
          </div>`;
      }).join('');

      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>检视 AI 修改结果 (${(ai.results || []).filter((x) => x.accepted).length}/${(ai.results || []).length})</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
          <div class='td-modal-body td-picker-body'><div class='td-picker-list td-scroll'>${reviewRows}</div></div>
          <div class='td-modal-foot'><button class='td-btn' data-action='ai-back-setup'>返回修改需求</button><button class='td-btn primary' data-action='ai-apply-results'>${ICONS.check} 写回已勾选条目</button></div>
        </div>`;
      ctx.syncOverlayBounds();
      return true;
    }

    const pList = state.modal.data.prompts || [], uList = state.modal.data.prompts_unused || [];
    const items = [
      ...pList.map((p, i) => ({ key: `prompts::${i}`, listName: 'prompts', index: i, label: `[主列表 #${i + 1}] ${p.name || p.id}` })),
      ...uList.map((p, i) => ({ key: `prompts_unused::${i}`, listName: 'prompts_unused', index: i, label: `[未添加 #${i + 1}] ${p.name || p.id}` })),
    ];
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = renderAiEditSetupHtml({ title: 'AI 智能编辑预设条目', ai, items, itemLabelFn: (it) => it.label });
    ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
    const ai = state.previewCtx;
    if (ai.step === 'review') {
      const reviewRows = (ai.results || []).map((r, rIdx) => {
        const lines = computeLineDiff(r.oldContent || '', r.newContent || '');
        return `
          <div class='td-mgr-row ${r.accepted ? 'is-active' : ''}'>
            <div class='td-mgr-row-head'>
              <label style='display:flex;align-items:center;gap:8px;min-width:0;flex:1;cursor:pointer;'>
                <input type='checkbox' class='td-checkbox' data-action='ai-toggle-accept' data-ridx='${rIdx}' ${r.accepted ? 'checked' : ''} />
                <span class='td-idx-badge'>#${r.index + 1}</span>
                <span class='td-mgr-row-title'>${escapeHtml(r.newName)}</span>
              </label>
              <span class='td-src-badge'>${r.newEnabled ? '开' : '关'}</span>
            </div>
            ${r.newKeys !== r.oldKeys ? `<div style='font-size:11.5px;color:var(--td-single);'>关键词：${escapeHtml(r.newKeys)}</div>` : ''}
            ${r.note ? `<div style='font-size:11.5px;color:var(--td-text-muted);'>AI 说明：${escapeHtml(r.note)}</div>` : ''}
            <div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>
          </div>`;
      }).join('');

      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>检视 AI 世界书修改 (${(ai.results || []).filter((x) => x.accepted).length}/${(ai.results || []).length})</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
          <div class='td-modal-body td-picker-body'><div class='td-picker-list td-scroll'>${reviewRows}</div></div>
          <div class='td-modal-foot'><button class='td-btn' data-action='ai-back-setup'>返回修改需求</button><button class='td-btn primary' data-action='ai-apply-results'>${ICONS.check} 写回已勾选条目</button></div>
        </div>`;
      ctx.syncOverlayBounds();
      return true;
    }

    const items = (state.modal.entries || []).map((e, i) => ({
      key: String(i),
      index: i,
      label: `[#${i + 1}] ${e.name || `条目 #${e.uid}`}`,
    }));
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = renderAiEditSetupHtml({ title: `AI 编辑世界书 · ${state.modal.bookName}`, ai, items, itemLabelFn: (it) => it.label });
    ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'pmContentEdit' && state.modal?.type === 'presetDetail') {
    const p = state.previewCtx.prompt;
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>编辑条目内容 · #${state.previewCtx.idx + 1} ${escapeHtml(p.name || p.id)}</div>
          <div style='display:flex;gap:4px;'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
        </div>
        <div class='td-modal-body'>
          <div class='td-field'><label class='td-label'>条目名称</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(p.name || '')}' /></div>
          <div class='td-field' style='flex:1;display:flex;flex-direction:column;'><label class='td-label'>提示词正文（支持撤销/重做）</label><textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:220px;'>${escapeHtml(typeof p.content === 'string' ? p.content : '')}</textarea></div>
        </div>
        <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='pm-save-content'>${ICONS.save} 应用到预设</button></div>
      </div>`;
    editHistory.stack = [readPreviewSnapshot()]; editHistory.index = 0; updatePreviewHistoryButtons(); ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'wbContentEdit' && state.modal?.type === 'worldbookDetail') {
    const e = state.previewCtx.entry;
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>编辑世界书内容 · ${escapeHtml(e.name || `#${e.uid}`)}</div>
          <div style='display:flex;gap:4px;'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
        </div>
        <div class='td-modal-body'>
          <div class='td-field'><label class='td-label'>条目标题</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(e.name || '')}' /></div>
          <div class='td-field' style='flex:1;display:flex;flex-direction:column;'><label class='td-label'>条目正文（支持撤销/重做）</label><textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:220px;'>${escapeHtml(e.content || '')}</textarea></div>
        </div>
        <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='wb-save-content'>${ICONS.save} 应用到世界书</button></div>
      </div>`;
    editHistory.stack = [readPreviewSnapshot()]; editHistory.index = 0; updatePreviewHistoryButtons(); ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'wbMergeCustom') {
    renderWbMergeCustomModal(previewLayerEl, ICONS);
    editHistory.stack = [readPreviewSnapshot()];
    editHistory.index = 0;
    updatePreviewHistoryButtons();
    ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'pmPromptEdit') {
    const p = state.previewCtx.prompt, isInChat = p.position?.type === 'in_chat';
    const isPlaceholder = PRESET_SYSTEM_IDS.has(p.id) && typeof p.content !== 'string';
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${state.previewCtx.isNew ? '新增预设条目' : `条目属性 · ${escapeHtml(p.name || p.id)}`}</div>
          <div style='display:flex;gap:4px;'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
        </div>
        <div class='td-modal-body'>
          <div style='display:flex;gap:8px;align-items:center;'><div class='td-field' style='flex:1;'><label class='td-label'>条目名称</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(p.name || '')}' /></div><label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'><input type='checkbox' class='td-checkbox' id='td-pm-p-enabled' ${p.enabled ? 'checked' : ''} /><span>启用</span></label></div>
          <div class='td-form-grid'>
            <div class='td-field'><label class='td-label'>角色身份 (Role)</label><select class='td-select' id='td-pm-p-role'><option value='system' ${p.role === 'system' ? 'selected' : ''}>System</option><option value='user' ${p.role === 'user' ? 'selected' : ''}>User</option><option value='assistant' ${p.role === 'assistant' ? 'selected' : ''}>Assistant</option></select></div>
            <div class='td-field'><label class='td-label'>插入位置</label><select class='td-select' id='td-pm-p-postype'><option value='relative' ${!isInChat ? 'selected' : ''}>相对位置 (Relative)</option><option value='in_chat' ${isInChat ? 'selected' : ''}>聊天深度 (In-Chat @D)</option></select></div>
            <div class='td-field'><label class='td-label'>深度 (Depth, @D有效)</label><input class='td-input' id='td-pm-p-depth' type='number' value='${escapeHtml(p.position?.depth ?? 4)}' /></div>
            <div class='td-field'><label class='td-label'>顺序 (Order, @D有效)</label><input class='td-input' id='td-pm-p-order' type='number' value='${escapeHtml(p.position?.order ?? 100)}' /></div>
          </div>
          <div class='td-field' style='flex:1;display:flex;flex-direction:column;'><label class='td-label'>提示词正文 ${isPlaceholder ? '（占位符条目一般留空）' : '（支持撤销/重做）'}</label><textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:150px;'>${escapeHtml(typeof p.content === 'string' ? p.content : '')}</textarea></div>
        </div>
        <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='pm-save-prompt'>${ICONS.save} 确认</button></div>
      </div>`;
    editHistory.stack = [readPreviewSnapshot()]; editHistory.index = 0; updatePreviewHistoryButtons(); ctx.syncOverlayBounds();
    return true;
  }

  if (state.previewCtx.type === 'wbEntryEdit') {
    const e = state.previewCtx.entry, stype = e.strategy?.type || 'selective', secLogic = e.strategy?.keys_secondary?.logic || 'and_any';
    const posType = e.position?.type || 'after_character_definition', posRole = e.position?.role || 'system';
    const scanDepthVal = e.strategy?.scan_depth === 'same_as_global' || e.strategy?.scan_depth === undefined ? '' : String(e.strategy.scan_depth);
    const posOpts = WB_POSITION_OPTIONS.map((o) => `<option value='${o.v}' ${posType === o.v ? 'selected' : ''}>${o.t}</option>`).join('');
    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${state.previewCtx.isNew ? '新增世界书条目' : `编辑世界书条目 · ${escapeHtml(e.name || `#${e.uid}`)}`}</div>
          <div style='display:flex;gap:4px;'><button class='td-icon-btn' data-action='preview-undo' title='撤销 (后退)' disabled>${ICONS.undo}</button><button class='td-icon-btn' data-action='preview-redo' title='重做 (前进)' disabled>${ICONS.redo}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
        </div>
        <div class='td-modal-body'>
          <div style='display:flex;gap:8px;align-items:center;'><div class='td-field' style='flex:1;'><label class='td-label'>条目标题</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(e.name || '')}' /></div><label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'><input type='checkbox' class='td-checkbox' id='td-wbe-enabled' ${e.enabled ? 'checked' : ''} /><span>启用</span></label></div>
          <div class='td-form-grid'>
            <div class='td-field'><label class='td-label'>触发策略</label><select class='td-select' id='td-wbe-stype'><option value='selective' ${stype === 'selective' ? 'selected' : ''}>绿灯 (关键词)</option><option value='constant' ${stype === 'constant' ? 'selected' : ''}>蓝灯 (常驻)</option><option value='vectorized' ${stype === 'vectorized' ? 'selected' : ''}>向量化</option></select></div>
            <div class='td-field'><label class='td-label'>插入位置</label><select class='td-select' id='td-wbe-postype'>${posOpts}</select></div>
            <div class='td-field'><label class='td-label'>插入深度 (@D 时有效)</label><input class='td-input' id='td-wbe-depth' type='number' value='${escapeHtml(e.position?.depth ?? 4)}' /></div>
            <div class='td-field'><label class='td-label'>深度身份 (@D 时有效)</label><select class='td-select' id='td-wbe-role'><option value='system' ${posRole === 'system' ? 'selected' : ''}>System</option><option value='user' ${posRole === 'user' ? 'selected' : ''}>User</option><option value='assistant' ${posRole === 'assistant' ? 'selected' : ''}>Assistant</option></select></div>
            <div class='td-field'><label class='td-label'>插入顺序 (Order)</label><input class='td-input' id='td-wbe-order' type='number' value='${escapeHtml(e.position?.order ?? 100)}' /></div>
            <div class='td-field'><label class='td-label'>触发概率 (%)</label><input class='td-input' id='td-wbe-prob' type='number' min='0' max='100' value='${escapeHtml(e.probability ?? 100)}' /></div>
          </div>
          <div class='td-field'><label class='td-label'>主要关键词（逗号或换行分隔，支持 /正则/i）</label><input class='td-input' id='td-wbe-keys' type='text' value='${escapeHtml(formatKeysInput(e.strategy?.keys))}' /></div>
          <div class='td-form-grid'>
            <div class='td-field'><label class='td-label'>次要关键词逻辑</label><select class='td-select' id='td-wbe-seclogic'><option value='and_any' ${secLogic === 'and_any' ? 'selected' : ''}>任一包含</option><option value='and_all' ${secLogic === 'and_all' ? 'selected' : ''}>全部包含</option><option value='not_any' ${secLogic === 'not_any' ? 'selected' : ''}>全部不含</option><option value='not_all' ${secLogic === 'not_all' ? 'selected' : ''}>非全含</option></select></div>
            <div class='td-field'><label class='td-label'>次要关键词</label><input class='td-input' id='td-wbe-seckeys' type='text' value='${escapeHtml(formatKeysInput(e.strategy?.keys_secondary?.keys))}' /></div>
          </div>
          <div class='td-form-grid'>
            <div class='td-field'><label class='td-label'>扫描深度（留空跟随全局）</label><input class='td-input' id='td-wbe-scandepth' type='number' placeholder='全局' value='${escapeHtml(scanDepthVal)}' /></div>
            <div class='td-field'><label class='td-label'>黏性 / 冷却 / 延迟</label><div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;'><input class='td-input' id='td-wbe-sticky' type='number' placeholder='黏' value='${escapeHtml(e.effect?.sticky ?? '')}' /><input class='td-input' id='td-wbe-cooldown' type='number' placeholder='冷' value='${escapeHtml(e.effect?.cooldown ?? '')}' /><input class='td-input' id='td-wbe-delay' type='number' placeholder='延' value='${escapeHtml(e.effect?.delay ?? '')}' /></div></div>
          </div>
          <div style='display:flex;gap:12px;flex-wrap:wrap;'>
            <label style='display:inline-flex;align-items:center;gap:5px;font-size:12px;'><input type='checkbox' class='td-checkbox' id='td-wbe-previn' ${e.recursion?.prevent_incoming ? 'checked' : ''} /> 禁止被递归激活</label>
            <label style='display:inline-flex;align-items:center;gap:5px;font-size:12px;'><input type='checkbox' class='td-checkbox' id='td-wbe-prevout' ${e.recursion?.prevent_outgoing ? 'checked' : ''} /> 禁止递归激活其他</label>
          </div>
          <div class='td-field' style='flex:1;display:flex;flex-direction:column;'><label class='td-label'>条目正文（支持撤销/重做）</label><textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:130px;'>${escapeHtml(e.content || '')}</textarea></div>
        </div>
        <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='wb-save-entry'>${ICONS.save} 确认</button></div>
      </div>`;
    editHistory.stack = [readPreviewSnapshot()]; editHistory.index = 0; updatePreviewHistoryButtons(); ctx.syncOverlayBounds();
    return true;
  }

  return false;
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
    renderSelectPopupView();
    ctx.renderModal();
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
  renderSelectPopupView();
  ctx.renderModal();
}

export function handleManagerClick(e, actionEl, action) {
  const modalLayerEl = ctx.getModalLayer();
  const previewLayerEl = ctx.getPreviewLayer();
  const selectLayerEl = ctx.getSelectLayer();

  if (action === 'open-mvu-viewer') {
    const charName = hasTH('getCurrentCharacterName') ? (callTH('getCurrentCharacterName') || '') : '';
    const hasStarred = getMvuStarredList(getMvuChatKey(charName)).length > 0;
    state.modal = {
      type: 'mvuViewer',
      floor: 'latest',
      onlyStatData: true,
      viewMode: hasStarred ? 'starred' : 'all',
      query: '',
      collapsed: new Set(),
    };
    ctx.renderModal(); return true;
  }
  if (action === 'mvu-set-view' && state.modal?.type === 'mvuViewer') {
    state.modal.viewMode = actionEl.getAttribute('data-view') === 'starred' ? 'starred' : 'all';
    state.modal.collapsed = new Set();
    ctx.renderModal(); return true;
  }
  if (action === 'mvu-import-char-stars' && state.modal?.type === 'mvuViewer') {
    const candidates = getOtherChatStarredCandidates(state.modal._charScopeId, state.modal._chatKey);
    if (candidates.length === 0) { notify('info', '同角色卡其他聊天暂无加精变量'); return true; }
    const ext = (state.store.extensions = state.store.extensions || {});
    const map = (ext.mvuStarred = ext.mvuStarred || {});
    map[state.modal._chatKey] = candidates;
    saveStore(state.store);
    ctx.renderModal();
    notify('success', `已导入 ${candidates.length} 项加精变量到当前聊天`);
    return true;
  }
  if (action === 'mvu-toggle-star' && state.modal?.type === 'mvuViewer') {
    e.stopPropagation();
    const starKey = actionEl.getAttribute('data-starkey');
    if (!starKey || !state.modal._chatKey) return true;
    const starred = toggleMvuStarKey(state.modal._chatKey, starKey);
    ctx.renderModal();
    notify('info', starred ? '已加精到本聊天重点关注' : '已取消加精');
    return true;
  }
  if (action === 'mvu-refresh' && state.modal?.type === 'mvuViewer') { ctx.renderModal(); notify('success', '已刷新 MVU 楼层变量'); return true; }
  if (action === 'mvu-toggle-only-stat' && state.modal?.type === 'mvuViewer') { state.modal.onlyStatData = !state.modal.onlyStatData; state.modal.collapsed = new Set(); ctx.renderModal(); return true; }
  if (action === 'mvu-floor-step' && state.modal?.type === 'mvuViewer') {
    const step = actionEl.getAttribute('data-step'), maxId = Math.max(0, state.modal._lastMsgId ?? 0);
    if (step === 'latest') state.modal.floor = 'latest';
    else state.modal.floor = Math.max(0, Math.min(maxId, (state.modal._resolvedFloor ?? maxId) + Number(step)));
    ctx.renderModal(); return true;
  }
  if (action === 'mvu-toggle-expand-all' && state.modal?.type === 'mvuViewer') {
    if (!(state.modal.collapsed instanceof Set)) state.modal.collapsed = new Set();
    if (state.modal.collapsed.size > 0) {
      state.modal.collapsed.clear();
    } else if (state.modal.viewMode === 'starred') {
      (state.modal._nodes || []).forEach((n) => {
        if (n.val && typeof n.val === 'object') state.modal.collapsed.add(n.keyId);
      });
    } else {
      collectMvuContainerPaths(state.modal._displayObj, [], state.modal.collapsed);
    }
    ctx.renderModal(); return true;
  }
  if (action === 'mvu-toggle-node' && state.modal?.type === 'mvuViewer') {
    if (e.target.closest("[data-action='mvu-copy-val'], [data-action='mvu-toggle-star']")) return true;
    const node = state.modal._nodes?.[Number(actionEl.getAttribute('data-nid'))];
    if (!node) return true;
    if (state.modal.collapsed.has(node.keyId)) state.modal.collapsed.delete(node.keyId);
    else state.modal.collapsed.add(node.keyId);
    ctx.renderModal(); return true;
  }
  if (action === 'mvu-copy-val' && state.modal?.type === 'mvuViewer') {
    e.stopPropagation();
    const node = state.modal._nodes?.[Number(actionEl.getAttribute('data-nid'))];
    if (!node) return true;
    const txt = (node.val !== null && typeof node.val === 'object') ? JSON.stringify(node.val, null, 2) : String(node.val ?? '');
    copyToClipboard(txt).then(() => notify('success', `已复制「${node.displayPath}」`)).catch(() => notify('error', '复制失败'));
    return true;
  }
  if (action === 'mvu-copy-json' && state.modal?.type === 'mvuViewer') {
    const dataToCopy = state.modal.viewMode === 'starred' ? (state.modal._starredExportObj ?? {}) : (state.modal._displayObj ?? {});
    copyToClipboard(JSON.stringify(dataToCopy, null, 2)).then(() => notify('success', '已复制当前变量 JSON')).catch(() => notify('error', '复制失败'));
    return true;
  }
  if (action === 'mvu-edit-val' && state.modal?.type === 'mvuViewer') {
    e.stopPropagation();
    const node = state.modal._nodes?.[Number(actionEl.getAttribute('data-nid'))];
    if (!node) return true;
    const v = node.val;
    const valType = v === null ? 'null' : (typeof v === 'number' ? 'number' : (typeof v === 'boolean' ? 'boolean' : (typeof v === 'object' ? 'json' : 'string')));
    const draftText = valType === 'json' ? JSON.stringify(v, null, 2) : (v === null ? 'null' : String(v));
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = {
      type: 'mvuValEdit',
      floorId: state.modal._resolvedFloor,
      pathParts: node.pathParts,
      displayPath: node.displayPath,
      valType,
      draftText,
      editStatOnly: node.editInStat !== undefined ? !!node.editInStat : !!(state.modal.onlyStatData && state.modal._hasStatData),
    };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'mvu-save-val' && state.previewCtx?.type === 'mvuValEdit' && state.modal?.type === 'mvuViewer') {
    const c = state.previewCtx;
    const typeEl = previewLayerEl.querySelector('#td-mvu-val-type');
    const valEl = previewLayerEl.querySelector('#td-mvu-val-input');
    const vt = typeEl ? typeEl.value : c.valType;
    const rawStr = valEl ? valEl.value : c.draftText;
    let parsedVal;
    try {
      if (vt === 'null') parsedVal = null;
      else if (vt === 'boolean') parsedVal = rawStr === 'true';
      else if (vt === 'number') {
        parsedVal = Number(rawStr);
        if (rawStr.trim() === '' || Number.isNaN(parsedVal)) throw new Error('请输入有效数字');
      } else if (vt === 'json') parsedVal = JSON.parse(rawStr);
      else parsedVal = String(rawStr);
    } catch (err) {
      notify('warning', `数值格式错误: ${err.message || err}`);
      return true;
    }
    const nextData = JSON.parse(JSON.stringify(state.modal._rawData || {}));
    const targetRoot = (c.editStatOnly && nextData.stat_data) ? nextData.stat_data : nextData;
    try {
      setByPathParts(targetRoot, c.pathParts, parsedVal);
    } catch (err) {
      notify('error', err.message || '写入路径失败');
      return true;
    }
    saveFloorMvuData(c.floorId, nextData).then(() => {
      state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal();
      notify('success', `已更新楼层 #${c.floorId} 变量「${c.displayPath}」`);
    }).catch((err) => { logError('写入 MVU 变量失败', err); notify('error', err.message || String(err)); });
    return true;
  }
  if (action === 'mvu-open-json-edit' && state.modal?.type === 'mvuViewer') {
    const editStatOnly = !!(state.modal.onlyStatData && state.modal._hasStatData);
    const baseObj = editStatOnly ? state.modal._rawData.stat_data : (state.modal._rawData || { initialized_lorebooks: {}, stat_data: {} });
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = {
      type: 'mvuJsonEdit',
      floorId: state.modal._resolvedFloor,
      editStatOnly,
      jsonText: JSON.stringify(baseObj, null, 2),
    };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'mvu-format-json' && state.previewCtx?.type === 'mvuJsonEdit') {
    const ta = previewLayerEl.querySelector('#td-edit-content');
    if (!ta) return true;
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
      pushEditSnapshot(true);
    } catch (err) { notify('warning', `JSON 语法错误: ${err.message}`); }
    return true;
  }
  if (action === 'mvu-save-json' && state.previewCtx?.type === 'mvuJsonEdit' && state.modal?.type === 'mvuViewer') {
    pushEditSnapshot(true);
    const c = state.previewCtx;
    const rawStr = previewLayerEl.querySelector('#td-edit-content')?.value || '';
    let parsed;
    try { parsed = JSON.parse(rawStr); } catch (err) { notify('warning', `JSON 语法错误: ${err.message}`); return true; }
    let nextData;
    if (c.editStatOnly && state.modal._rawData && typeof state.modal._rawData === 'object') {
      nextData = JSON.parse(JSON.stringify(state.modal._rawData));
      nextData.stat_data = parsed;
    } else {
      nextData = parsed;
    }
    saveFloorMvuData(c.floorId, nextData).then(() => {
      state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal();
      notify('success', `已保存 JSON 到楼层 #${c.floorId}`);
    }).catch((err) => { logError('保存 MVU JSON 失败', err); notify('error', err.message || String(err)); });
    return true;
  }
  if (action === 'mvu-open-cmd-edit' && state.modal?.type === 'mvuViewer') {
    const floorId = state.modal._resolvedFloor;
    let snippet = '';
    try {
      if (hasTH('getChatMessages')) {
        const msg = callTH('getChatMessages', state.modal._lastMsgId)?.[0];
        snippet = extractMvuSnippetFromMessage(msg?.message);
      }
    } catch (e) {}
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = {
      type: 'mvuCmdEdit',
      floorId,
      cmdText: snippet,
      detectedTruncated: !!snippet,
      diffLines: null,
      previewData: null,
      previewedText: '',
    };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'mvu-cmd-preview' && state.previewCtx?.type === 'mvuCmdEdit' && state.modal?.type === 'mvuViewer') {
    const c = state.previewCtx;
    c.cmdText = previewLayerEl.querySelector('#td-mvu-cmd-text')?.value || '';
    parseMvuCommandsPreview(c.cmdText, state.modal._rawData).then(({ nextData, diffLines }) => {
      c.previewData = nextData; c.diffLines = diffLines; c.previewedText = c.cmdText;
      ctx.renderPreviewModal();
      notify('success', '解析成功，请确认下方变更对比');
    }).catch((err) => { logWarn('解析 MVU 命令失败', err); notify('warning', err.message || String(err)); });
    return true;
  }
  if (action === 'mvu-cmd-apply' && state.previewCtx?.type === 'mvuCmdEdit' && state.modal?.type === 'mvuViewer') {
    const c = state.previewCtx;
    c.cmdText = previewLayerEl.querySelector('#td-mvu-cmd-text')?.value || '';
    const ensureParsed = (c.previewData && c.previewedText === c.cmdText)
      ? Promise.resolve(c.previewData)
      : parseMvuCommandsPreview(c.cmdText, state.modal._rawData).then((r) => r.nextData);
    ensureParsed.then((nextData) => saveFloorMvuData(c.floorId, nextData)).then(() => {
      state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal();
      notify('success', `已执行命令并更新楼层 #${c.floorId}`);
    }).catch((err) => { logError('执行 MVU 命令失败', err); notify('error', err.message || String(err)); });
    return true;
  }
  if (action === 'mvu-open-ai-update' && state.modal?.type === 'mvuViewer') {
    let snippet = '';
    try {
      if (hasTH('getChatMessages') && state.modal._lastMsgId >= 0) {
        const msg = callTH('getChatMessages', state.modal._lastMsgId)?.[0];
        snippet = extractMvuSnippetFromMessage(msg?.message);
      }
    } catch (e) {}
    const allRuleCandidates = collectWorldbookMvuRuleCandidates();
    const autoKeys = allRuleCandidates.filter((r) => r.autoMatched).map((r) => r.key);
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = {
      type: 'mvuAiUpdate',
      step: 'setup',
      targetFloor: state.modal._resolvedFloor >= 0 ? state.modal._resolvedFloor : 0,
      lastMsgId: Math.max(0, state.modal._lastMsgId ?? 0),
      msgCount: 2,
      allRuleCandidates,
      ruleMode: 'auto',
      selectedRuleKeys: new Set(autoKeys),
      rulesExpanded: false,
      ruleSearch: '',
      includeRules: autoKeys.length > 0,
      truncatedSnippet: snippet,
      includeTruncated: !!snippet,
      instruction: '',
      loading: false,
      replyText: '',
      previewData: null,
      diffLines: null,
      parseError: '',
    };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'mvu-ai-toggle-rules-box' && state.previewCtx?.type === 'mvuAiUpdate') {
    saveSharedAiApiFieldsFromPreview(previewLayerEl);
    syncAiPreviewDraftInputs(previewLayerEl);
    state.previewCtx.rulesExpanded = !state.previewCtx.rulesExpanded;
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'mvu-ai-preview-rule' && state.previewCtx?.type === 'mvuAiUpdate') {
    e.stopPropagation();
    const k = actionEl.getAttribute('data-key') || '';
    const r = state.previewCtx.allRuleCandidates?.find((x) => x.key === k);
    if (!r) return true;
    state.selectPopup = {
      type: 'aiItemPreview',
      title: r.name,
      metas: [
        `世界书: ${r.bookName || '未知'}`,
        `状态: ${r.enabled ? '开启' : '关闭'}`,
        r.autoMatched ? '自动匹配规则' : '手动可选条目',
      ],
      content: r.content || '',
    };
    renderSelectPopupView();
    return true;
  }
  if (action === 'mvu-ai-rules-auto' && state.previewCtx?.type === 'mvuAiUpdate') {
    const ai = state.previewCtx;
    ai.ruleMode = 'auto';
    ai.selectedRuleKeys = new Set(ai.allRuleCandidates.filter((r) => r.autoMatched).map((r) => r.key));
    ai.includeRules = ai.selectedRuleKeys.size > 0;
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'mvu-ai-toggle-rule' && state.previewCtx?.type === 'mvuAiUpdate') {
    const ai = state.previewCtx;
    const k = actionEl.getAttribute('data-key');
    if (ai.selectedRuleKeys.has(k)) ai.selectedRuleKeys.delete(k);
    else ai.selectedRuleKeys.add(k);
    ai.ruleMode = 'manual';
    if (ai.selectedRuleKeys.size > 0) ai.includeRules = true;
    const sumEl = previewLayerEl.querySelector("[data-role='mvu-rule-summary']");
    if (sumEl) sumEl.textContent = `附带世界书变量规则（手动: ${ai.selectedRuleKeys.size}/${ai.allRuleCandidates.length} 条）`;
    const incEl = previewLayerEl.querySelector('#td-mvu-ai-include-rules');
    if (incEl && ai.selectedRuleKeys.size > 0) incEl.checked = true;
    actionEl.closest('.td-picker-row')?.classList.toggle('checked', ai.selectedRuleKeys.has(k));
    return true;
  }
  if (action === 'mvu-ai-run' && state.previewCtx?.type === 'mvuAiUpdate' && state.modal?.type === 'mvuViewer') {
    const ai = state.previewCtx;
    if (ai.loading) return true;
    const cfg = saveSharedAiApiFieldsFromPreview(previewLayerEl);
    ai.msgCount = Number(previewLayerEl.querySelector('#td-mvu-ai-msgcount')?.value) || 2;
    const floorInput = Number(previewLayerEl.querySelector('#td-mvu-ai-floor')?.value);
    if (!Number.isNaN(floorInput)) ai.targetFloor = Math.max(0, Math.min(ai.lastMsgId, Math.floor(floorInput)));
    ai.includeRules = !!previewLayerEl.querySelector('#td-mvu-ai-include-rules')?.checked;
    ai.includeTruncated = !!previewLayerEl.querySelector('#td-mvu-ai-include-trunc')?.checked;
    ai.instruction = previewLayerEl.querySelector('#td-mvu-ai-instruction')?.value ?? ai.instruction;

    let messages = [];
    try {
      if (hasTH('getChatMessages')) {
        const startId = Math.max(0, ai.lastMsgId - ai.msgCount + 1);
        messages = callTH('getChatMessages', `${startId}-${ai.lastMsgId}`) || [];
      }
    } catch (e) { logWarn('读取近期对话楼层失败', e); }

    const baseData = (() => {
      try {
        const opt = { type: 'message', message_id: ai.targetFloor };
        if (window.Mvu?.getMvuData) return window.Mvu.getMvuData(opt);
        if (hasTH('getVariables')) return callTH('getVariables', opt);
      } catch (e) {}
      return state.modal._rawData;
    })();
    ai._baseData = JSON.parse(JSON.stringify(baseData || { initialized_lorebooks: {}, stat_data: {} }));
    const chosenRules = ai.includeRules
      ? ai.allRuleCandidates.filter((r) => ai.selectedRuleKeys.has(r.key))
      : [];

    ai.loading = true;
    setAiRunBtnLoading(previewLayerEl, true, "[data-action='mvu-ai-run']", '调用 AI 生成更新');
    runAiMvuUpdate({
      currentStatData: ai._baseData.stat_data ?? ai._baseData,
      messages,
      truncatedSnippet: ai.includeTruncated ? ai.truncatedSnippet : '',
      ruleEntries: chosenRules,
      instruction: ai.instruction,
      apiCfg: cfg,
    }).then(async ({ rawReply }) => {
      ai.loading = false;
      ai.replyText = rawReply;
      ai.step = 'review';
      try {
        const res = await parseMvuCommandsPreview(rawReply, ai._baseData);
        ai.previewData = res.nextData; ai.diffLines = res.diffLines; ai.parseError = '';
      } catch (err) {
        ai.previewData = null; ai.diffLines = null; ai.parseError = err.message || String(err);
      }
      ctx.renderPreviewModal();
    }).catch((err) => {
      ai.loading = false;
      setAiRunBtnLoading(previewLayerEl, false, "[data-action='mvu-ai-run']", '调用 AI 生成更新');
      logError('AI 更新 MVU 失败', err);
      notify('error', err.message || String(err));
    });
    return true;
  }
  if (action === 'mvu-ai-reparse' && state.previewCtx?.type === 'mvuAiUpdate') {
    const ai = state.previewCtx;
    ai.replyText = previewLayerEl.querySelector('#td-mvu-ai-reply')?.value ?? ai.replyText;
    parseMvuCommandsPreview(ai.replyText, ai._baseData).then(({ nextData, diffLines }) => {
      ai.previewData = nextData; ai.diffLines = diffLines; ai.parseError = '';
      ctx.renderPreviewModal();
      notify('success', '重新解析成功');
    }).catch((err) => {
      ai.previewData = null; ai.diffLines = null; ai.parseError = err.message || String(err);
      ctx.renderPreviewModal();
      notify('warning', err.message || String(err));
    });
    return true;
  }
  if (action === 'mvu-ai-back' && state.previewCtx?.type === 'mvuAiUpdate') {
    state.previewCtx.step = 'setup'; ctx.renderPreviewModal(); return true;
  }
  if (action === 'mvu-ai-apply' && state.previewCtx?.type === 'mvuAiUpdate' && state.modal?.type === 'mvuViewer') {
    const ai = state.previewCtx;
    const latestReply = previewLayerEl.querySelector('#td-mvu-ai-reply')?.value ?? ai.replyText;
    const ensureParsed = (ai.previewData && latestReply === ai.replyText)
      ? Promise.resolve(ai.previewData)
      : parseMvuCommandsPreview(latestReply, ai._baseData).then((r) => r.nextData);
    ensureParsed.then((nextData) => saveFloorMvuData(ai.targetFloor, nextData)).then(() => {
      state.modal.floor = ai.targetFloor;
      state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal();
      notify('success', `已将 AI 变量更新写回楼层 #${ai.targetFloor}`);
    }).catch((err) => { logError('写回 AI MVU 更新失败', err); notify('error', err.message || String(err)); });
    return true;
  }
  if (action === 'open-logs') { state.modal = { type: 'logs', filter: 'ALL' }; ctx.renderModal(); return true; }
  if (action === 'logs-set-filter' && state.modal?.type === 'logs') { state.modal.filter = actionEl.getAttribute('data-filter') || 'ALL'; ctx.renderModal(); return true; }
  if (action === 'logs-refresh' && state.modal?.type === 'logs') { ctx.renderModal(); return true; }
  if (action === 'logs-clear' && state.modal?.type === 'logs') { clearDevLogs(); ctx.renderModal(); return true; }
  if (action === 'logs-copy' && state.modal?.type === 'logs') {
    copyToClipboard(formatLogsReport(state.modal.filter || 'ALL')).then(() => notify('success', '日志已复制到剪贴板')).catch((err) => { logError('复制日志失败', err); notify('error', '复制失败'); });
    return true;
  }
  if (action === 'logs-export' && state.modal?.type === 'logs') {
    const filter = state.modal.filter || 'ALL';
    downloadTextFile(formatLogsReport(filter), `TavernDeck-logs-${new Date().toISOString().slice(0, 10)}.txt`);
    notify('success', '已导出运行日志 (.txt)');
    return true;
  }

  if (action === 'orb-crop-reset' && state.previewCtx?.type === 'orbCrop') {
    state.previewCtx.zoom = 1;
    state.previewCtx.offsetX = 0;
    state.previewCtx.offsetY = 0;
    const zr = previewLayerEl.querySelector('#td-crop-zoom');
    if (zr) zr.value = '100';
    const zl = previewLayerEl.querySelector("[data-role='crop-zoom-label']");
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
      ctx.renderPreviewModal();
      ctx.renderOrb();
      if (state.modal?.type === 'settings') ctx.renderModal();
      notify('success', '悬浮球图片已裁剪并应用');
    } catch (err) {
      logError('裁剪悬浮球图片失败', err);
      notify('error', `裁剪失败: ${err.message || err}`);
    }
    return true;
  }

  if (action === 'open-select-popup') { state.selectPopup = { type: actionEl.getAttribute('data-select-type') }; renderSelectPopupView(); return true; }
  if (action === 'close-select-popup') { state.selectPopup = null; renderSelectPopupView(); return true; }
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
    saveStore(state.store); ctx.applyThemeAttributes(); ctx.syncTopBarUI();
    state.selectPopup = null; renderSelectPopupView();
    if (state.modal?.type === 'settings') ctx.renderModal();
    return true;
  }
  if (action === 'select-popup-apply-color' && state.selectPopup) {
    const inp = selectLayerEl?.querySelector('#td-sp-color-input'), parsed = normalizeColorInput(inp ? inp.value : '');
    if (!parsed.ok) { notify('warning', '颜色格式无效，支持 #RRGGBB、rgb(...) 或标准颜色名'); return true; }
    if (state.selectPopup.type === 'groupTextColor') state.store.settings.groupTextColor = parsed.value;
    else if (state.selectPopup.type === 'orbStyle') state.store.settings.orbStyle = parsed.value || 'indigo';
    else state.store.settings.entryTextColor = parsed.value;
    saveStore(state.store); ctx.applyThemeAttributes();
    state.selectPopup = null; renderSelectPopupView();
    if (state.modal?.type === 'settings') ctx.renderModal();
    notify('success', parsed.value ? `已应用颜色 ${parsed.value}` : '已恢复默认颜色');
    return true;
  }

  if (action === 'open-wb-merge') { state.modal = { type: 'wbMergeSelect', oldName: '', newName: '' }; ctx.renderModal(); return true; }
  if (action === 'resume-wb-merge' && state.mergeDrafts?.worldbook) {
    const session = state.mergeDrafts.worldbook;
    state.modal = { type: 'wbMerge', session };
    ctx.renderModal();
    if (session._pendingCustom) {
      const pc = session._pendingCustom;
      const entry = session.entries.find((x) => x.key === pc.entryKey);
      if (entry) {
        state.previewKey = null;
        state.snapshotDetailId = null;
        state.previewCtx = {
          type: 'wbMergeCustom',
          entry,
          contentOnly: !!pc.contentOnly,
          syncScroll: false,
          edited: true,
          draft: JSON.parse(JSON.stringify(pc.draft)),
        };
        ctx.renderPreviewModal();
      }
    }
    notify('info', '已恢复上次未完成的世界书缝合草稿');
    return true;
  }
  if (action === 'discard-wb-merge-draft') {
    clearMergeDraft('worldbook');
    ctx.renderModal();
    return true;
  }
  if (action === 'swap-wb-merge' && state.modal?.type === 'wbMergeSelect') {
    const oldSel = modalLayerEl.querySelector('#td-wb-merge-old-select'), newSel = modalLayerEl.querySelector('#td-wb-merge-new-select');
    const a = oldSel ? oldSel.value : state.modal.oldName, b = newSel ? newSel.value : state.modal.newName;
    state.modal.oldName = b; state.modal.newName = a; if (oldSel) oldSel.value = b; if (newSel) newSel.value = a;
    return true;
  }
  if (action === 'start-wb-merge' && state.modal?.type === 'wbMergeSelect') {
    const oldName = modalLayerEl.querySelector('#td-wb-merge-old-select')?.value || state.modal.oldName;
    const newName = modalLayerEl.querySelector('#td-wb-merge-new-select')?.value || state.modal.newName;
    if (!oldName || !newName || oldName === newName) { notify('warning', '请选择两本不同的世界书'); return true; }
    buildWorldbookDiffSession(oldName, newName).then((session) => { state.modal = { type: 'wbMerge', session }; ctx.renderModal(); })
      .catch((err) => { logError('读取对比世界书失败', err); notify('error', `读取世界书失败: ${err.message || err}`); });
    return true;
  }
  if (action === 'toggle-wb-merge-controls' && state.modal?.type === 'wbMerge') { state.modal.session.controlsOpen = !state.modal.session.controlsOpen; updateWbMergeBody(); return true; }
  if (action === 'set-wb-merge-filter' && state.modal?.type === 'wbMerge') { state.modal.session.filter = actionEl.getAttribute('data-filter') || 'diff'; updateWbMergeBody(); return true; }
  if (action === 'toggle-wb-merge-expand' && state.modal?.type === 'wbMerge') {
    const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
    if (entry) { entry.expanded = !entry.expanded; updateWbMergeBody(); }
    return true;
  }
  if (action === 'set-wb-merge-choice' && state.modal?.type === 'wbMerge') {
    e.stopPropagation();
    const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
    if (entry) {
      entry.choice = actionEl.getAttribute('data-choice');
      state.modal.session.dirty = true;
      saveMergeDraft('worldbook', state.modal.session);
      updateWbMergeBody();
    }
    return true;
  }
  if (action === 'wb-merge-batch-old' && state.modal?.type === 'wbMerge') { state.modal.session.entries.forEach((it) => { if (it.oldEntry) it.choice = 'old'; }); state.modal.session.dirty = true; saveMergeDraft('worldbook', state.modal.session); updateWbMergeBody(); return true; }
  if (action === 'wb-merge-batch-new' && state.modal?.type === 'wbMerge') { state.modal.session.entries.forEach((it) => { it.choice = 'new'; }); state.modal.session.dirty = true; saveMergeDraft('worldbook', state.modal.session); updateWbMergeBody(); return true; }
  if (action === 'wb-merge-batch-states' && state.modal?.type === 'wbMerge') {
    let cnt = 0;
    state.modal.session.entries.forEach((it) => {
      if (it.status === 'conflict' && it.oldEntry && it.newEntry) {
        const merged = cloneWorldbookEntry(it.newEntry); merged.enabled = !!it.oldEntry.enabled;
        it.customEntry = merged; it.choice = 'custom'; cnt++;
      }
    });
    if (cnt > 0) {
      state.modal.session.dirty = true;
      saveMergeDraft('worldbook', state.modal.session);
    }
    updateWbMergeBody(); notify('success', `已将 ${cnt} 个冲突条目的开关迁移为旧版`); return true;
  }
  if ((action === 'open-wb-merge-custom' || action === 'open-wb-merge-custom-content-only') && state.modal?.type === 'wbMerge') {
    e.stopPropagation();
    const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
    if (!entry) return true;
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = initWbMergeCustomCtx(entry, {
      contentOnly: action === 'open-wb-merge-custom-content-only',
    });
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'wb-merge-apply-target' && state.modal?.type === 'wbMerge') {
    const session = state.modal.session;
    ctx.openConfirm({
      title: '覆盖目标世界书确认', message: `确定要将缝合后的条目覆盖保存到世界书「${session.newName}」吗？`, confirmText: '确认覆盖', confirmClass: 'danger',
      onConfirm: () => executeWorldbookStitch(session, 'overwrite').then(() => { session.dirty = false; delete session._pendingCustom; clearMergeDraft('worldbook'); state.modal = null; ctx.renderModal(); refreshWorldbookCatalog(false).then(() => ctx.renderMain()); }).catch((err) => { logError('覆盖缝合世界书失败', err); notify('error', err.message || String(err)); }),
    });
    return true;
  }
  if (action === 'wb-merge-save-as' && state.modal?.type === 'wbMerge') {
    const session = state.modal.session;
    const newName = window.prompt('请输入另存为的新世界书名称：', `${session.newName}-缝合版`);
    if (!newName || !newName.trim()) return true;
    executeWorldbookStitch(session, 'new', newName.trim()).then(() => { session.dirty = false; delete session._pendingCustom; clearMergeDraft('worldbook'); state.modal = null; ctx.renderModal(); refreshWorldbookCatalog(false).then(() => ctx.renderMain()); }).catch((err) => { logError('另存缝合世界书失败', err); notify('error', err.message || String(err)); });
    return true;
  }

  if (action === 'open-preset-manager') { state.modal = { type: 'presetManager', query: '', toolsOpen: false }; ctx.renderModal(); return true; }
  if (action === 'pm-toggle-tools' && state.modal?.type === 'presetManager') { state.modal.toolsOpen = !state.modal.toolsOpen; ctx.renderModal(); return true; }
  if (action === 'pm-load') { ctx.performSwitchPreset(actionEl.getAttribute('data-name')); setTimeout(() => { if (state.modal?.type === 'presetManager') ctx.renderModal(); }, 180); return true; }
  if (action === 'pm-save-inuse-back') { saveInUseToPreset(actionEl.getAttribute('data-name')).then(() => ctx.renderModal()).catch((err) => { logError('保存实时修改回预设失败', err); notify('error', err.message || String(err)); }); return true; }
  if (action === 'pm-create') {
    const name = window.prompt('请输入新建预设名称：', ''); if (!name || !name.trim()) return true;
    createNewPresetSafe(name.trim()).then(() => refreshAllCatalogs()).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('新建预设失败', err); notify('error', err.message || String(err)); }); return true;
  }
  if (action === 'pm-save-inuse-as') {
    const name = window.prompt('将当前实时预设另存为：', `${state.presetName || '预设'}-副本`); if (!name || !name.trim()) return true;
    createNewPresetSafe(name.trim(), 'in_use').then(() => refreshAllCatalogs()).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('另存预设失败', err); notify('error', err.message || String(err)); }); return true;
  }
  if (action === 'pm-duplicate') {
    const src = actionEl.getAttribute('data-name'); const name = window.prompt(`复制预设「${src}」为：`, `${src}-副本`); if (!name || !name.trim()) return true;
    createNewPresetSafe(name.trim(), src).then(() => refreshAllCatalogs()).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('复制预设失败', err); notify('error', err.message || String(err)); }); return true;
  }
  if (action === 'pm-rename') {
    const oldName = actionEl.getAttribute('data-name'); const newName = window.prompt(`重命名预设「${oldName}」为：`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return true;
    renameSavedPresetSafe(oldName, newName.trim()).then(() => refreshAllCatalogs()).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('重命名预设失败', err); notify('error', err.message || String(err)); }); return true;
  }
  if (action === 'pm-export') { try { exportPresetFile(actionEl.getAttribute('data-name')); } catch (err) { logError('导出预设失败', err); notify('error', err.message || String(err)); } return true; }
  if (action === 'pm-trigger-import') { modalLayerEl.querySelector('#td-pm-import-file')?.click(); return true; }
  if (action === 'pm-delete') {
    const name = actionEl.getAttribute('data-name');
    ctx.openConfirm({
      title: '删除预设确认', message: `确定要永久删除预设「${name}」吗？`, confirmText: '确认删除',
      onConfirm: () => deleteSavedPresetSafe(name).then(() => refreshAllCatalogs()).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('删除预设失败', err); notify('error', err.message || String(err)); }),
    });
    return true;
  }
  if (action === 'pm-open-detail') {
    const name = actionEl.getAttribute('data-name');
    try { state.modal = { type: 'presetDetail', presetName: name, data: getPresetDetail(name), tab: 'prompts', query: '', dirty: false, toolsOpen: false, batchMode: false, selectedIdx: new Set() }; ctx.renderModal(); }
    catch (err) { logError('读取预设详情失败', err); notify('error', err.message || String(err)); }
    return true;
  }
  if (action === 'pm-back-list' && state.modal?.type === 'presetDetail') {
    confirmDiscardDirtyModal(() => {
      state.modal = { type: 'presetManager', query: '', toolsOpen: false };
      ctx.renderModal();
    });
    return true;
  }
  if (action === 'pm-detail-tab' && state.modal?.type === 'presetDetail') { state.modal.tab = actionEl.getAttribute('data-tab') || 'prompts'; state.modal.selectedIdx = new Set(); ctx.renderModal(); return true; }
  if (action === 'pm-detail-toggle-tools' && state.modal?.type === 'presetDetail') { state.modal.toolsOpen = !state.modal.toolsOpen; ctx.renderModal(); return true; }
  if (action === 'pm-jump-idx' && state.modal?.type === 'presetDetail') {
    const listName = state.modal.tab === 'unused' ? 'prompts_unused' : 'prompts';
    const list = state.modal.data[listName] || [];
    const num = Number(modalLayerEl.querySelector('#td-pm-jump-idx')?.value);
    if (Number.isNaN(num) || num < 1 || num > list.length) {
      notify('warning', `请输入 1 ~ ${list.length} 之间的有效序号`);
      return true;
    }
    const targetIdx = Math.floor(num) - 1;
    const scrollToRow = () => {
      const box = modalLayerEl.querySelector('.td-picker-list');
      const row = box?.querySelector(`.td-mgr-row[data-idx='${targetIdx}']`);
      if (!box || !row) return;
      const boxRect = box.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      box.scrollTo({ top: box.scrollTop + (rowRect.top - boxRect.top) - 8, behavior: 'smooth' });
      row.style.transition = 'box-shadow 0.25s ease';
      row.style.boxShadow = '0 0 0 2px var(--td-accent)';
      setTimeout(() => { if (row.isConnected) row.style.boxShadow = ''; }, 1600);
    };
    if (!modalLayerEl.querySelector(`.td-mgr-row[data-idx='${targetIdx}']`) && (state.modal.query || '').trim()) {
      state.modal.query = '';
      ctx.renderModal();
      requestAnimationFrame(scrollToRow);
    } else {
      scrollToRow();
    }
    return true;
  }
  if (action === 'pm-toggle-batch' && state.modal?.type === 'presetDetail') {
    state.modal.batchMode = !state.modal.batchMode; state.modal.selectedIdx = new Set(); ctx.renderModal(); return true;
  }
  if (action === 'pm-batch-check' && state.modal?.type === 'presetDetail') {
    const idx = Number(actionEl.getAttribute('data-idx'));
    if (state.modal.selectedIdx.has(idx)) state.modal.selectedIdx.delete(idx);
    else state.modal.selectedIdx.add(idx);
    actionEl.closest('.td-mgr-row')?.classList.toggle('is-active', state.modal.selectedIdx.has(idx));
    const batchBtn = modalLayerEl.querySelector("[data-action='pm-toggle-batch']");
    if (batchBtn) batchBtn.textContent = `退出批量 (已选 ${state.modal.selectedIdx.size})`;
    return true;
  }
  if (action === 'pm-batch-move' && state.modal?.type === 'presetDetail') {
    const indices = Array.from(state.modal.selectedIdx || []);
    if (indices.length === 0) { notify('warning', '请先勾选要移动的条目'); return true; }
    const listName = state.modal.tab === 'unused' ? 'prompts_unused' : 'prompts';
    state.selectPopup = { type: 'movePromptTarget', mode: 'move', listName, fromIndices: indices };
    renderSelectPopupView(); return true;
  }
  if (action === 'pm-batch-join' && state.modal?.type === 'presetDetail' && state.modal.tab === 'unused') {
    const indices = Array.from(state.modal.selectedIdx || []);
    if (indices.length === 0) { notify('warning', '请先勾选要加入主列表的条目'); return true; }
    state.selectPopup = { type: 'movePromptTarget', mode: 'insertFromUnused', listName: 'prompts', fromIndices: indices };
    renderSelectPopupView(); return true;
  }
  if (action === 'pm-toggle-prompt' && state.modal?.type === 'presetDetail') {
    const list = state.modal.data[actionEl.getAttribute('data-list')], idx = Number(actionEl.getAttribute('data-idx'));
    if (list && list[idx]) {
      list[idx].enabled = !list[idx].enabled;
      state.modal.dirty = true;
      actionEl.classList.toggle('on', !!list[idx].enabled);
      const dirtyEl = modalLayerEl.querySelector("[data-role='pm-dirty-label']");
      if (dirtyEl) dirtyEl.textContent = '有未保存修改';
    }
    return true;
  }
  if (action === 'pm-move-before' && state.modal?.type === 'presetDetail') {
    state.selectPopup = { type: 'movePromptTarget', mode: 'move', listName: actionEl.getAttribute('data-list'), fromIndices: [Number(actionEl.getAttribute('data-idx'))] };
    renderSelectPopupView(); return true;
  }
  if (action === 'pm-swap-pool' && state.modal?.type === 'presetDetail') {
    const listName = actionEl.getAttribute('data-list'), idx = Number(actionEl.getAttribute('data-idx'));
    const p = state.modal.data[listName]?.[idx]; if (!p) return true;
    if (listName === 'prompts_unused') {
      state.selectPopup = { type: 'movePromptTarget', mode: 'insertFromUnused', listName: 'prompts', fromIndices: [idx] };
      renderSelectPopupView(); return true;
    }
    ctx.openConfirm({
      title: '移入未添加池确认', message: `确定要将条目 #${idx + 1}「${p.name || p.id}」移入未添加池吗？`, confirmText: '确认移动', confirmClass: 'warn',
      onConfirm: () => {
        const [moved] = state.modal.data.prompts.splice(idx, 1);
        if (moved) { state.modal.data.prompts_unused.push(moved); state.modal.dirty = true; ctx.renderModal(); }
      },
    });
    return true;
  }
  if (action === 'pm-del-prompt' && state.modal?.type === 'presetDetail') {
    const listName = actionEl.getAttribute('data-list'), idx = Number(actionEl.getAttribute('data-idx'));
    const p = state.modal.data[listName]?.[idx]; if (!p) return true;
    ctx.openConfirm({
      title: '删除预设条目确认', message: `确定要从当前预设中永久删除条目 #${idx + 1}「${p.name || p.id}」吗？`, confirmText: '确认删除',
      onConfirm: () => { state.modal.data[listName].splice(idx, 1); state.modal.dirty = true; ctx.renderModal(); },
    });
    return true;
  }
  if (action === 'pm-edit-content' && state.modal?.type === 'presetDetail') {
    const listName = actionEl.getAttribute('data-list') || 'prompts', idx = Number(actionEl.getAttribute('data-idx'));
    const p = state.modal.data[listName]?.[idx]; if (!p) return true;
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = { type: 'pmContentEdit', listName, idx, prompt: JSON.parse(JSON.stringify(p)) };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'pm-save-content' && state.previewCtx?.type === 'pmContentEdit' && state.modal?.type === 'presetDetail') {
    pushEditSnapshot(true);
    const snap = readPreviewSnapshot(), target = state.modal.data[state.previewCtx.listName]?.[state.previewCtx.idx];
    if (target && snap) {
      if (snap.name.trim()) target.name = snap.name.trim();
      if (typeof target.content === 'string' || snap.content.length > 0 || !PRESET_SYSTEM_IDS.has(target.id)) target.content = snap.content;
      state.modal.dirty = true;
    }
    state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal(); return true;
  }
  if (action === 'pm-add-prompt' && state.modal?.type === 'presetDetail') {
    const listName = actionEl.getAttribute('data-list') || 'prompts';
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = { type: 'pmPromptEdit', listName, idx: -1, isNew: true, prompt: buildNewPromptEntry({}) };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'pm-edit-prompt' && state.modal?.type === 'presetDetail') {
    const listName = actionEl.getAttribute('data-list') || 'prompts', idx = Number(actionEl.getAttribute('data-idx'));
    const p = state.modal.data[listName]?.[idx]; if (!p) return true;
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = { type: 'pmPromptEdit', listName, idx, isNew: false, prompt: JSON.parse(JSON.stringify(p)) };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'pm-save-prompt' && state.previewCtx?.type === 'pmPromptEdit' && state.modal?.type === 'presetDetail') {
    pushEditSnapshot(true);
    const snap = readPreviewSnapshot(), p = JSON.parse(JSON.stringify(state.previewCtx.prompt));
    p.name = (snap?.name || '').trim() || p.name || '未命名条目';
    p.enabled = !!previewLayerEl.querySelector('#td-pm-p-enabled')?.checked;
    p.role = previewLayerEl.querySelector('#td-pm-p-role')?.value || 'system';
    const posType = previewLayerEl.querySelector('#td-pm-p-postype')?.value || 'relative';
    if (!PRESET_SYSTEM_IDS.has(p.id) || p.position) {
      p.position = posType === 'in_chat'
        ? { type: 'in_chat', depth: Number(previewLayerEl.querySelector('#td-pm-p-depth')?.value) || 0, order: Number(previewLayerEl.querySelector('#td-pm-p-order')?.value) || 100 }
        : { type: 'relative' };
    }
    const contentVal = snap?.content ?? '';
    if (typeof p.content === 'string' || contentVal.length > 0 || !PRESET_SYSTEM_IDS.has(p.id)) p.content = contentVal;
    const targetList = state.modal.data[state.previewCtx.listName];
    if (state.previewCtx.isNew) targetList.push(p); else targetList[state.previewCtx.idx] = p;
    state.modal.dirty = true; state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal(); return true;
  }
  if (action === 'pm-save-detail' && state.modal?.type === 'presetDetail') {
    savePresetDetail(state.modal.presetName, state.modal.data, true).then(() => {
      state.modal.dirty = false; notify('success', `已保存预设「${state.modal.presetName}」`); return refreshAllCatalogs();
    }).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('保存预设详情失败', err); notify('error', `保存失败: ${err.message || err}`); });
    return true;
  }

  if (action === 'pm-open-ai-edit' && state.modal?.type === 'presetDetail') {
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = { type: 'pmAiEdit', step: 'setup', selectedKeys: new Set(), instruction: '', search: '', loading: false, results: [] };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'wbd-open-ai-edit' && state.modal?.type === 'worldbookDetail') {
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = { type: 'wbAiEdit', step: 'setup', selectedKeys: new Set(), instruction: '', search: '', loading: false, results: [] };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'ai-preview-item' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
    e.stopPropagation();
    const k = actionEl.getAttribute('data-key') || '';
    if (state.previewCtx.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
      const [listName, idxStr] = k.split('::');
      const p = state.modal.data[listName]?.[Number(idxStr)];
      if (!p) return true;
      const posLabel = p.position?.type === 'in_chat' ? `@D${p.position.depth ?? 0}` : '相对位置';
      state.selectPopup = {
        type: 'aiItemPreview',
        title: p.name || p.id,
        metas: [
          listName === 'prompts_unused' ? '未添加池' : `主列表 #${Number(idxStr) + 1}`,
          `状态: ${p.enabled ? '开启' : '关闭'}`,
          `身份: ${p.role || 'system'}`,
          posLabel,
        ],
        content: typeof p.content === 'string' ? p.content : '（此条目为内置占位符，无正文内容）',
      };
      renderSelectPopupView();
    } else if (state.previewCtx.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
      const idx = Number(k);
      const entry = state.modal.entries?.[idx];
      if (!entry) return true;
      const keysStr = formatKeysInput(entry.strategy?.keys);
      state.selectPopup = {
        type: 'aiItemPreview',
        title: entry.name || `条目 #${entry.uid}`,
        metas: [
          `#${idx + 1}`,
          `状态: ${entry.enabled ? '开启' : '关闭'}`,
          keysStr ? `关键词: ${keysStr}` : '无关键词',
        ],
        content: entry.content || '',
      };
      renderSelectPopupView();
    }
    return true;
  }
  if (action === 'ai-toggle-api-box' && state.previewCtx) {
    saveSharedAiApiFieldsFromPreview(previewLayerEl);
    syncAiPreviewDraftInputs(previewLayerEl);
    state.previewCtx.apiExpanded = !state.previewCtx.apiExpanded;
    ctx.renderPreviewModal();
    return true;
  }
  if (action === 'ai-toggle-model-manual' && state.previewCtx) {
    saveSharedAiApiFieldsFromPreview(previewLayerEl);
    syncAiPreviewDraftInputs(previewLayerEl);
    state.previewCtx.manualModelInput = false;
    ctx.renderPreviewModal();
    return true;
  }
  if (action === 'ai-fetch-models' && state.previewCtx) {
    if (state.previewCtx.fetchingModels) return true;
    const cfg = saveSharedAiApiFieldsFromPreview(previewLayerEl);
    syncAiPreviewDraftInputs(previewLayerEl);
    const apiKey = normalizeApiTargetValue(cfg.proxyPreset);
    state.previewCtx.fetchingModels = true;
    ctx.renderPreviewModal();
    fetchModelsForApiTarget(apiKey).then(({ models }) => {
      state.previewCtx.fetchingModels = false;
      state._aiModelsCache = state._aiModelsCache || {};
      state._aiModelsCache[apiKey] = models;
      ctx.renderPreviewModal();
      if (models.length > 0) notify('success', `已获取 ${models.length} 个可用模型`);
      else notify('warning', '未拉取到模型列表，可在下拉框末尾选择「手动输入模型名」');
    }).catch((err) => {
      state.previewCtx.fetchingModels = false;
      ctx.renderPreviewModal();
      logWarn('拉取模型列表失败', err);
      notify('warning', `拉取模型失败: ${err.message || err}（可手动输入模型名）`);
    });
    return true;
  }
  if (action === 'ai-toggle-item' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
    const k = actionEl.getAttribute('data-key');
    if (state.previewCtx.selectedKeys.has(k)) state.previewCtx.selectedKeys.delete(k);
    else state.previewCtx.selectedKeys.add(k);
    const labelEl = previewLayerEl.querySelector("[data-role='ai-selected-label']");
    if (labelEl) labelEl.textContent = `3. 勾选待编辑条目 (已选 ${state.previewCtx.selectedKeys.size} 项)`;
    actionEl.closest('.td-picker-row')?.classList.toggle('checked', state.previewCtx.selectedKeys.has(k));
    return true;
  }
  if (action === 'ai-run' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
    const ai = state.previewCtx;
    if (ai.loading) return true;
    const cfg = saveSharedAiApiFieldsFromPreview(previewLayerEl);
    ai.instruction = previewLayerEl.querySelector('#td-ai-instruction')?.value ?? ai.instruction;

    if (ai.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
      const selectedItems = [];
      ['prompts', 'prompts_unused'].forEach((listName) => {
        (state.modal.data[listName] || []).forEach((p, idx) => {
          const uk = `${listName}::${idx}`;
          if (ai.selectedKeys.has(uk)) selectedItems.push({ uidKey: uk, listName, index: idx, prompt: p });
        });
      });
      ai.loading = true;
      setAiRunBtnLoading(previewLayerEl, true);
      runAiPresetEdit({ selectedItems, instruction: ai.instruction, apiCfg: cfg }).then(({ results }) => {
        ai.loading = false; ai.results = results; ai.step = 'review'; ctx.renderPreviewModal();
        notify('success', `AI 编辑完成，返回 ${results.length} 条修改建议`);
      }).catch((err) => {
        ai.loading = false;
        setAiRunBtnLoading(previewLayerEl, false);
        logError('AI 编辑预设失败', err);
        notify('error', err.message || String(err));
      });
      return true;
    }

    if (ai.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
      const selectedItems = [];
      (state.modal.entries || []).forEach((entry, idx) => {
        if (ai.selectedKeys.has(String(idx))) selectedItems.push({ index: idx, entry });
      });
      ai.loading = true;
      setAiRunBtnLoading(previewLayerEl, true);
      runAiWorldbookEdit({ selectedItems, instruction: ai.instruction, apiCfg: cfg }).then(({ results }) => {
        ai.loading = false; ai.results = results; ai.step = 'review'; ctx.renderPreviewModal();
        notify('success', `AI 编辑完成，返回 ${results.length} 条修改建议`);
      }).catch((err) => {
        ai.loading = false;
        setAiRunBtnLoading(previewLayerEl, false);
        logError('AI 编辑世界书失败', err);
        notify('error', err.message || String(err));
      });
      return true;
    }
  }
  if (action === 'ai-toggle-accept' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
    const r = state.previewCtx.results?.[Number(actionEl.getAttribute('data-ridx'))];
    if (r) { r.accepted = !r.accepted; ctx.renderPreviewModal(); }
    return true;
  }
  if (action === 'ai-back-setup' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
    state.previewCtx.step = 'setup'; ctx.renderPreviewModal(); return true;
  }
  if (action === 'ai-apply-results' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) {
    let applied = 0;
    if (state.previewCtx.type === 'pmAiEdit' && state.modal?.type === 'presetDetail') {
      (state.previewCtx.results || []).forEach((r) => {
        if (!r.accepted) return;
        const target = state.modal.data[r.listName]?.[r.index]; if (!target) return;
        target.name = r.newName; target.role = r.newRole; target.enabled = r.newEnabled;
        if (typeof target.content === 'string' || r.newContent.length > 0 || !PRESET_SYSTEM_IDS.has(target.id)) target.content = r.newContent;
        applied++;
      });
      if (applied > 0) state.modal.dirty = true;
      state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal();
      notify('success', `已将 ${applied} 个 AI 修改结果写回预设草稿（请点击「保存预设」持久化）`);
      return true;
    }
    if (state.previewCtx.type === 'wbAiEdit' && state.modal?.type === 'worldbookDetail') {
      (state.previewCtx.results || []).forEach((r) => {
        if (!r.accepted) return;
        const target = state.modal.entries?.[r.index]; if (!target) return;
        target.name = r.newName; target.enabled = r.newEnabled; target.content = r.newContent;
        target.strategy = target.strategy || { type: 'selective', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' };
        target.strategy.keys = parseKeysInput(r.newKeys);
        applied++;
      });
      if (applied > 0) state.modal.dirty = true;
      state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal();
      notify('success', `已将 ${applied} 个 AI 修改结果写回世界书草稿（请点击「保存世界书」持久化）`);
      return true;
    }
  }

  if (action === 'open-worldbook-manager') { state.modal = { type: 'worldbookManager', filter: 'all', query: '', toolsOpen: false }; ctx.renderModal(); return true; }
  if (action === 'wbm-toggle-tools' && state.modal?.type === 'worldbookManager') { state.modal.toolsOpen = !state.modal.toolsOpen; ctx.renderModal(); return true; }
  if (action === 'wbm-set-filter' && state.modal?.type === 'worldbookManager') { state.modal.filter = actionEl.getAttribute('data-filter') || 'all'; ctx.renderModal(); return true; }
  if (action === 'wbm-toggle-global') { toggleGlobalWorldbook(actionEl.getAttribute('data-name')).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('切换全局世界书失败', err); notify('error', err.message || String(err)); }); return true; }
  if (action === 'wbm-toggle-char-pri') { toggleCharPrimaryWorldbook(actionEl.getAttribute('data-name')).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('切换角色卡主世界书失败', err); notify('error', err.message || String(err)); }); return true; }
  if (action === 'wbm-toggle-char-add') { toggleCharAdditionalWorldbook(actionEl.getAttribute('data-name')).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('切换角色卡附加世界书失败', err); notify('error', err.message || String(err)); }); return true; }
  if (action === 'wbm-toggle-chat') {
    const name = actionEl.getAttribute('data-name'), snap = getWorldbookBindingsSnapshot();
    bindChatWorldbookSafe(snap.chatBook === name ? '' : name).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('绑定/解绑聊天世界书失败', err); notify('error', err.message || String(err)); }); return true;
  }
  if (action === 'wbm-create') {
    const name = window.prompt('请输入新建世界书名称：', ''); if (!name || !name.trim()) return true;
    createWorldbookSafe(name.trim()).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('新建世界书失败', err); notify('error', err.message || String(err)); }); return true;
  }
  if (action === 'wbm-create-chat') {
    const name = window.prompt('输入聊天世界书名称（留空自动生成）：', ''); if (name === null) return true;
    createOrBindChatWorldbookSafe(name.trim()).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('新建/绑定聊天世界书失败', err); notify('error', err.message || String(err)); }); return true;
  }
  if (action === 'wbm-duplicate') {
    const src = actionEl.getAttribute('data-name'); const name = window.prompt(`复制世界书「${src}」为：`, `${src}-副本`); if (!name || !name.trim()) return true;
    createWorldbookSafe(name.trim(), src).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('复制世界书失败', err); notify('error', err.message || String(err)); }); return true;
  }
  if (action === 'wbm-rename') {
    const oldName = actionEl.getAttribute('data-name'); const newName = window.prompt(`重命名世界书「${oldName}」为：`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return true;
    renameWorldbookSafe(oldName, newName.trim()).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('重命名世界书失败', err); notify('error', err.message || String(err)); }); return true;
  }
  if (action === 'wbm-export') { exportWorldbookFile(actionEl.getAttribute('data-name')).catch((err) => { logError('导出世界书失败', err); notify('error', err.message || String(err)); }); return true; }
  if (action === 'wbm-trigger-import') { modalLayerEl.querySelector('#td-wbm-import-file')?.click(); return true; }
  if (action === 'wbm-delete') {
    const name = actionEl.getAttribute('data-name');
    ctx.openConfirm({
      title: '删除世界书确认', message: `确定要永久删除世界书「${name}」吗？`, confirmText: '确认删除',
      onConfirm: () => deleteWorldbookSafe(name).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('删除世界书失败', err); notify('error', err.message || String(err)); }),
    });
    return true;
  }
  if (action === 'wbm-open-detail') {
    const name = actionEl.getAttribute('data-name');
    callTH('getWorldbook', name).then((entries) => {
      state.modal = { type: 'worldbookDetail', bookName: name, entries: (entries || []).map(cloneWorldbookEntry), query: '', dirty: false, toolsOpen: false, batchMode: false, selectedIdx: new Set() };
      ctx.renderModal();
    }).catch((err) => { logError(`读取世界书「${name}」失败`, err); notify('error', err.message || String(err)); });
    return true;
  }
  if (action === 'wbd-toggle-tools' && state.modal?.type === 'worldbookDetail') { state.modal.toolsOpen = !state.modal.toolsOpen; ctx.renderModal(); return true; }
  if (action === 'wbd-jump-idx' && state.modal?.type === 'worldbookDetail') {
    const list = state.modal.entries || [];
    const num = Number(modalLayerEl.querySelector('#td-wbd-jump-idx')?.value);
    if (Number.isNaN(num) || num < 1 || num > list.length) {
      notify('warning', `请输入 1 ~ ${list.length} 之间的有效序号`);
      return true;
    }
    const targetIdx = Math.floor(num) - 1;
    const scrollToRow = () => {
      const box = modalLayerEl.querySelector('.td-picker-list');
      const row = box?.querySelector(`.td-mgr-row[data-idx='${targetIdx}']`);
      if (!box || !row) return;
      const boxRect = box.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      box.scrollTo({ top: box.scrollTop + (rowRect.top - boxRect.top) - 8, behavior: 'smooth' });
      row.style.transition = 'box-shadow 0.25s ease';
      row.style.boxShadow = '0 0 0 2px var(--td-accent)';
      setTimeout(() => { if (row.isConnected) row.style.boxShadow = ''; }, 1600);
    };
    if (!modalLayerEl.querySelector(`.td-mgr-row[data-idx='${targetIdx}']`) && (state.modal.query || '').trim()) {
      state.modal.query = '';
      ctx.renderModal();
      requestAnimationFrame(scrollToRow);
    } else {
      scrollToRow();
    }
    return true;
  }
  if (action === 'wbd-toggle-batch' && state.modal?.type === 'worldbookDetail') {
    state.modal.batchMode = !state.modal.batchMode; state.modal.selectedIdx = new Set(); ctx.renderModal(); return true;
  }
  if (action === 'wbd-batch-check' && state.modal?.type === 'worldbookDetail') {
    const idx = Number(actionEl.getAttribute('data-idx'));
    if (state.modal.selectedIdx.has(idx)) state.modal.selectedIdx.delete(idx);
    else state.modal.selectedIdx.add(idx);
    actionEl.closest('.td-mgr-row')?.classList.toggle('is-active', state.modal.selectedIdx.has(idx));
    const batchBtn = modalLayerEl.querySelector("[data-action='wbd-toggle-batch']");
    if (batchBtn) batchBtn.textContent = `退出批量 (已选 ${state.modal.selectedIdx.size})`;
    return true;
  }
  if (action === 'wbd-batch-move' && state.modal?.type === 'worldbookDetail') {
    const indices = Array.from(state.modal.selectedIdx || []);
    if (indices.length === 0) { notify('warning', '请先勾选要移动的条目'); return true; }
    state.selectPopup = { type: 'moveWbTarget', fromIndices: indices };
    renderSelectPopupView(); return true;
  }
  if (action === 'wbd-move-before' && state.modal?.type === 'worldbookDetail') {
    state.selectPopup = { type: 'moveWbTarget', fromIndices: [Number(actionEl.getAttribute('data-idx'))] };
    renderSelectPopupView(); return true;
  }
  if (action === 'wbd-back-list' && state.modal?.type === 'worldbookDetail') {
    confirmDiscardDirtyModal(() => {
      state.modal = { type: 'worldbookManager', filter: 'all', query: '', toolsOpen: false };
      ctx.renderModal();
    });
    return true;
  }
  if (action === 'wbd-toggle-entry' && state.modal?.type === 'worldbookDetail') {
    const idx = Number(actionEl.getAttribute('data-idx'));
    if (state.modal.entries[idx]) {
      state.modal.entries[idx].enabled = !state.modal.entries[idx].enabled;
      state.modal.dirty = true;
      actionEl.classList.toggle('on', !!state.modal.entries[idx].enabled);
      const dirtyEl = modalLayerEl.querySelector("[data-role='wbd-dirty-label']");
      if (dirtyEl) dirtyEl.textContent = '有未保存修改';
    }
    return true;
  }
  if (action === 'wbd-batch-enable' && state.modal?.type === 'worldbookDetail') {
    const val = actionEl.getAttribute('data-val') === '1', q = (state.modal.query || '').trim().toLowerCase();
    state.modal.entries.forEach((entry) => {
      if (!q || (entry.name || '').toLowerCase().includes(q) || (entry.content || '').toLowerCase().includes(q) || formatKeysInput(entry.strategy?.keys).toLowerCase().includes(q)) entry.enabled = val;
    });
    state.modal.dirty = true; ctx.renderModal(); return true;
  }
  if (action === 'wbd-disable-recursion' && state.modal?.type === 'worldbookDetail') {
    const changed = disableAllRecursionInEntries(state.modal.entries);
    if (changed > 0) state.modal.dirty = true;
    ctx.renderModal();
    notify('success', changed > 0 ? `已将 ${changed} 个条目的递归全部禁止（请点击「保存世界书」生效）` : '所有条目已处于禁止递归状态');
    return true;
  }
  if (action === 'wbd-dup-entry' && state.modal?.type === 'worldbookDetail') {
    const idx = Number(actionEl.getAttribute('data-idx')), src = state.modal.entries[idx];
    if (src) {
      const copy = cloneWorldbookEntry(src);
      copy.uid = state.modal.entries.reduce((mx, x) => Math.max(mx, Number(x.uid) || 0), 0) + 1;
      copy.name = `${copy.name || '条目'} (副本)`;
      state.modal.entries.splice(idx + 1, 0, copy); state.modal.dirty = true;
      if (state.modal.selectedIdx instanceof Set) state.modal.selectedIdx.clear();
      ctx.renderModal();
    }
    return true;
  }
  if (action === 'wbd-del-entry' && state.modal?.type === 'worldbookDetail') {
    const idx = Number(actionEl.getAttribute('data-idx')), entry = state.modal.entries[idx]; if (!entry) return true;
    ctx.openConfirm({
      title: '删除世界书条目确认', message: `确定要删除条目「${entry.name || `#${entry.uid}`}」吗？`, confirmText: '确认删除',
      onConfirm: () => {
        state.modal.entries.splice(idx, 1); state.modal.dirty = true;
        if (state.modal.selectedIdx instanceof Set) state.modal.selectedIdx.clear();
        ctx.renderModal();
      },
    });
    return true;
  }
  if (action === 'wbd-edit-content' && state.modal?.type === 'worldbookDetail') {
    const idx = Number(actionEl.getAttribute('data-idx')), eObj = state.modal.entries[idx]; if (!eObj) return true;
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = { type: 'wbContentEdit', idx, entry: cloneWorldbookEntry(eObj) };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'wb-save-content' && state.previewCtx?.type === 'wbContentEdit' && state.modal?.type === 'worldbookDetail') {
    pushEditSnapshot(true);
    const snap = readPreviewSnapshot(), target = state.modal.entries[state.previewCtx.idx];
    if (target && snap) { if (snap.name.trim()) target.name = snap.name.trim(); target.content = snap.content; state.modal.dirty = true; }
    state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal(); return true;
  }
  if (action === 'wbd-add-entry' && state.modal?.type === 'worldbookDetail') {
    const nextUid = state.modal.entries.reduce((mx, x) => Math.max(mx, Number(x.uid) || 0), 0) + 1;
    const entry = buildDefaultWorldbookEntry({}); entry.uid = nextUid;
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = { type: 'wbEntryEdit', idx: -1, isNew: true, entry };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'wbd-edit-entry' && state.modal?.type === 'worldbookDetail') {
    const idx = Number(actionEl.getAttribute('data-idx')), eObj = state.modal.entries[idx]; if (!eObj) return true;
    state.previewKey = null; state.snapshotDetailId = null;
    state.previewCtx = { type: 'wbEntryEdit', idx, isNew: false, entry: cloneWorldbookEntry(eObj) };
    ctx.renderPreviewModal(); return true;
  }
  if (action === 'wb-save-entry' && state.previewCtx?.type === 'wbEntryEdit' && state.modal?.type === 'worldbookDetail') {
    pushEditSnapshot(true);
    const snap = readPreviewSnapshot(), eObj = cloneWorldbookEntry(state.previewCtx.entry);
    eObj.name = (snap?.name || '').trim() || '未命名条目';
    eObj.enabled = !!previewLayerEl.querySelector('#td-wbe-enabled')?.checked;
    eObj.strategy = {
      type: previewLayerEl.querySelector('#td-wbe-stype')?.value || 'selective',
      keys: parseKeysInput(previewLayerEl.querySelector('#td-wbe-keys')?.value || ''),
      keys_secondary: { logic: previewLayerEl.querySelector('#td-wbe-seclogic')?.value || 'and_any', keys: parseKeysInput(previewLayerEl.querySelector('#td-wbe-seckeys')?.value || '') },
      scan_depth: (() => { const raw = (previewLayerEl.querySelector('#td-wbe-scandepth')?.value || '').trim(); return raw === '' ? 'same_as_global' : (Number(raw) || 0); })(),
    };
    eObj.position = {
      type: previewLayerEl.querySelector('#td-wbe-postype')?.value || 'after_character_definition',
      role: previewLayerEl.querySelector('#td-wbe-role')?.value || 'system',
      depth: Number(previewLayerEl.querySelector('#td-wbe-depth')?.value) || 4,
      order: Number(previewLayerEl.querySelector('#td-wbe-order')?.value) || 100,
    };
    eObj.probability = Number(previewLayerEl.querySelector('#td-wbe-prob')?.value ?? 100);
    const numOrNull = (sel) => { const v = (previewLayerEl.querySelector(sel)?.value || '').trim(); return v === '' ? null : Number(v); };
    eObj.effect = { sticky: numOrNull('#td-wbe-sticky'), cooldown: numOrNull('#td-wbe-cooldown'), delay: numOrNull('#td-wbe-delay') };
    eObj.recursion = Object.assign({}, eObj.recursion || { delay_until: null }, {
      prevent_incoming: !!previewLayerEl.querySelector('#td-wbe-previn')?.checked,
      prevent_outgoing: !!previewLayerEl.querySelector('#td-wbe-prevout')?.checked,
    });
    eObj.content = snap?.content ?? '';
    if (state.previewCtx.isNew) state.modal.entries.push(eObj); else state.modal.entries[state.previewCtx.idx] = eObj;
    state.modal.dirty = true; state.previewCtx = null; ctx.renderPreviewModal(); ctx.renderModal(); return true;
  }
  if (action === 'wbd-save-book' && state.modal?.type === 'worldbookDetail') {
    callTH('replaceWorldbook', state.modal.bookName, state.modal.entries, { render: 'debounced' }).then(() => {
      state.modal.dirty = false; notify('success', `已保存世界书「${state.modal.bookName}」`); return refreshWorldbookCatalog(false);
    }).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('保存世界书失败', err); notify('error', `保存世界书失败: ${err.message || err}`); });
    return true;
  }

  return false;
}

export function handleManagerInput(e) {
  const id = e.target?.id || '';
  if (id === 'td-crop-zoom' && state.previewCtx?.type === 'orbCrop') {
    const z = Math.max(50, Math.min(300, Number(e.target.value) || 100));
    state.previewCtx.zoom = z / 100;
    const lbl = ctx.getPreviewLayer()?.querySelector("[data-role='crop-zoom-label']");
    if (lbl) lbl.textContent = `缩放倍数 (${z}%)`;
    drawOrbCropCanvas();
    return true;
  }
  if (id === 'td-sp-color-native') { const txt = ctx.getSelectLayer()?.querySelector('#td-sp-color-input'); if (txt) txt.value = e.target.value; return true; }
  if (id === 'td-sp-color-input') { const nat = ctx.getSelectLayer()?.querySelector('#td-sp-color-native'); if (nat && /^#[0-9a-fA-F]{6}$/.test(e.target.value.trim())) nat.value = e.target.value.trim(); return true; }
  if (id === 'td-wb-merge-search' && state.modal?.type === 'wbMerge') { state.modal.session.query = e.target.value; updateWbMergeBody(); return true; }
  if (id === 'td-pm-search' && state.modal?.type === 'presetManager') { state.modal.query = e.target.value; ctx.renderModal(); return true; }
  if (id === 'td-pm-detail-search' && state.modal?.type === 'presetDetail') { state.modal.query = e.target.value; ctx.renderModal(); return true; }
  if (id === 'td-pm-jump-idx' && state.modal?.type === 'presetDetail') { state.modal.jumpVal = e.target.value; return true; }
  if (id === 'td-wbm-search' && state.modal?.type === 'worldbookManager') { state.modal.query = e.target.value; ctx.renderModal(); return true; }
  if (id === 'td-wbd-search' && state.modal?.type === 'worldbookDetail') { state.modal.query = e.target.value; ctx.renderModal(); return true; }
  if (id === 'td-mvu-search' && state.modal?.type === 'mvuViewer') { state.modal.query = e.target.value; ctx.renderModal(); return true; }
  if (id === 'td-wbd-jump-idx' && state.modal?.type === 'worldbookDetail') { state.modal.jumpVal = e.target.value; return true; }
  if (id === 'td-ai-instruction' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) { state.previewCtx.instruction = e.target.value; return true; }
  if (id === 'td-mvu-ai-instruction' && state.previewCtx?.type === 'mvuAiUpdate') { state.previewCtx.instruction = e.target.value; return true; }
  if (id === 'td-ai-model' && state.previewCtx) {
    state.store.settings.aiEditConfig.model = e.target.value;
    saveStore(state.store);
    return true;
  }
  if (id === 'td-mvu-rule-search' && state.previewCtx?.type === 'mvuAiUpdate') { state.previewCtx.ruleSearch = e.target.value; ctx.renderPreviewModal(); return true; }
  if (id === 'td-ai-search' && (state.previewCtx?.type === 'pmAiEdit' || state.previewCtx?.type === 'wbAiEdit')) { state.previewCtx.search = e.target.value; ctx.renderPreviewModal(); return true; }
  return false;
}

export function handleManagerChange(e) {
  const target = e.target;
  if (!target) return false;
  const id = target.id || '';

  if (id === 'td-mvu-floor-input' && state.modal?.type === 'mvuViewer') {
    const v = Number(target.value);
    if (!Number.isNaN(v)) { state.modal.floor = Math.max(0, Math.floor(v)); ctx.renderModal(); }
    return true;
  }
  if (id === 'td-ai-proxy-preset' || id === 'td-ai-jailbreak-preset') {
    saveSharedAiApiFieldsFromPreview(ctx.getPreviewLayer());
    syncAiPreviewDraftInputs(ctx.getPreviewLayer());
    if (id === 'td-ai-proxy-preset' && state.previewCtx) {
      state.previewCtx.manualModelInput = false;
      ctx.renderPreviewModal();
    }
    return true;
  }
  if (id === 'td-ai-model-select' && state.previewCtx) {
    if (target.value === '__manual__') {
      syncAiPreviewDraftInputs(ctx.getPreviewLayer());
      state.previewCtx.manualModelInput = true;
      ctx.renderPreviewModal();
    } else {
      state.store.settings.aiEditConfig.model = target.value;
      saveStore(state.store);
    }
    return true;
  }
  if (id === 'td-mvu-val-type' && state.previewCtx?.type === 'mvuValEdit') {
    const curVal = ctx.getPreviewLayer()?.querySelector('#td-mvu-val-input')?.value;
    if (curVal !== undefined) state.previewCtx.draftText = curVal;
    state.previewCtx.valType = target.value;
    if (target.value === 'boolean' && state.previewCtx.draftText !== 'true') state.previewCtx.draftText = 'false';
    ctx.renderPreviewModal();
    return true;
  }

  if (id === 'td-wb-merge-old-select' && state.modal?.type === 'wbMergeSelect') { state.modal.oldName = target.value; return true; }
  if (id === 'td-wb-merge-new-select' && state.modal?.type === 'wbMergeSelect') {
    state.modal.newName = target.value;
    const books = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
    const matched = findBestMatchingName(target.value, books);
    if (matched) { state.modal.oldName = matched; const oldSel = ctx.getModalLayer()?.querySelector('#td-wb-merge-old-select'); if (oldSel) oldSel.value = matched; }
    return true;
  }

  if (target.hasAttribute('data-pm-setting') && state.modal?.type === 'presetDetail') {
    const key = target.getAttribute('data-pm-setting'), ftype = target.getAttribute('data-ftype');
    if (ftype === 'bool') state.modal.data.settings[key] = !!target.checked;
    else if (ftype === 'number') state.modal.data.settings[key] = Number(target.value);
    else state.modal.data.settings[key] = target.value;
    state.modal.dirty = true;
    const dirtyEl = ctx.getModalLayer()?.querySelector("[data-role='pm-dirty-label']");
    if (dirtyEl) dirtyEl.textContent = '有未保存修改';
    return true;
  }

  if (id === 'td-pm-import-file') {
    const file = target.files?.[0]; if (!file) return true;
    importPresetFromFile(file).then(() => refreshAllCatalogs()).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('导入预设文件失败', err); notify('error', err.message || String(err)); });
    return true;
  }
  if (id === 'td-wbm-import-file') {
    const file = target.files?.[0]; if (!file) return true;
    importWorldbookFromFile(file).then(() => refreshWorldbookCatalog(false)).then(() => { ctx.renderMain(); ctx.renderModal(); }).catch((err) => { logError('导入世界书文件失败', err); notify('error', err.message || String(err)); });
    return true;
  }
  return false;
}
