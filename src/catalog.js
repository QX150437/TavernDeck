
import {
  APP_NAME, SCOPE_LABELS,
  hasTH, callTH, notify, makeItemKey,
} from './utils.js';
import { state, getActiveScheme, findGroupNode } from './store.js';

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
  state.catalog.preset.forEach((item) => byKey.set(item.key, item));
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

export function refreshSyncSources() {
  try {
    state.presetName = hasTH('getLoadedPresetName') ? (callTH('getLoadedPresetName') || '当前预设') : '当前预设';
  } catch (e) {
    state.presetName = state.presetName || '当前预设';
  }

  try {
    state.presetNames = hasTH('getPresetNames') ? (callTH('getPresetNames') || []) : [];
  } catch (e) {
    state.presetNames = [];
  }

  try {
    state.hasCharacter = hasTH('getCurrentCharacterName') ? !!callTH('getCurrentCharacterName') : false;
  } catch (e) {
    state.hasCharacter = false;
  }

  let currentPresetObj = null;
  try {
    if (hasTH('getPreset')) {
      currentPresetObj = callTH('getPreset', 'in_use');
    }
    const prompts = currentPresetObj && Array.isArray(currentPresetObj.prompts) ? currentPresetObj.prompts : [];
    state.catalog.preset = prompts.map((p) => {
      const ref = { type: 'preset', id: p.id };
      return {
        key: makeItemKey(ref),
        ref,
        type: 'preset',
        name: p.name || p.id,
        enabled: !!p.enabled,
        raw: p,
      };
    });
  } catch (e) {
    state.catalog.preset = [];
  }

  // 脚本扫描（优先使用 getScriptTrees，若无则回退读取预设脚本）
  const scriptGroups = [];
  if (hasTH('getScriptTrees')) {
    const scopes = state.hasCharacter ? ['global', 'preset', 'character'] : ['global', 'preset'];
    scopes.forEach((scope) => {
      try {
        const trees = callTH('getScriptTrees', { type: scope }) || [];
        const items = [];
        flattenScripts(trees, scope, '', items);
        scriptGroups.push({ scopeKey: `script-${scope}`, title: `${SCOPE_LABELS[scope]}脚本`, items });
      } catch (e) {}
    });
  } else if (currentPresetObj && currentPresetObj.extensions && currentPresetObj.extensions.tavern_helper) {
    const trees = currentPresetObj.extensions.tavern_helper.scripts || [];
    const items = [];
    flattenScripts(trees, 'preset', '', items);
    scriptGroups.push({ scopeKey: 'script-preset', title: '预设脚本', items });
  }
  state.catalog.script = scriptGroups;

  // 正则扫描
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
      } catch (e) {}
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
  } catch (e) {}
}

function getNeededExtraBooksFromStore() {
  const set = new Set(Object.keys(state.extraLoadedBooks));
  try {
    collectWorldbooksFromGroups(getActiveScheme().groups, set);
  } catch (e) {}
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
      } catch (e) {}
    }
    let chatBook = null;
    if (hasTH('getChatWorldbookName')) {
      try {
        chatBook = callTH('getChatWorldbookName', 'current');
      } catch (e) {}
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
        } catch (e) {}
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
    }, { render: 'immediate' });
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

export async function applyItemMutations(mutations) {
  if (state.isBusy || !mutations || mutations.length === 0) return false;
  state.isBusy = true;
  try {
    const presetMut = new Map();
    const wbMut = new Map();
    const scriptMut = new Map();
    const regexMut = new Map();

    mutations.forEach((m) => {
      const ref = m.ref;
      const existing = state.catalog.byKey.get(makeItemKey(ref));
      if (existing && existing.enabled === !!m.enabled) return;
      if (ref.type === 'preset') {
        presetMut.set(ref.id, !!m.enabled);
      } else if (ref.type === 'worldbook') {
        if (!wbMut.has(ref.book)) wbMut.set(ref.book, new Map());
        wbMut.get(ref.book).set(ref.uid, !!m.enabled);
      } else if (ref.type === 'script') {
        if (!scriptMut.has(ref.scope)) scriptMut.set(ref.scope, new Map());
        scriptMut.get(ref.scope).set(ref.id, !!m.enabled);
      } else if (ref.type === 'regex') {
        if (!regexMut.has(ref.scope)) regexMut.set(ref.scope, new Map());
        regexMut.get(ref.scope).set(ref.id, !!m.enabled);
      }
    });

    if (presetMut.size > 0 && hasTH('updatePresetWith')) {
      await callTH('updatePresetWith', 'in_use', (preset) => {
        if (preset && Array.isArray(preset.prompts)) {
          preset.prompts.forEach((p) => {
            if (presetMut.has(p.id)) p.enabled = presetMut.get(p.id);
          });
        }
        return preset;
      }, { render: 'immediate' });
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

    await refreshAllCatalogs();
    return true;
  } catch (e) {
    console.error(`[${APP_NAME}] 批量应用开关失败:`, e);
    notify('error', `操作失败: ${e && e.message ? e.message : e}`);
    return false;
  } finally {
    state.isBusy = false;
  }
}

export async function toggleEntryInGroup(groupId, itemKey) {
  const found = findGroupNode(getActiveScheme().groups, groupId);
  if (!found) return false;
  const targetItem = state.catalog.byKey.get(itemKey);
  if (!targetItem) {
    notify('warning', '该条目当前未加载或已不存在');
    return false;
  }
  const nextEnabled = !targetItem.enabled;
  const mutations = [];
  if (found.group.mode === 'single') {
    (found.group.items || []).forEach((ref) => {
      const k = ref.key || makeItemKey(ref);
      mutations.push({ ref, enabled: k === itemKey ? nextEnabled : false });
    });
  } else {
    mutations.push({ ref: targetItem.ref, enabled: nextEnabled });
  }
  return applyItemMutations(mutations);
}

export async function toggleMultiGroupAll(groupId) {
  const found = findGroupNode(getActiveScheme().groups, groupId);
  if (!found || found.group.mode !== 'multi') return false;
  const validItems = (found.group.items || [])
    .map((ref) => state.catalog.byKey.get(ref.key || makeItemKey(ref)))
    .filter(Boolean);
  if (validItems.length === 0) {
    notify('info', '该分组暂无可直接控制的条目');
    return false;
  }
  const targetState = !validItems.every((it) => !!it.enabled);
  return applyItemMutations(validItems.map((it) => ({ ref: it.ref, enabled: targetState })));
}

export async function saveEditedEntry(itemKey, fields) {
  const item = state.catalog.byKey.get(itemKey);
  if (!item || state.isBusy) return false;
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
      await callTH('updatePresetWith', 'in_use', applyPresetEdit, { render: 'immediate' });
      try {
        const loadedName = callTH('getLoadedPresetName');
        if (loadedName && loadedName !== 'in_use') {
          await callTH('updatePresetWith', loadedName, applyPresetEdit);
        }
      } catch (err) {}
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
    notify('success', '已保存并持久化');
    return true;
  } catch (e) {
    console.error(`[${APP_NAME}] 保存条目失败:`, e);
    notify('error', `保存失败: ${e && e.message ? e.message : e}`);
    return false;
  } finally {
    state.isBusy = false;
  }
        }
