# data — 数据层规格与 LLM 写入口

> 父文档：[`DESIGN.md`](../../DESIGN.md)
> 全局命名与数据规则见父文档 §3；本文档给出完整目录树、字段与写入规则。

---

## 1. 目录树

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

小说根目录默认位于 `<运行目录>/novels/<slug>/`；当前打开的小说记在 `<运行目录>/.novelmaster/config.json`。`slug` 由书名生成，**保留中文**（只把空白与符号折成连字符）。

---

## 2. 四条设计原则

1. **可被引用的东西必须有稳定 ID。** 审查要说「这里违背了设定 S-001」。没有 ID，「有据可查」退化成「AI 说它对」。ID 一经分配**永不复用**，即使条目被废弃。

2. **追加式与覆盖式必须分开。** 时间轴、细化历史、关系变更史、`inbox.md`、`operations.jsonl` 是**只增不改**的 —— 它们是历史，改写历史等于伪造依据。大纲、条目正文、元信息是覆盖式 —— 它们是当前结论。`reflow.md` 的职责就是记录每次回填往追加式文件里写了什么。

3. **正文文件里只有正文。** 章节号、标题、状态全在 `chapters/index.json`。因为用户要亲手编辑 txt，任何混进正文的元数据都会在编辑时被误删或误改。

4. **`state.json` 是唯一进度真相。** 章状态不在别处重复记录；多源真相迟早不一致。

---

## 3. 文件 schema

类型定义在 `src/data/schema.ts`（当前是 TypeScript 接口，里程碑 2 补 typebox 运行时校验）。本节 JSON 是字段语义的展开说明。

### 3.1 `meta.json`

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

- `premise` 存用户最初想法的**原文**，不改写 —— 它是一切推断的根。`/init` 时通过编辑器收集，空值直接拒绝建书。
- `logline` 是整理后的一句话简介，可反复修改。
- `pov` / `tense` 不是装饰：审查项 F3（视角越界）与 G2（人称时态漂移）要靠它们判定。

### 3.2 `state.json`

```json
{
  "schemaVersion": 1,
  "currentChapter": 12,
  "currentEventId": "E-003",
  "chapterStatus": "awaiting_user_review",
  "pendingReflow": false,
  "config": {
    "recentChapters": 5,
    "models": { "draft": null, "review": null, "brainstorm": null }
  }
}
```

- `chapterStatus` 的枚举与转移规则见 `pipeline.md「章状态机」`。
- `pendingReflow` 是 `/done` 的闸门之一（见 `pipeline.md「回填：结章闸门」`）。
- `config.recentChapters` 决定上下文注入几章正文，默认 5。
- `config.models` 为 `null` 表示用 pi 默认模型。

### 3.3 `setting/index.json`

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
`establishedIn`：首次确立于第几章，`0` 表示在设定期建立。
`deprecated`：废止标记。**废止不是删除** —— 历史审查报告可能引用该 ID。

### 3.4 `setting/S-001.md`

```markdown
# S-001 异能等级体系
（详述）

## 修订记录
- [CH-003] 建立：一到九级。
- [CH-011] 补充：越级使用会反噬，反噬程度与等级差成正比。
```

「修订记录」区段为追加式。

### 3.5 `characters/index.json`

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
`lastUpdatedChapter` **不是冗余**：它让回填能发现「这个角色已经 8 章没更新过」，把遗漏从「靠记性」变成「可检测」。

### 3.6 `characters/C-001.md`

```markdown
# C-001 李明
（档案详述）

## 关键事件时间轴
- [CH-001] 在码头发现异常货箱。
- [CH-007] 向张局汇报，被要求组建研究团队。
```

时间轴**只记关键事件**，不记流水账，且为追加式。

**静态字段与时间轴的处理方式不同**：静态档案（`static`）是「当前结论」，用户有权直接修正笔误；时间轴是「历史事实」，只追加。这条差异在 `/person` 层的行为规格里有对应说明（见 `interaction.md`）。

### 3.7 `relations.json`

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

`status` 枚举：`active | broken | ended`。
关系是有历史的（敌 → 友 → 决裂），所以 = 当前状态 + 追加式 `history`。

### 3.8 `events/index.json`

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

**伏笔复用同一结构**，不另建台账：`origin: "foreshadow"`，`plantedIn`（埋设章节）与 `payoffExpectedAt`（预计回收章节，可空）才有值。

这么定的收益：审查项 E2 不需要任何新数据结构，只要筛 `origin == foreshadow && status == planned`、按 `payoffExpectedAt` 排序，就能输出「到本章为止还挂着的伏笔」。伏笔也不再是特殊公民 —— 它和普通事件一样进「细化历史」、一样受 D3 进度检查覆盖。

### 3.9 `events/E-003.md`

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

**「当前描述」永远是最新最细的版本，「细化历史」保证每次填充可回看。** 审查项 D3（事件进度倒挂）就是拿正文比「当前描述」。

### 3.10 `chapters/index.json`

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

**一章可跨多个事件，但必须有 `primaryEventId` 主事件。** 真实写作里常见「推进主事件 + 回收一个伏笔」或「收尾旧事件 + 铺垫新事件」，硬限制成一章一事件会逼用户在无关的地方切章。但主次必须分明 —— `primaryEventId` 是上下文装配器「当前事件全文」的取数依据，没有它装配器不知道该注入哪条（见 `ai.md「装配规格」`）。

### 3.11 `chapters/NNN.summary.md`

固定小节，兼顾机器读与人读：

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

摘要**只压缩不改写**，是「最近 N 章全文 + 更早摘要」策略的必备产物，因此每章结束必须生成。

### 3.12 章节大纲的结构化头块

`chapters/NNN.outline.md` 开头带一个 HTML 注释块，承载机器可读信息，不影响人读：

```markdown
<!-- novelmaster:outline
characters: [C-001, C-002]
settings: [S-001, S-004]
events: [E-003]
primaryEvent: E-003
-->
```

上下文装配器靠它判定「本章与哪些人物、设定相关」（见 `ai.md「相关性判定」`）。

---

## 4. 写入约定

| 文件 | 写入方式 |
|------|----------|
| `*.json` | 全量覆盖，先写 `<file>.tmp` 再 `rename`（原子） |
| 追加式 md 区段 | 在锚点（如 `## 关键事件时间轴`）下追加一行，**绝不重写已有行** |
| 正文 `NNN.txt` | 全量覆盖，写前跑「正文校验」 |
| `logs/operations.jsonl` | 每次写操作追加一行 `{ts, op, target, actor}` |

**原子写**统一实现在 `src/data/io.ts`：写临时文件 → `fsync` → `rename`。`rename` 在同一文件系统内是原子的，所以进程中途被杀不会留下半截 JSON。这些文件是所有审查依据的载体，半截文件会让依据链直接失效。

**追加式写入的实现要求**：先读、定位锚点、插入、整体覆盖写。这看起来像「重写」，但校验层会断言「原有行全部保留」，否则**拒绝写入并报警**（这是数据损坏级信号，见 `ops.md「错误处理」`）。这是唯一能同时保证追加语义和原子性的做法。

---

## 5. 正文校验

正文写盘前扫描，命中则**提示用户确认**，不硬拦：

| 模式 | 说明 |
|------|------|
| 行首 `#{1,6} ` | markdown 标题 |
| `**…**` | 加粗 |
| 行首 `> ` | 引用 |
| `` ` `` | 行内 / 围栏代码 |
| 行首 `- ` / `* ` 且后接空格 | 列表 |

**只提示不阻断。** 理由：小说正文里出现 `-` 是合法的（破折号、对话），硬拦会误伤；而且用户要亲手编辑这个文件，最终解释权在他。

---

## 6. ID 分配

- 格式：`<前缀>-<三位序号>`，前缀 `S` / `C` / `R` / `E`。
- 分配时读取对应 `index.json` 的最大序号 + 1，**不回填已删除条目的空号**。
- 删除 = 置 `deprecated: true`（设定）或 `status: abandoned`（事件），**不物理删除**。理由：审查报告可能引用旧 ID，物理删除会让历史报告变成死链。

---

## 7. LLM 写入口：custom tools

### 7.1 决策：LLM 只能通过工具写结构化数据

**决策**：LLM **不允许**用 `read` / `write` / `edit` 直接改 `*.json` 或资料 md。所有结构化写入走 `defineTool` 定义的自定义工具。

**根因**：JSON 一旦被 LLM 手写就会漂移 —— 字段名变体、漏 `schemaVersion`、数组变对象、引号不转义。而**所有审查依据都建立在这些文件上**；结构一坏，依据链就断，而依据链是这套设计的承重墙。所以写入必须经过 schema 校验层。

代价：多写十几个工具定义，且 LLM 不能自由发挥文件格式。收益：数据永远合法。

正文 `NNN.txt` 也走工具写入（`novel_chapter_write`），以便统一跑「正文校验」。

### 7.2 工具清单

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
| `novel_event_refine` | 事件细化：更新「当前描述」+ 追加「细化历史」 | `id`, `chapter`, `description` |
| `novel_event_set_status` | 改事件状态 | `id`, `status` |
| `novel_event_link_chapter` | 把章节挂到事件 | `eventId`, `chapter`, `primary` |
| `novel_chapter_outline_write` | 写本章大纲（覆盖式 + 追加确认记录） | `chapter`, `markdown` |
| `novel_chapter_write` | 写正文（含正文校验） | `chapter`, `text` |
| `novel_chapter_summary_write` | 写本章摘要（固定小节） | `chapter`, `sections` |
| `novel_chapter_report_write` | 写审查/去 AI 味/回填报告 | `chapter`, `kind`, `markdown` |
| `novel_state_update` | 更新状态机（受转移表约束） | `chapterStatus?`, `currentChapter?`, `currentEventId?`, `pendingReflow?` |
| `novel_inbox_append` | 追加想法 | `text`, `tags?` |
| `submit_findings` | **仅审查子会话可见**：提交结构化审查结果 | 见 `pipeline.md「审查引擎」` |
| `submit_brainstorm` | **仅脑暴子会话可见**：提交角色产出 | `angle`, `points[]` |

### 7.3 状态转移校验

`novel_state_update` 必须校验状态转移合法性：非法转移（如 `drafted → accepted`）**直接拒绝**并返回错误文本。

**理由**：状态机是闸门的执行体（见 `pipeline.md「回填：结章闸门」`）。如果它可被 LLM 绕过，闸门就不存在 —— 提示词约束挡不住一个想抄近路的模型，schema 校验才能。
