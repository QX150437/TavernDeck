import { escapeHtml, genId, notify } from './utils.js';
import { state, saveStore } from './store.js';

const MACRO_ITEMS = [
  { label: '{{user}}', text: '{{user}}' },
  { label: '<user>', text: '<user>' },
  { label: '{{char}}', text: '{{char}}' },
  { label: '<char>', text: '<char>' },
  { label: '{{persona}}', text: '{{persona}}' },
  { label: '{{personality}}', text: '{{personality}}' },
  { label: '{{scenario}}', text: '{{scenario}}' },
  { label: '{{description}}', text: '{{description}}' },
  { label: '{{wiBefore}}', text: '{{wiBefore}}' },
  { label: '{{wiAfter}}', text: '{{wiAfter}}' },
  { label: '{{lastMessage}}', text: '{{lastMessage}}' },
  { label: '{{lastUserMessage}}', text: '{{lastUserMessage}}' },
  { label: '{{lastCharMessage}}', text: '{{lastCharMessage}}' },
  { label: '{{lastMessageId}}', text: '{{lastMessageId}}' },
  { label: '{{time}}', text: '{{time}}' },
  { label: '{{date}}', text: '{{date}}' },
  { label: '{{weekday}}', text: '{{weekday}}' },
  { label: '{{idle_duration}}', text: '{{idle_duration}}' },
  { label: '{{roll:1d100}}', text: '{{roll:1d100}}' },
  { label: '{{random:A,B}}', text: '{{random:A,B}}' },
  { label: '{{// 注释}}', prefix: '{{// ', suffix: ' }}' },
];

const TAG_ITEMS = [
  { label: '<thinking>', prefix: '<thinking>\n', suffix: '\n</thinking>' },
  { label: '<content>', prefix: '<content>\n', suffix: '\n</content>' },
  { label: '<UpdateVariable>', prefix: '<UpdateVariable>\n', suffix: '\n</UpdateVariable>' },
  { label: '<details>', prefix: '<details><summary>标题</summary>\n', suffix: '\n</details>' },
  { label: '```代码块```', prefix: '```\n', suffix: '\n```' },
  { label: '<!-- 注释 -->', prefix: '<!-- ', suffix: ' -->' },
  { label: '--- 分割线', text: '\n---\n' },
  { label: '**加粗**', prefix: '**', suffix: '**' },
  { label: '*斜体*', prefix: '*', suffix: '*' },
  { label: '> 引用', text: '> ' },
];

function getQuickTemplates() {
  const ext = state.store?.extensions;
  return Array.isArray(ext?.quickTemplates) ? ext.quickTemplates : [];
}

function saveQuickTemplates(list) {
  state.store.extensions = state.store.extensions || {};
  state.store.extensions.quickTemplates = list;
  saveStore(state.store);
}

function renderItemsHtml(tab, targetId, addOpen) {
  if (tab === 'tags') {
    return `<div class='td-qi-chips'>${TAG_ITEMS.map((it, idx) => (
      `<button type='button' class='td-chip' data-action='qi-insert' data-kind='tag' data-idx='${idx}' data-target='${escapeHtml(targetId)}'>${escapeHtml(it.label)}</button>`
    )).join('')}</div>`;
  }
  if (tab === 'tpl') {
    const list = getQuickTemplates();
    const listHtml = list.length > 0
      ? list.map((tpl) => `
          <span class='td-qi-tpl-chip'>
            <button type='button' class='td-qi-tpl-btn' data-action='qi-insert' data-kind='tpl' data-tpl-id='${escapeHtml(tpl.id)}' data-target='${escapeHtml(targetId)}' title='${escapeHtml(tpl.content)}'>${escapeHtml(tpl.name)}</button>
            <button type='button' class='td-qi-tpl-del' data-action='qi-del-tpl' data-tpl-id='${escapeHtml(tpl.id)}' title='删除模板'>×</button>
          </span>`).join('')
      : "<span style='font-size:11.5px;color:var(--td-text-dim);'>暂无自定义模板，可点击右侧按钮新建或从选区保存</span>";

    const addFormHtml = addOpen ? `
      <div class='td-qi-add-form'>
        <div style='display:flex;gap:5px;align-items:center;'>
          <input class='td-input' id='td-qi-tpl-name' type='text' placeholder='模板名称（如：思维链框架）' style='flex:1;height:29px;font-size:12px;' />
          <button type='button' class='td-btn sm' data-action='qi-fill-from-editor' data-target='${escapeHtml(targetId)}'>取选区/正文</button>
        </div>
        <textarea class='td-textarea td-scroll' id='td-qi-tpl-content' placeholder='输入模板正文内容...' style='min-height:66px;height:72px;font-size:12px;padding:6px 8px;'></textarea>
        <div style='display:flex;gap:5px;justify-content:flex-end;'>
          <button type='button' class='td-btn sm' data-action='qi-toggle-add'>取消</button>
          <button type='button' class='td-btn sm primary' data-action='qi-save-tpl'>保存模板</button>
        </div>
      </div>` : '';

    return `
      <div style='display:flex;flex-direction:column;gap:6px;'>
        <div style='display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;'>
          <div class='td-qi-chips' style='flex:1;'>${listHtml}</div>
          <button type='button' class='td-btn sm ${addOpen ? 'warn' : 'primary'}' data-action='qi-toggle-add' data-target='${escapeHtml(targetId)}'>${addOpen ? '收起' : '+ 存为模板'}</button>
        </div>
        ${addFormHtml}
      </div>`;
  }

  return `<div class='td-qi-chips'>${MACRO_ITEMS.map((it, idx) => (
    `<button type='button' class='td-chip' data-action='qi-insert' data-kind='macro' data-idx='${idx}' data-target='${escapeHtml(targetId)}'>${escapeHtml(it.label)}</button>`
  )).join('')}</div>`;
}

export function renderQuickInsertHtml(targetId = 'td-edit-content') {
  const tplCount = getQuickTemplates().length;
  return `
    <details class='td-qi-box' data-target-id='${escapeHtml(targetId)}' data-tab='macro' data-add-open='0'>
      <summary class='td-qi-head'>
        <span>常用符号与模板（点击展开）</span>
        <span class='td-qi-meta' data-role='qi-meta'>宏 · 标签 · 模板 (${tplCount})</span>
      </summary>
      <div class='td-qi-body'>
        <div class='td-qi-tabs'>
          <button type='button' class='td-chip active' data-action='qi-tab' data-tab='macro'>常用宏</button>
          <button type='button' class='td-chip' data-action='qi-tab' data-tab='tags'>标签 / 格式</button>
          <button type='button' class='td-chip' data-action='qi-tab' data-tab='tpl' data-role='qi-tpl-tab'>我的模板 (${tplCount})</button>
        </div>
        <div class='td-qi-panel' data-role='qi-panel'>${renderItemsHtml('macro', targetId, false)}</div>
      </div>
    </details>`;
}

function refreshQuickInsertBox(box) {
  if (!box) return;
  const targetId = box.getAttribute('data-target-id') || 'td-edit-content';
  const tab = box.getAttribute('data-tab') || 'macro';
  const addOpen = box.getAttribute('data-add-open') === '1';
  const tplCount = getQuickTemplates().length;

  const metaEl = box.querySelector("[data-role='qi-meta']");
  if (metaEl) metaEl.textContent = `宏 · 标签 · 模板 (${tplCount})`;
  const tplTab = box.querySelector("[data-role='qi-tpl-tab']");
  if (tplTab) tplTab.textContent = `我的模板 (${tplCount})`;

  box.querySelectorAll("[data-action='qi-tab']").forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  const panel = box.querySelector("[data-role='qi-panel']");
  if (panel) panel.innerHTML = renderItemsHtml(tab, targetId, addOpen);
}

function insertIntoTargetTextarea(box, targetId, spec, onAfterInsert) {
  const modal = box.closest('.td-modal') || document;
  const ta = modal.querySelector(`#${targetId}`);
  if (!ta) return;

  const val = ta.value || '';
  const start = typeof ta.selectionStart === 'number' ? ta.selectionStart : val.length;
  const end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : start;
  const selected = val.slice(start, end);

  let inserted = '';
  let nextStart = start;
  let nextEnd = start;

  if (spec.prefix !== undefined) {
    const pre = spec.prefix;
    const suf = spec.suffix || '';
    inserted = pre + selected + suf;
    if (selected) {
      nextStart = start + pre.length;
      nextEnd = nextStart + selected.length;
    } else {
      nextStart = start + pre.length;
      nextEnd = nextStart;
    }
  } else {
    inserted = spec.text || '';
    nextStart = start + inserted.length;
    nextEnd = nextStart;
  }

  ta.value = val.slice(0, start) + inserted + val.slice(end);
  ta.focus();
  if (typeof ta.setSelectionRange === 'function') {
    try { ta.setSelectionRange(nextStart, nextEnd); } catch (e) {}
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  if (typeof onAfterInsert === 'function') onAfterInsert();
}

export function handleQuickInsertClick(e, actionEl, action, opts = {}) {
  const box = actionEl.closest('.td-qi-box');
  if (!box) return false;
  const targetId = actionEl.getAttribute('data-target') || box.getAttribute('data-target-id') || 'td-edit-content';

  if (action === 'qi-tab') {
    box.setAttribute('data-tab', actionEl.getAttribute('data-tab') || 'macro');
    box.setAttribute('data-add-open', '0');
    refreshQuickInsertBox(box);
    return true;
  }

  if (action === 'qi-toggle-add') {
    const willOpen = box.getAttribute('data-add-open') !== '1';
    let prefill = '';
    if (willOpen) {
      const modal = box.closest('.td-modal') || document;
      const ta = modal.querySelector(`#${targetId}`);
      if (ta && typeof ta.selectionStart === 'number' && typeof ta.selectionEnd === 'number' && ta.selectionEnd > ta.selectionStart) {
        prefill = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      }
    }
    box.setAttribute('data-tab', 'tpl');
    box.setAttribute('data-add-open', willOpen ? '1' : '0');
    refreshQuickInsertBox(box);
    if (willOpen && prefill) {
      const contentInp = box.querySelector('#td-qi-tpl-content');
      if (contentInp) contentInp.value = prefill;
    }
    if (willOpen) box.querySelector('#td-qi-tpl-name')?.focus();
    return true;
  }

  if (action === 'qi-fill-from-editor') {
    const modal = box.closest('.td-modal') || document;
    const ta = modal.querySelector(`#${targetId}`);
    const contentInp = box.querySelector('#td-qi-tpl-content');
    if (ta && contentInp) {
      const hasSel = typeof ta.selectionStart === 'number' && typeof ta.selectionEnd === 'number' && ta.selectionEnd > ta.selectionStart;
      contentInp.value = hasSel ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : (ta.value || '');
      notify('info', hasSel ? '已填入编辑器选中内容' : '已填入编辑器正文');
    }
    return true;
  }

  if (action === 'qi-save-tpl') {
    const name = (box.querySelector('#td-qi-tpl-name')?.value || '').trim();
    const content = box.querySelector('#td-qi-tpl-content')?.value || '';
    if (!name) { notify('warning', '请输入模板名称'); box.querySelector('#td-qi-tpl-name')?.focus(); return true; }
    if (!content) { notify('warning', '请输入模板内容'); box.querySelector('#td-qi-tpl-content')?.focus(); return true; }
    const list = getQuickTemplates().slice();
    list.unshift({ id: genId(), name, content });
    saveQuickTemplates(list);
    box.setAttribute('data-add-open', '0');
    refreshQuickInsertBox(box);
    notify('success', `已保存模板「${name}」`);
    return true;
  }

  if (action === 'qi-del-tpl') {
    e.stopPropagation();
    const tid = actionEl.getAttribute('data-tpl-id');
    const tpl = getQuickTemplates().find((x) => x.id === tid);
    if (!tpl) return true;
    const doDel = () => {
      const next = getQuickTemplates().filter((x) => x.id !== tid);
      saveQuickTemplates(next);
      refreshQuickInsertBox(box);
      notify('info', `已删除模板「${tpl.name}」`);
    };
    if (typeof opts.openConfirm === 'function') {
      opts.openConfirm({
        title: '删除模板确认',
        message: `确定要删除自定义模板「${tpl.name}」吗？`,
        confirmText: '确认删除',
        onConfirm: doDel,
      });
    } else {
      doDel();
    }
    return true;
  }

  if (action === 'qi-insert') {
    const kind = actionEl.getAttribute('data-kind');
    if (kind === 'macro') {
      const spec = MACRO_ITEMS[Number(actionEl.getAttribute('data-idx'))];
      if (spec) insertIntoTargetTextarea(box, targetId, spec, opts.onAfterInsert);
    } else if (kind === 'tag') {
      const spec = TAG_ITEMS[Number(actionEl.getAttribute('data-idx'))];
      if (spec) insertIntoTargetTextarea(box, targetId, spec, opts.onAfterInsert);
    } else if (kind === 'tpl') {
      const tpl = getQuickTemplates().find((x) => x.id === actionEl.getAttribute('data-tpl-id'));
      if (tpl) insertIntoTargetTextarea(box, targetId, { text: tpl.content }, opts.onAfterInsert);
    }
    return true;
  }

  return false;
}
