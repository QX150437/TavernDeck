import { getST, hasTH, callTH, notify } from './utils.js';

export const CHAT_COMPLETION_SOURCES = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'claude', name: 'Claude (Anthropic)' },
  { id: 'makersuite', name: 'Google AI Studio (Gemini)' },
  { id: 'vertexai', name: 'Google Vertex AI' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'groq', name: 'Groq' },
  { id: 'mistralai', name: 'Mistral AI' },
  { id: 'cohere', name: 'Cohere' },
  { id: 'perplexity', name: 'Perplexity' },
  { id: 'xai', name: 'xAI (Grok)' },
  { id: 'ai21', name: 'AI21' },
  { id: 'custom', name: 'Custom (OpenAI 兼容反代)' },
  { id: 'azure_openai', name: 'Azure OpenAI' },
  { id: 'moonshot', name: 'Moonshot (Kimi)' },
  { id: 'zai', name: 'Z.ai (智谱)' },
  { id: 'siliconflow', name: 'SiliconFlow (硅基流动)' },
  { id: 'chutes', name: 'Chutes' },
  { id: 'electronhub', name: 'ElectronHub' },
  { id: 'nanogpt', name: 'NanoGPT' },
];

export const MAIN_API_LABELS = {
  openai: 'Chat Completion (对话补全)',
  textgenerationwebui: 'Text Completion (文本补全)',
  kobold: 'KoboldAI',
  koboldhorde: 'Kobold Horde',
  novel: 'NovelAI',
};

export function getApiSnapshot() {
  const st = getST() || {};
  const mainApiSelect = document.getElementById('main_api');
  const mainApi = st.mainApi || (mainApiSelect ? mainApiSelect.value : 'openai') || 'openai';
  const oai = st.chatCompletionSettings || {};

  const sourceSelect = document.getElementById('chat_completion_source');
  const source = oai.chat_completion_source || (sourceSelect ? sourceSelect.value : 'openai') || 'openai';

  const model = (hasTH('getChatCompletionModel') ? '' : (st.getChatCompletionModel?.(source) || ''))
    || oai[`${source}_model`]
    || oai.custom_model
    || '';

  const proxySelect = document.getElementById('openai_proxy_preset');
  const proxyPresets = hasTH('getProxyPresetNames') ? (callTH('getProxyPresetNames') || []) : [];
  const currentProxy = proxySelect ? proxySelect.value : (oai.proxy_preset || '');

  const profileSelect = document.getElementById('connection_profiles');
  const profiles = profileSelect
    ? Array.from(profileSelect.options).map((o) => ({ value: o.value, text: o.textContent || o.value })).filter((x) => x.value)
    : [];
  const currentProfile = profileSelect ? profileSelect.value : '';

  const mainApiOptions = mainApiSelect
    ? Array.from(mainApiSelect.options).map((o) => ({ value: o.value, text: o.textContent || o.value }))
    : Object.keys(MAIN_API_LABELS).map((k) => ({ value: k, text: MAIN_API_LABELS[k] }));

  const sourceOptions = sourceSelect
    ? Array.from(sourceSelect.options).map((o) => ({ value: o.value, text: o.textContent || o.value }))
    : CHAT_COMPLETION_SOURCES.map((s) => ({ value: s.id, text: s.name }));

  const modelSelect = findVisibleModelSelect(source);
  const modelOptions = modelSelect
    ? Array.from(modelSelect.options).map((o) => ({ value: o.value, text: o.textContent || o.value })).filter((x) => x.value)
    : [];

  return {
    mainApi,
    mainApiOptions,
    source,
    sourceOptions,
    model,
    modelOptions,
    customUrl: oai.custom_url || document.getElementById('custom_api_url_text')?.value || '',
    customModel: oai.custom_model || document.getElementById('custom_model_id')?.value || '',
    proxyPresets,
    currentProxy,
    profiles,
    currentProfile,
    onlineStatus: st.onlineStatus || 'unknown',
    showExternalModels: !!oai.show_external_models,
  };
}

function findVisibleModelSelect(source) {
  const candidates = [
    `model_${source}_select`,
    `${source}_model`,
    'model_openai_select',
    'model_claude_select',
    'model_makersuite_select',
    'model_openrouter_select',
    'model_deepseek_select',
    'model_custom_select',
  ];
  for (const id of candidates) {
    const el = document.getElementById(id);
    if (el && el.tagName === 'SELECT' && el.options.length > 0) {
      if (id.includes(source) || el.offsetParent !== null) return el;
    }
  }
  return null;
}

function setDomSelectAndTrigger(id, val) {
  const el = document.getElementById(id);
  if (!el) return false;
  const exists = Array.from(el.options).some((o) => o.value === val);
  if (!exists) return false;
  el.value = val;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function switchMainApi(nextApi) {
  if (setDomSelectAndTrigger('main_api', nextApi)) {
    notify('success', `已切换主 API 模式为「${MAIN_API_LABELS[nextApi] || nextApi}」`);
    return true;
  }
  notify('warning', '未找到酒馆原生 Main API 选择器');
  return false;
}

export function switchChatCompletionSource(nextSource) {
  if (setDomSelectAndTrigger('chat_completion_source', nextSource)) {
    notify('success', `已切换对话补全源为「${nextSource}」`);
    return true;
  }
  const st = getST();
  if (st?.chatCompletionSettings) {
    st.chatCompletionSettings.chat_completion_source = nextSource;
    st.saveSettingsDebounced?.();
    notify('success', `已更新 API 源为「${nextSource}」`);
    return true;
  }
  return false;
}

export function switchChatCompletionModel(source, nextModel) {
  const sel = findVisibleModelSelect(source);
  if (sel && Array.from(sel.options).some((o) => o.value === nextModel)) {
    sel.value = nextModel;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    notify('success', `已切换模型为「${nextModel}」`);
    return true;
  }
  if (source === 'custom') {
    const inp = document.getElementById('custom_model_id');
    if (inp) {
      inp.value = nextModel;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  const st = getST();
  if (st?.chatCompletionSettings) {
    st.chatCompletionSettings[`${source}_model`] = nextModel;
    if (source === 'custom') st.chatCompletionSettings.custom_model = nextModel;
    st.saveSettingsDebounced?.();
    notify('success', `已设置模型为「${nextModel}」`);
    return true;
  }
  return false;
}

export function updateCustomEndpoint({ apiUrl, customModel }) {
  const urlEl = document.getElementById('custom_api_url_text');
  if (urlEl && typeof apiUrl === 'string') {
    urlEl.value = apiUrl;
    urlEl.dispatchEvent(new Event('input', { bubbles: true }));
    urlEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const modelEl = document.getElementById('custom_model_id');
  if (modelEl && typeof customModel === 'string') {
    modelEl.value = customModel;
    modelEl.dispatchEvent(new Event('input', { bubbles: true }));
    modelEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const st = getST();
  if (st?.chatCompletionSettings) {
    if (typeof apiUrl === 'string') st.chatCompletionSettings.custom_url = apiUrl;
    if (typeof customModel === 'string') st.chatCompletionSettings.custom_model = customModel;
    st.saveSettingsDebounced?.();
  }
  notify('success', '自定义端点与模型配置已保存');
}

export function switchProxyPreset(proxyName) {
  if (setDomSelectAndTrigger('openai_proxy_preset', proxyName)) {
    notify('success', proxyName ? `已切换代理预设「${proxyName}」` : '已取消代理预设');
    return true;
  }
  const st = getST();
  if (st?.chatCompletionSettings) {
    st.chatCompletionSettings.proxy_preset = proxyName;
    st.saveSettingsDebounced?.();
    notify('success', proxyName ? `已切换代理预设「${proxyName}」` : '已取消代理预设');
    return true;
  }
  return false;
}

export async function switchConnectionProfile(profileVal) {
  if (hasTH('triggerSlash')) {
    try {
      await callTH('triggerSlash', `/profile ${profileVal || ''}`);
      notify('success', profileVal ? `已加载连接配置「${profileVal}」` : '已切换连接配置');
      return true;
    } catch (e) {}
  }
  if (setDomSelectAndTrigger('connection_profiles', profileVal)) {
    notify('success', `已加载连接配置「${profileVal}」`);
    return true;
  }
  return false;
}

export function triggerNativeApiConnectTest() {
  const btn = document.getElementById('api_button_openai') || document.getElementById('api_button');
  if (btn) {
    btn.click();
    notify('info', '已触发酒馆 API 连接测试');
    return true;
  }
  notify('warning', '未找到原生连接测试按钮');
  return false;
}

export async function fetchCustomModelList(apiurl, key) {
  if (!hasTH('getModelList')) throw new Error('当前酒馆助手版本不支持 getModelList');
  const url = String(apiurl || '').trim();
  if (!url) throw new Error('请先填写 API 地址');
  return await callTH('getModelList', { apiurl: url, key: key ? String(key).trim() : undefined });
}

export async function testAiPromptPing(customApiCfg) {
  if (!hasTH('generateRaw')) throw new Error('当前酒馆助手版本不支持 generateRaw');
  const res = await callTH('generateRaw', {
    user_input: 'Reply with OK only.',
    should_stream: false,
    should_silence: true,
    max_chat_history: 0,
    custom_api: customApiCfg && Object.keys(customApiCfg).length > 0 ? customApiCfg : undefined,
    ordered_prompts: ['user_input'],
  });
  return typeof res === 'string' ? res : (res?.content || '');
}
