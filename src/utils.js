export const APP_NAME = 'TavernDeck';
export const APP_SHORT = 'TD';
export const APP_CN = '酒馆总控台';
export const APP_VERSION = 'v1.2.3';
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

export function logInfo(msg, detail) {
  if (detail !== undefined) console.info(`[${APP_NAME}] ${msg}:`, detail);
  else console.info(`[${APP_NAME}] ${msg}`);
}

export function logWarn(msg, err) {
  if (err !== undefined) console.warn(`[${APP_NAME}] ${msg}:`, err);
  else console.warn(`[${APP_NAME}] ${msg}`);
}

export function logError(msg, err) {
  if (err !== undefined) console.error(`[${APP_NAME}] ${msg}:`, err);
  else console.error(`[${APP_NAME}] ${msg}`);
}

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
    const err = new Error(`TavernHelper.${name} 不可用，请确认已安装并启用酒馆助手`);
    logError(err.message);
    throw err;
  }
  return th[name](...args);
}

const TOAST_ICONS = {
  success: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>",
  warning: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/></svg>",
  error: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.3' stroke-linecap='round'><circle cx='12' cy='12' r='9'/><path d='M15 9l-6 6M9 9l6 6'/></svg>",
  info: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round'><circle cx='12' cy='12' r='9'/><line x1='12' y1='16' x2='12' y2='12'/><line x1='12' y1='8' x2='12.01' y2='8'/></svg>",
};

const notifyRuntimeConfig = {
  tdToastTheme: 'panel',
  tdSilentToast: false,
  nativeToastTheme: 'glass',
  nativeToastPosition: 'top-right',
};

export function syncNotifyRuntimeConfig(settings) {
  if (!settings || typeof settings !== 'object') return;
  notifyRuntimeConfig.tdToastTheme = settings.tdToastTheme || 'panel';
  notifyRuntimeConfig.tdSilentToast = !!settings.tdSilentToast;
  notifyRuntimeConfig.nativeToastTheme = settings.nativeToastTheme || 'glass';
  notifyRuntimeConfig.nativeToastPosition = settings.nativeToastPosition || 'top-right';
  if (typeof document !== 'undefined') {
    const root = document.getElementById(ROOT_ID);
    if (root) {
      root.setAttribute('data-td-toast-theme', notifyRuntimeConfig.tdToastTheme);
      const resolvedNative = notifyRuntimeConfig.nativeToastTheme === 'follow'
        ? notifyRuntimeConfig.tdToastTheme
        : notifyRuntimeConfig.nativeToastTheme;
      root.setAttribute('data-native-toast-theme', resolvedNative);
      root.setAttribute('data-native-toast-pos', notifyRuntimeConfig.nativeToastPosition);
    }
  }
}

function sanitizeToastHtml(raw) {
  const str = String(raw ?? '');
  if (!/[<>]/.test(str)) return escapeHtml(str).replace(/\n/g, '<br>');
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${str}</div>`, 'text/html');
    const container = doc.body.firstElementChild;
    if (!container) return escapeHtml(str).replace(/\n/g, '<br>');
    const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'BR', 'CODE', 'PRE', 'SPAN', 'DIV', 'P', 'SMALL', 'UL', 'OL', 'LI', 'A']);
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') {
            child.remove();
            return;
          }
          if (!allowedTags.has(tag)) {
            const frag = doc.createDocumentFragment();
            while (child.firstChild) frag.appendChild(child.firstChild);
            walk(frag);
            child.replaceWith(frag);
            return;
          }
          Array.from(child.attributes).forEach((attr) => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || (name === 'href' && /^\s*javascript:/i.test(attr.value))) {
              child.removeAttribute(attr.name);
            } else if (tag !== 'A' && name !== 'class') {
              child.removeAttribute(attr.name);
            }
          });
          if (tag === 'A') {
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          }
          walk(child);
        }
      });
    };
    walk(container);
    return container.innerHTML;
  } catch (e) {
    return escapeHtml(str).replace(/\n/g, '<br>');
  }
}

export function showToastElement({
  channel = 'td',
  kind = 'info',
  title = '',
  message = '',
  isHtml = false,
  sourceBadge = '',
  duration,
  tapToDismiss = true,
  onClick = null,
} = {}) {
  const root = typeof document !== 'undefined' ? document.getElementById(ROOT_ID) : null;
  if (!root) return null;

  const ch = channel === 'native' ? 'native' : 'td';
  const k = TOAST_ICONS[kind] ? kind : 'info';
  let stack = root.querySelector(`.td-toast-stack.is-${ch}`);
  if (!stack) {
    stack = document.createElement('div');
    stack.className = `td-toast-stack is-${ch}`;
    root.appendChild(stack);
  }

  const toast = document.createElement('div');
  toast.className = `td-toast is-${k}`;
  const badgeHtml = sourceBadge ? `<span class='td-toast-badge'>${escapeHtml(sourceBadge)}</span>` : '';
  const msgBody = isHtml ? sanitizeToastHtml(message) : escapeHtml(message).replace(/\n/g, '<br>');
  const contentHtml = title
    ? `<div class='td-toast-content'><div class='td-toast-head'>${badgeHtml}<span class='td-toast-title'>${escapeHtml(title)}</span></div><div class='td-toast-msg'>${msgBody}</div></div>`
    : `<div class='td-toast-content'><div class='td-toast-msg'>${badgeHtml}${msgBody}</div></div>`;

  toast.innerHTML = `<span class='td-toast-icon'>${TOAST_ICONS[k]}</span>${contentHtml}<button type='button' class='td-toast-close' aria-label='关闭'>×</button>`;

  const dismiss = () => {
    if (toast.dataset.tdClosing) return;
    toast.dataset.tdClosing = '1';
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 180);
  };
  toast._tdDismiss = dismiss;

  const defaultMs = k === 'error' ? 4600 : (k === 'warning' ? 3600 : 2600);
  const ms = typeof duration === 'number' && !Number.isNaN(duration) ? duration : defaultMs;
  let timer = ms > 0 ? setTimeout(dismiss, ms) : null;

  toast.addEventListener('pointerenter', () => {
    if (timer) { clearTimeout(timer); timer = null; }
  });
  toast.addEventListener('pointerleave', () => {
    if (ms > 0 && !toast.dataset.tdClosing) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(dismiss, 1400);
    }
  });
  toast.querySelector('.td-toast-close')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    dismiss();
  });
  toast.addEventListener('click', (ev) => {
    if (typeof onClick === 'function') {
      try { onClick(ev); } catch (err) {}
    }
    if (tapToDismiss !== false) dismiss();
  });

  stack.appendChild(toast);
  const maxToasts = ch === 'native' ? 5 : 4;
  while (stack.children.length > maxToasts) stack.firstElementChild.remove();
  return toast;
}

export function notify(type, message, opts = {}) {
  const kind = TOAST_ICONS[type] ? type : 'info';
  if (kind === 'error') logError(message);
  else if (kind === 'warning') logWarn(message);
  else logInfo(message);

  if (notifyRuntimeConfig.tdSilentToast && !opts?.forceShow && kind !== 'warning' && kind !== 'error') {
    return;
  }

  const el = showToastElement({
    channel: 'td',
    kind,
    title: opts?.title || '',
    message,
    isHtml: false,
    sourceBadge: 'TD',
    duration: opts?.duration,
  });
  if (el) return;

  try {
    const t = typeof toastr !== 'undefined' ? toastr : window.toastr;
    const origFn = t?.__tdOrig?.[kind] || t?.[kind];
    if (typeof origFn === 'function') origFn.call(t, message, APP_NAME);
  } catch (e) {
    logWarn('toastr 提示调用失败', e);
  }
}

export function genId() {
  try {
    const th = getTH();
    if (th && th.builtin && typeof th.builtin.uuidv4 === 'function') return th.builtin.uuidv4();
    const st = getST();
    if (st && typeof st.uuidv4 === 'function') return st.uuidv4();
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  } catch (e) {
    logWarn('生成 UUID 失败，降级使用随机 ID', e);
  }
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
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('浏览器禁止剪贴板写入');
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

function fallbackLineDiff(a, b) {
  const bPositions = new Map();
  b.forEach((line, idx) => {
    if (!bPositions.has(line)) bPositions.set(line, []);
    bPositions.get(line).push(idx);
  });
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: 'ctx', text: a[i] });
      i++;
      j++;
      continue;
    }
    const hits = bPositions.get(a[i]);
    let matchJ = -1;
    if (hits) {
      for (let k = 0; k < hits.length; k++) {
        if (hits[k] >= j && hits[k] - j <= 40) { matchJ = hits[k]; break; }
      }
    }
    if (matchJ >= 0) {
      while (j < matchJ) lines.push({ type: 'add', text: b[j++] });
    } else {
      lines.push({ type: 'del', text: a[i++] });
    }
  }
  while (i < a.length) lines.push({ type: 'del', text: a[i++] });
  while (j < b.length) lines.push({ type: 'add', text: b[j++] });
  return lines;
}

export function computeLineDiff(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');

  let prefix = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefix < minLen && a[prefix] === b[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < (a.length - prefix)
    && suffix < (b.length - prefix)
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  let midLines;
  if (aMid.length === 0 && bMid.length === 0) {
    midLines = [];
  } else if (aMid.length * bMid.length > 160000) {
    midLines = fallbackLineDiff(aMid, bMid);
  } else {
    const m = aMid.length;
    const n = bMid.length;
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (aMid[i] === bMid[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
    midLines = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (aMid[i] === bMid[j]) {
        midLines.push({ type: 'ctx', text: aMid[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        midLines.push({ type: 'del', text: aMid[i++] });
      } else {
        midLines.push({ type: 'add', text: bMid[j++] });
      }
    }
    while (i < m) midLines.push({ type: 'del', text: aMid[i++] });
    while (j < n) midLines.push({ type: 'add', text: bMid[j++] });
  }

  const lines = [];
  for (let i = 0; i < prefix; i++) lines.push({ type: 'ctx', text: a[i] });
  for (let i = 0; i < midLines.length; i++) lines.push(midLines[i]);
  for (let i = a.length - suffix; i < a.length; i++) lines.push({ type: 'ctx', text: a[i] });
  return lines;
}

function mergeSpans(arr) {
  const out = [];
  arr.forEach((seg) => {
    if (!seg.text) return;
    const prev = out[out.length - 1];
    if (prev && prev.changed === seg.changed) prev.text += seg.text;
    else out.push({ text: seg.text, changed: seg.changed });
  });
  return out;
}

function computeInlineTokenDiff(oldLine, newLine) {
  const ta = String(oldLine || '').match(/[A-Za-z0-9_]+|\s+|./g) || [];
  const tb = String(newLine || '').match(/[A-Za-z0-9_]+|\s+|./g) || [];
  let prefix = 0;
  const minLen = Math.min(ta.length, tb.length);
  while (prefix < minLen && ta[prefix] === tb[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < (ta.length - prefix)
    && suffix < (tb.length - prefix)
    && ta[ta.length - 1 - suffix] === tb[tb.length - 1 - suffix]
  ) {
    suffix++;
  }

  const aMid = ta.slice(prefix, ta.length - suffix);
  const bMid = tb.slice(prefix, tb.length - suffix);

  const oldSpans = [];
  const newSpans = [];
  if (prefix > 0) {
    const pTxt = ta.slice(0, prefix).join('');
    oldSpans.push({ text: pTxt, changed: false });
    newSpans.push({ text: pTxt, changed: false });
  }

  if (aMid.length * bMid.length > 12000) {
    if (aMid.length > 0) oldSpans.push({ text: aMid.join(''), changed: true });
    if (bMid.length > 0) newSpans.push({ text: bMid.join(''), changed: true });
  } else if (aMid.length > 0 || bMid.length > 0) {
    const m = aMid.length;
    const n = bMid.length;
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (aMid[i] === bMid[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (aMid[i] === bMid[j]) {
        oldSpans.push({ text: aMid[i], changed: false });
        newSpans.push({ text: bMid[j], changed: false });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        oldSpans.push({ text: aMid[i++], changed: true });
      } else {
        newSpans.push({ text: bMid[j++], changed: true });
      }
    }
    while (i < m) oldSpans.push({ text: aMid[i++], changed: true });
    while (j < n) newSpans.push({ text: bMid[j++], changed: true });
  }

  if (suffix > 0) {
    const sTxt = ta.slice(ta.length - suffix).join('');
    oldSpans.push({ text: sTxt, changed: false });
    newSpans.push({ text: sTxt, changed: false });
  }

  return { oldSpans: mergeSpans(oldSpans), newSpans: mergeSpans(newSpans) };
}

export function computeSideLineDiffs(oldText, newText) {
  const ops = computeLineDiff(oldText, newText);
  const oldLines = [];
  const newLines = [];
  let idx = 0;
  while (idx < ops.length) {
    if (ops[idx].type === 'ctx') {
      oldLines.push({ text: ops[idx].text, status: 'ctx' });
      newLines.push({ text: ops[idx].text, status: 'ctx' });
      idx++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (idx < ops.length && ops[idx].type !== 'ctx') {
      if (ops[idx].type === 'del') dels.push(ops[idx].text);
      else adds.push(ops[idx].text);
      idx++;
    }
    const pairCount = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairCount; k++) {
      const { oldSpans, newSpans } = computeInlineTokenDiff(dels[k], adds[k]);
      oldLines.push({ text: dels[k], status: 'mod', spans: oldSpans });
      newLines.push({ text: adds[k], status: 'mod', spans: newSpans });
    }
    for (let k = pairCount; k < dels.length; k++) {
      oldLines.push({ text: dels[k], status: 'del' });
    }
    for (let k = pairCount; k < adds.length; k++) {
      newLines.push({ text: adds[k], status: 'add' });
    }
  }
  return { oldLines, newLines };
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
        try { return new RegExp(m[1], m[2]); } catch (e) { logWarn(`正则关键词解析失败: ${token}`, e); }
      }
      return token;
    });
}

export function keysSignature(keys) {
  if (!Array.isArray(keys)) return '';
  return keys.map(formatKeyItem).join('\x00');
}

export function downloadTextFile(text, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([String(text || '')], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}

export function downloadJsonFile(obj, filename) {
  downloadTextFile(JSON.stringify(obj, null, 2), filename, 'application/json;charset=utf-8');
}
