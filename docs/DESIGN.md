# novelMaster 详细设计文档

- 版本：v1（2026-09-21）
- 上游需求方案：`../idea-forge/plans/2026-09-21-novel-master.md`（`idea-forge` 里是「要什么」，本文档是「怎么做」）
- 标记约定：**✅ 已定** ／ **⚠️ 假设**（待验证）／ **❓ 待定**

---

## 0. 一句话概括

一个跑在终端里的 AI 辅助小说写作工具。它把写作变成一条有持久化状态、每步都要用户拍板的流水线：

**想法 → 大纲 → 事件推演 → 章节大纲 → 正文 → 审查 → 去 AI 味 → 用户验收 → 资料回填 → 清空上下文 → 下一章**

---

## 1. 名词表

术语在本项目里有精确含义，代码、数据、提示词三处必须一致。

| 术语 | 含义 |
|------|------|
| **小说** | 一个根目录下的全部内容。v1 只支持同时打开一本。 |
| **设定条目** | 世界观的一条可引用事实（规则、地点、势力、物品、禁忌）。ID 形如 `S-001`。 |
| **人物档案** | 静态档案（性格、外貌、目标…）+ 按章节时间追加的关键事件时间轴。ID 形如 `C-001`。 |
| **关系** | 两个人之间的有向关系，带当前状态和变更历史。ID 形如 `R-001`。 |
| **事件** | 剧情推进的一个单元，可跨多章。有"当前描述"和"细化历史"。ID 形如 `E-003`。 |
| **伏笔** | `origin: foreshadow` 的事件。已埋未收 = `status: planned`。 |
| **章节大纲** | 写正文前先推演、经用户确认的那份细纲。 |
| **正文** | 章节实际内容，纯 txt，唯一受"禁止 markdown"约束的文件。 |
| **摘要** | 每章生成一次的压缩记录，供后续章节注入上下文。 |
| **审查报告** | 对照设定/人物/关系/事件/前文，逐条带依据引用的问题清单。 |
| **去 AI 味报告** | 命中清单 + 改前 + 改后。 |
| **回填** | 用户验收后，把本章的进展写进人物时间轴、关系历史、事件细化历史、摘要等持久资料。 |
| **层面（layer）** | 交互模式的一种：顶层／设定／人物／大纲／事件／写作。每层只装载该层数据。 |
| **上下文包** | 一次生成前装配好的完整输入集合。 |
| **主事件** | 一章可挂多个事件，但必须有一个 `primaryEventId`。 |

---

## 2. 目标与非目标

### 2.1 目标

- 单人、单机、单本，全链路打通。
- 每章的 AI 记忆用完即弃，下一章重建上下文。杜绝脏上下文。
- 审查必须有据可查：每条问题都能指回具体文件条目。
- 所有资料持久化，用户能直接读、直接改。

### 2.2 非目标（v1 明确不做）

- 多本小说切换与管理（目录结构会预留）
- 云同步、账号、多人协作
- 富文本编辑器、epub/docx 导出
- 生成大纲而不经用户输入
- 未经用户给定方向的自动剧情脑暴
- 自研终端渲染层（见 §3.1）

---

## 3. 架构总览

### 3.1 关键决策：宿主式架构，不自研 TUI ✅

**决策**：novelMaster 是一个 **pi 扩展**，由 pi 的 `InteractiveMode` 作为宿主运行。

```
bin/novelmaster
  └─ createAgentSessionRuntime(createRuntime)      // 建运行时
       └─ DefaultResourceLoader {
            extensionFactories: [novelMasterExtension]
          }
            └─ new InteractiveMode(runtime, {...}).run()   // pi 自带完整 TUI
                 └─ 扩展内注册：命令 / 自定义工具 / 事件钩子 / TUI 组件
```

**为什么不自研 TUI**：`@earendil-works/pi-tui` 提供了组件（`Editor`、`ScrollView`、`Markdown`、`SelectList`、`SettingsList`、`Text`、`Box`、`VStack`…）和渲染器（`TuiAltScreen` + `ProcessTerminal`），但它**不提供**"编辑器 + 对话 + 流式输出 + 会话管理 + 命令补全"这一整层。自研等于重写 pi 已经有的 80%，而且 pi 每次升级都要跟着改。宿主式架构把这一层完全白拿。

**代价（必须承认）**：UI 形态受 pi 约束 —— 输入框是 pi 的编辑器，命令必须以 `/` 开头，无法做全屏自绘面板。用户要的是"命令行式交互，类似 TUI"，这恰好吻合，所以这个代价是零。

**根因**：本项目的价值在**数据层 + 上下文装配 + 审查规则**三处，不在终端渲染上。把工程预算花在已经有现成实现的地方是浪费。

### 3.2 用到 pi 的能力（已核对 API）

| 需求 | 用什么 | 说明 |
|------|--------|------|
| 分层命令 `/outline` `/event` … | `pi.registerCommand(name, { handler })` | 命令处理器拿到 `ExtensionCommandContext` |
| 层内自然语言对话 | **不需要钩子** | 层面状态本就是扩展内存里的一个变量，`before_agent_start` 直接读它。原计划用 `pi.on("input")` 去"标记意图"是多余的抽象，已删除（§8.3） |
| 每层只装载该层数据 | `pi.on("before_agent_start", …)` | 可改 `event.systemPromptOptions.sections`，pi 只把变化的部分作为补丁追加（省 token + 保留前缀缓存） |
| 每章清空上下文 | `ctx.newSession({ parentSession, setup, withSession })` | 只在命令处理器里可用 |
| 一次性子 agent | `createAgentSession({ sessionManager: SessionManager.inMemory(), tools, customTools })` | 审查员、脑暴角色、去 AI 味都用这个 |
| 结构化产出 | `defineTool` + typebox `Type.Object` | 见 §7.6 |
| 自定义确认/选择界面 | `ctx.ui.custom()` / `select` / `confirm` / `input` / `editor` | |
| 层面状态提示 | `ctx.ui.setStatus` / `setWidget` | 常驻显示"当前层面 + 章节状态" |
| humanizer skill | `DefaultResourceLoader` 自动发现 `~/.pi/agent/skills/` | 但我们**显式读取 SKILL.md 注入**，不依赖模型自主加载（§7.7） |
| 模型 | `ModelRuntime.create()` + `resolveCliModel()` / `runtime.getModel(provider, id)` | 默认读 `~/.pi/agent/settings.json` |

### 3.3 分层与职责

| 层 | 职责 | 不知道什么 |
|----|------|-----------|
| **CLI 入口** | 建运行时、拼扩展、起 InteractiveMode | 业务 |
| **命令层** | 解析命令、切模式、驱动流程、调用下层 | 不讲道理，不拼提示词 |
| **流程层** | 章状态机、审查编排、回填闸门 | 不碰文件格式 |
| **上下文装配器** | 把磁盘数据装成上下文包 | 不知道谁调用它 |
| **AI 层** | 会话工厂、子 agent 拓扑、提示词 | 不做文件 I/O 决策 |
| **工具层** | LLM 唯一的数据写入口（校验 + 原子写 + ID 分配） | 不做业务判断 |
| **数据层** | schema、读写、路径、校验 | 不感知 AI |

---

## 4. 项目结构

```
novelMaster/
├── package.json                  # type: module
├── tsconfig.json
├── docs/DESIGN.md                # 本文档
├── bin/novelmaster.mjs           # 可执行入口，转发到 dist/cli.js
├── src/
│   ├── cli.ts                    # 组装 runtime + InteractiveMode
│   ├── extension/
│   │   ├── index.ts              # 扩展工厂：装载命令与提示词
│   │   ├── layers.ts             # 层面定义 + 命令表 + 当前层面状态
│   │   ├── commands.ts           # 命令注册与实现
│   │   ├── render.ts             # /help、层面段、项目段、状态栏的文本渲染
│   │   └── prompt-sections.ts    # pi.on("before_agent_start") 层面与项目注入
│   ├── data/
│   │   ├── paths.ts              # 根目录解析、文件名常量、应用配置
│   │   ├── schema.ts             # 数据模型的类型定义
│   │   ├── io.ts                 # 原子写、追加写、JSON 读写
│   │   ├── init.ts               # 新建一本小说（目录树 + 初始文件 + slug）
│   │   ├── novel.ts              # 打开小说（读 meta + state）
│   │   ├── ids.ts                # ID 分配与永不复用        ← 里程碑 2
│   │   ├── settings.ts  characters.ts  relations.ts  events.ts  chapters.ts
│   │   └── validate.ts           # 依据引用校验（§11.6）    ← 里程碑 8
│   ├── tools/                    # pi custom tools（§6）    ← 里程碑 2
│   └── prompts/                  # 各角色 system prompt 模板 ← 里程碑 4
├── tests/
│   └── smoke.ts                  # 不启动 TUI 的冒烟测试
├── novels/                       # 默认小说根目录（可配置）
└── .novelmaster/
    └── config.json               # 当前打开的小说、默认配置
```

**依赖**：`@earendil-works/pi-coding-agent`、`typebox`、`typescript`。

**不引入**：任何 TUI 框架、任何数据库、任何 ORM、**任何构建工具**。

**无构建步骤**：Node 22.19+ 原生剥离类型，`node src/cli.ts` 直接可跑，相对导入写 `.ts` 后缀。少一层构建就少一层"源码与运行物不一致"的可能 —— 对一个要长期演进的项目，这个收益比省下的那点启动开销值得多。

---

## 5. 数据层规格

### 5.1 目录树

```
<小说根目录>/
├── meta.json                     # 覆盖式
├── state.json                    # 覆盖式，唯一进度真相
├── inbox.md                      # 追加式
├── outline.md                    # 覆盖式 + 底部「修订记录」追加区
├── setting/
│   ├── index.json                # 索引（全部条目）
│   └── S-001.md, S-002.md ...    # 详述 + 追加式修订记录
├── characters/
│   ├── index.json
│   └── C-001.md, C-002.md ...
├── relations.json
├── events/
│   ├── index.json
│   └── E-001.md, E-002.md ...
├── chapters/
│   ├── index.json
│   ├── 012.txt                   # 正文：纯文本，无 markdown
│   ├── 012.outline.md
│   ├── 012.summary.md
│   ├── 012.review.md
│   ├── 012.deai.md
│   └── 012.reflow.md
└── logs/
    ├── sessions/                 # 每章会话的 jsonl 备份（可选）
    └── operations.jsonl          # 追加式操作留痕
```

### 5.2 四条设计原则

1. **可被引用的东西必须有稳定 ID。** 审查要说"这里违背了设定 S-001"。没有 ID，"有据可查"退化成"AI 说它对"。ID 一经分配**永不复用**，即使条目被废弃。
2. **追加式与覆盖式必须分开。** 时间轴、细化历史、关系变更史、inbox、operations.jsonl 是**只增不改**的 —— 它们是历史，改写历史等于伪造依据。大纲、条目正文、元信息是覆盖式 —— 它们是当前结论。`reflow.md` 的职责就是记录每次回填往追加式文件里写了什么。
3. **正文文件里只有正文。** 章节号、标题、状态全在 `index.json`。因为用户要亲手编辑 txt，任何混进正文的元数据都会在编辑时被误删或误改。
4. **`state.json` 是唯一进度真相。** 章状态不在别处重复记录；多源真相迟早不一致。

### 5.3 文件 schema

全部 schema 定义在 `src/data/schema.ts`（typebox），是**唯一真相**；本节的 JSON 只是它的展开示意。

**`meta.json`**
```json
{
  "schemaVersion": 1,
  "title": "",
  "slug": "",
  "genre": [],
  "premise": "",
  "logline": "",
  "pov": "第三人称限知",
  "tense": "过去时",
  "createdAt": "2026-09-21T00:00:00+08:00"
}
```
- `premise` 存用户最初想法的**原文**，不改写，作为一切推断的根。
- `pov` / `tense` 参与审查项 F3（视角越界）与 G2（人称时态漂移）。

**`state.json`**
```json
{
  "schemaVersion": 1,
  "currentChapter": 12,
  "currentEventId": "E-003",
  "chapterStatus": "awaiting_user_review",
  "pendingReflow": false,
  "config": { "recentChapters": 5, "models": { "draft": null, "review": null, "brainstorm": null } }
}
```

**`setting/index.json`**
```json
{
  "schemaVersion": 1,
  "items": [
    { "id": "S-001", "name": "异能等级体系", "category": "world_rule",
      "summary": "一到九级，越级使用会反噬。", "establishedIn": 3, "tags": [],
      "deprecated": false, "updatedAt": "..." }
  ]
}
```
`category` 枚举：`world_rule | location | faction | item | taboo | custom`。

**`setting/S-001.md`**
```markdown
# S-001 异能等级体系
（详述）

## 修订记录
- [CH-003] 建立：一到九级。
- [CH-011] 补充：越级使用会反噬，反噬程度与等级差成正比。
```

**`characters/index.json`**
```json
{
  "schemaVersion": 1,
  "characters": [
    { "id": "C-001", "name": "李明", "aliases": ["老李"],
      "role": "protagonist", "firstAppeared": 1, "status": "alive",
      "lastUpdatedChapter": 7,
      "static": { "age": 34, "gender": "男", "appearance": "", "background": "",
                  "personality": "", "speechHabits": "", "goal": "", "fear": "" } }
  ]
}
```
`role` 枚举：`protagonist | antagonist | supporting | minor`。
`status` 枚举：`alive | dead | missing | unknown`。
`lastUpdatedChapter` 不是冗余：它让回填能发现"这个角色已经 8 章没更新过"，把遗漏从"靠记性"变成"可检测"。

**`characters/C-001.md`**
```markdown
# C-001 李明
（档案详述）

## 关键事件时间轴
- [CH-001] 在码头发现异常货箱。
- [CH-007] 向张局汇报，被要求组建研究团队。
```
时间轴**只记关键事件**，追加式。

**`relations.json`**
```json
{
  "schemaVersion": 1,
  "relations": [
    { "id": "R-001", "from": "C-001", "to": "C-002", "type": "subordinate",
      "directed": true, "status": "active", "since": 1,
      "history": [ { "chapter": 7, "change": "改为直接向张局汇报，绕过科长" } ] }
  ]
}
```
关系是有历史的（敌 → 友 → 决裂），所以 = 当前状态 + 追加式 history。

**`events/index.json`**
```json
{
  "schemaVersion": 1,
  "events": [
    { "id": "E-003", "title": "确认事态真实性", "stage": "第一幕",
      "status": "in_progress", "order": 30, "chapters": [11, 12],
      "dependsOn": ["E-002"], "leadsTo": ["E-004"],
      "origin": "ai_proposed",
      "plantedIn": null, "payoffExpectedAt": null }
  ]
}
```
`origin` 枚举：`ai_proposed | user_specified | foreshadow`。
`status` 枚举：`planned | in_progress | done | abandoned`。
伏笔复用同一结构：`origin: "foreshadow"`，`plantedIn` / `payoffExpectedAt` 才有值。

**`events/E-003.md`**
```markdown
# E-003 确认事态真实性

## 当前描述
李明发现问题并汇报给上级，上级要求组织研究团队确认事件真实性和威胁等级。

## 细化历史
- [CH-011] 确认事态真实性和严重等级、可信程度
- [CH-012] 填充为：李明发现问题并汇报给上级，上级要求组织研究团队确认事件真实性和威胁等级

## 涉及
- 人物：C-001 李明、C-002 张局
- 设定：S-001
- 章节：CH-011, CH-012
```
"当前描述"永远是最新最细的版本；"细化历史"保证每次填充可回看。审查项 D3 就是拿正文比"当前描述"。

**`chapters/index.json`**
```json
{
  "schemaVersion": 1,
  "chapters": [
    { "no": 12, "title": "汇报", "eventIds": ["E-003"], "primaryEventId": "E-003",
      "status": "accepted", "wordCount": 3210, "revisionCount": 3,
      "createdAt": "...", "acceptedAt": "..." }
  ]
}
```

**`chapters/012.summary.md`** 固定小节（便于机器读 + 人读）：
```markdown
## 梗概
（150–300 字）

## 出场
- 人物：C-001 李明、C-002 张局
- 地点：S-004 研究所

## 推进
- 事件：E-003（细化一档）

## 新增信息
- 设定：无
- 伏笔：E-009 埋设

## 结尾状态
（本章结束时的人物位置、处境、悬念）
```
摘要**只压缩不改写**，是"最近 N 章全文 + 更早摘要"策略的必备产物。

### 5.4 写入约定

| 文件 | 写入方式 |
|------|----------|
| `*.json` | 全量覆盖，先写 `<file>.tmp` 再 `rename`（原子） |
| 追加式 md 区段 | 在锚点（如 `## 关键事件时间轴`）下追加一行，绝不重写已有行 |
| 正文 `NNN.txt` | 全量覆盖，写前跑 markdown 校验（§5.5） |
| `logs/operations.jsonl` | 每次写操作追加一行 `{ts, op, target, actor}` |

追加式写入的实现要求：**先读、定位锚点、插入、整体覆盖写**。这看起来像"重写"，但校验层会断言"原有行全部保留"，否则拒绝写入。这是唯一能同时保证追加语义和原子性的做法。

### 5.5 正文校验

写盘前扫描，命中则**提示用户确认**，不硬拦：

| 模式 | 说明 |
|------|------|
| 行首 `#{1,6} ` | markdown 标题 |
| `**…**` | 加粗 |
| 行首 `> ` | 引用 |
| `` ` `` | 行内/围栏代码 |
| 行首 `- ` / `* ` 且后接空格 | 列表 |

只提示不阻断。理由：小说正文里出现 `-` 是合法的（破折号、对话），硬拦会误伤，而且用户要亲手编辑这个文件，最终解释权在他。

### 5.6 ID 分配

- 格式：`<前缀>-<三位序号>`，前缀 `S` / `C` / `R` / `E`。
- 分配时读取 `index.json` 的最大序号 + 1，**不回填已删除条目的空号**。
- 删除 = 置 `deprecated: true`（设定）或 `status: abandoned`（事件），**不物理删除**。理由：审查报告可能引用旧 ID，物理删除会让历史报告变成死链。

---

## 6. 数据写入口：custom tools

### 6.1 决策：LLM 只能通过工具写结构化数据 ✅

**决策**：LLM **不允许**用 `write` / `edit` 直接改 `*.json` 或资料 md。所有结构化写入走 `defineTool` 定义的自定义工具。

**根因**：JSON 一旦被 LLM 手写就会漂移 —— 字段名变体、漏 `schemaVersion`、数组变对象、引号不转义。而**所有审查依据都建立在这些文件上**；结构一坏，依据链就断，而"依据链"是这套设计的承重墙。所以写入必须经过 schema 校验层。

代价：多写十几个工具定义，且 LLM 不能自由发挥文件格式。收益：数据永远合法。

正文 `NNN.txt` 也走工具写入（`novel_chapter_write`），以便统一跑 §5.5 校验。

### 6.2 工具清单

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `novel_read_index` | 读某一类资料的索引（设定/人物/事件/章节） | `kind` |
| `novel_setting_upsert` | 新增或更新设定条目 | `id?`, `name`, `category`, `summary`, `body` |
| `novel_setting_append_revision` | 往设定条目追加修订记录 | `id`, `text` |
| `novel_character_upsert` | 新增或更新人物（静态档案 + 状态） | `id?`, `name`, `aliases`, `role`, `static` |
| `novel_character_append_timeline` | 给人物追加一条关键事件 | `id`, `chapter`, `text` |
| `novel_relation_upsert` | 新增或更新关系 | `id?`, `from`, `to`, `type`, `status` |
| `novel_relation_append_history` | 追加关系变更 | `id`, `chapter`, `change` |
| `novel_outline_write` | 写主线大纲（覆盖式） | `markdown` |
| `novel_outline_append_revision` | 追加大纲修订记录 | `text` |
| `novel_event_upsert` | 新增或更新事件元信息 | `id?`, `title`, `stage`, `origin`, `dependsOn`, `leadsTo`, `plantedIn`, `payoffExpectedAt` |
| `novel_event_refine` | 事件细化：更新"当前描述" + 追加"细化历史" | `id`, `chapter`, `description` |
| `novel_event_set_status` | 改事件状态 | `id`, `status` |
| `novel_event_link_chapter` | 把章节挂到事件 | `eventId`, `chapter`, `primary` |
| `novel_chapter_outline_write` | 写本章大纲（覆盖式 + 追加确认记录） | `chapter`, `markdown` |
| `novel_chapter_write` | 写正文（含 §5.5 校验） | `chapter`, `text` |
| `novel_chapter_summary_write` | 写本章摘要（§5.2 固定小节） | `chapter`, `sections` |
| `novel_chapter_report_write` | 写审查/去AI味/回填报告 | `chapter`, `kind`, `markdown` |
| `novel_state_update` | 更新状态机（受 §10.1 转移表约束） | `chapterStatus?`, `currentChapter?`, `currentEventId?`, `pendingReflow?` |
| `novel_inbox_append` | 追加想法 | `text`, `tags?` |
| `submit_findings` | **仅审查子会话可见**：提交结构化审查结果 | 见 §11.4 |
| `submit_brainstorm` | **仅脑暴子会话可见**：提交角色产出 | `angle`, `points[]` |

`novel_state_update` 必须校验状态转移合法性：非法转移（如 `drafted → accepted`）直接拒绝并返回错误文本。理由：状态机是闸门（§10.7）的执行体，如果它可被 LLM 绕过，闸门就不存在。

---

## 7. AI 层

### 7.1 会话类型

| 类型 | 创建方式 | 生命周期 | 用途 |
|------|----------|----------|------|
| **主会话** | `InteractiveMode` 持有，`SessionManager.create()` | 跨命令存活，每章一次 `newSession()` | 用户在层面里的对话、大纲讨论、正文生成 |
| **一次性子会话** | `createAgentSession({ sessionManager: SessionManager.inMemory(), ... })` | 单次任务，用完 `dispose()` | 审查员、脑暴角色、去 AI 味 |

子会话的特征：
- `SessionManager.inMemory()` —— 不落盘，不带历史，每次都是干净的。
- `tools` 白名单 —— 审查员只给 `read` 和 `novel_read_index`，**不给写工具**。这是 §11.1「审查者不改稿」的代码级实现。
- 不同角色通过 `systemPromptOverride` 注入不同人格。

### 7.2 每章清空上下文的实现

```typescript
// 章末 /done 成功后
await ctx.newSession({
  parentSession: ctx.sessionManager.getSessionFile(),
  setup: async (sm) => { /* 这里不注入任何前一章内容 —— 清空就是清空 */ },
});
```

新会话是全新的 `AgentSession`，消息历史为空。下一章的上下文完全由 §9 的装配器重建。主会话文件通过 `parentSession` 形成链，便于回溯"当时 AI 看到了什么"。

**注意**：`ctx.newSession()` 只在命令处理器里可用（`ExtensionCommandContext`），不能在事件处理器里调用。所以清空动作必须由 `/done` 命令驱动。

### 7.3 模型选择

```typescript
// src/ai/models.ts
type Purpose = "draft" | "review" | "brainstorm" | "utility";
```

优先级：
1. `state.json` 的 `config.models[purpose]`（用户在层面里可改）
2. `~/.pi/agent/settings.json` 的 `defaultModel` / `defaultProvider`
3. 第一个可用模型

默认（当前 pi 配置）：全部用 `deepseek` / `deepseek-flash`。用户可把 `draft` 换成强模型。
`thinkingLevel`：`draft` 用 `medium`，`review` 用 `high`（判定类任务值得多想），`brainstorm` 用 `medium`。

### 7.4 提示词分层

系统提示词按四段拼，从下到上：

| 段 | 内容 | 何时注入 |
|----|------|----------|
| **基础段** | 项目规则、数据布局说明、可用工具、"不许编造依据" | 常驻 |
| **层面段** | 当前层面的操作规则（例：大纲层只谈结构与冲突，不写正文） | `before_agent_start` 按模式注入 |
| **任务段** | 本回合任务（推演本章大纲 / 生成正文 / 回填） | 每次命令注入 |
| **子 agent 段** | 角色人格（审查员、脑暴角色），仅子会话 | 子会话创建时 |

层面段用 `systemPromptOptions.sections` 注入（pi 只把变化的部分作为补丁追加，保留前缀缓存）。基础段用 `DefaultResourceLoader.systemPromptOverride`。

### 7.5 层面数据的装载

呼应"每层只装载该层数据"：层面段注入的是**该层的索引摘要**，不是全量。

| 层面 | 注入 |
|------|------|
| `/setting` | 设定条目清单（id + name + summary） |
| `/person` | 人物清单（id + name + role + status + lastUpdatedChapter）+ 关系清单概要 |
| `/outline` | 大纲全文 + 事件清单（id + title + stage + status） |
| `/event` | 事件清单 + 大纲的阶段划分 |
| `/write` | 全部（写作需要全局视野），但仍走 §9 装配器的裁剪 |

### 7.6 结构化产出：用工具而不是 JSON 文本 ✅

子会话的产出通过 `submit_*` 工具提交，参数用 typebox 定义。

```typescript
const submitFindings = defineTool({
  name: "submit_findings",
  description: "提交审查发现。每条必须带依据引用。",
  parameters: Type.Object({
    findings: Type.Array(Type.Object({
      category: Type.String(),          // "A1".."G3"
      severity: Type.Union([Type.Literal("blocking"), Type.Literal("warning"), Type.Literal("note")]),
      paragraph: Type.Number(),
      phenomenon: Type.String(),
      evidence: Type.Array(Type.String()),  // ["setting#S-001", "chapter#012:para7"]
      suggestion: Type.String(),
    })),
  }),
  execute: async (_id, params) => {
    collector.push(...params.findings);
    return { content: [{ type: "text", text: `已记录 ${params.findings.length} 条` }], details: {} };
  },
});
```

**为什么不用"让模型输出 JSON 块再解析"**：模型可以写出一段"看起来像 JSON 的散文"，解析失败就只能重试或丢弃。工具参数走 schema 校验，模型没有这个机会。这直接决定了审查报告能不能被机械汇总和校验。

### 7.7 humanizer 的注入方式 ✅

**决策**：读 `~/.pi/agent/skills/humanizer/SKILL.md` 的**文件内容**，作为去 AI 味子会话的 system prompt 主体。

**不用**"让模型自己决定加载 skill"的方式。**根因**：本项目要求去 AI 味**必然发生**，而 skill 自主加载是模型驱动的 —— 模型这章想不起来加载，去 AI 味就静默跳过了。用户无法从结果上分辨"这章做过去 AI 味"和"这章模型忘了"。显式注入让"做没做"变成代码事实。

skill 内容里有一条关键接口：**用户给文风样本时，样本优先于通用模式规则**（包括破折号规则）。这正是我们需要的钩子 —— 样本 = 本书已写章节（§12.2）。

---

## 8. 命令系统与模式机

### 8.1 命令表

pi 已有内建命令（`/new` `/compact` `/quit` `/resume` `/settings` `/model` `/tree` `/fork` `/clone` `/session` `/export` `/import` `/reload` …）。**我们的命令名必须避开它们**，否则会出现 `/quit:1` 这种后缀化命名，用户体验直接崩。

| 命令 | 层面 | 行为 |
|------|------|------|
| `/setting` | → setting | 进入设定层 |
| `/person` | → person | 进入人物与关系层 |
| `/outline` | → outline | 进入大纲层 |
| `/event` | → event | 进入事件层 |
| `/write` | → write | 进入写作模式 |
| `/back` | ← 上一层 | 退回上一层；在顶层时提示用 `/quit` 退出程序 |
| `/help` | 任意 | 显示**当前层面**可用命令 |
| `/next` | write | 推演下一章大纲，交用户确认 |
| `/context` | write | 打印本章上下文包（每部分的 token 估算 + 内容） |
| `/review` | write | 手动补跑审查 |
| `/deai` | write | 手动补跑去 AI 味 |
| `/done` | write | 验收通过：落盘 + 回填校验 + 清空上下文 |
| `/brainstorm <方向>` | outline / event / write | 按你给定的方向起多 agent 头脑风暴 |
| `/init` | menu | 新建一本小说（书名 / 类型 / 核心想法） |

**⚠️ 与用户原始要求的偏差（必须说明）**：用户要求 `/quit` 退出大纲层。但 `/quit` 是 pi 内建的"退出程序"，占用它会导致冲突。故改名 `/back`。语义更准（回上层），且顶层 `/quit` 自然就是退出程序。

命令名与归属集中定义在 `src/extension/layers.ts`，改一处即可。该文件里 `COMMANDS`（命令自身信息）与 `LAYER_COMMAND_ORDER`（出现在哪些层面、什么顺序）是两张表 —— 拆开的直接好处是跨层出现的命令（如 `/brainstorm`）只定义一次、也只注册一次，否则会被 pi 后缀化成 `/brainstorm:1`、`:2`。冒烟测试用断言把这两张表锁在一起，防止手写漂移。

### 8.2 模式机

```
                    ┌─────────┐
        /quit ──────│  menu   │◄──────── /back (从任一层)
                    └────┬────┘
     ┌──────────┬────────┼────────┬─────────┬──────────┐
 /setting   /person  /outline  /event   /write      /help
     │          │        │        │         │
     ▼          ▼        ▼        ▼         ▼
 ┌────────┐┌────────┐┌────────┐┌────────┐┌─────────┐
 │setting ││ person ││outline ││ event  ││  write  │
 └────────┘└────────┘└────────┘└────────┘└─────────┘
```

模式存在扩展内存里（`modes.ts` 的单例）。进程重启回到 `menu`。
写模式内部还有章状态机（§10.1），是**另一个维度**的状态 —— 模式管"用户在哪个视角"，章状态管"这一章走到哪一步"。两者正交，不要混成一个枚举。

### 8.3 输入路由：不需要

**原计划的 `pi.on("input")` 拦截层已删除。**

当时的设想是：在非主菜单层面时拦截用户输入、打上层面标记，再让 `before_agent_start` 根据标记注入层面段。

**根因**：层面本来就是扩展进程内的一个变量（`layers.ts` 的 `currentLayer`）。`before_agent_start` 直接读它就行了，不需要把同一个信息先写进输入文本再读出来。那个拦截层是纯粹的中间环节，它增加的只有出错面。

所以现在的链路是：用户在层面里说话 → pi 把输入交给 agent → `before_agent_start` 读 `getLayer()` → 注入对应层面段。

（保留这个决定记录，是因为它容易被"重新发明"一遍。如果将来真需要改写用户输入，再引入 `input` 钩子，而不是为了将来可能的需求先摆一个空壳。）

### 8.4 状态指示

```typescript
ctx.ui.setStatus(`novelmaster`, `【${layerLabel(mode)}】${chapterLabel(chapterStatus)}`);
```

效果：编辑器旁常驻显示「【写作模式】第 12 章 · 待你验收」。用户永远知道自己在哪、这一章走到哪一步。

---

## 9. 上下文装配器

### 9.1 装配规格

`assemble({ novelRoot, chapter, eventId, config })` 返回 `ContextBundle`。

顺序原则：**从最稳定排到最易变，最"当下"的放最后。**

| # | 段 | 取数规则 | 理由 |
|---|----|----------|------|
| 1 | meta | `title` `genre` `premise` `logline` `pov` `tense`，全量 | "这本书是什么"的最小锚点 |
| 2 | 大纲 | `outline.md` 全文 | 判断是否脱轨的基准；省了它 AI 只看得到局部 |
| 3 | 设定 | **双层**：全部条目 `summary` + 相关条目全文 | 设定越写越多，全量全文淹没重点；只给相关的又会让 AI 编新设定（A2） |
| 4 | 当前事件 | 主事件全文（当前描述 + 细化历史） | 本章要推进的对象 |
| 5 | 相关人物 | 静态档案 + **全量**关键事件时间轴 | 时间轴条目短；截断会让 AI 以为早期经历没发生过 |
| 6 | 相关关系 | 仅**两端都在相关人物集合内**的关系 | 只提一端的关系是无效信息 |
| 7 | 最近 N 章正文 | `chapters/(c-N..c-1).txt` 顺序全文，**N 默认 5、可配置** | 唯一注入原文正文的部分，连续性最主要的来源 |
| 8 | 更早章节摘要 | `chapters/1..c-N-1.summary.md` 顺序 | 长篇不失忆的代价 |
| 9 | 本章大纲 | `NNN.outline.md`（用户确认版） | 放最后：当下任务最不该被忽略 |

### 9.2 相关性判定（第 3、5、6 段用）

```
相关人物 = 本章大纲标注的 characterIds
         ∪ 主事件涉及的人物
         ∪ 最近 N 章出场人物

相关设定 = 本章大纲标注的 settingIds
         ∪ 主事件涉及的设定
         ∪ 最近 N 章中出现过的设定
```

**全部取并集，不取交集。** 理由：宁可多喂一条人物档案，也不要因为 AI 不知道某个人而写出矛盾。两种错误的代价不对称 —— 多喂一条只是多点 token，漏一条会导致一致性事故，而一致性事故要靠用户逐条审出来。

"本章大纲标注的 characterIds / settingIds" 从 `NNN.outline.md` 的结构化头块读取：

```markdown
<!-- novelmaster:outline
characters: [C-001, C-002]
settings: [S-001, S-004]
events: [E-003]
primaryEvent: E-003
-->
```
用 HTML 注释承载机器可读信息，不影响人读和大纲本身的整洁。

### 9.3 缓存友好

第 1–6 段在相邻章节间几乎不变，只有 7–9 段会变。稳定部分放前面 = 可命中的 prompt 缓存前缀。
在"每章都要重建上下文"的架构下这不是小优化：**命中的恰好是占比最大的那部分**。

### 9.4 输出与可检查性

```typescript
interface ContextBundle {
  segments: Array<{
    key: string;            // "meta" | "outline" | "settings" ...
    title: string;
    content: string;
    estimatedTokens: number;
    sources: string[];      // ["setting/S-001.md", ...] 供追溯
  }>;
  totalEstimatedTokens: number;
}
```

`/context` 渲染成表格：每段的估算 token 数 + 来源文件 + 可展开内容。
成本主项是第 7 段（N 章正文），你得能一眼看到"这章上下文多大"，才能决定要不要把 N 调小。**看不见的东西调不动。**

---

## 10. 写作流水线

### 10.1 章状态机

```
not_started
   │ /next 且用户确认大纲
   ▼
outlined
   │ 生成正文成功
   ▼
drafted
   │ 自动审查完成
   ▼
auto_reviewed
   │ 自动去 AI 味完成
   ▼
deai_done
   │ 自动进入
   ▼
awaiting_user_review ◄──────────┐
   ├─ 用户手改 txt → user_edited │
   │        │                    │
   │        │ /reflow 触发回填     │
   │        ▼                    │
   │     reflowed ───────────────┘（用户可能继续改，回到 awaiting）
   │                              
   └─ 用户让 AI 改 → ai_revised ──┘（重新跑审查+去AI味）

reflowed
   │ /done（准入条件见 §10.7）
   ▼
accepted  → 清空上下文 → 询问是否写下一章
```

转移表的校验实现放在 `novel_state_update` 工具里。非法转移被拒绝。

### 10.2 /next：推演本章大纲

1. 读状态：必须是 `accepted` 的下一章，或首次进入 `not_started`。
2. 装配上下文（§9）—— 此时第 9 段（本章大纲）为空，注入的是"主事件当前描述 + 前一章结尾状态"。
3. 任务段提示：推演本章大纲，要求输出结构化头块（§9.2）+ 正文。
4. 写入 `NNN.outline.md`（草稿态）。
5. 进入**交互确认循环**：用户直接说话提修改意见 → 改 → 再确认。用户说"可以" → 状态置 `outlined`。

不设自动确认。用户没说通过就永远停在这一步。

### 10.3 生成正文

1. 装配完整上下文（含第 9 段）。
2. 主会话流式生成（用户在终端里看着它写）。
3. 生成完毕调 `novel_chapter_write` 落盘 → 触发 §5.5 校验。
4. 状态置 `drafted`。

### 10.4 自动审查

`drafted` 之后立即触发，无需用户操作。形态 = 阻塞（用户等待或看到进度提示）。
完成后写 `NNN.review.md`，状态置 `auto_reviewed`。

### 10.5 自动去 AI 味

`auto_reviewed` 之后立即触发。完成后写 `NNN.deai.md`，状态置 `deai_done` → 自动置 `awaiting_user_review` 并把两报告推到用户面前。

**顺序：审查在前，去 AI 味在后。**
审查改**事实层**（对不对），去 AI 味改**表达层**（像不像人写的）。反了的话，去 AI 味改过的句子再被判有问题，那一轮改写白做。

### 10.6 用户检查与修改（双通道）

| 通道 | 流程 |
|------|------|
| **用户自己改** | 直接编辑 `chapters/NNN.txt` → 回到 TUI 说一声 → AI 触发回填 → 状态 `reflowed` |
| **让 AI 改** | 在 TUI 里说怎么改 → AI 用 `novel_chapter_write` 改 → 重跑审查 + 去 AI 味 → 状态 `ai_revised` → 回到 `awaiting_user_review` |

**AI 改完必须重跑审查。** 因为它改的是正文，改完的正文还没有被审查过；不重跑的话，用户验收的就不是"被审查过的那一版"（§11.1 的核心约束）。

### 10.7 回填：结章闸门

回填动作（顺序固定）：

1. **人物时间轴** —— 遍历本章出场人物，判断"有没有值得记的关键事件"，有则 `novel_character_append_timeline`。只记关键事件，不记流水账。
2. **人物状态** —— 死了、失踪了、身份变了就更新 `status`。
3. **关系变更** —— 关系发生了变化则 `novel_relation_append_history` + 更新当前状态。
4. **事件细化** —— `novel_event_refine`：用本章实际发生的内容更新事件"当前描述"，并把旧描述压进"细化历史"（用户举的那个例子就是这个动作）。
5. **事件状态** —— 事件完成则 `novel_event_set_status`。
6. **伏笔** —— 本章埋了伏笔则建 `origin: foreshadow` 事件；本章回收了伏笔则置 `done`。
7. **新设定** —— 本章正文引入了设定里没有的世界规则 → 补设条目（或提示用户删改）。
8. **章节摘要** —— `novel_chapter_summary_write`。
9. **章节索引** —— 字数、`eventIds`、`primaryEventId`。
10. **状态** —— `pendingReflow = false`，`chapterStatus = reflowed`。
11. **回填报告** —— 写 `NNN.reflow.md`，逐条列出这次往追加式文件里写了什么。

`/done` 的**准入条件**（代码级）：
```
chapterStatus === "reflowed" && pendingReflow === false && 存在 NNN.summary.md
```
不满足则 `/done` 拒绝执行并说明缺什么。**未回填不许结章** —— 把"资料可信"变成代码约束，而不是靠自觉。

### 10.8 /done

通过准入检查后：
1. 写 `chapters/index.json` 的 `acceptedAt`，状态 `accepted`。
2. `ctx.newSession({ parentSession })` —— 清空上下文。
3. `ctx.ui.notify` 明确告知"上下文已清空"。
4. 询问：「第 13 章要从哪个事件开始？可以直接开始，也可以先调整事件。」
5. **不自动开始下一章。** 等用户发话。

---

## 11. 审查引擎

### 11.1 拓扑与核心约束

**约束：审查者是只读的，不允许修改稿子。** ✅

代码级实现：审查子会话的 `tools` 白名单只有 `read` / `novel_read_index`，**不给任何写工具**。它连改的能力都没有，不靠提示词约束。

两个理由：
1. 让写手自查自己的稿子有确认偏差。
2. 一旦允许它顺手改，**"哪一版是被审查过的"就说不清了** —— 而用户的验收对象必须是确定的。

```
                  ┌────────────────────┐
                  │  上下文包（裁剪版）  │
                  └─────────┬──────────┘
        ┌─────────────┬─────┴───────┬─────────────┐
        ▼             ▼             ▼             
  设定审查员     人物关系审查员   逻辑叙事审查员
   (A 类)        (B、C 类)      (D、E、F、G 类)
        │             │             │
        └──── submit_findings ──────┘
                      │
                      ▼
            代码级合并 + 依据校验
                      │
                      ▼
              chapters/NNN.review.md
```

### 11.2 审查员的输入

不注入 N 章正文全文（审查只需要对照，不需要文风）。裁剪版上下文：

| 段 | 是否注入审查员 |
|----|----------------|
| meta | 是 |
| 大纲 | 是 |
| 设定（双层） | 是 |
| 当前事件 | 是 |
| 相关人物 + 关系 | 是 |
| 最近 N 章正文 | 是（判定时间线、伏笔、信息越界必需） |
| 更早章节摘要 | 是 |
| 本章大纲 | 是 |
| **本章正文** | 是（审查对象） |

### 11.3 检查清单（7 类 28 项）

**A. 设定一致性**（依据 `setting/`）
- A1 世界规则违背 —— 正文中的现象或能力与某条 `world_rule` 冲突
- A2 设定未确立就用 —— 引入了 setting 中不存在的规则/组织/地点/术语。判定：补设条目，还是删掉表述
- A3 设定漂移 —— 正文实际改写了已有设定，但条目未更新
- A4 禁忌被忽略 —— `taboo` 类限制被角色轻易绕过

**B. 人物一致性**（依据 `characters/`）
- B1 性格偏离 —— 行为与 `personality` / `speechHabits` 不符
- B2 能力越界 —— 用了档案中不具备的能力
- B3 信息越界 —— 角色知道了以他的位置不可能知道的信息（悬疑／推理的命脉）
- B4 状态错误 —— 已死、失踪、重伤的角色照常活动
- B5 称谓不一致 —— 同一角色被不同称呼，需区分"有意"与"笔误"
- B6 目标漂移 —— 行为与 `goal` / `fear` 冲突且正文没有交代转变

**C. 关系一致性**（依据 `relations.json`）
- C1 关系状态不符 —— 已决裂却仍以旧方式相处
- C2 亲疏与称呼不匹配 —— 称呼的亲密程度与关系类型矛盾
- C3 关系变化未留痕 —— 正文里关系变了，但 `history` 没有对应记录

**D. 时间线与因果**（依据 `events/`、`chapters/`、前文）
- D1 时间矛盾 —— 季节、昼夜、时长、"三天前"与实际章节间隔对不上
- D2 因果断裂 —— 事件发生缺少前置条件（`dependsOn` 里的前置事件还没发生）
- D3 事件进度倒挂 —— 正文内容超出或倒退于事件的"当前描述"
- D4 行程不合理 —— 两地距离与耗时对不上

**E. 剧情与大纲**（依据 `outline.md`、`events/`）
- E1 主线脱轨 —— 本章与所在阶段目标无关联
- E2 伏笔未回收 —— 筛 `origin == foreshadow && status == planned`，按 `payoffExpectedAt` 排序输出还挂着的伏笔
- E3 情节重复 —— 本章事件与前面某章高度相似

**F. 逻辑与叙事**（依据本章正文 + 前文）
- F1 情节漏洞 —— 角色本可轻易解决的问题被绕开
- F2 动机不足 —— 关键决定缺少铺垫
- F3 视角越界 —— 与 `meta.pov` 冲突（如限知视角写了别人的心理）
- F4 信息冗余 —— 重复交代前文已充分建立的信息
- F5 场景内物理逻辑 —— 同一场景里位置、人数、物件前后不一致

**G. 硬性规范**（依据本项目规则）
- G1 正文含 markdown 语法
- G2 人称／时态漂移 —— 对照 `meta.pov` / `meta.tense`
- G3 章节字数异常 —— 相对本书均值偏离过大（弱提示）

### 11.4 `submit_findings` 的输出结构

见 §7.6 的 typebox 定义。每个 finding 必填 `category` / `severity` / `paragraph` / `phenomenon` / `evidence[]` / `suggestion`。

**`evidence` 是必填的**（`Type.Array(Type.String())` 允许空数组，但汇总阶段会把空 evidence 的条目降级为 `note` 并标注"无依据"）。这是"不能凭感觉"在数据层上的落地。

### 11.5 合并与依据校验

```
for each finding from all reviewers:
    refs = validateEvidence(finding.evidence)     # §11.6
    if refs.invalid.length > 0:
        finding.severity = "note"
        finding.evidenceInvalid = refs.invalid    # 标注哪条依据不存在
        finding.note = "依据引用无效，可能是编造"

dedupe by (category, paragraph): 合并，保留最高 severity
排序：blocking → warning → note，同级按 paragraph 升序
```

**不做 LLM 汇总层。** 根因：条目已经是结构化的，机械合并足够；多一层 LLM 只会引入新的编造风险 —— 而"编造"正是这套审查机制要防的东西。

**冲突条目**（两个审查员对同一段落判定矛盾）→ 两条都保留，标 `conflict: true`，交给用户判断。理由：两个独立视角矛盾这件事本身就是高价值信号，机械取一方的做法会把它抹平。

### 11.6 依据引用校验 ✅

这是"有据可查"从口号变成机制的地方。

| 引用格式 | 校验方式 |
|----------|----------|
| `setting#S-001` | `setting/index.json` 中存在且 `deprecated !== true` |
| `character#C-001` | `characters/index.json` 中存在 |
| `relation#R-001` | `relations.json` 中存在 |
| `event#E-003` | `events/index.json` 中存在 |
| `chapter#012` | `chapters/012.txt` 存在 |
| `chapter#012:para7` | 文件存在且段落数 ≥ 7（尽力而为） |
| `outline` | `outline.md` 存在且非空 |
| `meta#pov` | `meta.json` 字段存在 |

**校验失败的含义**：如果一个"依据"根本不存在，那这条指控就是幻觉。降级为 `note` 并明示，用户一眼能看出哪些条目是 AI 编的。

### 11.7 报告渲染（`NNN.review.md`）

段落级粒度、三级严重度、blocking 排最前。

```markdown
# 第 12 章 审查报告
- 生成：2026-09-21 16:40
- 审查员：设定 / 人物关系 / 逻辑叙事（3 个独立会话）
- 统计：blocking 2 ｜ warning 4 ｜ note 1 ｜ 依据无效 1

## blocking

### [A2] 设定未确立就用
- **位置**：第 3 段
- **现象**：出现"共鸣场"，setting 中无对应条目
- **依据**：`setting/index.json`（检索无命中）
- **建议**：补设条目，或删去该表述

### [D3] 事件进度倒挂
- **位置**：第 17 段
- **现象**：正文出现"研究团队已确认"，但 E-003 当前描述仍是"上级要求组建团队"
- **依据**：`event#E-003`（当前描述） ／ `chapter#012:para17`
- **建议**：调低正文进度，或把这次推进作为事件填充正式写入

## warning
…

## note
### [B5] 称谓不一致 ⚠️ 依据无效
- **位置**：第 9 段
- **现象**：同一人称谓在"科长"与"处长"之间切换
- **依据**：`character#C-099` ← **该 ID 不存在，本条依据可能为编造**
```

---

## 12. 去 AI 味引擎

### 12.1 三步

复用 `humanizer` skill 的四步法，压成三步：

1. **标记** —— 按 25 条模式（§1–§25）由强到弱标记命中位置。注意 skill 的分级：§1–§5 单次命中即可动，标 *weak alone* 的需多条同时出现才算。
2. **改写** —— 以本书已写章节为 voice sample，产出改稿。保留全部事实与特异细节。
3. **复检** —— 走 skill 第 3 步，专查最容易漏网的五类：not-X-but-Y 对比、单句收尾、破折号、三段式排比、加粗标签。

### 12.2 文风样本的选取

humanizer 规定：**用户给样本时，样本优先于通用模式规则**（包括它的破折号禁令）。

样本 = 本书**最近 N 章正文**（与 §9 第 7 段同一批，N 默认 5）。已在写第 1 章时无样本 → 退回通用规则，并在报告里标注"无文风样本"。

**为什么用本书自己的前文当样本**：避免越改越像通用腔。通用规则能把 AI 味洗掉，但洗完之后是什么腔调，取决于拿什么当参照。锚在本书前文上，改完至少还是"这本书的写法"。

### 12.3 输出（`NNN.deai.md`）

固定三节。「命中清单」**单独成节**：用户的核对动作是逐条检查它标的对不对，所以它必须是一份能从上往下划勾的清单，不是一段说明文字。

```markdown
# 第 12 章 去 AI 味报告
- 文风样本：chapters/007.txt ~ 011.txt（5 章）

## 一、命中清单
| # | 模式 | 位置 | 原文片段 | 处理 |
|---|------|------|----------|------|
| 1 | §1 not-X-but-Y | 第 5 段 | "这不是背叛，而是自保" | 已改写 |
| 2 | §8 破折号 | 第 12 段 | "他停住了 —— 不是因为怕" | 已改写 |
| 3 | §6 三段式 | 第 18 段 | "他知道规则。他知道代价。他知道后果。" | 已改写 |

## 二、改前
（本章原文）

## 三、改后
（改写结果）
```

「改前」保留原文的理由：用户可能不同意某处改写，需要能对照着把它改回去。

---

## 13. 各资料层的行为规格

### 13.1 `/setting`

- 进入时注入条目清单（id + name + summary + establishedIn）。
- 支持动作：新增条目、改条目、追加修订记录、废止条目。
- 自然语言输入 → AI 用工具落盘。
- 写完回显 diff 摘要，让用户确认。

### 13.2 `/person`

- 进入时注入人物清单 + 关系概要。
- 支持：新增人物、改档案、追加时间轴、改状态、改关系、追加关系变更。
- **人物档案里的静态字段不追历史**（改了就是改了）；只有时间轴是追加式。理由：静态档案是"当前设定"，用户有权直接修正笔误；时间轴是"历史事实"，不可改。

### 13.3 `/outline`

- 交互式创建：先问类型 / 名称 / 核心想法（读 `meta.premise`）→ 整理 → 分阶段主线大纲 → 用户逐段确认。
- **多 agent 讨论**：用户说"讨论一下这几条线"时，起 3 个独立会话（如：结构视角 / 冲突视角 / 节奏视角），各自产出，父层综合。
- **逻辑校验**：起独立会话检查大纲自身的因果链（事件 `dependsOn` 是否成环、是否可达成、有无无动机转折）。
- 每次修改往 `outline.md` 底部追加「修订记录」。

### 13.4 `/event`

- 进入时注入事件清单 + 大纲阶段划分。
- 推演事件：AI 按阶段生成候选事件（标题 + 一句话），用户挑选 / 修改 / 自己指定（`origin: user_specified`）。
- **推演后必须用户确认**，不自动写入。
- 事件细化：由图章回填驱动（§10.7 第 4 步），本层也可手动细化。
- 伏笔：用户说"这里埋一个线"→ 建 `origin: foreshadow` 事件，填 `plantedIn` 和 `payoffExpectedAt`。

### 13.5 多 agent 脑暴协议

**硬约束：脑暴必须由用户先给出方向才启动。** ✅ 用户明确要求，理由是"否则容易偏离用户思路"。

实现：脑暴命令要求一个 `angle` 参数（用户的想法）。

```
用户：脑暴一下 —— 如果李明其实是内鬼，故事会怎么走？
        │
        ├─ 角色由 AI 按 angle 自适应生成（不写死角色表）
        │
   ┌────┴────┬─────────┬─────────┐
   ▼         ▼         ▼         ▼
 角色1     角色2     角色3     角色4
 (独立会话，各自 submit_brainstorm)
   └────┬────┴─────────┴─────────┘
        ▼
   父层综合（不是投票）
   ├─ 共识
   ├─ 真实分歧
   ├─ 被忽略的选项
   └─ 新暴露的假设
```

**父层综合，不投票。** 投票式少数服从多数会掩盖真实分歧，而分歧恰恰是用户最需要看到的东西。

每个脑暴角色都是 `createAgentSession({ sessionManager: SessionManager.inMemory() })`，带不同 `systemPromptOverride`，用完 dispose。
角色数默认 4–5，与 §9 的 N（最近章节数）无关。

---

## 14. 错误处理与失败模式

| 情形 | 行为 |
|------|------|
| JSON schema 校验失败 | 拒绝写入，返回错误给 LLM 让它修正；连续 3 次失败则中止并报给用户 |
| 追加式写入检测到原有行丢失 | 拒绝写入并报警（这是数据损坏级信号） |
| 子会话创建失败 | 中止该子任务，报错；**不降级为单会话审查**（否则"3 个独立视角"变成 1 个，用户以为是 3 个） |
| 子会话超时 | 中止并报错，不静默用部分结果 |
| `submit_findings` 未被调用 | 该审查员记为"未产出"，报告里明示；不假装它审过了 |
| 依据校验全部失败 | 报告标注"本次审查依据普遍无效"，建议用户检查数据层 |
| 模型调用失败/重试耗尽 | pi 自身处理重试；扩展层只在 `agent_end` 后检查是否有正文产出 |
| 用户在写正文中途 Ctrl+C | 状态停在 `outlined`，不落盘半截正文 |
| `/done` 准入不满足 | 拒绝，逐条列出缺什么 |
| 正文写入命中 markdown 标记 | 提示用户确认，不阻断 |
| 小说根目录不存在/不是合法小说 | 启动时检测，提示初始化 |

**失败时绝不静默降级。** 宁可报错停下，也不要让用户以为某一步做了、其实没做 —— 用户判断是整套流程的最终判据（§2 成功判据），建立在假信号上的判断会让整套设计失效。

---

## 15. 里程碑

| # | 内容 | 完成标志 | 状态 |
|---|------|----------|------|
| 1 | 骨架 | `novelmaster` 能起 TUI；`/help` `/back` 生效；小说根目录可初始化 | ✅ 已交付 |
| 2 | 数据层 + 工具层 | schema、原子写、ID 分配、全部 `novel_*` 工具可用；手工验证读写正确 |
| 3 | `/setting` `/person` | 两层跑通，能建条目、能改、能追加 |
| 4 | `/outline` | 交互式建大纲 + 修订记录；多 agent 讨论可用 |
| 5 | `/event` | 事件推演、确认、细分、伏笔、事件↔章节关联 |
| 6 | 上下文装配器 + `/context` | 能打印完整上下文包，token 估算准确 |
| 7 | `/write` 最小闭环 | `/next` → 生成正文 → 落盘 |
| 8 | 审查引擎 | 3 审查员 + 依据校验 + 报告落盘 |
| 9 | 去 AI 味引擎 | humanizer 注入 + 文风样本 + 报告落盘 |
| 10 | 回填 + `/done` | 闸门生效；清空上下文并通知 |
| 11 | 多 agent 脑暴 | 定向脑暴可用 |

**顺序理由**：审查的依据来自数据层，所以数据层先做；审查做不出来，写作闭环就不成立；脑暴不阻塞主链路，放最后。

---

## 16. 实施进度

### 里程碑 1 · 骨架（2026-09-21 已交付）

**落地的东西**

| 文件 | 作用 |
|------|------|
| `bin/novelmaster.mjs` | 可执行入口（`npm link` 后可直接敲 `novelmaster`） |
| `src/cli.ts` | 组装运行时（挂 novelMaster 扩展）+ 起 `InteractiveMode` |
| `src/extension/layers.ts` | 层面定义、命令表、当前层面状态 |
| `src/extension/commands.ts` | 命令注册与实现 |
| `src/extension/render.ts` | `/help`、层面段、项目段、状态栏文本 |
| `src/extension/prompt-sections.ts` | `before_agent_start` 注入 |
| `src/data/{paths,io,schema,init,novel}.ts` | 数据层基础：配置、原子写、模型、建库、打开 |
| `tests/smoke.ts` | 冒烟测试（不启 TUI） |

**已验证**

1. `node src/cli.ts` 能起 TUI，启动横幅里出现 `<inline:novelmaster>`，状态栏显示【主菜单】。
2. `npx tsc --noEmit` 无错。
3. `node tests/smoke.ts` 全过（扩展装配、层面表自检、数据层、提示词注入）。

**验收方式**：在项目目录跑 `npm start`，敲 `/init` 建一本书（书名 → 类型 → 核心想法），再 `/outline` 进大纲层说一句话（AI 应已带上层面规则），`/help` 看命令，`/back` 回主菜单。

**开发中发现并修正的两个问题**

| 问题 | 根因 | 处理 |
|------|------|------|
| `/brainstorm` 在三个层面各注册一次，被 pi 后缀化成 `/brainstorm:1`、`:2`、`:3` | 命令定义散在各层的列表里，同一个命令被写了三遍 | 拆成 `COMMANDS`（命令自身）与 `LAYER_COMMAND_ORDER`（归属与顺序）两张表，注册按 `COMMANDS` 的键去重 —— 重复注册在结构上不可能发生。并用测试把两张表锁在一起 |
| 原计划的输入拦截层没有存在理由 | 层面状态本就是进程内变量，`before_agent_start` 直接读即可 | 删除 `input-router.ts`，记录在 §8.3 |

**一个降级说明**：里程碑 1 还没交付任何 `novel_*` 写入工具，所以现在 LLM 直接改 `*.json` 是可能的。层面提示词里已写明"等工具交付后走工具"，但这不是强制。强制校验在里程碑 2。

---

## 17. 未决与后续

### 16.1 ❓ 仍待定

- 审查报告的段落编号方式：按空行分段计数，还是按"第 N 段"由 AI 自行判断？（前者可校验，后者会漂）
- `/context` 的默认详细程度（全量打印可能很长）
- 事件 ↔ 章节的 `order` 排序依据：事件自身序 or 阶段内序

### 16.2 后续版本

- **v2：多小说**。目录结构已按"每本小说一个根目录"设计，切换 = 换 `cwd` + 重载数据层 + `newSession`。模型与命令层基本不用改。
- 导出（epub / docx）
- 设定层与人物层的图形化关系视图

---

## 附录 A：与用户原始要求的偏差清单

设计过程中对用户原始描述做的改动，全部列在这里以便复核。

| 用户原话 | 设计 | 原因 |
|----------|------|------|
| `/quit` 退出大纲 | 改为 `/back` | `/quit` 是 pi 内建"退出程序"，占用会冲突 |
| 「不使用 markdown 语法」 | 只约束正文 txt | 资料层必须结构化，否则审查无据可查 |
| 「创建多个 agent」 | 多个独立 `AgentSession` | pi SDK 无多 agent 概念；独立会话视角不互相污染、成本可控 |
| 无 | 新增 `/context` 命令 | 装配器是质量中枢，不可见就不可调 |
| 无 | 新增 `pendingReflow` 闸门 | 用户判断建立在资料可信之上，资料失真会让判断失效 |
| 无 | 新增 `lastUpdatedChapter` 字段 | 让"某角色久未更新"从靠记性变成可检测 |
| 无 | 新增「依据引用校验」 | 让"不能凭感觉"从口号变成机制 |

## 附录 B：关键设计决策与理由

| 决策 | 根因 |
|------|------|
| 宿主式架构，不自研 TUI | 价值在数据层/装配器/审查规则，不在终端渲染 |
| 结构化数据只经工具写入 | JSON 手写必然漂移，而依据链是承重墙 |
| 追加式与覆盖式分离 | 历史可改 = 依据可伪造 |
| 审查者只读 | 写手自查有确认偏差；且"哪一版被审查过"必须确定 |
| 结构化提交（工具参数）而非 JSON 文本 | 模型无法产出"看起来像 JSON 的散文"绕过校验 |
| 依据引用可校验 | 不存在的依据 = 幻觉，必须能自动识别 |
| 不做 LLM 汇总层 | 结构化数据机械即可合并；多一层 LLM 只增加编造风险 |
| 脑暴父层综合、不投票 | 投票掩盖真实分歧，而分歧是最有价值的输出 |
| 审查在前、去 AI 味在后 | 事实层先定，表达层后改；反了那一轮改写白做 |
| humanizer 显式注入而非 skill 自主加载 | "做没做去 AI 味"必须是代码事实，不能是模型的心情 |
| 失败不静默降级 | 用户判断是最终判据，假信号会让整套设计失效 |
