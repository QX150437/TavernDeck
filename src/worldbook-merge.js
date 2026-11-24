import {
  callTH, notify, genId, cloneWorldbookEntry, cloneWorldbookEntries,
  keysSignature, formatKeysInput, computeLineDiff,
} from './utils.js';
import { serializeRegExpDeep, reviveRegExpDeep } from './store.js';
import { createAutoBackupSnapshot } from './snapshot.js';

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

  await createAutoBackupSnapshot('worldbook', session.newName, '缝合覆盖前');
  await callTH('replaceWorldbook', session.newName, finalEntries, { render: 'debounced' });
  notify('success', `已将缝合结果覆盖保存至「${session.newName}」(${finalEntries.length} 条)`);
  return session.newName;
}

function sigWbEntry(e) {
  return JSON.stringify(serializeRegExpDeep(e));
}

function sigWbList(list) {
  return JSON.stringify(serializeRegExpDeep(list || []));
}

export async function buildDualWorldbookSession(sourceName, baseName) {
  const [sourceRaw, baseRaw] = await Promise.all([
    callTH('getWorldbook', sourceName),
    callTH('getWorldbook', baseName),
  ]);
  const sArr = cloneWorldbookEntries(sourceRaw);
  const bArr = cloneWorldbookEntries(baseRaw);
  const origMap = {};

  const sourceEntries = sArr.map((e, idx) => {
    const origRef = `s:${idx}`;
    origMap[origRef] = { data: cloneWorldbookEntry(e), sig: sigWbEntry(e) };
    return { _key: genId(), origRef, data: cloneWorldbookEntry(e) };
  });
  const baseEntries = bArr.map((e, idx) => {
    const origRef = `b:${idx}`;
    origMap[origRef] = { data: cloneWorldbookEntry(e), sig: sigWbEntry(e) };
    return { _key: genId(), origRef, data: cloneWorldbookEntry(e) };
  });

  return {
    v: 3,
    kind: 'worldbook',
    sourceName,
    baseName,
    origSourceSig: sigWbList(sArr),
    origBaseSig: sigWbList(bArr),
    origMap,
    sourceEntries,
    baseEntries,
    sourceQuery: '',
    baseQuery: '',
    sourceBatch: false,
    baseBatch: false,
    sourceSelected: new Set(),
    baseSelected: new Set(),
    activePane: 'both',
    diffMarks: null,
    sourceDirty: false,
    baseDirty: false,
    dirty: false,
    undoStack: [],
    redoStack: [],
  };
}

export function recomputeWbSessionDirty(session) {
  if (!session || session.v !== 3) return false;
  session.sourceDirty = sigWbList(session.sourceEntries.map((x) => x.data)) !== session.origSourceSig;
  session.baseDirty = sigWbList(session.baseEntries.map((x) => x.data)) !== session.origBaseSig;
  session.dirty = session.sourceDirty || session.baseDirty;
  return session.dirty;
}

function cloneWbItemList(list) {
  return (list || []).map((it) => ({
    _key: it._key,
    origRef: it.origRef,
    _migTag: it._migTag ? Object.assign({}, it._migTag) : null,
    data: cloneWorldbookEntry(it.data),
  }));
}

export function pushWbSessionUndo(session) {
  if (!session || session.v !== 3) return;
  session.undoStack = session.undoStack || [];
  session.undoStack.push({
    sourceEntries: cloneWbItemList(session.sourceEntries),
    baseEntries: cloneWbItemList(session.baseEntries),
  });
  if (session.undoStack.length > 30) session.undoStack.shift();
  session.redoStack = [];
}

export function undoWbSession(session) {
  if (!session?.undoStack?.length) return false;
  session.redoStack = session.redoStack || [];
  session.redoStack.push({
    sourceEntries: cloneWbItemList(session.sourceEntries),
    baseEntries: cloneWbItemList(session.baseEntries),
  });
  const prev = session.undoStack.pop();
  session.sourceEntries = prev.sourceEntries;
  session.baseEntries = prev.baseEntries;
  session.sourceSelected = new Set();
  session.baseSelected = new Set();
  recomputeWbSessionDirty(session);
  if (session.diffMarks) session.diffMarks = computeWbGlobalDiff(session).markByKey;
  return true;
}

export function redoWbSession(session) {
  if (!session?.redoStack?.length) return false;
  session.undoStack = session.undoStack || [];
  session.undoStack.push({
    sourceEntries: cloneWbItemList(session.sourceEntries),
    baseEntries: cloneWbItemList(session.baseEntries),
  });
  const next = session.redoStack.pop();
  session.sourceEntries = next.sourceEntries;
  session.baseEntries = next.baseEntries;
  session.sourceSelected = new Set();
  session.baseSelected = new Set();
  recomputeWbSessionDirty(session);
  if (session.diffMarks) session.diffMarks = computeWbGlobalDiff(session).markByKey;
  return true;
}

export function findWbCounterpart(item, targetEntries) {
  if (!item || !Array.isArray(targetEntries)) return null;
  const uid = item.data?.uid;
  const nm = (item.data?.name || '').trim();
  const byUid = uid !== undefined ? targetEntries.find((x) => Number(x.data?.uid) === Number(uid)) : null;
  if (byUid && ((byUid.data?.name || '').trim() === nm || !nm)) return byUid;
  if (nm) {
    const byName = targetEntries.find((x) => (x.data?.name || '').trim() === nm);
    if (byName) return byName;
  }
  return byUid || null;
}

export function describeWorldbookChanges(beforeEntries, afterEntries) {
  const bList = Array.isArray(beforeEntries) ? beforeEntries : [];
  const aList = Array.isArray(afterEntries) ? afterEntries : [];
  const bMap = new Map(bList.map((e, idx) => [Number(e.uid), { e, idx }]));
  const aMap = new Map(aList.map((e, idx) => [Number(e.uid), { e, idx }]));
  const lines = [];
  const matchedA = [];

  aList.forEach((ae, idx) => {
    const uid = Number(ae.uid);
    const hit = bMap.get(uid);
    const name = ae.name || `条目 #${uid}`;
    if (!hit) {
      lines.push(`[新增] #${idx + 1}「${name}」(${ae.enabled ? '开启' : '关闭'})`);
      return;
    }
    matchedA.push(uid);
    const be = hit.e;
    const changes = [];
    if (!!be.enabled !== !!ae.enabled) changes.push(`开关: ${be.enabled ? '开' : '关'} → ${ae.enabled ? '开' : '关'}`);
    if ((be.name || '') !== (ae.name || '')) changes.push(`标题:「${be.name || `#${uid}`}」→「${ae.name || `#${uid}`}」`);

    const stLabel = (t) => (t === 'constant' ? '蓝灯' : (t === 'vectorized' ? '向量' : '绿灯'));
    const bSt = be.strategy || {};
    const aSt = ae.strategy || {};
    if ((bSt.type || 'selective') !== (aSt.type || 'selective')) {
      changes.push(`策略: ${stLabel(bSt.type)} → ${stLabel(aSt.type)}`);
    }
    if (keysSignature(bSt.keys) !== keysSignature(aSt.keys)) {
      changes.push(`主关键词: [${formatKeysInput(bSt.keys) || '空'}] → [${formatKeysInput(aSt.keys) || '空'}]`);
    }
    if (
      (bSt.keys_secondary?.logic || 'and_any') !== (aSt.keys_secondary?.logic || 'and_any')
      || keysSignature(bSt.keys_secondary?.keys) !== keysSignature(aSt.keys_secondary?.keys)
      || (bSt.scan_depth ?? 'same_as_global') !== (aSt.scan_depth ?? 'same_as_global')
    ) {
      changes.push('次要关键词/扫描深度修改');
    }
    if (JSON.stringify(be.position || null) !== JSON.stringify(ae.position || null)) {
      changes.push(`位置/顺: ${be.position?.type || ''}(顺${be.position?.order ?? 100}) → ${ae.position?.type || ''}(顺${ae.position?.order ?? 100})`);
    }
    if (
      (be.probability ?? 100) !== (ae.probability ?? 100)
      || JSON.stringify(be.recursion || null) !== JSON.stringify(ae.recursion || null)
      || JSON.stringify(be.effect || null) !== JSON.stringify(ae.effect || null)
    ) {
      changes.push('概率/递归/时效参数修改');
    }
    const oldC = be.content || '';
    const newC = ae.content || '';
    if (oldC !== newC) {
      const diffs = computeLineDiff(oldC, newC);
      const addCnt = diffs.filter((d) => d.type === 'add').length;
      const delCnt = diffs.filter((d) => d.type === 'del').length;
      changes.push(`正文修改 (${oldC.length}→${newC.length}字, +${addCnt}/-${delCnt}行)`);
    }
    if (changes.length > 0) {
      lines.push(`#${idx + 1}「${name}」: ${changes.join('；')}`);
    }
  });

  bList.forEach((be, idx) => {
    const uid = Number(be.uid);
    if (!aMap.has(uid)) {
      lines.push(`[删除] 原 #${idx + 1}「${be.name || `条目 #${uid}`}」`);
    }
  });

  const matchedB = bList.filter((be) => aMap.has(Number(be.uid))).map((be) => Number(be.uid));
  if (matchedA.length === matchedB.length && matchedA.some((u, i) => u !== matchedB[i])) {
    lines.push('[顺序调整] 条目排列顺序已调整');
  }

  return { hasChanges: lines.length > 0, count: lines.length, lines };
}

export function getWbPairDiffReasons(oe, ne) {
  const reasons = [];
  if (!oe || !ne) return reasons;
  if (!!oe.enabled !== !!ne.enabled) reasons.push(`开关: A(${oe.enabled ? '开' : '关'}) vs B(${ne.enabled ? '开' : '关'})`);
  if ((oe.content || '') !== (ne.content || '')) reasons.push('正文内容不同');
  if ((oe.name || '') !== (ne.name || '')) reasons.push('条目名称不同');
  if (strategySignature(oe.strategy) !== strategySignature(ne.strategy)) reasons.push('触发策略/关键词不同');
  if (JSON.stringify(oe.position || null) !== JSON.stringify(ne.position || null)) reasons.push('位置/深度/顺序不同');
  if (
    oe.probability !== ne.probability
    || JSON.stringify(oe.recursion || null) !== JSON.stringify(ne.recursion || null)
    || JSON.stringify(oe.effect || null) !== JSON.stringify(ne.effect || null)
  ) {
    reasons.push('概率/递归/时效不同');
  }
  return reasons;
}

export function computeWbGlobalDiff(session) {
  const sList = session.sourceEntries || [];
  const bList = session.baseEntries || [];
  const bByOrig = new Map();
  const bByUid = new Map();
  const bByName = new Map();
  bList.forEach((b, idx) => {
    if (b.origRef) {
      if (!bByOrig.has(b.origRef)) bByOrig.set(b.origRef, []);
      bByOrig.get(b.origRef).push({ item: b, idx });
    }
    bByUid.set(Number(b.data?.uid), { item: b, idx });
    const nm = (b.data?.name || '').trim();
    if (nm) {
      if (!bByName.has(nm)) bByName.set(nm, []);
      bByName.get(nm).push({ item: b, idx });
    }
  });

  const matchedBaseKeys = new Set();
  const sMatchMap = new Map();

  sList.forEach((s, sIdx) => {
    if (!s.origRef) return;
    const cands = bByOrig.get(s.origRef);
    const hit = cands?.find((c) => !matchedBaseKeys.has(c.item._key));
    if (hit) {
      matchedBaseKeys.add(hit.item._key);
      sMatchMap.set(sIdx, hit);
    }
  });

  sList.forEach((s, sIdx) => {
    if (sMatchMap.has(sIdx)) return;
    const nm = (s.data?.name || '').trim();
    let match = null;
    const byUid = bByUid.get(Number(s.data?.uid));
    if (byUid && !matchedBaseKeys.has(byUid.item._key) && ((byUid.item.data?.name || '').trim() === nm || !nm)) {
      match = byUid;
    }
    if (!match && nm) {
      const cands = bByName.get(nm);
      match = cands?.find((c) => !matchedBaseKeys.has(c.item._key)) || null;
    }
    if (!match && byUid && !matchedBaseKeys.has(byUid.item._key)) {
      match = byUid;
    }
    if (match) {
      matchedBaseKeys.add(match.item._key);
      sMatchMap.set(sIdx, match);
    }
  });

  const items = [];
  const markByKey = new Map();

  sList.forEach((s, sIdx) => {
    const match = sMatchMap.get(sIdx);
    if (!match) {
      markByKey.set(s._key, 'sourceOnly');
      items.push({
        status: 'sourceOnly',
        sourceKey: s._key,
        baseKey: null,
        sourceIdx: sIdx,
        baseIdx: -1,
        name: s.data?.name || `条目 #${s.data?.uid}`,
        reasons: ['仅 A 侧存在'],
      });
      return;
    }

    const reasons = getWbPairDiffReasons(s.data, match.item.data);
    const status = reasons.length > 0 ? 'conflict' : 'same';
    markByKey.set(s._key, status);
    markByKey.set(match.item._key, status);
    items.push({
      status,
      sourceKey: s._key,
      baseKey: match.item._key,
      sourceIdx: sIdx,
      baseIdx: match.idx,
      name: match.item.data?.name || s.data?.name || `条目 #${s.data?.uid}`,
      reasons,
    });
  });

  bList.forEach((b, bIdx) => {
    if (matchedBaseKeys.has(b._key)) return;
    markByKey.set(b._key, 'baseOnly');
    items.push({
      status: 'baseOnly',
      sourceKey: null,
      baseKey: b._key,
      sourceIdx: -1,
      baseIdx: bIdx,
      name: b.data?.name || `条目 #${b.data?.uid}`,
      reasons: ['仅 B 侧存在'],
    });
  });

  const stats = {
    conflict: items.filter((x) => x.status === 'conflict').length,
    sourceOnly: items.filter((x) => x.status === 'sourceOnly').length,
    baseOnly: items.filter((x) => x.status === 'baseOnly').length,
    same: items.filter((x) => x.status === 'same').length,
  };
  return { items, stats, markByKey };
}

export function executeWbMigration(session, opts) {
  const {
    fromSide,
    selectedKeys,
    targetScope = 'cross',
    targetIndex1 = 1,
    placement = 'before',
    crossMode = 'copy',
    overwriteMatch = false,
  } = opts || {};

  const srcList = fromSide === 'source' ? session.sourceEntries : session.baseEntries;
  const dstList = targetScope === 'same'
    ? srcList
    : (fromSide === 'source' ? session.baseEntries : session.sourceEntries);
  const keySet = new Set(selectedKeys || []);
  if (keySet.size === 0) return { movedCount: 0, updatedCount: 0, notes: [] };

  pushWbSessionUndo(session);

  if (targetScope === 'same') {
    if (srcList.length === 0) return { movedCount: 0, updatedCount: 0, notes: [] };
    const moving = [];
    const before = [];
    const after = [];
    const num = Math.max(1, Math.min(srcList.length, Math.floor(Number(targetIndex1) || 1)));
    const targetPos = placement === 'after' ? num : num - 1;
    for (let i = 0; i < srcList.length; i++) {
      if (keySet.has(srcList[i]._key)) moving.push(srcList[i]);
      else if (i < targetPos) before.push(srcList[i]);
      else after.push(srcList[i]);
    }
    const next = [...before, ...moving, ...after];
    srcList.splice(0, srcList.length, ...next);
    recomputeWbSessionDirty(session);
    return { movedCount: moving.length, updatedCount: 0, notes: [] };
  }

  const num = dstList.length > 0 ? Math.max(1, Math.min(dstList.length, Math.floor(Number(targetIndex1) || 1))) : 0;
  let insertAt = dstList.length === 0 ? 0 : (placement === 'after' ? num : num - 1);

  const selectedItems = srcList.filter((it) => keySet.has(it._key));
  const usedUids = new Set(dstList.map((x) => Number(x.data?.uid)).filter((u) => !Number.isNaN(u)));
  let nextUid = dstList.reduce((mx, x) => Math.max(mx, Number(x.data?.uid) || 0), 0) + 1;
  const fromLabel = fromSide === 'source' ? 'A' : 'B';
  const toLabel = fromSide === 'source' ? 'B' : 'A';
  let movedCount = 0;
  let updatedCount = 0;

  selectedItems.forEach((item) => {
    if (!item.origRef) item.origRef = `m:${genId()}`;
    const copyData = cloneWorldbookEntry(item.data);
    if (overwriteMatch) {
      const match = findWbCounterpart(item, dstList);
      if (match) {
        copyData.uid = match.data.uid;
        match.data = copyData;
        match.origRef = item.origRef;
        match._migTag = { type: 'in', from: fromLabel };
        if (crossMode === 'copy') item._migTag = { type: 'out', to: toLabel };
        updatedCount++;
        return;
      }
    }
    if (typeof copyData.uid !== 'number' || Number.isNaN(copyData.uid) || usedUids.has(Number(copyData.uid))) {
      while (usedUids.has(nextUid)) nextUid++;
      copyData.uid = nextUid++;
    }
    usedUids.add(Number(copyData.uid));
    dstList.splice(insertAt, 0, {
      _key: genId(),
      origRef: item.origRef,
      _migTag: { type: 'in', from: fromLabel },
      data: copyData,
    });
    if (crossMode === 'copy') item._migTag = { type: 'out', to: toLabel };
    insertAt++;
    movedCount++;
  });

  if (crossMode === 'move') {
    const kept = srcList.filter((it) => !keySet.has(it._key));
    srcList.splice(0, srcList.length, ...kept);
    if (fromSide === 'source') session.sourceSelected.clear();
    else session.baseSelected.clear();
  }

  recomputeWbSessionDirty(session);
  if (session.diffMarks) session.diffMarks = computeWbGlobalDiff(session).markByKey;
  return { movedCount, updatedCount, notes: [] };
}

export async function saveDualWbSide(session, side, targetMode, customTargetName) {
  const isBase = side !== 'source';
  const rawList = (isBase ? session.baseEntries : session.sourceEntries).map((x) => cloneWorldbookEntry(x.data));

  let nextUid = rawList.reduce((mx, e) => Math.max(mx, Number(e.uid) || 0), 0) + 1;
  const seenUid = new Set();
  const finalEntries = rawList.map((e) => {
    const copy = cloneWorldbookEntry(e);
    if (typeof copy.uid !== 'number' || Number.isNaN(copy.uid) || seenUid.has(copy.uid)) {
      while (seenUid.has(nextUid)) nextUid++;
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

  const saveTarget = isBase ? session.baseName : session.sourceName;
  await createAutoBackupSnapshot('worldbook', saveTarget, '缝合覆盖前');
  await callTH('replaceWorldbook', saveTarget, finalEntries, { render: 'debounced' });
  notify('success', `已将结果覆盖保存至世界书「${saveTarget}」(${finalEntries.length} 条)`);

  if (isBase) {
    session.origBaseSig = sigWbList(finalEntries);
  } else {
    session.origSourceSig = sigWbList(finalEntries);
  }
  recomputeWbSessionDirty(session);
  return saveTarget;
}

export async function hydrateWbMergeDraft(draft) {
  if (!draft) return null;
  if (draft.v === 3) {
    const session = await buildDualWorldbookSession(draft.sourceName, draft.baseName);
    const pool = Array.isArray(draft.dataPool) ? draft.dataPool : [];
    const decodeSide = (encodedList) => (encodedList || []).map((token) => {
      if (typeof token === 'string') {
        const orig = session.origMap[token];
        if (!orig) return null;
        return { _key: genId(), origRef: token, data: cloneWorldbookEntry(orig.data) };
      }
      if (token && typeof token === 'object') {
        if (typeof token.p === 'number' && pool[token.p]) {
          return { _key: genId(), origRef: token.r || null, _migTag: token.mt || null, data: cloneWorldbookEntry(reviveRegExpDeep(pool[token.p])) };
        }
        if (token.d) {
          return { _key: genId(), origRef: token.r || null, _migTag: token.mt || null, data: cloneWorldbookEntry(reviveRegExpDeep(token.d)) };
        }
        if (token.r && session.origMap[token.r]) {
          const data = cloneWorldbookEntry(session.origMap[token.r].data);
          if (token.uid !== undefined) data.uid = Number(token.uid);
          if (token.en !== undefined) data.enabled = !!token.en;
          return { _key: genId(), origRef: token.r, _migTag: token.mt || null, data };
        }
      }
      return null;
    }).filter(Boolean);

    session.sourceEntries = decodeSide(draft.sourceList);
    session.baseEntries = decodeSide(draft.baseList);
    session.sourceQuery = draft.sourceQuery || '';
    session.baseQuery = draft.baseQuery || '';
    session.activePane = draft.activePane || 'both';
    if (Array.isArray(draft.undoStack)) {
      session.undoStack = draft.undoStack.map((snap) => ({
        sourceEntries: decodeSide(snap.s),
        baseEntries: decodeSide(snap.b),
      }));
    }
    if (Array.isArray(draft.redoStack)) {
      session.redoStack = draft.redoStack.map((snap) => ({
        sourceEntries: decodeSide(snap.s),
        baseEntries: decodeSide(snap.b),
      }));
    }
    if (draft._pendingCustom) {
      const pc = JSON.parse(JSON.stringify(draft._pendingCustom));
      if (pc.draft) {
        if (pc.draft.oldContent === undefined && pc.srcRef && session.origMap[pc.srcRef]) {
          pc.draft.oldContent = session.origMap[pc.srcRef].data.content || '';
        }
        if (pc.draft.newContent === undefined && pc.baseRef && session.origMap[pc.baseRef]) {
          pc.draft.newContent = session.origMap[pc.baseRef].data.content || '';
        }
      }
      session._pendingCustom = pc;
    }
    recomputeWbSessionDirty(session);
    return session;
  }

  if (draft.v !== 2) return draft;
  const session = await buildWorldbookDiffSession(draft.oldName, draft.newName);
  session.filter = draft.filter || session.filter;
  session.query = draft.query || '';
  session.controlsOpen = !!draft.controlsOpen;
  session.dirty = !!draft.dirty;
  const overrides = draft.entryOverrides || {};
  session.entries.forEach((it) => {
    const ov = overrides[it.key];
    if (!ov) return;
    if (ov.expanded) it.expanded = true;
    if (ov.stateOnly && it.newEntry) {
      const copy = cloneWorldbookEntry(it.newEntry);
      copy.enabled = !!ov.enabled;
      it.customEntry = copy;
      it.choice = 'custom';
    } else if (ov.choice === 'custom' && ov.customEntry) {
      it.customEntry = cloneWorldbookEntry(ov.customEntry);
      it.choice = 'custom';
    } else if (ov.choice) {
      it.choice = ov.choice;
    }
  });
  if (draft._pendingCustom) {
    const pc = JSON.parse(JSON.stringify(draft._pendingCustom));
    const entry = session.entries.find((x) => x.key === pc.entryKey);
    if (entry && pc.draft) {
      if (pc.draft.oldContent === undefined) pc.draft.oldContent = entry.oldEntry?.content || '';
      if (pc.draft.newContent === undefined) pc.draft.newContent = entry.newEntry?.content || '';
    }
    session._pendingCustom = pc;
  }
  return session;
}
