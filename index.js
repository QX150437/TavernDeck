import { APP_NAME, getST, hasTH } from './src/utils.js';
import { state, loadStore } from './src/store.js';
import { refreshAllCatalogs } from './src/catalog.js';
import { updatePickerList, updateSnapshotList, syncPreviewStatusUi } from './src/ui-views.js';
import {
  mountUI, renderOrb, renderMain, syncExtensionButton, mountExtensionSettingsPanel,
} from './src/ui-app.js';

let booted = false;

async function syncAndRefresh() {
  if (!hasTH('getPreset')) return;
  try {
    state.store = loadStore();
    await refreshAllCatalogs();
    renderOrb();
    syncExtensionButton();
    if (state.panelOpen) {
      renderMain();
      if (state.previewKey) syncPreviewStatusUi();
      if (state.modal?.type === 'picker') updatePickerList();
      if (state.modal?.type === 'snapshots') updateSnapshotList();
    }
  } catch (e) {
    console.warn(`[${APP_NAME}] 同步数据失败:`, e);
  }
}

function bindTavernEvents() {
  const st = getST();
  const es = st?.eventSource;
  const et = st?.eventTypes;
  if (!es || !et) return;

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
    et.PRESET_CHANGED,
    et.OAI_PRESET_CHANGED_AFTER,
    et.PRESET_RENAMED,
    et.WORLDINFO_UPDATED,
    et.WORLDINFO_SETTINGS_UPDATED,
    et.CHARACTER_PAGE_LOADED,
    et.CHAT_CHANGED,
  ].filter(Boolean).forEach((evt) => es.on(evt, debouncedSync));
}

function waitForTavernHelperAndSync(retries = 25) {
  if (hasTH('getVariables') && hasTH('getPreset')) {
    syncAndRefresh();
    return;
  }
  if (retries > 0) {
    setTimeout(() => waitForTavernHelperAndSync(retries - 1), 300);
  }
}

function bootstrap() {
  if (booted) return;
  booted = true;
  state.store = loadStore();
  mountUI();
  renderOrb();
  syncExtensionButton();
  mountExtensionSettingsPanel();
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
