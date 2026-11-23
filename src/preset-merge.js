import { callTH, hasTH, notify, genId, findBestMatchingName, computeLineDiff, logWarn } from './utils.js';
import { createAutoBackupSnapshot } from './snapshot.js';
import { PRESET_SYSTEM_IDS } from './preset-manager.js';

export { computeLineDiff };
export const findBestMatchingOldPreset = findBestMatchingName;

function promptSignature(p) {
  if (!p) return '';
  return JSON.stringify({
    name: p.name || '',
    enabled: !!p.enabled,
    role: p.role || 'system',
    content: typeof p.content === 'string' ? p.content : null,
    position: p.position || null,
  });
}

export function hasUnsavedPresetChanges(presetName) {
  if (!presetName || presetName === 'in_use' || !hasTH('getPreset')) return false;
  try {
    const inUse = callTH('getPreset', 'in_use');
    const saved = callTH('getPreset', presetName);
    if (!inUse || !saved) return false;
    const pA = Array.isArray(inUse.prompts) ? inUse.prompts : [];
    const pB = Array.isArray(saved.prompts) ? saved.prompts : [];
    if (pA.length !== pB.length) return true;
    for (let i = 0; i < pA.length; i++) {
      if (pA[i].id !== pB[i].id || promptSignature(pA[i]) !== promptSignature(pB[i])) {
        return true;
      }
    }
    return false;
  } catch (e) {
    logWarn('比对预设未保存修改状态失败', e);
    return false;
  }
}

export async function saveInUseToPreset(presetName) {
  if (!presetName || presetName === 'in_use') return false;
  const inUse = callTH('getPreset', 'in_use');
  if (!inUse) return false;
  await callTH('replacePreset', presetName, JSON.parse(JSON.stringify(inUse)), { render: 'none' });
  notify('success', `已将当前修改保存至预设「${presetName}」`);
  return true;
}

export function buildPresetDiffSession(oldName, newName) {
  const oldPreset = callTH('getPreset', oldName);
  const newPreset = callTH('getPreset', newName);
  const oldPrompts = Array.isArray(oldPreset?.prompts) ? oldPreset.prompts : [];
  const newPrompts = Array.isArray(newPreset?.prompts) ? newPreset.prompts : [];

  const oldById = new Map();
  const oldByName = new Map();
  oldPrompts.forEach((p, idx) => {
    oldById.set(p.id, { p, idx });
    if (p.name && !oldByName.has(p.name)) oldByName.set(p.name, { p, idx });
  });

  const usedOldIds = new Set();
  const entries = [];

  newPrompts.forEach((np) => {
    let matched = oldById.get(np.id);
    if (!matched && np.name) {
      const byName = oldByName.get(np.name);
      if (byName && !usedOldIds.has(byName.p.id)) matched = byName;
    }
    if (!matched) {
      entries.push({
        key: `new::${np.id}`,
        id: np.id,
        name: np.name || np.id,
        status: 'added',
        oldPrompt: null,
        newPrompt: JSON.parse(JSON.stringify(np)),
        choice: 'new',
        customPrompt: null,
        diffReasons: ['新版新增'],
        expanded: false,
      });
      return;
    }

    const op = matched.p;
    usedOldIds.add(op.id);
    const reasons = [];
    if (!!op.enabled !== !!np.enabled) reasons.push(`开关: ${op.enabled ? '开' : '关'} → ${np.enabled ? '开' : '关'}`);
    if ((op.content || '') !== (np.content || '')) reasons.push('正文内容不同');
    if ((op.name || '') !== (np.name || '')) reasons.push('名称变更');
    if ((op.role || '') !== (np.role || '')) reasons.push('身份变更');
    if (JSON.stringify(op.position || null) !== JSON.stringify(np.position || null)) reasons.push('插入位置/深度不同');

    const status = reasons.length > 0 ? 'conflict' : 'same';
    entries.push({
      key: `match::${np.id}`,
      id: np.id,
      name: np.name || op.name || np.id,
      status,
      oldPrompt: JSON.parse(JSON.stringify(op)),
      newPrompt: JSON.parse(JSON.stringify(np)),
      choice: 'new',
      customPrompt: null,
      diffReasons: reasons,
      expanded: false,
    });
  });

  oldPrompts.forEach((op) => {
    if (usedOldIds.has(op.id)) return;
    entries.push({
      key: `old::${op.id}`,
      id: op.id,
      name: op.name || op.id,
      status: 'removed',
      oldPrompt: JSON.parse(JSON.stringify(op)),
      newPrompt: null,
      choice: 'new',
      customPrompt: null,
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
    oldPreset: JSON.parse(JSON.stringify(oldPreset)),
    newPreset: JSON.parse(JSON.stringify(newPreset)),
    entries,
    stats,
    filter: stats.conflict > 0 ? 'diff' : 'all',
    query: '',
    controlsOpen: false,
    migrateSettings: false,
    dirty: false,
  };
}

export async function executePresetStitch(session, targetMode, customTargetName) {
  const base = JSON.parse(JSON.stringify(session.newPreset));
  if (session.migrateSettings && session.oldPreset?.settings) {
    base.settings = JSON.parse(JSON.stringify(session.oldPreset.settings));
  }

  const finalPrompts = [];
  session.entries.forEach((item) => {
    if (item.status === 'same') {
      if (item.newPrompt) finalPrompts.push(JSON.parse(JSON.stringify(item.newPrompt)));
      return;
    }
    if (item.choice === 'custom' && item.customPrompt) {
      finalPrompts.push(JSON.parse(JSON.stringify(item.customPrompt)));
    } else if (item.choice === 'old') {
      if (item.oldPrompt) {
        const copy = JSON.parse(JSON.stringify(item.oldPrompt));
        if (item.newPrompt) copy.id = item.newPrompt.id;
        finalPrompts.push(copy);
      }
    } else if (item.choice === 'new') {
      if (item.newPrompt) finalPrompts.push(JSON.parse(JSON.stringify(item.newPrompt)));
    }
  });

  base.prompts = finalPrompts;

  if (targetMode === 'new') {
    const name = (customTargetName || '').trim();
    if (!name) throw new Error('请输入新预设名称');
    await callTH('createOrReplacePreset', name, base, { render: 'debounced' });
    callTH('loadPreset', name);
    notify('success', `已生成并切换到缝合预设「${name}」`);
    return name;
  }

  const saveTarget = session.newName;
  await createAutoBackupSnapshot('preset', saveTarget || 'in_use', '缝合覆盖前');
  if (saveTarget && saveTarget !== 'in_use') {
    await callTH('replacePreset', saveTarget, base, { render: 'debounced' });
    if (callTH('getLoadedPresetName') === saveTarget) {
      await callTH('replacePreset', 'in_use', base, { render: 'debounced' });
    }
    notify('success', `已将缝合结果覆盖保存至「${saveTarget}」`);
    return saveTarget;
  }
  await callTH('replacePreset', 'in_use', base, { render: 'debounced' });
  notify('success', '已应用缝合结果到当前预设');
  return 'in_use';
}

function cloneJson(v) {
  return JSON.parse(JSON.stringify(v));
}

export function buildDualPresetSession(sourceName, baseName) {
  const sourcePreset = cloneJson(callTH('getPreset', sourceName) || {});
  const basePreset = cloneJson(callTH('getPreset', baseName) || {});
  const sPrompts = Array.isArray(sourcePreset.prompts) ? sourcePreset.prompts : [];
  const bPrompts = Array.isArray(basePreset.prompts) ? basePreset.prompts : [];
  const origMap = {};

  const sourceEntries = sPrompts.map((p, idx) => {
    const origRef = `s:${idx}`;
    origMap[origRef] = { data: cloneJson(p), sig: JSON.stringify(p) };
    return { _key: genId(), origRef, data: cloneJson(p) };
  });
  const baseEntries = bPrompts.map((p, idx) => {
    const origRef = `b:${idx}`;
    origMap[origRef] = { data: cloneJson(p), sig: JSON.stringify(p) };
    return { _key: genId(), origRef, data: cloneJson(p) };
  });

  return {
    v: 3,
    kind: 'preset',
    sourceName,
    baseName,
    origSourcePreset: sourcePreset,
    origBasePreset: basePreset,
    origSourceSig: JSON.stringify(sPrompts),
    origBaseSig: JSON.stringify(bPrompts),
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
    migrateSettings: false,
    migrateSettingsDir: 'none',
    sourceDirty: false,
    baseDirty: false,
    dirty: false,
    undoStack: [],
    redoStack: [],
  };
}

export function recomputePresetSessionDirty(session) {
  if (!session || session.v !== 3) return false;
  const sCur = JSON.stringify(session.sourceEntries.map((x) => x.data));
  const bCur = JSON.stringify(session.baseEntries.map((x) => x.data));
  const dir = session.migrateSettingsDir || (session.migrateSettings ? 'a2b' : 'none');
  session.migrateSettingsDir = dir;
  session.migrateSettings = dir === 'a2b';
  session.sourceDirty = sCur !== session.origSourceSig || dir === 'b2a';
  session.baseDirty = bCur !== session.origBaseSig || dir === 'a2b';
  session.dirty = session.sourceDirty || session.baseDirty;
  return session.dirty;
}

export function pushPresetSessionUndo(session) {
  if (!session || session.v !== 3) return;
  session.undoStack = session.undoStack || [];
  session.undoStack.push({
    sourceEntries: cloneJson(session.sourceEntries),
    baseEntries: cloneJson(session.baseEntries),
    migrateSettings: !!session.migrateSettings,
    migrateSettingsDir: session.migrateSettingsDir || 'none',
  });
  if (session.undoStack.length > 30) session.undoStack.shift();
  session.redoStack = [];
}

export function undoPresetSession(session) {
  if (!session?.undoStack?.length) return false;
  session.redoStack = session.redoStack || [];
  session.redoStack.push({
    sourceEntries: cloneJson(session.sourceEntries),
    baseEntries: cloneJson(session.baseEntries),
    migrateSettings: !!session.migrateSettings,
    migrateSettingsDir: session.migrateSettingsDir || 'none',
  });
  const prev = session.undoStack.pop();
  session.sourceEntries = prev.sourceEntries;
  session.baseEntries = prev.baseEntries;
  session.migrateSettings = !!prev.migrateSettings;
  session.migrateSettingsDir = prev.migrateSettingsDir || (prev.migrateSettings ? 'a2b' : 'none');
  session.sourceSelected = new Set();
  session.baseSelected = new Set();
  recomputePresetSessionDirty(session);
  if (session.diffMarks) session.diffMarks = computePresetGlobalDiff(session).markByKey;
  return true;
}

export function redoPresetSession(session) {
  if (!session?.redoStack?.length) return false;
  session.undoStack = session.undoStack || [];
  session.undoStack.push({
    sourceEntries: cloneJson(session.sourceEntries),
    baseEntries: cloneJson(session.baseEntries),
    migrateSettings: !!session.migrateSettings,
    migrateSettingsDir: session.migrateSettingsDir || 'none',
  });
  const next = session.redoStack.pop();
  session.sourceEntries = next.sourceEntries;
  session.baseEntries = next.baseEntries;
  session.migrateSettings = !!next.migrateSettings;
  session.migrateSettingsDir = next.migrateSettingsDir || (next.migrateSettings ? 'a2b' : 'none');
  session.sourceSelected = new Set();
  session.baseSelected = new Set();
  recomputePresetSessionDirty(session);
  if (session.diffMarks) session.diffMarks = computePresetGlobalDiff(session).markByKey;
  return true;
}

export function findPresetCounterpart(item, targetEntries) {
  if (!item || !Array.isArray(targetEntries)) return null;
  const id = item.data?.id;
  if (id) {
    const byId = targetEntries.find((x) => x.data?.id === id);
    if (byId) return byId;
  }
  const name = (item.data?.name || '').trim();
  if (name) {
    const byName = targetEntries.find((x) => (x.data?.name || '').trim() === name);
    if (byName) return byName;
  }
  return null;
}

export function getPresetPairDiffReasons(srcData, baseData) {
  const reasons = [];
  if (!srcData || !baseData) return reasons;
  if (!!srcData.enabled !== !!baseData.enabled) {
    reasons.push(`开关: A(${srcData.enabled ? '开' : '关'}) vs B(${baseData.enabled ? '开' : '关'})`);
  }
  if ((srcData.content || '') !== (baseData.content || '')) reasons.push('正文内容不同');
  if ((srcData.name || '') !== (baseData.name || '')) reasons.push('名称不同');
  if ((srcData.role || 'system') !== (baseData.role || 'system')) reasons.push('身份不同');
  if (JSON.stringify(srcData.position || null) !== JSON.stringify(baseData.position || null)) {
    reasons.push('位置/深度不同');
  }
  return reasons;
}

export function computePresetGlobalDiff(session) {
  const sList = session.sourceEntries || [];
  const bList = session.baseEntries || [];
  const bByOrig = new Map();
  const bById = new Map();
  const bByName = new Map();
  bList.forEach((b, idx) => {
    if (b.origRef) {
      if (!bByOrig.has(b.origRef)) bByOrig.set(b.origRef, []);
      bByOrig.get(b.origRef).push({ item: b, idx });
    }
    if (b.data?.id) bById.set(b.data.id, { item: b, idx });
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
    let match = s.data?.id ? bById.get(s.data.id) : null;
    if (match && matchedBaseKeys.has(match.item._key)) match = null;
    if (!match && s.data?.name) {
      const cands = bByName.get(s.data.name.trim());
      match = cands?.find((c) => !matchedBaseKeys.has(c.item._key)) || null;
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
      items.push({
        status: 'sourceOnly',
        sourceKey: s._key,
        baseKey: null,
        sourceIdx: sIdx,
        baseIdx: -1,
        name: s.data?.name || s.data?.id || `#${sIdx + 1}`,
        reasons: ['仅 A 侧存在'],
      });
      markByKey.set(s._key, 'sourceOnly');
      return;
    }
    const reasons = getPresetPairDiffReasons(s.data, match.item.data);
    const status = reasons.length > 0 ? 'conflict' : 'same';
    markByKey.set(s._key, status);
    markByKey.set(match.item._key, status);
    items.push({
      status,
      sourceKey: s._key,
      baseKey: match.item._key,
      sourceIdx: sIdx,
      baseIdx: match.idx,
      name: match.item.data?.name || s.data?.name || s.data?.id,
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
      name: b.data?.name || b.data?.id || `#${bIdx + 1}`,
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

export function executePresetMigration(session, opts) {
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

  pushPresetSessionUndo(session);

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
    recomputePresetSessionDirty(session);
    return { movedCount: moving.length, updatedCount: 0, notes: [] };
  }

  const num = dstList.length > 0 ? Math.max(1, Math.min(dstList.length, Math.floor(Number(targetIndex1) || 1))) : 0;
  let insertAt = dstList.length === 0 ? 0 : (placement === 'after' ? num : num - 1);

  const selectedItems = srcList.filter((it) => keySet.has(it._key));
  const usedIds = new Set(dstList.map((x) => x.data?.id).filter(Boolean));
  const fromLabel = fromSide === 'source' ? 'A' : 'B';
  const toLabel = fromSide === 'source' ? 'B' : 'A';
  let movedCount = 0;
  let updatedCount = 0;
  const notes = [];

  selectedItems.forEach((item) => {
    if (!item.origRef) item.origRef = `m:${genId()}`;
    const copyData = cloneJson(item.data);
    const isSys = PRESET_SYSTEM_IDS.has(copyData.id);
    const sameIdTarget = copyData.id ? dstList.find((x) => x.data?.id === copyData.id) : null;
    const sameNameTarget = !sameIdTarget && overwriteMatch && copyData.name
      ? dstList.find((x) => (x.data?.name || '').trim() === copyData.name.trim())
      : null;

    if (isSys && sameIdTarget) {
      sameIdTarget.data = copyData;
      sameIdTarget.origRef = item.origRef;
      sameIdTarget._migTag = { type: 'in', from: fromLabel };
      item._migTag = { type: 'out', to: toLabel };
      updatedCount++;
      notes.push(`系统条目「${copyData.name || copyData.id}」已在目标更新（避免内置 ID 重复）`);
      return;
    }

    if (overwriteMatch && (sameIdTarget || sameNameTarget)) {
      const tgt = sameIdTarget || sameNameTarget;
      copyData.id = tgt.data.id;
      tgt.data = copyData;
      tgt.origRef = item.origRef;
      tgt._migTag = { type: 'in', from: fromLabel };
      if (crossMode === 'copy') item._migTag = { type: 'out', to: toLabel };
      updatedCount++;
      return;
    }

    if (!copyData.id || usedIds.has(copyData.id)) {
      copyData.id = genId();
    }
    usedIds.add(copyData.id);
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
    const kept = srcList.filter((it) => !keySet.has(it._key) || PRESET_SYSTEM_IDS.has(it.data?.id));
    srcList.splice(0, srcList.length, ...kept);
    if (fromSide === 'source') session.sourceSelected.clear();
    else session.baseSelected.clear();
  }

  recomputePresetSessionDirty(session);
  if (session.diffMarks) session.diffMarks = computePresetGlobalDiff(session).markByKey;
  return { movedCount, updatedCount, notes };
}

export async function saveDualPresetSide(session, side, targetMode, customTargetName) {
  const isBase = side !== 'source';
  const baseObj = cloneJson(isBase ? session.origBasePreset : session.origSourcePreset);
  const targetEntries = isBase ? session.baseEntries : session.sourceEntries;
  baseObj.prompts = targetEntries.map((x) => cloneJson(x.data));

  const paramDir = session.migrateSettingsDir || (session.migrateSettings ? 'a2b' : 'none');
  if (isBase && paramDir === 'a2b' && session.origSourcePreset?.settings) {
    baseObj.settings = cloneJson(session.origSourcePreset.settings);
  } else if (!isBase && paramDir === 'b2a' && session.origBasePreset?.settings) {
    baseObj.settings = cloneJson(session.origBasePreset.settings);
  }

  if (targetMode === 'new') {
    const name = (customTargetName || '').trim();
    if (!name) throw new Error('请输入新预设名称');
    await callTH('createOrReplacePreset', name, baseObj, { render: 'debounced' });
    callTH('loadPreset', name);
    notify('success', `已生成并切换到缝合预设「${name}」`);
    return name;
  }

  const saveTarget = isBase ? session.baseName : session.sourceName;
  await createAutoBackupSnapshot('preset', saveTarget || 'in_use', '缝合覆盖前');
  if (saveTarget && saveTarget !== 'in_use') {
    await callTH('replacePreset', saveTarget, baseObj, { render: 'debounced' });
    if (callTH('getLoadedPresetName') === saveTarget) {
      await callTH('replacePreset', 'in_use', baseObj, { render: 'debounced' });
    }
    notify('success', `已将结果覆盖保存至预设「${saveTarget}」`);
  } else {
    await callTH('replacePreset', 'in_use', baseObj, { render: 'debounced' });
    notify('success', '已应用结果到当前预设');
  }

  if (isBase) {
    session.origBasePreset = cloneJson(baseObj);
    session.origBaseSig = JSON.stringify(baseObj.prompts);
    if (paramDir === 'a2b') {
      session.migrateSettingsDir = 'none';
      session.migrateSettings = false;
    }
  } else {
    session.origSourcePreset = cloneJson(baseObj);
    session.origSourceSig = JSON.stringify(baseObj.prompts);
    if (paramDir === 'b2a') {
      session.migrateSettingsDir = 'none';
      session.migrateSettings = false;
    }
  }
  recomputePresetSessionDirty(session);
  return saveTarget;
}

export function hydratePresetMergeDraft(draft) {
  if (!draft) return null;
  if (draft.v === 3) {
    const session = buildDualPresetSession(draft.sourceName, draft.baseName);
    const pool = Array.isArray(draft.dataPool) ? draft.dataPool : [];
    const decodeSide = (encodedList) => (encodedList || []).map((token) => {
      if (typeof token === 'string') {
        const orig = session.origMap[token];
        if (!orig) return null;
        return { _key: genId(), origRef: token, data: cloneJson(orig.data) };
      }
      if (token && typeof token === 'object') {
        if (typeof token.p === 'number' && pool[token.p]) {
          return { _key: genId(), origRef: token.r || null, _migTag: token.mt || null, data: cloneJson(pool[token.p]) };
        }
        if (token.d) {
          return { _key: genId(), origRef: token.r || null, _migTag: token.mt || null, data: cloneJson(token.d) };
        }
        if (token.r && session.origMap[token.r]) {
          const data = cloneJson(session.origMap[token.r].data);
          if (token.id !== undefined) data.id = token.id;
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
    session.migrateSettings = !!draft.migrateSettings;
    session.migrateSettingsDir = draft.migrateSettingsDir || (draft.migrateSettings ? 'a2b' : 'none');
    if (Array.isArray(draft.undoStack)) {
      session.undoStack = draft.undoStack.map((snap) => ({
        sourceEntries: decodeSide(snap.s),
        baseEntries: decodeSide(snap.b),
        migrateSettings: !!snap.ms,
        migrateSettingsDir: snap.msd || (snap.ms ? 'a2b' : 'none'),
      }));
    }
    if (Array.isArray(draft.redoStack)) {
      session.redoStack = draft.redoStack.map((snap) => ({
        sourceEntries: decodeSide(snap.s),
        baseEntries: decodeSide(snap.b),
        migrateSettings: !!snap.ms,
        migrateSettingsDir: snap.msd || (snap.ms ? 'a2b' : 'none'),
      }));
    }
    if (draft._pendingCustom) {
      const pc = cloneJson(draft._pendingCustom);
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
    recomputePresetSessionDirty(session);
    return session;
  }

  if (draft.v !== 2) return draft;
  const session = buildPresetDiffSession(draft.oldName, draft.newName);
  session.filter = draft.filter || session.filter;
  session.query = draft.query || '';
  session.controlsOpen = !!draft.controlsOpen;
  session.migrateSettings = !!draft.migrateSettings;
  session.dirty = !!draft.dirty;
  const overrides = draft.entryOverrides || {};
  session.entries.forEach((it) => {
    const ov = overrides[it.key];
    if (!ov) return;
    if (ov.expanded) it.expanded = true;
    if (ov.stateOnly && it.newPrompt) {
      const copy = JSON.parse(JSON.stringify(it.newPrompt));
      copy.enabled = !!ov.enabled;
      it.customPrompt = copy;
      it.choice = 'custom';
    } else if (ov.choice === 'custom' && ov.customPrompt) {
      it.customPrompt = JSON.parse(JSON.stringify(ov.customPrompt));
      it.choice = 'custom';
    } else if (ov.choice) {
      it.choice = ov.choice;
    }
  });
  if (draft._pendingCustom) {
    const pc = JSON.parse(JSON.stringify(draft._pendingCustom));
    const entry = session.entries.find((x) => x.key === pc.entryKey);
    if (entry && pc.draft) {
      if (pc.draft.oldContent === undefined) pc.draft.oldContent = entry.oldPrompt?.content || '';
      if (pc.draft.newContent === undefined) pc.draft.newContent = entry.newPrompt?.content || '';
    }
    session._pendingCustom = pc;
  }
  return session;
}
