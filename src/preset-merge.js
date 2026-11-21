import { callTH, hasTH, notify, findBestMatchingName, computeLineDiff, logWarn } from './utils.js';

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
