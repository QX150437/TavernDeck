import { APP_NAME, APP_VERSION } from './utils.js';

const logBuffer = [];
const MAX_LOGS = 200;
let captureInstalled = false;

const OWN_FILES = [
  'taverndeck', 'ui-app.js', 'ui-views.js', 'ui-managers.js', 'merge-ui.js',
  'preset-merge.js', 'worldbook-merge.js', 'preset-manager.js', 'worldbook-manager.js',
  'ai-preset-edit.js', 'catalog.js', 'snapshot.js', 'native-ui.js', 'dev-tools.js',
];

function isOwnSource(text) {
  const s = String(text || '').toLowerCase();
  return OWN_FILES.some((f) => s.includes(f));
}

function formatLogArg(a) {
  if (a instanceof Error) {
    return a.stack ? `${a.message} | ${a.stack.split('\n')[0]}` : (a.message || String(a));
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

function stripAppPrefix(txt) {
  return String(txt || '').replace(new RegExp(`^\\[${APP_NAME}\\]\\s*`), '');
}

export function pushDevLog(level, message) {
  const d = new Date();
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  logBuffer.unshift({ time, level: level || 'INFO', message: stripAppPrefix(message) });
  if (logBuffer.length > MAX_LOGS) logBuffer.length = MAX_LOGS;
}

export function getDevLogs(levelFilter = 'ALL') {
  if (!levelFilter || levelFilter === 'ALL') return logBuffer.slice();
  return logBuffer.filter((l) => l.level === levelFilter);
}

export function clearDevLogs() {
  logBuffer.length = 0;
  pushDevLog('INFO', '日志已清空');
}

export function formatLogsReport(levelFilter = 'ALL') {
  const list = getDevLogs(levelFilter);
  const header = `=== ${APP_NAME} ${APP_VERSION} 运行日志 (${list.length} 条) ===`;
  if (list.length === 0) return `${header}\n（暂无日志）`;
  return [header, ...list.map((l) => `[${l.time}][${l.level}] ${l.message}`)].join('\n');
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
      if (txt.includes(APP_NAME)) pushDevLog('WARN', txt);
    } catch (e) {}
    return origWarn.apply(this, args);
  };
  console.error = function (...args) {
    try {
      const txt = args.map(formatLogArg).join(' ');
      if (txt.includes(APP_NAME)) pushDevLog('ERR', txt);
    } catch (e) {}
    return origError.apply(this, args);
  };

  window.addEventListener('error', (ev) => {
    const file = String(ev.filename || '');
    const msg = String(ev.message || '');
    if (isOwnSource(file) || isOwnSource(msg)) {
      pushDevLog('ERR', `${msg || 'Uncaught Error'} (${file}:${ev.lineno || 0})`);
    }
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const msg = formatLogArg(ev.reason);
    const stack = ev.reason instanceof Error ? String(ev.reason.stack || '') : '';
    if (isOwnSource(msg) || isOwnSource(stack)) {
      pushDevLog('ERR', `UnhandledRejection: ${msg}`);
    }
  });
}
