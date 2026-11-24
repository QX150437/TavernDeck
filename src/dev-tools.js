import { APP_NAME, APP_VERSION } from './utils.js';

const logBuffer = [];
const opStepBuffer = [];
const MAX_LOGS = 200;
const MAX_STEPS = 15;
let captureInstalled = false;
let currentUiContext = '主面板';
let persistLogHandler = null;

const OWN_FILES = [
  'taverndeck', 'index.js', 'utils.js', 'store.js', 'dev-tools.js', 'native-ui.js',
  'catalog.js', 'snapshot.js', 'preset-manager.js', 'preset-merge.js',
  'worldbook-manager.js', 'worldbook-merge.js', 'ai-preset-edit.js', 'merge-ui.js',
  'ui-app.js', 'ui-views.js', 'ui-common.js', 'ui-drag.js', 'ui-groups.js',
  'ui-snapshots.js', 'ui-presets.js', 'ui-preset-vars.js', 'ui-worldbooks.js',
  'ui-ai-assistant.js', 'ui-mvu.js', 'ui-merge-panel.js', 'ui-merge-dialogs.js',
  'ui-settings.js', 'ui-tools.js', 'ui-help.js', 'ui-snippets.js', 'ui-editor-search.js',
];

function isOwnSource(text) {
  const s = String(text || '').toLowerCase();
  return OWN_FILES.some((f) => s.includes(f));
}

function getNowDateStr(d = new Date()) {
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getNowTimeStr(d = new Date()) {
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatLogArg(a) {
  if (a instanceof Error) {
    return a.message || String(a);
  }
  if (a && typeof a === 'object') {
    if (typeof a.message === 'string') return a.message;
    try {
      const s = JSON.stringify(a);
      return s === '{}' ? String(a) : s;
    } catch (e) {
      return String(a);
    }
  }
  return String(a);
}

function cleanStackLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || /^Error\b/i.test(trimmed)) return '';
  if (trimmed.includes('dev-tools.js')) return '';
  if (/\b(logWarn|logError|logInfo|notify)\b/.test(trimmed) && trimmed.includes('utils.js')) return '';
  const m = trimmed.match(/((?:src\/)?[A-Za-z0-9_.-]+\.js:\d+:\d+)/);
  const fnMatch = trimmed.match(/^at\s+([^\s(]+)\s*\(/);
  if (m) {
    return fnMatch ? `${fnMatch[1]} (${m[1]})` : m[1];
  }
  return trimmed.slice(0, 120);
}

function extractStackFromArgs(args) {
  let rawStack = '';
  for (let i = 0; i < (args || []).length; i++) {
    if (args[i] instanceof Error && args[i].stack) {
      rawStack = String(args[i].stack);
      break;
    }
  }
  if (!rawStack) {
    try { rawStack = String(new Error().stack || ''); } catch (e) { rawStack = ''; }
  }
  if (!rawStack) return '';
  const frames = rawStack.split('\n').map(cleanStackLine).filter(Boolean);
  return frames.slice(0, 5).join('\n');
}

function stripAppPrefix(txt) {
  return String(txt || '').replace(new RegExp(`^\\[${APP_NAME}\\]\\s*`), '');
}

export function setDevUiContext(ctxLabel) {
  const clean = String(ctxLabel || '').trim();
  if (clean) currentUiContext = clean;
}

export function setDevLogPersistHandler(fn) {
  persistLogHandler = typeof fn === 'function' ? fn : null;
}

export function recordOpStep(stepLabel, detail = '') {
  const step = String(stepLabel || '').trim();
  if (!step) return;
  const time = getNowTimeStr();
  const det = String(detail || '').trim();
  const prev = opStepBuffer[0];
  if (prev && prev.step === step && prev.detail === det && prev.ui === currentUiContext && prev.time === time) {
    return;
  }
  opStepBuffer.unshift({ time, ui: currentUiContext, step, detail: det });
  if (opStepBuffer.length > MAX_STEPS) opStepBuffer.length = MAX_STEPS;
}

export function getRecentOpSteps(limit = 6) {
  return opStepBuffer.slice(0, limit);
}

export function pushDevLog(level, message, extra = {}) {
  const now = new Date();
  const date = getNowDateStr(now);
  const time = getNowTimeStr(now);
  const ts = now.getTime();
  const lv = level || 'INFO';
  const entry = {
    date,
    time,
    ts,
    level: lv,
    message: stripAppPrefix(message),
    uiContext: '',
    step: '',
    trail: '',
    stack: '',
  };

  if (lv === 'WARN' || lv === 'ERR') {
    const latest = opStepBuffer[0];
    entry.uiContext = extra.uiContext || currentUiContext || '未知界面';
    entry.step = extra.step || (latest ? `${latest.step}${latest.detail ? ` (${latest.detail})` : ''}` : '自动后台同步 / 初始化');
    entry.trail = extra.trail || opStepBuffer.slice(0, 5)
      .map((s) => `[${s.time}] ${s.ui ? `${s.ui} -> ` : ''}${s.step}${s.detail ? ` (${s.detail})` : ''}`)
      .join('\n');
    entry.stack = extra.stack || '';
    if (persistLogHandler && !extra.skipPersist) {
      try { persistLogHandler(Object.assign({}, entry)); } catch (e) {}
    }
  }

  logBuffer.unshift(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.length = MAX_LOGS;
}

export function getDevLogs(levelFilter = 'ALL') {
  if (!levelFilter || levelFilter === 'ALL') return logBuffer.slice();
  return logBuffer.filter((l) => l.level === levelFilter);
}

export function clearDevLogs() {
  logBuffer.length = 0;
}

export function formatSingleLogReport(l) {
  if (!l) return '';
  const lines = [`[${l.date ? `${l.date} ` : ''}${l.time}][${l.level}] ${l.message}`];
  if (l.uiContext) lines.push(`  当前界面: ${l.uiContext}`);
  if (l.step) lines.push(`  触发步骤: ${l.step}`);
  if (l.trail) {
    lines.push('  近期操作轨迹:');
    l.trail.split('\n').forEach((t) => lines.push(`    ${t}`));
  }
  if (l.stack) {
    lines.push('  调用堆栈:');
    l.stack.split('\n').forEach((st) => lines.push(`    ${st}`));
  }
  return lines.join('\n');
}

export function formatLogsReport(levelFilter = 'ALL') {
  const list = getDevLogs(levelFilter);
  const header = `=== ${APP_NAME} ${APP_VERSION} 运行日志 (${list.length} 条) ===`;
  if (list.length === 0) return `${header}\n（暂无日志）`;
  return [header, ...list.map(formatSingleLogReport)].join('\n');
}

export function formatDayLogsReport(date, logs, levelFilter = 'ALL') {
  const arr = Array.isArray(logs) ? logs : [];
  const list = (!levelFilter || levelFilter === 'ALL') ? arr : arr.filter((l) => l.level === levelFilter);
  const header = `=== ${APP_NAME} ${APP_VERSION} 后端日志存档 [${date}] (${list.length} 条) ===`;
  if (list.length === 0) return `${header}\n（暂无日志）`;
  return [header, ...list.map(formatSingleLogReport)].join('\n');
}

export function initDevErrorCapture() {
  if (captureInstalled) return;
  captureInstalled = true;
  pushDevLog('INFO', `${APP_NAME} ${APP_VERSION} 初始化完成`);

  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;

  console.info = function (...args) {
    try {
      const txt = args.map(formatLogArg).join(' ');
      if (txt.includes(APP_NAME)) pushDevLog('INFO', txt);
    } catch (e) {}
    return origInfo.apply(this, args);
  };
  console.warn = function (...args) {
    try {
      const txt = args.map(formatLogArg).join(' ');
      if (txt.includes(APP_NAME)) {
        pushDevLog('WARN', txt, { stack: extractStackFromArgs(args) });
      }
    } catch (e) {}
    return origWarn.apply(this, args);
  };
  console.error = function (...args) {
    try {
      const txt = args.map(formatLogArg).join(' ');
      if (txt.includes(APP_NAME)) {
        pushDevLog('ERR', txt, { stack: extractStackFromArgs(args) });
      }
    } catch (e) {}
    return origError.apply(this, args);
  };

  window.addEventListener('error', (ev) => {
    const file = String(ev.filename || '');
    const msg = String(ev.message || '');
    const stackStr = ev.error instanceof Error ? String(ev.error.stack || '') : '';
    if (isOwnSource(file) || isOwnSource(msg) || isOwnSource(stackStr)) {
      pushDevLog('ERR', `${msg || 'Uncaught Error'} (${file}:${ev.lineno || 0})`, {
        stack: extractStackFromArgs(ev.error ? [ev.error] : []),
      });
    }
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const msg = formatLogArg(ev.reason);
    const stackStr = ev.reason instanceof Error ? String(ev.reason.stack || '') : '';
    if (isOwnSource(msg) || isOwnSource(stackStr)) {
      pushDevLog('ERR', `UnhandledRejection: ${msg}`, {
        stack: extractStackFromArgs(ev.reason instanceof Error ? [ev.reason] : []),
      });
    }
  });
}
