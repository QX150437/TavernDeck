import { APP_NAME, getST, hasTH, logInfo, logWarn, syncNotifyRuntimeConfig } from './src/utils.js';
import { state, loadStore, enqueueBackendLogPersist, flushBackendLogQueue } from './src/store.js';
import { refreshAllCatalogs } from './src/catalog.js';
import {
  syncNativePresetCollapse, syncNativeToastHook, scheduleChatScrollToBottom,
  onTavernChatChanged, onTavernGenerationStarted, onTavernMessageReceived,
  onTavernCharacterMessageRendered, onTavernGenerationEnded,
} from './src/native-ui.js';
import { initDevErrorCapture, setDevLogPersistHandler, recordOpStep } from './src/dev-tools.js';
import { updatePickerList, updateSnapshotList, syncPreviewStatusUi, renderModal } from './src/ui-views.js';
import {
  mountUI, renderOrb, renderMain, syncExtensionButton, syncTopBarUI, mountExtensionSettingsPanel,
} from './src/ui-app.js';

let booted = false;
let initialSynced = false;

async function syncAndRefresh() {
  syncNotifyRuntimeConfig(state.store?.settings);
  syncNativeToastHook();
  syncNativePresetCollapse();
  syncTopBarUI();
  if (!hasTH('getPreset')) return;
  recordOpStep('酒馆状态同步', initialSynced ? '事件防抖刷新' : '首次启动同步');
  try {
    state.store = loadStore();
    flushBackendLogQueue();
    await refreshAllCatalogs();
    if (!initialSynced) {
      initialSynced = true;
      logInfo(`已连接 TavernHelper 并完成首次同步（当前预设：${state.presetName || '未知'}）`);
      const st = getST();
      if (st?.getCurrentChatId?.() || st?.chatId) {
        scheduleChatScrollToBottom();
      }
    }
    renderOrb();
    syncExtensionButton();
    syncTopBarUI();
    syncNativePresetCollapse();
    if (state.panelOpen) {
      renderMain();
      if (state.previewKey) syncPreviewStatusUi();
      if (state.modal?.type === 'picker') updatePickerList();
      if (state.modal?.type === 'snapshots') updateSnapshotList();
      if (state.modal?.type === 'mvuViewer') renderModal();
    }
  } catch (e) {
    logWarn('同步数据失败', e);
  }
}

function bindTavernEvents() {
  const st = getST();
  const es = st?.eventSource;
  const et = st?.eventTypes;
  if (!es || !et) {
    logWarn('未检测到 SillyTavern.eventSource，跳过酒馆事件绑定');
    return;
  }

  const debouncedSync = (() => {
    let t = null;
    return () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { syncAndRefresh(); }, 120);
    };
  })();

  [
    et.APP_READY,
    et.EXTENSIONS_FIRST_LOAD,
    et.SETTINGS_LOADED,
    et.PRESET_CHANGED,
    et.OAI_PRESET_CHANGED_AFTER,
    et.PRESET_RENAMED,
    et.WORLDINFO_UPDATED,
    et.WORLDINFO_SETTINGS_UPDATED,
    et.CHARACTER_PAGE_LOADED,
    et.CHAT_CHANGED,
  ].filter(Boolean).forEach((evt) => es.on(evt, debouncedSync));

  if (et.CHAT_CHANGED) es.on(et.CHAT_CHANGED, () => onTavernChatChanged());
  if (et.GENERATION_STARTED) es.on(et.GENERATION_STARTED, () => onTavernGenerationStarted());
  if (et.MESSAGE_RECEIVED) es.on(et.MESSAGE_RECEIVED, (msgId, type) => onTavernMessageReceived(msgId, type));
  if (et.CHARACTER_MESSAGE_RENDERED) {
    es.on(et.CHARACTER_MESSAGE_RENDERED, (msgId) => onTavernCharacterMessageRendered(msgId));
  }
  if (et.GENERATION_ENDED) es.on(et.GENERATION_ENDED, (msgId) => onTavernGenerationEnded(msgId));

  const debouncedMvuRefresh = (() => {
    let t = null;
    return () => {
      if (!state.panelOpen || state.modal?.type !== 'mvuViewer') return;
      recordOpStep('MVU 楼层变量自动刷新');
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        if (state.panelOpen && state.modal?.type === 'mvuViewer') renderModal();
      }, 150);
    };
  })();

  [
    et.MESSAGE_RECEIVED,
    et.MESSAGE_SWIPED,
    et.MESSAGE_UPDATED,
    et.MESSAGE_DELETED,
    'mag_variable_update_ended',
  ].filter(Boolean).forEach((evt) => es.on(evt, debouncedMvuRefresh));
}

function waitForTavernHelperAndSync(retries = 25) {
  if (hasTH('getVariables') && hasTH('getPreset')) {
    syncAndRefresh();
    return;
  }
  if (retries > 0) {
    setTimeout(() => waitForTavernHelperAndSync(retries - 1), 300);
  } else {
    logWarn(`${APP_NAME} 等待酒馆助手 (TavernHelper) 初始化超时`);
  }
}

function bootstrap() {
  if (booted) return;
  booted = true;
  initDevErrorCapture();
  setDevLogPersistHandler(enqueueBackendLogPersist);
  state.store = loadStore();
  syncNotifyRuntimeConfig(state.store.settings);
  mountUI();
  syncNativeToastHook();
  renderOrb();
  syncExtensionButton();
  syncTopBarUI();
  mountExtensionSettingsPanel();
  syncNativePresetCollapse();
  bindTavernEvents();
  waitForTavernHelperAndSync();
}

if (typeof jQuery !== 'undefined') {
  jQuery(() => bootstrap());
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
