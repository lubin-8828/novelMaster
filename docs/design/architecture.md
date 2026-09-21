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
| 结构化产出 | `defineTool` + typebox `Type.Object` | 工具参数走 schema 校验，模型无法用「看起来像 JSON 的散文」绕过 |
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
| **流程层**（`pipeline.md`） | 章状态机、审查编排、回填闸门 | 不碰文件格式 |
| **上下文装配器**（`src/ai/context-assembler.ts`） | 把磁盘数据装成上下文包 | 不知道谁调用它 |
| **AI 层**（`src/ai/`） | 会话工厂、子 agent 拓扑、提示词 | 不做文件 I/O 决策 |
| **工具层**（`src/tools/`） | LLM **唯一**的数据写入口（schema 校验 + 原子写 + ID 分配） | 不做业务判断 |
| **数据层**（`src/data/`） | schema、读写、路径、校验 | 不感知 AI |

**单向依赖**：命令 → 流程 → 装配器/AI → 工具 → 数据。反向调用一律视为设计错误。

---

## 4. 源码结构

```
novelMaster/
├── bin/novelmaster.mjs           # 可执行入口（转发到 src/cli.ts，无构建步骤）
├── src/
│   ├── cli.ts                    # 组装 runtime + InteractiveMode
│   ├── extension/
│   │   ├── index.ts              # 扩展工厂：装载命令与提示词
│   │   ├── layers.ts             # 层面定义 + 命令表 + 当前层面状态
│   │   ├── commands.ts           # 命令注册与实现
│   │   ├── render.ts             # /help、层面段、项目段、状态栏的文本渲染
│   │   └── prompt-sections.ts    # before_agent_start 注入
│   ├── data/
│   │   ├── paths.ts              # 根目录解析、文件名常量、应用配置
│   │   ├── schema.ts             # 数据模型的类型定义
│   │   ├── io.ts                 # 原子写、追加写、JSON 读写
│   │   ├── init.ts               # 新建一本小说（目录树 + 初始文件 + slug）
│   │   ├── novel.ts              # 打开小说（读 meta + state）
│   │   ├── ids.ts                # ID 分配与永不复用              ← 里程碑 2
│   │   ├── settings.ts  characters.ts  relations.ts  events.ts  chapters.ts
│   │   └── validate.ts           # 依据引用校验                  ← 里程碑 8
│   ├── tools/                    # pi custom tools（LLM 写入口）  ← 里程碑 2
│   ├── ai/
│   │   ├── session-factory.ts    # 主会话 / 只读子会话            ← 里程碑 7
│   │   ├── models.ts             # 按用途取模型                  ← 里程碑 7
│   │   ├── context-assembler.ts  # 上下文装配器                  ← 里程碑 6
│   │   ├── review/               # 审查引擎                      ← 里程碑 8
│   │   ├── deai/                 # 去 AI 味引擎                  ← 里程碑 9
│   │   └── brainstorm/           # 多 agent 脑暴                 ← 里程碑 11
│   └── prompts/                  # 各角色 system prompt 模板      ← 里程碑 4
├── tests/smoke.ts                # 冒烟测试（不启动 TUI）
├── docs/design/                  # 设计子文档
└── novels/                       # 默认小说根目录（git 忽略）
```

标注 `← 里程碑 N` 的目录/文件尚未创建，属于规划。已交付内容见 `ops.md「实施进度」`。

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
| `typebox` (1.3.27) | 自定义工具的参数字典与数据结构校验 | 与 pi 的 `defineTool` 配套使用；pi 自身也用同一版本 |
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
| `npm test` | 冒烟测试，不启动 TUI |
| `npm run typecheck` | `tsc --noEmit`，纯类型检查 |

### 7.3 调试方法

| 场景 | 做法 |
|------|------|
| 看扩展有没有加载 | 启动横幅的 `[Extensions]` 段应出现 `<inline:novelmaster>` |
| 看当前层面 | 状态栏应显示 `【主菜单】` / `【大纲】` / `【写作】…` |
| 验证数据层改动 | 在 `tests/smoke.ts` 加断言，而不是手工点 TUI —— 手工点不可复现 |
| 验证提示词注入 | 冒烟测试直接调用捕获到的 `before_agent_start` 处理器，断言 `systemPromptOptions.sections` 的内容（无需调用模型，零成本） |
| 非 TTY 环境试启动 | `timeout 15 node src/cli.ts < /dev/null` —— pi 能在无 TTY 下渲染，可用来确认启动链路没断 |
| 看会话落盘 | `~/.pi/agent/sessions/` 下按 cwd 分目录的 `.jsonl` |

### 7.4 注意事项

- **没有热更新**：改完源码必须重启进程。pi 的 `/reload` 只重载扩展与资源，不重载本项目已被 Node 加载的模块。
- **扩展是内联的**（`extensionFactories`），所以改 `src/extension/*` 后 `/reload` 也无效 —— 必须重启。
- **测试放在 `tests/`**，用 `node tests/smoke.ts` 直接跑，不用测试框架。理由：本项目断言少而具体，引入框架的收益低于它的依赖与配置成本。测试必须自己 `process.exit(1)` 表示失败，否则 CI 无法感知。
