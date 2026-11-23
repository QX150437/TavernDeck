import {
  STORAGE_KEY, SCHEMA_VERSION,
  hasTH, callTH, notify, genId, makeItemKey, cloneItemRef, logWarn, logError,
} from './utils.js';

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
    logWarn('写入本地快照载荷失败（可能超出浏览器存储配额，建议瘦身或清理旧快照）', e);
    notify('warning', '本地快照存储空间不足，建议删除或瘦身部分完整快照');
    return false;
  }
}

export function getSnapshotPayload(snapId) {
  if (!snapId) return null;
  const map = readAllSnapshotPayloads();
  return map[snapId] || null;
}

export function setSnapshotPayload(snapId, payload) {
  if (!snapId || !payload) return 0;
  const map = readAllSnapshotPayloads();
  const serialized = serializeRegExpDeep(payload);
  map[snapId] = reviveRegExpDeep(serialized);
  const bytes = JSON.stringify(serialized).length;
  writeAllSnapshotPayloads(map);
  return bytes;
}

export function deleteSnapshotPayload(snapId) {
  if (!snapId) return;
  const map = readAllSnapshotPayloads();
  if (Object.prototype.hasOwnProperty.call(map, snapId)) {
    delete map[snapId];
    writeAllSnapshotPayloads(map);
  }
}

export function getSnapshotPayloadSizeBytes(snap) {
  if (!snap) return 0;
  if (typeof snap.payloadBytes === 'number' && snap.payloadBytes > 0) return snap.payloadBytes;
  const p = getSnapshotPayload(snap.id);
  if (!p) return 0;
  try {
    const bytes = stringifyWithRegExp(p).length;
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
    const encodeSide = (list) => list.map((item) => {
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
        return mt ? { r: ref, d: item.data, mt } : { r: ref, d: item.data };
      }
      if (ref) {
        return mt ? { r: ref, d: item.data, mt } : { r: ref, d: item.data };
      }
      return mt ? { d: item.data, mt } : { d: item.data };
    });

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
      sourceList: encodeSide(session.sourceEntries),
      baseList: encodeSide(session.baseEntries),
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
    schemes: [{ id: defId, name: '默认方案', groups: [] }],
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
          if (snap.fullPresetData || snap.fullWorldbookData) {
            const payload = {};
            if (snap.fullPresetData) payload.fullPresetData = snap.fullPresetData;
            if (snap.fullWorldbookData) payload.fullWorldbookData = snap.fullWorldbookData;
            snap.payloadBytes = setSnapshotPayload(snap.id, payload);
            delete snap.fullPresetData;
            delete snap.fullWorldbookData;
          }
          return snap;
        })
      : [];
    return {
      schemaVersion: SCHEMA_VERSION,
      settings,
      schemes,
      presetBindings: raw.presetBindings && typeof raw.presetBindings === 'object' ? raw.presetBindings : {},
      activeSchemeByPreset: raw.activeSchemeByPreset && typeof raw.activeSchemeByPreset === 'object' ? raw.activeSchemeByPreset : {},
      activeSchemeId: raw.activeSchemeId || schemes[0].id,
      snapshots: normalizedSnapshots,
      extensions: raw.extensions && typeof raw.extensions === 'object' ? raw.extensions : {},
    };
  } catch (e) {
    logError('读取全局变量失败', e);
    return createDefaultStore();
  }
}

export function saveStore(store = state.store) {
  try {
    if (!hasTH('updateVariablesWith')) return;
    callTH('updateVariablesWith', (vars) => {
      const next = vars && typeof vars === 'object' ? vars : {};
      next[STORAGE_KEY] = JSON.parse(JSON.stringify(store));
      return next;
    }, { type: 'global' });
  } catch (e) {
    logError('保存全局变量失败', e);
    notify('error', '保存配置到全局变量失败');
  }
}

export function ensureSchemesPool() {
  if (!Array.isArray(state.store.schemes) || state.store.schemes.length === 0) {
    const defId = genId();
    state.store.schemes = [{ id: defId, name: '默认方案', groups: [] }];
    state.store.activeSchemeId = defId;
  }
  return state.store.schemes;
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
  const pKey = state.presetName || '__default__';
  if (data.id) {
    const s = pool.find((item) => item.id === data.id);
    if (s) s.name = data.name;
    saveStore(state.store);
    return;
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
    pool.push({ id: newId, name: data.name, groups: src ? cloneGroupsDeep(src.groups) : [] });
  } else {
    pool.push({ id: newId, name: data.name, groups: [] });
  }
  if (data.bindToCurrent) {
    const cur = getBoundSchemeIds(pKey);
    if (!cur.includes(newId)) cur.push(newId);
    state.store.presetBindings[pKey] = cur;
  }
  setActiveSchemeId(newId);
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
    }
  });
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

function hydrateSnapshotsForExport(snaps) {
  return (snaps || []).map((snap) => {
    const copy = JSON.parse(JSON.stringify(snap));
    const heavy = getSnapshotPayload(snap.id);
    if (heavy) {
      if (heavy.fullPresetData) copy.fullPresetData = serializeRegExpDeep(heavy.fullPresetData);
      if (heavy.fullWorldbookData) copy.fullWorldbookData = serializeRegExpDeep(heavy.fullWorldbookData);
    }
    return copy;
  });
}

export function exportStoreData(opts) {
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
    payload.snapshots = hydrateSnapshotsForExport(state.store.snapshots);
  }
  if (opts.includeAll) {
    payload.scope = 'all';
    payload.settings = JSON.parse(JSON.stringify(state.store.settings));
    payload.schemes = JSON.parse(JSON.stringify(ensureSchemesPool()));
    payload.presetBindings = JSON.parse(JSON.stringify(state.store.presetBindings || {}));
    payload.snapshots = hydrateSnapshotsForExport(state.store.snapshots);
  }
  return payload;
}

export function importStoreData(data, opts) {
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
    }));
    if (mode === 'overwrite') {
      if (incoming.length > 0) {
        state.store.schemes = incoming;
        state.store.activeSchemeId = incoming[0].id;
        state.store.activeSchemeByPreset = {};
        if (data.presetBindings && typeof data.presetBindings === 'object') {
          state.store.presetBindings = JSON.parse(JSON.stringify(data.presetBindings));
        }
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
        pool.push({ id: newId, name: s.name, groups: s.groups });
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
    }
  }

  if (opts.importSnapshots && Array.isArray(data.snapshots)) {
    const normalizeImportedSnap = (rawSnap, newId) => {
      const copy = JSON.parse(JSON.stringify(rawSnap));
      copy.id = newId;
      copy.kind = copy.kind === 'worldbook' ? 'worldbook' : 'preset';
      copy.targetName = copy.targetName || copy.presetName || '';
      copy.presetName = copy.targetName;
      copy.note = typeof copy.note === 'string' ? copy.note : '';
      copy.pinned = !!copy.pinned;
      copy.auto = !!copy.auto;
      if (copy.fullPresetData || copy.fullWorldbookData) {
        const heavy = {};
        if (copy.fullPresetData) heavy.fullPresetData = copy.fullPresetData;
        if (copy.fullWorldbookData) heavy.fullWorldbookData = reviveRegExpDeep(copy.fullWorldbookData);
        copy.payloadBytes = setSnapshotPayload(copy.id, heavy);
        delete copy.fullPresetData;
        delete copy.fullWorldbookData;
      }
      return copy;
    };

    if (mode === 'overwrite') {
      (state.store.snapshots || []).forEach((old) => deleteSnapshotPayload(old.id));
      state.store.snapshots = data.snapshots.filter(Boolean).map((s) => normalizeImportedSnap(s, s.id || genId()));
    } else {
      const existingIds = new Set((state.store.snapshots || []).map((s) => s.id));
      data.snapshots.filter(Boolean).forEach((snap) => {
        let newId = snap.id || genId();
        if (existingIds.has(newId)) newId = genId();
        existingIds.add(newId);
        state.store.snapshots.push(normalizeImportedSnap(snap, newId));
      });
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
  const mvuMap = storeObj.extensions?.mvuStarred || {};
  const mvuBytes = getUtf8ByteLength(JSON.stringify(mvuMap));

  const mvuItems = Object.keys(mvuMap).map((chatKey) => {
    const list = Array.isArray(mvuMap[chatKey]) ? mvuMap[chatKey] : [];
    return {
      chatKey,
      count: list.length,
      bytes: getUtf8ByteLength(JSON.stringify(list)),
    };
  }).sort((a, b) => b.bytes - a.bytes);

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

  const missingPayloadSnaps = snapList.filter((s) => s && s.mode === 'full' && !payloadMap[s.id]);

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
  const aiCacheEndpoints = Object.keys(aiCache).length;
  const aiCacheBytes = getUtf8ByteLength(JSON.stringify(aiCache));

  const autoUnpinnedCount = snapList.filter((s) => s && s.auto && !s.pinned).length;
  const fullUnpinnedCount = snapList.filter((s) => s && s.mode === 'full' && !s.pinned && !!payloadMap[s.id]).length;

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
      devLogCount,
      aiCacheEndpoints,
      aiCacheBytes,
    },
    quickCounts: {
      autoUnpinnedCount,
      fullUnpinnedCount,
      orphanCount: orphanPayloadIds.length,
      missingPayloadCount: missingPayloadSnaps.length,
    },
    grandTotalBytes: globalTotalBytes + payloadsTotalBytes + draftsTotalBytes,
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
    if (s && s.mode === 'full' && !map[s.id]) {
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

export function cleanAutoBackupSnapshots() {
  const list = state.store.snapshots || [];
  const kept = [];
  let removed = 0;
  list.forEach((s) => {
    if (s && s.auto && !s.pinned) {
      deleteSnapshotPayload(s.id);
      if (state.lastUndoSnapshotId === s.id) state.lastUndoSnapshotId = null;
      removed++;
    } else if (s) {
      kept.push(s);
    }
  });
  if (removed > 0) {
    state.store.snapshots = kept;
    saveStore(state.store);
  }
  return removed;
}

export function slimAllUnpinnedFullSnapshots() {
  const map = readAllSnapshotPayloads();
  let slimmed = 0;
  (state.store.snapshots || []).forEach((s) => {
    if (s && s.mode === 'full' && !s.pinned) {
      if (Object.prototype.hasOwnProperty.call(map, s.id)) {
        delete map[s.id];
      }
      s.mode = 'state';
      s.payloadBytes = 0;
      s.updatedAt = Date.now();
      slimmed++;
    }
  });
  if (slimmed > 0) {
    writeAllSnapshotPayloads(map);
    saveStore(state.store);
  }
  return slimmed;
}
