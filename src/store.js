import {
  STORAGE_KEY, SCHEMA_VERSION,
  hasTH, callTH, notify, genId, makeItemKey, cloneItemRef, logError,
} from './utils.js';

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
  selectPopup: null,
  confirmModal: null,
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
    return {
      schemaVersion: SCHEMA_VERSION,
      settings,
      schemes,
      presetBindings: raw.presetBindings && typeof raw.presetBindings === 'object' ? raw.presetBindings : {},
      activeSchemeByPreset: raw.activeSchemeByPreset && typeof raw.activeSchemeByPreset === 'object' ? raw.activeSchemeByPreset : {},
      activeSchemeId: raw.activeSchemeId || schemes[0].id,
      snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
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
    }
  } else {
    const newGroup = {
      id: genId(),
      name: data.name,
      mode: data.mode,
      collapsed: false,
      items: [],
      children: [],
      meta: {},
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
    payload.snapshots = JSON.parse(JSON.stringify(state.store.snapshots || []));
  }
  if (opts.includeAll) {
    payload.scope = 'all';
    payload.settings = JSON.parse(JSON.stringify(state.store.settings));
    payload.schemes = JSON.parse(JSON.stringify(ensureSchemesPool()));
    payload.presetBindings = JSON.parse(JSON.stringify(state.store.presetBindings || {}));
    payload.snapshots = JSON.parse(JSON.stringify(state.store.snapshots || []));
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
    if (mode === 'overwrite') {
      state.store.snapshots = JSON.parse(JSON.stringify(data.snapshots));
    } else {
      const existingIds = new Set((state.store.snapshots || []).map((s) => s.id));
      data.snapshots.forEach((snap) => {
        const copy = JSON.parse(JSON.stringify(snap));
        if (!copy.id || existingIds.has(copy.id)) copy.id = genId();
        existingIds.add(copy.id);
        state.store.snapshots.push(copy);
      });
    }
  }

  saveStore(state.store);
}
