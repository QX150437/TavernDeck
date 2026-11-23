import {
  callTH, hasTH, notify, genId, formatTime,
  computeLineDiff, cloneWorldbookEntries, cloneWorldbookEntry,
  formatKeysInput, keysSignature, downloadJsonFile, logWarn, logError,
} from './utils.js';
import {
  state, saveStore,
  getSnapshotPayload, setSnapshotPayload, deleteSnapshotPayload, serializeRegExpDeep,
} from './store.js';
import { refreshAllCatalogs, refreshWorldbookCatalog } from './catalog.js';
import { PRESET_SETTING_FIELDS } from './preset-manager.js';

const MAX_AUTO_SNAPSHOTS = 10;

async function pruneAutoSnapshots() {
  const list = state.store.snapshots || [];
  const autoUnpinned = list
    .filter((s) => s && s.auto && !s.pinned)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (autoUnpinned.length <= MAX_AUTO_SNAPSHOTS) return;
  const toRemove = autoUnpinned.slice(0, autoUnpinned.length - MAX_AUTO_SNAPSHOTS);
  const toRemoveIds = new Set(toRemove.map((s) => s.id));
  state.store.snapshots = list.filter((s) => !toRemoveIds.has(s.id));
  await Promise.all(toRemove.map((s) => deleteSnapshotPayload(s)));
}

export async function captureCurrentSnapshotData(name, mode, opts = {}) {
  const targetPreset = opts.presetName || state.presetName || '当前预设';
  const preset = callTH('getPreset', opts.sourceName || 'in_use');
  const prompts = preset && Array.isArray(preset.prompts) ? preset.prompts : [];
  let enabledCount = 0;
  const promptStates = prompts.map((p) => {
    const en = !!p.enabled;
    if (en) enabledCount++;
    return { id: String(p.id), name: String(p.name || p.id), enabled: en };
  });

  const snapId = opts.id || genId();
  const resolvedMode = mode === 'full' ? 'full' : 'state';
  let payloadBytes = 0;
  let payloadFile = '';
  if (resolvedMode === 'full' && preset) {
    const saved = await setSnapshotPayload(snapId, {
      fullPresetData: {
        settings: JSON.parse(JSON.stringify(preset.settings || {})),
        prompts: JSON.parse(JSON.stringify(preset.prompts || [])),
        prompts_unused: JSON.parse(JSON.stringify(preset.prompts_unused || [])),
      },
    }, { prevFileName: opts.prevFileName });
    payloadBytes = saved.bytes;
    payloadFile = saved.fileName;
  } else if (opts.prevFileName) {
    await deleteSnapshotPayload({ id: snapId, payloadFile: opts.prevFileName });
  }

  return {
    id: snapId,
    kind: 'preset',
    name: name || `${targetPreset} · ${formatTime(Date.now())}`,
    note: typeof opts.note === 'string' ? opts.note.trim() : '',
    pinned: !!opts.pinned,
    auto: !!opts.auto,
    targetName: targetPreset,
    presetName: targetPreset,
    mode: resolvedMode,
    createdAt: opts.createdAt || Date.now(),
    updatedAt: Date.now(),
    payloadBytes,
    ...(payloadFile ? { payloadFile } : {}),
    stats: {
      enabledCount,
      totalCount: promptStates.length,
      unusedCount: Array.isArray(preset?.prompts_unused) ? preset.prompts_unused.length : 0,
    },
    promptStates,
  };
}

export async function captureWorldbookSnapshotData(bookName, name, mode, opts = {}) {
  if (!bookName) throw new Error('请选择要创建快照的世界书');
  const rawEntries = await callTH('getWorldbook', bookName);
  const entries = cloneWorldbookEntries(rawEntries);
  let enabledCount = 0;
  const entryStates = entries.map((e) => {
    const en = !!e.enabled;
    if (en) enabledCount++;
    return { uid: Number(e.uid), name: String(e.name || `条目 #${e.uid}`), enabled: en };
  });

  const snapId = opts.id || genId();
  const resolvedMode = mode === 'full' ? 'full' : 'state';
  let payloadBytes = 0;
  let payloadFile = '';
  if (resolvedMode === 'full') {
    const saved = await setSnapshotPayload(snapId, {
      fullWorldbookData: entries,
    }, { prevFileName: opts.prevFileName });
    payloadBytes = saved.bytes;
    payloadFile = saved.fileName;
  } else if (opts.prevFileName) {
    await deleteSnapshotPayload({ id: snapId, payloadFile: opts.prevFileName });
  }

  return {
    id: snapId,
    kind: 'worldbook',
    name: name || `${bookName} · ${formatTime(Date.now())}`,
    note: typeof opts.note === 'string' ? opts.note.trim() : '',
    pinned: !!opts.pinned,
    auto: !!opts.auto,
    targetName: bookName,
    presetName: bookName,
    mode: resolvedMode,
    createdAt: opts.createdAt || Date.now(),
    updatedAt: Date.now(),
    payloadBytes,
    ...(payloadFile ? { payloadFile } : {}),
    stats: {
      enabledCount,
      totalCount: entryStates.length,
    },
    entryStates,
  };
}

export async function createAutoBackupSnapshot(kind, targetName, reason = '操作前备份') {
  try {
    const label = `[自动·${reason}] ${targetName || (kind === 'worldbook' ? '世界书' : state.presetName)} · ${formatTime(Date.now())}`;
    let snap = null;
    if (kind === 'worldbook') {
      if (!targetName) return null;
      const books = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
      if (!books.includes(targetName)) return null;
      snap = await captureWorldbookSnapshotData(targetName, label, 'full', { auto: true });
    } else {
      const sourceName = (targetName && targetName !== 'in_use' && targetName !== state.presetName) ? targetName : 'in_use';
      snap = await captureCurrentSnapshotData(label, 'full', {
        presetName: targetName === 'in_use' ? state.presetName : (targetName || state.presetName),
        sourceName,
        auto: true,
      });
    }
    if (!snap) return null;
    state.store.snapshots = state.store.snapshots || [];
    state.store.snapshots.unshift(snap);
    await pruneAutoSnapshots();
    saveStore(state.store);
    return snap;
  } catch (e) {
    logWarn('创建自动备份快照失败', e);
    return null;
  }
}

export async function slimFullSnapshot(snapId) {
  const snap = (state.store.snapshots || []).find((s) => s.id === snapId);
  if (!snap || snap.mode !== 'full') return false;
  await deleteSnapshotPayload(snap, { strict: true });
  snap.mode = 'state';
  snap.payloadBytes = 0;
  delete snap.payloadFile;
  snap.updatedAt = Date.now();
  saveStore(state.store);
  return true;
}

export function computeSnapshotDiff(snap) {
  if (!snap) return [];
  const diffs = [];

  if (snap.kind === 'worldbook') {
    const wbGroup = (state.catalog.worldbook?.groups || []).find((g) => g.bookName === snap.targetName);
    if (!wbGroup) return diffs;
    const byUid = new Map();
    const byName = new Map();
    wbGroup.items.forEach((it) => {
      byUid.set(Number(it.uid), it);
      if (it.name && !byName.has(it.name)) byName.set(it.name, it);
    });
    (snap.entryStates || []).forEach((es) => {
      const cur = byUid.get(Number(es.uid)) || byName.get(es.name);
      if (cur && !!cur.enabled !== !!es.enabled) {
        diffs.push({ name: cur.name, from: !!cur.enabled, to: !!es.enabled, type: 'worldbook' });
      }
    });
    return diffs;
  }

  const byId = new Map();
  const byName = new Map();
  state.catalog.preset.forEach((p) => {
    byId.set(p.ref.id, p);
    if (!byName.has(p.name)) byName.set(p.name, p);
  });

  (snap.promptStates || []).forEach((ps) => {
    const cur = byId.get(ps.id) || byName.get(ps.name);
    if (cur && !!cur.enabled !== !!ps.enabled) {
      diffs.push({ name: cur.name, from: !!cur.enabled, to: !!ps.enabled, type: 'preset' });
    }
  });
  return diffs;
}

function getPresetSettingLabel(key) {
  const f = PRESET_SETTING_FIELDS.find((x) => x.key === key);
  return f ? f.label : key;
}

function formatWbStrategySummary(e) {
  if (!e) return '';
  const s = e.strategy || {};
  return JSON.stringify({
    type: s.type || 'selective',
    keys: keysSignature(s.keys),
    secLogic: s.keys_secondary?.logic || 'and_any',
    secKeys: keysSignature(s.keys_secondary?.keys),
    scan: s.scan_depth ?? 'same_as_global',
  });
}

export async function computeDetailedSnapshotDiff(targetSnap, baseSnap = null) {
  const isCompare = !!baseSnap;
  const kind = targetSnap.kind === 'worldbook' ? 'worldbook' : 'preset';
  const targetPayload = targetSnap.mode === 'full' ? await getSnapshotPayload(targetSnap) : null;
  const basePayload = baseSnap && baseSnap.mode === 'full' ? await getSnapshotPayload(baseSnap) : null;

  const result = {
    kind,
    isCompare,
    hasFullPayload: !!targetPayload,
    missingBook: false,
    switchDiffs: [],
    contentDiffs: [],
    settingDiffs: [],
    structDiffs: [],
    totalCount: 0,
  };

  if (kind === 'worldbook') {
    let baseEntries = null;
    let baseStates = null;

    if (isCompare) {
      baseStates = baseSnap.entryStates || [];
      baseEntries = basePayload?.fullWorldbookData || null;
    } else {
      const books = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
      if (!books.includes(targetSnap.targetName)) {
        result.missingBook = true;
      } else {
        try {
          baseEntries = cloneWorldbookEntries(await callTH('getWorldbook', targetSnap.targetName));
          baseStates = baseEntries.map((e) => ({ uid: Number(e.uid), name: String(e.name || `条目 #${e.uid}`), enabled: !!e.enabled }));
        } catch (e) {
          result.missingBook = true;
        }
      }
    }

    const targetEntries = targetPayload?.fullWorldbookData || null;
    const targetStates = targetSnap.entryStates || [];

    if (!result.missingBook && Array.isArray(baseStates)) {
      const baseByUid = new Map();
      const baseByName = new Map();
      baseStates.forEach((s) => {
        baseByUid.set(Number(s.uid), s);
        if (s.name && !baseByName.has(s.name)) baseByName.set(s.name, s);
      });
      const baseFullByUid = new Map();
      const baseFullByName = new Map();
      (baseEntries || []).forEach((e) => {
        baseFullByUid.set(Number(e.uid), e);
        if (e.name && !baseFullByName.has(e.name)) baseFullByName.set(e.name, e);
      });

      const matchedBaseUids = new Set();

      targetStates.forEach((ts, idx) => {
        const matchedState = baseByUid.get(Number(ts.uid)) || baseByName.get(ts.name);
        const snapEntry = targetEntries ? (targetEntries.find((e) => Number(e.uid) === Number(ts.uid)) || targetEntries[idx]) : null;
        if (!matchedState) {
          result.structDiffs.push({
            diffId: `struct:wb:snap:${ts.uid}:${idx}`,
            change: 'in_snap_only',
            uid: ts.uid,
            name: ts.name,
            restorable: !!snapEntry,
            snapEntry: snapEntry ? cloneWorldbookEntry(snapEntry) : null,
          });
          return;
        }

        matchedBaseUids.add(Number(matchedState.uid));
        if (!!matchedState.enabled !== !!ts.enabled) {
          result.switchDiffs.push({
            diffId: `sw:wb:${ts.uid}`,
            scope: 'wbEntry',
            uid: ts.uid,
            baseUid: matchedState.uid,
            name: ts.name || matchedState.name,
            from: !!matchedState.enabled,
            to: !!ts.enabled,
            restorable: true,
          });
        }

        if (snapEntry && baseEntries) {
          const curEntry = baseFullByUid.get(Number(matchedState.uid)) || baseFullByName.get(ts.name);
          if (curEntry) {
            const metaChanges = [];
            if ((curEntry.name || '') !== (snapEntry.name || '')) metaChanges.push(`标题: ${curEntry.name} → ${snapEntry.name}`);
            if (formatWbStrategySummary(curEntry) !== formatWbStrategySummary(snapEntry)) {
              metaChanges.push(`策略/关键词: [${formatKeysInput(curEntry.strategy?.keys)}] → [${formatKeysInput(snapEntry.strategy?.keys)}]`);
            }
            if (JSON.stringify(curEntry.position || null) !== JSON.stringify(snapEntry.position || null)) {
              metaChanges.push(`位置/顺: ${curEntry.position?.type}(顺${curEntry.position?.order ?? 100}) → ${snapEntry.position?.type}(顺${snapEntry.position?.order ?? 100})`);
            }
            if (
              (curEntry.probability ?? 100) !== (snapEntry.probability ?? 100)
              || JSON.stringify(curEntry.recursion || null) !== JSON.stringify(snapEntry.recursion || null)
              || JSON.stringify(curEntry.effect || null) !== JSON.stringify(snapEntry.effect || null)
            ) {
              metaChanges.push('概率/递归/时效参数不同');
            }
            const contentChanged = (curEntry.content || '') !== (snapEntry.content || '');
            if (contentChanged || metaChanges.length > 0) {
              result.contentDiffs.push({
                diffId: `ct:wb:${ts.uid}`,
                scope: 'wbEntry',
                uid: ts.uid,
                baseUid: matchedState.uid,
                name: snapEntry.name || curEntry.name || `#${ts.uid}`,
                contentChanged,
                metaChanges,
                lineDiffs: contentChanged ? computeLineDiff(curEntry.content || '', snapEntry.content || '') : [],
                snapEntry: cloneWorldbookEntry(snapEntry),
                restorable: true,
              });
            }
          }
        }
      });

      baseStates.forEach((bs, idx) => {
        if (!matchedBaseUids.has(Number(bs.uid))) {
          result.structDiffs.push({
            diffId: `struct:wb:cur:${bs.uid}:${idx}`,
            change: 'in_cur_only',
            uid: bs.uid,
            name: bs.name,
            restorable: !!targetPayload,
          });
        }
      });
    }

    result.totalCount = result.switchDiffs.length + result.contentDiffs.length + result.structDiffs.length;
    return result;
  }

  let basePreset = null;
  let basePromptStates = null;

  if (isCompare) {
    basePromptStates = baseSnap.promptStates || [];
    basePreset = basePayload?.fullPresetData || null;
  } else {
    try {
      basePreset = callTH('getPreset', 'in_use');
    } catch (e) {
      basePreset = null;
    }
    const prompts = Array.isArray(basePreset?.prompts) ? basePreset.prompts : [];
    basePromptStates = prompts.map((p) => ({ id: String(p.id), name: String(p.name || p.id), enabled: !!p.enabled }));
  }

  const targetPreset = targetPayload?.fullPresetData || null;
  const targetPromptStates = targetSnap.promptStates || [];

  const baseById = new Map();
  const baseByName = new Map();
  (basePromptStates || []).forEach((ps) => {
    baseById.set(ps.id, ps);
    if (ps.name && !baseByName.has(ps.name)) baseByName.set(ps.name, ps);
  });

  const baseFullById = new Map();
  const baseFullByName = new Map();
  (basePreset?.prompts || []).forEach((p) => {
    baseFullById.set(String(p.id), p);
    if (p.name && !baseFullByName.has(p.name)) baseFullByName.set(p.name, p);
  });

  const matchedBaseIds = new Set();

  targetPromptStates.forEach((ts, idx) => {
    const matched = baseById.get(ts.id) || baseByName.get(ts.name);
    const snapPrompt = targetPreset?.prompts
      ? (targetPreset.prompts.find((p) => String(p.id) === ts.id) || targetPreset.prompts[idx])
      : null;

    if (!matched) {
      result.structDiffs.push({
        diffId: `struct:pm:snap:${ts.id}`,
        change: 'in_snap_only',
        id: ts.id,
        name: ts.name,
        restorable: !!snapPrompt,
        snapPrompt: snapPrompt ? JSON.parse(JSON.stringify(snapPrompt)) : null,
      });
      return;
    }

    matchedBaseIds.add(matched.id);
    if (!!matched.enabled !== !!ts.enabled) {
      result.switchDiffs.push({
        diffId: `sw:pm:${ts.id}`,
        scope: 'prompt',
        id: ts.id,
        baseId: matched.id,
        name: ts.name || matched.name,
        from: !!matched.enabled,
        to: !!ts.enabled,
        restorable: true,
      });
    }

    if (snapPrompt && basePreset?.prompts) {
      const curPrompt = baseFullById.get(matched.id) || baseFullByName.get(ts.name);
      if (curPrompt) {
        const metaChanges = [];
        if ((curPrompt.name || '') !== (snapPrompt.name || '')) metaChanges.push(`名称: ${curPrompt.name} → ${snapPrompt.name}`);
        if ((curPrompt.role || 'system') !== (snapPrompt.role || 'system')) metaChanges.push(`身份: ${curPrompt.role} → ${snapPrompt.role}`);
        if (JSON.stringify(curPrompt.position || null) !== JSON.stringify(snapPrompt.position || null)) {
          metaChanges.push('插入位置/深度不同');
        }
        const contentChanged = (curPrompt.content || '') !== (snapPrompt.content || '');
        if (contentChanged || metaChanges.length > 0) {
          result.contentDiffs.push({
            diffId: `ct:pm:${ts.id}`,
            scope: 'prompt',
            id: ts.id,
            baseId: matched.id,
            name: snapPrompt.name || curPrompt.name || ts.id,
            contentChanged,
            metaChanges,
            lineDiffs: contentChanged ? computeLineDiff(curPrompt.content || '', snapPrompt.content || '') : [],
            snapPrompt: JSON.parse(JSON.stringify(snapPrompt)),
            restorable: true,
          });
        }
      }
    }
  });

  (basePromptStates || []).forEach((bs) => {
    if (!matchedBaseIds.has(bs.id)) {
      result.structDiffs.push({
        diffId: `struct:pm:cur:${bs.id}`,
        change: 'in_cur_only',
        id: bs.id,
        name: bs.name,
        restorable: !!targetPayload,
      });
    }
  });

  if (targetPreset?.settings && basePreset?.settings) {
    const allKeys = new Set([
      ...Object.keys(targetPreset.settings),
      ...Object.keys(basePreset.settings),
    ]);
    allKeys.forEach((k) => {
      const cv = basePreset.settings[k];
      const sv = targetPreset.settings[k];
      if (JSON.stringify(cv) !== JSON.stringify(sv)) {
        result.settingDiffs.push({
          diffId: `st:${k}`,
          key: k,
          label: getPresetSettingLabel(k),
          from: cv,
          to: sv,
          restorable: true,
        });
      }
    });
  }

  result.totalCount = result.switchDiffs.length
    + result.contentDiffs.length
    + result.settingDiffs.length
    + result.structDiffs.length;
  return result;
}

export async function applySnapshot(snap, restoreFull, opts = {}) {
  if (!snap || state.isBusy) return false;
  state.isBusy = true;
  try {
    if (!opts.skipAutoBackup) {
      const autoSnap = await createAutoBackupSnapshot(
        snap.kind === 'worldbook' ? 'worldbook' : 'preset',
        snap.kind === 'worldbook' ? snap.targetName : state.presetName,
        '恢复前备份',
      );
      if (autoSnap) state.lastUndoSnapshotId = autoSnap.id;
    }

    const payload = snap.mode === 'full' ? await getSnapshotPayload(snap) : null;

    if (snap.kind === 'worldbook') {
      const bookName = snap.targetName;
      const allBooks = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
      const exists = allBooks.includes(bookName);

      if (restoreFull && payload?.fullWorldbookData) {
        const copy = cloneWorldbookEntries(payload.fullWorldbookData);
        if (exists) await callTH('replaceWorldbook', bookName, copy, { render: 'debounced' });
        else await callTH('createWorldbook', bookName, copy);
      } else {
        if (!exists) throw new Error(`世界书「${bookName}」已不存在，无法仅恢复开关状态`);
        const byUid = new Map();
        const byName = new Map();
        (snap.entryStates || []).forEach((es) => {
          byUid.set(Number(es.uid), !!es.enabled);
          if (es.name && !byName.has(es.name)) byName.set(es.name, !!es.enabled);
        });
        await callTH('updateWorldbookWith', bookName, (entries) =>
          (entries || []).map((e) => {
            if (byUid.has(Number(e.uid))) e.enabled = byUid.get(Number(e.uid));
            else if (e.name && byName.has(e.name)) e.enabled = byName.get(e.name);
            return e;
          }),
        );
      }

      state.isBusy = false;
      await refreshWorldbookCatalog(false);
      notify('success', `已应用世界书快照「${snap.name}」`);
      return true;
    }

    if (restoreFull && payload?.fullPresetData) {
      const fp = payload.fullPresetData;
      await callTH('updatePresetWith', 'in_use', (preset) => {
        preset.settings = JSON.parse(JSON.stringify(fp.settings || preset.settings));
        preset.prompts = JSON.parse(JSON.stringify(fp.prompts || preset.prompts));
        preset.prompts_unused = JSON.parse(JSON.stringify(fp.prompts_unused || preset.prompts_unused || []));
        return preset;
      }, { render: 'immediate' });
    } else {
      const stateById = new Map();
      const stateByName = new Map();
      (snap.promptStates || []).forEach((ps) => {
        stateById.set(ps.id, !!ps.enabled);
        if (!stateByName.has(ps.name)) stateByName.set(ps.name, !!ps.enabled);
      });
      await callTH('updatePresetWith', 'in_use', (preset) => {
        if (preset && Array.isArray(preset.prompts)) {
          preset.prompts.forEach((p) => {
            if (stateById.has(p.id)) p.enabled = stateById.get(p.id);
            else if (stateByName.has(p.name)) p.enabled = stateByName.get(p.name);
          });
        }
        return preset;
      }, { render: 'immediate' });
    }

    state.isBusy = false;
    await refreshAllCatalogs();
    notify('success', `已应用快照「${snap.name}」`);
    return true;
  } catch (e) {
    state.isBusy = false;
    logError('恢复快照失败', e);
    notify('error', `恢复快照失败: ${e && e.message ? e.message : e}`);
    return false;
  }
}

export async function applySelectiveSnapshot(snap, diffObj, selectedDiffIds) {
  if (!snap || !diffObj || !(selectedDiffIds instanceof Set) || selectedDiffIds.size === 0 || state.isBusy) {
    return false;
  }
  state.isBusy = true;
  try {
    const autoSnap = await createAutoBackupSnapshot(
      snap.kind === 'worldbook' ? 'worldbook' : 'preset',
      snap.kind === 'worldbook' ? snap.targetName : state.presetName,
      '局部恢复前备份',
    );
    if (autoSnap) state.lastUndoSnapshotId = autoSnap.id;

    if (snap.kind === 'worldbook') {
      const bookName = snap.targetName;
      const curEntries = cloneWorldbookEntries(await callTH('getWorldbook', bookName));
      const switchMap = new Map();
      const contentMap = new Map();
      diffObj.switchDiffs.forEach((d) => {
        if (selectedDiffIds.has(d.diffId)) switchMap.set(Number(d.baseUid ?? d.uid), d.to);
      });
      diffObj.contentDiffs.forEach((d) => {
        if (selectedDiffIds.has(d.diffId)) contentMap.set(Number(d.baseUid ?? d.uid), d.snapEntry);
      });

      const removeUids = new Set();
      const addEntries = [];
      diffObj.structDiffs.forEach((d) => {
        if (!selectedDiffIds.has(d.diffId)) return;
        if (d.change === 'in_cur_only') removeUids.add(Number(d.uid));
        else if (d.change === 'in_snap_only' && d.snapEntry) addEntries.push(cloneWorldbookEntry(d.snapEntry));
      });

      const nextEntries = [];
      curEntries.forEach((e) => {
        const uid = Number(e.uid);
        if (removeUids.has(uid)) return;
        let next = e;
        if (contentMap.has(uid)) {
          const prevEnabled = next.enabled;
          next = cloneWorldbookEntry(contentMap.get(uid));
          next.uid = uid;
          next.enabled = prevEnabled;
        }
        if (switchMap.has(uid)) {
          next.enabled = switchMap.get(uid);
        }
        nextEntries.push(next);
      });
      addEntries.forEach((ae) => nextEntries.push(ae));

      await callTH('replaceWorldbook', bookName, nextEntries, { render: 'debounced' });
      state.isBusy = false;
      await refreshWorldbookCatalog(false);
      notify('success', `已局部恢复 ${selectedDiffIds.size} 项差异到「${bookName}」`);
      return true;
    }

    const promptSwitchMap = new Map();
    const promptContentMap = new Map();

    diffObj.switchDiffs.forEach((d) => {
      if (!selectedDiffIds.has(d.diffId)) return;
      if (d.scope === 'prompt') promptSwitchMap.set(String(d.baseId ?? d.id), d.to);
    });
    diffObj.contentDiffs.forEach((d) => {
      if (selectedDiffIds.has(d.diffId) && d.scope === 'prompt') {
        promptContentMap.set(String(d.baseId ?? d.id), d.snapPrompt);
      }
    });

    const settingUpdates = diffObj.settingDiffs.filter((d) => selectedDiffIds.has(d.diffId));
    const removePromptIds = new Set();
    const addPrompts = [];
    diffObj.structDiffs.forEach((d) => {
      if (!selectedDiffIds.has(d.diffId)) return;
      if (d.change === 'in_cur_only') removePromptIds.add(String(d.id));
      else if (d.change === 'in_snap_only' && d.snapPrompt) addPrompts.push(JSON.parse(JSON.stringify(d.snapPrompt)));
    });

    if (
      promptSwitchMap.size > 0
      || promptContentMap.size > 0
      || settingUpdates.length > 0
      || removePromptIds.size > 0
      || addPrompts.length > 0
    ) {
      await callTH('updatePresetWith', 'in_use', (preset) => {
        if (settingUpdates.length > 0) {
          preset.settings = preset.settings || {};
          settingUpdates.forEach((st) => {
            preset.settings[st.key] = st.to === undefined ? undefined : JSON.parse(JSON.stringify(st.to));
          });
        }
        const nextPrompts = [];
        (preset.prompts || []).forEach((p) => {
          const pid = String(p.id);
          if (removePromptIds.has(pid)) return;
          let next = p;
          if (promptContentMap.has(pid)) {
            const prevEn = !!next.enabled;
            next = JSON.parse(JSON.stringify(promptContentMap.get(pid)));
            next.id = pid;
            next.enabled = prevEn;
          }
          if (promptSwitchMap.has(pid)) {
            next.enabled = promptSwitchMap.get(pid);
          }
          nextPrompts.push(next);
        });
        addPrompts.forEach((ap) => nextPrompts.push(ap));
        preset.prompts = nextPrompts;
        return preset;
      }, { render: 'immediate' });
    }

    state.isBusy = false;
    await refreshAllCatalogs();
    notify('success', `已局部恢复 ${selectedDiffIds.size} 项差异`);
    return true;
  } catch (e) {
    state.isBusy = false;
    logError('局部恢复快照失败', e);
    notify('error', `局部恢复失败: ${e && e.message ? e.message : e}`);
    return false;
  }
}

export async function saveSnapshotAsNewTarget(snap, newName) {
  const clean = String(newName || '').trim();
  if (!clean) throw new Error('请输入新名称');
  const payload = await getSnapshotPayload(snap);
  if (!payload) throw new Error('该快照不包含完整数据，无法另存为独立预设或世界书');

  if (snap.kind === 'worldbook') {
    if (!payload.fullWorldbookData) throw new Error('完整世界书数据不可用');
    const existing = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
    if (existing.includes(clean)) throw new Error(`世界书「${clean}」已存在`);
    await callTH('createWorldbook', clean, cloneWorldbookEntries(payload.fullWorldbookData));
    await refreshWorldbookCatalog(false);
    notify('success', `已将快照另存为新世界书「${clean}」`);
    return clean;
  }

  if (clean === 'in_use') throw new Error('不能使用 in_use 作为预设名称');
  const existing = hasTH('getPresetNames') ? (callTH('getPresetNames') || []) : [];
  if (existing.includes(clean)) throw new Error(`预设「${clean}」已存在`);
  const fp = payload.fullPresetData;
  await callTH('createPreset', clean, {
    settings: JSON.parse(JSON.stringify(fp.settings || {})),
    prompts: JSON.parse(JSON.stringify(fp.prompts || [])),
    prompts_unused: JSON.parse(JSON.stringify(fp.prompts_unused || [])),
    extensions: {},
  });
  await refreshAllCatalogs();
  notify('success', `已将快照另存为新预设「${clean}」`);
  return clean;
}

export async function exportSingleSnapshotAsStandardJson(snap) {
  if (!snap) return;
  const safeName = String(snap.name || snap.targetName || 'snapshot').replace(/[\\/:*?"<>|]/g, '_');
  const payload = snap.mode === 'full' ? await getSnapshotPayload(snap) : null;
  if (snap.mode === 'full' && payload) {
    if (snap.kind === 'worldbook' && payload.fullWorldbookData) {
      downloadJsonFile(serializeRegExpDeep(payload.fullWorldbookData), `${safeName}-世界书.json`);
      notify('success', `已导出标准世界书文件「${safeName}」`);
      return;
    }
    if (snap.kind !== 'worldbook' && payload.fullPresetData) {
      downloadJsonFile({
        settings: payload.fullPresetData.settings || {},
        prompts: payload.fullPresetData.prompts || [],
        prompts_unused: payload.fullPresetData.prompts_unused || [],
        extensions: {},
      }, `${safeName}-预设.json`);
      notify('success', `已导出标准预设文件「${safeName}」`);
      return;
    }
  }
  const copy = JSON.parse(JSON.stringify(snap));
  if (payload) {
    if (payload.fullPresetData) copy.fullPresetData = serializeRegExpDeep(payload.fullPresetData);
    if (payload.fullWorldbookData) copy.fullWorldbookData = serializeRegExpDeep(payload.fullWorldbookData);
  }
  downloadJsonFile({ app: 'TavernDeck', schemaVersion: 3, exportedAt: Date.now(), scope: 'partial', snapshots: [copy] }, `${safeName}-快照.json`);
  notify('success', `已导出快照「${snap.name}」`);
}
