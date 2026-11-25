import { callTH, hasTH, getST, logWarn, formatKeysInput } from './utils.js';
import { recordOpStep } from './dev-tools.js';

const SOURCE_SELECT_IDS = {
  openai: 'model_openai_select',
  claude: 'model_claude_select',
  google: 'model_makersuite_select',
  makersuite: 'model_makersuite_select',
  vertexai: 'model_vertexai_select',
  deepseek: 'model_deepseek_select',
  openrouter: 'model_openrouter_select',
  mistralai: 'model_mistralai_select',
  groq: 'model_groq_select',
  cohere: 'model_cohere_select',
  perplexity: 'model_perplexity_select',
  xai: 'model_xai_select',
  aimlapi: 'model_aimlapi_select',
  custom: 'model_custom_select',
};

export function normalizeApiTargetValue(raw) {
  const s = String(raw || '').trim();
  if (!s || s.toLowerCase() === 'none' || s === 'proxy:None' || s === 'proxy:none') return '';
  if (s.startsWith('profile:') || s.startsWith('proxy:')) return s;
  return `proxy:${s}`;
}

export function getAvailableApiTargets() {
  const st = getST();
  const profiles = [];
  const seenProfileIds = new Set();

  const rawProfiles = st?.extensionSettings?.connectionManager?.profiles;
  if (Array.isArray(rawProfiles)) {
    rawProfiles.forEach((p) => {
      if (!p || !p.id) return;
      const id = String(p.id);
      seenProfileIds.add(id);
      profiles.push({
        value: `profile:${id}`,
        id,
        name: String(p.name || id),
        api: String(p.api || ''),
        model: String(p.model || ''),
        proxy: String(p.proxy || ''),
        apiUrl: String(p['api-url'] || p.apiUrl || ''),
        mode: String(p.mode || 'cc'),
      });
    });
  }

  const cpSel = typeof document !== 'undefined' ? document.getElementById('connection_profiles') : null;
  if (cpSel) {
    Array.from(cpSel.options || []).forEach((opt) => {
      const id = String(opt.value || '').trim();
      if (!id || id.toLowerCase() === 'none' || id === '<None>' || seenProfileIds.has(id)) return;
      seenProfileIds.add(id);
      profiles.push({
        value: `profile:${id}`,
        id,
        name: String(opt.textContent || id).trim(),
        api: '',
        model: '',
        proxy: '',
        apiUrl: '',
        mode: 'cc',
      });
    });
  }

  const proxies = [];
  const seenProxies = new Set();
  const stProxies = Array.isArray(st?.chatCompletionSettings?.proxies) ? st.chatCompletionSettings.proxies : [];
  const proxyObjMap = new Map(stProxies.filter((x) => x?.name).map((x) => [x.name, x]));
  const addProxy = (name) => {
    const n = String(name || '').trim();
    if (!n || n.toLowerCase() === 'none' || seenProxies.has(n)) return;
    seenProxies.add(n);
    const obj = proxyObjMap.get(n);
    proxies.push({
      value: `proxy:${n}`,
      name: n,
      url: String(obj?.url || ''),
      password: String(obj?.password || ''),
    });
  };

  if (hasTH('getProxyPresetNames')) {
    try { (callTH('getProxyPresetNames') || []).forEach(addProxy); } catch (e) {}
  }
  stProxies.forEach((x) => addProxy(x?.name));
  if (typeof document !== 'undefined') {
    const proxySel = document.getElementById('proxies_preset') || document.getElementById('openai_proxy_preset');
    if (proxySel) Array.from(proxySel.options || []).forEach((opt) => addProxy(opt.value || opt.textContent));
  }

  return { profiles, proxies };
}

function collectDomModels(source) {
  if (typeof document === 'undefined') return [];
  const out = [];
  const pushFromSelect = (el) => {
    if (!el) return;
    Array.from(el.options || []).forEach((opt) => {
      const v = String(opt.value || '').trim();
      if (v && !out.includes(v)) out.push(v);
    });
  };
  const src = String(source || '').toLowerCase();
  if (src && SOURCE_SELECT_IDS[src]) {
    pushFromSelect(document.getElementById(SOURCE_SELECT_IDS[src]));
  }
  if (src) pushFromSelect(document.getElementById(`model_${src}_select`));
  if (out.length === 0) {
    document.querySelectorAll('#openai_settings select[id^="model_"], #chat_completion_settings select[id^="model_"]').forEach((el) => {
      if (el.offsetParent !== null) pushFromSelect(el);
    });
  }
  return out;
}

export async function fetchModelsForApiTarget(apiValue) {
  const st = getST();
  const normalized = normalizeApiTargetValue(apiValue);
  recordOpStep('拉取 AI 模型列表', normalized || '跟随当前连接');
  const { profiles, proxies } = getAvailableApiTargets();
  const models = [];
  const addModels = (list) => {
    (list || []).forEach((m) => {
      const v = String(m || '').trim();
      if (v && !models.includes(v)) models.push(v);
    });
  };

  let fetchedRemote = false;
  let lastErr = null;

  if (normalized.startsWith('proxy:')) {
    const name = normalized.slice(6);
    const px = proxies.find((p) => p.name === name);
    if (px?.url && hasTH('getModelList')) {
      try {
        addModels(await callTH('getModelList', { apiurl: px.url, key: px.password || '' }));
        fetchedRemote = true;
      } catch (e) { lastErr = e; }
    }
  } else if (normalized.startsWith('profile:')) {
    const pid = normalized.slice(8);
    const prof = profiles.find((p) => p.id === pid);
    if (prof) {
      if (prof.model) addModels([prof.model]);
      const px = prof.proxy && prof.proxy.toLowerCase() !== 'none'
        ? proxies.find((p) => p.name === prof.proxy)
        : null;
      if (px?.url && hasTH('getModelList')) {
        try {
          addModels(await callTH('getModelList', { apiurl: px.url, key: px.password || '' }));
          fetchedRemote = true;
        } catch (e) { lastErr = e; }
      } else if (prof.apiUrl && hasTH('getModelList')) {
        try {
          addModels(await callTH('getModelList', { apiurl: prof.apiUrl, key: '' }));
          fetchedRemote = true;
        } catch (e) { lastErr = e; }
      }
      addModels(collectDomModels(prof.api));
    }
  } else {
    const cc = st?.chatCompletionSettings;
    const src = cc?.chat_completion_source || '';
    if (cc?.reverse_proxy && hasTH('getModelList')) {
      try {
        addModels(await callTH('getModelList', { apiurl: cc.reverse_proxy, key: cc.proxy_password || '' }));
        fetchedRemote = true;
      } catch (e) { lastErr = e; }
    } else if (src === 'custom' && cc?.custom_url && hasTH('getModelList')) {
      try {
        addModels(await callTH('getModelList', { apiurl: cc.custom_url, key: '' }));
        fetchedRemote = true;
      } catch (e) { lastErr = e; }
    }
    try {
      const curM = st?.getChatCompletionModel?.();
      if (curM) addModels([curM]);
    } catch (e) {}
    addModels(collectDomModels(src));
  }

  if (models.length === 0 && lastErr) throw lastErr;
  return { models, fetchedRemote };
}

export function buildCurrentApiOverride(cfg) {
  const apiVal = normalizeApiTargetValue(cfg?.proxyPreset);
  const model = String(cfg?.model || '').trim();
  const proxy_preset = apiVal.startsWith('proxy:') ? apiVal.slice(6) : '';
  if (!proxy_preset && !model) return undefined;
  const out = {};
  if (proxy_preset) out.proxy_preset = proxy_preset;
  if (model) out.model = model;
  return out;
}

async function runConfiguredAiRequest({ jbPrompts, systemPrompt, userPrompt, apiCfg }) {
  const apiVal = normalizeApiTargetValue(apiCfg?.proxyPreset);
  const overrideModel = String(apiCfg?.model || '').trim();

  if (apiVal.startsWith('profile:')) {
    const profileId = apiVal.slice(8);
    const st = getST();
    const svc = st?.ConnectionManagerRequestService;
    if (!svc || typeof svc.sendRequest !== 'function') {
      throw new Error('当前酒馆版本不支持 ConnectionManagerRequestService，无法直接调用连接配置');
    }
    const rawProfiles = st?.extensionSettings?.connectionManager?.profiles;
    const targetProfile = Array.isArray(rawProfiles) ? rawProfiles.find((p) => p && String(p.id) === profileId) : null;
    const messages = [
      ...(jbPrompts || []),
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const maxTokens = Number(st?.chatCompletionSettings?.openai_max_tokens) || 4096;
    const prevModel = targetProfile ? targetProfile.model : undefined;
    if (targetProfile && overrideModel) targetProfile.model = overrideModel;
    try {
      const res = await svc.sendRequest(profileId, messages, maxTokens, { stream: false, extractData: true });
      return typeof res === 'string' ? res : (res?.content || res?.result || '');
    } finally {
      if (targetProfile && overrideModel) targetProfile.model = prevModel;
    }
  }

  if (!hasTH('generateRaw')) {
    throw new Error('当前酒馆助手版本不支持 generateRaw 接口');
  }
  const rawResult = await callTH('generateRaw', {
    user_input: userPrompt,
    should_stream: false,
    should_silence: true,
    max_chat_history: 0,
    custom_api: buildCurrentApiOverride(apiCfg),
    ordered_prompts: [
      ...(jbPrompts || []),
      { role: 'system', content: systemPrompt },
      'user_input',
    ],
  });
  return typeof rawResult === 'string' ? rawResult : (rawResult?.content || '');
}

export function extractJailbreakPrompts(jailbreakPresetName) {
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

export function extractAiEditResponse(rawText) {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('AI 返回内容为空');

  const tryParse = (s) => {
    try { return JSON.parse(s); } catch (e) { return null; }
  };

  let parsed = null;
  let jsonSpanStart = -1;
  let jsonSpanEnd = -1;

  parsed = tryParse(text);
  if (parsed && typeof parsed === 'object') {
    jsonSpanStart = 0;
    jsonSpanEnd = text.length;
  } else {
    parsed = null;
  }

  if (!parsed) {
    const fenceRe = /```(?:json)?\s*([\s\S]*?)```/ig;
    let m;
    while ((m = fenceRe.exec(text)) !== null) {
      const cand = tryParse(m[1].trim());
      if (cand && typeof cand === 'object') {
        parsed = cand;
        jsonSpanStart = m.index;
        jsonSpanEnd = m.index + m[0].length;
        break;
      }
    }
  }

  if (!parsed) {
    const firstObj = text.indexOf('{');
    const lastObj = text.lastIndexOf('}');
    if (firstObj >= 0 && lastObj > firstObj) {
      const cand = tryParse(text.slice(firstObj, lastObj + 1));
      if (cand && typeof cand === 'object') {
        parsed = cand;
        jsonSpanStart = firstObj;
        jsonSpanEnd = lastObj + 1;
      }
    }
  }

  if (!parsed) {
    const firstArr = text.indexOf('[');
    const lastArr = text.lastIndexOf(']');
    if (firstArr >= 0 && lastArr > firstArr) {
      const cand = tryParse(text.slice(firstArr, lastArr + 1));
      if (cand && typeof cand === 'object') {
        parsed = cand;
        jsonSpanStart = firstArr;
        jsonSpanEnd = lastArr + 1;
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 未返回有效的 JSON 结构，请尝试调整提示词或模型');
  }

  const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.entries) ? parsed.entries : null);
  const summaryParts = [];
  if (!Array.isArray(parsed)) {
    const jsonSummary = parsed.summary ?? parsed.guide ?? parsed.explanation ?? parsed.instructions ?? parsed.note ?? '';
    if (typeof jsonSummary === 'string' && jsonSummary.trim()) {
      summaryParts.push(jsonSummary.trim());
    }
  }
  if (jsonSpanStart >= 0 && jsonSpanEnd > jsonSpanStart) {
    const outside = `${text.slice(0, jsonSpanStart)}\n${text.slice(jsonSpanEnd)}`.trim();
    if (outside && !summaryParts.some((p) => p === outside)) {
      summaryParts.push(outside);
    }
  }

  return {
    entries,
    summary: summaryParts.join('\n\n').trim(),
  };
}

export function extractJsonFromAiReply(rawText) {
  return extractAiEditResponse(rawText).entries;
}

export async function runAiPresetEdit({ selectedItems = [], referenceItems = [], instruction, apiCfg }) {
  const hasTargets = Array.isArray(selectedItems) && selectedItems.length > 0;
  const hasRefs = Array.isArray(referenceItems) && referenceItems.length > 0;
  if (!hasTargets && !hasRefs) {
    throw new Error('请至少勾选一个待编辑条目或参考条目');
  }
  const cleanInstruction = String(instruction || '').trim();
  if (!cleanInstruction) {
    throw new Error('请输入对条目的修改或生成指令');
  }

  const inputPayload = (selectedItems || []).map((it) => {
    if (it.itemType === 'regex' && it.regex) {
      return {
        itemType: 'regex',
        uidKey: it.uidKey,
        index: it.index + 1,
        id: it.regex.id,
        script_name: it.regex.script_name || it.regex.id,
        enabled: !!it.regex.enabled,
        find_regex: typeof it.regex.find_regex === 'string' ? it.regex.find_regex : '',
        replace_string: typeof it.regex.replace_string === 'string' ? it.regex.replace_string : '',
      };
    }
    return {
      itemType: 'prompt',
      uidKey: it.uidKey,
      index: it.index + 1,
      id: it.prompt.id,
      name: it.prompt.name || it.prompt.id,
      role: it.prompt.role || 'system',
      enabled: !!it.prompt.enabled,
      content: typeof it.prompt.content === 'string' ? it.prompt.content : '',
    };
  });

  const refPayload = (referenceItems || []).map((it) => {
    if (it.kind === 'regex' || it.regex) {
      const r = it.regex || it;
      return {
        sourceType: 'preset_regex',
        sourceName: it.sourceName || '',
        index: typeof it.index === 'number' ? it.index + 1 : undefined,
        script_name: r.script_name || r.id,
        enabled: !!r.enabled,
        find_regex: typeof r.find_regex === 'string' ? r.find_regex : '',
        replace_string: typeof r.replace_string === 'string' ? r.replace_string : '',
      };
    }
    if (it.kind === 'worldbook' || it.entry) {
      const e = it.entry || it;
      return {
        sourceType: 'worldbook',
        sourceName: it.sourceName || it.bookName || '',
        index: typeof it.index === 'number' ? it.index + 1 : undefined,
        name: e.name || `条目 #${e.uid}`,
        keys: formatKeysInput(e.strategy?.keys),
        enabled: !!e.enabled,
        content: typeof e.content === 'string' ? e.content : '',
      };
    }
    const p = it.prompt || it;
    return {
      sourceType: 'preset',
      sourceName: it.sourceName || '',
      index: typeof it.index === 'number' ? it.index + 1 : undefined,
      listName: it.listName || 'prompts',
      name: p.name || p.id,
      role: p.role || 'system',
      enabled: !!p.enabled,
      content: typeof p.content === 'string' ? p.content : '',
    };
  });

  const systemPrompt = [
    '你是一个专业的 SillyTavern (酒馆) 预设提示词与正则工程助手。',
    '用户会提供修改/编写指令、待编辑条目（可能包含预设提示词条目 itemType:"prompt" 与预设正则条目 itemType:"regex"，可选）以及供上下文参考的条目（可选）。',
    '你可以修改待编辑条目（action: "update"），也可以根据用户指令新增提示词条目或新增预设正则条目（action: "add"）。',
    '输出要求：',
    '1. 请输出一个合法的 JSON 对象（推荐置于 ```json ... ``` 代码块中）；如需提供整体修改说明、结构设计思路、使用/配置指导信息或注意事项，请写入根字段 "summary"（也可在 JSON 代码块外补充说明文字）。',
    '2. 提示词条目格式：{"action": "update"|"add", "itemType": "prompt", "uidKey": "修改时填原样uidKey；新增时留空", "listName": "prompts"|"prompts_unused", "name": "条目名", "role": "system|user|assistant", "enabled": true, "content": "完整正文", "note": "说明"}',
    '3. 预设正则条目格式：{"action": "update"|"add", "itemType": "regex", "uidKey": "修改时填原样uidKey；新增时留空", "script_name": "正则名称", "enabled": true, "find_regex": "查找正则表达式", "replace_string": "替换文本", "note": "说明"}',
    '4. 修改原条目时必须完整保留 uidKey 与对应的 itemType，不得遗漏或篡改；不要把只读参考条目当作原条目输出为 update。',
  ].join('\n');

  const blocks = [`【指令需求】\n${cleanInstruction}`];
  if (refPayload.length > 0) {
    blocks.push(`【参考条目（仅作上下文/风格/结构参考，请勿直接修改）】\n${JSON.stringify(refPayload, null, 2)}`);
  }
  if (inputPayload.length > 0) {
    blocks.push(`【待编辑条目列表 JSON】\n${JSON.stringify(inputPayload, null, 2)}`);
  } else {
    blocks.push('【待编辑条目列表 JSON】\n[]（未勾选待修改的原条目，请根据指令需求与参考条目生成 action: "add" 的新条目）');
  }
  const userPrompt = blocks.join('\n\n');

  recordOpStep('发送 AI 预设编辑请求', `待编辑 ${inputPayload.length} 项 / 参考 ${refPayload.length} 项`);
  const jbPrompts = extractJailbreakPrompts(apiCfg?.jailbreakPreset);
  const replyText = await runConfiguredAiRequest({ jbPrompts, systemPrompt, userPrompt, apiCfg });
  const { entries: list, summary } = extractAiEditResponse(replyText);
  if (!list || list.length === 0) {
    throw new Error('AI 返回的 entries 数组为空或格式不符合要求');
  }

  const byUidKey = new Map((selectedItems || []).map((it) => [it.uidKey, it]));
  const getItemId = (x) => (x.itemType === 'regex' ? x.regex?.id : x.prompt?.id);
  const results = [];
  list.forEach((out) => {
    if (!out || typeof out !== 'object') return;
    const explicitAdd = out.action === 'add' || out.isNew === true;
    const match = !explicitAdd
      ? (byUidKey.get(out.uidKey)
        || (selectedItems || []).find((x) => out.id && getItemId(x) === out.id && (x.index + 1) === Number(out.index))
        || (selectedItems || []).find((x) => out.id && getItemId(x) === out.id))
      : null;

    const isRegex = match
      ? match.itemType === 'regex'
      : (out.itemType === 'regex'
        || typeof out.find_regex === 'string'
        || typeof out.findRegex === 'string'
        || typeof out.replace_string === 'string'
        || typeof out.replaceString === 'string');

    if (isRegex) {
      const rawName = typeof out.script_name === 'string' ? out.script_name : (typeof out.name === 'string' ? out.name : '');
      const rawFind = out.find_regex ?? out.findRegex;
      const rawRep = out.replace_string ?? out.replaceString;
      if (!match) {
        results.push({
          itemType: 'regex',
          uidKey: `ai_new::${results.length}`,
          isAiNew: true,
          writeMode: 'add',
          targetList: 'regex',
          listName: 'regex',
          index: -1,
          oldRegex: null,
          newName: rawName.trim() || `AI 新增正则 #${results.length + 1}`,
          newEnabled: typeof out.enabled === 'boolean' ? out.enabled : true,
          newFindRegex: typeof rawFind === 'string' ? rawFind : '',
          newReplaceString: typeof rawRep === 'string' ? rawRep : '',
          newSource: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
          newDestination: { display: true, prompt: false },
          newRunOnEdit: true,
          newMinDepth: null,
          newMaxDepth: null,
          newTrimStrings: [],
          note: typeof out.note === 'string' ? out.note : '',
          accepted: true,
        });
      } else {
        const mr = match.regex;
        results.push({
          itemType: 'regex',
          uidKey: match.uidKey,
          isAiNew: false,
          writeMode: 'overwrite',
          targetList: 'regex',
          listName: 'regex',
          index: match.index,
          oldRegex: JSON.parse(JSON.stringify(mr)),
          newName: rawName.trim() || (mr.script_name || mr.id),
          newEnabled: typeof out.enabled === 'boolean' ? out.enabled : !!mr.enabled,
          newFindRegex: typeof rawFind === 'string' ? rawFind : (mr.find_regex || ''),
          newReplaceString: typeof rawRep === 'string' ? rawRep : (mr.replace_string || ''),
          newSource: Object.assign({ user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false }, mr.source || {}),
          newDestination: Object.assign({ display: true, prompt: false }, mr.destination || {}),
          newRunOnEdit: mr.run_on_edit !== undefined ? !!mr.run_on_edit : true,
          newMinDepth: mr.min_depth ?? null,
          newMaxDepth: mr.max_depth ?? null,
          newTrimStrings: Array.isArray(mr.trim_strings) ? mr.trim_strings.slice() : [],
          note: typeof out.note === 'string' ? out.note : '',
          accepted: true,
        });
      }
      return;
    }

    if (!match) {
      results.push({
        itemType: 'prompt',
        uidKey: `ai_new::${results.length}`,
        isAiNew: true,
        writeMode: 'add',
        targetList: out.listName === 'prompts_unused' ? 'prompts_unused' : 'prompts',
        listName: out.listName === 'prompts_unused' ? 'prompts_unused' : 'prompts',
        index: -1,
        oldPrompt: null,
        newName: typeof out.name === 'string' && out.name.trim() ? out.name.trim() : `AI 新增条目 #${results.length + 1}`,
        newRole: ['system', 'user', 'assistant'].includes(out.role) ? out.role : 'system',
        newEnabled: typeof out.enabled === 'boolean' ? out.enabled : true,
        newContent: typeof out.content === 'string' ? out.content : '',
        note: typeof out.note === 'string' ? out.note : '',
        accepted: true,
      });
      return;
    }

    results.push({
      itemType: 'prompt',
      uidKey: match.uidKey,
      isAiNew: false,
      writeMode: 'overwrite',
      targetList: match.listName,
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
    throw new Error('AI 未返回有效条目结果，请重试');
  }
  return { rawReply: replyText, summary, results };
}

export async function runAiWorldbookEdit({ selectedItems = [], referenceItems = [], instruction, apiCfg }) {
  const hasTargets = Array.isArray(selectedItems) && selectedItems.length > 0;
  const hasRefs = Array.isArray(referenceItems) && referenceItems.length > 0;
  if (!hasTargets && !hasRefs) {
    throw new Error('请至少勾选一个待编辑世界书条目或参考条目');
  }
  const cleanInstruction = String(instruction || '').trim();
  if (!cleanInstruction) {
    throw new Error('请输入对世界书条目的修改或生成指令');
  }

  const inputPayload = (selectedItems || []).map((it) => ({
    index: it.index,
    uid: it.entry.uid,
    name: it.entry.name || `条目 #${it.entry.uid}`,
    enabled: !!it.entry.enabled,
    keys: formatKeysInput(it.entry.strategy?.keys),
    content: typeof it.entry.content === 'string' ? it.entry.content : '',
  }));

  const refPayload = (referenceItems || []).map((it) => {
    if (it.kind === 'regex' || it.regex) {
      const r = it.regex || it;
      return {
        sourceType: 'preset_regex',
        sourceName: it.sourceName || '',
        index: typeof it.index === 'number' ? it.index + 1 : undefined,
        script_name: r.script_name || r.id,
        enabled: !!r.enabled,
        find_regex: typeof r.find_regex === 'string' ? r.find_regex : '',
        replace_string: typeof r.replace_string === 'string' ? r.replace_string : '',
      };
    }
    if (it.kind === 'preset' || it.prompt) {
      const p = it.prompt || it;
      return {
        sourceType: 'preset',
        sourceName: it.sourceName || '',
        index: typeof it.index === 'number' ? it.index + 1 : undefined,
        listName: it.listName || 'prompts',
        name: p.name || p.id,
        role: p.role || 'system',
        enabled: !!p.enabled,
        content: typeof p.content === 'string' ? p.content : '',
      };
    }
    const e = it.entry || it;
    return {
      sourceType: 'worldbook',
      sourceName: it.sourceName || it.bookName || '',
      index: it.index,
      name: e.name || `条目 #${e.uid}`,
      keys: formatKeysInput(e.strategy?.keys),
      enabled: !!e.enabled,
      content: typeof e.content === 'string' ? e.content : '',
    };
  });

  const systemPrompt = [
    '你是一个专业的 SillyTavern (酒馆) 世界书 (Lorebook / World Info) 编写与编辑助手。',
    '用户会提供修改/编写指令、待编辑世界书条目（可选）以及参考条目（可选）。',
    '你可以修改待编辑条目（action: "update"），也可以根据需求新增世界书条目（action: "add"）。',
    '输出要求：',
    '1. 请输出一个合法的 JSON 对象（推荐置于 ```json ... ``` 代码块中）；如需提供整体修改说明、触发策略建议、使用/配置指导信息或注意事项，请写入根字段 "summary"（也可在 JSON 代码块外补充说明文字）。',
    '2. 格式为：{"summary": "整体说明与指导信息（可选）", "entries": [{"action": "update"|"add", "index": 原样数字index(新增填-1), "uid": 原样数字uid(新增填-1), "name": "条目标题", "enabled": true, "keys": "逗号分隔的关键词字符串", "content": "完整正文", "note": "本条目的修改说明或指导"}]}',
    '3. 修改原条目时必须完整保留 index 与 uid；若不需更改关键词，请原样保留 keys 字段。',
  ].join('\n');

  const blocks = [`【指令需求】\n${cleanInstruction}`];
  if (refPayload.length > 0) {
    blocks.push(`【参考条目（仅作上下文/世界观/格式参考，请勿直接修改）】\n${JSON.stringify(refPayload, null, 2)}`);
  }
  if (inputPayload.length > 0) {
    blocks.push(`【待编辑世界书条目 JSON】\n${JSON.stringify(inputPayload, null, 2)}`);
  } else {
    blocks.push('【待编辑世界书条目 JSON】\n[]（未勾选待修改的原条目，请根据指令需求与参考条目生成 action: "add" 的新条目）');
  }
  const userPrompt = blocks.join('\n\n');

  recordOpStep('发送 AI 世界书编辑请求', `待编辑 ${inputPayload.length} 项 / 参考 ${refPayload.length} 项`);
  const jbPrompts = extractJailbreakPrompts(apiCfg?.jailbreakPreset);
  const replyText = await runConfiguredAiRequest({ jbPrompts, systemPrompt, userPrompt, apiCfg });
  const { entries: list, summary } = extractAiEditResponse(replyText);
  if (!list || list.length === 0) {
    throw new Error('AI 返回的 entries 数组为空或格式不符合要求');
  }

  const byIndex = new Map((selectedItems || []).map((it) => [it.index, it]));
  const byUid = new Map((selectedItems || []).map((it) => [it.entry.uid, it]));
  const results = [];
  list.forEach((out) => {
    if (!out || typeof out !== 'object') return;
    const explicitAdd = out.action === 'add' || out.isNew === true;
    const match = !explicitAdd
      ? (byIndex.get(Number(out.index)) || byUid.get(Number(out.uid)))
      : null;

    if (!match) {
      results.push({
        index: -1,
        uid: -1,
        isAiNew: true,
        writeMode: 'add',
        oldContent: '',
        oldKeys: '',
        newName: typeof out.name === 'string' && out.name.trim() ? out.name.trim() : `AI 新增世界书条目 #${results.length + 1}`,
        newEnabled: typeof out.enabled === 'boolean' ? out.enabled : true,
        newKeys: typeof out.keys === 'string' ? out.keys : '',
        newContent: typeof out.content === 'string' ? out.content : '',
        note: typeof out.note === 'string' ? out.note : '',
        accepted: true,
      });
      return;
    }

    results.push({
      index: match.index,
      uid: match.entry.uid,
      isAiNew: false,
      writeMode: 'overwrite',
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
    throw new Error('AI 未返回有效世界书条目结果，请重试');
  }
  return { rawReply: replyText, summary, results };
}

export async function runAiMvuUpdate({
  currentStatData,
  messages,
  truncatedSnippet,
  ruleEntries,
  instruction,
  apiCfg,
}) {
  const systemPrompt = [
    '你是一个专业的 SillyTavern (酒馆) MVU (MagVarUpdate) 变量状态更新助手。',
    '请根据当前变量状态、变量规则、近期剧情正文以及用户的补充要求，输出需要执行的变量更新命令。',
    '输出规范：',
    '1. 仅输出包装在 <UpdateVariable>...</UpdateVariable> 标签内的更新命令，不要输出多余闲聊或剧情正文。',
    '2. 可用命令格式（路径直接写 stat_data 下的字段路径，不要带 stat_data. 前缀）：',
    '   - _.set(\'路径\', 新值); // 或 _.set(\'路径\', 旧值, 新值);',
    '   - _.add(\'路径\', 增减数值);',
    '   - _.insert(\'路径\', 新元素); // 或 _.insert(\'路径\', \'键或索引\', 值);',
    '   - _.delete(\'路径\'); // 或 _.delete(\'路径\', \'键或索引\');',
    '   - _.move(\'原路径\', \'新路径\');',
    '3. 严格遵守原变量的数据类型与结构；若原变量是 [值, "说明"] 格式，请使用 _.set(\'路径\', 新值) 或 _.add(\'路径\', 增量) 以保留说明。',
    '4. 若提供了被截断的更新片段，请承接该片段修复并补全剩余变更，避免重复已写完且无需重复累加的 _.add 操作。',
  ].join('\n');

  const blocks = [
    `【当前变量状态 (stat_data)】\n${JSON.stringify(currentStatData || {}, null, 2)}`,
  ];

  if (Array.isArray(ruleEntries) && ruleEntries.length > 0) {
    const rulesText = ruleEntries
      .map((r) => `--- ${r.bookName} / ${r.name} ---\n${r.content}`)
      .join('\n\n');
    blocks.push(`【变量更新规则参考】\n${rulesText}`);
  }

  if (Array.isArray(messages) && messages.length > 0) {
    const msgText = messages.map((msg) => {
      const cleaned = String(msg.message || '').replace(/<UpdateVariable[\s\S]*$/i, '').trim();
      return `[#${msg.message_id} ${msg.role}${msg.name ? ` (${msg.name})` : ''}]\n${cleaned || msg.message || ''}`;
    }).join('\n\n');
    blocks.push(`【近期剧情正文】\n${msgText}`);
  }

  if (String(truncatedSnippet || '').trim()) {
    blocks.push(`【正文中的更新命令/截断片段（请检查并补全）】\n${truncatedSnippet.trim()}`);
  }

  if (String(instruction || '').trim()) {
    blocks.push(`【用户补充要求】\n${instruction.trim()}`);
  }

  recordOpStep('发送 AI MVU 更新请求', `消息 ${messages?.length || 0} 条 / 规则 ${ruleEntries?.length || 0} 条`);
  const jbPrompts = extractJailbreakPrompts(apiCfg?.jailbreakPreset);
  const replyText = await runConfiguredAiRequest({
    jbPrompts,
    systemPrompt,
    userPrompt: blocks.join('\n\n'),
    apiCfg,
  });
  if (!String(replyText).trim()) {
    throw new Error('AI 返回内容为空');
  }
  return { rawReply: replyText };
}
