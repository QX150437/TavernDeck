import { escapeHtml, notify, copyToClipboard } from './utils.js';
import { state, saveStore } from './store.js';
import { buildNewPromptEntry } from './preset-manager.js';
import { ICONS, uiCtx } from './ui-common.js';

function getPresetVarIgnoreKey() {
  if (state.modal?.type !== 'presetDetail') return '';
  return state.modal.presetName === 'in_use'
    ? (state.presetName || 'in_use')
    : (state.modal.presetName || 'in_use');
}

function getIgnoredPresetVarsState() {
  const pKey = getPresetVarIgnoreKey();
  const map = state.store?.extensions?.ignoredPresetVars;
  const raw = (pKey && map && typeof map[pKey] === 'object') ? map[pKey] : null;
  return {
    vars: new Set(Array.isArray(raw?.vars) ? raw.vars : []),
    entries: new Set(Array.isArray(raw?.entries) ? raw.entries : []),
  };
}

function writeIgnoredPresetVarsState(pKey, varsSet, entriesSet) {
  if (!pKey) return;
  state.store.extensions = state.store.extensions || {};
  state.store.extensions.ignoredPresetVars = state.store.extensions.ignoredPresetVars || {};
  if (varsSet.size === 0 && entriesSet.size === 0) {
    delete state.store.extensions.ignoredPresetVars[pKey];
  } else {
    state.store.extensions.ignoredPresetVars[pKey] = {
      vars: Array.from(varsSet),
      entries: Array.from(entriesSet),
    };
  }
  saveStore(state.store);
}

function toggleIgnoredPresetVar(varKey) {
  const pKey = getPresetVarIgnoreKey();
  if (!pKey || !varKey) return false;
  const cur = getIgnoredPresetVarsState();
  let ignored = false;
  if (cur.vars.has(varKey)) cur.vars.delete(varKey);
  else { cur.vars.add(varKey); ignored = true; }
  writeIgnoredPresetVarsState(pKey, cur.vars, cur.entries);
  return ignored;
}

function toggleIgnoredPresetEntry(entryIgnoreKey) {
  const pKey = getPresetVarIgnoreKey();
  if (!pKey || !entryIgnoreKey) return false;
  const cur = getIgnoredPresetVarsState();
  let ignored = false;
  if (cur.entries.has(entryIgnoreKey)) cur.entries.delete(entryIgnoreKey);
  else { cur.entries.add(entryIgnoreKey); ignored = true; }
  writeIgnoredPresetVarsState(pKey, cur.vars, cur.entries);
  return ignored;
}

function clearIgnoredPresetVars() {
  const pKey = getPresetVarIgnoreKey();
  if (!pKey) return;
  writeIgnoredPresetVarsState(pKey, new Set(), new Set());
}

const GLOBAL_MACRO_OPS = new Set(['setglobalvar', 'getglobalvar', 'addglobalvar', 'incglobalvar', 'decglobalvar', 'hasglobalvar']);
const MUTATE_MACRO_OPS = new Set(['addvar', 'addglobalvar', 'incvar', 'incglobalvar', 'decvar', 'decglobalvar']);

function scanBalancedMacros(text, onMacro) {
  const s = String(text || '');
  let i = 0;
  while (i < s.length - 3) {
    if (s[i] === '{' && s[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < s.length && depth > 0) {
        if (s[j] === '{' && s[j + 1] === '{') {
          depth++;
          j += 2;
        } else if (s[j] === '}' && s[j + 1] === '}') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      if (depth === 0) {
        const inner = s.slice(i + 2, j - 2);
        if (!/^\s*\/\//.test(inner)) {
          onMacro(inner);
          scanBalancedMacros(inner, onMacro);
        }
        i = j;
        continue;
      }
    }
    i++;
  }
}

function parseEntryMacros(content) {
  const setOps = [];
  const mutates = [];
  const reads = [];
  scanBalancedMacros(content, (inner) => {
    const m = inner.match(/^\s*(setvar|setglobalvar|getvar|getglobalvar|addvar|addglobalvar|incvar|incglobalvar|decvar|decglobalvar|hasvar|hasglobalvar)\s*::\s*([\s\S]*)$/i);
    if (!m) return;
    const op = m[1].toLowerCase();
    const rest = m[2];
    const isGlobal = GLOBAL_MACRO_OPS.has(op);

    if (op === 'setvar' || op === 'setglobalvar') {
      const sepIdx = rest.indexOf('::');
      if (sepIdx < 0) return;
      const name = rest.slice(0, sepIdx).trim();
      const val = rest.slice(sepIdx + 2);
      if (!name || name.includes('{{') || name.includes('}}')) return;
      setOps.push({ name, isGlobal, op, initVal: val.trim() });
    } else if (MUTATE_MACRO_OPS.has(op)) {
      const name = rest.split('::')[0].trim();
      if (!name || name.includes('{{') || name.includes('}}')) return;
      mutates.push({ name, isGlobal, op });
    } else {
      const name = rest.split('::')[0].trim();
      if (!name || name.includes('{{') || name.includes('}}')) return;
      reads.push({ name, isGlobal, op });
    }
  });
  return { setOps, mutates, reads };
}

function buildInitMacroListText(varSpecs) {
  const lines = [];
  const seen = new Set();
  (varSpecs || []).forEach((v) => {
    const key = `${v.isGlobal ? 'g' : 'l'}::${v.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(v.isGlobal ? `{{setglobalvar::${v.name}::}}` : `{{setvar::${v.name}::}}`);
  });
  return lines.join('\n');
}

function buildReadMacroListText(varSpecs) {
  const lines = [];
  const seen = new Set();
  (varSpecs || []).forEach((v) => {
    const key = `${v.isGlobal ? 'g' : 'l'}::${v.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(v.isGlobal ? `{{getglobalvar::${v.name}}}` : `{{getvar::${v.name}}}`);
  });
  return lines.join('\n');
}

export function analyzePresetVariables(presetData, preferredInitSpec, ignoredState = null) {
  const ignoredVars = ignoredState?.vars instanceof Set ? ignoredState.vars : new Set();
  const ignoredEntries = ignoredState?.entries instanceof Set ? ignoredState.entries : new Set();
  const varMap = new Map();
  const parsedEntries = [];
  const validTextSpecs = new Set();

  const ensureVar = (name, isGlobal) => {
    const key = `${isGlobal ? 'g' : 'l'}::${name}`;
    let item = varMap.get(key);
    if (!item) {
      item = {
        key,
        name,
        isGlobal,
        inits: [],
        assigns: [],
        reads: [],
        status: 'initialized',
        orderIssue: null,
      };
      varMap.set(key, item);
    }
    return item;
  };

  const pushLoc = (arr, locObj) => {
    if (!arr.some((l) => l.listName === locObj.listName && l.idx === locObj.idx && l.op === locObj.op)) {
      arr.push(locObj);
    }
  };

  ['prompts', 'prompts_unused'].forEach((listName) => {
    const list = Array.isArray(presetData?.[listName]) ? presetData[listName] : [];
    list.forEach((p, idx) => {
      if (!p || typeof p.content !== 'string') return;
      const spec = `${listName}::${idx}`;
      validTextSpecs.add(spec);
      if (!p.content) return;

      const parsed = parseEntryMacros(p.content);
      if (parsed.setOps.length === 0 && parsed.mutates.length === 0 && parsed.reads.length === 0) return;

      const setVarKeys = new Set();
      const emptyInitKeys = new Set();
      const readKeys = new Set();

      parsed.setOps.forEach((op) => {
        const k = `${op.isGlobal ? 'g' : 'l'}::${op.name}`;
        setVarKeys.add(k);
        if (op.initVal === '') emptyInitKeys.add(k);
      });
      parsed.reads.forEach((op) => {
        readKeys.add(`${op.isGlobal ? 'g' : 'l'}::${op.name}`);
      });

      parsedEntries.push({
        spec,
        listName,
        idx,
        p,
        parsed,
        setVarKeys,
        emptyInitKeys,
        readKeys,
      });
    });
  });

  const initScored = parsedEntries
    .filter((pe) => pe.setVarKeys.size > 0)
    .map((pe) => ({
      spec: pe.spec,
      listName: pe.listName,
      idx: pe.idx,
      p: pe.p,
      setCount: pe.setVarKeys.size,
      emptyCount: pe.emptyInitKeys.size,
      isInitNamed: /初始化|变量|init|var|registry/i.test(pe.p.name || '') ? 1 : 0,
    }))
    .sort((a, b) => (b.setCount - a.setCount)
      || (b.emptyCount - a.emptyCount)
      || (b.isInitNamed - a.isInitNamed)
      || ((a.listName === 'prompts' ? 0 : 1) - (b.listName === 'prompts' ? 0 : 1))
      || ((b.p.enabled ? 1 : 0) - (a.p.enabled ? 1 : 0))
      || (a.idx - b.idx));

  const primaryInitSpec = initScored[0]?.spec || null;
  let effectiveInitSpec = primaryInitSpec;
  if (preferredInitSpec === '__new__') {
    effectiveInitSpec = null;
  } else if (preferredInitSpec && validTextSpecs.has(preferredInitSpec)) {
    effectiveInitSpec = preferredInitSpec;
  }

  const entryList = [];
  parsedEntries.forEach((pe) => {
    const { spec, listName, idx, p, parsed } = pe;
    const ignoreKey = p.id ? `id::${p.id}` : `name::${listName}::${p.name || idx}`;
    const entryMeta = {
      spec,
      ignoreKey,
      ignored: ignoredEntries.has(ignoreKey),
      listName,
      idx,
      id: p.id,
      name: p.name || p.id,
      enabled: !!p.enabled,
      initKeys: new Set(),
      assignKeys: new Set(),
      readKeys: new Set(),
    };
    entryList.push(entryMeta);

    const isInitEntry = !!effectiveInitSpec && spec === effectiveInitSpec;
    parsed.setOps.forEach((sOp) => {
      const v = ensureVar(sOp.name, sOp.isGlobal);
      const loc = { listName, idx, name: entryMeta.name, enabled: entryMeta.enabled, op: sOp.op, initVal: sOp.initVal };
      if (isInitEntry) {
        pushLoc(v.inits, loc);
        entryMeta.initKeys.add(v.key);
      } else {
        pushLoc(v.assigns, loc);
        entryMeta.assignKeys.add(v.key);
      }
    });

    parsed.mutates.forEach((mOp) => {
      const v = ensureVar(mOp.name, mOp.isGlobal);
      pushLoc(v.assigns, { listName, idx, name: entryMeta.name, enabled: entryMeta.enabled, op: mOp.op });
      entryMeta.assignKeys.add(v.key);
    });

    parsed.reads.forEach((rOp) => {
      const v = ensureVar(rOp.name, rOp.isGlobal);
      pushLoc(v.reads, { listName, idx, name: entryMeta.name, enabled: entryMeta.enabled, op: rOp.op });
      entryMeta.readKeys.add(v.key);
    });
  });

  const variables = Array.from(varMap.values()).map((v) => {
    const hasInit = v.inits.length > 0;
    const hasActiveInit = v.inits.some((l) => l.listName === 'prompts' && l.enabled);
    const hasAssign = v.assigns.length > 0;
    const hasRead = v.reads.length > 0;
    const hasActiveUse = [...v.assigns, ...v.reads].some((l) => l.listName === 'prompts' && l.enabled);

    if (!hasInit && hasAssign) v.status = 'uninit_def';
    else if (!hasInit && !hasAssign && hasRead) v.status = 'uninit_ref';
    else if (hasInit && !hasActiveInit && hasActiveUse) v.status = 'inactive_init';
    else if (hasInit && !hasRead) v.status = 'unused_init';
    else v.status = 'initialized';

    v.ignored = ignoredVars.has(v.key);

    const activeInitIdxs = v.inits.filter((l) => l.listName === 'prompts' && l.enabled).map((l) => l.idx);
    const activeUseIdxs = [...v.assigns, ...v.reads].filter((l) => l.listName === 'prompts' && l.enabled).map((l) => l.idx);
    if (activeInitIdxs.length > 0 && activeUseIdxs.length > 0) {
      const firstInitIdx = Math.min(...activeInitIdxs);
      const firstUseIdx = Math.min(...activeUseIdxs);
      if (firstUseIdx < firstInitIdx) {
        v.orderIssue = { firstUseIdx, firstInitIdx };
      }
    }
    return v;
  });

  const orderWeight = { uninit_def: 0, uninit_ref: 1, inactive_init: 2, unused_init: 3, initialized: 4 };
  variables.sort((a, b) => {
    if (a.ignored !== b.ignored) return a.ignored ? 1 : -1;
    return (orderWeight[a.status] - orderWeight[b.status]) || a.name.localeCompare(b.name);
  });

  const varByKey = new Map(variables.map((v) => [v.key, v]));
  const isNeedsAttention = (v) => !v.ignored && (v.status === 'uninit_def' || v.status === 'uninit_ref' || v.status === 'inactive_init');

  const entries = entryList.map((em) => {
    const initVars = Array.from(em.initKeys).map((k) => varByKey.get(k)).filter(Boolean);
    const assignVars = Array.from(em.assignKeys).map((k) => varByKey.get(k)).filter(Boolean);
    const readVars = Array.from(em.readKeys).map((k) => varByKey.get(k)).filter(Boolean);
    const usedVars = new Map();
    [...assignVars, ...readVars].forEach((v) => usedVars.set(v.key, v));
    const missingInitVars = em.ignored ? [] : Array.from(usedVars.values()).filter(isNeedsAttention);

    const definedMap = new Map();
    [...initVars, ...assignVars].forEach((v) => definedMap.set(v.key, v));
    const unreferencedVars = em.ignored
      ? []
      : Array.from(definedMap.values()).filter((v) => !v.ignored && v.status === 'unused_init');

    return {
      ...em,
      initVars,
      assignVars,
      readVars,
      missingInitVars,
      unreferencedVars,
    };
  });

  const candidateTargets = [];
  const seenTargets = new Set();
  const pushCandidate = (listName, idx, p, tag) => {
    const spec = `${listName}::${idx}`;
    if (seenTargets.has(spec)) return;
    seenTargets.add(spec);
    candidateTargets.push({
      spec,
      label: `[${listName === 'prompts_unused' ? '未添加' : '主'}#${idx + 1}${p.enabled ? '' : '·关'}] ${p.name || p.id}${tag ? ` (${tag})` : ''}`,
    });
  };

  initScored.forEach(({ listName, idx, p, setCount }) => pushCandidate(listName, idx, p, `含${setCount}项初始化`));
  ['prompts', 'prompts_unused'].forEach((listName) => {
    const list = Array.isArray(presetData?.[listName]) ? presetData[listName] : [];
    list.forEach((p, idx) => {
      if (!p) return;
      if (/初始化|变量|init|var|registry/i.test(p.name || '')) pushCandidate(listName, idx, p, '推荐');
    });
  });
  ['prompts', 'prompts_unused'].forEach((listName) => {
    const list = Array.isArray(presetData?.[listName]) ? presetData[listName] : [];
    list.forEach((p, idx) => {
      if (!p || typeof p.content !== 'string') return;
      pushCandidate(listName, idx, p, '');
    });
  });

  const parsedMap = new Map(parsedEntries.map((pe) => [pe.spec, pe]));
  const readCandidateTargets = [];
  const readScored = [];
  ['prompts', 'prompts_unused'].forEach((listName) => {
    const list = Array.isArray(presetData?.[listName]) ? presetData[listName] : [];
    list.forEach((p, idx) => {
      if (!p || typeof p.content !== 'string') return;
      const spec = `${listName}::${idx}`;
      const pe = parsedMap.get(spec);
      const readCnt = pe ? pe.readKeys.size : 0;
      const isInitOnly = spec === effectiveInitSpec && readCnt === 0 ? 1 : 0;
      readScored.push({ spec, listName, idx, p, readCnt, isInitOnly });
    });
  });
  readScored.sort((a, b) => (b.readCnt - a.readCnt)
    || (a.isInitOnly - b.isInitOnly)
    || ((a.listName === 'prompts' ? 0 : 1) - (b.listName === 'prompts' ? 0 : 1))
    || ((b.p.enabled ? 1 : 0) - (a.p.enabled ? 1 : 0))
    || (a.idx - b.idx));
  readScored.forEach(({ spec, listName, idx, p, readCnt }) => {
    readCandidateTargets.push({
      spec,
      label: `[${listName === 'prompts_unused' ? '未添加' : '主'}#${idx + 1}${p.enabled ? '' : '·关'}] ${p.name || p.id}${readCnt > 0 ? ` (含${readCnt}项读取)` : ''}`,
    });
  });

  const needInitList = variables.filter(isNeedsAttention);
  const unusedInitList = variables.filter((v) => !v.ignored && v.status === 'unused_init');
  const ignoredVarList = variables.filter((v) => v.ignored);
  const ignoredEntryList = entries.filter((em) => em.ignored);
  const stats = {
    total: variables.length,
    initialized: variables.filter((v) => !v.ignored && v.status === 'initialized').length,
    needInit: needInitList.length,
    unusedInit: unusedInitList.length,
    ignoredVars: ignoredVarList.length,
    needInitList,
    unusedInitList,
    ignoredVarList,
    ignoredEntryList,
    entryNeedInit: entries.filter((em) => !em.ignored && em.missingInitVars.length > 0).length,
    entryReady: entries.filter((em) => !em.ignored && em.missingInitVars.length === 0).length,
    entryUnref: entries.filter((em) => !em.ignored && em.unreferencedVars.length > 0).length,
    entryIgnored: ignoredEntryList.length,
  };

  return {
    variables,
    entries,
    candidateTargets,
    readCandidateTargets,
    primaryInitSpec,
    effectiveInitSpec,
    stats,
  };
}

function initializeVariablesToTarget(presetData, varSpecs, targetSpec) {
  if (!Array.isArray(varSpecs) || varSpecs.length === 0) return { added: 0, resolvedSpec: targetSpec };
  const macrosText = buildInitMacroListText(varSpecs);
  const macrosToAdd = macrosText ? macrosText.split('\n') : [];
  if (macrosToAdd.length === 0) return { added: 0, resolvedSpec: targetSpec };

  if (!targetSpec || targetSpec === '__new__') {
    const entry = buildNewPromptEntry({
      name: '变量初始化 (Variable Init)',
      enabled: true,
      role: 'system',
      content: macrosToAdd.join('\n'),
    });
    presetData.prompts = presetData.prompts || [];
    presetData.prompts.unshift(entry);
    return { added: macrosToAdd.length, resolvedSpec: 'prompts::0' };
  }

  const [listName, idxStr] = String(targetSpec).split('::');
  const target = presetData?.[listName]?.[Number(idxStr)];
  if (!target) throw new Error('未找到目标初始化条目，请重新选择');

  const existingText = typeof target.content === 'string' ? target.content : '';
  const appendLines = macrosToAdd.filter((m) => !existingText.includes(m));
  if (appendLines.length === 0) return { added: 0, resolvedSpec: targetSpec };

  target.content = existingText.trimEnd()
    ? `${existingText.replace(/\s+$/, '')}\n${appendLines.join('\n')}`
    : appendLines.join('\n');
  return { added: appendLines.length, resolvedSpec: targetSpec };
}

function referenceVariablesToTarget(presetData, varSpecs, targetSpec) {
  if (!Array.isArray(varSpecs) || varSpecs.length === 0) return 0;
  if (!targetSpec) throw new Error('请选择要引用的目标条目');
  const [listName, idxStr] = String(targetSpec).split('::');
  const target = presetData?.[listName]?.[Number(idxStr)];
  if (!target) throw new Error('未找到目标引用条目，请重新选择');

  const macrosText = buildReadMacroListText(varSpecs);
  const macrosToAdd = macrosText ? macrosText.split('\n') : [];
  if (macrosToAdd.length === 0) return 0;

  const existingText = typeof target.content === 'string' ? target.content : '';
  const appendLines = macrosToAdd.filter((m) => !existingText.includes(m));
  if (appendLines.length === 0) return 0;

  target.content = existingText.trimEnd()
    ? `${existingText.replace(/\s+$/, '')}\n${appendLines.join('\n')}`
    : appendLines.join('\n');
  return appendLines.length;
}

function formatLocBadges(locs, label) {
  if (!locs || locs.length === 0) return '';
  const badges = locs.map((l) => {
    const prefix = l.listName === 'prompts_unused' ? '池' : '主';
    const stateTag = l.enabled ? '' : '·关';
    const opTag = l.op && MUTATE_MACRO_OPS.has(l.op) ? `(${l.op})` : '';
    const shortVal = l.initVal
      ? `=${l.initVal.length > 8 ? `${l.initVal.slice(0, 8)}…` : l.initVal}`
      : '';
    const valTip = l.initVal ? ` · 值: ${l.initVal}` : '';
    const title = `${l.listName === 'prompts_unused' ? '未添加池' : '主列表'} #${l.idx + 1}「${l.name}」${l.enabled ? '' : '（未启用）'}${valTip}`;
    return `<button type='button' class='td-var-loc-btn ${l.enabled && l.listName === 'prompts' ? '' : 'is-dim'}' data-action='pv-jump-entry' data-list='${escapeHtml(l.listName)}' data-idx='${l.idx}' title='${escapeHtml(title)}'>${prefix}#${l.idx + 1} ${escapeHtml(l.name)}${escapeHtml(opTag)}${escapeHtml(shortVal)}${stateTag}</button>`;
  }).join('');
  return `<div class='td-var-loc'><strong>${escapeHtml(label)}：</strong><span class='td-var-loc-list'>${badges}</span></div>`;
}

function renderEntryCardHtml(em, needsInit, highlightUnrefOnly = false) {
  const allChips = [];
  if (highlightUnrefOnly) {
    em.unreferencedVars.forEach((v) => {
      const roleText = em.initKeys.has(v.key) ? '初始化' : '赋值';
      allChips.push(`<span class='td-mode-tag single' title='已初始化但预设内暂无读取'>未引用(${roleText}): ${escapeHtml(v.name)}</span>`);
    });
  } else {
    em.initVars.forEach((v) => {
      const cls = v.ignored ? 'is-ignored' : (v.status === 'unused_init' ? 'single' : 'ok');
      const suffix = v.ignored ? ' (已忽略)' : (v.status === 'unused_init' ? ' (未引用)' : '');
      allChips.push(`<span class='td-mode-tag ${cls}' title='在本条目初始化'>初始化: ${escapeHtml(v.name)}${suffix}</span>`);
    });
    em.assignVars.forEach((v) => {
      const isMiss = needsInit(v);
      const tagCls = v.ignored
        ? 'is-ignored'
        : (v.status === 'inactive_init' || v.status === 'unused_init' ? 'single' : (isMiss ? 'del' : 'multi'));
      const tip = v.ignored
        ? '该变量已手动忽略'
        : (v.status === 'inactive_init'
          ? '初始化条目未启用/在未添加池'
          : (isMiss ? '未在初始化条目中初始化' : (v.status === 'unused_init' ? '已初始化但未引用' : '已初始化')));
      const suffix = v.ignored
        ? ' (已忽略)'
        : (isMiss
          ? (v.status === 'inactive_init' ? ' (未生效)' : ' (未初始化)')
          : (v.status === 'unused_init' ? ' (未引用)' : ''));
      allChips.push(`<span class='td-mode-tag ${tagCls}' title='${tip}'>赋值: ${escapeHtml(v.name)}${suffix}</span>`);
    });
    em.readVars.forEach((v) => {
      const isMiss = needsInit(v);
      const cls = v.ignored ? 'is-ignored' : (isMiss ? 'single' : 'multi');
      const suffix = v.ignored ? ' (已忽略)' : (isMiss ? ' (未初始化)' : '');
      allChips.push(`<span class='td-mode-tag ${cls}' title='读取引用'>读取: ${escapeHtml(v.name)}${suffix}</span>`);
    });
  }

  const rowCls = em.ignored ? 'is-ignored' : (em.missingInitVars.length > 0 ? 'is-active' : '');
  const statusBadgeHtml = em.ignored
    ? "<span class='td-mode-tag is-ignored'>已忽略</span>"
    : (highlightUnrefOnly
      ? `<span class='td-mode-tag single'>${em.unreferencedVars.length} 项未引用</span>`
      : (em.missingInitVars.length > 0
        ? `<span class='td-mode-tag del'>${em.missingInitVars.length} 项待初始化</span>`
        : (em.unreferencedVars.length > 0
          ? `<span class='td-mode-tag single'>${em.unreferencedVars.length} 项未引用</span>`
          : `<span class='td-mode-tag ok'>已就绪</span>`)));

  return `
    <div class='td-mgr-row ${rowCls}'>
      <div class='td-mgr-row-head'>
        <div style='display:flex;align-items:center;gap:6px;min-width:0;flex:1;'>
          <span class='td-idx-badge'>${em.listName === 'prompts_unused' ? '池' : ''}#${em.idx + 1}</span>
          <span class='td-mgr-row-title' title='${escapeHtml(em.name)}'>${escapeHtml(em.name)}</span>
        </div>
        <div style='display:flex;gap:4px;align-items:center;flex-shrink:0;'>
          ${statusBadgeHtml}
          <span class='td-src-badge'>${em.enabled ? '开' : '关'}</span>
        </div>
      </div>
      <div class='td-var-chips'>${allChips.join('')}</div>
      <div class='td-mgr-row-actions'>
        ${!em.ignored && !highlightUnrefOnly && em.missingInitVars.length > 0 ? `<button type='button' class='td-btn sm primary' data-action='pv-reg-entry' data-list='${escapeHtml(em.listName)}' data-idx='${em.idx}'>一键初始化本条目 (${em.missingInitVars.length})</button>` : ''}
        ${!em.ignored && em.unreferencedVars.length > 0 && (highlightUnrefOnly || em.missingInitVars.length === 0) ? `<button type='button' class='td-btn sm primary' data-action='pv-ref-entry' data-list='${escapeHtml(em.listName)}' data-idx='${em.idx}'>一键引用本条目 (${em.unreferencedVars.length})</button>` : ''}
        <button type='button' class='td-btn sm ${em.ignored ? 'warn' : ''}' data-action='pv-toggle-ignore-entry' data-ekey='${escapeHtml(em.ignoreKey)}'>${em.ignored ? '取消忽略' : '忽略'}</button>
        <button type='button' class='td-btn sm' data-action='pv-jump-entry' data-list='${escapeHtml(em.listName)}' data-idx='${em.idx}'>定位条目</button>
      </div>
    </div>`;
}

export const presetVarsUiModule = {
  renderPreview(previewLayerEl) {
    if (state.previewCtx?.type !== 'pmVarCheck' || state.modal?.type !== 'presetDetail') return false;
    const vc = state.previewCtx;
    const ignoredState = getIgnoredPresetVarsState();
    const report = analyzePresetVariables(state.modal.data, vc.targetSpec || undefined, ignoredState);
    if (!vc.targetSpec || (vc.targetSpec !== '__new__' && !report.candidateTargets.some((t) => t.spec === vc.targetSpec))) {
      vc.targetSpec = report.primaryInitSpec || report.candidateTargets[0]?.spec || '__new__';
    }
    if (!vc.refTargetSpec || !report.readCandidateTargets.some((t) => t.spec === vc.refTargetSpec)) {
      vc.refTargetSpec = report.readCandidateTargets[0]?.spec || '';
    }

    const tab = vc.tab || 'vars';
    const filter = vc.filter || 'all';
    const q = (vc.query || '').trim().toLowerCase();

    const targetOpts = [
      ...report.candidateTargets.map((t) => `<option value='${escapeHtml(t.spec)}' ${t.spec === vc.targetSpec ? 'selected' : ''}>${escapeHtml(t.label)}</option>`),
      `<option value='__new__' ${vc.targetSpec === '__new__' ? 'selected' : ''}>+ 新建「变量初始化 (Variable Init)」到主列表顶部</option>`,
    ].join('');

    const refTargetOpts = report.readCandidateTargets.length > 0
      ? report.readCandidateTargets.map((t) => `<option value='${escapeHtml(t.spec)}' ${t.spec === vc.refTargetSpec ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')
      : "<option value=''>（暂无可选文本条目）</option>";

    const needsInit = (v) => v.status === 'uninit_def' || v.status === 'uninit_ref' || v.status === 'inactive_init';

    let listHtml = '';
    if (tab === 'entries') {
      const filteredEntries = report.entries.filter((em) => {
        if (filter === 'unregistered' && (em.ignored || em.missingInitVars.length === 0)) return false;
        if (filter === 'unused' && (em.ignored || em.unreferencedVars.length === 0)) return false;
        if (filter === 'ignored' && !em.ignored) return false;
        if (!q) return true;
        const matchEntry = em.name.toLowerCase().includes(q) || `#${em.idx + 1}`.includes(q);
        const matchVar = [...em.initVars, ...em.assignVars, ...em.readVars].some((v) => v.name.toLowerCase().includes(q));
        return matchEntry || matchVar;
      });

      listHtml = filteredEntries
        .map((em) => renderEntryCardHtml(em, needsInit, filter === 'unused'))
        .join('') || (filter === 'ignored'
          ? "<div class='td-group-empty'>暂无已忽略的条目</div>"
          : "<div class='td-group-empty'>没有匹配的含变量条目</div>");
    } else {
      const filteredVars = report.variables.filter((v) => {
        if (filter === 'unregistered' && (v.ignored || !needsInit(v))) return false;
        if (filter === 'unused' && (v.ignored || v.status !== 'unused_init')) return false;
        if (filter === 'ignored' && !v.ignored) return false;
        if (!q) return true;
        return v.name.toLowerCase().includes(q)
          || [...v.inits, ...v.assigns, ...v.reads].some((l) => l.name.toLowerCase().includes(q));
      });

      const varsHtml = filteredVars.map((v) => {
        const origBadge = v.status === 'uninit_def'
          ? "<span class='td-mode-tag del'>赋值未初始化</span>"
          : (v.status === 'uninit_ref'
            ? "<span class='td-mode-tag single'>仅引用未初始化</span>"
            : (v.status === 'inactive_init'
              ? "<span class='td-mode-tag del'>初始化未生效</span>"
              : (v.status === 'unused_init'
                ? "<span class='td-mode-tag single'>未引用</span>"
                : "<span class='td-mode-tag ok'>已初始化</span>")));
        const badge = v.ignored
          ? `<span class='td-mode-tag is-ignored'>已忽略</span>${origBadge}`
          : origBadge;
        const needReg = needsInit(v);
        const isUnusedInit = !v.ignored && v.status === 'unused_init';
        const initMacro = v.isGlobal ? `{{setglobalvar::${v.name}::}}` : `{{setvar::${v.name}::}}`;
        const readMacro = v.isGlobal ? `{{getglobalvar::${v.name}}}` : `{{getvar::${v.name}}}`;
        const orderWarn = !v.ignored && v.orderIssue
          ? `<span class='td-mode-tag single' title='主列表 #${v.orderIssue.firstUseIdx + 1} 先于初始化条目 #${v.orderIssue.firstInitIdx + 1}'>顺序靠后(#${v.orderIssue.firstUseIdx + 1}先用)</span>`
          : '';

        return `
          <div class='td-mgr-row ${v.ignored ? 'is-ignored' : (needReg ? 'is-active' : '')}'>
            <div class='td-mgr-row-head'>
              <div style='display:flex;align-items:center;gap:5px;min-width:0;flex:1;flex-wrap:wrap;'>
                ${badge}
                ${v.isGlobal ? "<span class='td-src-badge'>全局</span>" : ''}
                ${orderWarn}
                <span class='td-mgr-row-title' style='font-family:ui-monospace,monospace;' title='${escapeHtml(v.name)}'>${escapeHtml(v.name)}</span>
              </div>
              <span class='td-src-badge'>读 ${v.reads.length} · 改 ${v.assigns.length}</span>
            </div>
            <div class='td-var-locs'>
              ${formatLocBadges(v.inits, '初始化于') || `<div class='td-var-loc ${v.ignored ? '' : 'is-miss'}'><strong>初始化状态：</strong>未在基准初始化条目中找到（缺少 ${escapeHtml(initMacro)}）</div>`}
              ${formatLocBadges(v.assigns, '赋值/修改')}
              ${formatLocBadges(v.reads, '读取引用') || "<div class='td-var-loc'><strong>读取引用：</strong>预设内暂无读取（可能由世界书或正则读取）</div>"}
            </div>
            <div class='td-mgr-row-actions'>
              ${needReg ? `<button type='button' class='td-btn sm primary' data-action='pv-reg-one' data-vkey='${escapeHtml(v.key)}'>一键初始化</button>` : ''}
              ${isUnusedInit ? `<button type='button' class='td-btn sm primary' data-action='pv-ref-one' data-vkey='${escapeHtml(v.key)}'>一键引用</button>` : ''}
              <button type='button' class='td-btn sm ${v.ignored ? 'warn' : ''}' data-action='pv-toggle-ignore-var' data-vkey='${escapeHtml(v.key)}'>${v.ignored ? '取消忽略' : '忽略'}</button>
              <button type='button' class='td-btn sm' data-action='pv-copy-macro' data-macro='${escapeHtml(initMacro)}'>复制初始化宏</button>
              <button type='button' class='td-btn sm' data-action='pv-copy-macro' data-macro='${escapeHtml(readMacro)}'>复制读取宏</button>
            </div>
          </div>`;
      }).join('');

      let relatedEntriesHtml = '';
      if (filter === 'unused') {
        const unrefKeys = new Set(filteredVars.map((v) => v.key));
        const relatedEntries = report.entries.filter((em) => {
          if (em.ignored || em.unreferencedVars.length === 0) return false;
          if (!q) return true;
          return em.unreferencedVars.some((v) => unrefKeys.has(v.key))
            || em.name.toLowerCase().includes(q)
            || `#${em.idx + 1}`.includes(q);
        });
        if (relatedEntries.length > 0) {
          relatedEntriesHtml = `
            <div class='td-scope-head'>
              <span>相关条目 (${relatedEntries.length})</span>
            </div>
            ${relatedEntries.map((em) => renderEntryCardHtml(em, needsInit, true)).join('')}`;
        }
      } else if (filter === 'ignored') {
        const ignoredEntriesList = report.stats.ignoredEntryList.filter((em) => !q
          || em.name.toLowerCase().includes(q)
          || `#${em.idx + 1}`.includes(q)
          || [...em.initVars, ...em.assignVars, ...em.readVars].some((v) => v.name.toLowerCase().includes(q)));
        if (ignoredEntriesList.length > 0) {
          relatedEntriesHtml = `
            <div class='td-scope-head'>
              <span>已忽略条目 (${ignoredEntriesList.length})</span>
            </div>
            ${ignoredEntriesList.map((em) => renderEntryCardHtml(em, needsInit, false)).join('')}`;
        }
      }

      listHtml = (varsHtml || relatedEntriesHtml)
        ? `${varsHtml}${relatedEntriesHtml}`
        : (filter === 'ignored'
          ? "<div class='td-group-empty'>暂无已忽略的变量或条目</div>"
          : "<div class='td-group-empty'>未检测到匹配的变量宏</div>");
    }

    const showRefBar = filter === 'unused';
    const unusedTargetCount = report.stats.unusedInitList.filter((v) => !q || v.name.toLowerCase().includes(q)
      || [...v.inits, ...v.assigns, ...v.reads].some((l) => l.name.toLowerCase().includes(q))).length;

    const cntNeedInit = tab === 'entries' ? report.stats.entryNeedInit : report.stats.needInit;
    const cntUnref = tab === 'entries' ? report.stats.entryUnref : report.stats.unusedInit;
    const cntIgnored = tab === 'entries'
      ? report.stats.entryIgnored
      : (report.stats.ignoredVars + report.stats.entryIgnored);
    const hasAnyIgnored = ignoredState.vars.size > 0 || ignoredState.entries.size > 0;

    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>变量初始化检测 · ${escapeHtml(state.modal.presetName === 'in_use' ? state.presetName : state.modal.presetName)}</div>
          <div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='pmVarCheck' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button></div>
        </div>
        <div class='td-modal-body td-picker-body' style='gap:7px;'>
          <div class='td-pv-target-bar'>
            <span class='td-bar-label' style='width:auto;font-size:11.5px;' title='以此条目作为变量初始化的校验基准与写入目标'>写入</span>
            <select class='td-select' id='td-pv-target-sel' style='height:30px;font-size:12px;'>${targetOpts}</select>
            ${report.stats.needInit > 0
              ? `<button type='button' class='td-btn sm warn' data-action='pv-reg-all'>一键初始化 (${report.stats.needInit})</button>
                 <button type='button' class='td-icon-btn' data-action='pv-copy-missing' title='复制全部缺失初始化宏' style='width:28px;height:28px;'>${ICONS.copy}</button>`
              : "<span class='td-mode-tag ok'>✓ 均已初始化</span>"}
          </div>

          <div class='td-ai-sec-row' style='gap:6px;'>
            <div class='td-pv-seg'>
              <button type='button' class='td-pv-seg-btn ${tab === 'vars' ? 'active' : ''}' data-action='pv-set-tab' data-tab='vars'>变量 (${report.stats.total})</button>
              <button type='button' class='td-pv-seg-btn ${tab === 'entries' ? 'active' : ''}' data-action='pv-set-tab' data-tab='entries'>条目 (${report.entries.length})</button>
            </div>
            <div class='td-search-input-wrap' style='flex:1;min-width:100px;'>
              <input class='td-input' id='td-pv-search' type='text' placeholder='搜索变量或条目...' value='${escapeHtml(vc.query || '')}' style='height:30px;font-size:12.5px;padding:0 ${vc.query ? '26px' : '9px'} 0 9px;border-radius:8px;' />
              ${vc.query ? `<button type='button' class='td-search-clear' data-action='pv-clear-search' title='清空' style='width:22px;height:22px;right:4px;'>${ICONS.close}</button>` : ''}
            </div>
          </div>

          <div class='td-filter-bar td-snap-filter-bar'>
            <button type='button' class='td-chip ${filter === 'all' ? 'active' : ''}' data-action='pv-set-filter' data-filter='all'>全部</button>
            <button type='button' class='td-chip ${filter === 'unregistered' ? 'active' : ''}' data-action='pv-set-filter' data-filter='unregistered'>需处理 (${cntNeedInit})</button>
            <button type='button' class='td-chip ${filter === 'unused' ? 'active' : ''}' data-action='pv-set-filter' data-filter='unused'>未引用 (${cntUnref})</button>
            <button type='button' class='td-chip ${filter === 'ignored' ? 'active' : ''}' data-action='pv-set-filter' data-filter='ignored'>已忽略 (${cntIgnored})</button>
          </div>

          ${filter === 'ignored' && hasAnyIgnored ? `
            <div class='td-pv-target-bar' style='justify-content:space-between;'>
              <span style='font-size:11.5px;color:var(--td-text-muted);'>已忽略 ${ignoredState.vars.size} 个变量 · ${ignoredState.entries.size} 个条目</span>
              <button type='button' class='td-btn sm warn' data-action='pv-clear-ignored'>全部取消忽略</button>
            </div>` : ''}

          ${showRefBar ? `
            <div class='td-pv-target-bar'>
              <span class='td-bar-label' style='width:auto;font-size:11.5px;'>引用到</span>
              <select class='td-select' id='td-pv-ref-target-sel' style='height:30px;font-size:12px;'>${refTargetOpts}</select>
              ${unusedTargetCount > 0
                ? `<button type='button' class='td-btn sm primary' data-action='pv-ref-all'>一键引用 (${unusedTargetCount})</button>`
                : "<span class='td-mode-tag ok'>✓ 暂无待引用</span>"}
            </div>` : ''}

          <div class='td-picker-list td-scroll'>${listHtml}</div>
        </div>
        <div class='td-modal-foot'>
          <button type='button' class='td-btn primary' data-action='close-preview'>完成</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return true;
  },

  handleClick(e, actionEl, action) {
    if (state.previewCtx?.type !== 'pmVarCheck' || state.modal?.type !== 'presetDetail') return false;
    const vc = state.previewCtx;
    const data = state.modal.data;

    if (action === 'pv-set-tab') {
      vc.tab = actionEl.getAttribute('data-tab') === 'entries' ? 'entries' : 'vars';
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'pv-set-filter') {
      vc.filter = actionEl.getAttribute('data-filter') || 'all';
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'pv-clear-search') {
      vc.query = '';
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'pv-copy-macro') {
      const macro = actionEl.getAttribute('data-macro') || '';
      copyToClipboard(macro).then(() => notify('success', `已复制：${macro}`)).catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'pv-copy-missing') {
      const report = analyzePresetVariables(data, vc.targetSpec || undefined, getIgnoredPresetVarsState());
      const text = buildInitMacroListText(report.stats.needInitList);
      if (!text) { notify('info', '没有缺失初始化的变量'); return true; }
      copyToClipboard(text).then(() => notify('success', `已复制 ${report.stats.needInitList.length} 个初始化宏`)).catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'pv-toggle-ignore-var') {
      const vkey = actionEl.getAttribute('data-vkey');
      const ignored = toggleIgnoredPresetVar(vkey);
      uiCtx.renderPreviewModal();
      notify('info', ignored ? '已忽略该变量（可在「已忽略」分类中恢复）' : '已取消忽略该变量');
      return true;
    }
    if (action === 'pv-toggle-ignore-entry') {
      const ekey = actionEl.getAttribute('data-ekey');
      const ignored = toggleIgnoredPresetEntry(ekey);
      uiCtx.renderPreviewModal();
      notify('info', ignored ? '已忽略该条目（可在「已忽略」分类中恢复）' : '已取消忽略该条目');
      return true;
    }
    if (action === 'pv-clear-ignored') {
      clearIgnoredPresetVars();
      uiCtx.renderPreviewModal();
      notify('info', '已取消当前预设的所有变量/条目忽略');
      return true;
    }
    if (action === 'pv-reg-one' || action === 'pv-reg-entry' || action === 'pv-reg-all') {
      const report = analyzePresetVariables(data, vc.targetSpec || undefined, getIgnoredPresetVarsState());
      let specs = [];
      if (action === 'pv-reg-one') {
        const v = report.variables.find((x) => x.key === actionEl.getAttribute('data-vkey'));
        if (v) specs = [v];
      } else if (action === 'pv-reg-entry') {
        const ln = actionEl.getAttribute('data-list');
        const idx = Number(actionEl.getAttribute('data-idx'));
        const em = report.entries.find((x) => x.listName === ln && x.idx === idx);
        if (em) specs = em.missingInitVars;
      } else {
        specs = report.stats.needInitList;
      }
      if (specs.length === 0) { notify('info', '没有需要初始化的变量'); return true; }

      try {
        const res = initializeVariablesToTarget(data, specs, vc.targetSpec);
        if (res.added > 0) {
          state.modal.dirty = true;
          if (res.resolvedSpec) vc.targetSpec = res.resolvedSpec;
          uiCtx.renderPreviewModal();
          uiCtx.renderModal();
          notify('success', `已一键初始化 ${res.added} 个变量（请记得点击「保存预设」持久化）`);
        } else {
          notify('info', '目标条目已包含所选变量的初始化宏');
        }
      } catch (err) {
        notify('error', err.message || String(err));
      }
      return true;
    }
    if (action === 'pv-ref-one' || action === 'pv-ref-entry' || action === 'pv-ref-all') {
      const report = analyzePresetVariables(data, vc.targetSpec || undefined, getIgnoredPresetVarsState());
      const q = (vc.query || '').trim().toLowerCase();
      let specs = [];
      if (action === 'pv-ref-one') {
        const v = report.variables.find((x) => x.key === actionEl.getAttribute('data-vkey'));
        if (v) specs = [v];
      } else if (action === 'pv-ref-entry') {
        const ln = actionEl.getAttribute('data-list');
        const idx = Number(actionEl.getAttribute('data-idx'));
        const em = report.entries.find((x) => x.listName === ln && x.idx === idx);
        if (em) specs = em.unreferencedVars;
      } else {
        specs = report.stats.unusedInitList.filter((v) => !q || v.name.toLowerCase().includes(q)
          || [...v.inits, ...v.assigns, ...v.reads].some((l) => l.name.toLowerCase().includes(q)));
      }
      if (specs.length === 0) { notify('info', '没有需要引用的变量'); return true; }
      const targetSpec = vc.refTargetSpec || report.readCandidateTargets[0]?.spec || '';
      try {
        const added = referenceVariablesToTarget(data, specs, targetSpec);
        if (added > 0) {
          state.modal.dirty = true;
          uiCtx.renderPreviewModal();
          uiCtx.renderModal();
          notify('success', `已一键引用 ${added} 个变量（请记得点击「保存预设」持久化）`);
        } else {
          notify('info', '目标条目已包含所选变量的读取宏');
        }
      } catch (err) {
        notify('error', err.message || String(err));
      }
      return true;
    }
    if (action === 'pv-jump-entry') {
      const ln = actionEl.getAttribute('data-list') || 'prompts';
      const idx = Number(actionEl.getAttribute('data-idx'));
      state.previewCtx = null;
      state.modal.tab = ln === 'prompts_unused' ? 'unused' : 'prompts';
      state.modal.query = '';
      uiCtx.renderPreviewModal();
      uiCtx.renderModal();
      requestAnimationFrame(() => {
        const modalLayerEl = uiCtx.getModalLayer();
        const box = modalLayerEl?.querySelector('.td-picker-list');
        const row = box?.querySelector(`.td-mgr-row[data-idx='${idx}']`);
        if (box && row) {
          const boxRect = box.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          box.scrollTo({ top: box.scrollTop + (rowRect.top - boxRect.top) - 8, behavior: 'smooth' });
          row.style.transition = 'box-shadow 0.25s ease';
          row.style.boxShadow = '0 0 0 2px var(--td-accent)';
          setTimeout(() => { if (row.isConnected) row.style.boxShadow = ''; }, 1600);
        }
      });
      return true;
    }

    return false;
  },

  handleInput(e) {
    if (state.previewCtx?.type !== 'pmVarCheck') return false;
    if (e.target?.id === 'td-pv-search') {
      state.previewCtx.query = e.target.value;
      uiCtx.renderPreviewModal();
      return true;
    }
    return false;
  },

  handleChange(e) {
    if (state.previewCtx?.type !== 'pmVarCheck') return false;
    if (e.target?.id === 'td-pv-target-sel') {
      state.previewCtx.targetSpec = e.target.value;
      uiCtx.renderPreviewModal();
      return true;
    }
    if (e.target?.id === 'td-pv-ref-target-sel') {
      state.previewCtx.refTargetSpec = e.target.value;
      return true;
    }
    return false;
  },
};
