import { callTH, hasTH, logWarn, formatKeysInput } from './utils.js';

function buildCurrentApiOverride(cfg) {
  const model = String(cfg?.model || '').trim();
  return model ? { model } : undefined;
}

function extractJailbreakPrompts(jailbreakPresetName) {
  const name = String(jailbreakPresetName || '').trim();
  if (!name || !hasTH('getPreset')) return [];
  try {
    const preset = callTH('getPreset', name);
    const list = Array.isArray(preset?.prompts) ? preset.prompts : [];
    const out = [];
    list.forEach((p) => {
      if (!p || !p.enabled) return;
      const content = typeof p.content === 'string' ? p.content.trim() : '';
      if (!content) return;
      const role = ['system', 'user', 'assistant'].includes(p.role) ? p.role : 'system';
      out.push({ role, content });
    });
    return out;
  } catch (e) {
    logWarn(`加载破甲预设「${name}」失败，已忽略`, e);
    return [];
  }
}

export function extractJsonFromAiReply(rawText) {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('AI 返回内容为空');

  const tryParse = (s) => {
    try { return JSON.parse(s); } catch (e) { return null; }
  };

  let parsed = tryParse(text);
  if (!parsed) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) parsed = tryParse(fence[1].trim());
  }
  if (!parsed) {
    const firstObj = text.indexOf('{');
    const lastObj = text.lastIndexOf('}');
    if (firstObj >= 0 && lastObj > firstObj) {
      parsed = tryParse(text.slice(firstObj, lastObj + 1));
    }
  }
  if (!parsed) {
    const firstArr = text.indexOf('[');
    const lastArr = text.lastIndexOf(']');
    if (firstArr >= 0 && lastArr > firstArr) {
      parsed = tryParse(text.slice(firstArr, lastArr + 1));
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 未返回有效的 JSON 结构，请尝试调整提示词或模型');
  }
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.entries) ? parsed.entries : null);
}

export async function runAiPresetEdit({ selectedItems, instruction, apiCfg }) {
  if (!hasTH('generateRaw')) {
    throw new Error('当前酒馆助手版本不支持 generateRaw 接口');
  }
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
    throw new Error('请至少选择一个需要由 AI 编辑的条目');
  }
  const cleanInstruction = String(instruction || '').trim();
  if (!cleanInstruction) {
    throw new Error('请输入对这些条目的修改指令');
  }

  const inputPayload = selectedItems.map((it) => ({
    uidKey: it.uidKey,
    index: it.index + 1,
    id: it.prompt.id,
    name: it.prompt.name || it.prompt.id,
    role: it.prompt.role || 'system',
    enabled: !!it.prompt.enabled,
    content: typeof it.prompt.content === 'string' ? it.prompt.content : '',
  }));

  const systemPrompt = [
    '你是一个专业的 SillyTavern (酒馆) 预设提示词工程助手。',
    '用户会提供若干个预设提示词条目（JSON 数组）以及一段修改要求。',
    '请严格按照用户要求修改对应条目的内容（如有需要也可修改名称或 role/enabled）。',
    '输出要求：',
    '1. 必须仅输出一个合法的 JSON 对象，不要包含额外解释文字。',
    '2. 格式为：{"entries": [{"uidKey": "原样的uidKey", "name": "条目名", "role": "system|user|assistant", "enabled": true, "content": "修改后的完整正文", "note": "简短修改说明"}]}',
    '3. 必须完整保留每个条目的 uidKey，不得遗漏或擅自改写 uidKey；未要求修改的条目请保持原文或不要破坏占位符结构。',
  ].join('\n');

  const userPrompt = [
    `【修改需求】\n${cleanInstruction}`,
    `【待编辑条目列表 JSON】\n${JSON.stringify(inputPayload, null, 2)}`,
  ].join('\n\n');

  const jbPrompts = extractJailbreakPrompts(apiCfg?.jailbreakPreset);
  const rawResult = await callTH('generateRaw', {
    user_input: userPrompt,
    should_stream: false,
    should_silence: true,
    max_chat_history: 0,
    custom_api: buildCurrentApiOverride(apiCfg),
    ordered_prompts: [
      ...jbPrompts,
      { role: 'system', content: systemPrompt },
      'user_input',
    ],
  });

  const replyText = typeof rawResult === 'string' ? rawResult : (rawResult?.content || '');
  const list = extractJsonFromAiReply(replyText);
  if (!list || list.length === 0) {
    throw new Error('AI 返回的 entries 数组为空或格式不符合要求');
  }

  const byUidKey = new Map(selectedItems.map((it) => [it.uidKey, it]));
  const results = [];
  list.forEach((out) => {
    if (!out || typeof out !== 'object') return;
    const match = byUidKey.get(out.uidKey)
      || selectedItems.find((x) => x.prompt.id === out.id && (x.index + 1) === Number(out.index))
      || selectedItems.find((x) => x.prompt.id === out.id);
    if (!match) return;
    results.push({
      uidKey: match.uidKey,
      listName: match.listName,
      index: match.index,
      oldPrompt: JSON.parse(JSON.stringify(match.prompt)),
      newName: typeof out.name === 'string' && out.name.trim() ? out.name.trim() : (match.prompt.name || match.prompt.id),
      newRole: ['system', 'user', 'assistant'].includes(out.role) ? out.role : (match.prompt.role || 'system'),
      newEnabled: typeof out.enabled === 'boolean' ? out.enabled : !!match.prompt.enabled,
      newContent: typeof out.content === 'string' ? out.content : (match.prompt.content || ''),
      note: typeof out.note === 'string' ? out.note : '',
      accepted: true,
    });
  });

  if (results.length === 0) {
    throw new Error('无法将 AI 返回的条目匹配回原始条目，请重试');
  }
  return { rawReply: replyText, results };
}

export async function runAiWorldbookEdit({ selectedItems, instruction, apiCfg }) {
  if (!hasTH('generateRaw')) {
    throw new Error('当前酒馆助手版本不支持 generateRaw 接口');
  }
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
    throw new Error('请至少选择一个需要由 AI 编辑的世界书条目');
  }
  const cleanInstruction = String(instruction || '').trim();
  if (!cleanInstruction) {
    throw new Error('请输入对这些世界书条目的修改指令');
  }

  const inputPayload = selectedItems.map((it) => ({
    index: it.index,
    uid: it.entry.uid,
    name: it.entry.name || `条目 #${it.entry.uid}`,
    enabled: !!it.entry.enabled,
    keys: formatKeysInput(it.entry.strategy?.keys),
    content: typeof it.entry.content === 'string' ? it.entry.content : '',
  }));

  const systemPrompt = [
    '你是一个专业的 SillyTavern (酒馆) 世界书 (Lorebook / World Info) 编写与编辑助手。',
    '用户会提供若干个世界书条目（JSON 数组）以及一段修改要求。',
    '请严格按照用户要求修改对应条目的内容（如有需要也可修改 name、keys 或 enabled）。',
    '输出要求：',
    '1. 必须仅输出一个合法的 JSON 对象，不要包含额外解释文字。',
    '2. 格式为：{"entries": [{"index": 原样数字index, "uid": 原样数字uid, "name": "条目标题", "enabled": true, "keys": "逗号分隔的关键词字符串", "content": "修改后的完整正文", "note": "简短修改说明"}]}',
    '3. 必须完整保留每个条目的 index 与 uid，不得遗漏；若不需更改关键词，请原样保留 keys 字段。',
  ].join('\n');

  const userPrompt = [
    `【修改需求】\n${cleanInstruction}`,
    `【待编辑世界书条目 JSON】\n${JSON.stringify(inputPayload, null, 2)}`,
  ].join('\n\n');

  const jbPrompts = extractJailbreakPrompts(apiCfg?.jailbreakPreset);
  const rawResult = await callTH('generateRaw', {
    user_input: userPrompt,
    should_stream: false,
    should_silence: true,
    max_chat_history: 0,
    custom_api: buildCurrentApiOverride(apiCfg),
    ordered_prompts: [
      ...jbPrompts,
      { role: 'system', content: systemPrompt },
      'user_input',
    ],
  });

  const replyText = typeof rawResult === 'string' ? rawResult : (rawResult?.content || '');
  const list = extractJsonFromAiReply(replyText);
  if (!list || list.length === 0) {
    throw new Error('AI 返回的 entries 数组为空或格式不符合要求');
  }

  const byIndex = new Map(selectedItems.map((it) => [it.index, it]));
  const byUid = new Map(selectedItems.map((it) => [it.entry.uid, it]));
  const results = [];
  list.forEach((out) => {
    if (!out || typeof out !== 'object') return;
    const match = byIndex.get(Number(out.index)) || byUid.get(Number(out.uid));
    if (!match) return;
    results.push({
      index: match.index,
      uid: match.entry.uid,
      oldContent: match.entry.content || '',
      oldKeys: formatKeysInput(match.entry.strategy?.keys),
      newName: typeof out.name === 'string' && out.name.trim() ? out.name.trim() : (match.entry.name || `条目 #${match.entry.uid}`),
      newEnabled: typeof out.enabled === 'boolean' ? out.enabled : !!match.entry.enabled,
      newKeys: typeof out.keys === 'string' ? out.keys : formatKeysInput(match.entry.strategy?.keys),
      newContent: typeof out.content === 'string' ? out.content : (match.entry.content || ''),
      note: typeof out.note === 'string' ? out.note : '',
      accepted: true,
    });
  });

  if (results.length === 0) {
    throw new Error('无法将 AI 返回的世界书条目匹配回原条目，请重试');
  }
  return { rawReply: replyText, results };
}
