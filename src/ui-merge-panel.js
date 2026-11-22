import {
  escapeHtml, notify, findBestMatchingName, computeLineDiff,
  cloneWorldbookEntry, formatKeysInput, hasTH, callTH, logError,
} from './utils.js';
import { state, saveMergeDraft, clearMergeDraft } from './store.js';
import { refreshAllCatalogs, refreshWorldbookCatalog } from './catalog.js';
import {
  buildPresetDiffSession, executePresetStitch, findBestMatchingOldPreset,
} from './preset-merge.js';
import { buildWorldbookDiffSession, executeWorldbookStitch } from './worldbook-merge.js';
import {
  initPresetMergeCustomCtx, renderPresetMergeCustomModal,
  initWbMergeCustomCtx, renderWbMergeCustomModal,
  handleMergeUiClick, handleMergeUiInput,
} from './merge-ui.js';
import {
  ICONS, uiCtx, openConfirm, editHistory, readPreviewSnapshot,
  updatePreviewHistoryButtons, pushEditSnapshot,
} from './ui-common.js';

const MERGE_FILTER_LABELS = { diff: '仅看差异', conflict: '冲突', added: '新增', removed: '删除', all: '全部' };

export function updatePresetMergeBody() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl || !state.modal || state.modal.type !== 'presetMerge') return;
  const session = state.modal.session;
  const box = modalLayerEl.querySelector("[data-role='merge-list']");
  const ctrlBox = modalLayerEl.querySelector('.td-picker-controls');
  const toggleBtn = modalLayerEl.querySelector("[data-action='toggle-merge-controls']");
  const summaryEl = modalLayerEl.querySelector("[data-role='merge-summary-text']");
  if (!box) return;

  if (ctrlBox) ctrlBox.classList.toggle('is-open', !!session.controlsOpen);
  if (toggleBtn) toggleBtn.classList.toggle('is-active', !!session.controlsOpen);
  const dirtyEl = modalLayerEl.querySelector("[data-role='pm-merge-dirty']");
  if (dirtyEl) {
    const customCnt = session.entries.filter((e) => e.choice === 'custom').length;
    dirtyEl.textContent = session.dirty
      ? `有未应用缝合${customCnt > 0 ? `（含手动缝合 ${customCnt} 项）` : ''} · 尚未写入`
      : '';
    dirtyEl.style.display = session.dirty ? 'block' : 'none';
  }
  if (summaryEl) {
    const totalDiff = session.stats.conflict + session.stats.added + session.stats.removed;
    const qText = (session.query || '').trim();
    summaryEl.textContent = `${MERGE_FILTER_LABELS[session.filter] || '差异'} · 冲突${session.stats.conflict}/增${session.stats.added}/删${session.stats.removed}${totalDiff === 0 ? ' (完全一致)' : ''}${qText ? ` · 搜"${qText}"` : ''}`;
  }

  modalLayerEl.querySelectorAll("[data-action='set-merge-filter']").forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === session.filter);
  });

  const q = (session.query || '').trim().toLowerCase();
  const filtered = session.entries.filter((it) => {
    if (session.filter === 'diff' && it.status === 'same') return false;
    if (session.filter === 'conflict' && it.status !== 'conflict') return false;
    if (session.filter === 'added' && it.status !== 'added') return false;
    if (session.filter === 'removed' && it.status !== 'removed') return false;
    if (!q) return true;
    return (it.name || '').toLowerCase().includes(q)
      || (it.oldPrompt?.content || '').toLowerCase().includes(q)
      || (it.newPrompt?.content || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    box.innerHTML = "<div class='td-group-empty'>当前筛选条件下没有条目</div>";
    return;
  }

  const prevScroll = box.scrollTop;
  box.innerHTML = filtered.map((it) => {
    const tag = it.status === 'conflict'
      ? "<span class='td-mode-tag single'>冲突差异</span>"
      : (it.status === 'added'
        ? "<span class='td-mode-tag ok'>新版新增</span>"
        : (it.status === 'removed' ? "<span class='td-mode-tag del'>新版删除</span>" : "<span class='td-mode-tag multi'>一致</span>"));

    const choiceLabel = it.choice === 'old' ? '保留旧版' : (it.choice === 'custom' ? '手动缝合' : '采用新版');
    const choiceTag = it.status === 'same' ? '' : `<span class='td-src-badge'>裁决: ${choiceLabel}</span>`;

    let bodyHtml = '';
    if (it.expanded) {
      let diffHtml = '';
      if (it.status === 'conflict' && (it.oldPrompt?.content || '') !== (it.newPrompt?.content || '')) {
        const lines = computeLineDiff(it.oldPrompt?.content || '', it.newPrompt?.content || '');
        diffHtml = `<div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`;
      } else if (it.status === 'added' && it.newPrompt?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line add'>${escapeHtml(it.newPrompt.content)}</div></div>`;
      } else if (it.status === 'removed' && it.oldPrompt?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line del'>${escapeHtml(it.oldPrompt.content)}</div></div>`;
      }

      const actionsHtml = it.status === 'same' ? '' : `
        <div class='td-merge-actions'>
          ${it.oldPrompt ? `<button type='button' class='td-merge-choice ${it.choice === 'old' ? 'active-old' : ''}' data-action='set-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='old'>保留旧版 (Current)</button>` : ''}
          <button type='button' class='td-merge-choice ${it.choice === 'new' ? 'active-new' : ''}' data-action='set-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='new'>${it.status === 'removed' ? '确认删除 (新版)' : '采用新版 (Incoming)'}</button>
          <button type='button' class='td-merge-choice ${it.choice === 'custom' ? 'active-custom' : ''}' data-action='open-merge-custom' data-entry-key='${escapeHtml(it.key)}'>编辑缝合</button>
          <button type='button' class='td-merge-choice' data-action='open-merge-custom-content-only' data-entry-key='${escapeHtml(it.key)}'>只缝合内容</button>
        </div>`;

      bodyHtml = `<div class='td-merge-body'><div style='font-size:11.5px;color:var(--td-text-muted);'>差异原因：${escapeHtml(it.diffReasons.join(' · ') || '无差异')}</div>${actionsHtml}${diffHtml}</div>`;
    }

    return `<div class='td-merge-card'><div class='td-merge-head' data-action='toggle-merge-expand' data-entry-key='${escapeHtml(it.key)}'>${tag}<span class='td-merge-title' title='${escapeHtml(it.name)}'>${escapeHtml(it.name)}</span>${choiceTag}</div>${bodyHtml}</div>`;
  }).join('');
  if (prevScroll > 0) box.scrollTop = prevScroll;
}

export function updateWbMergeBody() {
  const modalLayerEl = uiCtx.getModalLayer();
  if (!modalLayerEl || !state.modal || state.modal.type !== 'wbMerge') return;
  const session = state.modal.session;
  const box = modalLayerEl.querySelector("[data-role='wb-merge-list']");
  const ctrlBox = modalLayerEl.querySelector('.td-picker-controls');
  const toggleBtn = modalLayerEl.querySelector("[data-action='toggle-wb-merge-controls']");
  const summaryEl = modalLayerEl.querySelector("[data-role='wb-merge-summary-text']");
  if (!box) return;

  if (ctrlBox) ctrlBox.classList.toggle('is-open', !!session.controlsOpen);
  if (toggleBtn) toggleBtn.classList.toggle('is-active', !!session.controlsOpen);
  const dirtyEl = modalLayerEl.querySelector("[data-role='wb-merge-dirty']");
  if (dirtyEl) {
    const customCnt = session.entries.filter((e) => e.choice === 'custom').length;
    dirtyEl.textContent = session.dirty
      ? `有未应用缝合${customCnt > 0 ? `（含手动缝合 ${customCnt} 项）` : ''} · 尚未写入`
      : '';
    dirtyEl.style.display = session.dirty ? 'block' : 'none';
  }
  if (summaryEl) {
    const totalDiff = session.stats.conflict + session.stats.added + session.stats.removed;
    const qText = (session.query || '').trim();
    summaryEl.textContent = `冲突${session.stats.conflict}/增${session.stats.added}/删${session.stats.removed}${totalDiff === 0 ? ' (完全一致)' : ''}${qText ? ` · 搜"${qText}"` : ''}`;
  }

  modalLayerEl.querySelectorAll("[data-action='set-wb-merge-filter']").forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === session.filter);
  });

  const q = (session.query || '').trim().toLowerCase();
  const filtered = session.entries.filter((it) => {
    if (session.filter === 'diff' && it.status === 'same') return false;
    if (session.filter === 'conflict' && it.status !== 'conflict') return false;
    if (session.filter === 'added' && it.status !== 'added') return false;
    if (session.filter === 'removed' && it.status !== 'removed') return false;
    if (!q) return true;
    return (it.name || '').toLowerCase().includes(q)
      || (it.oldEntry?.content || '').toLowerCase().includes(q)
      || (it.newEntry?.content || '').toLowerCase().includes(q)
      || formatKeysInput(it.newEntry?.strategy?.keys).toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    box.innerHTML = "<div class='td-group-empty'>当前筛选条件下没有世界书条目</div>";
    return;
  }

  const prevScroll = box.scrollTop;
  box.innerHTML = filtered.map((it) => {
    const tag = it.status === 'conflict'
      ? "<span class='td-mode-tag single'>冲突差异</span>"
      : (it.status === 'added'
        ? "<span class='td-mode-tag ok'>新版新增</span>"
        : (it.status === 'removed' ? "<span class='td-mode-tag del'>新版删除</span>" : "<span class='td-mode-tag multi'>一致</span>"));

    const choiceLabel = it.choice === 'old' ? '保留旧版' : (it.choice === 'custom' ? '手动缝合' : '采用新版');
    const choiceTag = it.status === 'same' ? '' : `<span class='td-src-badge'>裁决: ${choiceLabel}</span>`;

    let bodyHtml = '';
    if (it.expanded) {
      let diffHtml = '';
      if (it.status === 'conflict' && (it.oldEntry?.content || '') !== (it.newEntry?.content || '')) {
        const lines = computeLineDiff(it.oldEntry?.content || '', it.newEntry?.content || '');
        diffHtml = `<div class='td-diff-box td-scroll'>${lines.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`;
      } else if (it.status === 'added' && it.newEntry?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line add'>${escapeHtml(it.newEntry.content)}</div></div>`;
      } else if (it.status === 'removed' && it.oldEntry?.content) {
        diffHtml = `<div class='td-diff-box td-scroll'><div class='td-diff-line del'>${escapeHtml(it.oldEntry.content)}</div></div>`;
      }

      const actionsHtml = it.status === 'same' ? '' : `
        <div class='td-merge-actions'>
          ${it.oldEntry ? `<button type='button' class='td-merge-choice ${it.choice === 'old' ? 'active-old' : ''}' data-action='set-wb-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='old'>保留旧版</button>` : ''}
          <button type='button' class='td-merge-choice ${it.choice === 'new' ? 'active-new' : ''}' data-action='set-wb-merge-choice' data-entry-key='${escapeHtml(it.key)}' data-choice='new'>${it.status === 'removed' ? '确认删除' : '采用新版'}</button>
          <button type='button' class='td-merge-choice ${it.choice === 'custom' ? 'active-custom' : ''}' data-action='open-wb-merge-custom' data-entry-key='${escapeHtml(it.key)}'>编辑缝合</button>
          <button type='button' class='td-merge-choice' data-action='open-wb-merge-custom-content-only' data-entry-key='${escapeHtml(it.key)}'>只缝合内容</button>
        </div>`;

      bodyHtml = `<div class='td-merge-body'><div style='font-size:11.5px;color:var(--td-text-muted);'>差异原因：${escapeHtml(it.diffReasons.join(' · ') || '无差异')}</div>${actionsHtml}${diffHtml}</div>`;
    }

    return `<div class='td-merge-card'><div class='td-merge-head' data-action='toggle-wb-merge-expand' data-entry-key='${escapeHtml(it.key)}'>${tag}<span class='td-merge-title' title='${escapeHtml(it.name)}'>${escapeHtml(it.name)}</span>${choiceTag}</div>${bodyHtml}</div>`;
  }).join('');
  if (prevScroll > 0) box.scrollTop = prevScroll;
}

export const mergePanelUiModule = {
  confirmDirty(onProceed) {
    const m = state.modal;
    if (!m || (m.type !== 'presetMerge' && m.type !== 'wbMerge') || !m.session?.dirty) return false;
    const isPreset = m.type === 'presetMerge';
    const draftKey = isPreset ? 'preset' : 'worldbook';
    openConfirm({
      title: '未应用的缝合结果',
      message: `${isPreset ? '预设' : '世界书'}对比缝合「${m.session.oldName} ⇄ ${m.session.newName}」已有缝合修改，但尚未点击「覆盖」或「另存为」写入目标。直接关闭不会生效，是否暂存草稿？`,
      confirmText: '放弃并关闭',
      confirmClass: 'danger',
      extraButton: {
        text: '暂存草稿并关闭',
        className: 'primary',
        onClick: () => {
          saveMergeDraft(draftKey, m.session);
          notify('info', '已暂存缝合草稿，下次打开对比缝合可继续');
          onProceed();
        },
      },
      onConfirm: () => {
        if (state.mergeDrafts && state.mergeDrafts[draftKey] === m.session) {
          clearMergeDraft(draftKey);
        }
        onProceed();
      },
    });
    return true;
  },

  renderModal(m, modalLayerEl) {
    if (m.type === 'presetMergeSelect') {
      const list = state.presetNames.filter((n) => n && n !== 'in_use');
      if (state.presetName && state.presetName !== 'in_use' && !list.includes(state.presetName)) list.unshift(state.presetName);
      const newVal = (m.newName && list.includes(m.newName)) ? m.newName : (state.presetName && state.presetName !== 'in_use' ? state.presetName : (list[0] || ''));
      const oldVal = (m.oldName && list.includes(m.oldName)) ? m.oldName : findBestMatchingOldPreset(newVal, list);
      m.oldName = oldVal; m.newName = newVal;
      const draft = state.mergeDrafts?.preset;
      const draftHtml = draft ? `
        <div class='td-attr-warn-banner' style='display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;'>
          <span style='flex:1;min-width:160px;'>有未应用的缝合草稿：${escapeHtml(draft.oldName)} ⇄ ${escapeHtml(draft.newName)}${draft._pendingCustom ? '（含未保存的条目编辑）' : ''}</span>
          <span style='display:flex;gap:6px;'>
            <button type='button' class='td-btn sm primary' data-action='resume-preset-merge'>继续上次缝合</button>
            <button type='button' class='td-btn sm' data-action='discard-preset-merge-draft'>丢弃</button>
          </span>
        </div>` : '';
      const optsHtml = (sel) => list.map((n) => `<option value='${escapeHtml(n)}' ${n === sel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
      modalLayerEl.innerHTML = `
        <div class='td-modal'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.gitMerge} 预设版本对比与缝合</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          <div class='td-modal-body'>
            ${draftHtml}
            <div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>默认将「当前预设」设为新版预设，并自动模糊匹配最相近的旧版预设（也可手动更改或一键交换）。</div>
            <div class='td-field'><label class='td-label'>旧版本预设（Current · 修改来源）</label><select class='td-select' id='td-merge-old-select'>${optsHtml(oldVal)}</select></div>
            <div style='display:flex;justify-content:center;'><button type='button' class='td-btn sm' data-action='swap-merge-presets'>${ICONS.swap} 交换旧版 / 新版</button></div>
            <div class='td-field'><label class='td-label'>新版本预设（Incoming · 导入的目标新版）</label><select class='td-select' id='td-merge-new-select'>${optsHtml(newVal)}</select></div>
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button><button class='td-btn primary' data-action='start-preset-merge'>开始对比与缝合</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'presetMerge') {
      const s = m.session;
      const titleStr = `${s.oldName} ⇄ ${s.newName}`;
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title td-title-clickable' data-action='show-full-title' data-full-title='${escapeHtml(titleStr)}' title='点击查看完整标题'>${escapeHtml(titleStr)}</div>
            <div style='display:flex;gap:4px;align-items:center;'><button class='td-btn sm' data-action='toggle-merge-controls'>${ICONS.sliders} 筛选与批量</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-picker-summary'><span data-role='merge-summary-text' style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'></span></div>
            <div class='td-picker-controls'>
              <div class='td-filter-bar'>
                <button class='td-chip' data-action='set-merge-filter' data-filter='diff'>差异 (${s.stats.conflict + s.stats.added + s.stats.removed})</button>
                <button class='td-chip' data-action='set-merge-filter' data-filter='conflict'>冲突 (${s.stats.conflict})</button>
                <button class='td-chip' data-action='set-merge-filter' data-filter='added'>新增 (${s.stats.added})</button>
                <button class='td-chip' data-action='set-merge-filter' data-filter='removed'>删除 (${s.stats.removed})</button>
                <button class='td-chip' data-action='set-merge-filter' data-filter='all'>全部 (${s.entries.length})</button>
              </div>
              <div class='td-filter-bar'><button class='td-btn sm' data-action='merge-batch-states'>仅迁移旧版开关</button><button class='td-btn sm' data-action='merge-batch-old'>全选保留旧版</button><button class='td-btn sm' data-action='merge-batch-new'>全选采用新版</button></div>
              <input class='td-input' id='td-merge-search' type='text' placeholder='搜索差异条目名称或内容...' value='${escapeHtml(s.query || '')}' />
            </div>
            <div class='td-picker-list td-scroll' data-role='merge-list'></div>
          </div>
          <div class='td-modal-foot' style='flex-wrap:wrap;'>
            <span data-role='pm-merge-dirty' style='width:100%;font-size:11.5px;font-weight:600;color:var(--td-single);display:none;'></span>
            <label style='margin-right:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;'><input type='checkbox' class='td-checkbox' id='td-merge-settings-cb' ${s.migrateSettings ? 'checked' : ''} /><span>迁移旧版参数</span></label><button class='td-btn' data-action='merge-save-as'>另存为新预设</button><button class='td-btn primary' data-action='merge-apply-target'>覆盖新版预设</button>
          </div>
        </div>`;
      updatePresetMergeBody();
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'wbMergeSelect') {
      const books = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
      const newVal = (m.newName && books.includes(m.newName)) ? m.newName : (books[0] || '');
      const oldVal = (m.oldName && books.includes(m.oldName)) ? m.oldName : findBestMatchingName(newVal, books);
      m.oldName = oldVal; m.newName = newVal;
      const draft = state.mergeDrafts?.worldbook;
      const draftHtml = draft ? `
        <div class='td-attr-warn-banner' style='display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;'>
          <span style='flex:1;min-width:160px;'>有未应用的缝合草稿：${escapeHtml(draft.oldName)} ⇄ ${escapeHtml(draft.newName)}${draft._pendingCustom ? '（含未保存的条目编辑）' : ''}</span>
          <span style='display:flex;gap:6px;'>
            <button type='button' class='td-btn sm primary' data-action='resume-wb-merge'>继续上次缝合</button>
            <button type='button' class='td-btn sm' data-action='discard-wb-merge-draft'>丢弃</button>
          </span>
        </div>` : '';
      const optsHtml = (sel) => books.map((n) => `<option value='${escapeHtml(n)}' ${n === sel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
      modalLayerEl.innerHTML = `
        <div class='td-modal'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.gitMerge} 世界书对比与缝合</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          <div class='td-modal-body'>
            ${draftHtml}
            ${books.length < 2
              ? "<div class='td-empty'><div class='td-empty-title'>世界书数量不足</div><div class='td-empty-desc'>至少需要 2 本世界书才能进行对比与缝合。</div></div>"
              : `<div style='font-size:12.5px;color:var(--td-text-muted);line-height:1.5;'>选择旧版世界书与新版世界书，将自动按名称与 UID 匹配条目并生成逐行差异对比。</div>
                 <div class='td-field'><label class='td-label'>旧版本世界书（Current · 修改来源）</label><select class='td-select' id='td-wb-merge-old-select'>${optsHtml(oldVal)}</select></div>
                 <div style='display:flex;justify-content:center;'><button type='button' class='td-btn sm' data-action='swap-wb-merge'>${ICONS.swap} 交换旧版 / 新版</button></div>
                 <div class='td-field'><label class='td-label'>新版本世界书（Incoming · 目标新版）</label><select class='td-select' id='td-wb-merge-new-select'>${optsHtml(newVal)}</select></div>`}
          </div>
          <div class='td-modal-foot'><button class='td-btn' data-action='close-modal'>取消</button>${books.length >= 2 ? `<button class='td-btn primary' data-action='start-wb-merge'>开始对比与缝合</button>` : ''}</div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'wbMerge') {
      const s = m.session;
      const titleStr = `${s.oldName} ⇄ ${s.newName}`;
      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title td-title-clickable' data-action='show-full-title' data-full-title='${escapeHtml(titleStr)}' title='点击查看完整标题'>${escapeHtml(titleStr)}</div>
            <div style='display:flex;gap:4px;align-items:center;'><button class='td-btn sm' data-action='toggle-wb-merge-controls'>${ICONS.sliders} 筛选与批量</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          </div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-picker-summary'><span data-role='wb-merge-summary-text' style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'></span></div>
            <div class='td-picker-controls'>
              <div class='td-filter-bar'>
                <button class='td-chip' data-action='set-wb-merge-filter' data-filter='diff'>差异 (${s.stats.conflict + s.stats.added + s.stats.removed})</button>
                <button class='td-chip' data-action='set-wb-merge-filter' data-filter='conflict'>冲突 (${s.stats.conflict})</button>
                <button class='td-chip' data-action='set-wb-merge-filter' data-filter='added'>新增 (${s.stats.added})</button>
                <button class='td-chip' data-action='set-wb-merge-filter' data-filter='removed'>删除 (${s.stats.removed})</button>
                <button class='td-chip' data-action='set-wb-merge-filter' data-filter='all'>全部 (${s.entries.length})</button>
              </div>
              <div class='td-filter-bar'><button class='td-btn sm' data-action='wb-merge-batch-states'>仅迁移旧版开关</button><button class='td-btn sm' data-action='wb-merge-batch-old'>全选保留旧版</button><button class='td-btn sm' data-action='wb-merge-batch-new'>全选采用新版</button></div>
              <input class='td-input' id='td-wb-merge-search' type='text' placeholder='搜索世界书条目名称、关键词或正文...' value='${escapeHtml(s.query || '')}' />
            </div>
            <div class='td-picker-list td-scroll' data-role='wb-merge-list'></div>
          </div>
          <div class='td-modal-foot' style='flex-wrap:wrap;'>
            <span data-role='wb-merge-dirty' style='margin-right:auto;font-size:11.5px;font-weight:600;color:var(--td-single);display:none;'></span>
            <button class='td-btn' data-action='wb-merge-save-as'>另存为新世界书</button><button class='td-btn primary' data-action='wb-merge-apply-target'>覆盖新版世界书</button>
          </div>
        </div>`;
      updateWbMergeBody();
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  renderPreview(previewLayerEl) {
    if (state.previewCtx?.type === 'mergeCustom') {
      renderPresetMergeCustomModal(previewLayerEl, ICONS);
      editHistory.stack = [readPreviewSnapshot()];
      editHistory.index = 0;
      updatePreviewHistoryButtons();
      uiCtx.syncOverlayBounds();
      return true;
    }
    if (state.previewCtx?.type === 'wbMergeCustom') {
      renderWbMergeCustomModal(previewLayerEl, ICONS);
      editHistory.stack = [readPreviewSnapshot()];
      editHistory.index = 0;
      updatePreviewHistoryButtons();
      uiCtx.syncOverlayBounds();
      return true;
    }
    return false;
  },

  handleClick(e, actionEl, action) {
    const modalLayerEl = uiCtx.getModalLayer();
    const previewLayerEl = uiCtx.getPreviewLayer();

    if (handleMergeUiClick(e, actionEl, action, previewLayerEl, {
      renderPreviewModal: uiCtx.renderPreviewModal,
      updatePresetMergeBody,
      updateWbMergeBody,
      pushEditSnapshot,
    })) return true;

    if (action === 'open-preset-merge') { state.modal = { type: 'presetMergeSelect', oldName: '', newName: '' }; uiCtx.renderModal(); return true; }
    if (action === 'resume-preset-merge' && state.mergeDrafts?.preset) {
      const session = state.mergeDrafts.preset;
      state.modal = { type: 'presetMerge', session };
      uiCtx.renderModal();
      if (session._pendingCustom) {
        const pc = session._pendingCustom;
        const entry = session.entries.find((x) => x.key === pc.entryKey);
        if (entry) {
          state.previewKey = null;
          state.snapshotDetailId = null;
          state.previewCtx = {
            type: 'mergeCustom',
            entry,
            contentOnly: !!pc.contentOnly,
            syncScroll: false,
            edited: true,
            draft: JSON.parse(JSON.stringify(pc.draft)),
          };
          uiCtx.renderPreviewModal();
        }
      }
      notify('info', '已恢复上次未完成的预设缝合草稿');
      return true;
    }
    if (action === 'discard-preset-merge-draft') {
      clearMergeDraft('preset');
      uiCtx.renderModal();
      return true;
    }
    if (action === 'swap-merge-presets' && state.modal?.type === 'presetMergeSelect') {
      const oldSel = modalLayerEl?.querySelector('#td-merge-old-select'), newSel = modalLayerEl?.querySelector('#td-merge-new-select');
      const a = oldSel ? oldSel.value : state.modal.oldName, b = newSel ? newSel.value : state.modal.newName;
      state.modal.oldName = b; state.modal.newName = a;
      if (oldSel) oldSel.value = b; if (newSel) newSel.value = a;
      return true;
    }
    if (action === 'start-preset-merge' && state.modal?.type === 'presetMergeSelect') {
      const oldSel = modalLayerEl?.querySelector('#td-merge-old-select'), newSel = modalLayerEl?.querySelector('#td-merge-new-select');
      const oldName = oldSel ? oldSel.value : state.modal.oldName, newName = newSel ? newSel.value : state.modal.newName;
      if (!oldName || !newName) { notify('warning', '请选择要对比的两个预设'); return true; }
      if (oldName === newName) { notify('warning', '请选择两个不同的预设进行对比'); return true; }
      try { state.modal = { type: 'presetMerge', session: buildPresetDiffSession(oldName, newName) }; uiCtx.renderModal(); }
      catch (err) { logError('读取预设对比失败', err); notify('error', `读取预设失败: ${err.message || err}`); }
      return true;
    }
    if (action === 'toggle-merge-controls' && state.modal?.type === 'presetMerge') { state.modal.session.controlsOpen = !state.modal.session.controlsOpen; updatePresetMergeBody(); return true; }
    if (action === 'set-merge-filter' && state.modal?.type === 'presetMerge') { state.modal.session.filter = actionEl.getAttribute('data-filter') || 'diff'; updatePresetMergeBody(); return true; }
    if (action === 'toggle-merge-expand' && state.modal?.type === 'presetMerge') {
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (entry) { entry.expanded = !entry.expanded; updatePresetMergeBody(); }
      return true;
    }
    if (action === 'set-merge-choice' && state.modal?.type === 'presetMerge') {
      e.stopPropagation();
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (entry) {
        entry.choice = actionEl.getAttribute('data-choice');
        state.modal.session.dirty = true;
        saveMergeDraft('preset', state.modal.session);
        updatePresetMergeBody();
      }
      return true;
    }
    if (action === 'merge-batch-old' && state.modal?.type === 'presetMerge') { state.modal.session.entries.forEach((it) => { if (it.oldPrompt) it.choice = 'old'; }); state.modal.session.dirty = true; saveMergeDraft('preset', state.modal.session); updatePresetMergeBody(); notify('info', '已全部选为保留旧版'); return true; }
    if (action === 'merge-batch-new' && state.modal?.type === 'presetMerge') { state.modal.session.entries.forEach((it) => { it.choice = 'new'; }); state.modal.session.dirty = true; saveMergeDraft('preset', state.modal.session); updatePresetMergeBody(); notify('info', '已全部选为采用新版'); return true; }
    if (action === 'merge-batch-states' && state.modal?.type === 'presetMerge') {
      let cnt = 0;
      state.modal.session.entries.forEach((it) => {
        if (it.status === 'conflict' && it.oldPrompt && it.newPrompt) {
          const merged = JSON.parse(JSON.stringify(it.newPrompt));
          merged.enabled = !!it.oldPrompt.enabled;
          it.customPrompt = merged; it.choice = 'custom'; cnt++;
        }
      });
      if (cnt > 0) {
        state.modal.session.dirty = true;
        saveMergeDraft('preset', state.modal.session);
      }
      updatePresetMergeBody(); notify('success', `已将 ${cnt} 个冲突条目的开关状态设为旧版，正文保留新版`);
      return true;
    }
    if ((action === 'open-merge-custom' || action === 'open-merge-custom-content-only') && state.modal?.type === 'presetMerge') {
      e.stopPropagation();
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (!entry) return true;
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = initPresetMergeCustomCtx(entry, {
        contentOnly: action === 'open-merge-custom-content-only',
      });
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'merge-apply-target' && state.modal?.type === 'presetMerge') {
      const session = state.modal.session;
      openConfirm({
        title: '覆盖目标预设确认', message: `确定要将缝合后的结果直接覆盖保存到预设「${session.newName}」吗？`, confirmText: '确认覆盖保存', confirmClass: 'danger',
        onConfirm: () => executePresetStitch(session, 'overwrite').then(() => { session.dirty = false; delete session._pendingCustom; clearMergeDraft('preset'); state.modal = null; uiCtx.renderModal(); refreshAllCatalogs().then(() => uiCtx.renderMain()); }).catch((err) => { logError('覆盖缝合预设失败', err); notify('error', err.message || String(err)); }),
      });
      return true;
    }
    if (action === 'merge-save-as' && state.modal?.type === 'presetMerge') {
      const session = state.modal.session;
      const newName = window.prompt('请输入另存为的新预设名称：', `${session.newName}-缝合版`);
      if (!newName || !newName.trim()) return true;
      executePresetStitch(session, 'new', newName.trim()).then(() => { session.dirty = false; delete session._pendingCustom; clearMergeDraft('preset'); state.modal = null; uiCtx.renderModal(); refreshAllCatalogs().then(() => uiCtx.renderMain()); }).catch((err) => { logError('另存缝合预设失败', err); notify('error', err.message || String(err)); });
      return true;
    }

    if (action === 'open-wb-merge') { state.modal = { type: 'wbMergeSelect', oldName: '', newName: '' }; uiCtx.renderModal(); return true; }
    if (action === 'resume-wb-merge' && state.mergeDrafts?.worldbook) {
      const session = state.mergeDrafts.worldbook;
      state.modal = { type: 'wbMerge', session };
      uiCtx.renderModal();
      if (session._pendingCustom) {
        const pc = session._pendingCustom;
        const entry = session.entries.find((x) => x.key === pc.entryKey);
        if (entry) {
          state.previewKey = null;
          state.snapshotDetailId = null;
          state.previewCtx = {
            type: 'wbMergeCustom',
            entry,
            contentOnly: !!pc.contentOnly,
            syncScroll: false,
            edited: true,
            draft: JSON.parse(JSON.stringify(pc.draft)),
          };
          uiCtx.renderPreviewModal();
        }
      }
      notify('info', '已恢复上次未完成的世界书缝合草稿');
      return true;
    }
    if (action === 'discard-wb-merge-draft') {
      clearMergeDraft('worldbook');
      uiCtx.renderModal();
      return true;
    }
    if (action === 'swap-wb-merge' && state.modal?.type === 'wbMergeSelect') {
      const oldSel = modalLayerEl?.querySelector('#td-wb-merge-old-select'), newSel = modalLayerEl?.querySelector('#td-wb-merge-new-select');
      const a = oldSel ? oldSel.value : state.modal.oldName, b = newSel ? newSel.value : state.modal.newName;
      state.modal.oldName = b; state.modal.newName = a; if (oldSel) oldSel.value = b; if (newSel) newSel.value = a;
      return true;
    }
    if (action === 'start-wb-merge' && state.modal?.type === 'wbMergeSelect') {
      const oldName = modalLayerEl?.querySelector('#td-wb-merge-old-select')?.value || state.modal.oldName;
      const newName = modalLayerEl?.querySelector('#td-wb-merge-new-select')?.value || state.modal.newName;
      if (!oldName || !newName || oldName === newName) { notify('warning', '请选择两本不同的世界书'); return true; }
      buildWorldbookDiffSession(oldName, newName).then((session) => { state.modal = { type: 'wbMerge', session }; uiCtx.renderModal(); })
        .catch((err) => { logError('读取对比世界书失败', err); notify('error', `读取世界书失败: ${err.message || err}`); });
      return true;
    }
    if (action === 'toggle-wb-merge-controls' && state.modal?.type === 'wbMerge') { state.modal.session.controlsOpen = !state.modal.session.controlsOpen; updateWbMergeBody(); return true; }
    if (action === 'set-wb-merge-filter' && state.modal?.type === 'wbMerge') { state.modal.session.filter = actionEl.getAttribute('data-filter') || 'diff'; updateWbMergeBody(); return true; }
    if (action === 'toggle-wb-merge-expand' && state.modal?.type === 'wbMerge') {
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (entry) { entry.expanded = !entry.expanded; updateWbMergeBody(); }
      return true;
    }
    if (action === 'set-wb-merge-choice' && state.modal?.type === 'wbMerge') {
      e.stopPropagation();
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (entry) {
        entry.choice = actionEl.getAttribute('data-choice');
        state.modal.session.dirty = true;
        saveMergeDraft('worldbook', state.modal.session);
        updateWbMergeBody();
      }
      return true;
    }
    if (action === 'wb-merge-batch-old' && state.modal?.type === 'wbMerge') { state.modal.session.entries.forEach((it) => { if (it.oldEntry) it.choice = 'old'; }); state.modal.session.dirty = true; saveMergeDraft('worldbook', state.modal.session); updateWbMergeBody(); return true; }
    if (action === 'wb-merge-batch-new' && state.modal?.type === 'wbMerge') { state.modal.session.entries.forEach((it) => { it.choice = 'new'; }); state.modal.session.dirty = true; saveMergeDraft('worldbook', state.modal.session); updateWbMergeBody(); return true; }
    if (action === 'wb-merge-batch-states' && state.modal?.type === 'wbMerge') {
      let cnt = 0;
      state.modal.session.entries.forEach((it) => {
        if (it.status === 'conflict' && it.oldEntry && it.newEntry) {
          const merged = cloneWorldbookEntry(it.newEntry); merged.enabled = !!it.oldEntry.enabled;
          it.customEntry = merged; it.choice = 'custom'; cnt++;
        }
      });
      if (cnt > 0) {
        state.modal.session.dirty = true;
        saveMergeDraft('worldbook', state.modal.session);
      }
      updateWbMergeBody(); notify('success', `已将 ${cnt} 个冲突条目的开关迁移为旧版`);
      return true;
    }
    if ((action === 'open-wb-merge-custom' || action === 'open-wb-merge-custom-content-only') && state.modal?.type === 'wbMerge') {
      e.stopPropagation();
      const entry = state.modal.session.entries.find((x) => x.key === actionEl.getAttribute('data-entry-key'));
      if (!entry) return true;
      state.previewKey = null; state.snapshotDetailId = null;
      state.previewCtx = initWbMergeCustomCtx(entry, {
        contentOnly: action === 'open-wb-merge-custom-content-only',
      });
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'wb-merge-apply-target' && state.modal?.type === 'wbMerge') {
      const session = state.modal.session;
      openConfirm({
        title: '覆盖目标世界书确认', message: `确定要将缝合后的条目覆盖保存到世界书「${session.newName}」吗？`, confirmText: '确认覆盖', confirmClass: 'danger',
        onConfirm: () => executeWorldbookStitch(session, 'overwrite').then(() => { session.dirty = false; delete session._pendingCustom; clearMergeDraft('worldbook'); state.modal = null; uiCtx.renderModal(); refreshWorldbookCatalog(false).then(() => uiCtx.renderMain()); }).catch((err) => { logError('覆盖缝合世界书失败', err); notify('error', err.message || String(err)); }),
      });
      return true;
    }
    if (action === 'wb-merge-save-as' && state.modal?.type === 'wbMerge') {
      const session = state.modal.session;
      const newName = window.prompt('请输入另存为的新世界书名称：', `${session.newName}-缝合版`);
      if (!newName || !newName.trim()) return true;
      executeWorldbookStitch(session, 'new', newName.trim()).then(() => { session.dirty = false; delete session._pendingCustom; clearMergeDraft('worldbook'); state.modal = null; uiCtx.renderModal(); refreshWorldbookCatalog(false).then(() => uiCtx.renderMain()); }).catch((err) => { logError('另存缝合世界书失败', err); notify('error', err.message || String(err)); });
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    const previewLayerEl = uiCtx.getPreviewLayer();
    if (handleMergeUiInput(e, previewLayerEl)) return true;
    const id = target.id || '';
    if (id === 'td-merge-search' && state.modal?.type === 'presetMerge') { state.modal.session.query = target.value; updatePresetMergeBody(); return true; }
    if (id === 'td-wb-merge-search' && state.modal?.type === 'wbMerge') { state.modal.session.query = target.value; updateWbMergeBody(); return true; }
    return false;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    const id = target.id || '';
    const modalLayerEl = uiCtx.getModalLayer();

    if (id === 'td-merge-settings-cb' && state.modal?.type === 'presetMerge') {
      state.modal.session.migrateSettings = !!target.checked;
      state.modal.session.dirty = true;
      saveMergeDraft('preset', state.modal.session);
      updatePresetMergeBody();
      return true;
    }
    if (id === 'td-merge-old-select' && state.modal?.type === 'presetMergeSelect') { state.modal.oldName = target.value; return true; }
    if (id === 'td-merge-new-select' && state.modal?.type === 'presetMergeSelect') {
      state.modal.newName = target.value;
      const matchedOld = findBestMatchingOldPreset(target.value, state.presetNames);
      if (matchedOld) {
        state.modal.oldName = matchedOld;
        const oldSel = modalLayerEl?.querySelector('#td-merge-old-select');
        if (oldSel) oldSel.value = matchedOld;
      }
      return true;
    }
    if (id === 'td-merge-custom-enabled' && state.previewCtx?.type === 'mergeCustom') { pushEditSnapshot(true); return true; }

    if (id === 'td-wb-merge-old-select' && state.modal?.type === 'wbMergeSelect') { state.modal.oldName = target.value; return true; }
    if (id === 'td-wb-merge-new-select' && state.modal?.type === 'wbMergeSelect') {
      state.modal.newName = target.value;
      const books = hasTH('getWorldbookNames') ? (callTH('getWorldbookNames') || []) : [];
      const matched = findBestMatchingName(target.value, books);
      if (matched) {
        state.modal.oldName = matched;
        const oldSel = modalLayerEl?.querySelector('#td-wb-merge-old-select');
        if (oldSel) oldSel.value = matched;
      }
      return true;
    }

    return false;
  },
};
