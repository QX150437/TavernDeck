import {
  APP_NAME, escapeHtml, notify, copyToClipboard, downloadTextFile,
  downloadJsonFile, logWarn, logError,
} from './utils.js';
import {
  state, saveStore, clearMergeDraft, clearAllMergeDrafts, ensureSchemesPool,
  exportStoreData, importStoreData, deleteSnapshotPayload,
  getStorageDiagnostics, cleanOrphanSnapshotPayloads, repairMissingSnapshotPayloads,
  clearMvuStarredChat, clearAllMvuStarred, cleanAutoBackupSnapshots,
  clearAiEditDraftItem, clearAllAiEditDrafts,
  deleteAiInstructionTemplate, clearAiInstructionTemplates,
  deleteQuickTemplate, clearQuickTemplates,
  clearIgnoredPresetVarsItem, clearAllIgnoredPresetVars,
  migrateLocalSnapshotsToBackend,
  flushBackendLogQueue, getBackendLogDayDetail, deleteBackendLogDay, clearAllBackendLogDays,
} from './store.js';
import { syncNativePresetCollapse, syncNativeToastHook } from './native-ui.js';
import { getDevLogs, clearDevLogs, formatLogsReport, formatSingleLogReport, formatDayLogsReport } from './dev-tools.js';
import { ICONS, uiCtx, formatByteSize, openConfirm } from './ui-common.js';

export const toolsUiModule = {
  renderModal(m, modalLayerEl) {
    if (m.type === 'storageManager') {
      const devLogCount = getDevLogs('ALL').length;
      const d = getStorageDiagnostics(devLogCount);
      const ls = d.localStorage;
      const bk = d.backend;
      const gv = d.globalVar;
      const mem = d.memory;
      const qc = d.quickCounts;
      const originPct = Math.min(100, Math.round((ls.originTotalBytes / ls.quotaEstimateBytes) * 100));
      const tdLsPct = Math.min(100, Math.round((ls.tdTotalBytes / ls.quotaEstimateBytes) * 100));

      const backendRowsHtml = bk.items.length === 0
        ? "<div class='td-group-empty'>暂无酒馆后端快照文件</div>"
        : bk.items.map((it) => `
            <div class='td-storage-row'>
              <div style='min-width:0;flex:1;'>
                <div style='display:flex;align-items:center;gap:5px;flex-wrap:wrap;'>
                  <span style='font-weight:700;font-size:12.5px;word-break:break-word;'>${escapeHtml(it.name)}</span>
                  <span class='td-src-badge'>${it.kind === 'worldbook' ? '世界书' : '预设'}</span>
                  ${it.auto ? "<span class='td-mode-tag single'>自动</span>" : ''}
                  ${it.pinned ? "<span class='td-mode-tag ok'>置顶</span>" : ''}
                </div>
                <div style='font-size:11px;color:var(--td-text-muted);margin-top:2px;word-break:break-all;'>${escapeHtml(it.fileName)}${it.bytes > 0 ? ` · ${formatByteSize(it.bytes)}` : ''}</div>
              </div>
              <div style='display:flex;gap:4px;flex-shrink:0;'>
                <button type='button' class='td-btn sm danger' data-action='storage-del-snap' data-snap-id='${escapeHtml(it.id)}' data-orphan='0' title='删除后端文件与快照记录'>删除</button>
              </div>
            </div>`).join('');

      const backendLogRowsHtml = bk.logItems.length === 0
        ? "<div class='td-group-empty'>暂无警告/错误日志存档</div>"
        : bk.logItems.map((it) => `
            <div class='td-storage-row'>
              <div class='td-storage-info'>
                <div class='td-storage-head-row'>
                  <span class='td-storage-title'>${escapeHtml(it.date)}</span>
                  ${it.errCount > 0 ? `<span class='td-mode-tag del'>错误 ${it.errCount}</span>` : ''}
                  ${it.warnCount > 0 ? `<span class='td-mode-tag single'>警告 ${it.warnCount}</span>` : ''}
                  <span class='td-src-badge'>共 ${it.count} 条${it.bytes > 0 ? ` · ${formatByteSize(it.bytes)}` : ''}</span>
                </div>
                <div class='td-storage-sub'>${escapeHtml(it.fileName)}</div>
              </div>
              <div class='td-storage-actions'>
                <button type='button' class='td-btn sm primary' data-action='storage-view-log-day' data-date='${escapeHtml(it.date)}'>查看</button>
                <button type='button' class='td-btn sm danger' data-action='storage-del-log-day' data-date='${escapeHtml(it.date)}'>删除</button>
              </div>
            </div>`).join('');

      const payloadRowsHtml = ls.payloadItems.length === 0
        ? ''
        : ls.payloadItems.map((it) => `
            <div class='td-storage-row'>
              <div class='td-storage-info'>
                <div class='td-storage-head-row'>
                  <span class='td-storage-title'>${escapeHtml(it.name)}</span>
                  ${it.orphan ? "<span class='td-mode-tag del'>孤儿</span>" : `<span class='td-src-badge'>${it.kind === 'worldbook' ? '世界书' : '预设'}</span>`}
                  ${it.auto ? "<span class='td-mode-tag single'>自动</span>" : ''}
                  ${it.pinned ? "<span class='td-mode-tag ok'>置顶</span>" : ''}
                </div>
                <div class='td-storage-sub'>${escapeHtml(it.targetName)} · 占用 ${formatByteSize(it.bytes)}</div>
              </div>
              <div class='td-storage-actions'>
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

      const aiDraftRowsHtml = gv.aiDraftItems.length === 0
        ? "<div style='font-size:11.5px;color:var(--td-text-dim);padding:4px 2px;'>暂无 AI 编辑指令草稿</div>"
        : gv.aiDraftItems.map((it) => `
            <div class='td-storage-row'>
              <div class='td-storage-info'>
                <div class='td-storage-title'>${escapeHtml(it.label)}</div>
                <div class='td-storage-sub'>指令 ${it.instructionLen} 字 · 待编辑 ${it.selectedCount} 项 · 参考 ${it.refCount} 项 · ${formatByteSize(it.bytes)}</div>
              </div>
              <button type='button' class='td-btn sm danger' data-action='storage-clear-ai-draft' data-draft-key='${escapeHtml(it.draftKey)}'>清除</button>
            </div>`).join('');

      const aiTplRowsHtml = gv.aiTplsItems.length === 0
        ? "<div style='font-size:11.5px;color:var(--td-text-dim);padding:4px 2px;'>暂无 AI 指令模板</div>"
        : gv.aiTplsItems.map((it) => `
            <div class='td-storage-row'>
              <div class='td-storage-info'>
                <div class='td-storage-title'>${escapeHtml(it.name)}</div>
                <div class='td-storage-sub'>${escapeHtml(it.contentPreview || '（空内容）')} · ${formatByteSize(it.bytes)}</div>
              </div>
              <button type='button' class='td-btn sm danger' data-action='storage-del-ai-tpl' data-tpl-id='${escapeHtml(it.id)}'>删除</button>
            </div>`).join('');

      const quickTplRowsHtml = gv.quickTplsItems.length === 0
        ? "<div style='font-size:11.5px;color:var(--td-text-dim);padding:4px 2px;'>暂无快捷插入自定义模板</div>"
        : gv.quickTplsItems.map((it) => `
            <div class='td-storage-row'>
              <div class='td-storage-info'>
                <div class='td-storage-title'>${escapeHtml(it.name)}</div>
                <div class='td-storage-sub'>${escapeHtml(it.contentPreview || '（空内容）')} · ${formatByteSize(it.bytes)}</div>
              </div>
              <button type='button' class='td-btn sm danger' data-action='storage-del-quick-tpl' data-tpl-id='${escapeHtml(it.id)}'>删除</button>
            </div>`).join('');

      const ignoredVarRowsHtml = gv.ignoredVarItems.length === 0
        ? "<div style='font-size:11.5px;color:var(--td-text-dim);padding:4px 2px;'>暂无变量检测忽略记录</div>"
        : gv.ignoredVarItems.map((it) => `
            <div class='td-storage-row'>
              <span style='flex:1;min-width:0;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='${escapeHtml(it.presetKey)}'>${escapeHtml(it.presetKey)} (${it.varCount} 变量 / ${it.entryCount} 条目 · ${formatByteSize(it.bytes)})</span>
              <button type='button' class='td-btn sm danger' data-action='storage-clear-ignored-var' data-preset-key='${escapeHtml(it.presetKey)}'>清除</button>
            </div>`).join('');

      const aiCacheRowsHtml = mem.aiCacheItems.length === 0
        ? "<div style='font-size:11.5px;color:var(--td-text-dim);padding:4px 2px;'>暂无 AI 模型列表缓存</div>"
        : mem.aiCacheItems.map((it) => `
            <div class='td-storage-row'>
              <span style='flex:1;min-width:0;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='${escapeHtml(it.label)}'>${escapeHtml(it.label)} (${it.modelCount} 个模型 · ${formatByteSize(it.bytes)})</span>
              <button type='button' class='td-btn sm danger' data-action='storage-del-ai-cache-item' data-api-key='${escapeHtml(it.apiKey)}'>清除</button>
            </div>`).join('');

      const extraBookRowsHtml = mem.extraLoadedBooks.length === 0
        ? "<div style='font-size:11.5px;color:var(--td-text-dim);padding:4px 2px;'>暂无已临时加载的未绑定世界书</div>"
        : mem.extraLoadedBooks.map((bookName) => `
            <div class='td-storage-row'>
              <span style='flex:1;min-width:0;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='${escapeHtml(bookName)}'>${escapeHtml(bookName)}</span>
              <button type='button' class='td-btn sm danger' data-action='storage-del-extra-book' data-book-name='${escapeHtml(bookName)}'>移除</button>
            </div>`).join('');

      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'>
            <div class='td-modal-title'>${ICONS.database} 存储空间管理</div>
            <div class='td-modal-head-actions'>
              <button class='td-icon-btn' data-action='storage-refresh' title='刷新统计'>${ICONS.refresh}</button>
              <button class='td-icon-btn' data-action='open-help' data-help-key='storageManager' title='功能说明'>${ICONS.help}</button>
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
                <div class='td-storage-row'>
                  <span style='flex:1;font-size:12.5px;'>后端日志按天索引 (${gv.backendLogMetaCount} 天)</span>
                  <span class='td-src-badge'>${formatByteSize(gv.backendLogMetaBytes)}</span>
                </div>
                <details class='td-attr-diff-box' ${m.aiTplsOpen ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='aiTplsOpen'>
                    <span>AI 指令模板 (${gv.aiTplsCount} 条 · ${formatByteSize(gv.aiTplsBytes)})</span>
                    ${gv.aiTplsCount > 0 ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-ai-tpls'>清空全部</button>` : ''}
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;max-height:200px;overflow-y:auto;border-top:1px solid var(--td-border);'>${aiTplRowsHtml}</div>
                </details>
                <details class='td-attr-diff-box' ${m.quickTplsOpen ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='quickTplsOpen'>
                    <span>快捷插入自定义模板 (${gv.quickTplsCount} 条 · ${formatByteSize(gv.quickTplsBytes)})</span>
                    ${gv.quickTplsCount > 0 ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-quick-tpls'>清空全部</button>` : ''}
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;max-height:200px;overflow-y:auto;border-top:1px solid var(--td-border);'>${quickTplRowsHtml}</div>
                </details>
                <details class='td-attr-diff-box' ${m.aiDraftsOpen ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='aiDraftsOpen'>
                    <span>AI 编辑指令与勾选草稿 (${gv.aiDraftItems.length} 项 · ${formatByteSize(gv.aiDraftsBytes)})</span>
                    ${gv.aiDraftItems.length > 0 ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-ai-drafts-all'>清空全部</button>` : ''}
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;max-height:200px;overflow-y:auto;border-top:1px solid var(--td-border);'>${aiDraftRowsHtml}</div>
                </details>
                <details class='td-attr-diff-box' ${m.ignoredVarsOpen ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='ignoredVarsOpen'>
                    <span>变量检测忽略记录 (${gv.ignoredVarItems.length} 个预设 · ${formatByteSize(gv.ignoredVarsBytes)})</span>
                    ${gv.ignoredVarItems.length > 0 ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-ignored-vars-all'>清空全部</button>` : ''}
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;max-height:180px;overflow-y:auto;border-top:1px solid var(--td-border);'>${ignoredVarRowsHtml}</div>
                </details>
                <details class='td-attr-diff-box' ${m.mvuOpen ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='mvuOpen'>
                    <span>MVU 加精记录 (${gv.mvuItems.length} 个聊天 · ${formatByteSize(gv.mvuBytes)})</span>
                    ${gv.mvuItems.length > 0 ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-mvu-all'>清空全部</button>` : ''}
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;border-top:1px solid var(--td-border);'>${mvuRowsHtml}</div>
                </details>
                ${gv.otherExtBytes > 0 ? `
                  <div class='td-storage-row'>
                    <span style='flex:1;font-size:12.5px;'>其他扩展字段 (${escapeHtml(gv.otherExtKeys.join(', '))})</span>
                    <span class='td-src-badge'>${formatByteSize(gv.otherExtBytes)}</span>
                  </div>` : ''}
              </div>
            </div>

            <div class='td-storage-card'>
              <div class='td-storage-card-head'>
                <span>2. 酒馆后端文件 (users/files/)</span>
                <span class='td-mode-tag ok'>${formatByteSize(bk.totalBytes)}</span>
              </div>
              <div class='td-storage-desc'>完整快照与按天分类的警告/错误日志保存于酒馆服务端文件夹，不占浏览器配额。</div>
              <div class='td-storage-sublist'>
                <details class='td-attr-diff-box' ${m.backendOpen !== false ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='backendOpen'>
                    <span>快照文件列表 (${bk.items.length} 个 · ${formatByteSize(bk.snapTotalBytes)})</span>
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;max-height:220px;overflow-y:auto;border-top:1px solid var(--td-border);'>${backendRowsHtml}</div>
                </details>
                <details class='td-attr-diff-box' ${m.logsOpen !== false ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='logsOpen'>
                    <span>警告/错误日志存档 (按天 · ${bk.logItems.length} 天 · ${formatByteSize(bk.logTotalBytes)})</span>
                    ${bk.logItems.length > 0 ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-all-logs-backend'>清空全部</button>` : ''}
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;max-height:220px;overflow-y:auto;border-top:1px solid var(--td-border);'>${backendLogRowsHtml}</div>
                </details>
              </div>
            </div>

            <div class='td-storage-card'>
              <div class='td-storage-card-head'>
                <span>3. 浏览器本地存储 (localStorage)</span>
                <span class='td-mode-tag single'>${formatByteSize(ls.tdTotalBytes)}</span>
              </div>
              <div class='td-storage-desc'>仅存轻量的对比缝合草稿以防意外刷新丢失；如有旧版本地快照可迁移至后端。</div>
              <div class='td-storage-sublist'>
                ${ls.payloadItems.length > 0 ? `
                  <details class='td-attr-diff-box' ${m.payloadsOpen ? 'open' : ''}>
                    <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='payloadsOpen'>
                      <span>旧版遗留本地快照 (${ls.payloadItems.length} 项 · ${formatByteSize(ls.payloadsTotalBytes)})</span>
                      ${bk.available ? `<button type='button' class='td-btn sm primary' data-action='storage-migrate-local'>迁至后端</button>` : ''}
                    </summary>
                    <div class='td-storage-sublist' style='padding:6px;max-height:200px;overflow-y:auto;border-top:1px solid var(--td-border);'>${payloadRowsHtml}</div>
                  </details>` : ''}

                <div class='td-storage-row'>
                  <div class='td-storage-info'>
                    <div class='td-storage-head-row'>
                      <span class='td-storage-title'>对比缝合草稿</span>
                      <span class='td-src-badge'>${formatByteSize(ls.draftsTotalBytes)}</span>
                    </div>
                    <div class='td-storage-sub'>
                      <div>预设：${ls.presetDraft ? `${escapeHtml(ls.presetDraft.title)} (${formatByteSize(ls.presetDraft.bytes)})` : '无草稿'}</div>
                      <div>世界书：${ls.wbDraft ? `${escapeHtml(ls.wbDraft.title)} (${formatByteSize(ls.wbDraft.bytes)})` : '无草稿'}</div>
                    </div>
                  </div>
                  ${ls.draftsTotalBytes > 0 ? `
                    <div class='td-storage-actions'>
                      ${ls.presetDraft ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-draft' data-kind='preset'>清预设</button>` : ''}
                      ${ls.wbDraft ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-draft' data-kind='worldbook'>清世界书</button>` : ''}
                      <button type='button' class='td-btn sm danger' data-action='storage-clear-all-drafts'>全清</button>
                    </div>` : ''}
                </div>

                <div class='td-storage-row'>
                  <div class='td-storage-info'>
                    <div class='td-storage-title' style='font-weight:600;color:var(--td-text-muted);'>同源其他数据</div>
                    <div class='td-storage-sub'>酒馆与其他扩展（共 ${ls.otherKeyCount} 项）</div>
                  </div>
                  <div class='td-storage-actions'>
                    <span class='td-src-badge'>${formatByteSize(ls.otherBytes)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class='td-storage-card'>
              <div class='td-storage-card-head'>
                <span>4. 运行时内存缓存 (Memory)</span>
                <span class='td-mode-tag ok'>临时</span>
              </div>
              <div class='td-storage-sublist'>
                <div class='td-storage-row'>
                  <span style='flex:1;font-size:12.5px;'>运行日志与操作轨迹 (${mem.devLogCount} / 200 条 · ${mem.opStepCount} 步 · ${formatByteSize(mem.devLogBytes)})</span>
                  <button type='button' class='td-btn sm' data-action='open-logs'>查看</button>
                  <button type='button' class='td-btn sm danger' data-action='storage-clear-logs'>清空</button>
                </div>
                ${mem.pendingBackendLogCount > 0 ? `
                  <div class='td-storage-row'>
                    <span style='flex:1;font-size:12.5px;'>待写入后端日志队列 (${mem.pendingBackendLogCount} 条)</span>
                    <button type='button' class='td-btn sm primary' data-action='storage-refresh'>立即写入</button>
                  </div>` : ''}
                <details class='td-attr-diff-box' ${m.aiCacheOpen ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='aiCacheOpen'>
                    <span>AI 拉取的模型列表缓存 (${mem.aiCacheEndpoints} 个接口 · ${formatByteSize(mem.aiCacheBytes)})</span>
                    ${mem.aiCacheEndpoints > 0 ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-ai-cache'>清空全部</button>` : ''}
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;max-height:180px;overflow-y:auto;border-top:1px solid var(--td-border);'>${aiCacheRowsHtml}</div>
                </details>
                <details class='td-attr-diff-box' ${m.extraBooksOpen ? 'open' : ''}>
                  <summary class='td-attr-diff-head' data-action='storage-toggle-sec' data-sec='extraBooksOpen'>
                    <span>已临时加载未绑定世界书索引 (${mem.extraLoadedBooksCount} 本)</span>
                    ${mem.extraLoadedBooksCount > 0 ? `<button type='button' class='td-btn sm danger' data-action='storage-clear-extra-books'>清空全部</button>` : ''}
                  </summary>
                  <div class='td-storage-sublist' style='padding:6px;max-height:180px;overflow-y:auto;border-top:1px solid var(--td-border);'>${extraBookRowsHtml}</div>
                </details>
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
      const errCount = allLogs.filter((l) => l.level === 'ERR').length;
      const warnCount = allLogs.filter((l) => l.level === 'WARN').length;
      const infoCount = allLogs.filter((l) => l.level === 'INFO').length;
      const logs = getDevLogs(levelFilter);

      modalLayerEl.innerHTML = `
        <div class='td-modal td-modal-tall'>
          <div class='td-modal-head'><div class='td-modal-title'>${ICONS.code} 运行日志 (${allLogs.length})</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='logs' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div>
          <div class='td-modal-body td-picker-body'>
            <div class='td-filter-bar'>
              <button class='td-chip ${levelFilter === 'ALL' ? 'active' : ''}' data-action='logs-set-filter' data-filter='ALL'>全部 (${allLogs.length})</button>
              <button class='td-chip ${levelFilter === 'ERR' ? 'active' : ''}' data-action='logs-set-filter' data-filter='ERR'>错误 (${errCount})</button>
              <button class='td-chip ${levelFilter === 'WARN' ? 'active' : ''}' data-action='logs-set-filter' data-filter='WARN'>警告 (${warnCount})</button>
              <button class='td-chip ${levelFilter === 'INFO' ? 'active' : ''}' data-action='logs-set-filter' data-filter='INFO'>信息 (${infoCount})</button>
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
                : logs.map((l, idx) => {
                    const cls = l.level === 'ERR' ? 'is-err' : (l.level === 'WARN' ? 'is-warn' : 'is-info');
                    const hasExtra = !!(l.step || l.uiContext || l.trail || l.stack);
                    return `
                      <div class='td-log-row ${cls}'>
                        <div class='td-log-head'>
                          <span class='td-log-badge'>${escapeHtml(l.level)}</span>
                          <span class='td-log-main'>[${escapeHtml(l.time)}] ${escapeHtml(l.message)}</span>
                          <button type='button' class='td-btn xs' data-action='logs-copy-one' data-lidx='${idx}' title='复制本条日志'>复制</button>
                        </div>
                        ${(l.uiContext || l.step) ? `<div class='td-log-meta'>${l.uiContext ? `界面：${escapeHtml(l.uiContext)}` : ''}${l.uiContext && l.step ? ' · ' : ''}${l.step ? `步骤：${escapeHtml(l.step)}` : ''}</div>` : ''}
                        ${hasExtra && (l.trail || l.stack) ? `
                          <details class='td-log-details'>
                            <summary>查看操作轨迹与堆栈</summary>
                            <div class='td-log-detail-body'>${l.trail ? `<div><strong>近期步骤：</strong>\n${escapeHtml(l.trail)}</div>` : ''}${l.stack ? `<div style='margin-top:4px;'><strong>调用位置：</strong>\n${escapeHtml(l.stack)}</div>` : ''}</div>
                          </details>` : ''}
                      </div>`;
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
          <div class='td-modal-head'><div class='td-modal-title'>导入与导出中心</div><div class='td-modal-head-actions'><button class='td-icon-btn' data-action='open-help' data-help-key='ioCenter' title='功能说明'>${ICONS.help}</button><button class='td-icon-btn' data-action='close-modal'>${ICONS.close}</button></div></div>
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

  renderPreview(previewLayerEl) {
    const pc = state.previewCtx;
    if (!pc || pc.type !== 'backendLogDay') return false;
    const allLogs = Array.isArray(pc.logs) ? pc.logs.slice().reverse() : [];
    const filter = pc.filter || 'ALL';
    const logs = filter === 'ALL' ? allLogs : allLogs.filter((l) => l.level === filter);
    const errCount = allLogs.filter((l) => l.level === 'ERR').length;
    const warnCount = allLogs.filter((l) => l.level === 'WARN').length;

    previewLayerEl.classList.add('is-open');
    previewLayerEl.innerHTML = `
      <div class='td-modal td-modal-tall'>
        <div class='td-modal-head'>
          <div class='td-modal-title'>${ICONS.code} 后端日志存档 · ${escapeHtml(pc.date)} (${allLogs.length})</div>
          <div class='td-modal-head-actions'>
            <button class='td-icon-btn' data-action='close-preview'>${ICONS.close}</button>
          </div>
        </div>
        <div class='td-modal-body td-picker-body'>
          <div class='td-filter-bar'>
            <button class='td-chip ${filter === 'ALL' ? 'active' : ''}' data-action='storage-log-filter' data-filter='ALL'>全部 (${allLogs.length})</button>
            <button class='td-chip ${filter === 'ERR' ? 'active' : ''}' data-action='storage-log-filter' data-filter='ERR'>错误 (${errCount})</button>
            <button class='td-chip ${filter === 'WARN' ? 'active' : ''}' data-action='storage-log-filter' data-filter='WARN'>警告 (${warnCount})</button>
          </div>
          <div style='display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;'>
            <button class='td-btn sm' data-action='storage-log-copy'>${ICONS.copy} 复制</button>
            <button class='td-btn sm primary' data-action='storage-log-export'>${ICONS.download} 导出 (.txt)</button>
            <button class='td-btn sm danger' data-action='storage-del-log-day' data-date='${escapeHtml(pc.date)}' style='margin-left:auto;'>${ICONS.trash} 删除当日</button>
          </div>
          <div class='td-picker-list td-scroll'>
            ${pc.missing && allLogs.length === 0
              ? "<div class='td-group-empty'>未找到该日期的后端日志文件（可能已被手动删除）</div>"
              : (logs.length === 0
                ? "<div class='td-group-empty'>当前筛选下暂无日志记录</div>"
                : logs.map((l, idx) => {
                    const cls = l.level === 'ERR' ? 'is-err' : 'is-warn';
                    const hasExtra = !!(l.trail || l.stack);
                    return `
                      <div class='td-log-row ${cls}'>
                        <div class='td-log-head'>
                          <span class='td-log-badge'>${escapeHtml(l.level)}</span>
                          <span class='td-log-main'>[${escapeHtml(l.time || '')}] ${escapeHtml(l.message)}</span>
                          <button type='button' class='td-btn xs' data-action='storage-log-copy-one' data-lidx='${idx}' title='复制本条日志'>复制</button>
                        </div>
                        ${(l.uiContext || l.step) ? `<div class='td-log-meta'>${l.uiContext ? `界面：${escapeHtml(l.uiContext)}` : ''}${l.uiContext && l.step ? ' · ' : ''}${l.step ? `步骤：${escapeHtml(l.step)}` : ''}</div>` : ''}
                        ${hasExtra ? `
                          <details class='td-log-details'>
                            <summary>查看操作轨迹与堆栈</summary>
                            <div class='td-log-detail-body'>${l.trail ? `<div><strong>近期步骤：</strong>\n${escapeHtml(l.trail)}</div>` : ''}${l.stack ? `<div style='margin-top:4px;'><strong>调用位置：</strong>\n${escapeHtml(l.stack)}</div>` : ''}</div>
                          </details>` : ''}
                      </div>`;
                  }).join(''))}
          </div>
        </div>
        <div class='td-modal-foot'><button class='td-btn primary' data-action='close-preview'>关闭</button></div>
      </div>`;
    uiCtx.syncOverlayBounds();
    return true;
  },

  handleClick(e, actionEl, action) {
    const modalLayerEl = uiCtx.getModalLayer();

    if (action.startsWith('storage-') && action !== 'storage-toggle-sec' && actionEl.closest('summary')) {
      e.preventDefault();
    }
    if (action === 'open-storage-manager') {
      state.modal = {
        type: 'storageManager',
        backendOpen: true,
        logsOpen: true,
        payloadsOpen: false,
        aiTplsOpen: false,
        quickTplsOpen: false,
        mvuOpen: false,
        aiDraftsOpen: false,
        ignoredVarsOpen: false,
        aiCacheOpen: false,
        extraBooksOpen: false,
      };
      uiCtx.renderModal();
      flushBackendLogQueue().then(() => { if (state.modal?.type === 'storageManager') uiCtx.renderModal(); });
      return true;
    }
    if (action === 'storage-refresh' && state.modal?.type === 'storageManager') {
      flushBackendLogQueue().then(() => { if (state.modal?.type === 'storageManager') uiCtx.renderModal(); });
      return true;
    }
    if (action === 'storage-toggle-sec' && state.modal?.type === 'storageManager') {
      const sec = actionEl.getAttribute('data-sec');
      if (sec === 'backendOpen') state.modal.backendOpen = state.modal.backendOpen === false;
      else if (sec === 'logsOpen') state.modal.logsOpen = state.modal.logsOpen === false;
      else if (sec === 'payloadsOpen') state.modal.payloadsOpen = !state.modal.payloadsOpen;
      else if (sec === 'aiTplsOpen') state.modal.aiTplsOpen = !state.modal.aiTplsOpen;
      else if (sec === 'quickTplsOpen') state.modal.quickTplsOpen = !state.modal.quickTplsOpen;
      else if (sec === 'aiDraftsOpen') state.modal.aiDraftsOpen = !state.modal.aiDraftsOpen;
      else if (sec === 'ignoredVarsOpen') state.modal.ignoredVarsOpen = !state.modal.ignoredVarsOpen;
      else if (sec === 'mvuOpen') state.modal.mvuOpen = !state.modal.mvuOpen;
      else if (sec === 'aiCacheOpen') state.modal.aiCacheOpen = !state.modal.aiCacheOpen;
      else if (sec === 'extraBooksOpen') state.modal.extraBooksOpen = !state.modal.extraBooksOpen;
      return true;
    }
    if (action === 'storage-view-log-day') {
      const date = actionEl.getAttribute('data-date');
      if (!date) return true;
      getBackendLogDayDetail(date).then((res) => {
        state.previewKey = null;
        state.snapshotDetailId = null;
        state.previewCtx = { type: 'backendLogDay', date: res.date, fileName: res.fileName, logs: res.logs, missing: res.missing, filter: 'ALL' };
        uiCtx.renderPreviewModal();
      }).catch((err) => { logError('读取后端日志文件失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'storage-del-log-day') {
      const date = actionEl.getAttribute('data-date');
      if (!date) return true;
      openConfirm({
        title: '删除后端日志存档确认',
        message: `确定要永久删除 ${date} 的警告/错误后端日志文件吗？`,
        confirmText: '确认删除',
        onConfirm: () => {
          deleteBackendLogDay(date).then(() => {
            if (state.previewCtx?.type === 'backendLogDay' && state.previewCtx.date === date) {
              state.previewCtx = null;
              uiCtx.renderPreviewModal();
            }
            if (state.modal?.type === 'storageManager') uiCtx.renderModal();
            notify('info', `已删除 ${date} 的后端日志存档`);
          }).catch((err) => { logError('删除后端日志文件失败', err); notify('error', err.message || String(err)); });
        },
      });
      return true;
    }
    if (action === 'storage-clear-all-logs-backend') {
      openConfirm({
        title: '清空全部后端日志确认',
        message: '确定要永久删除酒馆后端保存的所有按天分类警告/错误日志文件吗？此操作不可撤销。',
        confirmText: '确认清空',
        onConfirm: () => {
          clearAllBackendLogDays().then((cnt) => {
            if (state.previewCtx?.type === 'backendLogDay') {
              state.previewCtx = null;
              uiCtx.renderPreviewModal();
            }
            if (state.modal?.type === 'storageManager') uiCtx.renderModal();
            notify('info', `已清空 ${cnt} 天的后端日志存档`);
          }).catch((err) => { logError('清空后端日志失败', err); notify('error', err.message || String(err)); });
        },
      });
      return true;
    }
    if (action === 'storage-log-filter' && state.previewCtx?.type === 'backendLogDay') {
      state.previewCtx.filter = actionEl.getAttribute('data-filter') || 'ALL';
      uiCtx.renderPreviewModal();
      return true;
    }
    if (action === 'storage-log-copy' && state.previewCtx?.type === 'backendLogDay') {
      const pc = state.previewCtx;
      const ordered = Array.isArray(pc.logs) ? pc.logs.slice().reverse() : [];
      copyToClipboard(formatDayLogsReport(pc.date, ordered, pc.filter || 'ALL'))
        .then(() => notify('success', `${pc.date} 日志已复制到剪贴板`))
        .catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'storage-log-copy-one' && state.previewCtx?.type === 'backendLogDay') {
      const pc = state.previewCtx;
      const all = Array.isArray(pc.logs) ? pc.logs.slice().reverse() : [];
      const filter = pc.filter || 'ALL';
      const list = filter === 'ALL' ? all : all.filter((l) => l.level === filter);
      const item = list[Number(actionEl.getAttribute('data-lidx'))];
      if (!item) return true;
      copyToClipboard(formatSingleLogReport(item))
        .then(() => notify('success', '该条日志已复制'))
        .catch(() => notify('error', '复制失败'));
      return true;
    }
    if (action === 'storage-log-export' && state.previewCtx?.type === 'backendLogDay') {
      const pc = state.previewCtx;
      const ordered = Array.isArray(pc.logs) ? pc.logs.slice().reverse() : [];
      downloadTextFile(formatDayLogsReport(pc.date, ordered, pc.filter || 'ALL'), `TavernDeck-logs-${pc.date}.txt`);
      notify('success', `已导出 ${pc.date} 日志 (.txt)`);
      return true;
    }
    if (action === 'storage-migrate-local') {
      openConfirm({
        title: '迁移本地快照至后端确认',
        message: '确定要将旧版 localStorage 中的完整快照全部上传保存至酒馆后端 (users/files/) 并释放本地 5MB 配额吗？',
        confirmText: '开始迁移',
        confirmClass: 'primary',
        onConfirm: () => {
          migrateLocalSnapshotsToBackend().then(({ migrated, orphansRemoved }) => {
            uiCtx.renderModal();
            notify('success', `迁移完成：已转移 ${migrated} 条快照到后端${orphansRemoved > 0 ? `，清理 ${orphansRemoved} 条孤儿` : ''}`);
          }).catch((err) => { logError('迁移本地快照失败', err); notify('error', err.message || String(err)); });
        },
      });
      return true;
    }
    if (action === 'storage-export-backup') {
      exportStoreData({ includeAll: true }).then((payload) => {
        downloadJsonFile(payload, `TavernDeck-全量备份-${new Date().toISOString().slice(0, 10)}.json`);
        notify('success', '已导出全量配置与快照备份');
      }).catch((err) => { logError('导出备份失败', err); notify('error', err.message || String(err)); });
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
      openConfirm({
        title: '清理孤儿载荷确认',
        message: '确定要清理未关联任何快照索引的孤儿载荷数据吗？',
        confirmText: '确认清理',
        onConfirm: () => {
          const cnt = cleanOrphanSnapshotPayloads();
          uiCtx.renderModal();
          notify('success', cnt > 0 ? `已清理 ${cnt} 条孤儿快照载荷` : '没有需要清理的孤儿载荷');
        },
      });
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
        message: '确定要删除所有未置顶的自动备份快照及对应酒馆后端文件吗？（手动创建的快照和已置顶快照不受影响）',
        confirmText: '确认清理',
        onConfirm: () => {
          cleanAutoBackupSnapshots().then((cnt) => {
            uiCtx.renderMain();
            uiCtx.renderModal();
            notify('success', `已清理 ${cnt} 条自动备份快照及后端文件`);
          }).catch((err) => { logError('清理自动备份失败', err); notify('error', err.message || String(err)); });
        },
      });
      return true;
    }
    if (action === 'storage-del-snap') {
      const sid = actionEl.getAttribute('data-snap-id');
      const isOrphan = actionEl.getAttribute('data-orphan') === '1';
      if (!sid) return true;
      const snap = !isOrphan ? (state.store.snapshots || []).find((s) => s.id === sid) : null;
      openConfirm({
        title: '删除后端文件与快照确认',
        message: isOrphan
          ? '确定要删除这条未关联的孤儿载荷吗？'
          : `确定要永久删除快照「${snap?.name || sid}」${snap?.payloadFile ? `及其酒馆后端文件（${snap.payloadFile}）` : ''}吗？此操作不可撤销。`,
        confirmText: '确认删除',
        onConfirm: () => {
          deleteSnapshotPayload(isOrphan ? sid : (snap || sid), { strict: true }).then(() => {
            if (!isOrphan) {
              state.store.snapshots = (state.store.snapshots || []).filter((s) => s.id !== sid);
              if (state.lastUndoSnapshotId === sid) state.lastUndoSnapshotId = null;
              saveStore(state.store);
              uiCtx.renderMain();
            }
            uiCtx.renderModal();
            notify('info', '已删除快照及对应文件');
          }).catch((err) => { logError('删除后端快照文件失败', err); notify('error', `删除失败: ${err.message || err}`); });
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
      notify('info', '运行日志已清空', { skipLog: true });
      return true;
    }
    if (action === 'storage-clear-ai-cache') {
      state._aiModelsCache = {};
      uiCtx.renderModal();
      notify('info', '已清空 AI 模型列表内存缓存');
      return true;
    }
    if (action === 'storage-del-ai-cache-item') {
      const apiKey = actionEl.getAttribute('data-api-key');
      if (apiKey !== null && state._aiModelsCache && Object.prototype.hasOwnProperty.call(state._aiModelsCache, apiKey)) {
        delete state._aiModelsCache[apiKey];
        uiCtx.renderModal();
        notify('info', '已清除该接口的模型列表缓存');
      }
      return true;
    }
    if (action === 'storage-del-extra-book') {
      const bookName = actionEl.getAttribute('data-book-name');
      if (bookName && state.extraLoadedBooks && Object.prototype.hasOwnProperty.call(state.extraLoadedBooks, bookName)) {
        delete state.extraLoadedBooks[bookName];
        uiCtx.renderModal();
        notify('info', `已移除未绑定世界书缓存「${bookName}」`);
      }
      return true;
    }
    if (action === 'storage-clear-extra-books') {
      state.extraLoadedBooks = {};
      uiCtx.renderModal();
      notify('info', '已清空未绑定世界书缓存索引');
      return true;
    }
    if (action === 'storage-clear-ai-draft') {
      const dk = actionEl.getAttribute('data-draft-key');
      if (dk && clearAiEditDraftItem(dk)) {
        uiCtx.renderModal();
        notify('info', '已清除该条目的 AI 编辑草稿');
      }
      return true;
    }
    if (action === 'storage-clear-ai-drafts-all') {
      openConfirm({
        title: '清空 AI 编辑草稿确认',
        message: '确定要清空所有预设与世界书的 AI 编辑指令及勾选草稿吗？',
        confirmText: '确认清空',
        onConfirm: () => {
          const cnt = clearAllAiEditDrafts();
          uiCtx.renderModal();
          notify('info', `已清空 ${cnt} 项 AI 编辑草稿`);
        },
      });
      return true;
    }
    if (action === 'storage-clear-ai-tpls') {
      openConfirm({
        title: '清空 AI 指令模板确认',
        message: '确定要清空所有 AI 编辑常用指令模板吗？',
        confirmText: '确认清空',
        onConfirm: () => {
          const cnt = clearAiInstructionTemplates();
          uiCtx.renderModal();
          notify('info', `已清空 ${cnt} 条 AI 指令模板`);
        },
      });
      return true;
    }
    if (action === 'storage-del-ai-tpl') {
      const tid = actionEl.getAttribute('data-tpl-id');
      if (!tid) return true;
      const tpl = (state.store?.extensions?.aiInstructionTemplates || []).find((t, idx) => String(t?.id || `idx:${idx}`) === tid);
      openConfirm({
        title: '删除 AI 指令模板确认',
        message: `确定要删除 AI 指令模板「${tpl?.name || tid}」吗？`,
        confirmText: '确认删除',
        onConfirm: () => {
          if (deleteAiInstructionTemplate(tid)) {
            uiCtx.renderModal();
            notify('info', `已删除 AI 指令模板「${tpl?.name || tid}」`);
          }
        },
      });
      return true;
    }
    if (action === 'storage-clear-quick-tpls') {
      openConfirm({
        title: '清空快捷插入模板确认',
        message: '确定要清空所有「我的模板」快捷插入自定义模板吗？',
        confirmText: '确认清空',
        onConfirm: () => {
          const cnt = clearQuickTemplates();
          uiCtx.renderModal();
          notify('info', `已清空 ${cnt} 条快捷插入模板`);
        },
      });
      return true;
    }
    if (action === 'storage-del-quick-tpl') {
      const tid = actionEl.getAttribute('data-tpl-id');
      if (!tid) return true;
      const tpl = (state.store?.extensions?.quickTemplates || []).find((t, idx) => String(t?.id || `idx:${idx}`) === tid);
      openConfirm({
        title: '删除快捷插入模板确认',
        message: `确定要删除快捷插入模板「${tpl?.name || tid}」吗？`,
        confirmText: '确认删除',
        onConfirm: () => {
          if (deleteQuickTemplate(tid)) {
            uiCtx.renderModal();
            notify('info', `已删除快捷插入模板「${tpl?.name || tid}」`);
          }
        },
      });
      return true;
    }
    if (action === 'storage-clear-ignored-var') {
      const pk = actionEl.getAttribute('data-preset-key');
      if (pk && clearIgnoredPresetVarsItem(pk)) {
        uiCtx.renderModal();
        notify('info', `已清除预设「${pk}」的变量忽略记录`);
      }
      return true;
    }
    if (action === 'storage-clear-ignored-vars-all') {
      openConfirm({
        title: '清空变量忽略记录确认',
        message: '确定要清空所有预设的变量初始化检测忽略记录吗？',
        confirmText: '确认清空',
        onConfirm: () => {
          const cnt = clearAllIgnoredPresetVars();
          uiCtx.renderModal();
          notify('info', `已清空 ${cnt} 个预设的变量忽略记录`);
        },
      });
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
    if (action === 'logs-copy-one' && state.modal?.type === 'logs') {
      const list = getDevLogs(state.modal.filter || 'ALL');
      const item = list[Number(actionEl.getAttribute('data-lidx'))];
      if (!item) return true;
      copyToClipboard(formatSingleLogReport(item)).then(() => notify('success', '该条日志已复制')).catch((err) => { logError('复制单条日志失败', err); notify('error', '复制失败'); });
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
    if (action === 'export-all-json') {
      exportStoreData({ includeAll: true }).then((payload) => {
        downloadJsonFile(payload, `TavernDeck-全量备份-${new Date().toISOString().slice(0, 10)}.json`);
        notify('success', '已导出全量配置备份');
      }).catch((err) => { logError('导出全部配置失败', err); notify('error', err.message || String(err)); });
      return true;
    }
    if (action === 'export-partial-json' && state.modal?.type === 'ioCenter') {
      const ids = Array.from(state.modal.selectedSchemeIds);
      if (ids.length === 0 && !state.modal.expSnapshots && !state.modal.expSettings) { notify('warning', '请至少勾选一项要导出的内容'); return true; }
      exportStoreData({ schemeIds: ids, includeSnapshots: !!state.modal.expSnapshots, includeSettings: !!state.modal.expSettings }).then((payload) => {
        downloadJsonFile(payload, `TavernDeck-局部备份-${new Date().toISOString().slice(0, 10)}.json`);
        notify('success', '已导出局部配置备份');
      }).catch((err) => { logError('导出局部配置失败', err); notify('error', err.message || String(err)); });
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
          importStoreData(m.importPreview, { mode: m.impMode, importSchemes: !!m.impSchemes, importSnapshots: !!m.impSnapshots, importSettings: !!m.impSettings })
            .then(() => {
              state.modal = null; uiCtx.renderModal(); uiCtx.renderOrb(); uiCtx.syncExtensionButton(); uiCtx.syncTopBarUI(); syncNativePresetCollapse(); syncNativeToastHook(); uiCtx.renderMain(); notify('success', '配置导入成功');
            })
            .catch((err) => { logError('执行导入配置失败', err); notify('error', `导入失败: ${err.message || err}`); });
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
