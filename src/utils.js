export const APP_NAME = 'TavernDeck';
export const APP_CN = '酒馆总控台';
export const APP_VERSION = 'v1.1';
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

export function normalizeColorInput(raw) {
  let val = String(raw || '').trim();
  if (!val) return { ok: true, value: '' };
  if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(val)) {
    val = `#${val}`;
  }
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports('color', val) ? { ok: true, value: val } : { ok: false, value: '' };
  }
  const el = document.createElement('span');
  el.style.color = '';
  el.style.color = val;
  return el.style.color ? { ok: true, value: val } : { ok: false, value: '' };
}

function normalizeTitleForMatch(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\[\(（【].*?[\]\)）】]/g, ' ')
    .replace(/v?\d+(\.\d+)*([a-z])?/g, ' ')
    .replace(/(20\d{2}[-./]?\d{1,2}[-./]?\d{1,2}|\d{4,8})/g, ' ')
    .replace(/[\s_\-·.]+/g, '')
    .trim();
}

function charDiceSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return 0.75 + 0.25 * (Math.min(a.length, b.length) / Math.max(a.length, b.length));
  }
  const bigrams = (s) => {
    const arr = [];
    for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
    if (arr.length === 0 && s.length === 1) arr.push(s);
    return arr;
  };
  const ba = bigrams(a);
  const bb = bigrams(b);
  const map = new Map();
  ba.forEach((g) => map.set(g, (map.get(g) || 0) + 1));
  let inter = 0;
  bb.forEach((g) => {
    const c = map.get(g) || 0;
    if (c > 0) {
      inter++;
      map.set(g, c - 1);
    }
  });
  return (2 * inter) / (ba.length + bb.length);
}

export function findBestMatchingName(targetName, allNames) {
  const candidates = (allNames || []).filter((n) => n && n !== targetName && n !== 'in_use');
  if (candidates.length === 0) return targetName || '';

  const normTarget = normalizeTitleForMatch(targetName);
  const rawTarget = String(targetName || '').toLowerCase();
  let bestName = candidates[0];
  let bestScore = -1;

  candidates.forEach((cand) => {
    const normCand = normalizeTitleForMatch(cand);
    const rawCand = cand.toLowerCase();
    const s1 = charDiceSimilarity(normTarget, normCand);
    const s2 = charDiceSimilarity(rawTarget, rawCand);
    let prefixLen = 0;
    const minL = Math.min(rawTarget.length, rawCand.length);
    while (prefixLen < minL && rawTarget[prefixLen] === rawCand[prefixLen]) prefixLen++;
    const prefixBonus = minL > 0 ? (prefixLen / minL) * 0.25 : 0;
    const score = s1 * 0.6 + s2 * 0.3 + prefixBonus;
    if (score > bestScore) {
      bestScore = score;
      bestName = cand;
    }
  });
  return bestName;
}

export function computeLineDiff(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');
  if (a.length * b.length > 90000) {
    return [
      ...a.slice(0, 40).map((l) => ({ type: 'del', text: l })),
      ...b.slice(0, 40).map((l) => ({ type: 'add', text: l })),
    ];
  }
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push({ type: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'del', text: a[i] });
      i++;
    } else {
      lines.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) lines.push({ type: 'del', text: a[i++] });
  while (j < n) lines.push({ type: 'add', text: b[j++] });
  return lines;
}

function cloneWithRegExp(val) {
  if (val instanceof RegExp) return new RegExp(val.source, val.flags);
  if (Array.isArray(val)) return val.map(cloneWithRegExp);
  if (val && typeof val === 'object') {
    const out = {};
    Object.keys(val).forEach((k) => { out[k] = cloneWithRegExp(val[k]); });
    return out;
  }
  return val;
}

export function cloneWorldbookEntry(entry) {
  return cloneWithRegExp(entry);
}

export function cloneWorldbookEntries(entries) {
  return Array.isArray(entries) ? entries.map(cloneWithRegExp) : [];
}

export function formatKeyItem(k) {
  if (k instanceof RegExp) return `/${k.source}/${k.flags}`;
  return String(k || '');
}

export function formatKeysInput(keys) {
  if (!Array.isArray(keys)) return '';
  return keys.map(formatKeyItem).filter(Boolean).join(', ');
}

export function parseKeysInput(str) {
  return String(str || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const m = token.match(/^\/(.+)\/([gimsuy]*)$/);
      if (m) {
        try { return new RegExp(m[1], m[2]); } catch (e) {}
      }
      return token;
    });
}

export function keysSignature(keys) {
  if (!Array.isArray(keys)) return '';
  return keys.map(formatKeyItem).join('\x00');
}

export function downloadJsonFile(obj, filename) {
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}
