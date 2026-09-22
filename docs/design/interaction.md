# interaction — 命令、层面与核心流程

> 父文档：[`DESIGN.md`](../../DESIGN.md)
> 写作流水线（章状态机与八步闭环）见 [`pipeline.md`](pipeline.md)；上下文装配见 [`ai.md`](ai.md)。

---

## 1. 命令表

pi 已有内建命令。**我们的命令名必须避开它们**，否则会出现 `/quit:1` 这种后缀化命名，用户体验直接崩。此约束由 `tests/smoke.ts` 机械校验。

### 1.1 pi 内建命令（不可占用）

```
/login /logout /llama /model /thinking /scoped-models /settings /resume /new
/name /session /tree /trust /fork /clone /compact /copy /export /import
/share /bug /reload /hotkeys /changelog /quit
```

### 1.2 本项目命令

| 命令 | 层面 | 行为 | 状态 |
|------|------|------|------|
| `/init` | menu | 新建一本小说（书名 / 类型 / 核心想法） | ✅ 已实现 |
| `/setting` | → setting | 进入设定层 | ✅ 已实现 |
| `/person` | → person | 进入人物与关系层 | ✅ 已实现 |
| `/outline` | → outline | 进入大纲层 | ✅ 已实现 |
| `/event` | → event | 进入事件层 | ✅ 已实现 |
| `/write` | → write | 进入写作模式 | ✅ 已实现 |
| `/help` | 任意 | 显示**当前层面**可用命令 | ✅ 已实现 |
| `/back` | ← 上一层 | 退回上一层；在主菜单时提示用 `/quit` 退出程序 | ✅ 已实现 |
| `/context` | write | 打印本章上下文包（每部分的 token 估算 + 内容） | 里程碑 6 |
| `/next` | write | 推演下一章大纲，交用户确认 | 里程碑 7 |
| `/review` | write | 审查（章末自动触发，也可手动补跑） | 里程碑 8 |
| `/deai` | write | 去 AI 味（章末自动触发，也可手动补跑） | 里程碑 9 |
| `/done` | write | 验收通过：落盘 + 回填校验 + 清空上下文 | 里程碑 10 |
| `/brainstorm <方向>` | outline / event / write | 按用户给定的方向起多 agent 头脑风暴 | 里程碑 11 |

**与用户原始要求的偏差**：用户要求 `/quit` 退出大纲层。但 `/quit` 是 pi 内建的「退出程序」，占用它会导致冲突。故改名 `/back` —— 语义更准（回上层），且顶层 `/quit` 自然就是退出程序。

### 1.3 命令名的唯一来源与两张表

命令名与归属集中定义在 `src/extension/layers.ts`，改一处即可。

该文件里有两张表，**必须分开**：

| 表 | 内容 |
|----|------|
| `COMMANDS` | 命令自身的信息（说明、交付里程碑） |
| `LAYER_COMMAND_ORDER` | 命令出现在哪些层面、按什么顺序显示 |

**拆开的直接收益**：跨层出现的命令（如 `/brainstorm` 出现在三个层面）只定义一次、也只注册一次。如果按「层面 → 命令列表」遍历注册，同名命令会被注册三遍，pi 会把它们后缀化成 `/brainstorm:1`、`:2`、`:3`。

注册循环遍历 `COMMANDS` 的键，所以重复注册在结构上不可能发生。冒烟测试用断言把两张表锁在一起，防止手写漂移。

**未实现的命令也要注册。** 若只在 `/help` 里列出却不注册，敲下去会被当成普通文本交给 AI —— 用户以为执行了命令，实际是 AI 在揣摩他的意思。这是最会误导人的形态。所以待实现的命令都注册了占位处理器，明确提示「计划在里程碑 N 交付」。

---

## 2. 模式机

```
                    ┌─────────┐
        /quit ──────│  menu   │◄──────── /back (从任一层)
                    └────┬────┘
     ┌──────────┬────────┼────────┬─────────┐
 /setting   /person  /outline  /event   /write
     │          │        │        │         │
     ▼          ▼        ▼        ▼         ▼
 ┌────────┐┌────────┐┌────────┐┌────────┐┌─────────┐
 │setting ││ person ││outline ││ event  ││  write  │
 └────────┘└────────┘└────────┘└────────┘└─────────┘
```

- 当前层面存在扩展进程内的变量（`layers.ts` 的 `currentLayer`），**不落盘**。进程重启回到 `menu`。
- 层面与章状态机（见 `pipeline.md「章状态机」`）是**两个正交维度**：层面管「用户在哪个视角」，章状态管「这一章走到哪一步」。不要把它们合成一个枚举。

---

## 3. 状态指示

```typescript
ctx.ui.setStatus("novelmaster", renderStatus(layer, novel, chapter));
```

渲染规则（实现在 `src/extension/render.ts`）：

| 情形 | 显示 |
|------|------|
| 有小说，非写作层 | `【大纲】 《深海回声》` |
| 有小说，写作层 | `【写作】 《深海回声》 第 12 章 · 待你验收` |
| 未打开小说 | `【主菜单】` |

章状态的中文标签集中在 `render.ts` 的 `CHAPTER_STATUS_LABEL`，保证状态栏与报告口径一致。

用户永远知道自己在哪、这一章走到哪一步 —— 这是「每步都要拍板」这条设计的前提：不知道自己在哪，就没法判断该不该拍板。

---

## 4. 核心流程

### 4.1 启动

```
用户执行 novelmaster
  └─ src/cli.ts
       ├─ cwd = process.cwd()；agentDir = getAgentDir()
       ├─ createAgentSessionRuntime(createRuntime)
       │    └─ createAgentSessionServices({ cwd, agentDir,
       │         resourceLoaderOptions: { extensionFactories: [{ name: "novelmaster", factory }] } })
       │         └─ createAgentSessionFromServices(...)
       ├─ 打印 runtime.diagnostics 里的 warning / error 到 stderr
       └─ new InteractiveMode(runtime, { modelFallbackMessage }).run()
            └─ 扩展装载 → registerCommands + registerPromptSections
                 └─ session_start → refreshStatus（画状态栏）
```

### 4.2 建书（`/init`）

```
/init
  ├─ ctx.ui.input("书名")           ← 空则取消；不建无名之书
  ├─ ctx.ui.input("类型")           ← 逗号/顿号分隔，可留空
  ├─ ctx.ui.editor("核心想法")      ← 空则取消（没有它，后面一切推断都没有根）
  ├─ root = <cwd>/novels/slugify(书名)
  ├─ initNovel(root, { title, genre, premise })
  │    ├─ 若已存在 meta.json → 抛错拒绝（不覆盖已有小说）
  │    ├─ mkdir setting/ characters/ events/ chapters/ logs/
  │    └─ 写 10 个初始文件（meta/state/relations/4 个 index/inbox/outline/operations）
  ├─ writeConfig(cwd, { novelRoot: root })
  └─ 回报书名、根目录、已建文件清单，并提示下一步
```

`/init` 只负责「建目录 + 记下最初的想法」。把想法整理成大纲是 `/outline` 的事 —— 两者分开，用户才有机会在建完书之后先改主意。

### 4.3 从零到第一章（完整链路）

```
/init                  建书，premise 落盘
   ↓
/outline               交互式搭主线：一句话主题 → 阶段划分 → 主要冲突 → 结局
   ↓                   （逐段确认，每段确认后才继续；每次修改往「修订记录」追加一行）
/event                 按阶段推演事件 → 用户挑选/修改/自指定 → 确认后写入
   ↓                   （一个事件可铺多章；伏笔是 origin=foreshadow 的事件）
/write                 进入写作模式
   ↓
/next                  装配上下文 → 推演本章大纲 → 用户确认 → 状态 outlined
   ↓
（生成正文）            主会话流式生成 → novel_chapter_write 落盘 → 状态 drafted
   ↓
自动审查                3 个只读子会话 → submit_findings → 依据校验 → NNN.review.md
   ↓
自动去 AI 味            humanizer 注入 + 本书前文为文风样本 → NNN.deai.md
   ↓
用户验收                自己改 txt，或让 AI 改；改完告知 AI
   ↓
回填资料                人物时间轴/状态、关系历史、事件细化、伏笔、新设定、摘要
   ↓
/done                  闸门校验通过 → accepted → 清空上下文 → 询问下一章
```

八步闭环的详细规格在 `pipeline.md`。

### 4.4 层内自然语言处理

```
用户在某个层面里说一句话
  └─ pi 把输入交给 agent（扩展不拦截）
       └─ before_agent_start
            ├─ 读 getLayer()
            ├─ sections["novelmaster-layer"] = renderLayerSection(layer)
            ├─ 若已打开小说 → sections["novelmaster-project"] = renderProjectSection(...)
            └─ pi 把变化的 section 作为补丁追加到系统提示词
                 └─ 模型带层面规则回答
```

**没有输入拦截层。** 原计划用 `pi.on("input")` 在非主菜单层面拦截输入、打上层面标记 —— 已删除。理由：层面本来就是扩展进程内的一个变量，`before_agent_start` 直接读它即可，不需要把同一个信息先写进输入文本再读出来。那个拦截层是纯粹的中间环节，增加的只有出错面。

（保留这条记录是因为它容易被「重新发明」一遍。将来若真需要改写用户输入，再引入 `input` 钩子，而不是为了将来可能的需求先摆一个空壳。）

---

## 5. 各资料层行为规格

### 5.1 `/setting` — 世界观设定层

- 进入时装载条目清单（`id` + `name` + `category` + `summary` + `establishedIn`）：一份注入给 AI（见 `ai.md「层面数据的装载」`），一份用 `sendMessage` 显示给用户。两份共用同一个渲染函数。
- 支持动作：新增条目、改条目、追加修订记录、废止条目（`deprecated: true`）。
- 自然语言输入 → AI 用工具落盘 → **工具返回 diff 摘要**（改了哪些字段、从什么变成什么）→ AI 把摘要转述给用户。
- **「确认」是转述式的，不是闸门。** 改动由用户发起，他看到 diff 后可以说「改回去」或「第 3 条别动」。不设阻断式确认的理由：那会要求 LLM 再调一次工具，对「改个摘要」这种操作太重 —— 与正文校验的区别在于「谁发起的改动」（见 `data.md「写入结果的 diff 摘要」`）。
- 废止而不是删除（见 `data.md「ID 分配」`）。

### 5.2 `/person` — 人物层

- 进入时装载人物清单（`id` + `name` + `role` + `status` + `lastUpdatedChapter`）+ 关系概要：同样一份给 AI 注入、一份给用户显示。
- 支持：新增人物、改档案、追加时间轴、改状态、改关系、追加关系变更。
- 改完同样回显 diff 摘要（同 §5.1）。
- **静态字段不追历史**（改了就是改了），**时间轴与关系变更史是追加式**。理由：静态档案是「当前设定」，用户有权直接修正笔误；时间轴是「历史事实」，不可改。
- **`lastUpdatedChapter` 出现在清单里不是装饰**：它让「这个角色已经 8 章没更新过」从靠记性变成一眼可见（见 `data.md「characters/index.json」`）。

### 5.3 `/outline` — 故事大纲层

- 进入时装载**大纲全文** + 事件清单（`id` + `title` + `stage` + `status`）：同样是给 AI 注入、给用户显示各一份（见 `ai.md「层面数据的装载」`）。
- 交互式创建：先读 `meta.premise`（用户最初想法的原文，不改写）→ 与用户逐段推鑫一句话主题 / 阶段划分 / 主要冲突 / 结局 → 每段确认后才继续。
- 推鑫完的一句话简介写进 `meta.logline`（用 `novel_meta_update`）；`pov` / `tense` 也在这里定 —— 它们不是装饰，审查项 F3（视角越界）与 G2（人称时态漂移）要靠它们判定（见 `data.md`）。
- 大纲正文用 `novel_outline_write`（覆盖式）；每次修改往「修订记录」追加一行（`novel_outline_append_revision`，追加式）。
- 改完同样回显 diff（同 §5.1 的约定）。
- **多 agent 讨论**：用户说「讨论一下这几条线」时，起多个独立会话（结构 / 冲突 / 节奏等视角自适应），各自产出，父层综合。协议见 §6。**状态：待交付。**
- **逻辑校验**：起独立会话检查大纲自身的因果链（事件 `dependsOn` 是否成环、是否可达成、有无无动机转折）。**状态：待交付。**
- **不写正文，不细化到章节** —— 那是 `/event` 与 `/write` 的事。

### 5.4 `/event` — 事件推演层

- 进入时注入事件清单 + 大纲阶段划分。
- 推演事件：AI 按阶段生成候选事件（标题 + 一句话），用户挑选 / 修改 / 自己指定（`origin: user_specified`）。
- **推演后必须用户确认，不自动写入。**
- 事件细化：由图章回填驱动（见 `pipeline.md「回填：结章闸门」`），本层也可手动细化。
- 伏笔：用户说「这里埋一个线」→ 建 `origin: foreshadow` 事件，填 `plantedIn` 和 `payoffExpectedAt`。
- **一个事件可以铺很多章**。

### 5.5 `/write` — 写作模式

只负责进入模式与展示状态；具体流水线见 `pipeline.md`。

---

## 6. 多 agent 脑暴协议

**硬约束：脑暴必须由用户先给出方向才启动。** 理由是「否则容易偏离用户思路」。实现上，脑暴命令要求一个 `angle` 参数（用户的想法），没有它不启动。

```
用户：/brainstorm 如果李明其实是内鬼，故事会怎么走？
        │
        ├─ 角色由 AI 按 angle 自适应生成（不写死固定角色表）
        │
   ┌────┴────┬─────────┬─────────┐
   ▼         ▼         ▼         ▼
 角色 1    角色 2    角色 3    角色 4
 (独立会话，各自 submit_brainstorm)
   └────┬────┴─────────┴─────────┘
        ▼
   父层综合（不是投票）
   ├─ 共识
   ├─ 真实分歧
   ├─ 被忽略的选项
   └─ 新暴露的假设
```

**父层综合，不投票。** 投票式的少数服从多数会掩盖真实分歧，而分歧恰恰是用户最需要看到的东西。这一条与审查引擎「冲突条目两条都保留」是同一个理由（见 `pipeline.md「合并与依据校验」`）。

每个脑暴角色都是 `createAgentSession({ sessionManager: SessionManager.inMemory(), ... })`，带不同 `systemPromptOverride`，用完 `dispose()`。

角色数默认 4–5，与「最近 N 章正文」的 N 无关 —— 后者是上下文注入量，前者是视角数，两者没有关系。
