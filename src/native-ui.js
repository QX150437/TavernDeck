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
  el.classList.remove(FOLD_CLASS);
  if (el.dataset.tdPrevDisplay !== undefined) {
    el.style.display = el.dataset.tdPrevDisplay;
    delete el.dataset.tdPrevDisplay;
  } else {
    el.style.removeProperty('display');
  }
}

export function syncNativePresetCollapse() {
  try {
    const shouldFold = !!state.store?.settings?.collapseNativePresetSettings;
    const pm = document.getElementById('completion_prompt_manager');
    const presetSel = document.getElementById('settings_preset_openai');
    const existingBar = document.getElementById(BAR_ID);

    if (!shouldFold || !pm || !presetSel) {
      document.querySelectorAll(`.${FOLD_CLASS}`).forEach(restoreElement);
      if (existingBar) existingBar.remove();
      return;
    }

    let container = presetSel.parentElement;
    while (container && !container.contains(pm)) {
      container = container.parentElement;
    }
    if (!container) return;

    let presetChild = presetSel;
    while (presetChild && presetChild.parentElement !== container) {
      presetChild = presetChild.parentElement;
    }
    let pmChild = pm;
    while (pmChild && pmChild.parentElement !== container) {
      pmChild = pmChild.parentElement;
    }
    if (!presetChild || !pmChild || presetChild === pmChild) return;

    const children = Array.from(container.children);
    const startIdx = children.indexOf(presetChild);
    const endIdx = children.indexOf(pmChild);
    if (startIdx < 0 || endIdx <= startIdx + 1) return;

    let bar = existingBar;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = BAR_ID;
      bar.dataset.tdTempExpanded = '0';
    }
    if (bar.parentElement !== container || bar.nextElementSibling !== pmChild) {
      container.insertBefore(bar, pmChild);
    }

    const tempExpanded = bar.dataset.tdTempExpanded === '1';
    const targetEls = [];
    for (let i = startIdx + 1; i < endIdx; i++) {
      const el = children[i];
      if (!el || el === bar || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      targetEls.push(el);
    }

    targetEls.forEach((el) => {
      if (tempExpanded) {
        restoreElement(el);
      } else if (!el.classList.contains(FOLD_CLASS)) {
        el.dataset.tdPrevDisplay = el.style.display || '';
        el.classList.add(FOLD_CLASS);
        el.style.setProperty('display', 'none', 'important');
      }
    });

    bar.innerHTML = tempExpanded
      ? "<i class='fa-solid fa-chevron-up'></i><span>收起原生预设设定区域</span>"
      : `<i class='fa-solid fa-chevron-down'></i><span>原生预设设定区域已折叠（点击临时展开 ${targetEls.length} 项）</span>`;

    if (!bar.dataset.tdBound) {
      bar.dataset.tdBound = '1';
      bar.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        bar.dataset.tdTempExpanded = bar.dataset.tdTempExpanded === '1' ? '0' : '1';
        syncNativePresetCollapse();
      });
    }
  } catch (e) {}
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
  } catch (e) {}
}
