import { escapeHtml } from './utils.js';
import { state } from './store.js';
import { ICONS, uiCtx } from './ui-common.js';

const HELP_TOPICS = {
  main: {
    title: '主控制台使用说明',
    sections: [
      {
        heading: '分组与开关模式',
        items: [
          '多选分组：组内条目可自由独立开关，组头开关支持一键全开/全关。',
          '记忆总开关：关闭分组时自动记住当前已开启的条目，再次开启时按记忆恢复。',
          '单选分组 / 子组互斥：组内或同级子分组间互斥，开启一项时自动关闭其余项。',
        ],
      },
      {
        heading: '快捷操作与工具箱',
        items: [
          '右上角依次为：工具箱（预设/世界书/缝合/快照/日志/MVU/存储）、方案与预设切换栏、全屏、设置、帮助与收起。',
          '长标题提示：任意弹窗或双栏标题若被截断，直接点击标题文字即可查看完整名称。',
        ],
      },
    ],
  },
  bindings: {
    title: '预设方案绑定说明',
    sections: [
      {
        heading: '绑定机制',
        items: [
          '可为当前预设勾选一个或多个专属控制方案，切换预设时控制台将仅展示已绑定方案并记住上次激活项。',
          '若全部不选，则默认列出全局方案池中的全部方案；同一方案可被多个预设共用。',
        ],
      },
    ],
  },
  groupForm: {
    title: '分组模式与联动说明',
    sections: [
      {
        heading: '模式区别',
        items: [
          '多选分组：适用于可叠加的功能开关，可选开启「记忆总开关」以保留关闭前的启用组合。',
          '单选分组：适用于文风、破限、视角等互斥切换，点选任一项会自动关闭组内其余项。',
          '子分组互斥（套件单选）：开启任一子分组内条目时，自动关闭同级其他子分组下的所有条目。',
        ],
      },
    ],
  },
  picker: {
    title: '条目选择器说明',
    sections: [
      {
        heading: '数据源与批量选择',
        items: [
          '支持从当前预设、已加载世界书、酒馆脚本与正则条目中跨类型混编进同一分组。',
          '点击「单选点选」可切换为「范围选择」模式：依次点击起点与终点条目即可批量勾选或取消区间。',
        ],
      },
    ],
  },
  presetManager: {
    title: '预设管理说明',
    sections: [
      {
        heading: '实时预设与已保存预设',
        items: [
          '酒馆中的临时开关或编辑会立即作用于「实时预设 (in_use)」，若与已保存文件不同会标出「有未保存修改」。',
          '点击「保存实时修改」可将当前临时改动写回原预设文件；也可通过「另存实时预设」保存为新副本。',
        ],
      },
    ],
  },
  presetDetail: {
    title: '预设编辑说明',
    sections: [
      {
        heading: '列表结构与操作',
        items: [
          '「提示词」为发给 AI 的主列表；「未添加」为下拉池，可通过「加入列表」或批量操作插入到主列表指定位置。',
          '顶部支持按序号直接跳转、批量勾选调序、「变量检测」分析宏初始化状态以及「AI 编辑」批量改写或新增条目。',
          '所有修改先暂存在当前编辑页中，确认无误后点击右下角「保存预设」才会持久化写入。',
        ],
      },
    ],
  },
  pmPromptEdit: {
    title: '预设条目属性说明',
    sections: [
      {
        heading: '位置与身份',
        items: [
          '相对位置 (Relative)：按提示词主列表从上到下的先后顺序拼接发送。',
          '聊天深度 (In-Chat @D)：按设定的 Depth（0 为最新消息之后）与 Order 插入聊天记录中。',
          '系统内置占位符（如角色描述、聊天记录）通常无需填写正文，保持内容留空即可。',
        ],
      },
    ],
  },
  pmDiffCompare: {
    title: '自由正文 Diff 比对说明',
    sections: [
      {
        heading: '多条目自由比对',
        items: [
          '可从「提示词主列表」与「未添加池」中任意勾选 2 个及以上条目，仅针对条目提示词正文进行逐行 Diff 比对。',
          '若在批量移动模式中已勾选至少 2 个条目，点击「Diff 比对」可直接跳过选框进入结果页。',
          '选中 3 个及以上条目时，支持切换基准条目以 1 对多对照全部条目，或切换为「任意两条互比」。',
        ],
      },
    ],
  },
  pmVarCheck: {
    title: '变量初始化检测说明',
    sections: [
      {
        heading: '为什么需要变量初始化',
        items: [
          '酒馆预设中推荐在顶部统一使用 {{setvar::变量名::}} / {{setvar::变量名::默认值}} 或 {{setglobalvar::...}} 初始化变量，避免首次读取或条件判断时输出异常文本。',
        ],
      },
      {
        heading: '检测项含义',
        items: [
          '赋值未初始化 / 仅引用未初始化：预设中使用了该变量（如 addvar/incvar/getvar）但缺少对应的 setvar/setglobalvar 初始化宏。',
          '初始化未生效：初始化宏存在于已关闭条目或未添加池中，主列表已启用条目引用时将不会生效。',
          '顺序靠后：主列表已启用条目首次使用该变量的位置排在首次初始化之前，建议调整条目顺序或将初始化条目移至顶部。',
        ],
      },
      {
        heading: '基准判定、忽略与一键操作',
        items: [
          '系统默认以初始化项最多的条目（即顶部「写入」选中的条目）作为初始化基准：未出现在该基准条目中的变量，即使在其他条目中出现 setvar 赋值也会被判定为未初始化。',
          '切到「未引用」筛选时，会在下方列出所有尚未在预设中读取的变量及其相关条目，并可选择目标条目（默认选中读取项最多的条目）一键插入读取宏。',
          '对无需处理的特殊变量或条目可点击「忽略」，忽略后不计入需处理/未引用与一键操作；随时可切到「已忽略」分类查看并取消忽略。',
        ],
      },
    ],
  },
  worldbookManager: {
    title: '世界书管理说明',
    sections: [
      {
        heading: '四种绑定作用域',
        items: [
          '全局启用：对所有角色卡与聊天生效。',
          '角色主书 / 角色附加：仅在打开当前角色卡时生效，主书唯一，附加可多选。',
          '绑定聊天：仅对当前打开的聊天记录生效（需先进入角色卡聊天）。',
        ],
      },
    ],
  },
  worldbookDetail: {
    title: '世界书条目说明',
    sections: [
      {
        heading: '触发策略与工具栏',
        items: [
          '蓝灯 (常驻)：只要启用即注入；绿灯 (关键词)：需在扫描文本中匹配主要/次要关键词才激活；向量化：按语义相似度激活。',
          '「禁递归」可一键将所有条目设为禁止被递归及禁止递归其他条目；顶部支持序号跳转、批量移动与「AI 编辑」。',
        ],
      },
    ],
  },
  wbEntryEdit: {
    title: '世界书完整属性说明',
    sections: [
      {
        heading: '关键词、位置与时效',
        items: [
          '关键词支持逗号或换行分隔，支持 /正则/i 写法；次要关键词可设定「任一/全部/不含」逻辑。',
          '黏性 (Sticky)：激活后持续生效 N 楼；冷却 (Cooldown)：激活后 N 楼内不再触发；延迟 (Delay)：至少达到 N 楼后才允许触发。',
        ],
      },
    ],
  },
  aiEdit: {
    title: 'AI 智能编辑说明',
    sections: [
      {
        heading: '配置与安全',
        items: [
          'API 选择器直接复用酒馆已配置的 Connection Profiles 或代理预设，本扩展不额外存储 API Key。',
        ],
      },
      {
        heading: '参考条目、检视编辑与新增写入',
        items: [
          '「参考条目」仅作为上下文发给 AI 参考风格或结构，不会被 AI 覆盖修改。',
          '可以只选参考条目并在指令中要求 AI 生成新条目，也可以在结果检视页点击「手动编辑」弹窗修改（支持撤销/重做）或切换为「新增条目写入」。',
          '写回后先进入当前编辑器草稿，确认满意后点击主界面「保存」按钮即可持久化。',
        ],
      },
    ],
  },
  snapshots: {
    title: '快照中心说明',
    sections: [
      {
        heading: '快照类型与存储',
        items: [
          '开关状态快照：体积极小，仅记录各条目的启用状态。',
          '完整快照：额外保存全部正文、关键词与生成参数（优先存放在酒馆后端 users/files/，跨设备可用且不占浏览器 5MB 配额）。',
        ],
      },
      {
        heading: '备份、对比与局部恢复',
        items: [
          '恢复或覆盖前会自动生成备份快照（未置顶自动备份最多保留 10 条），支持一键撤回上次恢复。',
          '点击「对比」可选定两条快照互查差异；点击「差异/局部」可单独勾选部分条目或参数进行局部恢复。',
        ],
      },
    ],
  },
  snapshotDetail: {
    title: '快照差异与局部恢复说明',
    sections: [
      {
        heading: '局部还原与另存',
        items: [
          '可按「开关 / 参数 / 正文 / 增删」分类筛选并勾选需要还原的差异项，点击「恢复所选差异」即可精准回滚局部改动。',
          '完整快照还支持直接「另存为新预设/世界书」，避免覆盖现有版本。',
        ],
      },
    ],
  },
  mergeSelect: {
    title: '对比缝合选择说明',
    sections: [
      {
        heading: '双向自由工作区',
        items: [
          '选定 A 与 B 两个版本后将进入上下双栏自由编辑区，A 侧与 B 侧均可独立编辑、互迁条目、执行 Diff 对比并单独保存或另存。',
        ],
      },
    ],
  },
  dualMerge: {
    title: '双栏对比缝合说明',
    sections: [
      {
        heading: '核心工具栏',
        items: [
          '1对1缝合：依次点击 A 侧与 B 侧的任意条目，即可打开双向 Diff 与手动逐行高亮缝合窗口。',
          '同屏滚动：按相同滚动增量联动 A/B 两侧列表，方便对照浏览。',
          '全局 Diff：扫描两侧全部差异并在列表条目上标出「差异 / 仅 A / 仅 B」标记。',
          '迁移与参数同步：支持单条或批量同侧调序/跨侧迁移；预设缝合可在「保存」菜单勾选同步生成参数；关闭未保存修改支持暂存草稿。',
        ],
      },
    ],
  },
  mergeCustom: {
    title: '手动逐行高亮缝合说明',
    sections: [
      {
        heading: '三窗格对照编辑',
        items: [
          '上方左右窗格实时以红/绿底色高亮逐行及词级差异，支持打开「同步滚动」或「只缝合内容」（隐藏属性对比以专注正文）。',
          '属性对比栏支持一键全用或单项采用 A/B 侧属性；下方结果框支持撤销/重做及常用宏快速插入。',
        ],
      },
    ],
  },
  mergeEntryDiff: {
    title: '双向 Diff 比对说明',
    sections: [
      {
        heading: '比对与覆盖',
        items: [
          '顶部下拉框可随时切换 A/B 侧要比对的任意条目，下方展示属性差异表与正文逐行 Diff。',
          '可点击「用 A 覆盖 B」或「用 B 覆盖 A」快速同步，或点击「手动高亮缝合」进入三窗格精细合并。',
        ],
      },
    ],
  },
  mergeGlobalDiff: {
    title: '全局 Diff 报告说明',
    sections: [
      {
        heading: '差异分类',
        items: [
          '自动按 ID / UID / 名称匹配两侧条目，归类为「差异」「仅 A」「仅 B」「一致」，支持直接点进单条 Diff 或迁移到对侧。',
        ],
      },
    ],
  },
  mvuViewer: {
    title: 'MVU 楼层变量说明',
    sections: [
      {
        heading: '楼层回溯与加精关注',
        items: [
          '默认读取最新楼层（若最新楼层尚无数据会自动回溯至最近变量楼层），也可手动步进或输入楼层号查看历史快照。',
          '点击变量右侧星标 ☆ 可加精重点关注，各聊天的加精列表相互独立，也支持从同角色卡其他聊天导入。',
          '支持单变量按类型修改、整段 JSON 编辑、MVU 命令补全预演与 AI 推算更新，写回后自动刷新对应楼层渲染。',
        ],
      },
    ],
  },
  mvuCmdEdit: {
    title: 'MVU 命令补全说明',
    sections: [
      {
        heading: '解析与预演',
        items: [
          '打开时会自动尝试提取最新消息中被截断或已输出的 <UpdateVariable> 命令片段。',
          '支持 _.set / _.add / _.insert / _.delete / _.move 命令，点击「解析预览变更」可先查看 stat_data Diff 再写回楼层。',
        ],
      },
    ],
  },
  mvuAiUpdate: {
    title: 'AI 更新/补全 MVU 说明',
    sections: [
      {
        heading: '上下文与安全预演',
        items: [
          '自动携带当前变量状态、近期剧情楼层、截断命令片段以及匹配到的世界书变量规则（可手动微调）。',
          'AI 返回命令后先进入检视页预演变更对比，可手动微调命令并重新解析，确认无误后再写回目标楼层。',
        ],
      },
    ],
  },
  storageManager: {
    title: '存储空间管理说明',
    sections: [
      {
        heading: '三层存储架构',
        items: [
          '1. 酒馆全局变量：存放方案配置、外观设置、快照轻量索引与 MVU 加精记录，会随备份导出同步。',
          '2. 酒馆后端文件 (users/files/)：存放完整快照载荷与按天分类的警告/错误日志存档，可按天查看与删除，突破浏览器 5MB 限制且跨端可用。',
          '3. 浏览器 localStorage：仅存对比缝合草稿与旧版本地遗留快照（若存在旧版快照可点击「迁至后端」释放本地配额）。',
        ],
      },
    ],
  },
  settings: {
    title: '控制台设置说明',
    sections: [
      {
        heading: '核心功能说明',
        items: [
          '通知系统：可分别设置 TD 插件通知主题（支持「静默通知」仅弹警告/报错）以及是否接管美化酒馆原生通知（ST 徽标）。',
          '入口保底：悬浮球、顶部栏与魔法棒扩展菜单三者至少需保留一项开启；扩展设置面板内也保留了随时打开总控台的兜底按钮。',
          '按钮收纳与拖拽：可自定义分组/条目右侧按钮的收纳方式；开启「拖拽排序」后可拖动调序与跨组嵌套。',
        ],
      },
    ],
  },
  logs: {
    title: '运行日志说明',
    sections: [
      {
        heading: '排障与导出',
        items: [
          '运行日志界面展示本次会话缓冲的最近 200 条信息、警告与错误日志，点击「清空」仅清空当前界面显示。',
          '所有警告与错误日志会自动按天持久化保存到酒馆后端文件中（不自动导入此处），可在「存储空间管理」按天查看与删除。',
        ],
      },
    ],
  },
  ioCenter: {
    title: '导入与导出中心说明',
    sections: [
      {
        heading: '全量与局部备份',
        items: [
          '支持一键导出全量数据，或按方案、快照、外观设置精细勾选局部导出。',
          '导入时可选择「合并导入」（保留现有方案并追加）或「覆盖导入」（替换所选分类旧数据）。',
        ],
      },
    ],
  },
  entryPreview: {
    title: '条目预览与编辑说明',
    sections: [
      {
        heading: '快速编辑与持久化',
        items: [
          '顶部工具栏支持正文编辑撤销/重做与一键复制；预设与世界书条目正文框内置「常用符号与模板」及底部关键词高亮搜索。',
          '点击「保存更改」将直接写入并持久化到对应的预设、世界书、脚本或正则中。',
        ],
      },
    ],
  },
};

export function renderHelpModal() {
  const layer = uiCtx.getHelpLayer ? uiCtx.getHelpLayer() : null;
  if (!layer) return;
  const key = state.helpTopic;
  if (!key || !state.panelOpen) {
    layer.classList.remove('is-open');
    layer.innerHTML = '';
    return;
  }

  const topic = HELP_TOPICS[key] || HELP_TOPICS.main;
  const secsHtml = (topic.sections || []).map((sec) => `
    <div class='td-help-sec'>
      <div class='td-help-sec-title'>${escapeHtml(sec.heading)}</div>
      <ul class='td-help-list'>
        ${(sec.items || []).map((it) => `<li>${escapeHtml(it)}</li>`).join('')}
      </ul>
    </div>`).join('');

  layer.classList.add('is-open');
  layer.innerHTML = `
    <div class='td-modal td-modal-sm'>
      <div class='td-modal-head'>
        <div class='td-modal-title'>${ICONS.help} ${escapeHtml(topic.title)}</div>
        <div class='td-modal-head-actions'>
          <button type='button' class='td-icon-btn' data-action='close-help' title='关闭'>${ICONS.close}</button>
        </div>
      </div>
      <div class='td-modal-body'>
        ${secsHtml}
      </div>
      <div class='td-modal-foot'>
        <button type='button' class='td-btn primary' data-action='close-help'>知道了</button>
      </div>
    </div>`;
  uiCtx.syncOverlayBounds();
}

export const helpUiModule = {
  handleClick(e, actionEl, action) {
    if (action === 'open-help') {
      e.stopPropagation();
      state.helpTopic = actionEl.getAttribute('data-help-key') || 'main';
      renderHelpModal();
      return true;
    }
    if (action === 'close-help') {
      state.helpTopic = null;
      renderHelpModal();
      return true;
    }
    return false;
  },
};
