import {
  escapeHtml, notify, computeLineDiff, hasTH, callTH, getST,
  copyToClipboard, logWarn, logError,
} from './utils.js';
import { state, saveStore } from './store.js';
import { isInActiveChat } from './worldbook-manager.js';
import { runAiMvuUpdate } from './ai-preset-edit.js';
import {
  renderCollapsibleAiApiBoxHtml, saveSharedAiApiFieldsFromPreview,
  syncAiPreviewDraftInputs, setAiRunBtnLoading,
} from './ui-ai-assistant.js';
import {
  ICONS, uiCtx, editHistory, readPreviewSnapshot,
  updatePreviewHistoryButtons, pushEditSnapshot,
} from './ui-common.js';

const STAR_OUTLINE_SVG = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/></svg>";
const STAR_FILLED_SVG = "<svg viewBox='0 0 24 24' fill='currentColor' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/></svg>";

function getMvuCharScopeId(charName) {
  try {
    if (hasTH('getCurrentCharacterId')) {
      const cid = callTH('getCurrentCharacterId');
      if (cid) return String(cid);
    }
  } catch (e) {}
  return String(charName || '__default__');
}

function getMvuChatKey(charName) {
  const charScope = getMvuCharScopeId(charName);
  let chatId = '';
  try {
    const st = getST();
    chatId = String(st?.getCurrentChatId?.() || st?.chatId || '').trim();
  } catch (e) {}
  return `${charScope}::${chatId || '__default__'}`;
}

function getMvuStarredList(chatKey) {
  const ext = (state.store.extensions = state.store.extensions || {});
  const map = (ext.mvuStarred = ext.mvuStarred || {});
  return Array.isArray(map[chatKey]) ? map[chatKey] : [];
}

function getOtherChatStarredCandidates(charScopeId, curChatKey) {
  const ext = state.store.extensions || {};
  const map = ext.mvuStarred || {};
  const prefix = `${charScopeId}::`;
  const merged = [];
  const seen = new Set();
  Object.keys(map).forEach((k) => {
    if (k !== curChatKey && k.startsWith(prefix) && Array.isArray(map[k])) {
      map[k].forEach((sk) => {
        if (!seen.has(sk)) { seen.add(sk); merged.push(sk); }
      });
    }
  });
  return merged;
}

function toggleMvuStarKey(chatKey, starKey) {
  const ext = (state.store.extensions = state.store.extensions || {});
  const map = (ext.mvuStarred = ext.mvuStarred || {});
  const list = Array.isArray(map[chatKey]) ? map[chatKey].slice() : [];
  const idx = list.indexOf(starKey);
  let starred = false;
  if (idx >= 0) list.splice(idx, 1);
  else { list.push(starKey); starred = true; }
  if (list.length > 0) map[chatKey] = list;
  else delete map[chatKey];
  saveStore(state.store);
  return starred;
}

function formatPartsDisplay(parts) {
  let out = '';
  (parts || []).forEach((p) => {
    const s = String(p);
    if (/^\d+$/.test(s) && out) out += `[${s}]`;
    else out += (out ? `.${s}` : s);
  });
  return out;
}

function getByPathParts(rootObj, parts) {
  let cur = rootObj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return { found: false, val: undefined };
    const k = parts[i];
    if (Array.isArray(cur)) {
      const idx = Number(k);
      if (Number.isNaN(idx) || idx < 0 || idx >= cur.length) return { found: false, val: undefined };
      cur = cur[idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, k)) return { found: false, val: undefined };
      cur = cur[k];
    }
  }
  return { found: true, val: cur };
}

function makeMvuStarInfo(pathParts, isStatRoot, hasStatData) {
  if (isStatRoot) return { starKey: `stat:${JSON.stringify(pathParts)}`, editInStat: true };
  if (hasStatData && pathParts[0] === 'stat_data' && pathParts.length > 1) {
    return { starKey: `stat:${JSON.stringify(pathParts.slice(1))}`, editInStat: true };
  }
  return { starKey: `raw:${JSON.stringify(pathParts)}`, editInStat: false };
}

function setByPathParts(rootObj, parts, newVal) {
  let cur = rootObj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur?.[parts[i]];
    if (cur === undefined || cur === null) throw new Error('目标路径不存在');
  }
  const lastKey = parts[parts.length - 1];
  if (Array.isArray(cur)) cur[Number(lastKey)] = newVal;
  else cur[lastKey] = newVal;
}

function matchesMvuFilter(path, val, q) {
  if (!q) return true;
  if (path.toLowerCase().includes(q)) return true;
  if (val === null || val === undefined || typeof val !== 'object') {
    return String(val).toLowerCase().includes(q);
  }
  const entries = Array.isArray(val) ? val.map((v, i) => [String(i), v]) : Object.entries(val);
  return entries.some(([k, v]) => matchesMvuFilter(`${path}.${k}`, v, q));
}

function collectMvuContainerPaths(obj, parts, outSet) {
  if (!obj || typeof obj !== 'object') return;
  const entries = Array.isArray(obj) ? obj.map((v, i) => [String(i), v]) : Object.entries(obj);
  entries.forEach(([k, v]) => {
    if (v && typeof v === 'object') {
      const nextParts = [...parts, k];
      outSet.add(JSON.stringify(nextParts));
      collectMvuContainerPaths(v, nextParts, outSet);
    }
  });
}

function readMvuViewerState(m) {
  const charName = hasTH('getCurrentCharacterName') ? (callTH('getCurrentCharacterName') || '') : '';
  const inCharChat = !!(charName && isInActiveChat());
  if (!inCharChat) return { inCharChat: false, charName: '' };

  let lastMsgId = -1;
  try {
    if (hasTH('getLastMessageId')) lastMsgId = Number(callTH('getLastMessageId'));
    if (Number.isNaN(lastMsgId)) lastMsgId = -1;
  } catch (e) { lastMsgId = -1; }

  const hasMvuApi = !!(typeof window !== 'undefined' && window.Mvu && typeof window.Mvu.getMvuData === 'function');
  const tryReadFloor = (msgId) => {
    try {
      const opt = { type: 'message', message_id: msgId };
      if (hasMvuApi) return window.Mvu.getMvuData(opt);
      if (hasTH('getVariables')) return callTH('getVariables', opt);
    } catch (e) {}
    return null;
  };

  let rawData = null;
  let resolvedFloor = lastMsgId;
  let autoBacktracked = false;

  if (lastMsgId >= 0) {
    if (m.floor === 'latest' || m.floor === undefined || m.floor === null) {
      rawData = tryReadFloor(lastMsgId);
      if (!rawData || (typeof rawData === 'object' && !rawData.stat_data)) {
        for (let id = lastMsgId - 1; id >= 0; id--) {
          const cand = tryReadFloor(id);
          if (cand && typeof cand === 'object' && cand.stat_data) {
            rawData = cand;
            resolvedFloor = id;
            autoBacktracked = true;
            break;
          }
        }
      }
    } else {
      resolvedFloor = Math.max(0, Math.min(lastMsgId, Math.floor(Number(m.floor) || 0)));
      rawData = tryReadFloor(resolvedFloor);
    }
  }

  const charScopeId = getMvuCharScopeId(charName);
  const chatKey = getMvuChatKey(charName);
  const hasStatData = !!(rawData && typeof rawData === 'object' && rawData.stat_data && typeof rawData.stat_data === 'object');
  const displayObj = (m.onlyStatData && hasStatData) ? rawData.stat_data : rawData;
  return { inCharChat: true, charName, charScopeId, chatKey, hasMvuApi, lastMsgId, resolvedFloor, autoBacktracked, hasStatData, rawData, displayObj };
}

function extractMvuSnippetFromMessage(text) {
  const s = String(text || '');
  if (!s) return '';
  const unclosed = s.match(/<UpdateVariable[^>]*>([\s\S]*)$/i);
  if (unclosed && !/<\/UpdateVariable>/i.test(unclosed[0])) {
    return unclosed[1].trim();
  }
  const closed = s.match(/<UpdateVariable[^>]*>([\s\S]*?)<\/UpdateVariable>/i);
  if (closed && closed[1]) return closed[1].trim();
  const lines = s.split('\n').filter((l) => /^\s*_\.(set|add|insert|delete|move)\s*\(/.test(l));
  return lines.join('\n').trim();
}

function collectWorldbookMvuRuleCandidates() {
  const out = [];
  (state.catalog.worldbook?.groups || []).forEach((grp) => {
    (grp.items || []).forEach((item) => {
      const raw = item.raw;
      if (!raw || !raw.content) return;
      const nm = String(item.name || '');
      const ct = String(raw.content || '');
      const autoMatched = !!raw.enabled && (
        /UpdateVariable|_\.(set|add|insert|delete|move)\s*\(/i.test(ct)
        || (/变量|mvu/i.test(nm) && !/^\s*\[?initvar\]?/i.test(nm))
      );
      out.push({
        key: item.key,
        bookName: grp.bookName || grp.title || '',
        name: nm || `条目 #${item.uid}`,
        content: ct,
        enabled: !!raw.enabled,
        autoMatched,
      });
    });
  });
  return out;
}

async function saveFloorMvuData(floorId, nextData) {
  const opt = { type: 'message', message_id: floorId };
  if (typeof window !== 'undefined' && window.Mvu && typeof window.Mvu.replaceMvuData === 'function') {
    await window.Mvu.replaceMvuData(nextData, opt);
  } else if (hasTH('replaceVariables')) {
    callTH('replaceVariables', nextData, opt);
  } else {
    throw new Error('当前环境不支持 replaceMvuData 或 replaceVariables');
  }
  if (hasTH('refreshOneMessage')) {
    try { await callTH('refreshOneMessage', floorId); } catch (e) { logWarn('刷新楼层显示失败', e); }
  }
}

async function parseMvuCommandsPreview(cmdText, baseMvuData) {
  if (typeof window === 'undefined' || !window.Mvu || typeof window.Mvu.parseMessage !== 'function') {
    throw new Error('未检测到全局 window.Mvu.parseMessage 接口，请确认已启用 MVU 变量框架脚本');
  }
  const oldCopy = JSON.parse(JSON.stringify(baseMvuData || { initialized_lorebooks: {}, stat_data: {} }));
  const nextData = await window.Mvu.parseMessage(String(cmdText || ''), oldCopy);
  if (!nextData) {
    throw new Error('未解析出有效的变量更新（请检查是否包含合法的 _.set / _.add 等命令）');
  }
  const oldStat = JSON.stringify(oldCopy.stat_data ?? oldCopy, null, 2);
  const newStat = JSON.stringify(nextData.stat_data ?? nextData, null, 2);
  return { nextData, diffLines: computeLineDiff(oldStat, newStat) };
}

function renderMvuTreeHtml(obj, pathParts, displayPrefix, q, collapsedSet, nodeList, opts = {}) {
  const { starredSet = new Set(), isStatRoot = true, hasStatData = true } = opts;
  if (!obj || typeof obj !== 'object') {
    return `<div class='td-mvu-row'><span class='td-mvu-key'>值</span><span class='td-mvu-val'>${escapeHtml(String(obj))}</span></div>`;
  }
  const isArr = Array.isArray(obj);
  const entries = isArr ? obj.map((v, i) => [String(i), v]) : Object.entries(obj);
  if (entries.length === 0) return "<div class='td-group-empty'>当前变量对象为空</div>";

  const html = entries.map(([k, v]) => {
    const nextParts = [...pathParts, k];
    const keyId = JSON.stringify(nextParts);
    const displayPath = displayPrefix ? (isArr ? `${displayPrefix}[${k}]` : `${displayPrefix}.${k}`) : k;
    if (q && !matchesMvuFilter(displayPath, v, q)) return '';

    const { starKey, editInStat } = makeMvuStarInfo(nextParts, isStatRoot, hasStatData);
    const isStarred = starredSet.has(starKey);
    const canStar = isStatRoot || nextParts[0] !== 'stat_data' || nextParts.length > 1;
    const nid = String(nodeList.length);
    nodeList.push({
      keyId,
      starKey,
      displayPath,
      pathParts: editInStat && !isStatRoot ? nextParts.slice(1) : nextParts,
      editInStat,
      val: v,
    });

    const starBtn = canStar
      ? `<button type='button' class='td-icon-btn td-mvu-star ${isStarred ? 'is-starred' : ''}' data-action='mvu-toggle-star' data-starkey='${escapeHtml(starKey)}' title='${isStarred ? '取消加精' : '加精重点关注'}'>${isStarred ? STAR_FILLED_SVG : STAR_OUTLINE_SVG}</button>`
      : '';

    if (v !== null && typeof v === 'object') {
      const childIsArr = Array.isArray(v);
      const count = childIsArr ? v.length : Object.keys(v).length;
      const isCollapsed = !q && collapsedSet.has(keyId);
      const tuplePreview = childIsArr && count > 0 && count <= 2 && v.every((x) => x === null || typeof x !== 'object')
        ? `= ${v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' · ')}`
        : '';
      return `
        <div class='td-mvu-node ${isCollapsed ? 'is-collapsed' : ''}'>
          <div class='td-mvu-head' data-action='mvu-toggle-node' data-nid='${nid}'>
            <span class='td-chevron'>${ICONS.chevron}</span>
            <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(k)}</span>
            ${tuplePreview ? `<span class='td-mvu-preview' title='${escapeHtml(tuplePreview)}'>${escapeHtml(tuplePreview)}</span>` : ''}
            <span class='td-mvu-badge'>${childIsArr ? `[${count}]` : `{${count}}`}</span>
            ${starBtn}
            <button type='button' class='td-icon-btn' data-action='mvu-copy-val' data-nid='${nid}' title='复制此节点'>${ICONS.copy}</button>
          </div>
          ${isCollapsed ? '' : `<div class='td-mvu-children'>${renderMvuTreeHtml(v, nextParts, displayPath, q, collapsedSet, nodeList, opts)}</div>`}
        </div>`;
    }

    const typeCls = typeof v === 'number' ? 'is-num' : (typeof v === 'boolean' ? 'is-bool' : (v === null || v === undefined ? 'is-null' : 'is-str'));
    const valText = typeof v === 'string' ? (v === '' ? '""' : v) : String(v);
    return `
      <div class='td-mvu-row'>
        <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(k)}</span>
        <span class='td-mvu-val ${typeCls}' title='${escapeHtml(valText)}'>${escapeHtml(valText)}</span>
        <div class='td-mvu-ops'>
          ${starBtn}
          <button type='button' class='td-icon-btn' data-action='mvu-edit-val' data-nid='${nid}' title='修改数值'>${ICONS.edit}</button>
          <button type='button' class='td-icon-btn' data-action='mvu-copy-val' data-nid='${nid}' title='复制数值'>${ICONS.copy}</button>
        </div>
      </div>`;
  }).join('');

  return html || "<div class='td-group-empty'>未匹配到相关变量</div>";
}

function renderMvuStarredListHtml(starredList, info, q, collapsedSet, nodeList, starredSet) {
  if (!starredList || starredList.length === 0) {
    const otherStars = getOtherChatStarredCandidates(info.charScopeId, info.chatKey);
    return `
      <div class='td-empty'>
        <div class='td-empty-title'>当前聊天暂无加精变量</div>
        <div class='td-empty-desc'>各聊天的加精列表相互独立。在「全部变量」中点击任意变量右侧的星标 ☆ 即可加精重点关注，下次打开本聊天将默认展示。</div>
        <div style='display:flex;gap:8px;flex-wrap:wrap;justify-content:center;'>
          <button type='button' class='td-btn primary' data-action='mvu-set-view' data-view='all'>前往全部变量添加</button>
          ${otherStars.length > 0 ? `<button type='button' class='td-btn' data-action='mvu-import-char-stars'>导入同卡其他聊天的加精 (${otherStars.length})</button>` : ''}
        </div>
      </div>`;
  }

  const exportMap = {};
  const html = starredList.map((starKey) => {
    const isStat = starKey.startsWith('stat:');
    let parts = [];
    try { parts = JSON.parse(starKey.slice(isStat ? 5 : 4)); } catch (e) { return ''; }
    if (!Array.isArray(parts) || parts.length === 0) return '';

    const displayPath = formatPartsDisplay(parts);
    const rootObj = isStat ? info.rawData?.stat_data : info.rawData;
    const { found, val } = getByPathParts(rootObj, parts);

    if (q) {
      if (found) {
        if (!matchesMvuFilter(displayPath, val, q)) return '';
      } else if (!displayPath.toLowerCase().includes(q)) {
        return '';
      }
    }

    if (found) exportMap[displayPath] = val;
    const keyId = `starred::${starKey}`;
    const nid = String(nodeList.length);
    nodeList.push({
      keyId,
      starKey,
      displayPath,
      pathParts: parts,
      editInStat: isStat,
      val: found ? val : undefined,
    });

    const starBtn = `<button type='button' class='td-icon-btn td-mvu-star is-starred' data-action='mvu-toggle-star' data-starkey='${escapeHtml(starKey)}' title='取消加精'>${STAR_FILLED_SVG}</button>`;

    if (!found) {
      return `
        <div class='td-mvu-row is-missing'>
          <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(displayPath)}</span>
          <span class='td-mvu-val is-null'>（当前楼层暂无）</span>
          <div class='td-mvu-ops'>${starBtn}</div>
        </div>`;
    }

    if (val !== null && typeof val === 'object') {
      const childIsArr = Array.isArray(val);
      const count = childIsArr ? val.length : Object.keys(val).length;
      const isCollapsed = !q && collapsedSet.has(keyId);
      const tuplePreview = childIsArr && count > 0 && count <= 2 && val.every((x) => x === null || typeof x !== 'object')
        ? `= ${val.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' · ')}`
        : '';
      return `
        <div class='td-mvu-node ${isCollapsed ? 'is-collapsed' : ''}'>
          <div class='td-mvu-head' data-action='mvu-toggle-node' data-nid='${nid}'>
            <span class='td-chevron'>${ICONS.chevron}</span>
            <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(displayPath)}</span>
            ${tuplePreview ? `<span class='td-mvu-preview' title='${escapeHtml(tuplePreview)}'>${escapeHtml(tuplePreview)}</span>` : ''}
            <span class='td-mvu-badge'>${childIsArr ? `[${count}]` : `{${count}}`}</span>
            ${starBtn}
            <button type='button' class='td-icon-btn' data-action='mvu-copy-val' data-nid='${nid}' title='复制此节点'>${ICONS.copy}</button>
          </div>
          ${isCollapsed ? '' : `<div class='td-mvu-children'>${renderMvuTreeHtml(val, parts, displayPath, '', collapsedSet, nodeList, { starredSet, isStatRoot: isStat, hasStatData: info.hasStatData })}</div>`}
        </div>`;
    }

    const typeCls = typeof val === 'number' ? 'is-num' : (typeof val === 'boolean' ? 'is-bool' : (val === null || val === undefined ? 'is-null' : 'is-str'));
    const valText = typeof val === 'string' ? (val === '' ? '""' : val) : String(val);
    return `
      <div class='td-mvu-row'>
        <span class='td-mvu-key' title='${escapeHtml(displayPath)}'>${escapeHtml(displayPath)}</span>
        <span class='td-mvu-val ${typeCls}' title='${escapeHtml(valText)}'>${escapeHtml(valText)}</span>
        <div class='td-mvu-ops'>
          ${starBtn}
          <button type='button' class='td-icon-btn' data-action='mvu-edit-val' data-nid='${nid}' title='修改数值'>${ICONS.edit}</button>
          <button type='button' class='td-icon-btn' data-action='mvu-copy-val' data-nid='${nid}' title='复制数值'>${ICONS.copy}</button>
        </div>
      </div>`;
  }).join('');

  return {
    exportMap,
    html: html || "<div class='td-group-empty'>未匹配到相关加精变量</div>",
  };
}

export const mvuUiModule = {
  renderModal(m, modalLayerEl) {
    if (m.type !== 'mvuViewer') return false;
    const info = readMvuViewerState(m);
    if (!info.inCharChat) {
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-sm'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.eye} MVU 变量查看</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          <div class='td-modal-body'><div class='td-empty'><div class='td-empty-title'>未进入角色卡聊天</div><div class='td-empty-desc'>该功能仅在进入角色卡聊天后展示相关变量信息与数值。</div></div></div>
          <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>关闭</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    const starredList = getMvuStarredList(info.chatKey);
    const starredSet = new Set(starredList);
    if (m._chatKey && m._chatKey !== info.chatKey) {
      m.floor = 'latest';
      m.collapsed = new Set();
      m.viewMode = starredList.length > 0 ? 'starred' : 'all';
    }
    if (!m.viewMode) m.viewMode = starredList.length > 0 ? 'starred' : 'all';
    const viewMode = m.viewMode === 'starred' ? 'starred' : 'all';

    m._charScopeId = info.charScopeId;
    m._chatKey = info.chatKey;
    m._resolvedFloor = info.resolvedFloor;
    m._lastMsgId = info.lastMsgId;
    m._rawData = info.rawData;
    m._hasStatData = info.hasStatData;
    m._displayObj = info.displayObj;
    m._nodes = [];
    if (!(m.collapsed instanceof Set)) m.collapsed = new Set();

    const q = (m.query || '').trim().toLowerCase();
    const floorBarHtml = `
      <div style='display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0;'>
        <span class='td-bar-label' style='width:auto;'>楼层</span>
        <button type='button' class='td-btn sm' data-action='mvu-floor-step' data-step='-1' ${info.resolvedFloor <= 0 ? 'disabled' : ''}>上一楼</button>
        <input class='td-input' id='td-mvu-floor-input' type='number' min='0' max='${Math.max(0, info.lastMsgId)}' value='${info.resolvedFloor >= 0 ? info.resolvedFloor : 0}' style='width:68px;height:28px;font-size:12.5px;text-align:center;' ${info.lastMsgId < 0 ? 'disabled' : ''} />
        <button type='button' class='td-btn sm' data-action='mvu-floor-step' data-step='1' ${info.resolvedFloor >= info.lastMsgId ? 'disabled' : ''}>下一楼</button>
        <button type='button' class='td-btn sm ${m.floor === 'latest' ? 'primary' : ''}' data-action='mvu-floor-step' data-step='latest' ${info.lastMsgId < 0 ? 'disabled' : ''}>最新${info.lastMsgId >= 0 ? ` (#${info.lastMsgId})` : ''}</button>
        ${info.autoBacktracked ? `<span class='td-mode-tag single'>已定位最近变量楼层 #${info.resolvedFloor}</span>` : ''}
      </div>`;

    let treeHtml = '';
    if (viewMode === 'starred') {
      if (info.lastMsgId < 0 || !info.rawData) {
        m._starredExportObj = {};
        treeHtml = `<div class='td-group-empty'>${info.lastMsgId < 0 ? '当前聊天暂无消息楼层' : '当前楼层暂无 MVU 变量数据'}</div>`;
      } else {
        const res = renderMvuStarredListHtml(starredList, info, q, m.collapsed, m._nodes, starredSet);
        if (typeof res === 'string') {
          m._starredExportObj = {};
          treeHtml = res;
        } else {
          m._starredExportObj = res.exportMap;
          treeHtml = res.html;
        }
      }
    } else {
      m._starredExportObj = null;
      const isStatRoot = !!(m.onlyStatData && info.hasStatData);
      treeHtml = info.displayObj
        ? renderMvuTreeHtml(info.displayObj, [], '', q, m.collapsed, m._nodes, { starredSet, isStatRoot, hasStatData: info.hasStatData })
        : `<div class='td-group-empty'>${info.lastMsgId < 0 ? '当前聊天暂无消息楼层' : '当前楼层暂无 MVU 变量数据'}</div>`;
    }
    const noFloor = info.lastMsgId < 0 || info.resolvedFloor < 0;

    modalLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${ICONS.eye} MVU 楼层变量 · ${escapeHtml(info.charName)}</div>
          <div class='td-modal-head-actions'>
            <button class='td-icon-btn' data-action='mvu-refresh' title='刷新变量'>${ICONS.refresh}</button>
            <button class='td-icon-btn' data-action='mvu-copy-json' title='复制当前 JSON'>${ICONS.copy}</button>
            <button class='td-icon-btn' data-action='open-help' data-help-key='mvuViewer' title='功能说明'>${ICONS.help}</button>
            <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
          </div>
        </div>
        <div class='td-modal-body td-picker-body'>
          ${floorBarHtml}
          <div class='td-mgr-topbar'>
            <input class='td-input' id='td-mvu-search' type='text' placeholder='搜索变量名、路径或数值...' value='${escapeHtml(m.query || '')}' />
          </div>
          <div class='td-filter-bar'>
            <button type='button' class='td-chip ${viewMode === 'starred' ? 'active' : ''}' data-action='mvu-set-view' data-view='starred'>★ 加精 (${starredList.length})</button>
            <button type='button' class='td-chip ${viewMode === 'all' ? 'active' : ''}' data-action='mvu-set-view' data-view='all'>全部变量</button>
            ${viewMode === 'all' && info.hasStatData ? `<button type='button' class='td-chip ${m.onlyStatData ? 'active' : ''}' data-action='mvu-toggle-only-stat'>仅 stat_data</button>` : ''}
            <button type='button' class='td-chip' data-action='mvu-toggle-expand-all'>${m.collapsed.size > 0 ? '全部展开' : '全部折叠'}</button>
          </div>
          <div class='td-picker-list td-scroll'>${treeHtml}</div>
        </div>
        <div class='td-modal-foot' style='justify-content:flex-start;'>
          <div style='display:flex;gap:6px;flex-wrap:wrap;'>
            <button class='td-btn sm' data-action='mvu-open-cmd-edit' ${noFloor ? 'disabled' : ''}>${ICONS.code} 命令补全</button>
            <button class='td-btn sm' data-action='mvu-open-json-edit' ${noFloor ? 'disabled' : ''}>${ICONS.edit} 编辑 JSON</button>
            <button class='td-btn sm warn' data-action='mvu-open-ai-update' ${noFloor ? 'disabled' : ''}>${ICONS.sliders} AI 更新/补全</button>
          </div>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return true;
  },

  renderPreview(previewLayerEl) {
    if (!state.previewCtx || state.modal?.type !== 'mvuViewer') return false;

    if (state.previewCtx.type === 'mvuValEdit') {
      const c = state.previewCtx;
      const typeOpts = [
        { v: 'string', t: '文本 (String)' },
        { v: 'number', t: '数字 (Number)' },
        { v: 'boolean', t: '布尔 (Boolean)' },
        { v: 'null', t: '空值 (Null)' },
        { v: 'json', t: 'JSON 对象/数组' },
      ].map((o) => `<option value='${o.v}' ${c.valType === o.v ? 'selected' : ''}>${o.t}</option>`).join('');
      let inputHtml = '';
      if (c.valType === 'boolean') {
        inputHtml = `<select class='td-select' id='td-mvu-val-input'><option value='true' ${c.draftText === 'true' ? 'selected' : ''}>true</option><option value='false' ${c.draftText !== 'true' ? 'selected' : ''}>false</option></select>`;
      } else if (c.valType === 'null') {
        inputHtml = `<input class='td-input' id='td-mvu-val-input' type='text' value='null' disabled />`;
      } else if (c.valType === 'number') {
        inputHtml = `<input class='td-input' id='td-mvu-val-input' type='number' step='any' value='${escapeHtml(c.draftText)}' />`;
      } else {
        inputHtml = `<textarea class='td-textarea td-scroll' id='td-mvu-val-input' style='min-height:110px;'>${escapeHtml(c.draftText)}</textarea>`;
      }
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-sm'>
          <div class='td-modal-head'><div class='td-modal-title'>修改变量 · 楼层 #${c.floorId}</div><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
          <div class='td-modal-body'>
            <div class='td-code-block'>${escapeHtml(c.displayPath)}</div>
            <div class='td-field'><label class='td-label'>数据类型</label><select class='td-select' id='td-mvu-val-type'>${typeOpts}</select></div>
            <div class='td-field'><label class='td-label'>变量数值</label>${inputHtml}</div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='mvu-save-val'>${ICONS.save} 写回楼层 #${c.floorId}</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (state.previewCtx.type === 'mvuJsonEdit') {
      const c = state.previewCtx;
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>编辑 JSON · 楼层 #${c.floorId} (${c.editStatOnly ? 'stat_data' : '完整数据'})</div>
            <div style='display:flex;gap:4px;'>
              <button class='td-icon-btn' data-action='preview-undo' title='撤销' disabled>${ICONS.undo}</button>
              <button class='td-icon-btn' data-action='preview-redo' title='重做' disabled>${ICONS.redo}</button>
              <button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button>
            </div>
          </div>
          <div class='td-modal-body'>
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;'>
              <div style='display:flex;justify-content:space-between;align-items:center;'>
                <label class='td-label'>JSON 内容（支持撤销/重做）</label>
                <button type='button' class='td-chip' data-action='mvu-format-json'>格式化 JSON</button>
              </div>
              <textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:240px;'>${escapeHtml(c.jsonText)}</textarea>
            </div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-preview'>取消</button><button class='td-btn primary' data-action='mvu-save-json'>${ICONS.save} 写回楼层 #${c.floorId}</button></div>
        </div>`;
      editHistory.stack = [readPreviewSnapshot()];
      editHistory.index = 0;
      updatePreviewHistoryButtons();
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (state.previewCtx.type === 'mvuCmdEdit') {
      const c = state.previewCtx;
      const diffHtml = c.diffLines
        ? `<div class='td-field'><label class='td-label'>变更预览（stat_data）</label><div class='td-diff-box td-scroll'>${c.diffLines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div></div>`
        : '';
      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>MVU 命令补全/执行 · 楼层 #${c.floorId}</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='mvuCmdEdit' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div></div>
          <div class='td-modal-body'>
            ${c.detectedTruncated ? `<div class='td-attr-warn-banner'>已自动提取当前楼层消息中的更新命令片段，可直接补全缺失行后解析写回。</div>` : ''}
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;'>
              <label class='td-label'>MVU 更新命令（支持 _.set / _.add / _.insert / _.delete / _.move）</label>
              <textarea class='td-textarea td-scroll' id='td-mvu-cmd-text' style='flex:1;min-height:150px;' placeholder="示例：\n_.set('角色.好感度', 30);\n_.add('角色.体力', -10);">${escapeHtml(c.cmdText || '')}</textarea>
            </div>
            ${diffHtml}
          </div>
          <div class='td-modal-foot'>
            <button class='td-btn' data-action='close-preview'>取消</button>
            <button class='td-btn' data-action='mvu-cmd-preview'>解析预览变更</button>
            <button class='td-btn primary' data-action='mvu-cmd-apply'>${ICONS.check} 写回楼层 #${c.floorId}</button>
          </div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (state.previewCtx.type === 'mvuAiUpdate') {
      const ai = state.previewCtx;
      if (ai.step === 'review') {
        const diffHtml = ai.parseError
          ? `<div class='td-attr-warn-banner'>解析提示：${escapeHtml(ai.parseError)}（可直接在上方编辑命令后点「重新解析」）</div>`
          : (ai.diffLines
            ? `<div class='td-diff-box td-scroll'>${ai.diffLines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`
            : '');
        previewLayerEl.classList.add('is-open');
        previewLayerEl.innerHTML = `
          <div class='td-modal td-modal-tall'>
            <div class='td-modal-head'><div class='td-modal-title'>检视 AI 变量更新 · 目标楼层 #${ai.targetFloor}</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='mvuAiUpdate' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div></div>
            <div class='td-modal-body'>
              <div class='td-field'>
                <div style='display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;'>
                  <label class='td-label'>AI 生成的命令（可直接微调）</label>
                  <div style='display:flex;align-items:center;gap:4px;'>
                    <button type='button' class='td-icon-btn' data-action='mvu-ai-reply-undo' title='撤销' ${(ai.replyHistoryIdx ?? 0) <= 0 ? 'disabled' : ''}>${ICONS.undo}</button>
                    <button type='button' class='td-icon-btn' data-action='mvu-ai-reply-redo' title='重做' ${!ai.replyHistory || (ai.replyHistoryIdx ?? 0) >= ai.replyHistory.length - 1 ? 'disabled' : ''}>${ICONS.redo}</button>
                    <button type='button' class='td-chip' data-action='mvu-ai-reparse'>重新解析</button>
                  </div>
                </div>
                <textarea class='td-textarea td-scroll' id='td-mvu-ai-reply' style='min-height:130px;'>${escapeHtml(ai.replyText || '')}</textarea>
              </div>
              <div class='td-field' style='flex:1;min-height:120px;'>
                <label class='td-label'>预演变更对比（stat_data）</label>
                ${diffHtml}
              </div>
            </div>
            <div class='td-modal-foot'>
              <button class='td-btn' data-action='mvu-ai-back'>返回设置</button>
              <button class='td-btn primary' data-action='mvu-ai-apply' ${ai.previewData ? '' : 'disabled'}>${ICONS.check} 确认写回楼层 #${ai.targetFloor}</button>
            </div>
          </div>`;
        uiCtx.syncOverlayBounds();
        return true;
      }

      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>AI 更新/补全 MVU · 楼层 #${ai.targetFloor}</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='mvuAiUpdate' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div></div>
          <div class='td-modal-body'>
            ${renderCollapsibleAiApiBoxHtml(ai)}
            <div class='td-field'>
              <label class='td-label'>2. 参考上下文设置</label>
              <div class='td-form-grid'>
                <div class='td-field'>
                  <span class='td-label' style='font-size:11.5px;'>携带近期消息楼层数</span>
                  <select class='td-select' id='td-mvu-ai-msgcount'>
                    <option value='1' ${ai.msgCount === 1 ? 'selected' : ''}>仅最新 1 条楼层</option>
                    <option value='2' ${ai.msgCount === 2 ? 'selected' : ''}>最近 2 条（用户+AI）</option>
                    <option value='4' ${ai.msgCount === 4 ? 'selected' : ''}>最近 4 条对话</option>
                  </select>
                </div>
                <div class='td-field'>
                  <span class='td-label' style='font-size:11.5px;'>写回目标楼层 ID</span>
                  <input class='td-input' id='td-mvu-ai-floor' type='number' min='0' max='${Math.max(0, ai.lastMsgId)}' value='${ai.targetFloor}' />
                </div>
              </div>
              <div style='display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:10px;background:var(--td-surface);border:1px solid var(--td-border);'>
                <div style='display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;'>
                  <label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;'>
                    <input type='checkbox' class='td-checkbox' id='td-mvu-ai-include-rules' ${ai.includeRules ? 'checked' : ''} ${ai.allRuleCandidates.length === 0 ? 'disabled' : ''} />
                    <span data-role='mvu-rule-summary'>附带世界书变量规则（${ai.ruleMode === 'manual' ? '手动' : '自动'}: ${ai.selectedRuleKeys.size}/${ai.allRuleCandidates.length} 条）</span>
                  </label>
                  ${ai.allRuleCandidates.length > 0 ? `
                    <div style='display:flex;gap:4px;'>
                      ${ai.ruleMode === 'manual' ? `<button type='button' class='td-chip' data-action='mvu-ai-rules-auto'>恢复自动</button>` : ''}
                      <button type='button' class='td-chip ${ai.rulesExpanded ? 'active' : ''}' data-action='mvu-ai-toggle-rules-box'>${ai.rulesExpanded ? '收起列表' : '手动选择'}</button>
                    </div>` : ''}
                </div>
                ${ai.rulesExpanded ? `
                  <input class='td-input' id='td-mvu-rule-search' type='text' placeholder='筛选世界书条目名称或内容...' value='${escapeHtml(ai.ruleSearch || '')}' style='height:30px;font-size:12.5px;' />
                  <div class='td-picker-list td-scroll' style='max-height:190px;min-height:80px;' data-role='mvu-rule-list'>
                    ${ai.allRuleCandidates
                      .filter((r) => {
                        const rq = (ai.ruleSearch || '').trim().toLowerCase();
                        return !rq || r.name.toLowerCase().includes(rq) || r.bookName.toLowerCase().includes(rq) || r.content.toLowerCase().includes(rq);
                      })
                      .map((r) => {
                        const chk = ai.selectedRuleKeys.has(r.key);
                        return `
                          <div class='td-picker-row ${chk ? 'checked' : ''}' style='min-height:36px;padding:5px 8px;'>
                            <label class='td-picker-left' style='cursor:pointer;'>
                              <input type='checkbox' class='td-checkbox' data-action='mvu-ai-toggle-rule' data-key='${escapeHtml(r.key)}' ${chk ? 'checked' : ''} />
                              <span class='td-item-name' style='font-size:12.5px;' title='${escapeHtml(`${r.bookName} / ${r.name}`)}'>[${escapeHtml(r.bookName)}] ${escapeHtml(r.name)}</span>
                            </label>
                            <div style='display:flex;align-items:center;gap:4px;flex-shrink:0;'>
                              ${r.autoMatched ? "<span class='td-mode-tag ok'>自动匹配</span>" : (!r.enabled ? "<span class='td-src-badge'>未启用</span>" : '')}
                              <button type='button' class='td-icon-btn' data-action='mvu-ai-preview-rule' data-key='${escapeHtml(r.key)}' title='预览条目内容'>${ICONS.eye}</button>
                            </div>
                          </div>`;
                      }).join('') || "<div class='td-group-empty'>无匹配条目</div>"}
                  </div>` : ''}
              </div>
              ${ai.truncatedSnippet ? `
                <label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;'>
                  <input type='checkbox' class='td-checkbox' id='td-mvu-ai-include-trunc' ${ai.includeTruncated ? 'checked' : ''} />
                  <span>附带最新消息中的更新命令/截断片段以补全</span>
                </label>` : ''}
            </div>
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;'>
              <label class='td-label'>3. 补充说明（可选，留空则由 AI 自动根据剧情推算）</label>
              <textarea class='td-textarea' id='td-mvu-ai-instruction' style='flex:1;min-height:85px;font-family:inherit;' placeholder='例如：刚刚角色花了50金币，好感度+3；或：只补全被截断的背包物品变更...'>${escapeHtml(ai.instruction || '')}</textarea>
            </div>
          </div>
          <div class='td-modal-foot'>
            <button class='td-btn' data-action='close-preview'>取消</button>
            <button class='td-btn primary' data-action='mvu-ai-run' ${ai.loading ? 'disabled' : ''}>${ai.loading ? 'AI 处理中，请稍候...' : '调用 AI 生成更新'}</button>
          </div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  handleClick(e, actionEl, action) {
    const previewLayerEl = uiCtx.getPreviewLayer();

    if (action === 'open-mvu-viewer') {
      const charName = hasTH('getCurrentCharacterName') ? (callTH('getCurrentCharacterName') || '') : '';
      const hasStarred = getMvuStarredList(getMvuChatKey(charName)).length > 0;
      state.modal = {
        type: 'mvuViewer',
        floor: 'latest',
        onlyStatData: true,
        viewMode: hasStarred ? 'starred' : 'all',
        query: '',
        collapsed: new Set(),
      };
      uiCtx.renderModal();
      return true;
    }
    if (action === 'mvu-set-view' && state.modal?.type === 'mvuViewer') {
      state.modal.viewMode = actionEl.getAttribute('data-view') === 'starred' ? 'starred' : 'all';
      state.modal.collapsed = new Set();
      uiCtx.renderModal();
      return true;
    }
    if (action === 'mvu-import-char-stars' && state.modal?.type === 'mvuViewer') {
      const candidates = getOtherChatStarredCandidates(state.modal._charScopeId, state.modal._chatKey);
      if (candidates.length === 0) { notify('info', '同角色卡其他聊天暂无加精变量'); return true; }
      const ext = (state.store.extensions = state.store.extensions || {});
      const map = (ext.mvuStarred = ext.mvuStarred || {});
      map[state.modal._chatKey] = candidates;
      saveStore(state.store);
      uiCtx.renderModal();
      notify('success', `已导入 ${candidates.length} 项加精变量到当前聊天`);
      return true;
    }
    if (action === 'mvu-toggle-star' && state.modal?.type === 'mvuViewer') {
      e.stopPropagation();
      const starKey = actionEl.getAttribute('data-starkey');
      if (!starKey || !state.modal._chatKey) return true;
      const starred = toggleMvuStarKey(state.modal._chatKey, starKey);
      uiCtx.renderModal();
      notify('info', starred ? '已加精到本聊天重点关注' : '已取消加精');
      return true;
    }
    if (action === 'mvu-refresh' && state.modal?.type === 'mvuViewer') { uiCtx.renderModal(); notify('success', '已刷新 MVU 楼层变量'); return true; }
    if (action === 'mvu-toggle-only-stat' && state.modal?.type === 'mvuViewer') { state.modal.onlyStatData = !state.modal.onlyStatData; state.modal.collapsed = new Set(); uiCtx.renderModal(); return true; }
    if (action === 'mvu-floor-step' && state.modal?.type === 'mvuViewer') {
      const step = actionEl.getAttribute('data-step'), maxId = Math.max(0, state.modal._lastMsgId ?? 0);
      if (step === 'latest') state.modal.floor = 'latest';
      else state.modal.floor = Math.max(0, Math.min(maxId, (state.modal._resolvedFloor ?? maxId) + Number(step)));
      uiCtx.renderModal();
      return true;
    }
    if (action === 'mvu-toggle-expand-all' && state.modal?.type === 'mvuViewer') {
      if (!(state.modal.collapsed instanceof Set)) state.modal.collapsed = new Set();
      if (state.modal.collapsed.size > 0) {
        state.modal.collapsed.clear();
      } else if (state.modal.viewMode === 'starred') {
        (state.modal._nodes || []).forEach((n) => {
          if (n.val && typeof n.val === 'object') state.modal.collapsed.add(n.keyId);
        });
      } else {
        collectMvuContainerPaths(state.modal._displayObj, [], state.modal.collapsed);
      }
      uiCtx.renderModal();
      return true;
    }
    if (action === 'mvu-toggle-node' && state.modal?.type === 'mvuViewer') {
      if (e.target.closest("[data-action='mvu-copy-val'], [data-action='mvu-toggle-star']")) return true;
      const node = state.modal._nodes?.[Number(actionEl.getAttribute('data-nid'))];
      if (!node) return true;
      if (state.modal.collapsed.has(node.keyId)) state.modal.collapsed.delete(node.keyId);
      else state.modal.collapsed.add(node.keyId);
      uiCtx.renderModal();
      return true;
    }
    if (action === 'mvu-copy-val' && state.modal?.type === 'mvuViewer') {
      e.stopPropagation();
      const node = state.modal._nodes?.[Number(actionEl.getAttribute('data-nid'))];
      if (!node) return true;
      const txt = (node.val !== null && typeof node.val === 'object') ? JSON.stringify(node.val, null, 2) : String(node.val ?? '');
      copyToClipboard(txt).then(() => notify('success', `已复制「${node.displayPath}」`)).catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'mvu-copy-json' && state.modal?.type === 'mvuViewer') {
      const dataToCopy = state.modal.viewMode === 'starred' ? (state.modal._starredExportObj ?? {}) : (state.modal._displayObj ?? {});
      copyToClipboard(JSON.stringify(dataToCopy, null, 2)).then(() => notify('success', '已复制当前变量 JSON')).catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'mvu-edit-val' && state.modal?.type === 'mvuViewer') {
      e.stopPropagation();
      const node = state.modal._nodes?.[Number(actionEl.getAttribute('data-nid'))];
      if (!node) return true;
      const v = node.val;
      const valType = v === null ? 'null' : (typeof v === 'number' ? 'number' : (typeof v === 'boolean' ? 'boolean' : (typeof v === 'object' ? 'json' : 'string')));
      const draftText = valType === 'json' ? JSON.stringify(v, null, 2) : (v === null ? 'null' : String(v));
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = {
        type: 'mvuValEdit',
        floorId: state.modal._resolvedFloor,
        pathParts: node.pathParts,
        displayPath: node.displayPath,
        valType,
        draftText,
        editStatOnly: node.editInStat !== undefined ? !!node.editInStat : !!(state.modal.onlyStatData && state.modal._hasStatData),
      };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'mvu-save-val' && state.previewCtx?.type === 'mvuValEdit' && state.modal?.type === 'mvuViewer') {
      const c = state.previewCtx;
      const typeEl = previewLayerEl?.querySelector('#td-mvu-val-type');
      const valEl = previewLayerEl?.querySelector('#td-mvu-val-input');
      const vt = typeEl ? typeEl.value : c.valType;
      const rawStr = valEl ? valEl.value : c.draftText;
      let parsedVal;
      try {
        if (vt === 'null') parsedVal = null;
        else if (vt === 'boolean') parsedVal = rawStr === 'true';
        else if (vt === 'number') {
          parsedVal = Number(rawStr);
          if (rawStr.trim() === '' || Number.isNaN(parsedVal)) throw new Error('请输入有效数字');
        } else if (vt === 'json') parsedVal = JSON.parse(rawStr);
        else parsedVal = String(rawStr);
      } catch (err) {
        notify('warning', `数值格式错误: ${err.message || err}`);
        return true;
      }
      const nextData = JSON.parse(JSON.stringify(state.modal._rawData || {}));
      const targetRoot = (c.editStatOnly && nextData.stat_data) ? nextData.stat_data : nextData;
      try {
        setByPathParts(targetRoot, c.pathParts, parsedVal);
      } catch (err) {
        notify('error', err.message || '写入路径失败');
        return true;
      }
      saveFloorMvuData(c.floorId, nextData).then(() => {
        state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
        notify('success', `已更新楼层 #${c.floorId} 变量「${c.displayPath}」`);
      }).catch((err) => { logError('写入 MVU 变量失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'mvu-open-json-edit' && state.modal?.type === 'mvuViewer') {
      const editStatOnly = !!(state.modal.onlyStatData && state.modal._hasStatData);
      const baseObj = editStatOnly ? state.modal._rawData.stat_data : (state.modal._rawData || { initialized_lorebooks: {}, stat_data: {} });
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = {
        type: 'mvuJsonEdit',
        floorId: state.modal._resolvedFloor,
        editStatOnly,
        jsonText: JSON.stringify(baseObj, null, 2),
      };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'mvu-format-json' && state.previewCtx?.type === 'mvuJsonEdit') {
      const ta = previewLayerEl?.querySelector('#td-edit-content');
      if (!ta) return true;
      try {
        ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
        pushEditSnapshot(true);
      } catch (err) { notify('warning', `JSON 语法错误: ${err.message}`); }
      return true;
    }
    if (action === 'mvu-save-json' && state.previewCtx?.type === 'mvuJsonEdit' && state.modal?.type === 'mvuViewer') {
      pushEditSnapshot(true);
      const c = state.previewCtx;
      const rawStr = previewLayerEl?.querySelector('#td-edit-content')?.value || '';
      let parsed;
      try { parsed = JSON.parse(rawStr); } catch (err) { notify('warning', `JSON 语法错误: ${err.message}`); return true; }
      let nextData;
      if (c.editStatOnly && state.modal._rawData && typeof state.modal._rawData === 'object') {
        nextData = JSON.parse(JSON.stringify(state.modal._rawData));
        nextData.stat_data = parsed;
      } else {
        nextData = parsed;
      }
      saveFloorMvuData(c.floorId, nextData).then(() => {
        state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
        notify('success', `已保存 JSON 到楼层 #${c.floorId}`);
      }).catch((err) => { logError('保存 MVU JSON 失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'mvu-open-cmd-edit' && state.modal?.type === 'mvuViewer') {
      const floorId = state.modal._resolvedFloor;
      let snippet = '';
      try {
        if (hasTH('getChatMessages')) {
          const msg = callTH('getChatMessages', state.modal._lastMsgId)?.[0];
          snippet = extractMvuSnippetFromMessage(msg?.message);
        }
      } catch (e) {}
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = {
        type: 'mvuCmdEdit',
        floorId,
        cmdText: snippet,
        detectedTruncated: !!snippet,
        diffLines: null,
        previewData: null,
        previewedText: '',
      };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'mvu-cmd-preview' && state.previewCtx?.type === 'mvuCmdEdit' && state.modal?.type === 'mvuViewer') {
      const c = state.previewCtx;
      c.cmdText = previewLayerEl?.querySelector('#td-mvu-cmd-text')?.value || '';
      parseMvuCommandsPreview(c.cmdText, state.modal._rawData).then(({ nextData, diffLines }) => {
        c.previewData = nextData; c.diffLines = diffLines; c.previewedText = c.cmdText;
        uiCtx.renderPreviewModal();
        notify('success', '解析成功，请确认下方变更对比');
      }).catch((err) => { logWarn('解析 MVU 命令失败', err); notify('warning', err.message || String(err)); });
      return true;
    }
    if (action === 'mvu-cmd-apply' && state.previewCtx?.type === 'mvuCmdEdit' && state.modal?.type === 'mvuViewer') {
      const c = state.previewCtx;
      c.cmdText = previewLayerEl?.querySelector('#td-mvu-cmd-text')?.value || '';
      const ensureParsed = (c.previewData && c.previewedText === c.cmdText)
        ? Promise.resolve(c.previewData)
        : parseMvuCommandsPreview(c.cmdText, state.modal._rawData).then((r) => r.nextData);
      ensureParsed.then((nextData) => saveFloorMvuData(c.floorId, nextData)).then(() => {
        state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
        notify('success', `已执行命令并更新楼层 #${c.floorId}`);
      }).catch((err) => { logError('执行 MVU 命令失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'mvu-open-ai-update' && state.modal?.type === 'mvuViewer') {
      let snippet = '';
      try {
        if (hasTH('getChatMessages') && state.modal._lastMsgId >= 0) {
          const msg = callTH('getChatMessages', state.modal._lastMsgId)?.[0];
          snippet = extractMvuSnippetFromMessage(msg?.message);
        }
      } catch (e) {}
      const allRuleCandidates = collectWorldbookMvuRuleCandidates();
      const autoKeys = allRuleCandidates.filter((r) => r.autoMatched).map((r) => r.key);
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = {
        type: 'mvuAiUpdate',
        step: 'setup',
        targetFloor: state.modal._resolvedFloor >= 0 ? state.modal._resolvedFloor : 0,
        lastMsgId: Math.max(0, state.modal._lastMsgId ?? 0),
        msgCount: 2,
        allRuleCandidates,
        ruleMode: 'auto',
        selectedRuleKeys: new Set(autoKeys),
        rulesExpanded: false,
        ruleSearch: '',
        includeRules: autoKeys.length > 0,
        truncatedSnippet: snippet,
        includeTruncated: !!snippet,
        instruction: '',
        loading: false,
        replyText: '',
        previewData: null,
        diffLines: null,
        parseError: '',
      };
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'mvu-ai-toggle-rules-box' && state.previewCtx?.type === 'mvuAiUpdate') {
      saveSharedAiApiFieldsFromPreview(previewLayerEl);
      syncAiPreviewDraftInputs(previewLayerEl);
      state.previewCtx.rulesExpanded = !state.previewCtx.rulesExpanded;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'mvu-ai-preview-rule' && state.previewCtx?.type === 'mvuAiUpdate') {
      e.stopPropagation();
      const k = actionEl.getAttribute('data-key') || '';
      const r = state.previewCtx.allRuleCandidates?.find((x) => x.key === k);
      if (!r) return true;
      state.selectPopup = {
        type: 'aiItemPreview',
        title: r.name,
        metas: [
          `世界书: ${r.bookName || '未知'}`,
          `状态: ${r.enabled ? '开启' : '关闭'}`,
          r.autoMatched ? '自动匹配规则' : '手动可选条目',
        ],
        content: r.content || '',
      };
      uiCtx.renderSelectPopup();
      return true;
    }
    if (action === 'mvu-ai-rules-auto' && state.previewCtx?.type === 'mvuAiUpdate') {
      const ai = state.previewCtx;
      ai.ruleMode = 'auto';
      ai.selectedRuleKeys = new Set(ai.allRuleCandidates.filter((r) => r.autoMatched).map((r) => r.key));
      ai.includeRules = ai.selectedRuleKeys.size > 0;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'mvu-ai-toggle-rule' && state.previewCtx?.type === 'mvuAiUpdate') {
      const ai = state.previewCtx;
      const k = actionEl.getAttribute('data-key');
      if (ai.selectedRuleKeys.has(k)) ai.selectedRuleKeys.delete(k);
      else ai.selectedRuleKeys.add(k);
      ai.ruleMode = 'manual';
      if (ai.selectedRuleKeys.size > 0) ai.includeRules = true;
      const sumEl = previewLayerEl?.querySelector("[data-role='mvu-rule-summary']");
      if (sumEl) sumEl.textContent = `附带世界书变量规则（手动: ${ai.selectedRuleKeys.size}/${ai.allRuleCandidates.length} 条）`;
      const incEl = previewLayerEl?.querySelector('#td-mvu-ai-include-rules');
      if (incEl && ai.selectedRuleKeys.size > 0) incEl.checked = true;
      actionEl.closest('.td-picker-row')?.classList.toggle('checked', ai.selectedRuleKeys.has(k));
      return true;
    }
    if (action === 'mvu-ai-run' && state.previewCtx?.type === 'mvuAiUpdate' && state.modal?.type === 'mvuViewer') {
      const ai = state.previewCtx;
      if (ai.loading) return true;
      const cfg = saveSharedAiApiFieldsFromPreview(previewLayerEl);
      ai.msgCount = Number(previewLayerEl?.querySelector('#td-mvu-ai-msgcount')?.value) || 2;
      const floorInput = Number(previewLayerEl?.querySelector('#td-mvu-ai-floor')?.value);
      if (!Number.isNaN(floorInput)) ai.targetFloor = Math.max(0, Math.min(ai.lastMsgId, Math.floor(floorInput)));
      ai.includeRules = !!previewLayerEl?.querySelector('#td-mvu-ai-include-rules')?.checked;
      ai.includeTruncated = !!previewLayerEl?.querySelector('#td-mvu-ai-include-trunc')?.checked;
      ai.instruction = previewLayerEl?.querySelector('#td-mvu-ai-instruction')?.value ?? ai.instruction;

      let messages = [];
      try {
        if (hasTH('getChatMessages')) {
          const startId = Math.max(0, ai.lastMsgId - ai.msgCount + 1);
          messages = callTH('getChatMessages', `${startId}-${ai.lastMsgId}`) || [];
        }
      } catch (e) { logWarn('读取近期对话楼层失败', e); }

      const baseData = (() => {
        try {
          const opt = { type: 'message', message_id: ai.targetFloor };
          if (window.Mvu?.getMvuData) return window.Mvu.getMvuData(opt);
          if (hasTH('getVariables')) return callTH('getVariables', opt);
        } catch (e) {}
        return state.modal._rawData;
      })();
      ai._baseData = JSON.parse(JSON.stringify(baseData || { initialized_lorebooks: {}, stat_data: {} }));
      const chosenRules = ai.includeRules
        ? ai.allRuleCandidates.filter((r) => ai.selectedRuleKeys.has(r.key))
        : [];

      ai.loading = true;
      setAiRunBtnLoading(previewLayerEl, true, "[data-action='mvu-ai-run']", '调用 AI 生成更新');
      runAiMvuUpdate({
        currentStatData: ai._baseData.stat_data ?? ai._baseData,
        messages,
        truncatedSnippet: ai.includeTruncated ? ai.truncatedSnippet : '',
        ruleEntries: chosenRules,
        instruction: ai.instruction,
        apiCfg: cfg,
      }).then(async ({ rawReply }) => {
        ai.loading = false;
        ai.replyText = rawReply;
        ai.replyHistory = [rawReply];
        ai.replyHistoryIdx = 0;
        ai.replyTimer = null;
        ai.step = 'review';
        try {
          const res = await parseMvuCommandsPreview(rawReply, ai._baseData);
          ai.previewData = res.nextData; ai.diffLines = res.diffLines; ai.parseError = '';
        } catch (err) {
          ai.previewData = null; ai.diffLines = null; ai.parseError = err.message || String(err);
        }
        uiCtx.renderPreviewModal();
      }).catch((err) => {
        ai.loading = false;
        setAiRunBtnLoading(previewLayerEl, false, "[data-action='mvu-ai-run']", '调用 AI 生成更新');
        logError('AI 更新 MVU 失败', err);
        notify('error', err.message || String(err));
      });
      return true;
    }
    if (action === 'mvu-ai-reply-undo' && state.previewCtx?.type === 'mvuAiUpdate') {
      const ai = state.previewCtx;
      const ta = previewLayerEl?.querySelector('#td-mvu-ai-reply');
      if (ai.replyTimer) { clearTimeout(ai.replyTimer); ai.replyTimer = null; }
      if (ta && Array.isArray(ai.replyHistory) && ai.replyHistory[ai.replyHistoryIdx] !== ta.value) {
        ai.replyHistory = ai.replyHistory.slice(0, ai.replyHistoryIdx + 1);
        ai.replyHistory.push(ta.value);
        ai.replyHistoryIdx = ai.replyHistory.length - 1;
      }
      if (Array.isArray(ai.replyHistory) && ai.replyHistoryIdx > 0) {
        ai.replyHistoryIdx--;
        const val = ai.replyHistory[ai.replyHistoryIdx];
        ai.replyText = val;
        if (ta) ta.value = val;
        const uBtn = previewLayerEl?.querySelector("[data-action='mvu-ai-reply-undo']");
        const rBtn = previewLayerEl?.querySelector("[data-action='mvu-ai-reply-redo']");
        if (uBtn) uBtn.disabled = ai.replyHistoryIdx <= 0;
        if (rBtn) rBtn.disabled = ai.replyHistoryIdx >= ai.replyHistory.length - 1;
      }
      return true;
    }
    if (action === 'mvu-ai-reply-redo' && state.previewCtx?.type === 'mvuAiUpdate') {
      const ai = state.previewCtx;
      const ta = previewLayerEl?.querySelector('#td-mvu-ai-reply');
      if (Array.isArray(ai.replyHistory) && ai.replyHistoryIdx < ai.replyHistory.length - 1) {
        ai.replyHistoryIdx++;
        const val = ai.replyHistory[ai.replyHistoryIdx];
        ai.replyText = val;
        if (ta) ta.value = val;
        const uBtn = previewLayerEl?.querySelector("[data-action='mvu-ai-reply-undo']");
        const rBtn = previewLayerEl?.querySelector("[data-action='mvu-ai-reply-redo']");
        if (uBtn) uBtn.disabled = ai.replyHistoryIdx <= 0;
        if (rBtn) rBtn.disabled = ai.replyHistoryIdx >= ai.replyHistory.length - 1;
      }
      return true;
    }
    if (action === 'mvu-ai-reparse' && state.previewCtx?.type === 'mvuAiUpdate') {
      const ai = state.previewCtx;
      ai.replyText = previewLayerEl?.querySelector('#td-mvu-ai-reply')?.value ?? ai.replyText;
      parseMvuCommandsPreview(ai.replyText, ai._baseData).then(({ nextData, diffLines }) => {
        ai.previewData = nextData; ai.diffLines = diffLines; ai.parseError = '';
        uiCtx.renderPreviewModal();
        notify('success', '重新解析成功');
      }).catch((err) => {
        ai.previewData = null; ai.diffLines = null; ai.parseError = err.message || String(err);
        uiCtx.renderPreviewModal();
        notify('warning', err.message || String(err));
      });
      return true;
    }
    if (action === 'mvu-ai-back' && state.previewCtx?.type === 'mvuAiUpdate') {
      state.previewCtx.step = 'setup'; uiCtx.renderPreviewModal(); return true;
    }
    if (action === 'mvu-ai-apply' && state.previewCtx?.type === 'mvuAiUpdate' && state.modal?.type === 'mvuViewer') {
      const ai = state.previewCtx;
      const latestReply = previewLayerEl?.querySelector('#td-mvu-ai-reply')?.value ?? ai.replyText;
      const ensureParsed = (ai.previewData && latestReply === ai.replyText)
        ? Promise.resolve(ai.previewData)
        : parseMvuCommandsPreview(latestReply, ai._baseData).then((r) => r.nextData);
      ensureParsed.then((nextData) => saveFloorMvuData(ai.targetFloor, nextData)).then(() => {
        state.modal.floor = ai.targetFloor;
        state.previewCtx = null; uiCtx.renderPreviewModal(); uiCtx.renderModal();
        notify('success', `已将 AI 变量更新写回楼层 #${ai.targetFloor}`);
      }).catch((err) => { logError('写回 AI MVU 更新失败', err); notify('error', err.message || String(err)); });
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    if (id === 'td-mvu-search' && state.modal?.type === 'mvuViewer') { state.modal.query = target.value; uiCtx.renderModal(); return true; }
    if (id === 'td-mvu-ai-reply' && state.previewCtx?.type === 'mvuAiUpdate') {
      const ai = state.previewCtx;
      const val = target.value;
      ai.replyText = val;
      if (ai.replyTimer) clearTimeout(ai.replyTimer);
      const pushReply = () => {
        ai.replyTimer = null;
        if (!Array.isArray(ai.replyHistory)) { ai.replyHistory = [val]; ai.replyHistoryIdx = 0; }
        else if (ai.replyHistory[ai.replyHistoryIdx] !== val) {
          ai.replyHistory = ai.replyHistory.slice(0, ai.replyHistoryIdx + 1);
          ai.replyHistory.push(val);
          if (ai.replyHistory.length > 80) ai.replyHistory.shift();
          ai.replyHistoryIdx = ai.replyHistory.length - 1;
        }
        const previewLayerEl = uiCtx.getPreviewLayer();
        const uBtn = previewLayerEl?.querySelector("[data-action='mvu-ai-reply-undo']");
        const rBtn = previewLayerEl?.querySelector("[data-action='mvu-ai-reply-redo']");
        if (uBtn) uBtn.disabled = ai.replyHistoryIdx <= 0;
        if (rBtn) rBtn.disabled = ai.replyHistoryIdx >= ai.replyHistory.length - 1;
      };
      if (e.inputType === 'insertFromPaste' || e.inputType === 'deleteByCut') pushReply();
      else ai.replyTimer = setTimeout(pushReply, 300);
      return true;
    }
    if (id === 'td-mvu-ai-instruction' && state.previewCtx?.type === 'mvuAiUpdate') { state.previewCtx.instruction = target.value; return true; }
    if (id === 'td-mvu-rule-search' && state.previewCtx?.type === 'mvuAiUpdate') { state.previewCtx.ruleSearch = target.value; uiCtx.renderPreviewModal(); return true; }
    return false;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    if (id === 'td-mvu-floor-input' && state.modal?.type === 'mvuViewer') {
      const v = Number(target.value);
      if (!Number.isNaN(v)) { state.modal.floor = Math.max(0, Math.floor(v)); uiCtx.renderModal(); }
      return true;
    }
    if (id === 'td-mvu-val-type' && state.previewCtx?.type === 'mvuValEdit') {
      const curVal = uiCtx.getPreviewLayer()?.querySelector('#td-mvu-val-input')?.value;
      if (curVal !== undefined) state.previewCtx.draftText = curVal;
      state.previewCtx.valType = target.value;
      if (target.value === 'boolean' && state.previewCtx.draftText !== 'true') state.previewCtx.draftText = 'false';
      uiCtx.renderPreviewModal();
      return true;
    }
    return false;
  },
};
