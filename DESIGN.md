# novelMaster 设计文档

> 本文档是 novelMaster 的**唯一权威设计依据**。
> 任何 Agent 会话在任何任务动手前必须先完整阅读本文档，并按本文档的导航索引读取相关子文档；
> 修改功能必须先改文档并保证逻辑自洽，再改代码；
> 代码完成后必须与文档保持一致，不一致时以文档为准修改代码。

- 版本：v1（2026-09-21）

---

## 1. 项目概述

novelMaster 是一个跑在终端里的 AI 辅助小说写作工具，单人单机使用。

### 1.1 解决什么问题

通用 AI 聊天窗口写小说有三个致命问题，本项目逐条对冲：

| 问题 | 对策 |
|------|------|
| 上下文越滚越脏 | 每章新建会话，AI 记忆用完即弃；下一章由「上下文装配器」重建（见 `docs/design/ai.md`） |
| 记不住人物与设定 | 人物档案、人物关系、设定条目结构化落盘，成为可引用的「依据」（见 `docs/design/data.md`） |
| 长篇之后前后矛盾 | 每章强制审查，逐条对照依据给出问题清单，并校验依据真实存在（见 `docs/design/pipeline.md`） |

它把写作变成一条流水线，每一步都要用户拍板：

**想法 → 大纲 → 事件推演 → 章节大纲 → 正文 → 审查 → 去 AI 味 → 用户验收 → 资料回填 → 清空上下文 → 下一章**

### 1.2 运行环境

| 项 | 说明 |
|------|------|
| 宿主/平台 | Node.js 命令行（Termux / Linux / macOS / Windows），需要一个有 TTY 的终端 |
| 运行时 | Node **>= 22.19**（依赖原生 TypeScript 类型剥离），开发机实测 v26 |
| 技术栈 | TypeScript（ESM）、pi agent SDK（`@earendil-works/pi-coding-agent`）、typebox |
| 架构形态 | **pi 扩展** + pi 的 `InteractiveMode` 作为 TUI 宿主（理由见 `docs/design/architecture.md`） |
| 外部文档 | pi 文档位于 pi 安装目录下的 `docs/`；本机为 `/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent/docs` |

### 1.3 目标与非目标

**目标**：单人、单机、单本；全链路打通；审查有据可查；所有资料持久化且用户能直接读、直接改。

**非目标（v1 明确不做，避免范围膨胀）**

- 多本小说切换与管理（目录结构已预留，见 `docs/design/data.md`）
- 云同步、账号、多人协作
- 富文本编辑器、所见即所得排版
- epub / docx 等格式化导出
- 不经用户输入直接生成大纲
- 未经用户给定方向的自动剧情脑暴
- 自研终端渲染层

---

## 2. 名词表（全项目统一，禁止擅自变更）

术语在本项目里有**精确含义**。代码、数据、提示词三处必须一致；新代码不得为这些概念另造同义词。

| 术语 | 含义 |
|------|------|
| **小说** | 一个根目录下的全部内容。v1 只支持同时打开一本。 |
| **设定条目** | 世界观的一条可引用事实（规则、地点、势力、物品、禁忌）。ID 形如 `S-001`。 |
| **人物档案** | 静态档案（性格、外貌、目标…）+ 按章节时间追加的关键事件时间轴。ID 形如 `C-001`。 |
| **关系** | 两个人之间的有向关系，带当前状态和变更历史。ID 形如 `R-001`。 |
| **事件** | 剧情推进的一个单元，可跨多章。有「当前描述」和「细化历史」。ID 形如 `E-003`。 |
| **伏笔** | `origin: foreshadow` 的事件。已埋未收 = `status: planned`。**不是独立数据结构。** |
| **章节大纲** | 写正文前先推演、经用户确认的那份细纲。 |
| **正文** | 章节实际内容，纯 txt，是**唯一**受「禁止 markdown」约束的文件。 |
| **摘要** | 每章生成一次的压缩记录，供后续章节注入上下文。只压缩不改写。 |
| **审查报告** | 对照设定/人物/关系/事件/前文，逐条带依据引用的问题清单。 |
| **去 AI 味报告** | 命中清单 + 改前 + 改后。 |
| **回填** | 用户验收后，把本章进展写进人物时间轴、关系历史、事件细化历史、摘要等持久资料。 |
| **层面（layer）** | 交互视角之一：主菜单／设定／人物／大纲／事件／写作。每层只装载该层数据。 |
| **上下文包** | 一次生成前装配好的完整输入集合。 |
| **主事件** | 一章可挂多个事件，但必须有一个 `primaryEventId`。 |

---

## 3. 命名与约定（全项目统一，禁止擅自变更）

### 3.1 标识符与文件名

| 约定 | 值 | 用途 |
|------|-----|------|
| 设定条目 ID | `S-001` 起，三位序号 | 可被审查引用；**永不复用**，废弃改 `deprecated` |
| 人物 ID | `C-001` 起 | 同上 |
| 关系 ID | `R-001` 起 | 同上 |
| 事件 ID | `E-001` 起 | 同上；伏笔也用 `E-` 前缀 |
| 章节号 | 三位零填充，从 `001` 起 | 文件名与引用都用这个形式 |
| 章节伴生文件 | `NNN.txt` / `NNN.outline.md` / `NNN.summary.md` / `NNN.review.md` / `NNN.deai.md` / `NNN.reflow.md` | 同章全部文件共享 `NNN` 前缀，便于按章取用 |
| 应用配置目录 | `.novelmaster/`（位于运行目录） | 存放 `config.json` |
| 默认小说根目录 | `novels/<slug>/`（位于运行目录） | 每本小说一个目录 |
| 操作留痕 | `<小说根>/logs/operations.jsonl` | 追加式 |
| schema 版本字段 | `schemaVersion`，当前 `1` | 每个 JSON 文档都有 |

### 3.2 层面与命令

| 约定 | 值 |
|------|-----|
| 层面标识 | `menu` / `setting` / `person` / `outline` / `event` / `write` |
| 层面入口命令 | 与层面同名：`/setting` `/person` `/outline` `/event` `/write` |
| 退出层面 | `/back`（**不是 `/quit`** —— `/quit` 是 pi 内建「退出程序」） |
| 命令名的唯一来源 | `src/extension/layers.ts` 的 `COMMANDS` 与 `LAYER_COMMAND_ORDER` |

**硬约束：新命令名不得与 pi 内建命令冲突。** pi 内建表见 `docs/design/interaction.md`；撞名会被 pi 后缀化成 `/quit:1`。此约束已由 `tests/smoke.ts` 机械校验。

### 3.3 数据规则

| 约定 | 值 |
|------|-----|
| 追加式（只增不改） | 人物时间轴、事件细化历史、关系变更史、`inbox.md`、`logs/` |
| 覆盖式（当前结论） | `meta.json`、`state.json`、`outline.md` 正文、设定/人物条目正文、`relations.json` 当前状态 |
| 正文编码 | 纯文本，**禁止 markdown 语法** |
| 资料格式 | markdown / JSON（不受纯文本约束）—— 这是审查「有据可查」的前提 |
| 唯一进度真相 | `<小说根>/state.json`，章状态不得在别处重复记录 |
| 原子写 | 所有写入走「临时文件 + rename + fsync」（`src/data/io.ts`） |
| 数据结构定义 | 只有 `src/data/schema.ts` 一处（typebox 定义），TS 类型由 `Static<>` 推导；新对象必须写 `additionalProperties: false` |
| LLM 写入口 | 走 `novel_*` 工具；`write`/`edit` 写小说根被阻断（`src/tools/guard.ts`）。shell 保留，是已知旁路 |
| ID 分配 | 读 `index.json` 最大序号 + 1，**不回填空号** |

### 3.4 依据引用格式

审查报告引用依据时必须用以下格式，且**可被机械校验**（校验实现见 `docs/design/pipeline.md`）：

```
setting#S-001          设定条目
character#C-001        人物档案
relation#R-001         关系
event#E-003            事件
chapter#012            章节文件
chapter#012:para7      章节的第 7 段
outline                主线大纲
meta#pov               meta.json 的字段
```

### 3.5 文档内的交叉引用约定

**跨文档引用一律用「文件路径 + 章节标题」，不用章节编号。** 例：`见 docs/design/data.md「正文校验」`。

理由：章节编号会随文档演进漂移，标题是稳定的锚点。文档重构后编号必然变，用编号的引用会静默指向错误位置。

---

## 4. 文件结构

### 4.1 代码与文档

```
novelMaster/
├── DESIGN.md                     # 本文件（根设计文档）
├── CLAUDE.md                     # 面向 Agent 的项目说明与强制规则
├── docs/design/                  # 设计子文档（见 §5 导航索引）
├── bin/novelmaster.mjs           # 可执行入口
├── src/                          # 源码（结构见 docs/design/architecture.md）
├── tests/                        # 测试：all.ts 是入口（npm test），smoke.ts / data.ts / tools.ts 是三个套件
├── package.json / tsconfig.json / .gitignore
├── novels/                       # 默认小说根目录（git 忽略）
└── .novelmaster/config.json      # 当前打开的小说（git 忽略）
```

### 4.2 小说数据目录

每本小说的内部布局属于数据结构，见 `docs/design/data.md「目录树」`。

---

## 5. 模块导航索引

**按需加载**：先读本文件，再根据任务定位下列子文档，不要全量加载。

| # | 子文档 | 一句话说明 | 何时该读 |
|---|--------|-----------|----------|
| 1 | [`docs/design/architecture.md`](docs/design/architecture.md) | 架构形态、模块分层与职责、源码结构、外部依赖与 API、开发与调试 | 要动代码结构、加依赖、跑起来调试时 |
| 2 | [`docs/design/data.md`](docs/design/data.md) | 小说目录树、四条数据原则、全部文件 schema、写入约定、ID 分配、LLM 写入口工具清单 | 要读写任何资料、改数据结构时 |
| 3 | [`docs/design/ai.md`](docs/design/ai.md) | 会话类型与生命周期、每章清空上下文、模型选择、提示词分层、结构化产出、humanizer 注入、上下文装配器 | 要碰 AI 调用、提示词、上下文装配时 |
| 4 | [`docs/design/interaction.md`](docs/design/interaction.md) | 命令表与模式机、状态指示、各资料层行为规格、多 agent 脑暴协议、核心流程 | 要加命令、改层面行为、改交互流程时 |
| 5 | [`docs/design/pipeline.md`](docs/design/pipeline.md) | 章状态机、单章闭环八步、回填闸门、审查引擎（7 类 28 项）、去 AI 味引擎 | 要动写作流水线、审查规则、去 AI 味时 |
| 6 | [`docs/design/ops.md`](docs/design/ops.md) | 错误处理与失败模式、验收清单、已知限制、里程碑与实施进度、未决问题 | 测试验收、排查故障、规划下一步时 |
| 7 | [`docs/design/decisions.md`](docs/design/decisions.md) | 关键设计决策与根因、与用户原始要求的偏差清单、踩坑记录 | **动手前必读** —— 防止把已否决的方案重新发明一遍 |

---

## 6. 文档-代码一致性约束

本设计文档（含全部子文档）描述的设计与代码必须保持双向一致：

- 任何功能修改：**先改文档**（保证逻辑自洽：命名约定、数据结构、流程、接口前后一致、无矛盾），**再改代码**；
- 代码完成后：核对与文档一致，不一致时**以文档为准修改代码**；
- 若实践中发现文档的设计有误，应先**在文档中修正设计并说明原因**，再同步代码；
- 文档随项目增长后按树状结构继续拆分：本文件保持精简（概述 + 全局约定 + 导航索引），细节下沉到 `docs/design/`，并同步更新 §5 的索引。
