import {
  callTH, notify, cloneWorldbookEntry, cloneWorldbookEntries, keysSignature,
} from './utils.js';

function strategySignature(s) {
  if (!s) return '';
  return JSON.stringify({
    type: s.type || 'selective',
    keys: keysSignature(s.keys),
    secLogic: s.keys_secondary?.logic || 'and_any',
    secKeys: keysSignature(s.keys_secondary?.keys),
    scan_depth: s.scan_depth ?? 'same_as_global',
  });
}

export async function buildWorldbookDiffSession(oldName, newName) {
  const [oldRaw, newRaw] = await Promise.all([
    callTH('getWorldbook', oldName),
    callTH('getWorldbook', newName),
  ]);
  const oldEntries = cloneWorldbookEntries(oldRaw);
  const newEntries = cloneWorldbookEntries(newRaw);

  const oldByUid = new Map();
  const oldByName = new Map();
  oldEntries.forEach((e) => {
    oldByUid.set(e.uid, e);
    const nm = (e.name || '').trim();
    if (nm && !oldByName.has(nm)) oldByName.set(nm, e);
  });

  const usedOldUids = new Set();
  const entries = [];

  newEntries.forEach((ne, idx) => {
    const nm = (ne.name || '').trim();
    let oe = null;
    const byUid = oldByUid.get(ne.uid);
    if (byUid && !usedOldUids.has(byUid.uid) && ((byUid.name || '').trim() === nm || !nm)) {
      oe = byUid;
    }
    if (!oe && nm) {
      const byName = oldByName.get(nm);
      if (byName && !usedOldUids.has(byName.uid)) oe = byName;
    }
    if (!oe && byUid && !usedOldUids.has(byUid.uid)) {
      oe = byUid;
    }

    if (!oe) {
      entries.push({
        key: `new::${ne.uid}::${idx}`,
        uid: ne.uid,
        name: ne.name || `条目 #${ne.uid}`,
        status: 'added',
        oldEntry: null,
        newEntry: cloneWorldbookEntry(ne),
        choice: 'new',
        customEntry: null,
        diffReasons: ['新版新增'],
        expanded: false,
      });
      return;
    }

    usedOldUids.add(oe.uid);
    const reasons = [];
    if (!!oe.enabled !== !!ne.enabled) reasons.push(`开关: ${oe.enabled ? '开' : '关'} → ${ne.enabled ? '开' : '关'}`);
    if ((oe.content || '') !== (ne.content || '')) reasons.push('正文内容不同');
    if ((oe.name || '') !== (ne.name || '')) reasons.push('条目名称变更');
    if (strategySignature(oe.strategy) !== strategySignature(ne.strategy)) reasons.push('触发策略/关键词不同');
    if (JSON.stringify(oe.position || null) !== JSON.stringify(ne.position || null)) reasons.push('插入位置/深度/顺序不同');
    if (
      oe.probability !== ne.probability
      || JSON.stringify(oe.recursion || null) !== JSON.stringify(ne.recursion || null)
      || JSON.stringify(oe.effect || null) !== JSON.stringify(ne.effect || null)
    ) {
      reasons.push('概率/递归/时效参数不同');
    }

    entries.push({
      key: `match::${ne.uid}::${idx}`,
      uid: ne.uid,
      name: ne.name || oe.name || `条目 #${ne.uid}`,
      status: reasons.length > 0 ? 'conflict' : 'same',
      oldEntry: cloneWorldbookEntry(oe),
      newEntry: cloneWorldbookEntry(ne),
      choice: 'new',
      customEntry: null,
      diffReasons: reasons,
      expanded: false,
    });
  });

  oldEntries.forEach((oe, idx) => {
    if (usedOldUids.has(oe.uid)) return;
    entries.push({
      key: `old::${oe.uid}::${idx}`,
      uid: oe.uid,
      name: oe.name || `条目 #${oe.uid}`,
      status: 'removed',
      oldEntry: cloneWorldbookEntry(oe),
      newEntry: null,
      choice: 'new',
      customEntry: null,
      diffReasons: ['新版已删除（默认不带入）'],
      expanded: false,
    });
  });

  const stats = {
    conflict: entries.filter((e) => e.status === 'conflict').length,
    added: entries.filter((e) => e.status === 'added').length,
    removed: entries.filter((e) => e.status === 'removed').length,
    same: entries.filter((e) => e.status === 'same').length,
  };

  return {
    oldName,
    newName,
    entries,
    stats,
    filter: (stats.conflict + stats.added + stats.removed) > 0 ? 'diff' : 'all',
    query: '',
    controlsOpen: false,
    dirty: false,
  };
}

export async function executeWorldbookStitch(session, targetMode, customTargetName) {
  const rawList = [];
  session.entries.forEach((item) => {
    if (item.status === 'same') {
      if (item.newEntry) rawList.push(cloneWorldbookEntry(item.newEntry));
      return;
    }
    if (item.choice === 'custom' && item.customEntry) {
      rawList.push(cloneWorldbookEntry(item.customEntry));
    } else if (item.choice === 'old' && item.oldEntry) {
      const copy = cloneWorldbookEntry(item.oldEntry);
      if (item.newEntry) copy.uid = item.newEntry.uid;
      rawList.push(copy);
    } else if (item.choice === 'new' && item.newEntry) {
      rawList.push(cloneWorldbookEntry(item.newEntry));
    }
  });

  let nextUid = rawList.reduce((mx, e) => Math.max(mx, Number(e.uid) || 0), 0) + 1;
  const seenUid = new Set();
  const finalEntries = rawList.map((e) => {
    const copy = cloneWorldbookEntry(e);
    if (typeof copy.uid !== 'number' || seenUid.has(copy.uid)) {
      copy.uid = nextUid++;
    }
    seenUid.add(copy.uid);
    return copy;
  });

  if (targetMode === 'new') {
    const name = (customTargetName || '').trim();
    if (!name) throw new Error('请输入新世界书名称');
    await callTH('createOrReplaceWorldbook', name, finalEntries, { render: 'debounced' });
    notify('success', `已生成缝合世界书「${name}」(${finalEntries.length} 条)`);
    return name;
  }

  await callTH('replaceWorldbook', session.newName, finalEntries, { render: 'debounced' });
  notify('success', `已将缝合结果覆盖保存至「${session.newName}」(${finalEntries.length} 条)`);
  return session.newName;
}
