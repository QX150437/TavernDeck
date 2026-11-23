import {
  escapeHtml, notify, genId, computeLineDiff, cloneWorldbookEntry,
  formatKeysInput, parseKeysInput,
} from './utils.js';
import { state, saveMergeDraft, clearMergeDraft } from './store.js';
import { PRESET_SYSTEM_IDS } from './preset-manager.js';
import { WB_POSITION_OPTIONS } from './worldbook-manager.js';
import {
  pushPresetSessionUndo, recomputePresetSessionDirty, computePresetGlobalDiff,
  executePresetMigration,
} from './preset-merge.js';
import {
  pushWbSessionUndo, recomputeWbSessionDirty, computeWbGlobalDiff,
  executeWbMigration,
} from './worldbook-merge.js';
import {
  initPresetMergeCustomCtx, initWbMergeCustomCtx,
  buildPresetAttrRows, buildWbAttrRows, renderAttrDiffBoxHtml,
} from './merge-ui.js';
import {
  ICONS, uiCtx, openConfirm, editHistory, readPreviewSnapshot, updatePreviewHistoryButtons, pushEditSnapshot,
} from './ui-common.js';
import { renderQuickInsertHtml } from './ui-snippets.js';
import { updateDualMergeBody } from './ui-merge-panel.js';

function getActiveMergeSession() {
  if (state.modal?.type === 'presetMerge' && state.modal.session?.v === 3) return state.modal.session;
  if (state.modal?.type === 'wbMerge' && state.modal.session?.v === 3) return state.modal.session;
  return null;
}

function persistDualDraft(session) {
  const kind = session.kind === 'worldbook' ? 'worldbook' : 'preset';
  if (session.dirty) saveMergeDraft(kind, session);
  else clearMergeDraft(kind);
}

function getMergeMigrateAnchorPreview(session, sp) {
  const targetSide = sp.targetScope === 'same'
    ? sp.fromSide
    : (sp.fromSide === 'source' ? 'base' : 'source');
  const targetList = targetSide === 'source' ? session.sourceEntries : session.baseEntries;
  const targetName = targetSide === 'source' ? session.sourceName : session.baseName;
  if (targetList.length === 0) {
    return `将放入「${targetName}」第 1 位（目标当前为空）`;
  }
  const num = Math.max(1, Math.min(targetList.length, Math.floor(Number(sp.targetIndex1) || 1)));
  const anchor = targetList[num - 1];
  const anchorName = anchor.data?.name || anchor.data?.id || `#${anchor.data?.uid}`;
  return `将放入「${targetName}」#${num}「${anchorName}」${sp.placement === 'after' ? '之后' : '之前'}`;
}

export const mergeDialogsUiModule = {
  renderSelectPopup(sp, selectLayerEl) {
    if (sp.type !== 'mergeMigrate') return false;
    const session = getActiveMergeSession();
    if (!session) return false;
    const isPreset = session.kind === 'preset';
    const typeText = isPreset ? '预设' : '世界书';
    const targetSide = sp.targetScope === 'same'
      ? sp.fromSide
      : (sp.fromSide === 'source' ? 'base' : 'source');
    const targetList = targetSide === 'source' ? session.sourceEntries : session.baseEntries;
    const fromLabel = sp.fromSide === 'source' ? `A (${session.sourceName})` : `B (${session.baseName})`;
    const targetName = targetSide === 'source' ? session.sourceName : session.baseName;
    const maxN = Math.max(1, targetList.length);
    const numVal = Math.max(1, Math.min(maxN, Math.floor(Number(sp.targetIndex1) || 1)));
    const previewMsg = getMergeMigrateAnchorPreview(session, sp);

    const prevListTop = selectLayerEl.querySelector('.td-mig-select-list')?.scrollTop || 0;

    const listRowsHtml = targetList.map((it, idx) => {
      const nm = it.data?.name || it.data?.id || `条目 #${it.data?.uid}`;
      const isActive = numVal === idx + 1;
      return `
        <button type='button' class='td-select-option ${isActive ? 'active' : ''}' data-action='mig-pick-ref-idx' data-idx1='${idx + 1}' style='padding:7px 10px;'>
          <span class='td-select-option-left'>
            <span class='td-idx-badge'>#${idx + 1}</span>
            <span class='td-select-option-name' style='font-size:12.5px;'>${escapeHtml(nm)}</span>
          </span>
          <span class='td-mode-tag multi' data-role='mig-row-tag' style='${isActive ? '' : 'display:none;'}'>目标</span>
        </button>`;
    }).join('');

    const helpBoxHtml = sp.showHelp ? `
      <div class='td-mig-help-box'>
        <div>• <strong>本${typeText}内迁移</strong>：调整所选条目在当前${typeText}内的序号位置。</div>
        <div>• <strong>跨${typeText}迁移</strong>：将所选条目迁移到另一侧（<strong>复制迁移</strong>保留原侧；<strong>移动迁移</strong>从原侧移除）。</div>
        <div>• <strong>替换同名/同ID</strong>：勾选后若目标存在同 ID 或同名条目，直接覆盖更新而非重复插入。</div>
        <div>• <strong>目标位置</strong>：输入序号或点击下方列表条目填入序号，选择放在该序号之前或之后。</div>
      </div>` : '';

    selectLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>迁移 · 已选 ${sp.selectedKeys.length} 项 (${escapeHtml(fromLabel)})</div>
          <div style='display:flex;gap:4px;align-items:center;'>
            <button type='button' class='td-icon-btn ${sp.showHelp ? 'is-active' : ''}' data-action='mig-toggle-help' title='查看操作说明' style='font-weight:800;font-size:13.5px;'>?</button>
            <button class='td-icon-btn' data-action='close-select-popup'>${ICONS.close}</button>
          </div>
        </div>
        <div class='td-modal-body td-picker-body'>
          ${helpBoxHtml}
          <div style='display:flex;flex-direction:column;gap:7px;flex-shrink:0;'>
            <div style='display:grid;grid-template-columns:1fr 1fr;gap:6px;'>
              <button type='button' class='td-btn sm ${sp.targetScope === 'same' ? 'primary' : ''}' data-action='mig-set-scope' data-scope='same'>本${typeText}内迁移</button>
              <button type='button' class='td-btn sm ${sp.targetScope === 'cross' ? 'primary' : ''}' data-action='mig-set-scope' data-scope='cross'>跨${typeText}迁移</button>
            </div>
            ${sp.targetScope === 'cross' ? `
              <div style='display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;'>
                <div style='display:flex;gap:4px;'>
                  <button type='button' class='td-chip ${sp.crossMode !== 'move' ? 'active' : ''}' data-action='mig-set-crossmode' data-mode='copy'>复制迁移</button>
                  <button type='button' class='td-chip ${sp.crossMode === 'move' ? 'active' : ''}' data-action='mig-set-crossmode' data-mode='move'>移动迁移</button>
                </div>
                <label style='display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;'>
                  <input type='checkbox' class='td-checkbox' id='td-mig-overwrite-cb' ${sp.overwriteMatch ? 'checked' : ''} />
                  <span>替换同名/同ID</span>
                </label>
              </div>` : ''}
            <div style='display:flex;gap:5px;align-items:center;flex-wrap:wrap;'>
              <input class='td-input' id='td-mig-target-idx' type='number' min='1' max='${maxN}' value='${numVal}' style='width:74px;height:32px;font-size:13.5px;text-align:center;' />
              <button type='button' class='td-chip ${sp.placement !== 'after' ? 'active' : ''}' data-action='mig-set-placement' data-place='before'>序号之前</button>
              <button type='button' class='td-chip ${sp.placement === 'after' ? 'active' : ''}' data-action='mig-set-placement' data-place='after'>序号之后</button>
              <button type='button' class='td-btn sm' data-action='mig-quick-pos' data-idx1='1' data-place='before'>顶部</button>
              <button type='button' class='td-btn sm' data-action='mig-quick-pos' data-idx1='${maxN}' data-place='${targetList.length > 0 ? 'after' : 'before'}'>末尾</button>
            </div>
            <div class='td-range-hint' data-role='mig-pos-preview'>${escapeHtml(previewMsg)}</div>
          </div>

          <div class='td-field' style='flex:1 1 0;min-height:180px;display:flex;flex-direction:column;'>
            <label class='td-label'>目标列表 · ${escapeHtml(targetName)}</label>
            <div class='td-select-list td-mig-select-list td-scroll'>
              ${listRowsHtml || "<div class='td-group-empty'>目标列表当前为空</div>"}
            </div>
          </div>
        </div>
        <div class='td-modal-foot'>
          <button class='td-btn' data-action='close-select-popup'>取消</button>
          <button class='td-btn primary' data-action='confirm-merge-migrate'>${ICONS.check} 确认迁移</button>
        </div>
      </div>`;
    uiCtx.syncOverlayBounds();
    if (prevListTop > 0) {
      const nextList = selectLayerEl.querySelector('.td-mig-select-list');
      if (nextList) {
        nextList.scrollTop = prevListTop;
        requestAnimationFrame(() => { nextList.scrollTop = prevListTop; });
      }
    }
    return true;
  },

  renderPreview(previewLayerEl) {
    const pc = state.previewCtx;
    const session = getActiveMergeSession();
    if (!pc || !session) return false;

    if (pc.type === 'mergeEntryEdit') {
      const sideList = pc.side === 'source' ? session.sourceEntries : session.baseEntries;
      const idx = sideList.findIndex((x) => x._key === pc.itemKey);
      const d = pc.draftData;
      const isPreset = session.kind === 'preset';
      const sideLabel = pc.side === 'source' ? `A · ${session.sourceName}` : `B · ${session.baseName}`;

      let attrsHtml = '';
      if (isPreset) {
        const isInChat = d.position?.type === 'in_chat';
        attrsHtml = `
          <details class='td-attr-diff-box'>
            <summary class='td-attr-diff-head'><span>条目属性（身份: ${escapeHtml(d.role || 'system')} · ${isInChat ? `@D${d.position?.depth ?? 0}` : '相对位置'}）</span></summary>
            <div style='padding:8px 10px;' class='td-form-grid'>
              <div class='td-field'><label class='td-label'>角色身份</label><select class='td-select' id='td-med-role'><option value='system' ${d.role === 'system' ? 'selected' : ''}>System</option><option value='user' ${d.role === 'user' ? 'selected' : ''}>User</option><option value='assistant' ${d.role === 'assistant' ? 'selected' : ''}>Assistant</option></select></div>
              <div class='td-field'><label class='td-label'>插入位置</label><select class='td-select' id='td-med-postype'><option value='relative' ${!isInChat ? 'selected' : ''}>相对位置</option><option value='in_chat' ${isInChat ? 'selected' : ''}>聊天深度 (@D)</option></select></div>
              <div class='td-field'><label class='td-label'>深度 (Depth)</label><input class='td-input' id='td-med-depth' type='number' value='${escapeHtml(d.position?.depth ?? 4)}' /></div>
              <div class='td-field'><label class='td-label'>顺序 (Order)</label><input class='td-input' id='td-med-order' type='number' value='${escapeHtml(d.position?.order ?? 100)}' /></div>
            </div>
          </details>`;
      } else {
        const stype = d.strategy?.type || 'selective';
        const secLogic = d.strategy?.keys_secondary?.logic || 'and_any';
        const posType = d.position?.type || 'after_character_definition';
        const posRole = d.position?.role || 'system';
        const posOpts = WB_POSITION_OPTIONS.map((o) => `<option value='${o.v}' ${posType === o.v ? 'selected' : ''}>${o.t}</option>`).join('');
        attrsHtml = `
          <details class='td-attr-diff-box'>
            <summary class='td-attr-diff-head'><span>世界书属性（${stype === 'constant' ? '蓝灯' : (stype === 'vectorized' ? '向量' : '绿灯')} · 顺${d.position?.order ?? 100}）</span></summary>
            <div style='padding:8px 10px;display:flex;flex-direction:column;gap:8px;'>
              <div class='td-field'><label class='td-label'>主要关键词（逗号或换行分隔）</label><input class='td-input' id='td-med-wb-keys' type='text' value='${escapeHtml(formatKeysInput(d.strategy?.keys))}' /></div>
              <div class='td-form-grid'>
                <div class='td-field'><label class='td-label'>触发策略</label><select class='td-select' id='td-med-wb-stype'><option value='selective' ${stype === 'selective' ? 'selected' : ''}>绿灯 (关键词)</option><option value='constant' ${stype === 'constant' ? 'selected' : ''}>蓝灯 (常驻)</option><option value='vectorized' ${stype === 'vectorized' ? 'selected' : ''}>向量化</option></select></div>
                <div class='td-field'><label class='td-label'>插入位置</label><select class='td-select' id='td-med-wb-postype'>${posOpts}</select></div>
                <div class='td-field'><label class='td-label'>插入顺序</label><input class='td-input' id='td-med-wb-order' type='number' value='${escapeHtml(d.position?.order ?? 100)}' /></div>
                <div class='td-field'><label class='td-label'>触发概率 (%)</label><input class='td-input' id='td-med-wb-prob' type='number' min='0' max='100' value='${escapeHtml(d.probability ?? 100)}' /></div>
                <div class='td-field'><label class='td-label'>深度 (@D)</label><input class='td-input' id='td-med-wb-depth' type='number' value='${escapeHtml(d.position?.depth ?? 4)}' /></div>
                <div class='td-field'><label class='td-label'>深度身份</label><select class='td-select' id='td-med-wb-role'><option value='system' ${posRole === 'system' ? 'selected' : ''}>System</option><option value='user' ${posRole === 'user' ? 'selected' : ''}>User</option><option value='assistant' ${posRole === 'assistant' ? 'selected' : ''}>Assistant</option></select></div>
                <div class='td-field'><label class='td-label'>次要逻辑</label><select class='td-select' id='td-med-wb-seclogic'><option value='and_any' ${secLogic === 'and_any' ? 'selected' : ''}>任一包含</option><option value='and_all' ${secLogic === 'and_all' ? 'selected' : ''}>全部包含</option><option value='not_any' ${secLogic === 'not_any' ? 'selected' : ''}>全部不含</option><option value='not_all' ${secLogic === 'not_all' ? 'selected' : ''}>非全含</option></select></div>
                <div class='td-field'><label class='td-label'>次要关键词</label><input class='td-input' id='td-med-wb-seckeys' type='text' value='${escapeHtml(formatKeysInput(d.strategy?.keys_secondary?.keys))}' /></div>
              </div>
            </div>
          </details>`;
      }

      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>编辑 #${idx + 1} · ${escapeHtml(sideLabel)}</div>
            <div style='display:flex;gap:4px;'>
              <button class='td-icon-btn' data-action='preview-undo' title='撤销' disabled>${ICONS.undo}</button>
              <button class='td-icon-btn' data-action='preview-redo' title='重做' disabled>${ICONS.redo}</button>
              <button class='td-icon-btn' data-action='copy-preview' title='复制内容'>${ICONS.copy}</button>
              <button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button>
            </div>
          </div>
          <div class='td-modal-body'>
            <div style='display:flex;gap:8px;align-items:center;'>
              <div class='td-field' style='flex:1;'><label class='td-label'>条目名称</label><input class='td-input' id='td-edit-name' type='text' value='${escapeHtml(d.name || '')}' /></div>
              <label style='display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding-top:18px;flex-shrink:0;'><input type='checkbox' class='td-checkbox' id='td-med-enabled' ${d.enabled ? 'checked' : ''} /><span>启用</span></label>
            </div>
            ${attrsHtml}
            <div class='td-field' style='flex:1;display:flex;flex-direction:column;'>
              <label class='td-label'>条目正文（支持上方撤销/重做）</label>
              ${renderQuickInsertHtml('td-edit-content')}
              <textarea class='td-textarea td-scroll' id='td-edit-content' style='flex:1;min-height:190px;'>${escapeHtml(typeof d.content === 'string' ? d.content : '')}</textarea>
            </div>
          </div>
          <div class='td-modal-foot'>
            <button class='td-btn' data-action='close-preview'>取消</button>
            <button class='td-btn primary' data-action='merge-save-entry-edit'>${ICONS.save} 应用修改</button>
          </div>
        </div>`;
      editHistory.stack = [readPreviewSnapshot()];
      editHistory.index = 0;
      updatePreviewHistoryButtons();
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (pc.type === 'mergeEntryDiff') {
      const isPreset = session.kind === 'preset';
      const sItem = pc.sourceKey ? session.sourceEntries.find((x) => x._key === pc.sourceKey) : null;
      const bItem = pc.baseKey ? session.baseEntries.find((x) => x._key === pc.baseKey) : null;
      const sData = sItem ? sItem.data : null;
      const bData = bItem ? bItem.data : null;

      const sOpts = [
        `<option value='' ${!sItem ? 'selected' : ''}>（A 侧无匹配条目）</option>`,
        ...session.sourceEntries.map((x, i) => `<option value='${escapeHtml(x._key)}' ${x._key === pc.sourceKey ? 'selected' : ''}>#${i + 1} ${escapeHtml(x.data?.name || x.data?.id || `#${x.data?.uid}`)}</option>`),
      ].join('');
      const bOpts = [
        `<option value='' ${!bItem ? 'selected' : ''}>（B 侧无匹配条目）</option>`,
        ...session.baseEntries.map((x, i) => `<option value='${escapeHtml(x._key)}' ${x._key === pc.baseKey ? 'selected' : ''}>#${i + 1} ${escapeHtml(x.data?.name || x.data?.id || `#${x.data?.uid}`)}</option>`),
      ].join('');

      const attrRows = isPreset ? buildPresetAttrRows(sData, bData) : buildWbAttrRows(sData, bData);
      const sText = sData?.content || '';
      const bText = bData?.content || '';
      const lineDiffs = computeLineDiff(sText, bText);
      const hasContentDiff = sText !== bText;

      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>双向 Diff 比对（A vs B）</div>
            <div style='display:flex;gap:4px;align-items:center;'>
              <button type='button' class='td-btn sm' data-action='merge-diff-back'>返回</button>
              <button class='td-icon-btn' data-action='close-preview' title='关闭'>${ICONS.close}</button>
            </div>
          </div>
          <div class='td-modal-body'>
            <div class='td-form-grid'>
              <div class='td-field'><label class='td-label'>A 侧条目 (${escapeHtml(session.sourceName)})</label><select class='td-select' id='td-diff-src-sel'>${sOpts}</select></div>
              <div class='td-field'><label class='td-label'>B 侧条目 (${escapeHtml(session.baseName)})</label><select class='td-select' id='td-diff-base-sel'>${bOpts}</select></div>
            </div>
            ${renderAttrDiffBoxHtml(attrRows, !!sData, !!bData, { showApply: false, oldLabel: 'A', newLabel: 'B' })}
            <div class='td-field' style='flex:1;min-height:140px;display:flex;flex-direction:column;'>
              <label class='td-label'>正文差异对比（- A 侧 / + B 侧）</label>
              ${hasContentDiff
                ? `<div class='td-diff-box td-scroll' style='flex:1;max-height:none;'>${lineDiffs.map((l) => `<div class='td-diff-line ${l.type}'>${l.type === 'add' ? '+ ' : (l.type === 'del' ? '- ' : '  ')}${escapeHtml(l.text)}</div>`).join('')}</div>`
                : "<div class='td-group-empty' style='border:1px solid var(--td-border);border-radius:9px;'>两侧正文内容完全一致</div>"}
            </div>
          </div>
          <div class='td-modal-foot'>
            ${sData ? `<button class='td-btn warn' data-action='merge-diff-overwrite' data-dir='toBase'>用 A 覆盖 B</button>` : ''}
            ${bData ? `<button class='td-btn' data-action='merge-diff-overwrite' data-dir='toSource'>用 B 覆盖 A</button>` : ''}
            <button class='td-btn primary' data-action='merge-diff-open-custom'>手动高亮缝合</button>
          </div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (pc.type === 'mergeGlobalDiff') {
      const diffRes = session.kind === 'preset' ? computePresetGlobalDiff(session) : computeWbGlobalDiff(session);
      const filter = pc.filter || 'diff';
      const filtered = diffRes.items.filter((it) => (filter === 'diff' ? it.status !== 'same' : it.status === filter));
      const rowsHtml = filtered.map((it) => {
        const badge = it.status === 'conflict'
          ? "<span class='td-mode-tag single'>差异</span>"
          : (it.status === 'sourceOnly'
            ? "<span class='td-mode-tag ok'>仅 A</span>"
            : (it.status === 'baseOnly' ? "<span class='td-mode-tag del'>仅 B</span>" : "<span class='td-mode-tag multi'>一致</span>"));
        const idxInfo = [
          it.sourceIdx >= 0 ? `A#${it.sourceIdx + 1}` : '',
          it.baseIdx >= 0 ? `B#${it.baseIdx + 1}` : '',
        ].filter(Boolean).join(' · ');
        return `
          <div class='td-mgr-row'>
            <div class='td-mgr-row-head'>
              <div style='display:flex;align-items:center;gap:6px;min-width:0;flex:1;'>
                ${badge}
                <span class='td-mgr-row-title' title='${escapeHtml(it.name)}'>${escapeHtml(it.name)}</span>
              </div>
              <span class='td-src-badge'>${escapeHtml(idxInfo)}</span>
            </div>
            <div class='td-mgr-row-sub'>${escapeHtml(it.reasons.join(' · ') || '完全一致')}</div>
            <div class='td-mgr-row-actions'>
              <button class='td-btn sm primary' data-action='gdiff-open-entry' data-skey='${escapeHtml(it.sourceKey || '')}' data-bkey='${escapeHtml(it.baseKey || '')}'>查看 Diff</button>
              ${it.sourceKey ? `<button class='td-btn sm' data-action='gdiff-migrate-side' data-side='source' data-key='${escapeHtml(it.sourceKey)}'>迁移到 B</button>` : ''}
              ${it.baseKey ? `<button class='td-btn sm' data-action='gdiff-migrate-side' data-side='base' data-key='${escapeHtml(it.baseKey)}'>迁移到 A</button>` : ''}
            </div>
          </div>`;
      }).join('');

      previewLayerEl.classList.add('is-open');
      previewLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>全局 Diff 比对报告</div>
            <button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button>
          </div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-filter-bar'>
              <button class='td-chip ${filter === 'diff' ? 'active' : ''}' data-action='gdiff-set-filter' data-filter='diff'>全部差异 (${diffRes.stats.conflict + diffRes.stats.sourceOnly + diffRes.stats.baseOnly})</button>
              <button class='td-chip ${filter === 'conflict' ? 'active' : ''}' data-action='gdiff-set-filter' data-filter='conflict'>差异 (${diffRes.stats.conflict})</button>
              <button class='td-chip ${filter === 'sourceOnly' ? 'active' : ''}' data-action='gdiff-set-filter' data-filter='sourceOnly'>仅 A (${diffRes.stats.sourceOnly})</button>
              <button class='td-chip ${filter === 'baseOnly' ? 'active' : ''}' data-action='gdiff-set-filter' data-filter='baseOnly'>仅 B (${diffRes.stats.baseOnly})</button>
              <button class='td-chip ${filter === 'same' ? 'active' : ''}' data-action='gdiff-set-filter' data-filter='same'>一致 (${diffRes.stats.same})</button>
            </div>
            <div class='td-picker-list td-scroll'>${rowsHtml || "<div class='td-group-empty'>该分类下没有条目</div>"}</div>
          </div>
          <div class='td-modal-foot'>
            <button class='td-btn primary' data-action='close-preview'>完成</button>
          </div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  handleClick(e, actionEl, action) {
    const previewLayerEl = uiCtx.getPreviewLayer();
    const selectLayerEl = uiCtx.getSelectLayer();
    const session = getActiveMergeSession();

    if (state.selectPopup?.type === 'mergeMigrate' && session) {
      const sp = state.selectPopup;
      if (action === 'mig-set-scope') {
        sp.targetScope = actionEl.getAttribute('data-scope') === 'same' ? 'same' : 'cross';
        const tList = (sp.targetScope === 'same' ? sp.fromSide : (sp.fromSide === 'source' ? 'base' : 'source')) === 'source'
          ? session.sourceEntries
          : session.baseEntries;
        if (sp.targetScope === 'same') {
          sp.targetIndex1 = 1;
          sp.placement = 'before';
        } else {
          sp.targetIndex1 = Math.max(1, tList.length);
          sp.placement = tList.length > 0 ? 'after' : 'before';
        }
        uiCtx.renderSelectPopup();
        return true;
      }
      if (action === 'mig-set-crossmode') {
        sp.crossMode = actionEl.getAttribute('data-mode') === 'move' ? 'move' : 'copy';
        uiCtx.renderSelectPopup();
        return true;
      }
      if (action === 'mig-toggle-help') {
        sp.showHelp = !sp.showHelp;
        uiCtx.renderSelectPopup();
        return true;
      }
      if (action === 'mig-set-placement') {
        sp.placement = actionEl.getAttribute('data-place') === 'after' ? 'after' : 'before';
        selectLayerEl?.querySelectorAll("[data-action='mig-set-placement']").forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-place') === sp.placement);
        });
        const previewEl = selectLayerEl?.querySelector("[data-role='mig-pos-preview']");
        if (previewEl) previewEl.textContent = getMergeMigrateAnchorPreview(session, sp);
        return true;
      }
      if (action === 'mig-quick-pos' || action === 'mig-pick-ref-idx') {
        sp.targetIndex1 = Number(actionEl.getAttribute('data-idx1')) || 1;
        const p = actionEl.getAttribute('data-place');
        if (p) sp.placement = p;
        const idxInp = selectLayerEl?.querySelector('#td-mig-target-idx');
        if (idxInp) idxInp.value = String(sp.targetIndex1);
        selectLayerEl?.querySelectorAll("[data-action='mig-set-placement']").forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-place') === sp.placement);
        });
        selectLayerEl?.querySelectorAll("[data-action='mig-pick-ref-idx']").forEach((row) => {
          const isMatch = Number(row.getAttribute('data-idx1')) === sp.targetIndex1;
          row.classList.toggle('active', isMatch);
          const tag = row.querySelector("[data-role='mig-row-tag']");
          if (tag) tag.style.display = isMatch ? '' : 'none';
        });
        const previewEl = selectLayerEl?.querySelector("[data-role='mig-pos-preview']");
        if (previewEl) previewEl.textContent = getMergeMigrateAnchorPreview(session, sp);
        return true;
      }
      if (action === 'confirm-merge-migrate') {
        const idxInp = selectLayerEl?.querySelector('#td-mig-target-idx');
        const owCb = selectLayerEl?.querySelector('#td-mig-overwrite-cb');
        if (idxInp) sp.targetIndex1 = Number(idxInp.value) || 1;
        if (owCb) sp.overwriteMatch = !!owCb.checked;
        const res = session.kind === 'preset'
          ? executePresetMigration(session, sp)
          : executeWbMigration(session, sp);
        persistDualDraft(session);
        state.selectPopup = null;
        uiCtx.renderSelectPopup();
        uiCtx.renderModal();
        if (state.previewCtx?.type === 'mergeGlobalDiff') uiCtx.renderPreviewModal();
        const msgParts = [];
        if (res.movedCount > 0) msgParts.push(sp.targetScope === 'same' ? `已调整 ${res.movedCount} 项位置` : `已迁移 ${res.movedCount} 项`);
        if (res.updatedCount > 0) msgParts.push(`更新 ${res.updatedCount} 项`);
        notify('success', msgParts.join('，') || '迁移完成');
        if (res.notes?.length) notify('info', res.notes[0]);
        return true;
      }
    }

    if (!session) return false;

    if (action === 'merge-save-entry-edit' && state.previewCtx?.type === 'mergeEntryEdit') {
      pushEditSnapshot(true);
      const pc = state.previewCtx;
      const snap = readPreviewSnapshot();
      const sideList = pc.side === 'source' ? session.sourceEntries : session.baseEntries;
      const item = sideList.find((x) => x._key === pc.itemKey);
      if (item && snap) {
        if (session.kind === 'preset') {
          pushPresetSessionUndo(session);
          const next = JSON.parse(JSON.stringify(item.data));
          next.name = snap.name.trim() || next.name || '未命名条目';
          next.enabled = !!previewLayerEl?.querySelector('#td-med-enabled')?.checked;
          next.role = previewLayerEl?.querySelector('#td-med-role')?.value || next.role || 'system';
          const posType = previewLayerEl?.querySelector('#td-med-postype')?.value || 'relative';
          if (!PRESET_SYSTEM_IDS.has(next.id) || next.position) {
            next.position = posType === 'in_chat'
              ? { type: 'in_chat', depth: Number(previewLayerEl?.querySelector('#td-med-depth')?.value) || 0, order: Number(previewLayerEl?.querySelector('#td-med-order')?.value) || 100 }
              : { type: 'relative' };
          }
          if (typeof next.content === 'string' || snap.content.length > 0 || !PRESET_SYSTEM_IDS.has(next.id)) {
            next.content = snap.content;
          }
          item.data = next;
          recomputePresetSessionDirty(session);
          if (session.diffMarks) session.diffMarks = computePresetGlobalDiff(session).markByKey;
        } else {
          pushWbSessionUndo(session);
          const next = cloneWorldbookEntry(item.data);
          next.name = snap.name.trim() || next.name || `条目 #${next.uid}`;
          next.enabled = !!previewLayerEl?.querySelector('#td-med-enabled')?.checked;
          next.strategy = Object.assign({}, next.strategy || {}, {
            type: previewLayerEl?.querySelector('#td-med-wb-stype')?.value || 'selective',
            keys: parseKeysInput(previewLayerEl?.querySelector('#td-med-wb-keys')?.value || ''),
            keys_secondary: {
              logic: previewLayerEl?.querySelector('#td-med-wb-seclogic')?.value || 'and_any',
              keys: parseKeysInput(previewLayerEl?.querySelector('#td-med-wb-seckeys')?.value || ''),
            },
          });
          next.position = {
            type: previewLayerEl?.querySelector('#td-med-wb-postype')?.value || 'after_character_definition',
            role: previewLayerEl?.querySelector('#td-med-wb-role')?.value || 'system',
            depth: Number(previewLayerEl?.querySelector('#td-med-wb-depth')?.value) || 4,
            order: Number(previewLayerEl?.querySelector('#td-med-wb-order')?.value) || 100,
          };
          next.probability = Number(previewLayerEl?.querySelector('#td-med-wb-prob')?.value ?? 100);
          next.content = snap.content;
          item.data = next;
          recomputeWbSessionDirty(session);
          if (session.diffMarks) session.diffMarks = computeWbGlobalDiff(session).markByKey;
        }
        persistDualDraft(session);
      }
      state.previewCtx = null;
      uiCtx.renderPreviewModal();
      uiCtx.renderModal();
      return true;
    }

    if (action === 'merge-diff-back' && state.previewCtx?.type === 'mergeEntryDiff') {
      const pc = state.previewCtx;
      if (pc.returnToGlobalDiff) {
        state.previewCtx = { type: 'mergeGlobalDiff', kind: session.kind, filter: pc.prevFilter || 'diff' };
      } else {
        state.previewCtx = null;
      }
      uiCtx.renderPreviewModal();
      updateDualMergeBody(session.kind);
      return true;
    }

    if (action === 'merge-diff-overwrite' && state.previewCtx?.type === 'mergeEntryDiff') {
      const pc = state.previewCtx;
      const dir = actionEl.getAttribute('data-dir');
      const sItem = pc.sourceKey ? session.sourceEntries.find((x) => x._key === pc.sourceKey) : null;
      const bItem = pc.baseKey ? session.baseEntries.find((x) => x._key === pc.baseKey) : null;
      const isPreset = session.kind === 'preset';
      const srcName = sItem?.data?.name || sItem?.data?.id || `#${sItem?.data?.uid}`;
      const baseName = bItem?.data?.name || bItem?.data?.id || `#${bItem?.data?.uid}`;

      if (dir === 'toBase' && sItem) {
        openConfirm({
          title: '覆盖条目确认',
          message: bItem
            ? `确定要用 A 侧「${srcName}」覆盖 B 侧「${baseName}」吗？（可在主界面撤销）`
            : `B 侧暂无匹配条目，确定要将 A 侧「${srcName}」添加到 B 侧末尾吗？`,
          confirmText: '确认覆盖 B',
          confirmClass: 'warn',
          onConfirm: () => {
            if (isPreset) pushPresetSessionUndo(session); else pushWbSessionUndo(session);
            if (!sItem.origRef) sItem.origRef = `m:${genId()}`;
            sItem._migTag = { type: 'out', to: 'B' };
            const copy = isPreset ? JSON.parse(JSON.stringify(sItem.data)) : cloneWorldbookEntry(sItem.data);
            if (bItem) {
              if (isPreset) copy.id = bItem.data.id; else copy.uid = bItem.data.uid;
              bItem.data = copy;
              bItem.origRef = sItem.origRef;
              bItem._migTag = { type: 'in', from: 'A' };
            } else {
              if (isPreset && session.baseEntries.some((x) => x.data?.id === copy.id)) copy.id = genId();
              if (!isPreset && session.baseEntries.some((x) => Number(x.data?.uid) === Number(copy.uid))) {
                copy.uid = session.baseEntries.reduce((mx, x) => Math.max(mx, Number(x.data?.uid) || 0), 0) + 1;
              }
              const newItem = { _key: genId(), origRef: sItem.origRef, _migTag: { type: 'in', from: 'A' }, data: copy };
              session.baseEntries.push(newItem);
              pc.baseKey = newItem._key;
            }
            if (isPreset) recomputePresetSessionDirty(session); else recomputeWbSessionDirty(session);
            if (session.diffMarks) {
              session.diffMarks = (isPreset ? computePresetGlobalDiff(session) : computeWbGlobalDiff(session)).markByKey;
            }
            persistDualDraft(session);
            uiCtx.renderPreviewModal();
            uiCtx.renderModal();
            notify('success', '已用 A 侧条目覆盖 B 侧');
          },
        });
      } else if (dir === 'toSource' && bItem) {
        openConfirm({
          title: '覆盖条目确认',
          message: sItem
            ? `确定要用 B 侧「${baseName}」覆盖 A 侧「${srcName}」吗？（可在主界面撤销）`
            : `A 侧暂无匹配条目，确定要将 B 侧「${baseName}」添加到 A 侧末尾吗？`,
          confirmText: '确认覆盖 A',
          confirmClass: 'warn',
          onConfirm: () => {
            if (isPreset) pushPresetSessionUndo(session); else pushWbSessionUndo(session);
            if (!bItem.origRef) bItem.origRef = `m:${genId()}`;
            bItem._migTag = { type: 'out', to: 'A' };
            const copy = isPreset ? JSON.parse(JSON.stringify(bItem.data)) : cloneWorldbookEntry(bItem.data);
            if (sItem) {
              if (isPreset) copy.id = sItem.data.id; else copy.uid = sItem.data.uid;
              sItem.data = copy;
              sItem.origRef = bItem.origRef;
              sItem._migTag = { type: 'in', from: 'B' };
            } else {
              if (isPreset && session.sourceEntries.some((x) => x.data?.id === copy.id)) copy.id = genId();
              if (!isPreset && session.sourceEntries.some((x) => Number(x.data?.uid) === Number(copy.uid))) {
                copy.uid = session.sourceEntries.reduce((mx, x) => Math.max(mx, Number(x.data?.uid) || 0), 0) + 1;
              }
              const newItem = { _key: genId(), origRef: bItem.origRef, _migTag: { type: 'in', from: 'B' }, data: copy };
              session.sourceEntries.push(newItem);
              pc.sourceKey = newItem._key;
            }
            if (isPreset) recomputePresetSessionDirty(session); else recomputeWbSessionDirty(session);
            if (session.diffMarks) {
              session.diffMarks = (isPreset ? computePresetGlobalDiff(session) : computeWbGlobalDiff(session)).markByKey;
            }
            persistDualDraft(session);
            uiCtx.renderPreviewModal();
            uiCtx.renderModal();
            notify('success', '已用 B 侧条目覆盖 A 侧');
          },
        });
      }
      return true;
    }

    if (action === 'merge-diff-open-custom' && state.previewCtx?.type === 'mergeEntryDiff') {
      const pc = state.previewCtx;
      const sItem = pc.sourceKey ? session.sourceEntries.find((x) => x._key === pc.sourceKey) : null;
      const bItem = pc.baseKey ? session.baseEntries.find((x) => x._key === pc.baseKey) : null;
      if (!sItem && !bItem) return true;
      if (session.kind === 'preset') {
        const entryObj = {
          key: bItem?._key || sItem?._key,
          id: bItem?.data?.id || sItem?.data?.id,
          name: bItem?.data?.name || sItem?.data?.name || '条目',
          oldPrompt: sItem ? JSON.parse(JSON.stringify(sItem.data)) : null,
          newPrompt: bItem ? JSON.parse(JSON.stringify(bItem.data)) : null,
          customPrompt: null,
        };
        const nextCtx = initPresetMergeCustomCtx(entryObj);
        nextCtx.isDualV3 = true;
        nextCtx.targetSide = 'base';
        nextCtx.targetKey = bItem?._key || null;
        nextCtx.srcKey = sItem?._key || null;
        nextCtx.baseKey = bItem?._key || null;
        nextCtx.srcRef = sItem?.origRef || null;
        nextCtx.baseRef = bItem?.origRef || null;
        state.previewCtx = nextCtx;
      } else {
        const entryObj = {
          key: bItem?._key || sItem?._key,
          uid: bItem?.data?.uid ?? sItem?.data?.uid,
          name: bItem?.data?.name || sItem?.data?.name || '条目',
          oldEntry: sItem ? cloneWorldbookEntry(sItem.data) : null,
          newEntry: bItem ? cloneWorldbookEntry(bItem.data) : null,
          customEntry: null,
        };
        const nextCtx = initWbMergeCustomCtx(entryObj);
        nextCtx.isDualV3 = true;
        nextCtx.targetSide = 'base';
        nextCtx.targetKey = bItem?._key || null;
        nextCtx.srcKey = sItem?._key || null;
        nextCtx.baseKey = bItem?._key || null;
        nextCtx.srcRef = sItem?.origRef || null;
        nextCtx.baseRef = bItem?.origRef || null;
        state.previewCtx = nextCtx;
      }
      uiCtx.renderPreviewModal();
      return true;
    }

    if (action === 'gdiff-set-filter' && state.previewCtx?.type === 'mergeGlobalDiff') {
      state.previewCtx.filter = actionEl.getAttribute('data-filter') || 'diff';
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'gdiff-open-entry' && state.previewCtx?.type === 'mergeGlobalDiff') {
      const sk = actionEl.getAttribute('data-skey') || null;
      const bk = actionEl.getAttribute('data-bkey') || null;
      const prevFilter = state.previewCtx.filter || 'diff';
      state.previewCtx = {
        type: 'mergeEntryDiff',
        kind: session.kind,
        sourceKey: sk,
        baseKey: bk,
        returnToGlobalDiff: true,
        prevFilter,
      };
      updateDualMergeBody(session.kind);
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'gdiff-migrate-side' && state.previewCtx?.type === 'mergeGlobalDiff') {
      const side = actionEl.getAttribute('data-side') === 'base' ? 'base' : 'source';
      const k = actionEl.getAttribute('data-key');
      if (!k) return true;
      const dstList = side === 'source' ? session.baseEntries : session.sourceEntries;
      state.selectPopup = {
        type: 'mergeMigrate',
        kind: session.kind,
        fromSide: side,
        selectedKeys: [k],
        targetScope: 'cross',
        crossMode: 'copy',
        overwriteMatch: false,
        placement: dstList.length > 0 ? 'after' : 'before',
        targetIndex1: Math.max(1, dstList.length),
      };
      uiCtx.renderSelectPopup();
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    if (target.id === 'td-mig-target-idx' && state.selectPopup?.type === 'mergeMigrate') {
      const session = getActiveMergeSession();
      if (!session) return true;
      const raw = String(target.value || '').trim();
      if (!raw) return true;
      const selectLayerEl = uiCtx.getSelectLayer();
      const targetSide = state.selectPopup.targetScope === 'same'
        ? state.selectPopup.fromSide
        : (state.selectPopup.fromSide === 'source' ? 'base' : 'source');
      const targetList = targetSide === 'source' ? session.sourceEntries : session.baseEntries;
      const maxN = Math.max(1, targetList.length);
      const numVal = Math.max(1, Math.min(maxN, Math.floor(Number(raw) || 1)));
      state.selectPopup.targetIndex1 = numVal;
      let matchedRow = null;
      selectLayerEl?.querySelectorAll("[data-action='mig-pick-ref-idx']").forEach((row) => {
        const isMatch = Number(row.getAttribute('data-idx1')) === numVal;
        row.classList.toggle('active', isMatch);
        if (isMatch) matchedRow = row;
        const tag = row.querySelector("[data-role='mig-row-tag']");
        if (tag) tag.style.display = isMatch ? '' : 'none';
      });
      const previewEl = selectLayerEl?.querySelector("[data-role='mig-pos-preview']");
      if (previewEl) previewEl.textContent = getMergeMigrateAnchorPreview(session, state.selectPopup);
      if (matchedRow) {
        const listBox = selectLayerEl.querySelector('.td-mig-select-list');
        if (listBox) {
          const boxRect = listBox.getBoundingClientRect();
          const rowRect = matchedRow.getBoundingClientRect();
          const targetTop = listBox.scrollTop + (rowRect.top - boxRect.top) - Math.max(0, (boxRect.height - rowRect.height) / 2);
          listBox.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        }
      }
      return true;
    }
    return false;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    if (target.id === 'td-mig-overwrite-cb' && state.selectPopup?.type === 'mergeMigrate') {
      state.selectPopup.overwriteMatch = !!target.checked;
      return true;
    }
    if (state.previewCtx?.type === 'mergeEntryDiff') {
      if (target.id === 'td-diff-src-sel') {
        state.previewCtx.sourceKey = target.value || null;
        uiCtx.renderPreviewModal();
        return true;
      }
      if (target.id === 'td-diff-base-sel') {
        state.previewCtx.baseKey = target.value || null;
        uiCtx.renderPreviewModal();
        return true;
      }
    }
    return false;
  },
};
