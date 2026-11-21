import { callTH, hasTH } from './utils.js';

export function buildAiCustomApi(cfg) {
  const out = {};
  if (!cfg || cfg.mode === 'current') {
    if (cfg?.model?.trim()) out.model = cfg.model.trim();
  } else if (cfg.mode === 'proxy') {
    if (cfg.proxyPreset?.trim()) out.proxy_preset = cfg.proxyPreset.trim();
    if (cfg.model?.trim()) out.model = cfg.model.trim();
  } else if (cfg.mode === 'direct') {
    if (cfg.apiUrl?.trim()) out.apiurl = cfg.apiUrl.trim();
    if (cfg.apiKey?.trim()) out.key = cfg.apiKey.trim();
    if (cfg.source?.trim()) out.source = cfg.source.trim();
    if (cfg.model?.trim()) out.model = cfg.model.trim();
  }
  const temp = Number(cfg?.temperature);
  if (cfg?.temperature !== '' && cfg?.temperature !== undefined && !Number.isNaN(temp)) {
    out.temperature = temp;
  }
  const maxTok = Number(cfg?.maxTokens);
  if (cfg?.maxTokens !== '' && cfg?.maxTokens !== undefined && !Number.isNaN(maxTok) && maxTok > 0) {
    out.max_tokens = maxTok;
  }
  return out;
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

  const customApi = buildAiCustomApi(apiCfg);
  const rawResult = await callTH('generateRaw', {
    user_input: userPrompt,
    should_stream: false,
    should_silence: true,
    max_chat_history: 0,
    custom_api: Object.keys(customApi).length > 0 ? customApi : undefined,
    ordered_prompts: [
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
