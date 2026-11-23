import { callTH, hasTH, getST, notify, genId, downloadJsonFile, logWarn } from './utils.js';
import { hasUnsavedPresetChanges } from './preset-merge.js';
import { state } from './store.js';

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
  notify('success', `已将预设重命名为「${clean}」`);
}

export async function deleteSavedPresetSafe(name) {
  if (!name || name === 'in_use') throw new Error('不能删除当前实时预设');
  const ok = await callTH('deletePreset', name);
  if (!ok) throw new Error(`删除预设「${name}」失败`);
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

async function withAutoConfirmPresetImport(taskFn) {
  const st = getST();
  const PopupClass = st?.Popup;
  const origShow = PopupClass?.prototype?.show;
  const origGeneric = !origShow && typeof st?.callGenericPopup === 'function' ? st.callGenericPopup : null;
  const origWinConfirm = typeof window !== 'undefined' ? window.confirm : null;
  const affirmative = st?.POPUP_RESULT?.AFFIRMATIVE ?? 1;
  let active = true;

  const isImportConfirmPopup = (text, dlg) => {
    if (!active) return false;
    const t = String(text || '');
    if (/正则|脚本|regex|script|预设|preset|导入|import|替换|覆盖|overwrite/i.test(t)) return true;
    return !!dlg?.querySelector?.('.popup-button-cancel');
  };

  const ensureCheckboxesChecked = (container) => {
    if (!container) return;
    container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      if (cb.disabled || cb.checked) return;
      const lbl = (cb.closest('label')?.textContent || cb.parentElement?.textContent || '').trim();
      if (!/不再|别再|don't|never|skip|忽略|取消/i.test(lbl)) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  };

  if (PopupClass?.prototype && typeof origShow === 'function') {
    PopupClass.prototype.show = function (...args) {
      const resPromise = origShow.apply(this, args);
      try {
        const dlg = this?.dlg;
        if (isImportConfirmPopup(dlg?.textContent || '', dlg)) {
          if (dlg) dlg.style.visibility = 'hidden';
          ensureCheckboxesChecked(dlg);
          setTimeout(() => {
            try {
              ensureCheckboxesChecked(dlg);
              if (typeof this.completeAffirmative === 'function') {
                this.completeAffirmative();
              } else if (typeof this.complete === 'function') {
                this.complete(affirmative);
              } else {
                dlg?.querySelector?.('.popup-button-ok')?.click();
              }
            } catch (e) {}
          }, 0);
        }
      } catch (e) {}
      return resPromise;
    };
  } else if (origGeneric && st) {
    try {
      st.callGenericPopup = async function (content, ...rest) {
        const txt = typeof content === 'string' ? content : (content?.textContent || '');
        if (active && isImportConfirmPopup(txt, null)) return affirmative;
        return origGeneric.call(this, content, ...rest);
      };
    } catch (e) {}
  }

  let observer = null;
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
    observer = new MutationObserver((mutations) => {
      if (!active) return;
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const dlg = node.matches?.('dialog.popup, .popup') ? node : node.querySelector?.('dialog.popup, .popup');
          if (!dlg || !isImportConfirmPopup(dlg.textContent || '', dlg)) return;
          dlg.style.visibility = 'hidden';
          ensureCheckboxesChecked(dlg);
          setTimeout(() => {
            try {
              ensureCheckboxesChecked(dlg);
              const okBtn = dlg.querySelector('.popup-button-ok, [data-result="1"], button.menu_button[data-ok]');
              if (okBtn) okBtn.click();
            } catch (e) {}
          }, 0);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (typeof window !== 'undefined' && typeof origWinConfirm === 'function') {
    window.confirm = function (msg) {
      if (active && /正则|脚本|regex|script|预设|preset|导入|import/i.test(String(msg || ''))) {
        return true;
      }
      return origWinConfirm.apply(this, arguments);
    };
  }

  try {
    const result = await taskFn();
    await new Promise((r) => setTimeout(r, 350));
    return result;
  } finally {
    active = false;
    if (observer) observer.disconnect();
    if (PopupClass?.prototype && typeof origShow === 'function') {
      PopupClass.prototype.show = origShow;
    }
    if (origGeneric && st) {
      try { st.callGenericPopup = origGeneric; } catch (e) {}
    }
    if (typeof window !== 'undefined' && typeof origWinConfirm === 'function') {
      window.confirm = origWinConfirm;
    }
  }
}

export async function importPresetFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const baseName = file.name.replace(/\.json$/i, '').trim() || `导入预设_${Date.now()}`;
  if (parsed && typeof parsed === 'object' && parsed.settings && Array.isArray(parsed.prompts) && !parsed.prompt_order) {
    await callTH('createOrReplacePreset', baseName, parsed, { render: 'debounced' });
  } else if (hasTH('importRawPreset')) {
    const ok = await withAutoConfirmPresetImport(() => callTH('importRawPreset', file.name, text));
    if (!ok) throw new Error('导入预设失败，请检查文件格式是否为酒馆 OpenAI/对话补全预设');
  } else {
    throw new Error('当前酒馆助手版本不支持 importRawPreset');
  }
  notify('success', `已导入预设「${baseName}」`);
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
