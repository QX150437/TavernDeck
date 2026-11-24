# TavernDeck（酒馆总控台）AI 开发与架构指南

本项目为 SillyTavern（酒馆）扩展，采用**原生 ES Module**（无 Webpack / Vite / Rollup 等构建步骤），浏览器通过入口 `index.js` 直接按 `./` 相对路径加载模块。

---

## 一、 给后续 AI 的开发铁律（必须严格遵守）

1. **单文件体量控制红线**
   - 单个 JS 模块建议控制在 **400 ~ 800 行** 之间。
   - **禁止向超过 900 行的文件继续堆砌新业务**：若现有文件接近或超过 850 行，必须先按业务域拆出独立子模块后再开发。
   - 避免过度碎片化：全项目维持在 **25 ~ 35 个文件** 区间，避免原生 ESM 请求数过多拖慢加载。

2. **新功能独立建模块 + 注册表接入**
   - 新增独立 UI 业务域时，在 `src/` 下新建 `src/ui-<feature>.js`，导出标准化处理器对象：
     ```js
     export const xxxUiModule = {
       renderModal(m, modalLayerEl) { return false; },
       renderPreview(previewLayerEl) { return false; },
       handleClick(e, actionEl, action) { return false; },
       handleInput(e) { return false; },
       handleChange(e) { return false; },
       confirmDirty(onProceed) { return false; },
     };
     ```
   - 在 `src/ui-app.js` 的 `UI_MODULES` 数组中注册即可，**严禁在 `ui-app.js` 或 `ui-views.js` 中堆叠长 `if / else`**。

3. **严防原生 ES Module 循环依赖（DAG 分层约束）**
   - 依赖流向严格单向向下：
     `utils / dev-tools` -> `store / native-ui` -> `catalog / snapshot / *-manager / *-merge / ai-preset-edit / merge-ui` -> `ui-common (uiCtx)` -> `ui-drag / ui-groups / ui-snapshots / ...` -> `ui-views` -> `ui-app` -> `index.js`
   - **所有 `src/ui-*.js` 业务子模块严禁 `import` `ui-app.js` 或 `ui-views.js`**，也不要互相循环引用（当前仅允许 `ui-mvu.js` 单向复用 `ui-ai-assistant.js` 的共享 API 面板）。
   - 跨模块弹窗刷新、主题重绘、确认框调用统一通过 `src/ui-common.js` 中的 `uiCtx` 桥接对象完成。

4. **保留核心交互与数据兼容底线**
   - 修改弹窗渲染时必须保持与 `renderPreservingFocus`（焦点与滚动位置保留）、`syncOverlayBounds`（视口边界适配）、`confirmDiscardDirtyModal`（未保存退出提醒）、`editHistory`（正文编辑撤销/重做）及 Pointer 触控事件的兼容。
   - 严禁擅自更改 `STORAGE_KEY`（`TavernDeck`）、`SCHEMA_VERSION`（`3`）、`localStorage` 键名及现有 DOM ID / CSS 类名，确保老用户数据无损兼容。

5. **同步更新索引铁律**
   - 每次新增、删除、拆分模块，或新增 `modal.type` / `previewCtx.type` / `data-action` 前缀时，**必须在同一次修改中同步更新本文档下方的「模块索引表」**，保证新开对话时 AI 可以“先看索引、按需读取”。

6. **增量补丁输出格式规范（严格校验语法）**
   - **修改已有文件**：使用指令 `FILE:`（后接路径），配合成对的 `<<<<<<< SEARCH`、`=======`、`>>>>>>> REPLACE` 块；严禁对不存在的文件使用 `FILE:`。
   - **新建文件**：必须使用指令 `CREATE:`（后接路径），正文以 `<<<<<<< CONTENT` 起始、以 `>>>>>>> END` 结束（不可写成 `>>>>>>> CONTENT` 或省略标记）。
   - **整文件重写 / 删除**：分别使用指令 `REWRITE:` / `DELETE:`，避免使用空 `SEARCH` 块代替新建或删除。

7. **版本号与变更日志自动管理规则（SemVer 同步铁律）**
   - **默认自增规则**：遵循 `MAJOR.MINOR.PATCH` 十进制进位。当开发者提需求且**未明确指定目标版本号**时，凡涉及代码功能新增、交互优化或 Bug 修复，完成修改后**自动将最小版本号 `PATCH + 1`**（例如 `1.2.5` → `1.2.6`）；**当末尾 `PATCH` 达到 `10` 时向前进 1**（即 `MINOR + 1`、`PATCH` 归 `0`，例如 `1.2.9` → `1.3.0`；同理当 `MINOR` 达到 `10` 时向 `MAJOR` 进 1，例如 `1.9.9` → `2.0.0`）；若属跨模块大型架构升级，可在答复中建议开发者确认是否手动提升 `MINOR`。
   - **双端同步更新**：每次升级版本号时，**必须同步修改以下两处**（缺一不可）：
     1. `manifest.json` 中的 `"version": "x.y.z"`
     2. `src/utils.js` 中的 `export const APP_VERSION = 'vx.y.z';`
   - **精简变更说明**：在根目录 `CHANGELOG.md` 顶部追加一行简明的版本说明（`- **vx.y.z** (YYYY-MM-DD)` + 1~3 条核心改动要点），并在本次答复末尾附上版本升级摘要；严禁将冗长历史日志直接堆积进 `AI_GUIDE.md`，以保持架构索引精简。

---

## 二、 完整模块索引表

### 1. 入口、样式与底层工具层

| 文件路径 | 约行数 | 职责定位 | 关键导出 | 负责的 `modal` / `previewCtx` / `data-action` |
| :--- | :--- | :--- | :--- | :--- |
| `manifest.json` | ~10 | 酒馆扩展清单元数据 | — | — |
| `CHANGELOG.md` | ~20 | 版本号与精简变更记录 | — | 随每次版本递增同步追加 |
| `index.js` | ~117 | 扩展启动入口、绑定 SillyTavern 事件并定时同步目录 | `bootstrap`（内部） | 监听 `PRESET_CHANGED` / `WORLDINFO_UPDATED` / `mag_variable_update_ended` 等事件 |
| `style.css` | ~680 | 全部组件样式与 5 套面板主题、6 套通知主题变量 | — | `#tavern-deck-root` 及 `.td-*` 样式体系 |
| `src/utils.js` | ~405 | 全局常量、日志工具、ST/TH 桥接、Toast 渲染器、LCS 行/词 Diff、世界书克隆与关键词解析 | `APP_NAME`, `hasTH`, `callTH`, `getST`, `notify`, `showToastElement`, `computeLineDiff`, `computeSideLineDiffs`, `cloneWorldbookEntry`, `formatKeysInput`, `parseKeysInput` | — |
| `src/dev-tools.js` | ~200 | 劫持 `console` 与全局错误捕获、记录近期操作步骤与堆栈、维护 200 条内存日志缓冲与持久化钩子 | `initDevErrorCapture`, `setDevUiContext`, `setDevLogPersistHandler`, `recordOpStep`, `getDevLogs`, `clearDevLogs`, `formatLogsReport`, `formatDayLogsReport`, `formatSingleLogReport` | — |
| `src/store.js` | ~760 | 运行时 `state`、全局变量存取、方案/分组 CRUD、快照载荷与按天日志后端存储管理、缝合草稿持久化、存储诊断与清理 | `state`, `loadStore`, `saveStore`, `getActiveScheme`, `performDrop`, `getSnapshotPayload`, `saveMergeDraft`, `getStorageDiagnostics`, `cleanAutoBackupSnapshots`, `enqueueBackendLogPersist`, `flushBackendLogQueue`, `getBackendLogDayDetail`, `deleteBackendLogDay`, `clearAllBackendLogDays` | — |
| `src/native-ui.js` | ~261 | 折叠酒馆原生预设设定区、顶部导航栏图标注入、接管酒馆原生 `toastr` 通知 | `syncNativePresetCollapse`, `syncTopBarButton`, `getTopBarPositionOptions`, `syncNativeToastHook` | `#td-st-preset-collapse-bar`, `#tavern-deck-top-bar-btn` |

### 2. 核心业务逻辑层（纯数据与宿主 API 交互）

| 文件路径 | 约行数 | 职责定位 | 关键导出 | 负责范围 |
| :--- | :--- | :--- | :--- | :--- |
| `src/catalog.js` | ~484 | 刷新预设/世界书/脚本/正则目录索引、队列化应用开关变更、单选/多选/记忆开关/子组互斥联动 | `refreshAllCatalogs`, `refreshWorldbookCatalog`, `applyItemMutations`, `toggleEntryInGroup`, `toggleMultiGroupAll`, `saveEditedEntry` | 目录状态同步与持久化写回 |
| `src/snapshot.js` | ~501 | 预设与世界书快照捕获、自动备份裁剪、详尽差异计算（开关/正文/参数/增删）、全量与局部恢复、导出标准 JSON | `captureCurrentSnapshotData`, `captureWorldbookSnapshotData`, `createAutoBackupSnapshot`, `computeSnapshotDiff`, `computeDetailedSnapshotDiff`, `applySnapshot`, `applySelectiveSnapshot`, `exportSingleSnapshotAsStandardJson` | 快照核心逻辑 |
| `src/preset-manager.js` | ~228 | 预设列表摘要、读写/新建/重命名/删除/导入导出、主列表与未添加池移动、默认参数字段定义 | `PRESET_SYSTEM_IDS`, `PRESET_SETTING_FIELDS`, `getPresetSummaryList`, `getPresetDetail`, `savePresetDetail`, `movePromptsBatchBeforeIndex`, `insertFromUnusedAt` | 预设底层管理 |
| `src/preset-merge.js` | ~630 | 预设未保存变更比对与明细生成、旧版写回、预设 Diff/双栏会话构建与缝合执行 | `hasUnsavedPresetChanges`, `saveInUseToPreset`, `describePresetChanges`, `buildPresetDiffSession`, `executePresetStitch` | 预设对比与缝合算法 |
| `src/worldbook-manager.js` | ~251 | 世界书全局/角色/聊天绑定管理、CRUD、导入导出、条目排序与一键禁止递归 | `WB_POSITION_OPTIONS`, `isInActiveChat`, `getWorldbookBindingsSnapshot`, `toggleGlobalWorldbook`, `bindChatWorldbookSafe`, `renameWorldbookSafe`, `disableAllRecursionInEntries` | 世界书底层管理 |
| `src/worldbook-merge.js` | ~450 | 世界书 Diff/双栏会话构建（UID/名称/策略/递归/时效比对）、变更明细生成与缝合写回 | `describeWorldbookChanges`, `buildWorldbookDiffSession`, `executeWorldbookStitch` | 世界书对比与缝合算法 |
| `src/ai-preset-edit.js` | ~354 | 读取连接配置与代理预设、拉取模型列表、执行 AI 预设编辑 / AI 世界书编辑 / AI MVU 补全请求 | `getAvailableApiTargets`, `fetchModelsForApiTarget`, `runAiPresetEdit`, `runAiWorldbookEdit`, `runAiMvuUpdate` | AI 接口调度 |
| `src/merge-ui.js` | ~656 | 左右对照逐行高亮手动缝合弹窗、属性差异对比栏、草稿自动防抖暂存与恢复 | `initPresetMergeCustomCtx`, `initWbMergeCustomCtx`, `renderPresetMergeCustomModal`, `renderWbMergeCustomModal`, `handleMergeUiClick`, `handleMergeUiInput`, `flushActiveMergeDraft` | `previewCtx.type`: `mergeCustom`, `wbMergeCustom`<br>`data-action`: `merge-*`, `wbm-fill-text`, `wbm-save-merge-custom`, `toggle-merge-sync-scroll`, `toggle-merge-content-only` |

### 3. UI 基础设施与业务子模块层

| 文件路径 | 约行数 | 职责定位 | 关键导出 | 负责的 `modal` / `previewCtx` / `data-action` |
| :--- | :--- | :--- | :--- | :--- |
| `src/ui-snippets.js` | ~210 | 常用酒馆宏/标签快捷插入与自定义模板管理（默认折叠，持久化于全局扩展字段） | `renderQuickInsertHtml`, `handleQuickInsertClick` | `data-action`: `qi-tab`, `qi-insert`, `qi-toggle-add`, `qi-fill-from-editor`, `qi-save-tpl`, `qi-del-tpl` |
| `src/ui-editor-search.js` | ~185 | 预设与世界书条目编辑正文的下方搜索框与背景同步高亮 | `renderSearchableTextareaHtml`, `syncEditorSearchHighlights`, `bindEditorSearchEvents`, `handleEditorSearchClick`, `handleEditorSearchInput`, `handleEditorSearchKeydown` | `data-action`: `es-prev`, `es-next`, `es-case`, `es-clear` |
| `src/ui-preset-vars.js` | ~595 | 预设条目变量初始化检测（基准条目初始化判定、未引用变量展示、手动忽略与分类查看、一键初始化/引用与跳转） | `presetVarsUiModule`, `analyzePresetVariables` | `previewCtx.type`: `pmVarCheck`<br>`data-action`: `pm-open-var-check`, `pv-set-tab`, `pv-set-filter`, `pv-clear-search`, `pv-toggle-ignore-*`, `pv-clear-ignored`, `pv-reg-*`, `pv-ref-*`, `pv-copy-*`, `pv-jump-entry` |
| `src/ui-common.js` | ~260 | 公共 `ICONS`、主题/颜色常量、`editHistory`（撤销/重做栈）、`uiCtx` 上下文桥接、通用确认弹窗与脏检查协调器 | `ICONS`, `THEME_OPTIONS`, `ORB_STYLE_OPTIONS`, `editHistory`, `uiCtx`, `setUiContext`, `openConfirm`, `confirmDiscardDirtyModal`, `readPreviewSnapshot`, `applyPreviewSnapshot`, `pushEditSnapshot` | — |
| `src/ui-help.js` | ~175 | 全局 `?` 功能帮助字典与独立帮助弹窗渲染层 | `helpUiModule`, `renderHelpModal` | `state.helpTopic` · `data-action`: `open-help`, `close-help` |
| `src/ui-drag.js` | ~325 | 视口与面板尺寸/位置计算、悬浮球贴边休眠与拖拽、面板移动/缩放、列表拖拽排序与嵌套、分组 Sticky 吸顶监听 | `getViewportRect`, `repositionUI`, `syncOverlayBounds`, `wakeOrb`, `scheduleOrbIdle`, `applyOrbVisualState`, `updateStickyGroupHeaders`, `bindDragListeners`, `unbindDragListeners` | `.td-orb`, `.td-panel`, `.td-drag-grip`, `.td-resize-handle` |
| `src/ui-views.js` | ~115 | 通用确认窗渲染、`renderModal` / `renderPreviewModal` 注册表外壳、主面板单条目通用预览编辑壳 | `renderConfirmModal`, `renderModal`, `renderPreviewModal`, `syncPreviewStatusUi`, `updatePickerList`, `updateSnapshotList` | `previewKey`（主面板单条预览/编辑） |
| `src/ui-groups.js` | ~460 | 主分组/条目树渲染、方案新建/复制/重命名/删除/预设绑定、分组表单、条目选择器（含范围选区） | `groupsUiModule`, `renderGroupHtml`, `renderGroupItemsListHtml`, `getPickerSections`, `updatePickerList` | `modal.type`: `schemeForm`, `bindings`, `groupForm`, `picker`<br>`data-action`: `toggle-group-menu`, `clear-group-search`, `toggle-item-drawer`, `*-scheme`, `*-bindings`, `*-group`, `toggle-collapse`, `toggle-multi-group`, `open-picker`, `toggle-entry`, `remove-entry`, `preview-entry`, `save-preview-edit`, `copy-preview`, `toggle-picker-*`, `set-picker-*`, `toggle-pick`, `picker-*`, `save-picker` |
| `src/ui-snapshots.js` | ~490 | 快照中心列表与创建、重命名/备注、快照置顶/瘦身/导出、快照双版本对比、详尽差异树与局部勾选恢复 | `snapshotsUiModule`, `updateSnapshotList` | `modal.type`: `snapshots`, `snapshotRename`<br>`snapshotDetailCtx`（差异预览层）<br>`data-action`: `open-snapshots`, `toggle-snap-*`, `set-snap-*`, `set-snapshot-filter`, `create-snapshot`, `undo-last-restore`, `pin-snapshot`, `slim-snapshot`, `export-snapshot`, `compare-snapshot-*`, `cancel-snap-compare`, `view-snapshot`, `snap-diff-select`, `apply-selective-snapshot`, `save-snap-as-new`, `apply-snapshot*`, `overwrite-snapshot`, `rename-snapshot`, `submit-snap-rename`, `delete-snapshot` |
| `src/ui-merge-dialogs.js` | ~385 | 双栏对比缝合的辅助弹窗：批量/单条序号迁移（同预设或跨预设）、条目编辑（带撤销重做）、条目 Diff 与全局 Diff 报告 | `mergeDialogsUiModule` | `selectPopup.type`: `mergeMigrate`<br>`previewCtx.type`: `mergeEntryEdit`, `mergeEntryDiff`, `mergeGlobalDiff`<br>`data-action`: `mig-*`, `confirm-merge-migrate`, `merge-save-entry-edit`, `merge-diff-*`, `gdiff-*` |
| `src/ui-merge-panel.js` | ~510 | 预设与世界书对比缝合（来源+基座选择页、上下双栏独立编辑工作区、撤销重做、草稿恢复与保存） | `mergePanelUiModule`, `updateDualMergeBody`, `updatePresetMergeBody`, `updateWbMergeBody` | `modal.type`: `presetMergeSelect`, `presetMerge`, `wbMergeSelect`, `wbMerge`<br>`previewCtx.type`: `mergeCustom`, `wbMergeCustom`（转发至 `merge-ui.js`）<br>`data-action`: `open-preset-merge`, `open-wb-merge`, `dual-*`, `resume-*`, `discard-*`, `swap-*`, `start-*` |
| `src/ui-presets.js` | ~540 | 预设管理列表、预设详情（提示词/未添加/生成参数）、自由多条目正文 Diff 比对、批量选择移动、条目内容与属性编辑 | `presetsUiModule` | `modal.type`: `presetManager`, `presetDetail`<br>`previewCtx.type`: `pmContentEdit`, `pmPromptEdit`, `pmDiffCompare`<br>`data-action`: `open-preset-manager`, `pm-*`, `pm-diff-*` |
| `src/ui-worldbooks.js` | ~380 | 世界书管理列表（全局/角色/聊天绑定）、世界书条目详情、批量移动与禁用递归、条目正文与完整属性编辑 | `worldbooksUiModule` | `modal.type`: `worldbookManager`, `worldbookDetail`<br>`previewCtx.type`: `wbContentEdit`, `wbEntryEdit`<br>`data-action`: `open-worldbook-manager`, `wbm-*`, `wbd-*`, `wb-save-*` |
| `src/ui-ai-assistant.js` | ~590 | 共享可折叠 API/模型配置框、AI 批量编辑预设与世界书的勾选设定、Diff 检视、说明指导查看、手动弹窗编辑（撤销/重做）与写回 | `aiAssistantUiModule`, `renderCollapsibleAiApiBoxHtml`, `saveSharedAiApiFieldsFromPreview`, `syncAiPreviewDraftInputs`, `setAiRunBtnLoading` | `previewCtx.type`: `pmAiEdit`, `wbAiEdit`<br>`selectPopup.type`: `aiResultEdit`, `aiNotes`<br>`data-action`: `ai-*` |
| `src/ui-mvu.js` | ~585 | MVU 楼层变量查看器（全部/加精重点关注）、楼层步进回溯、单变量类型编辑、JSON 编辑、命令补全预演及 AI 推算更新 | `mvuUiModule` | `modal.type`: `mvuViewer`<br>`previewCtx.type`: `mvuValEdit`, `mvuJsonEdit`, `mvuCmdEdit`, `mvuAiUpdate`<br>`data-action`: `open-mvu-viewer`, `mvu-*` |
| `src/ui-settings.js` | ~565 | 控制台设置页、全类型二级选择弹窗（主题/颜色/顶部栏位置/移动目标/AI条目预览）、悬浮球图片裁剪器 | `settingsUiModule`, `renderSelectPopup` | `modal.type`: `settings`<br>`selectPopup.type`: `theme`, `orbStyle`, `groupTextColor`, `entryTextColor`, `topBarPosition`, `tdToastTheme`, `nativeToastTheme`, `nativeToastPosition`, `movePromptTarget`, `moveWbTarget`, `aiItemPreview`（另由 `ui-ai-assistant` 接管 `aiResultEdit`）<br>`previewCtx.type`: `orbCrop`<br>`data-action`: `open-settings`, `open-select-popup`, `close-select-popup`, `select-popup-*`, `move-by-number`, `trigger-orb-upload`, `clear-orb-image`, `orb-crop-*`, `toggle-*`, `apply-panel-*`, `preview-*-toast`, `reset-layout`, `clear-all-data` |
| `src/ui-tools.js` | ~470 | 存储空间占用诊断与按天后端日志查看清理、运行日志面板（步骤/堆栈展开、过滤/单条或批量复制/导出）、配置导入导出中心 | `toolsUiModule` | `modal.type`: `storageManager`, `logs`, `ioCenter`<br>`previewCtx.type`: `backendLogDay`<br>`data-action`: `open-storage-manager`, `storage-*`, `open-logs`, `logs-*`, `open-io-center`, `toggle-io-*`, `export-*`, `trigger-io-file`, `parse-io-text`, `set-io-imp-mode`, `confirm-io-import` |
| `src/ui-app.js` | ~415 | UI 根容器挂载/卸载、扩展菜单与设置面板注入、主面板 Header/抽屉壳渲染、`renderPreservingFocus`、全局事件与 `UI_MODULES` 注册表总控分发 | `mountUI`, `cleanupDOM`, `renderOrb`, `renderMain`, `renderMainBodyOnly`, `setPanelOpen`, `syncTopBarUI`, `syncExtensionButton`, `mountExtensionSettingsPanel`, `applyThemeAttributes`, `syncEntryStatesUI` | `UI_MODULES` 总控注册表；顶层基础动作：`close-panel`, `toggle-tools-drawer`, `toggle-control-bar`, `toggle-fullscreen`, `refresh`, `close-modal`, `close-preview`, `preview-undo`, `preview-redo`, `confirm-*`, `show-full-title` |

---

## 三、 按需点菜排查指南（新对话快速定位）

1. **想改某个弹窗样式或交互**：先查上表 `modal.type` / `previewCtx.type` 列，直接定位到唯一的 `src/ui-*.js`（例如 MVU 查 `src/ui-mvu.js`，存储管理查 `src/ui-tools.js`），无需通读全量代码。
2. **想新增独立功能面板**：
   - 在 `src/` 新建 `src/ui-<new>.js` 并导出 `xxxUiModule`；
   - 在 `src/ui-app.js` 引入并加入 `UI_MODULES`；
   - 如需在工具箱抽屉增加按钮，在 `src/ui-app.js` 的 `renderMain()` `#td-tools-drawer` 中添加按钮；
   - 同步更新 `AI_GUIDE.md` 模块索引表。
3. **遇到状态未刷新或数据未持久化**：业务逻辑优先查 `src/store.js`、`src/catalog.js` 或对应的 `*-manager.js`，UI 同步优先查 `src/ui-common.js`（`uiCtx`）与 `index.js` 事件监听。
