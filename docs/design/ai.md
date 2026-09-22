# ai — AI 层与上下文装配器

> 父文档：[`DESIGN.md`](../../DESIGN.md)
> 审查规则与写作流水线见 [`pipeline.md`](pipeline.md)；数据来源见 [`data.md`](data.md)。

---

## 1. 会话类型与生命周期

| 类型 | 创建方式 | 生命周期 | 用途 |
|------|----------|----------|------|
| **主会话** | `InteractiveMode` 持有，`SessionManager.create(cwd)` | 跨命令存活；每章一次 `newSession()` | 用户在层面里的对话、大纲讨论、正文生成 |
| **一次性子会话** | `createAgentSession({ sessionManager: SessionManager.inMemory(), tools, customTools, resourceLoader })` | 单次任务，用完 `dispose()` | 审查员、脑暴角色、去 AI 味 |

子会话的三条特征：

- `SessionManager.inMemory()` —— 不落盘、不带历史，每次都是干净的。
- `tools` 白名单 —— 审查员只给 `read` 和 `novel_read_index`，**不给任何写工具**。这是「审查者不改稿」的代码级实现（见 `pipeline.md「审查引擎」）。
- 不同角色通过 `systemPromptOverride` 注入不同人格。

**子会话与主会话之间有隔离要求**：子会话不得读写主会话的消息历史，只通过「上下文包」和 `submit_*` 工具交换数据。否则「3 个独立视角」会退化成「3 个被前一个污染的视角」。

---

## 2. 每章清空上下文

```typescript
// 章末 /done 成功后
await ctx.newSession({
  parentSession: ctx.sessionManager.getSessionFile(),
  setup: async (sm) => {
    // 这里不注入任何前一章内容 —— 清空就是清空
  },
});
```

新会话是全新的 `AgentSession`，消息历史为空。下一章的上下文完全由「上下文装配器」重建。主会话文件通过 `parentSession` 形成链，便于回溯「当时 AI 看到了什么」。

**约束**：`ctx.newSession()` **只在命令处理器里可用**（`ExtensionCommandContext`），不能在事件处理器里调用（会死锁）。所以清空动作必须由 `/done` 命令驱动，不能挂在 `agent_end` 之类的钩子上。

---

## 3. 模型选择

```typescript
type Purpose = "draft" | "review" | "brainstorm" | "utility";
```

优先级：

1. `state.json` 的 `config.models[purpose]`（用户在层面里可改）
2. `~/.pi/agent/settings.json` 的 `defaultModel` / `defaultProvider`
3. 第一个可用模型

`thinkingLevel`：`draft` 用 `medium`，`review` 用 `high`（判定类任务值得多想），`brainstorm` 用 `medium`。

默认（当前 pi 配置）：全部用 `deepseek` / `deepseek-flash`。用户可以只把 `draft` 换成强模型。

**已知风险**：`deepseek-flash` 写长篇小说正文的质量上限明显吃亏；本项目自用、不设成本上限，所以提供按用途覆盖模型的开关，而不是替用户决定用哪个。是否切换由用户判断。

---

## 4. 提示词分层

系统提示词按四段拼装：

| 段 | 内容 | 何时注入 |
|----|------|----------|
| **基础段** | 项目规则、数据布局说明、可用工具、「不许编造依据」 | 常驻（`DefaultResourceLoader.systemPromptOverride`） |
| **项目段** | 当前小说的书名、根目录、数据布局、硬规则 | `before_agent_start`，仅在已打开小说时 |
| **层面段** | 当前层面的操作规则（例：大纲层只谈结构与冲突，不写正文） | `before_agent_start`，按当前层面 |
| **任务段** | 本回合任务（推演本章大纲 / 生成正文 / 回填） | 每次命令注入 |
| **子 agent 段** | 角色人格（审查员、脑暴角色） | 子会话创建时 |

项目段与层面段用 `event.systemPromptOptions.sections` 注入，**不整体替换 `systemPrompt`**：pi 会把变化的 section 作为补丁追加，保留其余部分的前缀缓存。整体替换会让每次切层都丢缓存。

已实现的 section key：`novelmaster-project`、`novelmaster-layer`。渲染实现在 `src/extension/render.ts`。

### 4.1 层面数据的装载

呼应「每层只装载该层数据」：层面段注入的是**该层的索引摘要**，不是全量。

| 层面 | 注入 | 状态 |
|------|------|------|
| `/setting` | 设定条目清单（`id` + `name` + `category` + `summary` + `establishedIn`） | ✅ 里程碑 3 |
| `/person` | 人物清单（`id` + `name` + `role` + `status` + `lastUpdatedChapter`）+ 关系清单概要 | ✅ 里程碑 3 |
| `/outline` | 大纲全文 + 事件清单（`id` + `title` + `stage` + `status`） | 里程碑 4 |
| `/event` | 事件清单 + 大纲的阶段划分 | 里程碑 5 |
| `/write` | 全部（写作需要全局视野），但仍走「上下文装配器」的裁剪 | 里程碑 6 |

**为什么敢全量注入条目清单。** 每条 `id + name + category + summary` 约 30 token，100 条才 3k —— 而截断的代价是 AI 不知道某条目存在，于是编一条重复的（正是审查项 A2 要抓的）。省 token 的方案是**压缩字段**（`summary` 已是一句话），不是**减少条目**。真到了几百条的规模，该做的是给清单分页或加筛选，而不是静默截断。

**注入的是索引，不是详述。** 条目详述（`S-001.md` 等）只在两种时候进入上下文：用户当前正在谈论的那条，以及里程碑 6 装配器判定的「相关条目」。理由：详述动辄几百字，全量注入会淹没重点 —— 而清单只用来回答「有哪些、各自是什么」。

**这部分不走上下文装配器。** 装配器（本文 §5）是为「生成一章正文」服务的重型设施（token 估算、相关性并集、缓存分段）。层面装载只是「让 AI 知道有哪些条目」，一个读索引 + 渲染的函数就够；把它塞进装配器会让装配器多一个与写作无关的调用者，也会为它引入每次切层的开销。

实现在 `src/extension/layer-data.ts`，由 `prompt-sections.ts` 注入为 section `novelmaster-layer-data`。

**用户也要看得到同一份清单。** 进入层面时，命令处理器用 `sendMessage` 把清单发进对话（与 `/help` 同一种呈现方式）。理由：用户进 `/setting` 后对着空屏幕不知道该说什么，「有哪些条目、叫什么」是他开口的前提 —— 而这跟「每层只装载该层数据」并不冲突：给用户的清单和给 AI 的清单本来就该是同一份，所以两者共用同一个渲染函数。

---

## 5. 上下文装配器

`assemble({ novelRoot, chapter, eventId, config })` → `ContextBundle`。这是整个系统的中枢：**装配器的质量 = 成书质量**。

### 5.1 装配规格

顺序原则：**从最稳定排到最易变，最「当下」的放最后。**

| # | 段 | 取数规则 | 理由 |
|---|----|----------|------|
| 1 | meta | `title` `genre` `premise` `logline` `pov` `tense`，全量 | 「这本书是什么」的最小锚点，成本极低 |
| 2 | 大纲 | `outline.md` 全文 | 判断是否脱轨的基准；省了它 AI 只看得到局部 |
| 3 | 设定 | **双层**：全部条目的 `summary` + 相关条目全文 | 设定越写越多，全量全文会淹没重点；只给相关的又会让 AI 编新设定（审查项 A2） |
| 4 | 当前事件 | 主事件全文（当前描述 + 细化历史） | 本章要推进的对象 |
| 5 | 相关人物 | 静态档案 + **全量**关键事件时间轴 | 时间轴条目短；截断会让 AI 以为早期经历没发生过 |
| 6 | 相关关系 | 仅**两端都在相关人物集合内**的关系 | 只提一端的关系是无效信息 |
| 7 | 最近 N 章正文 | `chapters/(c-N..c-1).txt` 顺序全文，**N 默认 5、可配置** | 唯一注入原文正文的部分，连续性最主要的来源（也是成本主项） |
| 8 | 更早章节摘要 | `chapters/1..c-N-1.summary.md` 顺序 | 长篇不失忆的代价 |
| 9 | 本章大纲 | `NNN.outline.md`（用户确认版） | 放最后：当下任务最不该被忽略 |

### 5.2 相关性判定（第 3、5、6 段用）

```
相关人物 = 本章大纲标注的 characterIds
         ∪ 主事件涉及的人物
         ∪ 最近 N 章出场人物

相关设定 = 本章大纲标注的 settingIds
         ∪ 主事件涉及的设定
         ∪ 最近 N 章中出现过的设定
```

**全部取并集，不取交集。** 理由：宁可多喂一条人物档案，也不要因为 AI 不知道某个人而写出矛盾。两种错误的代价不对称 —— 多喂一条只是多点 token，漏一条会导致一致性事故，而一致性事故要靠用户逐条审出来。

「本章大纲标注的 characterIds / settingIds」从 `NNN.outline.md` 的结构化头块读取，格式见 `data.md「章节大纲的结构化头块」`。

### 5.3 缓存友好

第 1–6 段在相邻章节间几乎不变，只有 7–9 段会变。稳定部分放前面 = 可命中的 prompt 缓存前缀。

在「每章都要重建上下文」的架构下这不是小优化：**命中的恰好是占比最大的那部分。**

### 5.4 输出与可检查性

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

成本主项是第 7 段（N 章正文），用户要能一眼看到「这章上下文多大」，才能决定要不要把 N 调小。**看不见的东西调不动** —— 装配器不可检查，出了问题就只能靠猜。

### 5.5 审查用的裁剪版

审查不需要文风，所以审查子会话**不注入** N 章正文以外的额外内容，也**不注入**任何多余段。裁剪规格见 `pipeline.md「审查员的输入」`。

---

## 6. 结构化产出：用工具而不是 JSON 文本

子会话的产出通过 `submit_*` 工具提交，参数用 typebox 定义。

```typescript
const submitFindings = defineTool({
  name: "submit_findings",
  description: "提交审查发现。每条必须带依据引用。",
  parameters: Type.Object({
    findings: Type.Array(Type.Object({
      category: Type.String(),          // "A1".."G3"
      severity: Type.Union([
        Type.Literal("blocking"),
        Type.Literal("warning"),
        Type.Literal("note"),
      ]),
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

**为什么不用「让模型输出 JSON 块再解析」**：模型可以写出一段「看起来像 JSON 的散文」，解析失败就只能重试或丢弃。工具参数走 schema 校验，模型没有这个机会。

这直接决定了审查报告能不能被**机械汇总和校验** —— 而机械汇总和依据校验正是「不能凭感觉」的实现手段。

---

## 7. humanizer 的注入方式

**决策**：读 `~/.pi/agent/skills/humanizer/SKILL.md` 的**文件内容**，作为去 AI 味子会话的 system prompt 主体。

**不用**「让模型自己决定加载 skill」。**根因**：本项目要求去 AI 味**必然发生**，而 skill 自主加载是模型驱动的 —— 模型这章想不起来加载，去 AI 味就静默跳过了。用户无法从结果上分辨「这章做过去 AI 味」和「这章模型忘了」。

显式注入让「做没做」变成代码事实，而不是模型的心情。

skill 内容里有一条关键接口：**用户给文风样本时，样本优先于通用模式规则**（包括它的破折号禁令）。这正是需要的钩子 —— 样本 = 本书已写章节，见 `pipeline.md「去 AI 味引擎」`。
