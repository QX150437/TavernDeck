import { escapeHtml, notify, getTH, hasTH, callTH, copyToClipboard } from './utils.js';
import { state } from './store.js';
import { ICONS, uiCtx } from './ui-common.js';

export function formatRegexAttrTags(r) {
  if (!r) return [];
  const tags = [];
  const src = r.source || {};
  const srcNames = [];
  if (src.user_input) srcNames.push('用户输入');
  if (src.ai_output) srcNames.push('AI输出');
  if (src.slash_command) srcNames.push('命令');
  if (src.world_info) srcNames.push('世界书');
  if (src.reasoning) srcNames.push('思考');
  if (srcNames.length > 0) tags.push(srcNames.join('/'));

  const dst = r.destination || {};
  if (dst.display && dst.prompt) tags.push('显示+提示词');
  else if (dst.display) tags.push('仅显示');
  else if (dst.prompt) tags.push('仅提示词');

  if (r.run_on_edit) tags.push('编辑触发');
  if (r.min_depth !== null && r.min_depth !== undefined) tags.push(`MinD:${r.min_depth}`);
  if (r.max_depth !== null && r.max_depth !== undefined) tags.push(`MaxD:${r.max_depth}`);
  return tags;
}

export function buildRegexAttrFieldsHtml(r, prefix = 'td-pm-r') {
  const src = r?.source || {};
  const dst = r?.destination || {};
  const trimText = Array.isArray(r?.trim_strings) ? r.trim_strings.join('\n') : '';
  const minVal = (r?.min_depth !== null && r?.min_depth !== undefined) ? String(r.min_depth) : '';
  const maxVal = (r?.max_depth !== null && r?.max_depth !== undefined) ? String(r.max_depth) : '';

  return `
    <div class='td-field'>
      <label class='td-label'>作用范围 (Source)</label>
      <div class='td-regex-attr-checks'>
        <span class='td-regex-chk'><input type='checkbox' class='td-checkbox sm' id='${prefix}-src-user' ${src.user_input ? 'checked' : ''} /><span>用户输入</span></span>
        <span class='td-regex-chk'><input type='checkbox' class='td-checkbox sm' id='${prefix}-src-ai' ${src.ai_output ? 'checked' : ''} /><span>AI 输出</span></span>
        <span class='td-regex-chk'><input type='checkbox' class='td-checkbox sm' id='${prefix}-src-slash' ${src.slash_command ? 'checked' : ''} /><span>斜杠命令</span></span>
        <span class='td-regex-chk'><input type='checkbox' class='td-checkbox sm' id='${prefix}-src-wi' ${src.world_info ? 'checked' : ''} /><span>世界书</span></span>
        <span class='td-regex-chk'><input type='checkbox' class='td-checkbox sm' id='${prefix}-src-reason' ${src.reasoning ? 'checked' : ''} /><span>思考过程</span></span>
      </div>
    </div>
    <div class='td-field'>
      <label class='td-label'>作用目标与触发 (Destination)</label>
      <div class='td-regex-attr-checks'>
        <span class='td-regex-chk'><input type='checkbox' class='td-checkbox sm' id='${prefix}-dst-display' ${dst.display ? 'checked' : ''} /><span>格式化显示</span></span>
        <span class='td-regex-chk'><input type='checkbox' class='td-checkbox sm' id='${prefix}-dst-prompt' ${dst.prompt ? 'checked' : ''} /><span>格式化提示词</span></span>
        <span class='td-regex-chk'><input type='checkbox' class='td-checkbox sm' id='${prefix}-run-edit' ${r?.run_on_edit ? 'checked' : ''} /><span>编辑时运行</span></span>
      </div>
    </div>
    <div class='td-form-grid'>
      <div class='td-field'>
        <label class='td-label'>最小深度 (Min Depth，留空不限)</label>
        <input class='td-input' id='${prefix}-min-depth' type='number' placeholder='不限' value='${escapeHtml(minVal)}' />
      </div>
      <div class='td-field'>
        <label class='td-label'>最大深度 (Max Depth，留空不限)</label>
        <input class='td-input' id='${prefix}-max-depth' type='number' placeholder='不限' value='${escapeHtml(maxVal)}' />
      </div>
    </div>
    <div class='td-field'>
      <label class='td-label'>修剪字符串 (Trim Strings，每行一个)</label>
      <textarea class='td-textarea td-scroll' id='${prefix}-trim' style='min-height:66px;height:72px;font-size:12.5px;' placeholder='每行输入一个要从匹配文本中移除的片段...'>${escapeHtml(trimText)}</textarea>
    </div>`;
}

export function readRegexAttrFields(containerEl, prefix = 'td-pm-r') {
  const q = (id) => containerEl?.querySelector(`#${prefix}-${id}`);
  const parseDepth = (el) => {
    const raw = String(el?.value ?? '').trim();
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  };
  const trimRaw = String(q('trim')?.value ?? '');
  const trim_strings = trimRaw
    ? trimRaw.split('\n').map((s) => s.replace(/\r$/, '')).filter((s) => s.length > 0)
    : [];

  return {
    source: {
      user_input: !!q('src-user')?.checked,
      ai_output: !!q('src-ai')?.checked,
      slash_command: !!q('src-slash')?.checked,
      world_info: !!q('src-wi')?.checked,
      reasoning: !!q('src-reason')?.checked,
    },
    destination: {
      display: !!q('dst-display')?.checked,
      prompt: !!q('dst-prompt')?.checked,
    },
    run_on_edit: !!q('run-edit')?.checked,
    min_depth: parseDepth(q('min-depth')),
    max_depth: parseDepth(q('max-depth')),
    trim_strings,
  };
}

function compileTestRegex(rawPattern) {
  const raw = String(rawPattern || '');
  if (!raw) return { regex: null, error: '查找正则不能为空' };
  try {
    const th = getTH();
    if (typeof th?.builtin?.parseRegexFromString === 'function') {
      const parsed = th.builtin.parseRegexFromString(raw);
      if (parsed instanceof RegExp) return { regex: parsed, error: '' };
    }
  } catch (e) {}

  const m = raw.match(/^\/([\s\S]*)\/([gimsuydv]*)$/);
  try {
    if (m) return { regex: new RegExp(m[1], m[2]), error: '' };
    return { regex: new RegExp(raw, 'g'), error: '' };
  } catch (err) {
    return { regex: null, error: err?.message || String(err) };
  }
}

function sanitizeRenderHtml(rawHtml) {
  const str = String(rawHtml ?? '');
  if (!str) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${str}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return escapeHtml(str).replace(/\n/g, '<br>');
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType !== 1) return;
        const tag = child.tagName;
        if (['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FRAME', 'FRAMESET', 'BASE', 'META', 'LINK'].includes(tag)) {
          child.remove();
          return;
        }
        Array.from(child.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'action') && /^\s*javascript:/i.test(attr.value))) {
            child.removeAttribute(attr.name);
          }
        });
        walk(child);
      });
    };
    walk(root);
    return root.innerHTML;
  } catch (e) {
    return escapeHtml(str).replace(/\n/g, '<br>');
  }
}

function buildSandboxSrcdoc(bodyHtml) {
  const theme = state.store?.settings?.theme || 'dark';
  const isLight = theme === 'light' || theme === 'parchment';
  const fg = isLight ? '#0f172a' : '#f1f5f9';
  const bg = theme === 'parchment' ? '#ede0c2' : (theme === 'light' ? '#f1f5f9' : '#0b0d14');
  return `<!DOCTYPE html><html><head><meta charset='utf-8'><style>
html,body{margin:0;padding:8px 10px;background:${bg};color:${fg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;line-height:1.55;word-break:break-word;overflow-wrap:anywhere;}
p{margin:0 0 6px;}p:last-child{margin-bottom:0;}
pre,code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:rgba(128,128,128,0.16);border-radius:4px;}
pre{padding:7px 9px;overflow-x:auto;}code{padding:1px 4px;}
details{border:1px solid rgba(128,128,128,0.3);border-radius:7px;padding:6px 9px;margin:4px 0;}
summary{cursor:pointer;font-weight:700;}
hr{border:none;border-top:1px solid rgba(128,128,128,0.3);margin:8px 0;}
blockquote{margin:4px 0;padding-left:10px;border-left:3px solid rgba(99,102,241,0.55);opacity:0.9;}
</style></head><body>${bodyHtml}</body></html>`;
}

export function runRegexTest({ findRegex, replaceString, sampleText, trimStrings = [], applyMacros = false }) {
  let sample = String(sampleText ?? '');
  let repTpl = String(replaceString ?? '');
  if (applyMacros && hasTH('substitudeMacros')) {
    try { sample = callTH('substitudeMacros', sample); } catch (e) {}
    try { repTpl = callTH('substitudeMacros', repTpl); } catch (e) {}
  }

  const { regex, error } = compileTestRegex(findRegex);
  if (!regex) {
    return {
      ok: false,
      error: error || '无效的正则表达式',
      matchCount: 0,
      matches: [],
      outputText: sample,
      renderedSrcdoc: buildSandboxSrcdoc(escapeHtml(sample).replace(/\n/g, '<br>')),
    };
  }

  const trims = Array.isArray(trimStrings) ? trimStrings.filter(Boolean) : [];
  const matches = [];
  const outputText = sample.replace(regex, (...args) => {
    const fullMatch = args[0];
    const hasGroupsObj = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null;
    const groupsObj = hasGroupsObj ? args[args.length - 1] : null;
    const offset = Number(hasGroupsObj ? args[args.length - 3] : args[args.length - 2]) || 0;
    const captures = hasGroupsObj ? args.slice(1, -3) : args.slice(1, -2);

    let trimmed = fullMatch;
    trims.forEach((t) => { trimmed = trimmed.split(t).join(''); });

    let replaced = repTpl.replace(/\{\{match\}\}/gi, () => trimmed);
    replaced = replaced.replace(/\$([1-9]\d*|&|\$|`|'|<([^>]+)>)/g, (tok, key, groupName) => {
      if (key === '$') return '$';
      if (key === '&') return trimmed;
      if (key === '`') return sample.slice(0, offset);
      if (key === "'") return sample.slice(offset + fullMatch.length);
      if (groupName) return (groupsObj && groupsObj[groupName] !== undefined) ? String(groupsObj[groupName]) : '';
      const idx = Number(key) - 1;
      return (idx >= 0 && idx < captures.length) ? String(captures[idx] ?? '') : tok;
    });

    if (matches.length < 50) {
      matches.push({ offset, fullMatch, replaced });
    }
    return replaced;
  });

  let rawHtml = '';
  try {
    const th = getTH();
    if (typeof th?.builtin?.renderMarkdown === 'function') {
      rawHtml = th.builtin.renderMarkdown(outputText);
    } else {
      rawHtml = escapeHtml(outputText).replace(/\n/g, '<br>');
    }
  } catch (e) {
    rawHtml = escapeHtml(outputText).replace(/\n/g, '<br>');
  }

  return {
    ok: true,
    error: '',
    matchCount: matches.length,
    matches,
    outputText,
    renderedSrcdoc: buildSandboxSrcdoc(sanitizeRenderHtml(rawHtml)),
  };
}

export function openRegexTestPreview({
  title,
  findRegex,
  replaceString,
  trimStrings = [],
  onApplyBack = null,
  returnPreviewCtx = null,
  returnPreviewKey = null,
}) {
  let defaultSample = '';
  try {
    if (hasTH('getChatMessages')) {
      const latest = callTH('getChatMessages', -1)?.[0];
      if (latest?.message) defaultSample = String(latest.message);
    }
  } catch (e) {}

  state.previewKey = null;
  state.snapshotDetailId = null;
  state.previewCtx = {
    type: 'pmRegexTest',
    title: title || '正则测试',
    findRegex: String(findRegex || ''),
    replaceString: String(replaceString || ''),
    origFindRegex: String(findRegex || ''),
    origReplaceString: String(replaceString || ''),
    trimStrings: Array.isArray(trimStrings) ? trimStrings.slice() : [],
    sampleText: defaultSample,
    applyMacros: true,
    viewTab: 'render',
    onApplyBack,
    returnPreviewCtx,
    returnPreviewKey,
  };
  uiCtx.renderPreviewModal();
}

export const regexTestUiModule = {
  renderPreview(previewLayerEl) {
    const ctx = state.previewCtx;
    if (!ctx || ctx.type !== 'pmRegexTest') return false;

    const res = runRegexTest({
      findRegex: ctx.findRegex,
      replaceString: ctx.replaceString,
      sampleText: ctx.sampleText,
      trimStrings: ctx.trimStrings,
      applyMacros: !!ctx.applyMacros,
    });
    const viewTab = ctx.viewTab || 'render';
    const isModified = ctx.findRegex !== ctx.origFindRegex || ctx.replaceString !== ctx.origReplaceString;

    let resultPanelHtml = '';
    if (!res.ok) {
      resultPanelHtml = `<div class='td-attr-warn-banner'>正则表达式语法错误：${escapeHtml(res.error)}</div>`;
    } else if (viewTab === 'text') {
      resultPanelHtml = `<textarea class='td-textarea td-scroll' id='td-rtest-output' readonly style='flex:1;min-height:170px;'>${escapeHtml(res.outputText)}</textarea>`;
    } else if (viewTab === 'matches') {
      resultPanelHtml = res.matches.length === 0
        ? "<div class='td-group-empty'>测试样本中未匹配到该正则表达式</div>"
        : `<div class='td-regex-match-list td-scroll'>${res.matches.map((mt, idx) => `
            <div class='td-mgr-row' style='padding:7px 9px;'>
              <div class='td-mgr-row-head'>
                <span class='td-idx-badge'>#${idx + 1}</span>
                <span class='td-src-badge'>位置 ${mt.offset} · 长度 ${mt.fullMatch.length}</span>
              </div>
              <div class='td-code-block' style='max-height:74px;overflow-y:auto;'>匹配: ${escapeHtml(mt.fullMatch)}</div>
              <div class='td-code-block' style='max-height:74px;overflow-y:auto;border-color:var(--td-accent);'>结果: ${escapeHtml(mt.replaced)}</div>
            </div>`).join('')}</div>`;
    } else {
      resultPanelHtml = `<iframe class='td-regex-render-frame' sandbox='' srcdoc="${escapeHtml(res.renderedSrcdoc)}"></iframe>`;
    }

    const statusBadge = !res.ok
      ? "<span class='td-mode-tag del'>语法错误</span>"
      : (res.matchCount > 0
        ? `<span class='td-mode-tag ok'>匹配 ${res.matchCount} 处</span>`
        : "<span class='td-mode-tag single'>未匹配 (0 处)</span>");

    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>正则测试 · ${escapeHtml(ctx.title)}</div>
          <div class='td-modal-head-actions'>
            <button type='button' class='td-icon-btn' data-action='rtest-copy-out' title='复制替换后文本'>${ICONS.copy}</button>
            <button type='button' class='td-icon-btn' data-action='close-preview' title='关闭'>${ICONS.close}</button>
          </div>
        </div>
        <div class='td-modal-body'>
          <details class='td-attr-diff-box'>
            <summary class='td-attr-diff-head'>
              <span>正则规则预览 / 临时微调</span>
              ${isModified ? "<span class='td-mode-tag single'>已修改</span>" : ''}
            </summary>
            <div style='padding:8px 10px;display:flex;flex-direction:column;gap:7px;border-top:1px solid var(--td-border);'>
              <div class='td-field'>
                <label class='td-label'>查找正则 (Find Regex)</label>
                <input class='td-input' id='td-rtest-find' type='text' value='${escapeHtml(ctx.findRegex)}' style='height:34px;font-size:13px;font-family:ui-monospace,monospace;' />
              </div>
              <div class='td-field'>
                <label class='td-label'>替换为 (Replace String)</label>
                <textarea class='td-textarea td-scroll' id='td-rtest-replace' style='min-height:80px;height:90px;font-size:12.5px;'>${escapeHtml(ctx.replaceString)}</textarea>
              </div>
            </div>
          </details>

          <div class='td-field'>
            <div class='td-ai-sec-row'>
              <label class='td-label' style='margin:0;'>测试样本</label>
              <div style='display:flex;align-items:center;gap:5px;flex-wrap:wrap;'>
                <span style='display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--td-text-muted);'>
                  <input type='checkbox' class='td-checkbox sm' id='td-rtest-macro-cb' ${ctx.applyMacros ? 'checked' : ''} />
                  <span>替换宏</span>
                </span>
                <button type='button' class='td-chip sm' data-action='rtest-fill-latest'>取最新楼层</button>
                <button type='button' class='td-chip sm' data-action='rtest-clear-sample'>清空</button>
              </div>
            </div>
            <textarea class='td-textarea td-scroll' id='td-rtest-sample' style='min-height:96px;height:110px;font-size:13px;' placeholder='粘贴或输入测试文本（支持点击右上角取最新楼层消息）...'>${escapeHtml(ctx.sampleText)}</textarea>
          </div>

          <div class='td-field' style='flex:1;min-height:190px;display:flex;flex-direction:column;gap:6px;'>
            <div class='td-ai-sec-row' style='flex-wrap:wrap;'>
              <div style='display:flex;align-items:center;gap:6px;'>
                <label class='td-label' style='margin:0;'>输出结果</label>
                ${statusBadge}
              </div>
              <div class='td-pv-seg'>
                <button type='button' class='td-pv-seg-btn ${viewTab === 'render' ? 'active' : ''}' data-action='rtest-set-tab' data-tab='render'>渲染结果</button>
                <button type='button' class='td-pv-seg-btn ${viewTab === 'text' ? 'active' : ''}' data-action='rtest-set-tab' data-tab='text'>替换文本</button>
                <button type='button' class='td-pv-seg-btn ${viewTab === 'matches' ? 'active' : ''}' data-action='rtest-set-tab' data-tab='matches'>匹配 (${res.matchCount})</button>
              </div>
            </div>
            <div data-role='rtest-result-box' style='flex:1;min-height:170px;display:flex;flex-direction:column;'>
              ${resultPanelHtml}
            </div>
          </div>
        </div>
        <div class='td-modal-foot'>
          ${typeof ctx.onApplyBack === 'function' && isModified ? `<button type='button' class='td-btn warn' data-action='rtest-apply-back'>写回正则修改</button>` : ''}
          <button type='button' class='td-btn primary' data-action='close-preview'>${ctx.returnPreviewCtx || ctx.returnPreviewKey ? '返回' : '关闭'}</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return true;
  },

  handleClick(e, actionEl, action) {
    if (action === 'preview-test-regex' && state.previewKey) {
      const item = state.catalog.byKey.get(state.previewKey);
      if (!item || item.ref?.type !== 'regex') return true;
      const previewLayerEl = uiCtx.getPreviewLayer();
      const nameVal = previewLayerEl?.querySelector('#td-edit-name')?.value ?? item.name;
      const findVal = previewLayerEl?.querySelector('#td-edit-find-regex')?.value ?? item.raw?.find_regex ?? '';
      const repVal = previewLayerEl?.querySelector('#td-edit-replace-string')?.value ?? item.raw?.replace_string ?? '';
      openRegexTestPreview({
        title: nameVal,
        findRegex: findVal,
        replaceString: repVal,
        trimStrings: item.raw?.trim_strings || [],
        returnPreviewKey: state.previewKey,
      });
      return true;
    }

    const ctx = state.previewCtx;
    if (!ctx || ctx.type !== 'pmRegexTest') return false;

    if (action === 'rtest-set-tab') {
      ctx.viewTab = actionEl.getAttribute('data-tab') || 'render';
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'rtest-clear-sample') {
      ctx.sampleText = '';
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'rtest-fill-latest') {
      try {
        if (hasTH('getChatMessages')) {
          const msg = callTH('getChatMessages', -1)?.[0];
          if (msg?.message) {
            ctx.sampleText = String(msg.message);
            uiCtx.renderPreviewModal();
            notify('success', `已填入最新楼层 (#${msg.message_id}) 原文`);
            return true;
          }
        }
      } catch (err) {}
      notify('warning', '当前聊天暂无可用消息楼层');
      return true;
    }
    if (action === 'rtest-copy-out') {
      const res = runRegexTest({
        findRegex: ctx.findRegex,
        replaceString: ctx.replaceString,
        sampleText: ctx.sampleText,
        trimStrings: ctx.trimStrings,
        applyMacros: !!ctx.applyMacros,
      });
      copyToClipboard(res.outputText || '').then(() => notify('success', '测试结果文本已复制')).catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'rtest-apply-back' && typeof ctx.onApplyBack === 'function') {
      ctx.onApplyBack({ find_regex: ctx.findRegex, replace_string: ctx.replaceString });
      ctx.origFindRegex = ctx.findRegex;
      ctx.origReplaceString = ctx.replaceString;
      uiCtx.renderPreviewModal();
      notify('success', '已将修改写回当前正则编辑');
      return true;
    }
    return false;
  },

  handleInput(e) {
    const ctx = state.previewCtx;
    if (!ctx || ctx.type !== 'pmRegexTest' || !e.target) return false;
    const id = e.target.id || '';
    if (id === 'td-rtest-find') {
      ctx.findRegex = e.target.value;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (id === 'td-rtest-replace') {
      ctx.replaceString = e.target.value;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (id === 'td-rtest-sample') {
      ctx.sampleText = e.target.value;
      uiCtx.renderPreviewModal();
      return true;
    }
    return false;
  },

  handleChange(e) {
    const ctx = state.previewCtx;
    if (!ctx || ctx.type !== 'pmRegexTest' || !e.target) return false;
    if (e.target.id === 'td-rtest-macro-cb') {
      ctx.applyMacros = !!e.target.checked;
      uiCtx.renderPreviewModal();
      return true;
    }
    return false;
  },
};
