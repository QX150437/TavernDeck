import {
  SCOPE_LABELS,
  getST, hasTH, callTH, notify, makeItemKey, logInfo, logWarn, logError,
} from './utils.js';
import { recordOpStep } from './dev-tools.js';
import { state, saveStore, getActiveScheme, getSchemeSources, findGroupPath } from './store.js';

let mutationQueue = Promise.resolve();
let pendingMutationOps = 0;

function collectWorldbooksFromGroups(groups, set) {
  if (!Array.isArray(groups)) return;
  groups.forEach((g) => {
    (g.items || []).forEach((it) => {
      if (it && it.type === 'worldbook' && it.book) set.add(it.book);
    });
    if (Array.isArray(g.children)) collectWorldbooksFromGroups(g.children, set);
  });
}

function flattenScripts(trees, scope, folderPath, out) {
  if (!Array.isArray(trees)) return;
  trees.forEach((node) => {
    if (!node) return;
    if (node.type === 'folder') {
      const nextPath = folderPath ? `${folderPath} / ${node.name || '文件夹'}` : (node.name || '文件夹');
      flattenScripts(node.scripts, scope, nextPath, out);
    } else if (node.type === 'script') {
      const ref = { type: 'script', scope, id: node.id };
      out.push({
        key: makeItemKey(ref),
        ref,
        type: 'script',
        scope,
        scopeTitle: `${SCOPE_LABELS[scope]}脚本`,
        folder: folderPath || '',
        name: node.name || node.id,
        enabled: !!node.enabled,
        raw: node,
      });
    }
  });
}

function updateScriptInTrees(trees, targetId, updater) {
  if (!Array.isArray(trees)) return false;
  let changed = false;
  for (let i = 0; i < trees.length; i++) {
    const node = trees[i];
    if (!node) continue;
    if (node.type === 'folder') {
      if (updateScriptInTrees(node.scripts, targetId, updater)) changed = true;
    } else if (node.type === 'script' && node.id === targetId) {
      updater(node);
      changed = true;
    }
  }
  return changed;
}

export function rebuildCatalogIndex() {
  const byKey = new Map();
  state.catalog.preset.forEach((item) => {
    byKey.set(item.key, item);
    if (item.legacyKey && item.legacyKey !== item.key) {
      byKey.set(item.legacyKey, item);
    }
  });
  state.catalog.worldbook.groups.forEach((g) => {
    g.items.forEach((item) => byKey.set(item.key, item));
  });
  state.catalog.script.forEach((g) => {
    g.items.forEach((item) => byKey.set(item.key, item));
  });
  state.catalog.regex.forEach((g) => {
    g.items.forEach((item) => byKey.set(item.key, item));
  });
  state.catalog.byKey = byKey;
}

function buildPresetCatalogItems(prompts) {
  const curPreset = state.presetName && state.presetName !== 'in_use' ? state.presetName : '';
  return (prompts || []).map((p) => {
    const ref = {
      type: 'preset',
      ...(curPreset ? { preset: curPreset } : {}),
      id: p.id,
      name: p.name || p.id,
    };
    return {
      key: makeItemKey(ref),
      legacyKey: `preset::${p.id}`,
      ref,
      type: 'preset',
      preset: curPreset,
      name: p.name || p.id,
      enabled: !!p.enabled,
      raw: p,
    };
  });
}

function syncPresetCatalogFromPrompts(prompts) {
  state.catalog.preset = buildPresetCatalogItems(prompts);
  rebuildCatalogIndex();
}

export function refreshSyncSources() {
  try {
    state.presetName = hasTH('getLoadedPresetName') ? (callTH('getLoadedPresetName') || '当前预设') : '当前预设';
  } catch (e) {
    logWarn('获取当前预设名称失败', e);
    state.presetName = state.presetName || '当前预设';
  }

  try {
    const rawNames = hasTH('getPresetNames') ? (callTH('getPresetNames') || []) : [];
    state.presetNames = rawNames.filter((n) => n && n !== 'in_use');
  } catch (e) {
    logWarn('获取预设列表失败', e);
    state.presetNames = [];
  }

  try {
    state.hasCharacter = hasTH('getCurrentCharacterName') ? !!callTH('getCurrentCharacterName') : false;
  } catch (e) {
    logWarn('检测当前角色卡状态失败', e);
    state.hasCharacter = false;
  }

  let currentPresetObj = null;
  try {
    if (hasTH('getPreset')) {
      currentPresetObj = callTH('getPreset', 'in_use');
    }
    const prompts = currentPresetObj && Array.isArray(currentPresetObj.prompts) ? currentPresetObj.prompts : [];
    state.catalog.preset = buildPresetCatalogItems(prompts);
  } catch (e) {
    logWarn('读取当前预设条目失败', e);
    state.catalog.preset = [];
  }

  const scriptGroups = [];
  if (hasTH('getScriptTrees')) {
    const scopes = state.hasCharacter ? ['global', 'preset', 'character'] : ['global', 'preset'];
    scopes.forEach((scope) => {
      try {
        const trees = callTH('getScriptTrees', { type: scope }) || [];
        const items = [];
        flattenScripts(trees, scope, '', items);
        scriptGroups.push({ scopeKey: `script-${scope}`, title: `${SCOPE_LABELS[scope]}脚本`, items });
      } catch (e) {
        logWarn(`读取 ${scope} 脚本失败`, e);
      }
    });
  } else if (currentPresetObj && currentPresetObj.extensions && currentPresetObj.extensions.tavern_helper) {
    const trees = currentPresetObj.extensions.tavern_helper.scripts || [];
    const items = [];
    flattenScripts(trees, 'preset', '', items);
    scriptGroups.push({ scopeKey: 'script-preset', title: '预设脚本', items });
  }
  state.catalog.script = scriptGroups;

  const regexGroups = [];
  if (hasTH('getTavernRegexes')) {
    const regexOpts = [
      { scope: 'global', title: '全局正则', opt: { type: 'global' } },
      { scope: 'preset', title: `预设正则 (${state.presetName})`, opt: { type: 'preset', name: 'in_use' } },
    ];
    if (state.hasCharacter) {
      regexOpts.push({ scope: 'character', title: '角色卡局部正则', opt: { type: 'character', name: 'current' } });
    }
    regexOpts.forEach((cfg) => {
      try {
        const list = callTH('getTavernRegexes', cfg.opt) || [];
        const items = list.map((r) => {
          const ref = { type: 'regex', scope: cfg.scope, id: r.id };
          return {
            key: makeItemKey(ref),
            ref,
            type: 'regex',
            scope: cfg.scope,
            scopeTitle: cfg.title,
            name: r.script_name || r.id,
            enabled: !!r.enabled,
            raw: r,
          };
        });
        regexGroups.push({ scopeKey: `regex-${cfg.scope}`, title: cfg.title, items });
      } catch (e) {
        logWarn(`读取 ${cfg.title} 失败`, e);
      }
    });
  }
  state.catalog.regex = regexGroups;
  rebuildCatalogIndex();
}

async function refreshCharacterScriptsFallback() {
  if (hasTH('getScriptTrees') || !state.hasCharacter || !hasTH('getCharacter')) return;
  try {
    const charObj = await callTH('getCharacter', 'current');
    const trees = (charObj && charObj.extensions && charObj.extensions.tavern_helper && charObj.extensions.tavern_helper.scripts) || [];
    const items = [];
    flattenScripts(trees, 'character', '', items);
    const others = state.catalog.script.filter((g) => g.scopeKey !== 'script-character');
    others.push({ scopeKey: 'script-character', title: '角色卡脚本', items });
    state.catalog.script = others;
    rebuildCatalogIndex();
  } catch (e) {
    logWarn('回退读取角色卡脚本失败', e);
  }
}

function getNeededExtraBooksFromStore() {
  const set = new Set(Object.keys(state.extraLoadedBooks));
  try {
    collectWorldbooksFromGroups(getActiveScheme().groups, set);
  } catch (e) {
    logWarn('扫描方案引用世界书失败', e);
  }
  return set;
}

export async function refreshWorldbookCatalog(includeAllBooks = false) {
  if (state.loadingWorldbooks) return;
  state.loadingWorldbooks = true;
  try {
    const allBooks = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
    const globalSet = new Set(hasTH('getGlobalWorldbookNames') ? (callTH('getGlobalWorldbookNames') || []) : []);
    let charPrimary = null;
    const charAddSet = new Set();
    if (state.hasCharacter && hasTH('getCharWorldbookNames')) {
      try {
        const cw = callTH('getCharWorldbookNames', 'current');
        if (cw) {
          charPrimary = cw.primary || null;
          (cw.additional || []).forEach((n) => charAddSet.add(n));
        }
      } catch (e) {
        logWarn('读取角色卡绑定世界书失败', e);
      }
    }

    const st = getST();
    const hasActiveChat = !!(st?.getCurrentChatId?.() || st?.chatId);
    let chatBook = null;
    if (hasActiveChat && hasTH('getChatWorldbookName')) {
      try {
        chatBook = callTH('getChatWorldbookName', 'current');
      } catch (e) {
        logWarn('读取聊天绑定世界书失败', e);
      }
    }

    const neededExtra = getNeededExtraBooksFromStore();
    const bookMetaList = [];
    const seen = new Set();
    const pushBook = (name, scopeLabel, bound) => {
      if (!name || seen.has(name)) return;
      seen.add(name);
      const tags = [];
      if (globalSet.has(name)) tags.push('全局世界书');
      if (charPrimary === name) tags.push('角色卡主世界书');
      if (charAddSet.has(name)) tags.push('角色卡附加世界书');
      if (chatBook === name) tags.push('聊天世界书');
      if (tags.length === 0) tags.push(scopeLabel || '未绑定世界书');
      bookMetaList.push({ name, bound, title: `${tags.join(' / ')} · ${name}` });
    };

    allBooks.forEach((n) => { if (globalSet.has(n)) pushBook(n, '全局世界书', true); });
    if (charPrimary) pushBook(charPrimary, '角色卡主世界书', true);
    charAddSet.forEach((n) => pushBook(n, '角色卡附加世界书', true));
    if (chatBook) pushBook(chatBook, '聊天世界书', true);
    allBooks.forEach((n) => {
      if (!seen.has(n) && (includeAllBooks || neededExtra.has(n))) {
        if (includeAllBooks) state.extraLoadedBooks[n] = true;
        pushBook(n, '其他世界书', false);
      }
    });

    const unloadedBooks = allBooks.filter((n) => !seen.has(n));
    const groups = [];
    if (hasTH('getWorldbook')) {
      await Promise.all(bookMetaList.map(async (meta) => {
        try {
          const entries = await callTH('getWorldbook', meta.name);
          const items = (entries || []).map((entry) => {
            const ref = { type: 'worldbook', book: meta.name, uid: entry.uid };
            return {
              key: makeItemKey(ref),
              ref,
              type: 'worldbook',
              book: meta.name,
              uid: entry.uid,
              scopeTitle: meta.title,
              name: entry.name || `条目 #${entry.uid}`,
              enabled: !!entry.enabled,
              raw: entry,
            };
          });
          groups.push({ scopeKey: `wb-${meta.name}`, bookName: meta.name, title: meta.title, items });
        } catch (e) {
          logWarn(`加载世界书「${meta.name}」条目失败`, e);
        }
      }));
    }

    const orderMap = new Map();
    bookMetaList.forEach((m, idx) => orderMap.set(m.name, idx));
    groups.sort((a, b) => (orderMap.get(a.bookName) || 0) - (orderMap.get(b.bookName) || 0));
    state.catalog.worldbook = { groups, unloadedBooks };
    rebuildCatalogIndex();
  } finally {
    state.loadingWorldbooks = false;
  }
}

export async function refreshAllCatalogs() {
  refreshSyncSources();
  await Promise.all([
    refreshWorldbookCatalog(false),
    refreshCharacterScriptsFallback(),
  ]);
}

async function mutateScriptsByScope(scope, idMap, fieldUpdater) {
  if (hasTH('updateScriptTreesWith')) {
    await Promise.resolve(callTH('updateScriptTreesWith', (trees) => {
      idMap.forEach((val, id) => {
        updateScriptInTrees(trees, id, (node) => fieldUpdater(node, val));
      });
      return trees;
    }, { type: scope }));
    return;
  }
  if (scope === 'preset' && hasTH('updatePresetWith')) {
    await callTH('updatePresetWith', 'in_use', (preset) => {
      const trees = preset?.extensions?.tavern_helper?.scripts;
      if (Array.isArray(trees)) {
        idMap.forEach((val, id) => {
          updateScriptInTrees(trees, id, (node) => fieldUpdater(node, val));
        });
      }
      return preset;
    }, { render: 'debounced' });
  } else if (scope === 'character' && hasTH('updateCharacterWith')) {
    await callTH('updateCharacterWith', 'current', (ch) => {
      const trees = ch?.extensions?.tavern_helper?.scripts;
      if (Array.isArray(trees)) {
        idMap.forEach((val, id) => {
          updateScriptInTrees(trees, id, (node) => fieldUpdater(node, val));
        });
      }
      return ch;
    });
  }
}

export function applyItemMutations(mutations) {
  if (!mutations || mutations.length === 0) return Promise.resolve(false);

  const presetMut = new Map();
  const wbMut = new Map();
  const scriptMut = new Map();
  const regexMut = new Map();
  const rollbacks = [];
  let changedCount = 0;

  mutations.forEach((m) => {
    const ref = m.ref;
    const key = makeItemKey(ref);
    const existing = state.catalog.byKey.get(key);
    const nextEnabled = !!m.enabled;
    if (existing && existing.enabled === nextEnabled) return;

    changedCount++;
    if (existing) {
      rollbacks.push({ item: existing, prevEnabled: existing.enabled });
      existing.enabled = nextEnabled;
      if (existing.raw && typeof existing.raw === 'object') {
        existing.raw.enabled = nextEnabled;
      }
    }

    if (ref.type === 'preset') {
      presetMut.set(ref.id, nextEnabled);
    } else if (ref.type === 'worldbook') {
      if (!wbMut.has(ref.book)) wbMut.set(ref.book, new Map());
      wbMut.get(ref.book).set(ref.uid, nextEnabled);
    } else if (ref.type === 'script') {
      if (!scriptMut.has(ref.scope)) scriptMut.set(ref.scope, new Map());
      scriptMut.get(ref.scope).set(ref.id, nextEnabled);
    } else if (ref.type === 'regex') {
      if (!regexMut.has(ref.scope)) regexMut.set(ref.scope, new Map());
      regexMut.get(ref.scope).set(ref.id, nextEnabled);
    }
  });

  if (presetMut.size === 0 && wbMut.size === 0 && scriptMut.size === 0 && regexMut.size === 0) {
    return Promise.resolve(true);
  }

  recordOpStep('提交条目开关队列', `变更 ${changedCount} 项`);
  pendingMutationOps++;

  const task = mutationQueue.then(async () => {
    try {
      let latestPreset = null;
      if (presetMut.size > 0 && hasTH('updatePresetWith')) {
        latestPreset = await callTH('updatePresetWith', 'in_use', (preset) => {
          if (preset && Array.isArray(preset.prompts)) {
            preset.prompts.forEach((p) => {
              if (presetMut.has(p.id)) p.enabled = presetMut.get(p.id);
            });
          }
          return preset;
        }, { render: 'debounced' });
      }

      for (const [bookName, uidMap] of wbMut.entries()) {
        if (hasTH('updateWorldbookWith')) {
          await callTH('updateWorldbookWith', bookName, (entries) =>
            (entries || []).map((e) => {
              if (uidMap.has(e.uid)) e.enabled = uidMap.get(e.uid);
              return e;
            }),
          );
        }
      }

      for (const [scope, idMap] of scriptMut.entries()) {
        await mutateScriptsByScope(scope, idMap, (node, val) => {
          node.enabled = val;
        });
      }

      for (const [scope, idMap] of regexMut.entries()) {
        if (hasTH('updateTavernRegexesWith')) {
          const opt = scope === 'global'
            ? { type: 'global' }
            : (scope === 'preset' ? { type: 'preset', name: 'in_use' } : { type: 'character', name: 'current' });
          await callTH('updateTavernRegexesWith', (regexes) => {
            (regexes || []).forEach((r) => {
              if (idMap.has(r.id)) r.enabled = idMap.get(r.id);
            });
            return regexes;
          }, opt);
        }
      }

      if (changedCount > 1) {
        logInfo(`批量更新 ${changedCount} 个条目开关状态完成`);
      }

      pendingMutationOps--;
      if (pendingMutationOps === 0) {
        if (latestPreset && Array.isArray(latestPreset.prompts) && wbMut.size === 0 && scriptMut.size === 0 && regexMut.size === 0) {
          syncPresetCatalogFromPrompts(latestPreset.prompts);
        } else {
          if (wbMut.size > 0) await refreshWorldbookCatalog(false);
          if (presetMut.size > 0 || scriptMut.size > 0 || regexMut.size > 0) refreshSyncSources();
        }
      }
      return true;
    } catch (e) {
      pendingMutationOps = Math.max(0, pendingMutationOps - 1);
      rollbacks.forEach((rb) => {
        rb.item.enabled = rb.prevEnabled;
        if (rb.item.raw && typeof rb.item.raw === 'object') {
          rb.item.raw.enabled = rb.prevEnabled;
        }
      });
      logError('批量应用开关失败', e);
      notify('error', `操作失败: ${e && e.message ? e.message : e}`);
      return false;
    }
  });

  mutationQueue = task.catch((err) => {
    logError('状态队列执行异常', err);
    return false;
  });
  return task;
}

export function resolveGroupItemStatus(ref, scheme = getActiveScheme()) {
  const k = ref?.key || makeItemKey(ref);
  const directItem = state.catalog.byKey.get(k) || null;
  if (!ref || ref.type !== 'preset') {
    return {
      key: k,
      entry: directItem,
      blockedReason: '',
      blockedBadge: '',
    };
  }

  const curPreset = state.presetName || '';
  const sources = getSchemeSources(scheme);

  if (sources.length > 0) {
    if (curPreset && sources.includes(curPreset)) {
      const entry = directItem || state.catalog.byKey.get(`preset::${ref.id}`) || null;
      return {
        key: k,
        entry,
        blockedReason: '',
        blockedBadge: '',
      };
    }
    return {
      key: k,
      entry: null,
      blockedReason: `该方案的来源为「${sources.join('、')}」，未绑定当前预设「${curPreset || '未知'}」`,
      blockedBadge: `源:${sources.length > 1 ? `${sources[0]}+${sources.length - 1}` : sources[0]}`,
    };
  }

  if (ref.preset && curPreset && ref.preset !== curPreset) {
    return {
      key: k,
      entry: null,
      blockedReason: `该条目属于预设「${ref.preset}」，当前方案未绑定来源且当前预设「${curPreset}」不可控制`,
      blockedBadge: `预设:${ref.preset}`,
    };
  }

  const entry = directItem || (!ref.preset ? state.catalog.byKey.get(`preset::${ref.id}`) : null) || null;
  return {
    key: k,
    entry,
    blockedReason: '',
    blockedBadge: '',
  };
}

function collectSubtreeDisableMutations(node, mutationMap, activeScheme = getActiveScheme()) {
  if (!node) return false;
  let storeChanged = false;
  const validRows = (node.items || [])
    .map((ref) => {
      const st = resolveGroupItemStatus(ref, activeScheme);
      return st.entry ? { refKey: st.key, entry: st.entry } : null;
    })
    .filter(Boolean);

  if (node.mode === 'multi' && node.meta?.memoryToggle) {
    const activeKeys = validRows.filter((r) => !!r.entry.enabled).map((r) => r.refKey);
    if (activeKeys.length > 0) {
      node.meta = node.meta || {};
      node.meta.lastActiveKeys = activeKeys;
      storeChanged = true;
    }
  }

  validRows.forEach((r) => {
    if (!mutationMap.has(r.entry.key)) {
      mutationMap.set(r.entry.key, { ref: r.entry.ref, enabled: false });
    }
  });

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => {
      if (collectSubtreeDisableMutations(child, mutationMap, activeScheme)) storeChanged = true;
    });
  }
  return storeChanged;
}

function collectExclusiveSiblingDisableMutations(path, mutationMap, activeScheme = getActiveScheme()) {
  if (!Array.isArray(path) || path.length < 2) return false;
  let storeChanged = false;
  for (let i = path.length - 2; i >= 0; i--) {
    const parent = path[i];
    const activeChild = path[i + 1];
    if (!parent?.meta?.exclusiveChildren) continue;
    (parent.children || []).forEach((sibling) => {
      if (sibling && sibling.id !== activeChild.id) {
        if (collectSubtreeDisableMutations(sibling, mutationMap, activeScheme)) storeChanged = true;
      }
    });
  }
  return storeChanged;
}

export function toggleEntryInGroup(groupId, itemKey) {
  const activeScheme = getActiveScheme();
  const path = findGroupPath(activeScheme.groups, groupId);
  if (!path) return Promise.resolve(false);
  const group = path[path.length - 1];
  const refInGroup = (group.items || []).find((it) => (it.key || makeItemKey(it)) === itemKey);
  const resolved = resolveGroupItemStatus(refInGroup || { key: itemKey }, activeScheme);
  if (resolved.blockedReason) {
    notify('warning', resolved.blockedReason);
    return Promise.resolve(false);
  }
  const targetItem = resolved.entry;
  if (!targetItem) {
    notify('warning', '该条目当前未加载或已不存在');
    return Promise.resolve(false);
  }
  const nextEnabled = !targetItem.enabled;
  const mutationMap = new Map();
  if (nextEnabled && collectExclusiveSiblingDisableMutations(path, mutationMap, activeScheme)) {
    saveStore(state.store);
  }
  if (group.mode === 'single') {
    (group.items || []).forEach((ref) => {
      const st = resolveGroupItemStatus(ref, activeScheme);
      if (!st.entry) return;
      mutationMap.set(st.entry.key, { ref: st.entry.ref, enabled: st.key === itemKey ? nextEnabled : false });
    });
  } else {
    mutationMap.set(targetItem.key, { ref: targetItem.ref, enabled: nextEnabled });
  }
  return applyItemMutations(Array.from(mutationMap.values()));
}

export function toggleMultiGroupAll(groupId) {
  const activeScheme = getActiveScheme();
  const path = findGroupPath(activeScheme.groups, groupId);
  if (!path) return Promise.resolve(false);
  const group = path[path.length - 1];
  if (group.mode !== 'multi') return Promise.resolve(false);
  const validRows = (group.items || [])
    .map((ref) => {
      const st = resolveGroupItemStatus(ref, activeScheme);
      return st.entry ? { refKey: st.key, entry: st.entry } : null;
    })
    .filter(Boolean);
  if (validRows.length === 0) {
    notify('info', '该分组暂无可直接控制的条目');
    return Promise.resolve(false);
  }

  const isMemory = !!group.meta?.memoryToggle;
  const activeRows = validRows.filter((r) => !!r.entry.enabled);
  const targetState = isMemory ? activeRows.length === 0 : !validRows.every((r) => !!r.entry.enabled);

  const mutationMap = new Map();
  let storeChanged = false;

  if (targetState) {
    if (collectExclusiveSiblingDisableMutations(path, mutationMap, activeScheme)) {
      storeChanged = true;
    }
    const savedSet = isMemory && Array.isArray(group.meta?.lastActiveKeys)
      ? new Set(group.meta.lastActiveKeys)
      : null;
    const hasValidSaved = !!savedSet && validRows.some((r) => savedSet.has(r.refKey) || savedSet.has(r.entry.key));
    validRows.forEach((r) => {
      mutationMap.set(r.entry.key, {
        ref: r.entry.ref,
        enabled: hasValidSaved ? (savedSet.has(r.refKey) || savedSet.has(r.entry.key)) : true,
      });
    });
  } else {
    if (isMemory && activeRows.length > 0) {
      group.meta = group.meta || {};
      group.meta.lastActiveKeys = activeRows.map((r) => r.refKey);
      storeChanged = true;
    }
    validRows.forEach((r) => {
      mutationMap.set(r.entry.key, { ref: r.entry.ref, enabled: false });
    });
  }

  if (storeChanged) saveStore(state.store);
  return applyItemMutations(Array.from(mutationMap.values()));
}

export async function saveEditedEntry(itemKey, fields) {
  const item = state.catalog.byKey.get(itemKey);
  if (!item || state.isBusy) return false;
  recordOpStep('持久化保存条目编辑', fields?.name || item.name);
  state.isBusy = true;
  try {
    const ref = item.ref;
    if (ref.type === 'preset') {
      const applyPresetEdit = (preset) => {
        if (preset && Array.isArray(preset.prompts)) {
          const target = preset.prompts.find((p) => p.id === ref.id);
          if (target) {
            if (typeof fields.name === 'string') target.name = fields.name;
            if (typeof fields.content === 'string' && (typeof target.content === 'string' || fields.allowContent)) {
              target.content = fields.content;
            }
          }
        }
        return preset;
      };
      await callTH('updatePresetWith', 'in_use', applyPresetEdit, { render: 'debounced' });
      try {
        const loadedName = callTH('getLoadedPresetName');
        if (loadedName && loadedName !== 'in_use') {
          await callTH('updatePresetWith', loadedName, applyPresetEdit);
        }
      } catch (err) {
        logWarn('同步更新已保存预设文件失败', err);
      }
    } else if (ref.type === 'worldbook') {
      await callTH('updateWorldbookWith', ref.book, (entries) =>
        (entries || []).map((e) => {
          if (e.uid === ref.uid) {
            if (typeof fields.name === 'string') e.name = fields.name;
            if (typeof fields.content === 'string') e.content = fields.content;
          }
          return e;
        }),
      );
    } else if (ref.type === 'script') {
      const idMap = new Map([[ref.id, fields]]);
      await mutateScriptsByScope(ref.scope, idMap, (node, f) => {
        if (typeof f.name === 'string') node.name = f.name;
        if (typeof f.content === 'string') node.content = f.content;
      });
    } else if (ref.type === 'regex') {
      const opt = ref.scope === 'global'
        ? { type: 'global' }
        : (ref.scope === 'preset' ? { type: 'preset', name: 'in_use' } : { type: 'character', name: 'current' });
      await callTH('updateTavernRegexesWith', (regexes) => {
        (regexes || []).forEach((r) => {
          if (r.id === ref.id) {
            if (typeof fields.name === 'string') r.script_name = fields.name;
            if (typeof fields.find_regex === 'string') r.find_regex = fields.find_regex;
            if (typeof fields.replace_string === 'string') r.replace_string = fields.replace_string;
          }
        });
        return regexes;
      }, opt);
    }

    await refreshAllCatalogs();
    notify('success', `已保存并持久化「${fields.name || item.name}」`);
    return true;
  } catch (e) {
    logError('保存条目失败', e);
    notify('error', `保存失败: ${e && e.message ? e.message : e}`);
    return false;
  } finally {
    state.isBusy = false;
  }
}
