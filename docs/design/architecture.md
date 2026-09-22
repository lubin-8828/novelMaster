# architecture — 架构形态、模块职责、依赖与开发

> 父文档：[`DESIGN.md`](../../DESIGN.md)
> 全局名词与命名约定见父文档 §2 / §3，本文档不重复。

---

## 1. 架构形态：宿主式，不自研 TUI

**决策**：novelMaster 是一个 **pi 扩展**，由 pi 的 `InteractiveMode` 作为宿主运行。

```
bin/novelmaster.mjs
  └─ src/cli.ts
       └─ createAgentSessionRuntime(createRuntime)          // 建运行时
            └─ createAgentSessionServices({
                 cwd, agentDir,
                 resourceLoaderOptions: {
                   extensionFactories: [{ name: "novelmaster", factory: novelMasterExtension }]
                 }
               })
                 └─ createAgentSessionFromServices(...)         // 建会话
                      └─ new InteractiveMode(runtime, {...}).run()   // pi 自带完整 TUI
                           └─ 扩展内注册：命令 / 自定义工具 / 事件钩子 / TUI 组件
```

### 1.1 为什么不自己写终端界面

`@earendil-works/pi-tui` 提供了**零件**：`Editor`、`ScrollView`、`Markdown`、`SelectList`、`SettingsList`、`Text`、`Box`、`VStack`，以及渲染器 `TuiAltScreen` + `ProcessTerminal`。

但它**不提供**「编辑器 + 对话 + 流式输出 + 会话管理 + 命令补全」这一整层。自研等于重写 pi 已经有的 80%，而且 pi 每次升级都要跟着改。宿主式架构把这一层完全白拿。

**根因**：本项目的价值在**数据层 + 上下文装配器 + 审查规则**三处，不在终端渲染上。把工程预算花在已经有现成实现的地方是浪费。

### 1.2 代价（必须承认）

UI 形态受 pi 约束：输入框是 pi 的编辑器，命令必须以 `/` 开头，无法做全屏自绘面板，启动横幅会显示 pi 的 logo。

用户要的是「命令行式交互，类似 TUI」，所以这个代价实际为零。但如果将来要做全屏自绘面板，这条决策就要重新评估 —— 那时应当把 `TuiAltScreen` 拿出来单独跑，而不是在 pi 的扩展里硬塞。

---

## 2. 与 pi 的集成点（已核对 API，v0.86.1）

| 需求 | 用什么 | 关键约束 |
|------|--------|----------|
| 分层命令 | `pi.registerCommand(name, { description, handler })` | handler 拿到 `ExtensionCommandContext` |
| 层内自然语言对话 | **不需要钩子** | 层面状态是扩展内存里的变量，`before_agent_start` 直接读 |
| 每层只装载该层数据 | `pi.on("before_agent_start", …)` 改 `event.systemPromptOptions.sections` | pi 只把**变化的部分**作为补丁追加（省 token + 保留前缀缓存）。整体替换 `systemPrompt` 会丢缓存 |
| 每章清空上下文 | `ctx.newSession({ parentSession, setup, withSession })` | **只在命令处理器里可用**，事件处理器里调用会死锁 |
| 一次性子 agent | `createAgentSession({ sessionManager: SessionManager.inMemory(), tools, customTools, resourceLoader })` | 用完必须 `dispose()` |
| 结构化产出 | `pi.registerTool` + typebox `Type.Object` | 工具参数走 schema 校验，模型无法用「看起来像 JSON 的散文」绕过。需要在数组里传递工具定义时用导出的 `defineTool` 包一层以保留类型推导 |
| 写入护栏 | `pi.on("tool_call")` 返回 `{ block: true }` | 拦 `write`/`edit` 写小说根，把 LLM 导向 `novel_*` 工具。**不动 `bash`** —— 关 shell 的代价大于那条旁路的风险（见 `data.md「写入护栏」`） |
| 自定义对话框 | `ctx.ui.select` / `confirm` / `input` / `editor` / `custom` | `ctx.ui.custom` 仅 `ctx.mode === "tui"` 可用 |
| 状态栏 | `ctx.ui.setStatus(key, text)` | key 固定为 `novelmaster` |
| 模型 | `ModelRuntime.create()` / `resolveCliModel()` | 默认读 `~/.pi/agent/settings.json` |
| humanizer skill | 显式读取 `~/.pi/agent/skills/humanizer/SKILL.md` 内容注入 | **不**依赖模型自主加载 skill（理由见 `ai.md「humanizer 的注入方式」`） |

---

## 3. 分层与职责

| 层 | 职责 | 不知道什么 |
|----|------|-----------|
| **CLI 入口**（`src/cli.ts`） | 建运行时、拼扩展、起 `InteractiveMode` | 业务 |
| **命令层**（`src/extension/commands.ts`） | 解析命令、切层面、驱动流程、调用下层 | 不讲道理，不拼提示词 |
| **层面装载**（`src/extension/layer-data.ts`） | 按层面读该层索引，渲染成给 AI 与给人共用的清单 | 不做写入，不碰详述 |
| **流程层**（`pipeline.md`） | 章状态机、审查编排、回填闸门 | 不碰文件格式 |
| **上下文装配器**（`src/ai/context-assembler.ts`） | 把磁盘数据装成上下文包 | 不知道谁调用它 |
| **AI 层**（`src/ai/`） | 会话工厂、子 agent 拓扑、模型解析、提示词 | 不做文件 I/O 决策 |
| **工具层**（`src/tools/`） | LLM 的**规范**数据写入口（schema 校验 + 原子写 + ID 分配 + 操作留痕）；同时是写入护栏的执行体 | 不做业务判断 |
| **数据层**（`src/data/`） | typebox schema、读写、路径、ID 分配、状态转移表、校验 | 不感知 AI |

**单向依赖**：命令 → 流程 → 装配器/AI → 工具 → 数据。反向调用一律视为设计错误。

---

## 4. 源码结构

```
novelMaster/
├── bin/novelmaster.mjs           # 可执行入口（转发到 src/cli.ts，无构建步骤）
├── src/
│   ├── cli.ts                    # 组装 runtime + InteractiveMode
│   ├── extension/
│   │   ├── index.ts              # 扩展工厂：装载命令、提示词、工具与护栏
│   │   ├── layers.ts             # 层面定义 + 命令表 + 当前层面状态
│   │   ├── commands.ts           # 命令注册与实现
│   │   ├── render.ts             # /help、层面段、项目段、状态栏的文本渲染
│   │   ├── layer-data.ts         # 按层面装载该层索引摘要（给 AI 也给人）
│   │   └── prompt-sections.ts    # before_agent_start 注入
│   ├── data/
│   │   ├── paths.ts              # 根目录解析、文件名常量与路径构造、应用配置
│   │   ├── errors.ts             # DataError（错误文本面向 LLM）
│   │   ├── schema.ts             # typebox 定义 + Static 推导的类型 + 校验辅助
│   │   ├── io.ts                 # 原子写、追加写、JSON 读写
│   │   ├── doc.ts                # 带 schema 校验的文档读写 + 追加式数组断言
│   │   ├── diff.ts               # 字段差异计算（写入结果的可读摘要）
│   │   ├── md.ts                 # md 区段追加/替换、保行断言、文档合成
│   │   ├── ids.ts                # ID 分配与永不复用、章节号补零
│   │   ├── log.ts                # operations.jsonl 操作留痕
│   │   ├── state.ts              # 章状态机转移表 + 状态更新校验
│   │   ├── init.ts               # 新建一本小说（目录树 + 初始文件 + slug）
│   │   ├── novel.ts              # 打开小说（宽容版 / 严格版）
│   │   ├── meta.ts               # 元信息写入（logline / pov / tense）
│   │   ├── settings.ts  characters.ts  relations.ts  events.ts  chapters.ts  inbox.ts  outline.ts
│   │   └── validate.ts           # 依据引用校验                  ← 里程碑 8
│   ├── tools/                    # pi custom tools（LLM 唯一写入口）
│   │   ├── index.ts              # 注册全部 novel_* 工具
│   │   ├── guard.ts              # 护栏：拦 write/edit 写小说根（不动 shell）
│   │   ├── helper.ts             # withNovel / 错误文本 / 留痕封装 / 失败计数
│   │   └── read.ts  setting.ts  character.ts  relation.ts  outline.ts  meta.ts  event.ts  chapter.ts  state.ts  inbox.ts  brainstorm.ts  review.ts  deai.ts
│   ├── ai/                       # AI 层：会话、模型、编排。不做文件 I/O 决策
│   │   ├── models.ts             # 按用途取模型（draft / review / brainstorm）
│   │   ├── session.ts            # 只读子会话工厂
│   │   ├── tokens.ts             # token 估算（CJK 按字算，不按字符 /4）
│   │   ├── parallel.ts           # 并发跑 N 个子任务的骨架（失败处置的单一实现）
│   │   ├── context-assembler.ts  # 上下文装配器（本项目的中枢）
│   │   ├── brainstorm/           # 多 agent 讨论（脑暴）
│   │   │   ├── index.ts          # 编排：并发起角色、收集产出、失败处置
│   │   │   └── input.ts          # 角色输入包（基线 + 视角）
│   │   ├── review/               # 审查引擎
│   │   │   ├── index.ts          # 编排：3 个只读审查员 + 依据校验 + 落盘
│   │   │   ├── checklist.ts      # 7 类 28 项清单（写死在代码）
│   │   │   ├── input.ts          # 审查输入（九段 + 本章正文 + 预筛事实）
│   │   │   ├── merge.ts          # 机械合并 + 标记依据无效
│   │   │   └── report.ts         # NNN.review.md 渲染
│   │   └── deai/                 # 去 AI 味引擎
│   │       ├── index.ts          # 编排：一个改写子会话 + 落盘 + 触发复查
│   │       ├── skill.ts          # humanizer skill 的显式注入
│   │       ├── scope.ts          # 机械范围检查（专有名词 / 数字）
│   │       └── report.ts         # NNN.deai.md 渲染
│   └── prompts/                  # 各角色 system prompt 模板      ← 里程碑 4
├── tests/
│   ├── harness.ts                # check / section / 失败计数
│   ├── all.ts                    # 测试入口（npm test）
│   ├── smoke.ts                  # 扩展装配、层面表、提示词注入、文档一致性
│   ├── layers.ts                 # 层面装载、写作流程与 /next
│   ├── context.ts                # 上下文装配器与 /context 输出
│   ├── data.ts                   # 数据层（schema / ID / 追加式 / 状态机）
│   ├── tools.ts                  # 工具层与写入护栏
│   ├── brainstorm.ts             # 多 agent 讨论
│   ├── report.ts                 # 审查引擎（清单 / 合并 / 依据校验 / 渲染）
│   └── deai.ts                   # 去 AI 味引擎（skill 注入 / 范围检查 / 报告）
├── docs/design/                  # 设计子文档
└── novels/                       # 默认小说根目录（git 忽略）
```

标注 `← 里程碑 N` 的目录/文件尚未创建，属于规划。已交付内容见 `ops.md「实施进度」`。

**测试为何拆四个文件。** 里程碑 2 之后断言数会从 112 涨到 300 量级，全塞进一个文件会轻易过千行。拆分的界跟源码一致：`data.ts` 对应 `src/data/`，`tools.ts` 对应 `src/tools/`，`smoke.ts` 管装配与文档一致性。`harness.ts` 提供共享的 `check`/`section`，`all.ts` 是唯一入口并负责 `process.exit`。

**继续不用测试框架。** `node:test` 是内建的、零依赖，但本项目的断言全是「比较两个已知值」和「断言抛不抛错」，框架提供的 fixture / mock / 并发调度在这里没有用武之地。多一层框架就多一层「断言为什么没跑」的可能。

---

## 5. 无构建步骤

**Node 22.19+ 原生剥离 TypeScript 类型**，因此：

- `node src/cli.ts` 直接可跑，**没有编译产物、没有 dist/**；
- 相对导入写显式的 `.ts` 后缀（Node 按真实路径解析，不做扩展名猜测）；
- `tsc` 只用于类型检查（`npx tsc --noEmit`），不产出文件；
- `bin/novelmaster.mjs` 是一个 4 行的 shim，只做 `import "../src/cli.ts"`。

**为什么值得**：少一层构建就少一层「源码与运行物不一致」的可能，也少一套「改完忘了重新构建」的失败模式。对一个要长期演进的项目，这个收益比省下的那点启动开销值得多。

**限制**：类型剥离不等于类型转换。不能用 `enum`、`namespace`、构造器参数属性（`constructor(private x: T)`）等需要代码生成的语法。写这些语法会在运行时直接报错。

---

## 6. 外部依赖与 API 清单

| 依赖/API | 用途 | 文档地址 |
|----------|------|----------|
| `@earendil-works/pi-coding-agent` (v0.86.1) | Agent 运行时、会话管理、TUI 宿主、扩展 API | pi 安装目录下 `docs/sdk.md`、`docs/extensions.md`、`docs/tui.md` |
| `typebox` (1.3.27) | **数据结构的唯一定义源**：`Type.Object` 定义 → `Static<>` 推导 TS 类型 → `Value.Check` 运行时校验；自定义工具的参数字典也用它 | 与 pi 的 `registerTool` 配套；pi 自身也用同一版本。**每个对象必须显式写 `additionalProperties: false`** —— 默认是允许额外属性的 |
| Node.js >= 22.19 | 运行时 + 原生 TS 类型剥离 | https://nodejs.org/api/typescript.html |
| TypeScript ^5.9 | 仅类型检查 | https://www.typescriptlang.org/docs/ |

**不引入**：任何 TUI 框架、任何数据库、任何 ORM、任何构建工具。理由：单机单用户，JSON + txt 足够，且用户要求资料可读可改。

**pi 的关键导出（已在本机核实存在）**：`createAgentSessionRuntime`、`createAgentSessionServices`、`createAgentSessionFromServices`、`createAgentSession`、`InteractiveMode`、`DefaultResourceLoader`、`getAgentDir`、`SessionManager`、`SettingsManager`、`ModelRuntime`、`defineTool`。

---

## 7. 开发与调试

### 7.1 环境准备

```bash
npm install          # 148 个包，无原生模块构建步骤
```

### 7.2 常用命令

| 命令 | 作用 |
|------|------|
| `npm start` | 启动 TUI（等价 `node src/cli.ts`） |
| `npm test` | 全部测试（等价 `node tests/all.ts`），不启动 TUI |
| `npm run typecheck` | `tsc --noEmit`，纯类型检查 |

### 7.3 调试方法

| 场景 | 做法 |
|------|------|
| 看扩展有没有加载 | 启动横幅的 `[Extensions]` 段应出现 `<inline:novelmaster>` |
| 看当前层面 | 状态栏应显示 `【主菜单】` / `【大纲】` / `【写作】…` |
| 验证数据层改动 | 在 `tests/data.ts` 加断言，而不是手工点 TUI —— 手工点不可复现 |
| 验证工具与护栏 | 在 `tests/tools.ts` 加断言：直接调工具的 `execute()`，再用捕获到的 `tool_call` 处理器验护栏，全程不经模型、零成本 |
| 验证提示词注入 | 冒烟测试直接调用捕获到的 `before_agent_start` 处理器，断言 `systemPromptOptions.sections` 的内容（无需调用模型，零成本） |
| 非 TTY 环境试启动 | `timeout 15 node src/cli.ts < /dev/null` —— pi 能在无 TTY 下渲染，可用来确认启动链路没断 |
| 看会话落盘 | `~/.pi/agent/sessions/` 下按 cwd 分目录的 `.jsonl` |

### 7.4 注意事项

- **没有热更新**：改完源码必须重启进程。pi 的 `/reload` 只重载扩展与资源，不重载本项目已被 Node 加载的模块。
- **扩展是内联的**（`extensionFactories`），所以改 `src/extension/*` 后 `/reload` 也无效 —— 必须重启。
- **测试放在 `tests/`**，用 `node tests/smoke.ts` 直接跑，不用测试框架。理由：本项目断言少而具体，引入框架的收益低于它的依赖与配置成本。测试必须自己 `process.exit(1)` 表示失败，否则 CI 无法感知。
