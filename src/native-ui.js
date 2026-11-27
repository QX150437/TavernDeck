import { ROOT_ID, getST, hasTH, callTH, logWarn, showToastElement } from './utils.js';
import { state } from './store.js';

const BAR_ID = 'td-st-preset-collapse-bar';
const FOLD_CLASS = 'td-st-preset-folded';
export const TOP_BAR_BTN_ID = 'tavern-deck-top-bar-btn';

const KNOWN_TOP_LABELS = {
  'ai-config-button': 'AI 响应配置图标之后',
  'sys-settings-button': 'API 连接图标之后',
  'advanced-formatting-button': '高级格式化图标之后',
  'WI-SP-button': '世界书图标之后',
  'user-settings-button': '用户设置图标之后',
  'backgrounds-button': '背景图标之后',
  'extensions-settings-button': '扩展图标之后（默认）',
  'persona-management-button': 'Persona 图标之后',
  rightNavHolder: '角色卡管理图标之后',
};

function restoreElement(el) {
  if (!el) return;
  const wasFolded = el.classList.contains(FOLD_CLASS);
  el.classList.remove(FOLD_CLASS);
  if (el.dataset.tdPrevDisplay !== undefined) {
    const prevVal = el.dataset.tdPrevDisplay;
    const prevPri = el.dataset.tdPrevPriority || '';
    if (prevVal) el.style.setProperty('display', prevVal, prevPri);
    else el.style.removeProperty('display');
    delete el.dataset.tdPrevDisplay;
    delete el.dataset.tdPrevPriority;
  } else if (wasFolded) {
    el.style.removeProperty('display');
  }
}

export function syncNativePresetCollapse() {
  try {
    const shouldFold = !!state.store?.settings?.collapseNativePresetSettings;
    const pm = document.getElementById('completion_prompt_manager');
    const presetSel = document.getElementById('settings_preset_openai');
    const existingBar = document.getElementById(BAR_ID);

    if (!shouldFold || !presetSel) {
      document.querySelectorAll(`.${FOLD_CLASS}`).forEach(restoreElement);
      if (existingBar) existingBar.remove();
      return;
    }

    let container = presetSel.parentElement;
    if (pm) {
      while (container && !container.contains(pm)) {
        container = container.parentElement;
      }
    } else {
      container = presetSel.closest('#openai_settings') || container;
    }
    if (!container) return;

    let presetChild = presetSel;
    while (presetChild && presetChild.parentElement !== container) {
      presetChild = presetChild.parentElement;
    }
    if (!presetChild) return;

    const targetEls = [];
    const pushIfFoldable = (el) => {
      if (!el || el === existingBar || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      if (pm && (el === pm || el.contains(pm))) {
        if (el !== pm) {
          Array.from(el.children).forEach(pushIfFoldable);
        }
        return;
      }
      targetEls.push(el);
    };

    const children = Array.from(container.children);
    const startIdx = children.indexOf(presetChild);
    if (startIdx < 0) return;
    for (let i = startIdx + 1; i < children.length; i++) {
      pushIfFoldable(children[i]);
    }

    const openaiRoot = document.getElementById('openai_settings');
    if (openaiRoot && openaiRoot !== container && openaiRoot.contains(container)) {
      let cur = container;
      while (cur && cur.parentElement !== openaiRoot) cur = cur.parentElement;
      if (cur) {
        const rootChildren = Array.from(openaiRoot.children);
        const curIdx = rootChildren.indexOf(cur);
        for (let i = curIdx + 1; i < rootChildren.length; i++) {
          pushIfFoldable(rootChildren[i]);
        }
      }
    }

    if (targetEls.length === 0) {
      document.querySelectorAll(`.${FOLD_CLASS}`).forEach(restoreElement);
      if (existingBar) existingBar.remove();
      return;
    }

    let bar = existingBar;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = BAR_ID;
      bar.dataset.tdTempExpanded = '0';
    }
    if (bar.parentElement !== container || presetChild.nextElementSibling !== bar) {
      container.insertBefore(bar, presetChild.nextElementSibling);
    }

    const tempExpanded = bar.dataset.tdTempExpanded === '1';
    targetEls.forEach((el) => {
      if (tempExpanded) {
        restoreElement(el);
      } else if (!el.classList.contains(FOLD_CLASS)) {
        el.dataset.tdPrevDisplay = el.style.getPropertyValue('display');
        el.dataset.tdPrevPriority = el.style.getPropertyPriority('display');
        el.classList.add(FOLD_CLASS);
        el.style.setProperty('display', 'none', 'important');
      }
    });

    bar.innerHTML = tempExpanded
      ? "<i class='fa-solid fa-chevron-up'></i><span>收起原生预设设定区域</span>"
      : `<i class='fa-solid fa-chevron-down'></i><span>原生预设设定区域已折叠（点击原样展开 ${targetEls.length} 项）</span>`;

    if (!bar.dataset.tdBound) {
      bar.dataset.tdBound = '1';
      bar.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        bar.dataset.tdTempExpanded = bar.dataset.tdTempExpanded === '1' ? '0' : '1';
        syncNativePresetCollapse();
      });
    }
  } catch (e) {
    logWarn('同步原生预设折叠区域失败', e);
  }
}

export function getTopBarPositionOptions() {
  const opts = [{ id: 'after_extensions', name: '酒馆扩展图标之后（默认）' }];
  const holder = document.getElementById('top-settings-holder');
  if (holder) {
    Array.from(holder.children).forEach((el) => {
      if (!el || !el.id || el.id === TOP_BAR_BTN_ID || el.id === 'extensions-settings-button') return;
      if (!el.classList.contains('drawer') && el.id !== 'rightNavHolder') return;
      const title = KNOWN_TOP_LABELS[el.id]
        || `${el.getAttribute('title') || el.querySelector('[title]')?.getAttribute('title') || el.id} 之后`;
      opts.push({ id: `after:${el.id}`, name: title });
    });
  }
  opts.push({ id: 'start', name: '顶部栏最左侧（首位）' });
  opts.push({ id: 'end', name: '顶部栏最右侧（末位）' });
  return opts;
}

export function syncTopBarButton(iconSvg, onClick, isOpen) {
  try {
    const enabled = !!state.store?.settings?.enableTopBarButton;
    const holder = document.getElementById('top-settings-holder');
    const existing = document.getElementById(TOP_BAR_BTN_ID);

    if (!enabled || !holder) {
      if (existing) existing.remove();
      return;
    }

    let btn = existing;
    if (!btn) {
      btn = document.createElement('div');
      btn.id = TOP_BAR_BTN_ID;
      btn.className = 'drawer';
      btn.title = '打开 TavernDeck 酒馆总控台';
      btn.innerHTML = `
        <div class='drawer-toggle drawer-header'>
          <div class='drawer-icon td-top-bar-icon'>${iconSvg}</div>
        </div>`;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof onClick === 'function') onClick();
      });
    }
    btn.classList.toggle('is-active', !!isOpen);

    const pos = state.store?.settings?.topBarPosition || 'after_extensions';
    if (pos === 'start') {
      if (holder.firstElementChild !== btn) holder.insertBefore(btn, holder.firstElementChild);
    } else if (pos === 'end') {
      if (holder.lastElementChild !== btn) holder.appendChild(btn);
    } else {
      const targetId = pos === 'after_extensions'
        ? 'extensions-settings-button'
        : (pos.startsWith('after:') ? pos.slice(6) : 'extensions-settings-button');
      const anchor = document.getElementById(targetId) || document.getElementById('extensions-settings-button');
      if (anchor && anchor.parentElement === holder) {
        if (anchor.nextElementSibling !== btn) anchor.insertAdjacentElement('afterend', btn);
      } else if (holder.lastElementChild !== btn) {
        holder.appendChild(btn);
      }
    }
  } catch (e) {
    logWarn('同步顶部导航栏入口按钮失败', e);
  }
}

export function syncNativeToastHook() {
  try {
    const t = (typeof toastr !== 'undefined' ? toastr : null)
      || (typeof window !== 'undefined' ? window.toastr : null);
    if (!t) return;

    if (!t.__tdOrig) {
      t.__tdOrig = {
        success: t.success,
        info: t.info,
        warning: t.warning,
        error: t.error,
        clear: t.clear,
        remove: t.remove,
      };
    }

    const enabled = !!state.store?.settings?.takeoverNativeToast;
    if (!enabled) {
      if (t.__tdHooked) {
        Object.assign(t, t.__tdOrig);
        t.__tdHooked = false;
      }
      const stack = document.querySelector(`#${ROOT_ID} .td-toast-stack.is-native`);
      if (stack) stack.innerHTML = '';
      return;
    }

    if (t.__tdHooked) return;
    t.__tdHooked = true;

    const makeWrapper = (kind) => function tdToastrWrapper(message, title, overrides) {
      const origFn = t.__tdOrig[kind];
      if (!state.store?.settings?.takeoverNativeToast || !document.getElementById(ROOT_ID)) {
        return origFn.apply(this, arguments);
      }
      let realTitle = title;
      let opts = overrides;
      if (title && typeof title === 'object' && !overrides) {
        opts = title;
        realTitle = '';
      }
      const mergedOpts = Object.assign({}, t.options || {}, opts || {});
      const msgStr = message === undefined || message === null ? '' : String(message);
      const titleStr = realTitle === undefined || realTitle === null ? '' : String(realTitle);
      const isHtml = !mergedOpts.escapeHtml;
      const hasCustomTimeout = typeof mergedOpts.timeOut === 'number';
      const timeOut = hasCustomTimeout
        ? (mergedOpts.timeOut === 0 ? 0 : Math.max(1200, mergedOpts.timeOut))
        : (kind === 'error' ? 5000 : (kind === 'warning' ? 4000 : 3200));

      const el = showToastElement({
        channel: 'native',
        kind,
        title: titleStr,
        message: msgStr,
        isHtml,
        sourceBadge: 'ST',
        duration: timeOut,
        tapToDismiss: mergedOpts.tapToDismiss !== false,
        onClick: typeof mergedOpts.onclick === 'function' ? mergedOpts.onclick : null,
      });
      if (!el) return origFn.apply(this, arguments);
      return typeof window.jQuery === 'function' ? window.jQuery(el) : el;
    };

    t.success = makeWrapper('success');
    t.info = makeWrapper('info');
    t.warning = makeWrapper('warning');
    t.error = makeWrapper('error');

    t.clear = function tdToastrClear(target, clearOptions) {
      if (target) {
        const dom = target[0] || target;
        if (dom && typeof dom._tdDismiss === 'function') {
          dom._tdDismiss();
          return;
        }
      } else {
        const stack = document.querySelector(`#${ROOT_ID} .td-toast-stack.is-native`);
        if (stack) {
          Array.from(stack.children).forEach((el) => {
            if (typeof el._tdDismiss === 'function') el._tdDismiss();
            else el.remove();
          });
        }
      }
      if (typeof t.__tdOrig.clear === 'function') {
        return t.__tdOrig.clear.call(this, target, clearOptions);
      }
    };

    t.remove = function tdToastrRemove(target) {
      if (target) {
        const dom = target[0] || target;
        if (dom && dom.classList?.contains('td-toast')) {
          dom.remove();
          return;
        }
      } else {
        const stack = document.querySelector(`#${ROOT_ID} .td-toast-stack.is-native`);
        if (stack) stack.innerHTML = '';
      }
      if (typeof t.__tdOrig.remove === 'function') {
        return t.__tdOrig.remove.call(this, target);
      }
    };
  } catch (e) {
    logWarn('接管酒馆原生通知失败', e);
  }
}

let chatScrollTimers = [];
let userScrollAbortCleanup = null;
let pendingNewReply = null;

function clearScheduledChatScrolls() {
  chatScrollTimers.forEach((t) => clearTimeout(t));
  chatScrollTimers = [];
  if (typeof userScrollAbortCleanup === 'function') {
    try { userScrollAbortCleanup(); } catch (e) {}
    userScrollAbortCleanup = null;
  }
}

function getChatScrollContainer() {
  const chatEl = typeof document !== 'undefined' ? document.getElementById('chat') : null;
  if (!chatEl || chatEl.offsetParent === null) return { chatEl: null, scrollEl: null };
  let cur = chatEl;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    try {
      const style = window.getComputedStyle(cur);
      const ovY = style?.overflowY || '';
      if ((ovY === 'auto' || ovY === 'scroll' || ovY === 'overlay') && cur.scrollHeight >= cur.clientHeight) {
        return { chatEl, scrollEl: cur };
      }
    } catch (e) {}
    cur = cur.parentElement;
  }
  return { chatEl, scrollEl: chatEl };
}

function attachUserScrollAbort(scrollEl) {
  if (!scrollEl) return;
  const abort = () => clearScheduledChatScrolls();
  const onKey = (ev) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(ev.key)) abort();
  };
  scrollEl.addEventListener('wheel', abort, { passive: true, once: true });
  scrollEl.addEventListener('touchstart', abort, { passive: true, once: true });
  scrollEl.addEventListener('pointerdown', abort, { passive: true, once: true });
  window.addEventListener('keydown', onKey, { passive: true });
  userScrollAbortCleanup = () => {
    scrollEl.removeEventListener('wheel', abort);
    scrollEl.removeEventListener('touchstart', abort);
    scrollEl.removeEventListener('pointerdown', abort);
    window.removeEventListener('keydown', onKey);
  };
}

function scrollChatToBottomImmediate() {
  const { chatEl, scrollEl } = getChatScrollContainer();
  if (!chatEl || !scrollEl) return;
  const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  scrollEl.scrollTop = maxTop;
}

export function scheduleChatScrollToBottom() {
  if (!state.store?.settings?.autoScrollToBottomOnChatOpen) return;
  clearScheduledChatScrolls();
  const { scrollEl } = getChatScrollContainer();
  if (!scrollEl) return;
  attachUserScrollAbort(scrollEl);
  [40, 160, 380, 720].forEach((delay) => {
    const t = setTimeout(() => {
      if (!state.store?.settings?.autoScrollToBottomOnChatOpen) return;
      if (pendingNewReply && Date.now() < pendingNewReply.expiresAt) return;
      scrollChatToBottomImmediate();
    }, delay);
    chatScrollTimers.push(t);
  });
}

function scrollMessageTopToViewport(messageId, smooth = true) {
  const { chatEl, scrollEl } = getChatScrollContainer();
  if (!chatEl || !scrollEl) return false;
  const mesEl = chatEl.querySelector(`.mes[mesid="${messageId}"]`)
    || (messageId === getLastMsgIdSafe() ? chatEl.querySelector('.mes.last_mes') : null);
  if (!mesEl) return false;

  const containerRect = scrollEl.getBoundingClientRect();
  const mesRect = mesEl.getBoundingClientRect();
  const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  const rawTarget = scrollEl.scrollTop + (mesRect.top - containerRect.top) - 4;
  const targetTop = Math.max(0, Math.min(maxTop, Math.round(rawTarget)));

  if (Math.abs(scrollEl.scrollTop - targetTop) <= 4) return true;
  if (smooth && typeof scrollEl.scrollTo === 'function') {
    scrollEl.scrollTo({ top: targetTop, behavior: 'smooth' });
  } else {
    scrollEl.scrollTop = targetTop;
  }
  return true;
}

function getLastMsgIdSafe() {
  try {
    if (hasTH('getLastMessageId')) {
      const id = Number(callTH('getLastMessageId'));
      if (!Number.isNaN(id)) return id;
    }
  } catch (e) {}
  return -1;
}

function isAssistantReplyMessage(messageId, type) {
  if (typeof messageId !== 'number' || Number.isNaN(messageId) || messageId < 0) return false;
  const t = String(type || 'normal').toLowerCase();
  if (t === 'quiet' || t === 'first_message' || t === 'command') return false;
  const st = getST();
  const rawMsg = Array.isArray(st?.chat) ? st.chat[messageId] : null;
  if (rawMsg) {
    if (rawMsg.is_user || rawMsg.is_system) return false;
    return true;
  }
  if (hasTH('getChatMessages')) {
    try {
      const msg = callTH('getChatMessages', messageId)?.[0];
      if (msg && (msg.role === 'user' || msg.is_hidden)) return false;
    } catch (e) {}
  }
  return true;
}

function runScrollToNewMessageTop(messageId) {
  if (!state.store?.settings?.autoScrollToNewMessageTop) return;
  clearScheduledChatScrolls();
  const { scrollEl } = getChatScrollContainer();
  if (!scrollEl) return;
  attachUserScrollAbort(scrollEl);

  [90, 260, 520].forEach((delay, idx) => {
    const t = setTimeout(() => {
      if (!state.store?.settings?.autoScrollToNewMessageTop) return;
      scrollMessageTopToViewport(messageId, idx === 0);
    }, delay);
    chatScrollTimers.push(t);
  });
}

export function onTavernChatChanged() {
  pendingNewReply = null;
  scheduleChatScrollToBottom();
}

export function onTavernGenerationStarted() {
  clearScheduledChatScrolls();
}

export function onTavernMessageReceived(messageId, type) {
  if (!state.store?.settings?.autoScrollToNewMessageTop) return;
  if (!isAssistantReplyMessage(messageId, type)) return;
  pendingNewReply = { id: Number(messageId), expiresAt: Date.now() + 8000, triggered: false };
  runScrollToNewMessageTop(Number(messageId));
}

export function onTavernCharacterMessageRendered(messageId) {
  if (!state.store?.settings?.autoScrollToNewMessageTop) return;
  if (!pendingNewReply || Date.now() > pendingNewReply.expiresAt) return;
  if (Number(messageId) !== pendingNewReply.id) return;
  pendingNewReply.triggered = true;
  runScrollToNewMessageTop(pendingNewReply.id);
}

export function onTavernGenerationEnded(messageId) {
  if (!state.store?.settings?.autoScrollToNewMessageTop) return;
  if (!pendingNewReply || Date.now() > pendingNewReply.expiresAt) return;
  const targetId = typeof messageId === 'number' && !Number.isNaN(messageId) ? messageId : pendingNewReply.id;
  if (targetId === pendingNewReply.id) {
    runScrollToNewMessageTop(targetId);
  }
}
