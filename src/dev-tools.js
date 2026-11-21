import { APP_NAME, APP_VERSION } from './utils.js';

const logBuffer = [];
const MAX_LOGS = 200;
let captureInstalled = false;

export function pushDevLog(level, message) {
  const d = new Date();
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  logBuffer.unshift({ time, level: level || 'INFO', message: String(message || '') });
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

  const origWarn = console.warn;
  const origError = console.error;
  console.warn = function (...args) {
    try {
      const txt = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      if (txt.includes(APP_NAME)) pushDevLog('WARN', txt);
    } catch (e) {}
    return origWarn.apply(this, args);
  };
  console.error = function (...args) {
    try {
      const txt = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack || ''}` : (typeof a === 'object' ? JSON.stringify(a) : String(a)))).join(' ');
      if (txt.includes(APP_NAME)) pushDevLog('ERR', txt);
    } catch (e) {}
    return origError.apply(this, args);
  };

  window.addEventListener('error', (ev) => {
    const file = String(ev.filename || '');
    if (file.includes('TavernDeck') || String(ev.message || '').includes(APP_NAME)) {
      pushDevLog('ERR', `${ev.message || 'Uncaught Error'} (${file}:${ev.lineno || 0})`);
    }
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const msg = ev.reason instanceof Error ? `${ev.reason.message}\n${ev.reason.stack || ''}` : String(ev.reason || '');
    if (msg.includes(APP_NAME) || msg.includes('TavernDeck')) {
      pushDevLog('ERR', `UnhandledRejection: ${msg}`);
    }
  });
}
