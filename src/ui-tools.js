import {
  APP_NAME, escapeHtml, notify, copyToClipboard, downloadTextFile,
  downloadJsonFile, logWarn, logError,
} from './utils.js';
import {
  state, saveStore, clearMergeDraft, clearAllMergeDrafts, ensureSchemesPool,
  exportStoreData, importStoreData, deleteSnapshotPayload,
  getStorageDiagnostics, cleanOrphanSnapshotPayloads, repairMissingSnapshotPayloads,
  clearMvuStarredChat, clearAllMvuStarred, cleanAutoBackupSnapshots, slimAllUnpinnedFullSnapshots,
} from './store.js';
import { slimFullSnapshot } from './snapshot.js';
import { syncNativePresetCollapse, syncNativeToastHook } from './native-ui.js';
import { getDevLogs, clearDevLogs, formatLogsReport } from './dev-tools.js';
import { ICONS, uiCtx, formatByteSize, openConfirm } from './ui-common.js';

export const toolsUiModule = {
  renderModal(m, modalLayerEl) {
    if (m.type === 'storageManager') {
      const devLogCount = getDevLogs('ALL').length;
      const d = getStorageDiagnostics(devLogCount);
      const ls = d.localStorage;
      const gv = d.globalVar;
      const mem = d.memory;
      const qc = d.quickCounts;
      const originPct = Math.min(100, Math.round((ls.originTotalBytes / ls.quotaEstimateBytes) * 100));
      const tdLsPct = Math.min(100, Math.round((ls.tdTotalBytes / ls.quotaEstimateBytes) * 100));

      const payloadRowsHtml = ls.payloadItems.length === 0
        ? "<div class='td-group-empty'>暂无完整快照载荷数据</div>"
        : ls.payloadItems.map((it) => `
            <div class='td-storage-row'>
              <div style='min-width:0;flex:1;'>
                <div style='display:flex;align-items:center;gap:5px;flex-wrap:wrap;'>
                  <span style='font-weight:700;font-size:12.5px;word-break:break-word;'>${escapeHtml(it.name)}</span>
                  ${it.orphan ? "<span class='td-mode-tag del'>孤儿</span>" : `<span class='td-src-badge'>${it.kind === 'worldbook' ? '世界书' : '预设'}</span>`}
                  ${it.auto ? "<span class='td-mode-tag single'>自动</span>" : ''}
                  ${it.pinned ? "<span class='td-mode-tag ok'>置顶</span>" : ''}
                </div>
                <div style='font-size:11px;color:var(--td-text-muted);margin-top:2px;'>${escapeHtml(it.targetName)} · 占用 ${formatByteSize(it.bytes)}</div>
              </div>
              <div style='display:flex;gap:4px;flex-shrink:0;'>
                ${!it.orphan ? `<button type='button' class='td-btn sm warn' data-action='storage-slim-one' data-snap-id='${escapeHtml(it.id)}'>瘦身</button>` : ''}
                <button type='button' class='td-btn sm danger' data-action='storage-del-snap' data-snap-id='${escapeHtml(it.id)}' data-orphan='${it.orphan ? '1' : '0'}'>删除</button>
              </div>
            </div>`).join('');

      const mvuRowsHtml = gv.mvuItems.length === 0
        ? "<div style='font-size:11.5px;color:var(--td-text-dim);padding:4px 2px;'>暂无 MVU 加精记录</div>"
        : gv.mvuItems.map((it) => `
            <div class='td-storage-row'>
              <span style='flex:1;min-width:0;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='${escapeHtml(it.chatKey)}'>${escapeHtml(it.chatKey)} (${it.count} 项 · ${formatByteSize(it.bytes)})</span>
              <button type='button' class='td-btn sm danger' data-action='storage-clear-mvu-chat' data-chat-key='${escapeHtml(it.chatKey)}'>清除</button>
            </div>`).join('');

      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>${ICONS.database} 存储空间管理</div>
            <div style='display:flex;gap:4px;'>
              <button class='td-icon-btn' data-action='storage-refresh' title='刷新统计'>${ICONS.refresh}</button>
              <button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button>
            </div>
          </div>
          <div class='td-modal-body'>
            <div class='td-storage-card'>
              <div class='td-storage-card-head'>
                <span>脚本持久化总占用：<strong>${formatByteSize(d.grandTotalBytes)}</strong></span>
                <button type='button' class='td-btn sm primary' data-action='storage-export-backup'>${ICONS.download} 清理前备份</button>
              </div>
              <div class='td-storage-desc'>
                浏览器本地存储总计：${formatByteSize(ls.originTotalBytes)} / ~5MB（本插件占 ${formatByteSize(ls.tdTotalBytes)}，${tdLsPct}%；酒馆与其他扩展占 ${formatByteSize(ls.otherBytes)}）
              </div>
              <div class='td-storage-bar' title='源站 localStorage 占用比例 ${originPct}%'>
                <div class='td-storage-bar-fill is-td' style='width:${tdLsPct}%;'></div>
                <div class='td-storage-bar-fill is-other' style='width:${Math.max(0, originPct - tdLsPct)}%;'></div>
              </div>
              <div style='display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;'>
                ${qc.orphanCount > 0 ? `<button type='button' class='td-btn sm warn' data-action='storage-clean-orphans'>清理孤儿载荷 (${qc.orphanCount})</button>` : ''}
                ${qc.missingPayloadCount > 0 ? `<button type='button' class='td-btn sm warn' data-action='storage-repair-missing'>修复缺失载荷索引 (${qc.missingPayloadCount})</button>` : ''}
                ${qc.autoUnpinnedCount > 0 ? `<button type='button' class='td-btn sm warn' data-action='storage-clean-auto'>清理自动备份 (${qc.autoUnpinnedCount})</button>` : ''}
                ${qc.fullUnpinnedCount > 0 ? `<button type='button' class='td-btn sm' data-action='storage-slim-all'>全部未置顶快照瘦身 (${qc.fullUnpinnedCount})</button>` : ''}
              </div>
            </div>

            <div class='td-storage-card'>
              <div class='td-storage-card-head'>
                <span>1. 酒馆全局变量 (${escapeHtml(gv.key)})</span>
                <span class='td-mode-tag multi'>${formatByteSize(gv.totalBytes)}</span>
              </div>
              <div class='td-storage-desc'>保存于酒馆后端全局配置中，会随配置导出同步。</div>
              <div class='td-storage-sublist'>
                <div class='td-storage-row'>
                  <span style='flex:1;font-size:12.5px;'>方案与分组配置 (${gv.schemeCount} 个方案)</span>
                  <span class='td-src-badge'>${formatByteSize(gv.schemesBytes)}</span>
                </div>
                <div class='td-storage-row'>
                  <span style='flex:1;font-size:12.5px;'>外观与界面设置${gv.hasOrbImage ? `（含悬浮球图标 ${formatByteSize(gv.orbImageBytes)}）` : ''}</span>
                  <span class='td-src-badge'>${formatByteSize(gv.settingsBytes)}</span>
                  ${gv.hasOrbImage ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-orb-img'>清除图标</button>` : ''}
                </div>
                <div class='td-storage-row'>
                  <span style='flex:1;font-size:12.5px;'>快照轻量索引元数据 (${gv.snapshotCount} 条)</span>
                  <span class='td-src-badge'>${formatByteSize(gv.snapshotsMetaBytes)}</span>
                </div>
                <details class='td-attr-diff-box' ${m.mvuOpen ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='mvuOpen'>
                    <span>MVU 加精记录 (${gv.mvuItems.length} 个聊天 · ${formatByteSize(gv.mvuBytes)})</span>
                    ${gv.mvuItems.length > 0 ? `<button type='button' class='td-btn sm danger' onclick='event.stopPropagation()' data-action='storage-clear-mvu-all'>清空全部</button>` : ''}
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;border-top:1px solid var(--td-border);'>${mvuRowsHtml}</div>
                </details>
              </div>
            </div>

            <div class='td-storage-card'>
              <div class='td-storage-card-head'>
                <span>2. 浏览器本地存储 (localStorage)</span>
                <span class='td-mode-tag single'>${formatByteSize(ls.tdTotalBytes)}</span>
              </div>
              <div class='td-storage-desc'>仅存当前浏览器本地，不拖慢酒馆全局变量读写。</div>
              <div class='td-storage-sublist'>
                <details class='td-attr-diff-box' ${m.payloadsOpen !== false ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='payloadsOpen'>
                    <span>完整快照载荷 (${ls.payloadItems.length} 项 · ${formatByteSize(ls.payloadsTotalBytes)})</span>
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;max-height:220px;overflow-y:auto;border-top:1px solid var(--td-border);'>${payloadRowsHtml}</div>
                </details>

                <div class='td-storage-row'>
                  <div style='flex:1;min-width:0;'>
                    <div style='font-size:12.5px;font-weight:700;'>对比缝合草稿 (${formatByteSize(ls.draftsTotalBytes)})</div>
                    <div style='font-size:11px;color:var(--td-text-muted);'>
                      ${ls.presetDraft ? `预设: ${escapeHtml(ls.presetDraft.title)} (${formatByteSize(ls.presetDraft.bytes)})` : '无预设草稿'}
                      ·
                      ${ls.wbDraft ? `世界书: ${escapeHtml(ls.wbDraft.title)} (${formatByteSize(ls.wbDraft.bytes)})` : '无世界书草稿'}
                    </div>
                  </div>
                  <div style='display:flex;gap:4px;flex-shrink:0;'>
                    ${ls.presetDraft ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-draft' data-kind='preset'>清预设</button>` : ''}
                    ${ls.wbDraft ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-draft' data-kind='worldbook'>清世界书</button>` : ''}
                    ${ls.draftsTotalBytes > 0 ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-all-drafts'>全清</button>` : ''}
                  </div>
                </div>

                <div class='td-storage-row'>
                  <span style='flex:1;font-size:12px;color:var(--td-text-muted);'>同源其他数据（酒馆与其他插件 ${ls.otherKeyCount} 项）</span>
                  <span class='td-src-badge'>${formatByteSize(ls.otherBytes)}</span>
                </div>
              </div>
            </div>

            <div class='td-storage-card'>
              <div class='td-storage-card-head'>
                <span>3. 运行时内存缓存 (Memory)</span>
                <span class='td-mode-tag ok'>临时</span>
              </div>
              <div class='td-storage-sublist'>
                <div class='td-storage-row'>
                  <span style='flex:1;font-size:12.5px;'>运行日志缓冲区 (${mem.devLogCount} / 200 条)</span>
                  <button type='button' class='td-btn sm' data-action='open-logs'>查看</button>
                  <button type='button' class='td-btn sm danger' data-action='storage-clear-logs'>清空</button>
                </div>
                <div class='td-storage-row'>
                  <span style='flex:1;font-size:12.5px;'>AI 拉取的模型列表缓存 (${mem.aiCacheEndpoints} 个接口 · ${formatByteSize(mem.aiCacheBytes)})</span>
                  <button type='button' class='td-btn sm danger' data-action='storage-clear-ai-cache' ${mem.aiCacheEndpoints === 0 ? 'disabled' : ''}>清空</button>
                </div>
              </div>
            </div>
          </div>
          <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>关闭</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'logs') {
      const levelFilter = m.filter || 'ALL';
      const allLogs = getDevLogs('ALL');
      const logs = getDevLogs(levelFilter);

      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.code} 运行日志 (${allLogs.length})</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-filter-bar'>
              <button class='td-chip ${levelFilter === 'ALL' ? 'active' : ''}' data-action='logs-set-filter' data-filter='ALL'>全部 (${allLogs.length})</button>
              <button class='td-chip ${levelFilter === 'ERR' ? 'active' : ''}' data-action='logs-set-filter' data-filter='ERR'>错误</button>
              <button class='td-chip ${levelFilter === 'WARN' ? 'active' : ''}' data-action='logs-set-filter' data-filter='WARN'>警告</button>
              <button class='td-chip ${levelFilter === 'INFO' ? 'active' : ''}' data-action='logs-set-filter' data-filter='INFO'>信息</button>
            </div>
            <div style='display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;'>
              <button class='td-btn sm' data-action='logs-refresh'>${ICONS.refresh} 刷新</button>
              <button class='td-btn sm' data-action='logs-copy'>${ICONS.copy} 复制</button>
              <button class='td-btn sm primary' data-action='logs-export'>${ICONS.download} 导出 (.txt)</button>
              <button class='td-btn sm danger' data-action='logs-clear'>清空</button>
            </div>
            <div class='td-picker-list td-scroll'>
              ${logs.length === 0
                ? "<div class='td-group-empty'>当前筛选下暂无日志记录</div>"
                : logs.map((l) => {
                    const cls = l.level === 'ERR' ? 'is-err' : (l.level === 'WARN' ? 'is-warn' : 'is-info');
                    return `<div class='td-log-row ${cls}'><span class='td-log-badge'>${escapeHtml(l.level)}</span><span>[${escapeHtml(l.time)}] ${escapeHtml(l.message)}</span></div>`;
                  }).join('')}
            </div>
          </div>
          <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>关闭</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    if (m.type === 'ioCenter') {
      const pool = ensureSchemesPool(), snaps = state.store.snapshots || [];
      const schemeChecks = pool.map((s) => `<button type='button' class='td-check-pill ${m.selectedSchemeIds.has(s.id) ? 'on' : ''}' data-action='toggle-io-scheme' data-scheme-id='${escapeHtml(s.id)}'>${escapeHtml(s.name)}</button>`).join('');
      const imp = m.importPreview;
      const importBoxHtml = imp ? `
        <div class='td-field' style='padding:10px;border-radius:11px;background:var(--td-surface);border:1px solid var(--td-accent);'>
          <div style='font-size:13px;font-weight:700;'>解析成功：${Array.isArray(imp.schemes) ? imp.schemes.length : 0} 个方案 · ${Array.isArray(imp.snapshots) ? imp.snapshots.length : 0} 个快照 · ${imp.settings ? '含外观设置' : '不含设置'}</div>
          <div class='td-check-pills'>
            ${Array.isArray(imp.schemes) ? `<button type='button' class='td-check-pill ${m.impSchemes ? 'on' : ''}' data-action='toggle-io-imp-opt' data-key='impSchemes'>导入方案</button>` : ''}
            ${Array.isArray(imp.snapshots) ? `<button type='button' class='td-check-pill ${m.impSnapshots ? 'on' : ''}' data-action='toggle-io-imp-opt' data-key='impSnapshots'>导入快照</button>` : ''}
            ${imp.settings ? `<button type='button' class='td-check-pill ${m.impSettings ? 'on' : ''}' data-action='toggle-io-imp-opt' data-key='impSettings'>导入设置</button>` : ''}
          </div>
          <div class='td-seg-grid'>
            <button type='button' class='td-seg-card ${m.impMode === 'merge' ? 'active' : ''}' data-action='set-io-imp-mode' data-mode='merge'><div class='td-seg-title'>合并导入</div><div class='td-seg-desc'>保留现有数据并追加</div></button>
            <button type='button' class='td-seg-card single-card ${m.impMode === 'overwrite' ? 'active' : ''}' data-action='set-io-imp-mode' data-mode='overwrite'><div class='td-seg-title'>覆盖导入</div><div class='td-seg-desc'>替换所选分类旧数据</div></button>
          </div>
          <button type='button' class='td-btn primary' data-action='confirm-io-import'>执行导入</button>
        </div>` : '';

      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>导入与导出中心</div><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div>
          <div class='td-modal-body'>
            <div class='td-field' style='padding:11px;border-radius:12px;background:var(--td-surface);border:1px solid var(--td-border-strong);'>
              <label class='td-label'>导出备份（全部或局部勾选）</label>
              <div style='display:flex;gap:8px;flex-wrap:wrap;'><button type='button' class='td-btn primary' data-action='export-all-json'>${ICONS.download} 导出全部数据 (.json)</button></div>
              <span class='td-label' style='margin-top:4px;'>局部导出勾选方案：</span>
              <div class='td-check-pills'>${schemeChecks}</div>
              <div class='td-check-pills'><button type='button' class='td-check-pill ${m.expSnapshots ? 'on' : ''}' data-action='toggle-io-exp-opt' data-key='expSnapshots'>包含快照 (${snaps.length})</button><button type='button' class='td-check-pill ${m.expSettings ? 'on' : ''}' data-action='toggle-io-exp-opt' data-key='expSettings'>包含外观与习惯设置</button></div>
              <button type='button' class='td-btn' data-action='export-partial-json'>${ICONS.download} 导出所选局部数据</button>
            </div>
            <div class='td-field' style='padding:11px;border-radius:12px;background:var(--td-surface);border:1px solid var(--td-border-strong);'>
              <label class='td-label'>从文件或 JSON 文本导入</label>
              <div style='display:flex;gap:8px;flex-wrap:wrap;'><button type='button' class='td-btn' data-action='trigger-io-file'>${ICONS.upload} 选择 JSON 文件</button><input type='file' id='td-io-file-input' accept='.json,application/json' style='display:none;' /><button type='button' class='td-btn' data-action='parse-io-text'>解析下方粘贴文本</button></div>
              <textarea class='td-textarea' id='td-io-text-input' style='min-height:90px;' placeholder='也可以直接粘贴备份 JSON 文本后点击「解析」...'>${escapeHtml(m.rawText || '')}</textarea>
            </div>
            ${importBoxHtml}
          </div>
          <div class='td-modal-foot'><button class='td-btn primary' data-action='close-modal'>完成</button></div>
        </div>`;
      uiCtx.syncOverlayBounds();
      return true;
    }

    return false;
  },

  handleClick(e, actionEl, action) {
    const modalLayerEl = uiCtx.getModalLayer();

    if (action === 'open-storage-manager') { state.modal = { type: 'storageManager', payloadsOpen: true, mvuOpen: false }; uiCtx.renderModal(); return true; }
    if (action === 'storage-refresh' && state.modal?.type === 'storageManager') { uiCtx.renderModal(); return true; }
    if (action === 'storage-toggle-sec' && state.modal?.type === 'storageManager') {
      const sec = actionEl.getAttribute('data-sec');
      if (sec === 'payloadsOpen') state.modal.payloadsOpen = state.modal.payloadsOpen === false;
      else if (sec === 'mvuOpen') state.modal.mvuOpen = !state.modal.mvuOpen;
      return true;
    }
    if (action === 'storage-export-backup') {
      downloadJsonFile(exportStoreData({ includeAll: true }), `TavernDeck-全量备份-${new Date().toISOString().slice(0, 10)}.json`);
      notify('success', '已导出全量配置与快照备份');
      return true;
    }
    if (action === 'storage-clear-orb-img') {
      openConfirm({
        title: '清除悬浮球图标确认',
        message: '确定要清除已上传的自定义悬浮球图标并恢复默认图标吗？',
        confirmText: '确认清除',
        onConfirm: () => {
          state.store.settings.orbImage = '';
          saveStore(state.store);
          uiCtx.renderOrb();
          uiCtx.renderModal();
          notify('info', '已清除自定义悬浮球图标');
        },
      });
      return true;
    }
    if (action === 'storage-clear-mvu-chat') {
      const chatKey = actionEl.getAttribute('data-chat-key');
      if (chatKey && clearMvuStarredChat(chatKey)) {
        uiCtx.renderModal();
        notify('info', '已清除该聊天的 MVU 加精记录');
      }
      return true;
    }
    if (action === 'storage-clear-mvu-all') {
      openConfirm({
        title: '清空 MVU 加精记录确认',
        message: '确定要清空所有角色与聊天的 MVU 变量加精记录吗？',
        confirmText: '确认清空',
        onConfirm: () => {
          const cnt = clearAllMvuStarred();
          uiCtx.renderModal();
          notify('info', `已清空 ${cnt} 个聊天的 MVU 加精记录`);
        },
      });
      return true;
    }
    if (action === 'storage-clean-orphans') {
      const cnt = cleanOrphanSnapshotPayloads();
      uiCtx.renderModal();
      notify('success', cnt > 0 ? `已清理 ${cnt} 条孤儿快照载荷` : '没有需要清理的孤儿载荷');
      return true;
    }
    if (action === 'storage-repair-missing') {
      const cnt = repairMissingSnapshotPayloads();
      uiCtx.renderModal();
      notify('success', cnt > 0 ? `已修复 ${cnt} 条缺失载荷的快照索引` : '无需修复');
      return true;
    }
    if (action === 'storage-clean-auto') {
      openConfirm({
        title: '清理自动备份确认',
        message: '确定要删除所有未置顶的自动备份快照吗？（手动创建的快照和已置顶快照不受影响）',
        confirmText: '确认清理',
        onConfirm: () => {
          const cnt = cleanAutoBackupSnapshots();
          uiCtx.renderMain();
          uiCtx.renderModal();
          notify('success', `已清理 ${cnt} 条自动备份快照`);
        },
      });
      return true;
    }
    if (action === 'storage-slim-all') {
      openConfirm({
        title: '批量快照瘦身确认',
        message: '确定要将所有未置顶的完整快照转为轻量开关快照吗？将释放本地浏览器存储空间，保留条目开关状态但不再保留正文与参数备份。',
        confirmText: '确认全部瘦身',
        confirmClass: 'warn',
        onConfirm: () => {
          const cnt = slimAllUnpinnedFullSnapshots();
          uiCtx.renderModal();
          notify('success', `已瘦身 ${cnt} 条完整快照`);
        },
      });
      return true;
    }
    if (action === 'storage-slim-one') {
      const sid = actionEl.getAttribute('data-snap-id');
      if (sid && slimFullSnapshot(sid)) {
        uiCtx.renderModal();
        notify('success', '已将该快照瘦身为开关快照');
      }
      return true;
    }
    if (action === 'storage-del-snap') {
      const sid = actionEl.getAttribute('data-snap-id');
      const isOrphan = actionEl.getAttribute('data-orphan') === '1';
      if (!sid) return true;
      openConfirm({
        title: '删除快照存储确认',
        message: isOrphan ? '确定要删除这条未关联的孤儿载荷吗？' : '确定要永久删除该快照及其完整数据吗？',
        confirmText: '确认删除',
        onConfirm: () => {
          deleteSnapshotPayload(sid);
          if (!isOrphan) {
            state.store.snapshots = (state.store.snapshots || []).filter((s) => s.id !== sid);
            if (state.lastUndoSnapshotId === sid) state.lastUndoSnapshotId = null;
            saveStore(state.store);
            uiCtx.renderMain();
          }
          uiCtx.renderModal();
          notify('info', '已删除快照数据');
        },
      });
      return true;
    }
    if (action === 'storage-clear-draft') {
      const kind = actionEl.getAttribute('data-kind');
      if (kind === 'preset' || kind === 'worldbook') {
        clearMergeDraft(kind);
        uiCtx.renderModal();
        notify('info', `已清除${kind === 'preset' ? '预设' : '世界书'}缝合草稿`);
      }
      return true;
    }
    if (action === 'storage-clear-all-drafts') {
      clearAllMergeDrafts();
      uiCtx.renderModal();
      notify('info', '已清除全部对比缝合草稿');
      return true;
    }
    if (action === 'storage-clear-logs') {
      clearDevLogs();
      uiCtx.renderModal();
      notify('info', '运行日志已清空');
      return true;
    }
    if (action === 'storage-clear-ai-cache') {
      state._aiModelsCache = {};
      uiCtx.renderModal();
      notify('info', '已清空 AI 模型列表内存缓存');
      return true;
    }

    if (action === 'open-logs') { state.modal = { type: 'logs', filter: 'ALL' }; uiCtx.renderModal(); return true; }
    if (action === 'logs-set-filter' && state.modal?.type === 'logs') { state.modal.filter = actionEl.getAttribute('data-filter') || 'ALL'; uiCtx.renderModal(); return true; }
    if (action === 'logs-refresh' && state.modal?.type === 'logs') { uiCtx.renderModal(); return true; }
    if (action === 'logs-clear' && state.modal?.type === 'logs') { clearDevLogs(); uiCtx.renderModal(); return true; }
    if (action === 'logs-copy' && state.modal?.type === 'logs') {
      copyToClipboard(formatLogsReport(state.modal.filter || 'ALL')).then(() => notify('success', '日志已复制到剪贴板')).catch((err) => { logError('复制日志失败', err); notify('error', '复制失败'); });
      return true;
    }
    if (action === 'logs-export' && state.modal?.type === 'logs') {
      const filter = state.modal.filter || 'ALL';
      downloadTextFile(formatLogsReport(filter), `TavernDeck-logs-${new Date().toISOString().slice(0, 10)}.txt`);
      notify('success', '已导出运行日志 (.txt)');
      return true;
    }

    if (action === 'open-io-center') {
      const pool = ensureSchemesPool();
      state.modal = { type: 'ioCenter', selectedSchemeIds: new Set(pool.map((s) => s.id)), expSnapshots: true, expSettings: true, rawText: '', importPreview: null, impSchemes: true, impSnapshots: true, impSettings: true, impMode: 'merge' };
      uiCtx.renderModal();
      return true;
    }
    if (action === 'toggle-io-scheme' && state.modal?.type === 'ioCenter') {
      const sid = actionEl.getAttribute('data-scheme-id'), set = state.modal.selectedSchemeIds;
      if (set.has(sid)) set.delete(sid); else set.add(sid);
      actionEl.classList.toggle('on', set.has(sid));
      return true;
    }
    if (action === 'toggle-io-exp-opt' && state.modal?.type === 'ioCenter') { const k = actionEl.getAttribute('data-key'); state.modal[k] = !state.modal[k]; actionEl.classList.toggle('on', !!state.modal[k]); return true; }
    if (action === 'export-all-json') { downloadJsonFile(exportStoreData({ includeAll: true }), `TavernDeck-全量备份-${new Date().toISOString().slice(0, 10)}.json`); notify('success', '已导出全量配置备份'); return true; }
    if (action === 'export-partial-json' && state.modal?.type === 'ioCenter') {
      const ids = Array.from(state.modal.selectedSchemeIds);
      if (ids.length === 0 && !state.modal.expSnapshots && !state.modal.expSettings) { notify('warning', '请至少勾选一项要导出的内容'); return true; }
      downloadJsonFile(exportStoreData({ schemeIds: ids, includeSnapshots: !!state.modal.expSnapshots, includeSettings: !!state.modal.expSettings }), `TavernDeck-局部备份-${new Date().toISOString().slice(0, 10)}.json`);
      notify('success', '已导出局部配置备份');
      return true;
    }
    if (action === 'trigger-io-file' && state.modal?.type === 'ioCenter') { modalLayerEl?.querySelector('#td-io-file-input')?.click(); return true; }
    if (action === 'parse-io-text' && state.modal?.type === 'ioCenter') {
      const ta = modalLayerEl?.querySelector('#td-io-text-input'), txt = ta ? ta.value : state.modal.rawText;
      state.modal.rawText = txt;
      try {
        const parsed = JSON.parse(txt);
        if (!parsed || parsed.app !== APP_NAME) throw new Error('非 TavernDeck 备份格式');
        state.modal.importPreview = parsed; state.modal.impSchemes = Array.isArray(parsed.schemes);
        state.modal.impSnapshots = Array.isArray(parsed.snapshots); state.modal.impSettings = !!parsed.settings;
        uiCtx.renderModal();
      } catch (err) { logWarn('解析导入文本失败', err); notify('error', `JSON 解析失败: ${err.message || err}`); }
      return true;
    }
    if (action === 'toggle-io-imp-opt' && state.modal?.type === 'ioCenter') { const k = actionEl.getAttribute('data-key'); state.modal[k] = !state.modal[k]; actionEl.classList.toggle('on', !!state.modal[k]); return true; }
    if (action === 'set-io-imp-mode' && state.modal?.type === 'ioCenter') { state.modal.impMode = actionEl.getAttribute('data-mode') === 'overwrite' ? 'overwrite' : 'merge'; uiCtx.renderModal(); return true; }
    if (action === 'confirm-io-import' && state.modal?.type === 'ioCenter') {
      const m = state.modal; if (!m.importPreview) return true;
      openConfirm({
        title: '确认导入配置', message: `将以「${m.impMode === 'overwrite' ? '覆盖模式' : '合并模式'}」导入所选配置数据，是否继续？`,
        confirmText: '确认导入', confirmClass: m.impMode === 'overwrite' ? 'danger' : 'primary',
        onConfirm: () => {
          try {
            importStoreData(m.importPreview, { mode: m.impMode, importSchemes: !!m.impSchemes, importSnapshots: !!m.impSnapshots, importSettings: !!m.impSettings });
            state.modal = null; uiCtx.renderModal(); uiCtx.renderOrb(); uiCtx.syncExtensionButton(); uiCtx.syncTopBarUI(); syncNativePresetCollapse(); syncNativeToastHook(); uiCtx.renderMain(); notify('success', '配置导入成功');
          } catch (err) { logError('执行导入配置失败', err); notify('error', `导入失败: ${err.message || err}`); }
        },
      });
      return true;
    }

    return false;
  },

  handleInput(e) {
    const target = e.target;
    if (!target) return false;
    if (target.id === 'td-io-text-input' && state.modal?.type === 'ioCenter') {
      state.modal.rawText = target.value;
      return true;
    }
    return false;
  },

  handleChange(e) {
    const target = e.target;
    if (!target) return false;
    if (target.id === 'td-io-file-input' && state.modal?.type === 'ioCenter') {
      const file = target.files?.[0]; if (!file) return true;
      file.text().then((txt) => {
        state.modal.rawText = txt;
        const parsed = JSON.parse(txt);
        if (!parsed || parsed.app !== APP_NAME) throw new Error('非 TavernDeck 备份文件');
        state.modal.importPreview = parsed; state.modal.impSchemes = Array.isArray(parsed.schemes);
        state.modal.impSnapshots = Array.isArray(parsed.snapshots); state.modal.impSettings = !!parsed.settings;
        uiCtx.renderModal();
      }).catch((err) => { logError('读取导入文件失败', err); notify('error', `读取文件失败: ${err.message || err}`); });
      return true;
    }
    return false;
  },
};
