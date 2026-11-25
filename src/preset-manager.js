import { callTH, hasTH, getTH, getST, notify, genId, makeItemKey, downloadJsonFile, logWarn } from './utils.js';
import { hasUnsavedPresetChanges } from './preset-merge.js';
import { state, saveStore } from './store.js';

export const PRESET_SYSTEM_IDS = new Set([
  'main', 'nsfw', 'jailbreak', 'enhanceDefinitions',
  'worldInfoBefore', 'personaDescription', 'charDescription',
  'charPersonality', 'scenario', 'worldInfoAfter',
  'dialogueExamples', 'chatHistory',
]);

export function getPresetSummaryList() {
  const names = hasTH('getPresetNames') ? (callTH('getPresetNames') || []) : [];
  const loadedName = hasTH('getLoadedPresetName') ? (callTH('getLoadedPresetName') || '') : '';
  const inUseUnsaved = loadedName ? hasUnsavedPresetChanges(loadedName) : false;

  const list = names.filter((n) => n && n !== 'in_use').map((name) => {
    let promptCount = 0;
    let enabledCount = 0;
    let unusedCount = 0;
    try {
      const p = callTH('getPreset', name);
      const prompts = Array.isArray(p?.prompts) ? p.prompts : [];
      const unused = Array.isArray(p?.prompts_unused) ? p.prompts_unused : [];
      promptCount = prompts.length;
      enabledCount = prompts.filter((x) => !!x.enabled).length;
      unusedCount = unused.length;
    } catch (e) {
      logWarn(`读取预设「${name}」摘要失败`, e);
    }
    return {
      name,
      isLoaded: name === loadedName,
      isDirty: name === loadedName && inUseUnsaved,
      promptCount,
      enabledCount,
      unusedCount,
    };
  });

  return { loadedName, inUseUnsaved, list };
}

export function getPresetDetail(presetName) {
  const p = callTH('getPreset', presetName);
  const copy = JSON.parse(JSON.stringify(p || {}));
  copy.settings = copy.settings || {};
  copy.prompts = Array.isArray(copy.prompts) ? copy.prompts : [];
  copy.prompts_unused = Array.isArray(copy.prompts_unused) ? copy.prompts_unused : [];
  copy.extensions = copy.extensions || {};
  return copy;
}

export async function savePresetDetail(presetName, presetObj, syncInUse = true) {
  const copy = JSON.parse(JSON.stringify(presetObj));
  await callTH('replacePreset', presetName, copy, { render: 'debounced' });
  if (syncInUse && presetName !== 'in_use') {
    const loaded = hasTH('getLoadedPresetName') ? callTH('getLoadedPresetName') : '';
    if (loaded === presetName) {
      await callTH('replacePreset', 'in_use', JSON.parse(JSON.stringify(copy)), { render: 'debounced' });
    }
  }
}

export async function createNewPresetSafe(name, sourceName = '') {
  const clean = String(name || '').trim();
  if (!clean || clean === 'in_use') throw new Error('无效的预设名称');
  const existing = hasTH('getPresetNames') ? (callTH('getPresetNames') || []) : [];
  if (existing.includes(clean)) throw new Error(`预设「${clean}」已存在`);

  if (sourceName) {
    const src = getPresetDetail(sourceName);
    await callTH('createPreset', clean, src);
  } else {
    await callTH('createPreset', clean);
  }
  notify('success', `已创建预设「${clean}」`);
}

function renamePresetRefsInGroups(groups, oldName, newName) {
  if (!Array.isArray(groups)) return;
  groups.forEach((g) => {
    (g.items || []).forEach((it) => {
      if (it && it.type === 'preset' && it.preset === oldName) {
        it.preset = newName;
        it.key = makeItemKey(it);
      }
    });
    if (Array.isArray(g.children)) renamePresetRefsInGroups(g.children, oldName, newName);
  });
}

export async function renameSavedPresetSafe(oldName, newName) {
  const clean = String(newName || '').trim();
  if (!clean || clean === 'in_use') throw new Error('无效的新预设名称');
  if (clean === oldName) return;
  const ok = await callTH('renamePreset', oldName, clean);
  if (!ok) throw new Error('重命名失败，可能目标名称已存在');

  if (state.store.presetBindings[oldName]) {
    state.store.presetBindings[clean] = state.store.presetBindings[oldName];
    delete state.store.presetBindings[oldName];
  }
  if (state.store.activeSchemeByPreset[oldName]) {
    state.store.activeSchemeByPreset[clean] = state.store.activeSchemeByPreset[oldName];
    delete state.store.activeSchemeByPreset[oldName];
  }
  (state.store.schemes || []).forEach((s) => renamePresetRefsInGroups(s.groups, oldName, clean));
  saveStore(state.store);
  notify('success', `已将预设重命名为「${clean}」`);
}

export async function deleteSavedPresetSafe(name) {
  if (!name || name === 'in_use') throw new Error('不能删除当前实时预设');
  const loadedBefore = hasTH('getLoadedPresetName') ? (callTH('getLoadedPresetName') || '') : '';
  const wasLoaded = loadedBefore === name;
  let fallbackTarget = '';

  if (wasLoaded) {
    const names = hasTH('getPresetNames') ? (callTH('getPresetNames') || []).filter((n) => n && n !== 'in_use') : [];
    const idx = names.indexOf(name);
    const remaining = names.filter((n) => n !== name);
    if (remaining.length > 0) {
      fallbackTarget = (idx >= 0 && idx < names.length - 1) ? names[idx + 1] : remaining[0];
      callTH('loadPreset', fallbackTarget);
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  const ok = await callTH('deletePreset', name);
  if (!ok) {
    if (wasLoaded && fallbackTarget) {
      try { callTH('loadPreset', loadedBefore); } catch (e) {}
    }
    throw new Error(`删除预设「${name}」失败`);
  }

  if (wasLoaded && fallbackTarget) {
    const loadedAfter = hasTH('getLoadedPresetName') ? (callTH('getLoadedPresetName') || '') : '';
    const target = (loadedAfter && loadedAfter !== 'in_use' && loadedAfter !== name) ? loadedAfter : fallbackTarget;
    if (target) {
      if (loadedAfter !== target) {
        try {
          callTH('loadPreset', target);
          await new Promise((r) => setTimeout(r, 80));
        } catch (e) {}
      }
      if (hasUnsavedPresetChanges(target)) {
        try {
          const fresh = getPresetDetail(target);
          await callTH('replacePreset', 'in_use', fresh, { render: 'debounced' });
        } catch (e) {
          logWarn(`删除预设后同步「${target}」到实时预设失败`, e);
        }
      }
      try {
        const th = getTH();
        if (typeof th?.builtin?.saveSettings === 'function') {
          await th.builtin.saveSettings();
        } else {
          await getST()?.saveSettingsDebounced?.();
        }
      } catch (e) {
        logWarn('删除预设后持久化酒馆设置失败', e);
      }
    }
  }

  notify('info', `已删除预设「${name}」`);
}

export function exportPresetFile(name) {
  let payload = null;
  try {
    const pm = getST()?.getPresetManager?.('openai');
    if (pm) {
      const raw = pm.getCompletionPresetByName?.(name) || pm.getPresetSettings?.(name);
      if (raw && typeof raw === 'object') payload = raw;
    }
  } catch (e) {
    logWarn(`从原生 PresetManager 导出预设「${name}」失败，改用助手数据`, e);
  }
  if (!payload) {
    payload = getPresetDetail(name);
  }
  const safeName = (name === 'in_use' ? (state.presetName || 'in_use') : name).replace(/[\\/:*?"<>|]/g, '_');
  downloadJsonFile(payload, `${safeName}.json`);
  notify('success', `已导出预设「${name}」`);
}

export function movePromptsBatchBeforeIndex(list, fromIndices, beforeIdx) {
  if (!Array.isArray(list) || !Array.isArray(fromIndices) || fromIndices.length === 0) return false;
  const idxSet = new Set(fromIndices.map(Number).filter((n) => !Number.isNaN(n) && n >= 0 && n < list.length));
  if (idxSet.size === 0) return false;

  const target = Math.max(0, Math.min(list.length, Number(beforeIdx)));
  if (Number.isNaN(target)) return false;

  const movingItems = [];
  const beforeItems = [];
  const afterItems = [];

  for (let i = 0; i < list.length; i++) {
    if (idxSet.has(i)) movingItems.push(list[i]);
    else if (i < target) beforeItems.push(list[i]);
    else afterItems.push(list[i]);
  }

  const next = [...beforeItems, ...movingItems, ...afterItems];
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== next[i]) { changed = true; break; }
  }
  if (!changed) return false;

  list.splice(0, list.length, ...next);
  return true;
}

export function insertFromUnusedAt(presetData, unusedIndices, targetBeforeIdx) {
  const unused = presetData?.prompts_unused;
  const prompts = presetData?.prompts;
  if (!Array.isArray(unused) || !Array.isArray(prompts)) return 0;

  const idxSet = new Set(unusedIndices.map(Number).filter((n) => !Number.isNaN(n) && n >= 0 && n < unused.length));
  if (idxSet.size === 0) return 0;

  const moved = [];
  const kept = [];
  for (let i = 0; i < unused.length; i++) {
    if (idxSet.has(i)) moved.push(unused[i]);
    else kept.push(unused[i]);
  }

  const target = Math.max(0, Math.min(prompts.length, Number(targetBeforeIdx) || 0));
  presetData.prompts_unused = kept;
  prompts.splice(target, 0, ...moved);
  return moved.length;
}

export function buildNewPromptEntry(fields) {
  const posType = fields.positionType === 'in_chat' ? 'in_chat' : 'relative';
  return {
    id: genId(),
    name: String(fields.name || '新提示词').trim() || '新提示词',
    enabled: fields.enabled !== false,
    role: ['system', 'user', 'assistant'].includes(fields.role) ? fields.role : 'system',
    content: String(fields.content || ''),
    position: posType === 'in_chat'
      ? { type: 'in_chat', depth: Number(fields.depth) || 0, order: Number(fields.order) || 100 }
      : { type: 'relative' },
  };
}

export function normalizePresetRegexList(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.filter(Boolean).map((r) => {
    if (typeof r.script_name === 'string' || typeof r.find_regex === 'string') {
      return JSON.parse(JSON.stringify(r));
    }
    const placement = Array.isArray(r.placement) ? r.placement : [2];
    return {
      id: String(r.id || genId()),
      script_name: String(r.scriptName || r.name || '未命名正则'),
      enabled: r.disabled === undefined ? (r.enabled !== false) : !r.disabled,
      find_regex: String(r.findRegex || ''),
      replace_string: String(r.replaceString || ''),
      trim_strings: Array.isArray(r.trimStrings) ? r.trimStrings.slice() : [],
      source: {
        user_input: placement.includes(1),
        ai_output: placement.includes(2),
        slash_command: placement.includes(3),
        world_info: placement.includes(5),
        reasoning: placement.includes(6),
      },
      destination: {
        display: !r.promptOnly,
        prompt: !r.markdownOnly,
      },
      run_on_edit: !!r.runOnEdit,
      min_depth: r.minDepth ?? null,
      max_depth: r.maxDepth ?? null,
    };
  });
}

export function getPresetRegexes(presetName, presetObj = null) {
  if (hasTH('getTavernRegexes')) {
    try {
      const list = callTH('getTavernRegexes', { type: 'preset', name: presetName || 'in_use' });
      if (Array.isArray(list)) return JSON.parse(JSON.stringify(list));
    } catch (e) {
      logWarn(`读取预设「${presetName}」正则列表失败，尝试回退读取`, e);
    }
  }
  return normalizePresetRegexList(presetObj?.extensions?.regex_scripts);
}

export function buildDefaultPresetRegex(fields = {}) {
  const src = fields.source || {};
  const dst = fields.destination || {};
  return {
    id: fields.id || genId(),
    script_name: String(fields.script_name || '新预设正则').trim() || '新预设正则',
    enabled: fields.enabled !== false,
    find_regex: String(fields.find_regex || ''),
    replace_string: String(fields.replace_string || ''),
    trim_strings: Array.isArray(fields.trim_strings) ? fields.trim_strings.slice() : [],
    source: {
      user_input: !!src.user_input,
      ai_output: fields.source ? !!src.ai_output : true,
      slash_command: !!src.slash_command,
      world_info: !!src.world_info,
      reasoning: !!src.reasoning,
    },
    destination: {
      display: fields.destination ? !!dst.display : true,
      prompt: !!dst.prompt,
    },
    run_on_edit: fields.run_on_edit !== undefined ? !!fields.run_on_edit : true,
    min_depth: fields.min_depth ?? null,
    max_depth: fields.max_depth ?? null,
  };
}

export async function savePresetRegexes(presetName, regexList, syncInUse = true) {
  const nextList = JSON.parse(JSON.stringify(Array.isArray(regexList) ? regexList : []));
  if (hasTH('updateTavernRegexesWith')) {
    await callTH('updateTavernRegexesWith', () => JSON.parse(JSON.stringify(nextList)), { type: 'preset', name: presetName });
    if (syncInUse && presetName !== 'in_use') {
      const loaded = hasTH('getLoadedPresetName') ? callTH('getLoadedPresetName') : '';
      if (loaded === presetName) {
        await callTH('updateTavernRegexesWith', () => JSON.parse(JSON.stringify(nextList)), { type: 'preset', name: 'in_use' });
      }
    }
    return;
  }
  if (hasTH('updatePresetWith')) {
    const toRaw = (r) => {
      const placement = [];
      if (r.source?.user_input) placement.push(1);
      if (r.source?.ai_output) placement.push(2);
      if (r.source?.slash_command) placement.push(3);
      if (r.source?.world_info) placement.push(5);
      if (r.source?.reasoning) placement.push(6);
      return {
        id: r.id || genId(),
        scriptName: r.script_name || '',
        findRegex: r.find_regex || '',
        replaceString: r.replace_string || '',
        trimStrings: Array.isArray(r.trim_strings) ? r.trim_strings : [],
        placement: placement.length > 0 ? placement : [2],
        disabled: !r.enabled,
        markdownOnly: !(r.destination?.prompt),
        promptOnly: !(r.destination?.display),
        runOnEdit: !!r.run_on_edit,
        minDepth: r.min_depth ?? null,
        maxDepth: r.max_depth ?? null,
      };
    };
    const applyFn = (preset) => {
      preset.extensions = preset.extensions || {};
      preset.extensions.regex_scripts = nextList.map(toRaw);
      return preset;
    };
    await callTH('updatePresetWith', presetName, applyFn, { render: 'debounced' });
    if (syncInUse && presetName !== 'in_use') {
      const loaded = hasTH('getLoadedPresetName') ? callTH('getLoadedPresetName') : '';
      if (loaded === presetName) {
        await callTH('updatePresetWith', 'in_use', applyFn, { render: 'debounced' });
      }
    }
  }
}

export const PRESET_SETTING_FIELDS = [
  { key: 'max_context', label: '最大上下文 (Tokens)', type: 'number', min: 512, max: 2000000, step: 512 },
  { key: 'max_completion_tokens', label: '最大回复长度 (Tokens)', type: 'number', min: 16, max: 200000, step: 32 },
  { key: 'reply_count', label: '每次生成回复数', type: 'number', min: 1, max: 10, step: 1 },
  { key: 'should_stream', label: '流式传输 (Stream)', type: 'bool' },
  { key: 'temperature', label: '温度 (Temperature)', type: 'number', min: 0, max: 2, step: 0.05 },
  { key: 'top_p', label: 'Top P', type: 'number', min: 0, max: 1, step: 0.01 },
  { key: 'top_k', label: 'Top K', type: 'number', min: 0, max: 500, step: 1 },
  { key: 'min_p', label: 'Min P', type: 'number', min: 0, max: 1, step: 0.01 },
  { key: 'top_a', label: 'Top A', type: 'number', min: 0, max: 1, step: 0.01 },
  { key: 'repetition_penalty', label: '重复惩罚 (Rep Penalty)', type: 'number', min: 0, max: 2, step: 0.05 },
  { key: 'frequency_penalty', label: '频率惩罚 (Freq Penalty)', type: 'number', min: -2, max: 2, step: 0.05 },
  { key: 'presence_penalty', label: '存在惩罚 (Pres Penalty)', type: 'number', min: -2, max: 2, step: 0.05 },
  { key: 'seed', label: '随机种子 (-1 为随机)', type: 'number', min: -1, max: 2147483647, step: 1 },
  {
    key: 'reasoning_effort',
    label: '推理强度 (Reasoning Effort)',
    type: 'select',
    options: [
      { v: 'auto', t: '自动 (auto)' },
      { v: 'min', t: '最小 (min)' },
      { v: 'low', t: '低 (low)' },
      { v: 'medium', t: '中 (medium)' },
      { v: 'high', t: '高 (high)' },
      { v: 'max', t: '最大 (max)' },
    ],
  },
  { key: 'request_thoughts', label: '请求思考过程 (Request Thoughts)', type: 'bool' },
  { key: 'squash_system_messages', label: '压缩连续系统消息', type: 'bool' },
  { key: 'wrap_user_messages_in_quotes', label: '用引号包裹用户消息', type: 'bool' },
  { key: 'enable_function_calling', label: '启用函数调用 (Tool Use)', type: 'bool' },
  { key: 'enable_web_search', label: '启用网络搜索', type: 'bool' },
  { key: 'request_images', label: '允许模型返回图片', type: 'bool' },
  {
    key: 'allow_sending_images',
    label: '发送图片作为提示词',
    type: 'select',
    options: [
      { v: 'disabled', t: '禁用 (disabled)' },
      { v: 'auto', t: '自动 (auto)' },
      { v: 'low', t: '低精度 (low)' },
      { v: 'high', t: '高精度 (high)' },
    ],
  },
  { key: 'allow_sending_videos', label: '允许发送视频作为提示词', type: 'bool' },
  {
    key: 'character_name_prefix',
    label: '角色名称前缀模式',
    type: 'select',
    options: [
      { v: 'none', t: '不添加 (none)' },
      { v: 'default', t: '默认 (default)' },
      { v: 'content', t: '全部写入正文 (content)' },
      { v: 'completion', t: '写入 name 字段 (completion)' },
    ],
  },
];
