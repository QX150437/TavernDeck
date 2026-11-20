
import { APP_NAME, callTH, notify, genId, formatTime, makeItemKey, cloneItemRef } from './utils.js';
import { state, getActiveScheme } from './store.js';
import { applyItemMutations, refreshAllCatalogs } from './catalog.js';

function collectExternalRefsFromGroups(groups, map) {
  if (!Array.isArray(groups)) return;
  groups.forEach((g) => {
    (g.items || []).forEach((it) => {
      if (it && it.type !== 'preset') {
        const k = it.key || makeItemKey(it);
        if (k && !map.has(k)) map.set(k, it);
      }
    });
    if (Array.isArray(g.children)) collectExternalRefsFromGroups(g.children, map);
  });
}

export function captureCurrentSnapshotData(name, mode) {
  const preset = callTH('getPreset', 'in_use');
  const prompts = preset && Array.isArray(preset.prompts) ? preset.prompts : [];
  let enabledCount = 0;
  const promptStates = prompts.map((p) => {
    const en = !!p.enabled;
    if (en) enabledCount++;
    return { id: String(p.id), name: String(p.name || p.id), enabled: en };
  });

  const extMap = new Map();
  collectExternalRefsFromGroups(getActiveScheme().groups, extMap);
  const externalStates = [];
  extMap.forEach((ref, k) => {
    const cat = state.catalog.byKey.get(k);
    if (cat) {
      externalStates.push({
        key: k,
        ref: cloneItemRef(cat.ref),
        name: cat.name,
        enabled: !!cat.enabled,
      });
    }
  });

  const snap = {
    id: genId(),
    name: name || `${state.presetName} · ${formatTime(Date.now())}`,
    presetName: state.presetName,
    mode: mode === 'full' ? 'full' : 'state',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stats: { enabledCount, totalCount: promptStates.length },
    promptStates,
    externalStates,
  };

  if (snap.mode === 'full' && preset) {
    snap.fullPresetData = {
      settings: JSON.parse(JSON.stringify(preset.settings || {})),
      prompts: JSON.parse(JSON.stringify(preset.prompts || [])),
      prompts_unused: JSON.parse(JSON.stringify(preset.prompts_unused || [])),
    };
  }
  return snap;
}

export function computeSnapshotDiff(snap) {
  const byId = new Map();
  const byName = new Map();
  state.catalog.preset.forEach((p) => {
    byId.set(p.ref.id, p);
    if (!byName.has(p.name)) byName.set(p.name, p);
  });

  const diffs = [];
  (snap.promptStates || []).forEach((ps) => {
    const cur = byId.get(ps.id) || byName.get(ps.name);
    if (cur && !!cur.enabled !== !!ps.enabled) {
      diffs.push({ name: cur.name, from: !!cur.enabled, to: !!ps.enabled, type: 'preset' });
    }
  });
  (snap.externalStates || []).forEach((es) => {
    const cur = state.catalog.byKey.get(es.key);
    if (cur && !!cur.enabled !== !!es.enabled) {
      diffs.push({
        name: cur.name,
        from: !!cur.enabled,
        to: !!es.enabled,
        type: es.ref ? es.ref.type : 'external',
      });
    }
  });
  return diffs;
}

export async function applySnapshot(snap, restoreFull) {
  if (!snap || state.isBusy) return false;
  state.isBusy = true;
  try {
    if (restoreFull && snap.mode === 'full' && snap.fullPresetData) {
      await callTH('updatePresetWith', 'in_use', (preset) => {
        preset.settings = JSON.parse(JSON.stringify(snap.fullPresetData.settings || preset.settings));
        preset.prompts = JSON.parse(JSON.stringify(snap.fullPresetData.prompts || preset.prompts));
        preset.prompts_unused = JSON.parse(JSON.stringify(snap.fullPresetData.prompts_unused || preset.prompts_unused || []));
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

    const extMutations = [];
    (snap.externalStates || []).forEach((es) => {
      if (es.ref && state.catalog.byKey.has(es.key)) {
        const cur = state.catalog.byKey.get(es.key);
        if (!!cur.enabled !== !!es.enabled) {
          extMutations.push({ ref: es.ref, enabled: !!es.enabled });
        }
      }
    });

    state.isBusy = false;
    if (extMutations.length > 0) {
      await applyItemMutations(extMutations);
    } else {
      await refreshAllCatalogs();
    }
    notify('success', `已应用快照「${snap.name}」`);
    return true;
  } catch (e) {
    state.isBusy = false;
    console.error(`[${APP_NAME}] 恢复快照失败:`, e);
    notify('error', `恢复快照失败: ${e && e.message ? e.message : e}`);
    return false;
  }
}
