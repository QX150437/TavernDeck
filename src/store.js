import {
  STORAGE_KEY, SCHEMA_VERSION,
  getST, hasTH, callTH, notify, genId, makeItemKey, cloneItemRef, logWarn, logError,
} from './utils.js';
import { pushDevLog, getDevLogsStorageInfo } from './dev-tools.js';

const MERGE_DRAFTS_STORAGE_KEY = 'TavernDeck_mergeDrafts_v1';
const SNAPSHOT_PAYLOADS_STORAGE_KEY = 'TavernDeck_snapshotPayloads_v1';

export function serializeRegExpDeep(val) {
  if (val instanceof RegExp) return { __td_re: [val.source, val.flags] };
  if (Array.isArray(val)) return val.map(serializeRegExpDeep);
  if (val && typeof val === 'object') {
    const out = {};
    Object.keys(val).forEach((k) => { out[k] = serializeRegExpDeep(val[k]); });
    return out;
  }
  return val;
}

export function reviveRegExpDeep(val) {
  if (Array.isArray(val)) return val.map(reviveRegExpDeep);
  if (val && typeof val === 'object') {
    if (Array.isArray(val.__td_re) && val.__td_re.length === 2) {
      try { return new RegExp(val.__td_re[0], val.__td_re[1]); } catch (e) { return String(val.__td_re[0] || ''); }
    }
    const out = {};
    Object.keys(val).forEach((k) => { out[k] = reviveRegExpDeep(val[k]); });
    return out;
  }
  return val;
}

function stringifyWithRegExp(obj) {
  return JSON.stringify(serializeRegExpDeep(obj));
}

function parseWithRegExp(str) {
  return reviveRegExpDeep(JSON.parse(str));
}

let snapshotPayloadCache = null;

function readAllSnapshotPayloads() {
  if (snapshotPayloadCache) return snapshotPayloadCache;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SNAPSHOT_PAYLOADS_STORAGE_KEY) : null;
    if (!raw) {
      snapshotPayloadCache = {};
      return snapshotPayloadCache;
    }
    const parsed = parseWithRegExp(raw);
    snapshotPayloadCache = parsed && typeof parsed === 'object' ? parsed : {};
    return snapshotPayloadCache;
  } catch (e) {
    logWarn('读取本地快照载荷失败', e);
    snapshotPayloadCache = {};
    return snapshotPayloadCache;
  }
}

function utf8ToBase64(str) {
  const s = String(str || '');
  if (typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(bin);
  }
  return btoa(unescape(encodeURIComponent(s)));
}

function normalizeBackendFileName(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const parts = s.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

function getBackendFileCandidates(raw) {
  const s = String(raw || '').trim();
  const base = normalizeBackendFileName(s);
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  push(base);
  if (base) {
    push(`/user/files/${base}`);
    push(`user/files/${base}`);
  }
  push(s);
  return out;
}

function writeAllSnapshotPayloads(map) {
  snapshotPayloadCache = map || {};
  try {
    if (typeof localStorage === 'undefined') return true;
    const keys = Object.keys(snapshotPayloadCache);
    if (keys.length === 0) {
      localStorage.removeItem(SNAPSHOT_PAYLOADS_STORAGE_KEY);
    } else {
      localStorage.setItem(SNAPSHOT_PAYLOADS_STORAGE_KEY, stringifyWithRegExp(snapshotPayloadCache));
    }
    return true;
  } catch (e) {
    logWarn('写入本地快照载荷失败（可能超出浏览器存储配额）', e);
    notify('warning', '本地浏览器存储空间不足');
    return false;
  }
}

export function setSnapshotPayloadLocal(snapId, payload) {
  if (!snapId || !payload) return 0;
  const map = readAllSnapshotPayloads();
  const serialized = serializeRegExpDeep(payload);
  map[snapId] = reviveRegExpDeep(serialized);
  const bytes = getUtf8ByteLength(JSON.stringify(serialized));
  writeAllSnapshotPayloads(map);
  return bytes;
}

export function hasSnapshotPayload(snap) {
  if (!snap) return false;
  if (snap.payloadFile) return true;
  const map = readAllSnapshotPayloads();
  return !!map[snap.id];
}

export async function getSnapshotPayload(snapOrId) {
  if (!snapOrId) return null;
  const snap = typeof snapOrId === 'string'
    ? (state.store.snapshots || []).find((s) => s.id === snapOrId)
    : snapOrId;
  const snapId = typeof snapOrId === 'string' ? snapOrId : snapOrId.id;

  if (snap?.payloadFile) {
    const base = normalizeBackendFileName(snap.payloadFile);
    if (hasTH('getTavernFile')) {
      for (const cand of [base, snap.payloadFile].filter((v, i, a) => v && a.indexOf(v) === i)) {
        try {
          const res = await callTH('getTavernFile', cand);
          if (res && res.ok) {
            const text = await res.text();
            if (text) return parseWithRegExp(text);
          }
        } catch (e) {}
      }
    }
    if (base && typeof fetch === 'function') {
      for (const url of [`/user/files/${encodeURIComponent(base)}`, `user/files/${encodeURIComponent(base)}`]) {
        try {
          const res = await fetch(url);
          if (res && res.ok) {
            const text = await res.text();
            if (text) return parseWithRegExp(text);
          }
        } catch (e) {}
      }
    }
  }

  if (snapId) {
    const map = readAllSnapshotPayloads();
    if (map[snapId]) return map[snapId];
  }
  return null;
}

export async function setSnapshotPayload(snapId, payload, opts = {}) {
  if (!snapId || !payload) return { fileName: '', bytes: 0, storage: 'none' };
  const serialized = serializeRegExpDeep(payload);
  const jsonStr = JSON.stringify(serialized);
  const bytes = getUtf8ByteLength(jsonStr);

  if (hasTH('uploadTavernFile')) {
    const desiredName = opts.prevFileName
      ? `taverndeck_snap_${snapId}_${Date.now().toString(36)}.json`
      : `taverndeck_snap_${snapId}.json`;
    const actualName = await callTH('uploadTavernFile', desiredName, utf8ToBase64(jsonStr));
    const fileName = normalizeBackendFileName(actualName) || desiredName;
    const prevNorm = normalizeBackendFileName(opts.prevFileName);
    if (prevNorm && prevNorm !== fileName && hasTH('deleteTavernFile')) {
      for (const cand of getBackendFileCandidates(opts.prevFileName)) {
        try {
          await callTH('deleteTavernFile', cand);
          break;
        } catch (e) {
          logWarn(`清理旧快照文件「${cand}」失败`, e);
        }
      }
    }
    const localMap = readAllSnapshotPayloads();
    if (Object.prototype.hasOwnProperty.call(localMap, snapId)) {
      delete localMap[snapId];
      writeAllSnapshotPayloads(localMap);
    }
    return { fileName, bytes, storage: 'file' };
  }

  setSnapshotPayloadLocal(snapId, payload);
  return { fileName: '', bytes, storage: 'local' };
}

async function deleteBackendFileByName(rawFileName, opts = {}) {
  const fileName = String(rawFileName || '').trim();
  if (!fileName) return;
  const base = normalizeBackendFileName(fileName);
  const thCands = [base, fileName].filter((v, i, a) => v && a.indexOf(v) === i);
  let deletedOk = false;
  let lastErr = null;

  if (hasTH('deleteTavernFile')) {
    for (const cand of thCands) {
      try {
        await callTH('deleteTavernFile', cand);
        deletedOk = true;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
  }

  if (!deletedOk && typeof fetch === 'function') {
    const st = getST();
    const headers = st && typeof st.getRequestHeaders === 'function'
      ? st.getRequestHeaders()
      : { 'Content-Type': 'application/json' };
    const apiCands = [
      base,
      base ? `user/files/${base}` : '',
      base ? `/user/files/${base}` : '',
      base ? `files/${base}` : '',
      base ? `/files/${base}` : '',
      fileName,
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    for (const p of apiCands) {
      try {
        const res = await fetch('/api/files/delete', {
          method: 'POST',
          headers,
          body: JSON.stringify({ path: p }),
        });
        if (res.ok || res.status === 404) {
          deletedOk = true;
          break;
        }
        const errText = await res.text().catch(() => '');
        lastErr = new Error(errText || `HTTP ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
    }
  }

  if (!deletedOk && lastErr) {
    if (!opts.silent) logWarn(`删除酒馆后端文件「${fileName}」失败`, lastErr);
    if (opts.strict) throw lastErr;
  }
}

export async function deleteSnapshotPayload(snapOrId, opts = {}) {
  const snap = typeof snapOrId === 'string'
    ? (state.store.snapshots || []).find((s) => s.id === snapOrId)
    : snapOrId;
  const snapId = typeof snapOrId === 'string' ? snapOrId : snapOrId?.id;

  if (snap?.payloadFile) {
    await deleteBackendFileByName(snap.payloadFile, opts);
    delete snap.payloadFile;
  }

  if (snapId) {
    const map = readAllSnapshotPayloads();
    if (Object.prototype.hasOwnProperty.call(map, snapId)) {
      delete map[snapId];
      writeAllSnapshotPayloads(map);
    }
  }
}

export function getSnapshotPayloadSizeBytes(snap) {
  if (!snap) return 0;
  if (typeof snap.payloadBytes === 'number' && snap.payloadBytes > 0) return snap.payloadBytes;
  if (snap.payloadFile) return 0;
  const map = readAllSnapshotPayloads();
  const p = map[snap.id];
  if (!p) return 0;
  try {
    const bytes = getUtf8ByteLength(stringifyWithRegExp(p));
    snap.payloadBytes = bytes;
    return bytes;
  } catch (e) {
    return 0;
  }
}

export function loadMergeDrafts() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MERGE_DRAFTS_STORAGE_KEY) : null;
    if (!raw) return { preset: null, worldbook: null };
    const parsed = parseWithRegExp(raw);
    return {
      preset: parsed && parsed.preset ? parsed.preset : null,
      worldbook: parsed && parsed.worldbook ? parsed.worldbook : null,
    };
  } catch (e) {
    logWarn('读取本地缝合草稿失败', e);
    return { preset: null, worldbook: null };
  }
}

function isOnlyEnabledDiff(baseObj, customObj) {
  if (!baseObj || !customObj) return false;
  const copy = Object.assign({}, baseObj, { enabled: !!customObj.enabled });
  return JSON.stringify(copy) === JSON.stringify(customObj);
}

function isSameExceptIdAndEnabled(origObj, curObj, idKey, isPreset) {
  if (!origObj || !curObj) return null;
  const normA = isPreset ? JSON.parse(JSON.stringify(origObj)) : serializeRegExpDeep(origObj);
  const normB = isPreset ? JSON.parse(JSON.stringify(curObj)) : serializeRegExpDeep(curObj);
  const idChanged = normA[idKey] !== normB[idKey];
  const enChanged = !!normA.enabled !== !!normB.enabled;
  normA[idKey] = normB[idKey];
  normA.enabled = normB.enabled;
  if (JSON.stringify(normA) !== JSON.stringify(normB)) return null;
  return { idChanged, enChanged };
}

export function compactMergeDraft(kind, session) {
  if (!session || typeof session !== 'object') return null;
  if (session.v === 2 || (session.v === 3 && Array.isArray(session.sourceList) && Array.isArray(session.baseList))) {
    return session;
  }
  const isPreset = kind === 'preset';

  if (session.v === 3 && Array.isArray(session.sourceEntries) && Array.isArray(session.baseEntries)) {
    const origMap = session.origMap || {};
    const idKey = isPreset ? 'id' : 'uid';
    const dataPool = [];
    const dataPoolMap = new Map();
    const internData = (dataObj) => {
      const norm = isPreset ? JSON.parse(JSON.stringify(dataObj)) : serializeRegExpDeep(dataObj);
      const sig = JSON.stringify(norm);
      if (dataPoolMap.has(sig)) return dataPoolMap.get(sig);
      const idx = dataPool.length;
      dataPool.push(isPreset ? norm : reviveRegExpDeep(norm));
      dataPoolMap.set(sig, idx);
      return idx;
    };

    const encodeSide = (list) => (list || []).map((item) => {
      const ref = item.origRef;
      const orig = ref ? origMap[ref] : null;
      const mt = item._migTag || null;
      if (orig && orig.data) {
        const diffMeta = isSameExceptIdAndEnabled(orig.data, item.data, idKey, isPreset);
        if (diffMeta) {
          if (!diffMeta.idChanged && !diffMeta.enChanged && !mt) return ref;
          const patch = { r: ref };
          if (diffMeta.idChanged) patch[idKey] = item.data[idKey];
          if (diffMeta.enChanged) patch.en = !!item.data.enabled;
          if (mt) patch.mt = mt;
          return patch;
        }
      }
      const token = { p: internData(item.data) };
      if (ref) token.r = ref;
      if (mt) token.mt = mt;
      return token;
    });

    const encodeHistorySnap = (snap) => ({
      s: encodeSide(snap.sourceEntries),
      b: encodeSide(snap.baseEntries),
      ...(isPreset ? {
        ms: !!snap.migrateSettings,
        msd: snap.migrateSettingsDir || (snap.migrateSettings ? 'a2b' : 'none'),
      } : {}),
    });

    const sourceList = encodeSide(session.sourceEntries);
    const baseList = encodeSide(session.baseEntries);
    const undoStack = (session.undoStack || []).slice(-20).map(encodeHistorySnap);
    const redoStack = (session.redoStack || []).slice(-10).map(encodeHistorySnap);

    let pendingCustom = null;
    if (session._pendingCustom && session._pendingCustom.draft) {
      const pc = session._pendingCustom;
      const dCopy = JSON.parse(JSON.stringify(pc.draft));
      const srcOrig = pc.srcRef && origMap[pc.srcRef]?.data?.content;
      const baseOrig = pc.baseRef && origMap[pc.baseRef]?.data?.content;
      if (srcOrig !== undefined && dCopy.oldContent === srcOrig) delete dCopy.oldContent;
      if (baseOrig !== undefined && dCopy.newContent === baseOrig) delete dCopy.newContent;
      pendingCustom = {
        targetSide: pc.targetSide || 'base',
        targetKey: pc.targetKey || null,
        srcRef: pc.srcRef || null,
        baseRef: pc.baseRef || null,
        entryName: pc.entryName || '',
        contentOnly: !!pc.contentOnly,
        draft: dCopy,
      };
    }

    return {
      v: 3,
      kind,
      sourceName: session.sourceName,
      baseName: session.baseName,
      savedAt: Date.now(),
      sourceQuery: session.sourceQuery || '',
      baseQuery: session.baseQuery || '',
      activePane: session.activePane || 'both',
      ...(isPreset ? {
        migrateSettings: !!session.migrateSettings,
        migrateSettingsDir: session.migrateSettingsDir || (session.migrateSettings ? 'a2b' : 'none'),
      } : {}),
      sourceDirty: !!session.sourceDirty,
      baseDirty: !!session.baseDirty,
      dirty: !!session.dirty,
      ...(dataPool.length > 0 ? { dataPool } : {}),
      sourceList,
      baseList,
      ...(undoStack.length > 0 ? { undoStack } : {}),
      ...(redoStack.length > 0 ? { redoStack } : {}),
      ...(pendingCustom ? { _pendingCustom: pendingCustom } : {}),
    };
  }

  const entryOverrides = {};
  (session.entries || []).forEach((it) => {
    if (!it || !it.key) return;
    const choice = it.choice || 'new';
    const hasCustom = choice === 'custom' && (isPreset ? !!it.customPrompt : !!it.customEntry);
    const expanded = !!it.expanded;
    if (choice === 'new' && !hasCustom && !expanded) return;

    const ov = { choice };
    if (expanded) ov.expanded = true;
    if (hasCustom) {
      if (isPreset) {
        const cp = it.customPrompt;
        const np = it.newPrompt;
        if (np && isOnlyEnabledDiff(np, cp)) {
          ov.stateOnly = true;
          ov.enabled = !!cp.enabled;
        } else {
          ov.customPrompt = cp;
        }
      } else {
        const ce = it.customEntry;
        const ne = it.newEntry;
        if (ne && isOnlyEnabledDiff(serializeRegExpDeep(ne), serializeRegExpDeep(ce))) {
          ov.stateOnly = true;
          ov.enabled = !!ce.enabled;
        } else {
          ov.customEntry = ce;
        }
      }
    }
    entryOverrides[it.key] = ov;
  });

  let pendingCustom = null;
  if (session._pendingCustom && session._pendingCustom.entryKey && session._pendingCustom.draft) {
    const pc = session._pendingCustom;
    const entry = (session.entries || []).find((x) => x.key === pc.entryKey);
    const origOld = isPreset ? (entry?.oldPrompt?.content || '') : (entry?.oldEntry?.content || '');
    const origNew = isPreset ? (entry?.newPrompt?.content || '') : (entry?.newEntry?.content || '');
    const dCopy = JSON.parse(JSON.stringify(pc.draft));
    if (dCopy.oldContent === origOld) delete dCopy.oldContent;
    if (dCopy.newContent === origNew) delete dCopy.newContent;
    pendingCustom = {
      entryKey: pc.entryKey,
      contentOnly: !!pc.contentOnly,
      draft: dCopy,
    };
  }

  return {
    v: 2,
    kind,
    oldName: session.oldName,
    newName: session.newName,
    savedAt: Date.now(),
    filter: session.filter || 'diff',
    query: session.query || '',
    controlsOpen: !!session.controlsOpen,
    ...(isPreset ? { migrateSettings: !!session.migrateSettings } : {}),
    dirty: !!session.dirty,
    entryOverrides,
    ...(pendingCustom ? { _pendingCustom: pendingCustom } : {}),
  };
}

export function persistMergeDrafts() {
  try {
    if (typeof localStorage === 'undefined') return;
    const drafts = state.mergeDrafts || { preset: null, worldbook: null };
    if (!drafts.preset && !drafts.worldbook) {
      localStorage.removeItem(MERGE_DRAFTS_STORAGE_KEY);
    } else {
      localStorage.setItem(MERGE_DRAFTS_STORAGE_KEY, stringifyWithRegExp(drafts));
    }
  } catch (e) {
    logWarn('保存本地缝合草稿失败（可能超出浏览器存储配额）', e);
    notify('warning', '本地存储空间不足，暂存草稿失败，请先清理部分快照或完成当前缝合');
  }
}

export function saveMergeDraft(kind, session) {
  if (!kind || !session) return;
  state.mergeDrafts = state.mergeDrafts || { preset: null, worldbook: null };
  state.mergeDrafts[kind] = compactMergeDraft(kind, session);
  persistMergeDrafts();
}

export function clearMergeDraft(kind) {
  if (!state.mergeDrafts || !kind) return;
  state.mergeDrafts[kind] = null;
  persistMergeDrafts();
}

export function clearAllMergeDrafts() {
  state.mergeDrafts = { preset: null, worldbook: null };
  persistMergeDrafts();
}

export function createDefaultStore() {
  const defId = genId();
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      theme: 'dark',
      orbStyle: 'indigo',
      orbImage: '',
      orbImageFit: 'cover',
      groupTextColor: '',
      entryTextColor: '',
      collapseNativePresetSettings: false,
      autoScrollToBottomOnChatOpen: false,
      autoScrollToNewMessageTop: false,
      takeoverNativeToast: false,
      nativeToastTheme: 'glass',
      nativeToastPosition: 'top-right',
      tdToastTheme: 'panel',
      tdSilentToast: false,
      showOrb: true,
      enableExtButton: false,
      enableTopBarButton: false,
      topBarPosition: 'after_extensions',
      enableDragSort: false,
      showControlBar: false,
      showToolsDrawer: false,
      collapseGroupActions: true,
      collapsedGroupItems: {
        quickToggle: false,
        add: true,
        subgroup: true,
        edit: true,
        delete: true,
      },
      collapseEntryActions: true,
      collapsedEntryItems: {
        badge: true,
        preview: false,
        remove: true,
      },
      aiEditConfig: {
        proxyPreset: '',
        jailbreakPreset: '',
        model: '',
      },
      unlockOrbSliders: false,
      orbSize: 50,
      orbOpacity: 0.96,
      orbPosition: null,
      panelPosition: null,
      panelSize: null,
      fullscreen: false,
    },
    schemes: [{ id: defId, name: '默认方案', groups: [], sources: [] }],
    presetBindings: {},
    activeSchemeByPreset: {},
    activeSchemeId: defId,
    snapshots: [],
    extensions: {},
  };
}

export const state = {
  store: createDefaultStore(),
  presetName: '',
  presetNames: [],
  hasCharacter: false,
  catalog: {
    preset: [],
    worldbook: { groups: [], unloadedBooks: [] },
    script: [],
    regex: [],
    byKey: new Map(),
  },
  loadingWorldbooks: false,
  extraLoadedBooks: {},
  panelOpen: false,
  activeGroupMenuId: null,
  groupSearch: {},
  activeItemDrawerId: null,
  modal: null,
  previewKey: null,
  previewCtx: null,
  snapshotDetailId: null,
  snapshotDetailCtx: null,
  lastUndoSnapshotId: null,
  selectPopup: null,
  confirmModal: null,
  mergeDrafts: loadMergeDrafts(),
  isBusy: false,
  orbIdle: false,
};

function normalizeGroupNode(g) {
  if (!g || typeof g !== 'object') return null;
  return {
    id: g.id || genId(),
    name: g.name || '未命名分组',
    mode: g.mode === 'single' ? 'single' : 'multi',
    collapsed: !!g.collapsed,
    items: Array.isArray(g.items) ? g.items : [],
    children: Array.isArray(g.children) ? g.children.map(normalizeGroupNode).filter(Boolean) : [],
    meta: g.meta && typeof g.meta === 'object' ? g.meta : {},
  };
}

export function ensureAtLeastOneEntry(settings) {
  if (!settings.showOrb && !settings.enableExtButton && !settings.enableTopBarButton) {
    settings.showOrb = true;
  }
}

export function loadStore() {
  try {
    const globals = hasTH('getVariables') ? (callTH('getVariables', { type: 'global' }) || {}) : {};
    const raw = globals[STORAGE_KEY];
    const def = createDefaultStore();
    if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SCHEMA_VERSION) {
      return def;
    }
    const settings = Object.assign({}, def.settings, raw.settings || {});
    delete settings.enableDevMode;
    delete settings.githubRepo;
    if (/^https?:\/\//i.test(settings.orbImage || '')) {
      settings.orbImage = '';
    }
    settings.orbImageFit = settings.orbImageFit === 'contain' ? 'contain' : 'cover';
    settings.unlockOrbSliders = !!settings.unlockOrbSliders;
    settings.autoScrollToBottomOnChatOpen = !!settings.autoScrollToBottomOnChatOpen;
    settings.autoScrollToNewMessageTop = !!settings.autoScrollToNewMessageTop;
    settings.takeoverNativeToast = !!settings.takeoverNativeToast;
    if (!settings.nativeToastTheme) settings.nativeToastTheme = 'glass';
    if (!['top-right', 'top-center', 'bottom-right'].includes(settings.nativeToastPosition)) {
      settings.nativeToastPosition = 'top-right';
    }
    if (!settings.tdToastTheme) settings.tdToastTheme = 'panel';
    settings.tdSilentToast = !!settings.tdSilentToast;
    settings.collapsedGroupItems = Object.assign(
      {},
      def.settings.collapsedGroupItems,
      (raw.settings && raw.settings.collapsedGroupItems) || {},
    );
    settings.collapsedEntryItems = Object.assign(
      {},
      def.settings.collapsedEntryItems,
      (raw.settings && raw.settings.collapsedEntryItems) || {},
    );
    const oldAi = (raw.settings && raw.settings.aiEditConfig) || {};
    settings.aiEditConfig = {
      proxyPreset: typeof oldAi.proxyPreset === 'string' ? oldAi.proxyPreset : '',
      jailbreakPreset: typeof oldAi.jailbreakPreset === 'string' ? oldAi.jailbreakPreset : '',
      model: typeof oldAi.model === 'string' ? oldAi.model : '',
    };
    ensureAtLeastOneEntry(settings);
    const schemes = Array.isArray(raw.schemes) && raw.schemes.length > 0
      ? raw.schemes.map((s) => ({
          id: (s && s.id) || genId(),
          name: (s && s.name) || '方案',
          groups: s && Array.isArray(s.groups) ? s.groups.map(normalizeGroupNode).filter(Boolean) : [],
          sources: s && Array.isArray(s.sources) ? Array.from(new Set(s.sources.filter(Boolean).map(String))) : [],
        }))
      : def.schemes;
    const normalizedSnapshots = Array.isArray(raw.snapshots)
      ? raw.snapshots.filter(Boolean).map((rawSnap) => {
          const snap = Object.assign({}, rawSnap);
          snap.id = snap.id || genId();
          snap.kind = snap.kind === 'worldbook' ? 'worldbook' : 'preset';
          snap.targetName = snap.targetName || snap.presetName || '';
          snap.presetName = snap.targetName;
          snap.note = typeof snap.note === 'string' ? snap.note : '';
          snap.pinned = !!snap.pinned;
          snap.auto = !!snap.auto;
          if (snap.payloadFile) {
            snap.payloadFile = normalizeBackendFileName(snap.payloadFile);
          }
          if (snap.fullPresetData || snap.fullWorldbookData) {
            const payload = {};
            if (snap.fullPresetData) payload.fullPresetData = snap.fullPresetData;
            if (snap.fullWorldbookData) payload.fullWorldbookData = snap.fullWorldbookData;
            snap.payloadBytes = setSnapshotPayloadLocal(snap.id, payload);
            delete snap.fullPresetData;
            delete snap.fullWorldbookData;
          }
          return snap;
        })
      : [];
    const loadedStore = {
      schemaVersion: SCHEMA_VERSION,
      settings,
      schemes,
      presetBindings: raw.presetBindings && typeof raw.presetBindings === 'object' ? raw.presetBindings : {},
      activeSchemeByPreset: raw.activeSchemeByPreset && typeof raw.activeSchemeByPreset === 'object' ? raw.activeSchemeByPreset : {},
      activeSchemeId: raw.activeSchemeId || schemes[0].id,
      snapshots: normalizedSnapshots,
      extensions: raw.extensions && typeof raw.extensions === 'object' ? raw.extensions : {},
    };
    syncSchemeSourcesFromBindings(loadedStore);
    return loadedStore;
  } catch (e) {
    logError('读取全局变量失败', e);
    return createDefaultStore();
  }
}

export function saveStore(store = state.store, opts = {}) {
  try {
    if (!hasTH('updateVariablesWith')) return;
    callTH('updateVariablesWith', (vars) => {
      const next = vars && typeof vars === 'object' ? vars : {};
      next[STORAGE_KEY] = JSON.parse(JSON.stringify(store));
      return next;
    }, { type: 'global' });
  } catch (e) {
    if (!opts?.silent) {
      logError('保存全局变量失败', e);
      notify('error', '保存配置到全局变量失败');
    }
  }
}

export function ensureSchemesPool() {
  if (!Array.isArray(state.store.schemes) || state.store.schemes.length === 0) {
    const defId = genId();
    state.store.schemes = [{ id: defId, name: '默认方案', groups: [], sources: [] }];
    state.store.activeSchemeId = defId;
  }
  return state.store.schemes;
}

export function syncSchemeSourcesFromBindings(store = state.store) {
  if (!store || typeof store !== 'object') return;
  const pool = Array.isArray(store.schemes) ? store.schemes : [];
  const bindings = store.presetBindings && typeof store.presetBindings === 'object' ? store.presetBindings : {};
  const sourcesMap = new Map();
  pool.forEach((s) => {
    if (s && s.id) sourcesMap.set(s.id, []);
  });
  Object.keys(bindings).forEach((pName) => {
    const arr = Array.isArray(bindings[pName]) ? bindings[pName] : [];
    arr.forEach((sid) => {
      if (sourcesMap.has(sid) && pName && !sourcesMap.get(sid).includes(pName)) {
        sourcesMap.get(sid).push(pName);
      }
    });
  });
  pool.forEach((s) => {
    if (s) s.sources = sourcesMap.get(s.id) || [];
  });
}

export function getSchemeSources(scheme) {
  if (!scheme) return [];
  if (Array.isArray(scheme.sources)) return scheme.sources;
  const out = [];
  const bindings = state.store?.presetBindings || {};
  Object.keys(bindings).forEach((pName) => {
    if (Array.isArray(bindings[pName]) && bindings[pName].includes(scheme.id) && !out.includes(pName)) {
      out.push(pName);
    }
  });
  return out;
}

export function setPresetBindingsForPreset(presetName, schemeIds) {
  const pKey = presetName || '__default__';
  const pool = ensureSchemesPool();
  const validIds = new Set(pool.map((s) => s.id));
  const cleanIds = Array.from(new Set((schemeIds || []).filter((id) => validIds.has(id))));
  if (cleanIds.length > 0) state.store.presetBindings[pKey] = cleanIds;
  else delete state.store.presetBindings[pKey];
  syncSchemeSourcesFromBindings(state.store);
  saveStore(state.store);
  return cleanIds;
}

export function getBoundSchemeIds(presetName) {
  const key = presetName || '__default__';
  const pool = ensureSchemesPool();
  const validIds = new Set(pool.map((s) => s.id));
  const rawList = state.store.presetBindings[key];
  if (!Array.isArray(rawList)) return [];
  return rawList.filter((id) => validIds.has(id));
}

export function getVisibleSchemes(presetName) {
  const pool = ensureSchemesPool();
  const boundIds = getBoundSchemeIds(presetName);
  if (boundIds.length > 0) {
    const boundSet = new Set(boundIds);
    const filtered = pool.filter((s) => boundSet.has(s.id));
    if (filtered.length > 0) return { schemes: filtered, isBound: true };
  }
  return { schemes: pool, isBound: false };
}

export function getActiveScheme() {
  const pKey = state.presetName || '__default__';
  const vis = getVisibleSchemes(pKey).schemes;
  const savedForPreset = state.store.activeSchemeByPreset[pKey];
  let active = vis.find((s) => s.id === savedForPreset);
  if (!active) active = vis.find((s) => s.id === state.store.activeSchemeId);
  if (!active) active = vis[0];
  state.store.activeSchemeByPreset[pKey] = active.id;
  state.store.activeSchemeId = active.id;
  return active;
}

export function setActiveSchemeId(schemeId) {
  const pKey = state.presetName || '__default__';
  state.store.activeSchemeByPreset[pKey] = schemeId;
  state.store.activeSchemeId = schemeId;
  saveStore(state.store);
}

export function findGroupNode(groups, targetId, parent = null) {
  if (!Array.isArray(groups)) return null;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.id === targetId) return { group: g, parent, list: groups, index: i };
    if (Array.isArray(g.children) && g.children.length > 0) {
      const found = findGroupNode(g.children, targetId, g);
      if (found) return found;
    }
  }
  return null;
}

export function findGroupPath(groups, targetId, trail = []) {
  if (!Array.isArray(groups)) return null;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const nextTrail = [...trail, g];
    if (g.id === targetId) return nextTrail;
    if (Array.isArray(g.children) && g.children.length > 0) {
      const found = findGroupPath(g.children, targetId, nextTrail);
      if (found) return found;
    }
  }
  return null;
}

export function isGroupDescendant(group, possibleChildId) {
  if (!group || !Array.isArray(group.children)) return false;
  for (let i = 0; i < group.children.length; i++) {
    const c = group.children[i];
    if (c.id === possibleChildId || isGroupDescendant(c, possibleChildId)) return true;
  }
  return false;
}

export function createOrUpdateScheme(data) {
  const pool = ensureSchemesPool();
  if (data.id) {
    const s = pool.find((item) => item.id === data.id);
    if (s) s.name = data.name;
    saveStore(state.store);
    return s?.id || data.id;
  }
  const newId = genId();
  if (data.duplicateFromId) {
    const src = pool.find((item) => item.id === data.duplicateFromId);
    const cloneGroupsDeep = (list) =>
      (list || []).map((g) => {
        const copy = JSON.parse(JSON.stringify(g));
        copy.id = genId();
        copy.children = cloneGroupsDeep(copy.children);
        return copy;
      });
    pool.push({ id: newId, name: data.name, groups: src ? cloneGroupsDeep(src.groups) : [], sources: [] });
  } else {
    pool.push({ id: newId, name: data.name, groups: [], sources: [] });
  }
  setActiveSchemeId(newId);
  return newId;
}

export function deleteActiveScheme() {
  const pool = ensureSchemesPool();
  if (pool.length <= 1) {
    notify('warning', '全局至少需要保留一个方案');
    return;
  }
  const active = getActiveScheme();
  state.store.schemes = pool.filter((s) => s.id !== active.id);
  Object.keys(state.store.presetBindings).forEach((k) => {
    if (Array.isArray(state.store.presetBindings[k])) {
      state.store.presetBindings[k] = state.store.presetBindings[k].filter((id) => id !== active.id);
      if (state.store.presetBindings[k].length === 0) delete state.store.presetBindings[k];
    }
  });
  syncSchemeSourcesFromBindings(state.store);
  getActiveScheme();
  saveStore(state.store);
  notify('info', '方案已删除');
}

export function createOrUpdateGroup(data) {
  const scheme = getActiveScheme();
  if (data.id) {
    const found = findGroupNode(scheme.groups, data.id);
    if (found) {
      found.group.name = data.name;
      found.group.mode = data.mode;
      found.group.meta = found.group.meta || {};
      found.group.meta.memoryToggle = data.mode === 'multi' && !!data.memoryToggle;
      found.group.meta.exclusiveChildren = !!data.exclusiveChildren;
    }
  } else {
    const newGroup = {
      id: genId(),
      name: data.name,
      mode: data.mode,
      collapsed: false,
      items: [],
      children: [],
      meta: {
        memoryToggle: data.mode === 'multi' && !!data.memoryToggle,
        exclusiveChildren: !!data.exclusiveChildren,
      },
    };
    if (data.parentId) {
      const pFound = findGroupNode(scheme.groups, data.parentId);
      if (pFound) {
        pFound.group.children = pFound.group.children || [];
        pFound.group.children.push(newGroup);
        pFound.group.collapsed = false;
      } else {
        scheme.groups.push(newGroup);
      }
    } else {
      scheme.groups.push(newGroup);
    }
  }
  saveStore(state.store);
}

export function clearGroupContents(groupId) {
  const found = findGroupNode(getActiveScheme().groups, groupId);
  if (!found) return;
  found.group.items = [];
  found.group.children = [];
  saveStore(state.store);
  notify('info', '已清空分组内容');
}

export function deleteGroup(groupId) {
  const found = findGroupNode(getActiveScheme().groups, groupId);
  if (!found) return;
  found.list.splice(found.index, 1);
  saveStore(state.store);
}

export function removeEntryFromGroup(groupId, itemKey) {
  const found = findGroupNode(getActiveScheme().groups, groupId);
  if (!found) return;
  found.group.items = (found.group.items || []).filter((it) => (it.key || makeItemKey(it)) !== itemKey);
  saveStore(state.store);
}

export function setGroupItems(groupId, selectedMap) {
  const found = findGroupNode(getActiveScheme().groups, groupId);
  if (!found) return;
  const g = found.group;
  const kept = (g.items || []).filter((it) => selectedMap.has(it.key || makeItemKey(it)));
  const keptSet = new Set(kept.map((it) => it.key || makeItemKey(it)));
  selectedMap.forEach((ref, k) => {
    if (!keptSet.has(k)) {
      const cloned = cloneItemRef(ref);
      if (cloned) {
        kept.push(cloned);
        keptSet.add(k);
      }
    }
  });
  g.items = kept;
  saveStore(state.store);
}

export function performDrop(op) {
  const scheme = getActiveScheme();
  const dt = op && op.dropTarget;
  if (!dt) return false;
  if (op.type === 'item') {
    const srcFound = findGroupNode(scheme.groups, op.sourceGroupId);
    if (!srcFound) return false;
    const srcItems = srcFound.group.items || [];
    const srcIdx = srcItems.findIndex((it) => (it.key || makeItemKey(it)) === op.itemKey);
    if (srcIdx < 0) return false;
    const movedRef = srcItems.splice(srcIdx, 1)[0];
    const tgtFound = findGroupNode(scheme.groups, dt.groupId);
    if (!tgtFound) return false;
    const tgtItems = (tgtFound.group.items = tgtFound.group.items || []);
    const dupIdx = tgtItems.findIndex((it) => (it.key || makeItemKey(it)) === op.itemKey);
    if (dupIdx >= 0) tgtItems.splice(dupIdx, 1);
    if (dt.kind === 'group-append') {
      tgtItems.push(movedRef);
      tgtFound.group.collapsed = false;
    } else if (dt.kind === 'item') {
      let tIdx = tgtItems.findIndex((it) => (it.key || makeItemKey(it)) === dt.itemKey);
      if (tIdx < 0) tgtItems.push(movedRef);
      else {
        if (dt.pos === 'after') tIdx++;
        tgtItems.splice(tIdx, 0, movedRef);
      }
    }
    saveStore(state.store);
    return true;
  }
  if (op.type === 'group') {
    const srcFound = findGroupNode(scheme.groups, op.sourceGroupId);
    if (!srcFound) return false;
    if (dt.kind === 'group' && (dt.targetGroupId === op.sourceGroupId || isGroupDescendant(srcFound.group, dt.targetGroupId))) {
      return false;
    }
    const movedGroup = srcFound.list.splice(srcFound.index, 1)[0];
    if (dt.kind === 'root') {
      if (dt.pos === 'top') scheme.groups.unshift(movedGroup);
      else scheme.groups.push(movedGroup);
    } else if (dt.kind === 'group') {
      const tgtFound = findGroupNode(scheme.groups, dt.targetGroupId);
      if (!tgtFound) scheme.groups.push(movedGroup);
      else if (dt.pos === 'into') {
        tgtFound.group.children = tgtFound.group.children || [];
        tgtFound.group.children.push(movedGroup);
        tgtFound.group.collapsed = false;
      } else {
        const insertIdx = dt.pos === 'after' ? tgtFound.index + 1 : tgtFound.index;
        tgtFound.list.splice(insertIdx, 0, movedGroup);
      }
    }
    saveStore(state.store);
    return true;
  }
  return false;
}

async function hydrateSnapshotsForExport(snaps) {
  return Promise.all((snaps || []).map(async (snap) => {
    const copy = JSON.parse(JSON.stringify(snap));
    const heavy = await getSnapshotPayload(snap);
    if (heavy) {
      if (heavy.fullPresetData) copy.fullPresetData = serializeRegExpDeep(heavy.fullPresetData);
      if (heavy.fullWorldbookData) copy.fullWorldbookData = serializeRegExpDeep(heavy.fullWorldbookData);
    }
    delete copy.payloadFile;
    return copy;
  }));
}

export async function exportStoreData(opts) {
  const payload = {
    app: 'TavernDeck',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    scope: 'partial',
  };
  if (opts.includeSettings) {
    payload.settings = JSON.parse(JSON.stringify(state.store.settings));
  }
  if (opts.schemeIds && opts.schemeIds.length > 0) {
    const idSet = new Set(opts.schemeIds);
    payload.schemes = ensureSchemesPool()
      .filter((s) => idSet.has(s.id))
      .map((s) => JSON.parse(JSON.stringify(s)));
    const bindings = {};
    Object.keys(state.store.presetBindings || {}).forEach((pName) => {
      const kept = (state.store.presetBindings[pName] || []).filter((id) => idSet.has(id));
      if (kept.length > 0) bindings[pName] = kept;
    });
    payload.presetBindings = bindings;
  }
  if (opts.includeSnapshots) {
    payload.snapshots = await hydrateSnapshotsForExport(state.store.snapshots);
  }
  if (opts.includeAll) {
    payload.scope = 'all';
    payload.settings = JSON.parse(JSON.stringify(state.store.settings));
    payload.schemes = JSON.parse(JSON.stringify(ensureSchemesPool()));
    payload.presetBindings = JSON.parse(JSON.stringify(state.store.presetBindings || {}));
    payload.snapshots = await hydrateSnapshotsForExport(state.store.snapshots);
  }
  return payload;
}

export async function importStoreData(data, opts) {
  if (!data || typeof data !== 'object' || data.app !== 'TavernDeck') {
    throw new Error('无效的 TavernDeck 备份文件格式');
  }
  const mode = opts.mode === 'overwrite' ? 'overwrite' : 'merge';

  if (opts.importSettings && data.settings && typeof data.settings === 'object') {
    state.store.settings = Object.assign(createDefaultStore().settings, state.store.settings, data.settings);
    ensureAtLeastOneEntry(state.store.settings);
  }

  if (opts.importSchemes && Array.isArray(data.schemes)) {
    const incoming = data.schemes.map((s) => ({
      id: (s && s.id) || genId(),
      name: (s && s.name) || '导入方案',
      groups: s && Array.isArray(s.groups) ? s.groups.map(normalizeGroupNode).filter(Boolean) : [],
      sources: [],
    }));
    if (mode === 'overwrite') {
      if (incoming.length > 0) {
        state.store.schemes = incoming;
        state.store.activeSchemeId = incoming[0].id;
        state.store.activeSchemeByPreset = {};
        if (data.presetBindings && typeof data.presetBindings === 'object') {
          state.store.presetBindings = JSON.parse(JSON.stringify(data.presetBindings));
        } else {
          state.store.presetBindings = {};
        }
        syncSchemeSourcesFromBindings(state.store);
      }
    } else {
      const pool = ensureSchemesPool();
      const idMap = new Map();
      const existingIds = new Set(pool.map((s) => s.id));
      incoming.forEach((s) => {
        let newId = s.id;
        if (existingIds.has(newId)) newId = genId();
        idMap.set(s.id, newId);
        existingIds.add(newId);
        pool.push({ id: newId, name: s.name, groups: s.groups, sources: [] });
      });
      if (data.presetBindings && typeof data.presetBindings === 'object') {
        Object.keys(data.presetBindings).forEach((pName) => {
          const cur = getBoundSchemeIds(pName);
          (data.presetBindings[pName] || []).forEach((oldId) => {
            const mapped = idMap.get(oldId) || oldId;
            if (!cur.includes(mapped)) cur.push(mapped);
          });
          if (cur.length > 0) state.store.presetBindings[pName] = cur;
        });
      }
      syncSchemeSourcesFromBindings(state.store);
    }
  }

  if (opts.importSnapshots && Array.isArray(data.snapshots)) {
    const normalizeImportedSnap = async (rawSnap, newId) => {
      const copy = JSON.parse(JSON.stringify(rawSnap));
      copy.id = newId;
      copy.kind = copy.kind === 'worldbook' ? 'worldbook' : 'preset';
      copy.targetName = copy.targetName || copy.presetName || '';
      copy.presetName = copy.targetName;
      copy.note = typeof copy.note === 'string' ? copy.note : '';
      copy.pinned = !!copy.pinned;
      copy.auto = !!copy.auto;
      delete copy.payloadFile;
      if (copy.fullPresetData || copy.fullWorldbookData) {
        const heavy = {};
        if (copy.fullPresetData) heavy.fullPresetData = copy.fullPresetData;
        if (copy.fullWorldbookData) heavy.fullWorldbookData = reviveRegExpDeep(copy.fullWorldbookData);
        const saved = await setSnapshotPayload(copy.id, heavy);
        copy.payloadBytes = saved.bytes;
        if (saved.fileName) copy.payloadFile = saved.fileName;
        delete copy.fullPresetData;
        delete copy.fullWorldbookData;
      }
      return copy;
    };

    if (mode === 'overwrite') {
      await Promise.all((state.store.snapshots || []).map((old) => deleteSnapshotPayload(old)));
      state.store.snapshots = await Promise.all(
        data.snapshots.filter(Boolean).map((s) => normalizeImportedSnap(s, s.id || genId())),
      );
    } else {
      const existingIds = new Set((state.store.snapshots || []).map((s) => s.id));
      const tasks = [];
      data.snapshots.filter(Boolean).forEach((snap) => {
        let newId = snap.id || genId();
        if (existingIds.has(newId)) newId = genId();
        existingIds.add(newId);
        tasks.push(normalizeImportedSnap(snap, newId));
      });
      const added = await Promise.all(tasks);
      state.store.snapshots.push(...added);
    }
  }

  saveStore(state.store);
}

function getUtf8ByteLength(str) {
  const s = String(str || '');
  if (!s) return 0;
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    if (typeof Blob !== 'undefined') return new Blob([s]).size;
  } catch (e) {}
  return s.length;
}

export function getStorageDiagnostics(devLogCount = 0) {
  const storeObj = state.store || createDefaultStore();
  const globalJson = JSON.stringify(storeObj);
  const globalTotalBytes = getUtf8ByteLength(globalJson);

  const schemesBytes = getUtf8ByteLength(JSON.stringify({
    schemes: storeObj.schemes || [],
    presetBindings: storeObj.presetBindings || {},
    activeSchemeByPreset: storeObj.activeSchemeByPreset || {},
  }));
  const settingsBytes = getUtf8ByteLength(JSON.stringify(storeObj.settings || {}));
  const orbImageBytes = getUtf8ByteLength(storeObj.settings?.orbImage || '');
  const snapshotsMetaBytes = getUtf8ByteLength(JSON.stringify(storeObj.snapshots || []));
  const extObj = storeObj.extensions && typeof storeObj.extensions === 'object' ? storeObj.extensions : {};
  const mvuMap = extObj.mvuStarred || {};
  const mvuBytes = getUtf8ByteLength(JSON.stringify(mvuMap));

  const mvuItems = Object.keys(mvuMap).map((chatKey) => {
    const list = Array.isArray(mvuMap[chatKey]) ? mvuMap[chatKey] : [];
    return {
      chatKey,
      count: list.length,
      bytes: getUtf8ByteLength(JSON.stringify(list)),
    };
  }).sort((a, b) => b.bytes - a.bytes);

  const aiDraftsMap = extObj.aiEditDrafts && typeof extObj.aiEditDrafts === 'object' ? extObj.aiEditDrafts : {};
  const aiDraftsBytes = getUtf8ByteLength(JSON.stringify(aiDraftsMap));
  const aiDraftItems = Object.keys(aiDraftsMap).map((draftKey) => {
    const d = aiDraftsMap[draftKey] || {};
    const label = draftKey.startsWith('preset::')
      ? `预设 · ${draftKey.slice(8)}`
      : (draftKey.startsWith('worldbook::') ? `世界书 · ${draftKey.slice(11)}` : draftKey);
    return {
      draftKey,
      label,
      selectedCount: Array.isArray(d.selected) ? d.selected.length : 0,
      refCount: Array.isArray(d.refSelected) ? d.refSelected.length : 0,
      instructionLen: typeof d.instruction === 'string' ? d.instruction.length : 0,
      bytes: getUtf8ByteLength(JSON.stringify(d)),
      updatedAt: Number(d.updatedAt) || 0,
    };
  }).sort((a, b) => b.bytes - a.bytes);

  const aiTplsArr = Array.isArray(extObj.aiInstructionTemplates) ? extObj.aiInstructionTemplates : [];
  const aiTplsBytes = getUtf8ByteLength(JSON.stringify(aiTplsArr));
  const aiTplsItems = aiTplsArr.map((t, idx) => ({
    id: String(t?.id || `idx:${idx}`),
    name: String(t?.name || `模板 #${idx + 1}`),
    contentPreview: String(t?.content || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    bytes: getUtf8ByteLength(JSON.stringify(t || {})),
  })).sort((a, b) => b.bytes - a.bytes);

  const quickTplsArr = Array.isArray(extObj.quickTemplates) ? extObj.quickTemplates : [];
  const quickTplsBytes = getUtf8ByteLength(JSON.stringify(quickTplsArr));
  const quickTplsItems = quickTplsArr.map((t, idx) => ({
    id: String(t?.id || `idx:${idx}`),
    name: String(t?.name || `模板 #${idx + 1}`),
    contentPreview: String(t?.content || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    bytes: getUtf8ByteLength(JSON.stringify(t || {})),
  })).sort((a, b) => b.bytes - a.bytes);

  const ignoredMap = extObj.ignoredPresetVars && typeof extObj.ignoredPresetVars === 'object' ? extObj.ignoredPresetVars : {};
  const ignoredVarsBytes = getUtf8ByteLength(JSON.stringify(ignoredMap));
  const ignoredVarItems = Object.keys(ignoredMap).map((presetKey) => {
    const raw = ignoredMap[presetKey] || {};
    return {
      presetKey,
      varCount: Array.isArray(raw.vars) ? raw.vars.length : 0,
      entryCount: Array.isArray(raw.entries) ? raw.entries.length : 0,
      bytes: getUtf8ByteLength(JSON.stringify(raw)),
    };
  }).sort((a, b) => b.bytes - a.bytes);

  const backendLogMetaMap = extObj.backendLogDays && typeof extObj.backendLogDays === 'object' ? extObj.backendLogDays : {};
  const backendLogMetaBytes = getUtf8ByteLength(JSON.stringify(backendLogMetaMap));

  const knownExtKeys = new Set([
    'mvuStarred', 'aiEditDrafts', 'aiInstructionTemplates',
    'quickTemplates', 'ignoredPresetVars', 'backendLogDays',
  ]);
  const otherExtKeys = Object.keys(extObj).filter((k) => !knownExtKeys.has(k));
  const otherExtBytes = otherExtKeys.reduce(
    (sum, k) => sum + getUtf8ByteLength(JSON.stringify({ [k]: extObj[k] })),
    0,
  );

  const snapList = Array.isArray(storeObj.snapshots) ? storeObj.snapshots : [];
  const snapById = new Map(snapList.map((s) => [s.id, s]));

  const payloadMap = readAllSnapshotPayloads();
  let payloadsTotalBytes = 0;
  const payloadItems = [];
  const orphanPayloadIds = [];

  Object.keys(payloadMap).forEach((id) => {
    const rawStr = stringifyWithRegExp(payloadMap[id]);
    const bytes = getUtf8ByteLength(rawStr);
    payloadsTotalBytes += bytes;
    const snap = snapById.get(id);
    if (!snap) {
      orphanPayloadIds.push(id);
      payloadItems.push({
        id,
        name: `孤儿载荷 (${id.slice(0, 8)})`,
        kind: 'orphan',
        targetName: '未关联任何快照',
        auto: false,
        pinned: false,
        orphan: true,
        bytes,
        updatedAt: 0,
      });
    } else {
      payloadItems.push({
        id,
        name: snap.name || id,
        kind: snap.kind || 'preset',
        targetName: snap.targetName || snap.presetName || '',
        auto: !!snap.auto,
        pinned: !!snap.pinned,
        orphan: false,
        bytes,
        updatedAt: snap.updatedAt || snap.createdAt || 0,
      });
    }
  });
  payloadItems.sort((a, b) => b.bytes - a.bytes);

  const backendItems = [];
  let backendTotalBytes = 0;
  snapList.forEach((s) => {
    if (!s || !s.payloadFile) return;
    const bytes = typeof s.payloadBytes === 'number' && s.payloadBytes > 0 ? s.payloadBytes : 0;
    backendTotalBytes += bytes;
    backendItems.push({
      id: s.id,
      fileName: normalizeBackendFileName(s.payloadFile) || s.payloadFile,
      name: s.name || s.id,
      kind: s.kind || 'preset',
      targetName: s.targetName || s.presetName || '',
      auto: !!s.auto,
      pinned: !!s.pinned,
      bytes,
      updatedAt: s.updatedAt || s.createdAt || 0,
    });
  });
  backendItems.sort((a, b) => b.bytes - a.bytes);

  const missingPayloadSnaps = snapList.filter((s) => s && s.mode === 'full' && !s.payloadFile && !payloadMap[s.id]);

  const drafts = state.mergeDrafts || { preset: null, worldbook: null };
  const presetDraftBytes = drafts.preset ? getUtf8ByteLength(stringifyWithRegExp(drafts.preset)) : 0;
  const wbDraftBytes = drafts.worldbook ? getUtf8ByteLength(stringifyWithRegExp(drafts.worldbook)) : 0;
  const draftsTotalBytes = presetDraftBytes + wbDraftBytes;

  let originLocalStorageBytes = 0;
  let otherLocalStorageBytes = 0;
  let otherLocalStorageKeys = 0;
  try {
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const v = localStorage.getItem(k) || '';
        const sz = getUtf8ByteLength(k) + getUtf8ByteLength(v);
        originLocalStorageBytes += sz;
        if (k !== SNAPSHOT_PAYLOADS_STORAGE_KEY && k !== MERGE_DRAFTS_STORAGE_KEY) {
          otherLocalStorageBytes += sz;
          otherLocalStorageKeys++;
        }
      }
    }
  } catch (e) {}

  const aiCache = state._aiModelsCache && typeof state._aiModelsCache === 'object' ? state._aiModelsCache : {};
  const aiCacheKeys = Object.keys(aiCache);
  const aiCacheEndpoints = aiCacheKeys.length;
  const aiCacheBytes = getUtf8ByteLength(JSON.stringify(aiCache));
  const aiCacheItems = aiCacheKeys.map((apiKey) => {
    const models = Array.isArray(aiCache[apiKey]) ? aiCache[apiKey] : [];
    const label = !apiKey
      ? '跟随酒馆当前连接'
      : (apiKey.startsWith('profile:')
        ? `连接配置 (${apiKey.slice(8)})`
        : (apiKey.startsWith('proxy:') ? `代理预设 (${apiKey.slice(6)})` : apiKey));
    return {
      apiKey,
      label,
      modelCount: models.length,
      bytes: getUtf8ByteLength(JSON.stringify(models)),
    };
  }).sort((a, b) => b.bytes - a.bytes);
  const devLogStats = getDevLogsStorageInfo();
  const extraLoadedBooks = Object.keys(state.extraLoadedBooks || {});
  const extraLoadedBooksCount = extraLoadedBooks.length;

  const autoUnpinnedCount = snapList.filter((s) => s && s.auto && !s.pinned).length;
  const fullUnpinnedCount = snapList.filter((s) => s && s.mode === 'full' && !s.pinned && (!!s.payloadFile || !!payloadMap[s.id])).length;

  return {
    globalVar: {
      key: STORAGE_KEY,
      totalBytes: globalTotalBytes,
      schemesBytes,
      schemeCount: (storeObj.schemes || []).length,
      settingsBytes,
      orbImageBytes,
      hasOrbImage: !!storeObj.settings?.orbImage,
      snapshotsMetaBytes,
      snapshotCount: snapList.length,
      mvuBytes,
      mvuItems,
      aiDraftsBytes,
      aiDraftItems,
      aiTplsBytes,
      aiTplsCount: aiTplsArr.length,
      aiTplsItems,
      quickTplsBytes,
      quickTplsCount: quickTplsArr.length,
      quickTplsItems,
      ignoredVarsBytes,
      ignoredVarItems,
      backendLogMetaBytes,
      backendLogMetaCount: Object.keys(backendLogMetaMap).length,
      otherExtBytes,
      otherExtKeys,
    },
    backend: {
      available: hasTH('uploadTavernFile') && hasTH('getTavernFile') && hasTH('deleteTavernFile'),
      snapTotalBytes: backendTotalBytes,
      logTotalBytes: (() => {
        const logMap = storeObj.extensions?.backendLogDays || {};
        return Object.values(logMap).reduce((sum, it) => sum + (Number(it?.bytes) || 0), 0);
      })(),
      totalBytes: backendTotalBytes + (() => {
        const logMap = storeObj.extensions?.backendLogDays || {};
        return Object.values(logMap).reduce((sum, it) => sum + (Number(it?.bytes) || 0), 0);
      })(),
      items: backendItems,
      logItems: Object.values(storeObj.extensions?.backendLogDays || {})
        .filter((it) => it && it.date)
        .map((it) => ({
          date: it.date,
          fileName: normalizeBackendFileName(it.fileName) || `taverndeck_log_${it.date}.json`,
          count: Number(it.count) || 0,
          warnCount: Number(it.warnCount) || 0,
          errCount: Number(it.errCount) || 0,
          bytes: Number(it.bytes) || 0,
          updatedAt: Number(it.updatedAt) || 0,
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    },
    localStorage: {
      quotaEstimateBytes: 5 * 1024 * 1024,
      originTotalBytes: originLocalStorageBytes,
      tdTotalBytes: payloadsTotalBytes + draftsTotalBytes,
      otherBytes: otherLocalStorageBytes,
      otherKeyCount: otherLocalStorageKeys,
      payloadsKey: SNAPSHOT_PAYLOADS_STORAGE_KEY,
      payloadsTotalBytes,
      payloadItems,
      orphanPayloadIds,
      missingPayloadCount: missingPayloadSnaps.length,
      draftsKey: MERGE_DRAFTS_STORAGE_KEY,
      draftsTotalBytes,
      presetDraft: drafts.preset ? {
        title: `${drafts.preset.sourceName || drafts.preset.oldName} ⇄ ${drafts.preset.baseName || drafts.preset.newName}`,
        bytes: presetDraftBytes,
      } : null,
      wbDraft: drafts.worldbook ? {
        title: `${drafts.worldbook.sourceName || drafts.worldbook.oldName} ⇄ ${drafts.worldbook.baseName || drafts.worldbook.newName}`,
        bytes: wbDraftBytes,
      } : null,
    },
    memory: {
      devLogCount: devLogCount || devLogStats.count,
      devLogBytes: devLogStats.bytes,
      opStepCount: devLogStats.opStepCount,
      pendingBackendLogCount: pendingBackendLogs.length,
      extraLoadedBooksCount,
      extraLoadedBooks,
      aiCacheEndpoints,
      aiCacheBytes,
      aiCacheItems,
    },
    quickCounts: {
      autoUnpinnedCount,
      fullUnpinnedCount,
      orphanCount: orphanPayloadIds.length,
      missingPayloadCount: missingPayloadSnaps.length,
    },
    grandTotalBytes: globalTotalBytes + backendTotalBytes + (() => {
      const logMap = storeObj.extensions?.backendLogDays || {};
      return Object.values(logMap).reduce((sum, it) => sum + (Number(it?.bytes) || 0), 0);
    })() + payloadsTotalBytes + draftsTotalBytes,
  };
}

export function cleanOrphanSnapshotPayloads() {
  const snapIds = new Set((state.store.snapshots || []).map((s) => s.id));
  const map = readAllSnapshotPayloads();
  let removed = 0;
  Object.keys(map).forEach((id) => {
    if (!snapIds.has(id)) {
      delete map[id];
      removed++;
    }
  });
  if (removed > 0) writeAllSnapshotPayloads(map);
  return removed;
}

export function repairMissingSnapshotPayloads() {
  const map = readAllSnapshotPayloads();
  let repaired = 0;
  (state.store.snapshots || []).forEach((s) => {
    if (s && s.mode === 'full' && !s.payloadFile && !map[s.id]) {
      s.mode = 'state';
      s.payloadBytes = 0;
      repaired++;
    }
  });
  if (repaired > 0) saveStore(state.store);
  return repaired;
}

export function clearMvuStarredChat(chatKey) {
  const map = state.store?.extensions?.mvuStarred;
  if (!map || !Object.prototype.hasOwnProperty.call(map, chatKey)) return false;
  delete map[chatKey];
  saveStore(state.store);
  return true;
}

export function clearAllMvuStarred() {
  if (!state.store?.extensions?.mvuStarred) return 0;
  const count = Object.keys(state.store.extensions.mvuStarred).length;
  delete state.store.extensions.mvuStarred;
  saveStore(state.store);
  return count;
}

export function clearAiEditDraftItem(draftKey) {
  const map = state.store?.extensions?.aiEditDrafts;
  if (!map || !Object.prototype.hasOwnProperty.call(map, draftKey)) return false;
  delete map[draftKey];
  if (Object.keys(map).length === 0) delete state.store.extensions.aiEditDrafts;
  saveStore(state.store);
  return true;
}

export function clearAllAiEditDrafts() {
  const map = state.store?.extensions?.aiEditDrafts;
  if (!map) return 0;
  const count = Object.keys(map).length;
  delete state.store.extensions.aiEditDrafts;
  saveStore(state.store);
  return count;
}

export function deleteAiInstructionTemplate(tplId) {
  const list = state.store?.extensions?.aiInstructionTemplates;
  if (!Array.isArray(list)) return false;
  const next = list.filter((t, idx) => String(t?.id || `idx:${idx}`) !== tplId);
  if (next.length === list.length) return false;
  state.store.extensions.aiInstructionTemplates = next;
  saveStore(state.store);
  return true;
}

export function clearAiInstructionTemplates() {
  if (!state.store?.extensions) return 0;
  const list = state.store.extensions.aiInstructionTemplates;
  const count = Array.isArray(list) ? list.length : 0;
  state.store.extensions.aiInstructionTemplates = [];
  saveStore(state.store);
  return count;
}

export function deleteQuickTemplate(tplId) {
  const list = state.store?.extensions?.quickTemplates;
  if (!Array.isArray(list)) return false;
  const next = list.filter((t, idx) => String(t?.id || `idx:${idx}`) !== tplId);
  if (next.length === list.length) return false;
  if (next.length === 0) delete state.store.extensions.quickTemplates;
  else state.store.extensions.quickTemplates = next;
  saveStore(state.store);
  return true;
}

export function clearQuickTemplates() {
  if (!state.store?.extensions?.quickTemplates) return 0;
  const count = Array.isArray(state.store.extensions.quickTemplates) ? state.store.extensions.quickTemplates.length : 0;
  delete state.store.extensions.quickTemplates;
  saveStore(state.store);
  return count;
}

export function clearIgnoredPresetVarsItem(presetKey) {
  const map = state.store?.extensions?.ignoredPresetVars;
  if (!map || !Object.prototype.hasOwnProperty.call(map, presetKey)) return false;
  delete map[presetKey];
  if (Object.keys(map).length === 0) delete state.store.extensions.ignoredPresetVars;
  saveStore(state.store);
  return true;
}

export function clearAllIgnoredPresetVars() {
  const map = state.store?.extensions?.ignoredPresetVars;
  if (!map) return 0;
  const count = Object.keys(map).length;
  delete state.store.extensions.ignoredPresetVars;
  saveStore(state.store);
  return count;
}

export async function cleanAutoBackupSnapshots() {
  const list = state.store.snapshots || [];
  const kept = [];
  const toDelete = [];
  list.forEach((s) => {
    if (s && s.auto && !s.pinned) toDelete.push(s);
    else if (s) kept.push(s);
  });
  if (toDelete.length === 0) return 0;

  await Promise.all(toDelete.map((s) => deleteSnapshotPayload(s)));
  toDelete.forEach((s) => {
    if (state.lastUndoSnapshotId === s.id) state.lastUndoSnapshotId = null;
  });
  state.store.snapshots = kept;
  saveStore(state.store);
  return toDelete.length;
}

export async function slimAllUnpinnedFullSnapshots() {
  const map = readAllSnapshotPayloads();
  const targets = (state.store.snapshots || []).filter((s) => s && s.mode === 'full' && !s.pinned);
  if (targets.length === 0) return 0;

  await Promise.all(targets.map(async (s) => {
    if (s.payloadFile) {
      await deleteBackendFileByName(s.payloadFile);
      delete s.payloadFile;
    }
    if (Object.prototype.hasOwnProperty.call(map, s.id)) {
      delete map[s.id];
    }
    s.mode = 'state';
    s.payloadBytes = 0;
    s.updatedAt = Date.now();
  }));
  writeAllSnapshotPayloads(map);
  saveStore(state.store);
  return targets.length;
}

export async function migrateLocalSnapshotsToBackend() {
  if (!hasTH('uploadTavernFile')) {
    throw new Error('当前酒馆助手版本不支持 uploadTavernFile 接口');
  }
  const map = readAllSnapshotPayloads();
  const ids = Object.keys(map);
  if (ids.length === 0) return { migrated: 0, orphansRemoved: 0 };

  const snapById = new Map((state.store.snapshots || []).map((s) => [s.id, s]));
  let migrated = 0;
  let orphansRemoved = 0;

  try {
    for (const id of ids) {
      const snap = snapById.get(id);
      if (!snap) {
        delete map[id];
        orphansRemoved++;
        continue;
      }
      const saved = await setSnapshotPayload(id, map[id], { prevFileName: snap.payloadFile });
      if (saved.fileName) {
        snap.payloadFile = saved.fileName;
        snap.payloadBytes = saved.bytes;
        delete map[id];
        migrated++;
      }
    }
  } finally {
    writeAllSnapshotPayloads(map);
    saveStore(state.store);
  }
  return { migrated, orphansRemoved };
}

const pendingBackendLogs = [];
let backendLogFlushTimer = null;
let backendLogTaskChain = Promise.resolve();

function getLocalDateStr(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function readBackendLogJson(candidates) {
  const cands = (candidates || []).map((c) => String(c || '').trim()).filter((v, i, a) => v && a.indexOf(v) === i);
  for (const raw of cands) {
    const base = normalizeBackendFileName(raw);
    if (hasTH('getTavernFile')) {
      for (const cand of [base, raw].filter((v, i, a) => v && a.indexOf(v) === i)) {
        try {
          const res = await callTH('getTavernFile', cand);
          if (res && res.ok) {
            const text = await res.text();
            if (text) return JSON.parse(text);
          }
        } catch (e) {}
      }
    }
    if (base && typeof fetch === 'function') {
      for (const url of [`/user/files/${encodeURIComponent(base)}`, `user/files/${encodeURIComponent(base)}`]) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (res && res.ok) {
            const text = await res.text();
            if (text) return JSON.parse(text);
          }
        } catch (e) {}
      }
    }
  }
  return null;
}

export function enqueueBackendLogPersist(entry) {
  if (!entry || (entry.level !== 'WARN' && entry.level !== 'ERR')) return;
  const date = entry.date || getLocalDateStr(entry.ts || Date.now());
  pendingBackendLogs.push(Object.assign({}, entry, { date }));
  if (backendLogFlushTimer) clearTimeout(backendLogFlushTimer);
  backendLogFlushTimer = setTimeout(() => {
    backendLogFlushTimer = null;
    flushBackendLogQueue();
  }, 300);
}

export function flushBackendLogQueue() {
  if (backendLogFlushTimer) {
    clearTimeout(backendLogFlushTimer);
    backendLogFlushTimer = null;
  }
  backendLogTaskChain = backendLogTaskChain.then(async () => {
    if (pendingBackendLogs.length === 0 || !hasTH('uploadTavernFile')) return;
    const batch = pendingBackendLogs.splice(0, pendingBackendLogs.length);
    const byDate = new Map();
    batch.forEach((item) => {
      const d = item.date || getLocalDateStr(item.ts || Date.now());
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(item);
    });

    for (const [date, items] of byDate.entries()) {
      try {
        const curMeta = state.store?.extensions?.backendLogDays?.[date] || null;
        const prevFile = curMeta?.fileName ? normalizeBackendFileName(curMeta.fileName) : '';
        const existingDoc = await readBackendLogJson([prevFile, `taverndeck_log_${date}.json`]);
        const existingLogs = Array.isArray(existingDoc?.logs) ? existingDoc.logs : [];
        const combined = [...existingLogs, ...items];
        if (combined.length > 2000) combined.splice(0, combined.length - 2000);

        const warnCount = combined.filter((x) => x.level === 'WARN').length;
        const errCount = combined.filter((x) => x.level === 'ERR').length;
        const updatedAt = Date.now();
        const doc = { app: 'TavernDeck', date, updatedAt, logs: combined };
        const jsonStr = JSON.stringify(doc, null, 2);
        const bytes = getUtf8ByteLength(jsonStr);
        const desiredName = prevFile
          ? `taverndeck_log_${date}_${Date.now().toString(36)}.json`
          : `taverndeck_log_${date}.json`;

        const actualName = await callTH('uploadTavernFile', desiredName, utf8ToBase64(jsonStr));
        const fileName = normalizeBackendFileName(actualName) || desiredName;
        if (prevFile && prevFile !== fileName) {
          await deleteBackendFileByName(prevFile, { silent: true });
        }

        state.store.extensions = state.store.extensions || {};
        state.store.extensions.backendLogDays = state.store.extensions.backendLogDays || {};
        state.store.extensions.backendLogDays[date] = {
          date,
          fileName,
          count: combined.length,
          warnCount,
          errCount,
          bytes,
          updatedAt,
        };
        saveStore(state.store, { silent: true });
      } catch (err) {
        if (pendingBackendLogs.length < 200) {
          pendingBackendLogs.push(...items.slice(0, 200 - pendingBackendLogs.length));
        }
        pushDevLog('WARN', `写入 ${date} 后端日志文件失败: ${err?.message || err}`, { skipPersist: true });
      }
    }
  }).catch((err) => {
    pushDevLog('WARN', `后端日志持久化队列异常: ${err?.message || err}`, { skipPersist: true });
  });
  return backendLogTaskChain;
}

export async function getBackendLogDayDetail(date) {
  await flushBackendLogQueue();
  const meta = state.store?.extensions?.backendLogDays?.[date] || null;
  const fileName = meta?.fileName ? normalizeBackendFileName(meta.fileName) : `taverndeck_log_${date}.json`;
  const doc = await readBackendLogJson([meta?.fileName, `taverndeck_log_${date}.json`]);
  if (!doc || !Array.isArray(doc.logs)) {
    return { date, fileName, logs: [], missing: true };
  }
  return { date, fileName, logs: doc.logs, missing: false };
}

export function deleteBackendLogDay(date) {
  for (let i = pendingBackendLogs.length - 1; i >= 0; i--) {
    if (pendingBackendLogs[i].date === date) pendingBackendLogs.splice(i, 1);
  }
  backendLogTaskChain = backendLogTaskChain.then(async () => {
    const map = state.store?.extensions?.backendLogDays;
    const meta = map?.[date] || null;
    const targetFile = meta?.fileName || `taverndeck_log_${date}.json`;
    await deleteBackendFileByName(targetFile, { strict: !!meta?.fileName, silent: true });
    if (map && Object.prototype.hasOwnProperty.call(map, date)) {
      delete map[date];
      if (Object.keys(map).length === 0) delete state.store.extensions.backendLogDays;
      saveStore(state.store, { silent: true });
    }
  });
  return backendLogTaskChain;
}

export function clearAllBackendLogDays() {
  pendingBackendLogs.length = 0;
  if (backendLogFlushTimer) {
    clearTimeout(backendLogFlushTimer);
    backendLogFlushTimer = null;
  }
  backendLogTaskChain = backendLogTaskChain.then(async () => {
    const map = state.store?.extensions?.backendLogDays;
    if (!map) return 0;
    const dates = Object.keys(map);
    for (const d of dates) {
      const f = map[d]?.fileName || `taverndeck_log_${d}.json`;
      await deleteBackendFileByName(f, { silent: true });
    }
    delete state.store.extensions.backendLogDays;
    saveStore(state.store, { silent: true });
    return dates.length;
  });
  return backendLogTaskChain;
}
