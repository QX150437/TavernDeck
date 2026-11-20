export const APP_NAME = 'TavernDeck';
export const APP_CN = '酒馆总控台';
export const APP_VERSION = 'v1.0';
export const STORAGE_KEY = 'TavernDeck';
export const SCHEMA_VERSION = 3;
export const ROOT_ID = 'tavern-deck-root';
export const EXT_BTN_ID = 'tavern-deck-ext-menu-item';
export const EXT_SETTINGS_ID = 'tavern-deck-ext-settings';

export const TYPE_LABELS = {
  preset: '预设',
  worldbook: '世界书',
  script: '脚本',
  regex: '正则',
};

export const SCOPE_LABELS = {
  global: '全局',
  preset: '预设',
  character: '角色卡',
};

export function getTH() {
  return (typeof window !== 'undefined' && window.TavernHelper) || null;
}

export function getST() {
  if (typeof SillyTavern !== 'undefined') {
    return typeof SillyTavern.getContext === 'function' ? SillyTavern.getContext() : SillyTavern;
  }
  if (typeof window !== 'undefined' && window.SillyTavern) {
    return typeof window.SillyTavern.getContext === 'function'
      ? window.SillyTavern.getContext()
      : window.SillyTavern;
  }
  return null;
}

export function hasTH(name) {
  const th = getTH();
  return !!(th && typeof th[name] === 'function');
}

export function callTH(name, ...args) {
  const th = getTH();
  if (!th || typeof th[name] !== 'function') {
    throw new Error(`TavernHelper.${name} 不可用，请确认已安装并启用酒馆助手`);
  }
  return th[name](...args);
}

export function notify(type, message) {
  try {
    if (typeof toastr !== 'undefined' && typeof toastr[type] === 'function') {
      toastr[type](message, APP_NAME);
      return;
    }
    if (window.toastr && typeof window.toastr[type] === 'function') {
      window.toastr[type](message, APP_NAME);
      return;
    }
  } catch (e) {}
  console.log(`[${APP_NAME}][${type}]`, message);
}

export function genId() {
  try {
    const th = getTH();
    if (th && th.builtin && typeof th.builtin.uuidv4 === 'function') return th.builtin.uuidv4();
    const st = getST();
    if (st && typeof st.uuidv4 === 'function') return st.uuidv4();
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  } catch (e) {}
  return `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function cssEscape(str) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(str);
  return String(str).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function makeItemKey(ref) {
  if (!ref) return '';
  if (ref.type === 'preset') return `preset::${ref.id}`;
  if (ref.type === 'worldbook') return `worldbook::${ref.book}::${ref.uid}`;
  if (ref.type === 'script') return `script::${ref.scope}::${ref.id}`;
  if (ref.type === 'regex') return `regex::${ref.scope}::${ref.id}`;
  return '';
}

export function cloneItemRef(ref) {
  const key = makeItemKey(ref);
  if (ref.type === 'preset') return { key, type: 'preset', id: String(ref.id) };
  if (ref.type === 'worldbook') return { key, type: 'worldbook', book: String(ref.book), uid: Number(ref.uid) };
  if (ref.type === 'script') return { key, type: 'script', scope: String(ref.scope), id: String(ref.id) };
  if (ref.type === 'regex') return { key, type: 'regex', scope: String(ref.scope), id: String(ref.id) };
  return null;
}

export async function copyToClipboard(text) {
  const th = getTH();
  if (th && th.builtin && typeof th.builtin.copyText === 'function') {
    th.builtin.copyText(text);
    return;
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}
