import {
  callTH, hasTH, getST, notify, cloneWorldbookEntries, downloadJsonFile,
} from './utils.js';
import { state, saveStore } from './store.js';

export function getWorldbookBindingsSnapshot() {
  const allBooks = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
  const globalList = hasTH('getGlobalWorldbookNames') ? (callTH('getGlobalWorldbookNames') || []) : [];
  const globalSet = new Set(globalList);

  const hasCharacter = hasTH('getCurrentCharacterName') ? !!callTH('getCurrentCharacterName') : false;
  let charPrimary = null;
  let charAdditional = [];
  if (hasCharacter && hasTH('getCharWorldbookNames')) {
    try {
      const cw = callTH('getCharWorldbookNames', 'current');
      if (cw) {
        charPrimary = cw.primary || null;
        charAdditional = Array.isArray(cw.additional) ? cw.additional.slice() : [];
      }
    } catch (e) {}
  }

  let chatBook = null;
  if (hasTH('getChatWorldbookName')) {
    try {
      chatBook = callTH('getChatWorldbookName', 'current');
    } catch (e) {}
  }

  return {
    allBooks,
    globalList,
    globalSet,
    hasCharacter,
    charPrimary,
    charAdditional,
    charAdditionalSet: new Set(charAdditional),
    chatBook,
  };
}

export async function toggleGlobalWorldbook(bookName) {
  const snap = getWorldbookBindingsSnapshot();
  const next = snap.globalSet.has(bookName)
    ? snap.globalList.filter((n) => n !== bookName)
    : [...snap.globalList, bookName];
  await callTH('rebindGlobalWorldbooks', next);
  notify('success', snap.globalSet.has(bookName) ? `已从全局关闭「${bookName}」` : `已全局启用「${bookName}」`);
}

export async function toggleCharPrimaryWorldbook(bookName) {
  const snap = getWorldbookBindingsSnapshot();
  if (!snap.hasCharacter) throw new Error('当前未打开角色卡');
  const nextPrimary = snap.charPrimary === bookName ? null : bookName;
  const nextAdd = snap.charAdditional.filter((n) => n !== nextPrimary);
  await callTH('rebindCharWorldbooks', 'current', { primary: nextPrimary, additional: nextAdd });
  notify('success', nextPrimary ? `已设为角色卡主世界书「${bookName}」` : '已解除角色卡主世界书');
}

export async function toggleCharAdditionalWorldbook(bookName) {
  const snap = getWorldbookBindingsSnapshot();
  if (!snap.hasCharacter) throw new Error('当前未打开角色卡');
  const nextAdd = snap.charAdditionalSet.has(bookName)
    ? snap.charAdditional.filter((n) => n !== bookName)
    : [...snap.charAdditional, bookName];
  await callTH('rebindCharWorldbooks', 'current', { primary: snap.charPrimary, additional: nextAdd });
  notify('success', snap.charAdditionalSet.has(bookName) ? `已移除角色附加世界书「${bookName}」` : `已添加角色附加世界书「${bookName}」`);
}

export async function bindChatWorldbookSafe(bookName) {
  await callTH('rebindChatWorldbook', 'current', bookName || '');
  notify('success', bookName ? `已绑定当前聊天世界书「${bookName}」` : '已更新当前聊天世界书');
}

export async function createOrBindChatWorldbookSafe(customName) {
  const created = await callTH('getOrCreateChatWorldbook', 'current', customName || undefined);
  notify('success', `已启用当前聊天世界书「${created}」`);
  return created;
}

export async function createWorldbookSafe(name, sourceName = '') {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('请输入世界书名称');
  const existing = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
  if (existing.includes(clean)) throw new Error(`世界书「${clean}」已存在`);

  if (sourceName) {
    const entries = cloneWorldbookEntries(await callTH('getWorldbook', sourceName));
    await callTH('createWorldbook', clean, entries);
  } else {
    await callTH('createWorldbook', clean, []);
  }
  notify('success', `已创建世界书「${clean}」`);
}

function replaceBookRefInGroups(groups, oldName, newName) {
  if (!Array.isArray(groups)) return;
  groups.forEach((g) => {
    (g.items || []).forEach((it) => {
      if (it && it.type === 'worldbook' && it.book === oldName) {
        it.book = newName;
        it.key = `worldbook::${newName}::${it.uid}`;
      }
    });
    if (Array.isArray(g.children)) replaceBookRefInGroups(g.children, oldName, newName);
  });
}

export async function renameWorldbookSafe(oldName, newName) {
  const clean = String(newName || '').trim();
  if (!clean) throw new Error('请输入新世界书名称');
  if (clean === oldName) return;
  const existing = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
  if (existing.includes(clean)) throw new Error(`世界书「${clean}」已存在`);

  const entries = cloneWorldbookEntries(await callTH('getWorldbook', oldName));
  await callTH('createWorldbook', clean, entries);

  const snap = getWorldbookBindingsSnapshot();
  if (snap.globalSet.has(oldName)) {
    const nextGlobal = snap.globalList.map((n) => (n === oldName ? clean : n));
    await callTH('rebindGlobalWorldbooks', nextGlobal);
  }
  if (snap.hasCharacter && (snap.charPrimary === oldName || snap.charAdditionalSet.has(oldName))) {
    const nextPrimary = snap.charPrimary === oldName ? clean : snap.charPrimary;
    const nextAdd = snap.charAdditional.map((n) => (n === oldName ? clean : n));
    await callTH('rebindCharWorldbooks', 'current', { primary: nextPrimary, additional: nextAdd });
  }
  if (snap.chatBook === oldName) {
    try { await callTH('rebindChatWorldbook', 'current', clean); } catch (e) {}
  }

  (state.store.schemes || []).forEach((s) => replaceBookRefInGroups(s.groups, oldName, clean));
  saveStore(state.store);

  await callTH('deleteWorldbook', oldName);
  notify('success', `已将世界书重命名为「${clean}」`);
}

export async function deleteWorldbookSafe(name) {
  const ok = await callTH('deleteWorldbook', name);
  if (!ok) throw new Error(`删除世界书「${name}」失败`);
  notify('info', `已删除世界书「${name}」`);
}

export async function exportWorldbookFile(name) {
  let payload = null;
  try {
    const st = getST();
    if (st && typeof st.loadWorldInfo === 'function') {
      const raw = await st.loadWorldInfo(name);
      if (raw && typeof raw === 'object') payload = raw;
    }
  } catch (e) {}
  if (!payload) {
    payload = await callTH('getWorldbook', name);
  }
  downloadJsonFile(payload, `${name.replace(/[\\/:*?"<>|]/g, '_')}.json`);
  notify('success', `已导出世界书「${name}」`);
}

export async function importWorldbookFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const baseName = file.name.replace(/\.json$/i, '').trim() || `导入世界书_${Date.now()}`;
  if (Array.isArray(parsed)) {
    await callTH('createOrReplaceWorldbook', baseName, parsed, { render: 'debounced' });
  } else if (hasTH('importRawWorldbook')) {
    const res = await callTH('importRawWorldbook', file.name, text);
    if (res && res.ok === false) throw new Error('后端导入世界书失败');
  } else {
    throw new Error('当前酒馆助手版本不支持 importRawWorldbook');
  }
  notify('success', `已导入世界书「${baseName}」`);
}

export function disableAllRecursionInEntries(entries) {
  if (!Array.isArray(entries)) return 0;
  let changed = 0;
  entries.forEach((e) => {
    const cur = e.recursion || { prevent_incoming: false, prevent_outgoing: false, delay_until: null };
    if (!cur.prevent_incoming || !cur.prevent_outgoing || cur.delay_until !== null) {
      e.recursion = { prevent_incoming: true, prevent_outgoing: true, delay_until: null };
      changed++;
    }
  });
  return changed;
}

export function buildDefaultWorldbookEntry(fields = {}) {
  return {
    name: fields.name || '新条目',
    enabled: fields.enabled !== undefined ? !!fields.enabled : true,
    strategy: {
      type: fields.strategyType || 'selective',
      keys: Array.isArray(fields.keys) ? fields.keys : [],
      keys_secondary: {
        logic: fields.secLogic || 'and_any',
        keys: Array.isArray(fields.secKeys) ? fields.secKeys : [],
      },
      scan_depth: fields.scanDepth === 'same_as_global' || fields.scanDepth === undefined
        ? 'same_as_global'
        : Number(fields.scanDepth),
    },
    position: {
      type: fields.posType || 'after_character_definition',
      role: fields.role || 'system',
      depth: Number(fields.depth) || 4,
      order: Number(fields.order) || 100,
    },
    content: String(fields.content || ''),
    probability: fields.probability !== undefined ? Number(fields.probability) : 100,
    recursion: {
      prevent_incoming: !!fields.preventIncoming,
      prevent_outgoing: !!fields.preventOutgoing,
      delay_until: fields.delayUntil ? Number(fields.delayUntil) : null,
    },
    effect: {
      sticky: fields.sticky ? Number(fields.sticky) : null,
      cooldown: fields.cooldown ? Number(fields.cooldown) : null,
      delay: fields.delay ? Number(fields.delay) : null,
    },
  };
}

export const WB_POSITION_OPTIONS = [
  { v: 'before_character_definition', t: '角色定义之前' },
  { v: 'after_character_definition', t: '角色定义之后' },
  { v: 'before_example_messages', t: '示例消息之前' },
  { v: 'after_example_messages', t: '示例消息之后' },
  { v: 'before_author_note', t: '作者注释之前' },
  { v: 'after_author_note', t: '作者注释之后' },
  { v: 'at_depth', t: '按深度插入 (@D)' },
  { v: 'outlet', t: 'Outlet 输出口' },
];
