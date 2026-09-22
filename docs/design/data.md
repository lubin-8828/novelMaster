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

类型定义在 `src/data/schema.ts`。**schema 只有一份定义：typebox 定义，TypeScript 类型由 `Static<>` 从同一份定义推导。**

**为什么不能手写 interface + 另写一套 typebox。** 两者是同一个事实的两个副本，改一处忘一处就会漂移 —— 而且漂移的后果是「类型检查说合法、运行时校验说非法」这种最难查的形态。这与 `decisions.md「踩坑记录」`里的命令表是同一类错误，修法也一样：让那个事实只有一处来源。

两条强制要求：

1. **每个对象都必须显式写 `additionalProperties: false`。** typebox 1.x 默认**允许**额外属性 —— 不写就等于接受 LLM 传来的任意字段名变体（`characters` 写成 `characterList`、`establishedIn` 写成 `established_in`），静默落盘成脏数据。而这正是 schema 校验存在的全部理由（见 `decisions.md`「结构化数据只经 custom tools 写入」）。
2. **写盘前校验，读盘后也校验。** 读也校验的理由：这些文件用户可以直接编辑，手改出的非法结构必须在**被当作审查依据之前**暴露，而不是等审查报告引用它时才炸。

本节 JSON 是字段语义的展开说明。

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
      "characters": ["C-001", "C-002"], "settings": ["S-001"],
      "origin": "ai_proposed",
      "plantedIn": null, "payoffExpectedAt": null }
  ]
}
```

`origin` 枚举：`ai_proposed | user_specified | foreshadow`。
`status` 枚举：`planned | in_progress | done | abandoned`。
`order` 由工具自动分配（新建时取现有最大值 + 10），不需要调用方关心。

**`characters` / `settings` 是「涉及」区段的唯一来源。** 这两个字段不是装饰：
`events/E-NNN.md` 里的「涉及」区段由代码从它们渲染。先把它们做成结构化字段，
那段文本才可校验；否则「涉及了什么」就只能靠 LLM 手写，而手写的东西无法被审查引用。

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

**`status` 是派生字段，不是第二份进度真相。** 进度真相只有 `state.json` 一份（见「四条设计原则」）；这里的 `status` 是它的展开值，由工具在状态变化时同步写入，好让「按章查历史」时不必再回读 `state.json`。两者不一致时以 `state.json` 为准。

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

同一文件底部还有「确认记录」区段，与大纲正文分开：

```markdown
## 确认记录
- [2026-09-21 14:03] 用户确认第 12 章大纲。
```

**大纲正文是覆盖式，确认记录是追加式。** 重推本章大纲会覆盖正文，但确认记录必须原样保留 —— 否则「这一章的大纲被改过几次」就无迹可寻。写入时由工具把两个区段分开处理，调用方不需要关心。

### 3.13 `inbox.md`

```markdown
# 想法收集箱 (Inbox)

> 追加式。不整理、不评判、不删除。

## 记录

- [2026-09-21 10:00] 也许可以加一个内鬼线。 #脑洞
```

可追加区段是 **`## 记录`**，不是文件标题（标题是一级 `#`）。
这条差别看似琐碎，但搞错了就是「写入被锚点保护拒绝」或（更糟）「行被丢到文件末尾重复结构」。

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

保行断言的判定方式是**子序列比对**，不是「行数不减」：原有行必须按原顺序全部出现在新内容里。行数比对是无效的 —— 删一行加一行也能保持行数不变。实现在 `src/data/md.ts`。

**锚点缺失时拒绝写入，而不是新建区段。** 区段不存在说明文件结构与 schema 不符（如用户手工删掉了 `## 关键事件时间轴`），此时自动补一个空区段会把「结构已被破坏」这个事实隐藏掉。

### 4.1 索引与详述的双写顺序

带详述文件的资料（设定 `S-NNN.md`、人物 `C-NNN.md`、事件 `E-NNN.md`）一次 upsert 要写两个文件，而两次原子写之间存在崩溃窗口。顺序固定为：

**先写详述 md，再写索引 json。**

两个方向的后果不对称：

| 崩溃点 | 留下的状态 | 严重程度 |
|--------|-----------|----------|
| 写完 md、未写索引 | 孤儿详述文件（索引里不存在） | 无害且可恢复 —— 下次 upsert 同一 ID 会覆写它 |
| 写完索引、未写 md | **坏引用**（索引里有条目，点进去文件不存在） | 审查报告会引用一个不存在的 `S-NNN`，依据链当场断掉 |

所以顺序不可交换。这不是「尽量先写 md」的风格问题，而是必须固定下来的写入协议。

`logs/operations.jsonl` 每行 `{ts, op, target, actor}`：`op` 是工具名，`target` 是相对小说根的路径，`actor` 恒为 `"llm"`。

**`actor` 写死 `"llm"` 是诚实而不是冗余**：用户直接编辑 txt 与 md 不走工具，也不会被记录。日志只声称「LLM 通过工具做了什么」，不声称「文件发生过什么变化」—— 把后者写进日志就是伪造完整性。

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

**只提示不阻断，但提示必须是代码事实。** 理由：小说正文里出现 `-` 是合法的（破折号、对话），硬拦会误伤；而且用户要亲手编辑这个文件，最终解释权在他。

工具是单次调用，没有「先问你、再接着写」的二次交互能力，所以落点是**两段式**：

1. 首次调用（不带 `acknowledgeMarkdown`）命中标记 → **不落盘**，把命中清单（行号 + 片段 + 命中模式）返回给 LLM，让它去问用户；
2. 用户确认后，LLM 带 `acknowledgeMarkdown: true` 重新调用 → 落盘。

为什么不是「先落盘再提示」：那样「不阻断」就变成了「阻断无效」—— 文件已经写坏了，提示只是事后通知。为什么不是「工具内直接弹确认框」：工具执行在 agent 循环里，弹 UI 会让工具的行为依赖宿主是否有 UI，而纯文本返回在 TUI 之外（RPC、脚本）同样成立。

---

## 6. ID 分配

- 格式：`<前缀>-<三位序号>`，前缀 `S` / `C` / `R` / `E`。
- 分配时读取对应 `index.json` 的最大序号 + 1，**不回填已删除条目的空号**。
- 删除 = 置 `deprecated: true`（设定）或 `status: abandoned`（事件），**不物理删除**。理由：审查报告可能引用旧 ID，物理删除会让历史报告变成死链。

实现契约（`src/data/ids.ts`）：

- `nextId(kind, existing: string[]): string` —— 从已有 ID 集合里算最大序号 + 1。
- **最大序号从「所有出现过该前缀的 ID」里算，不只看未废弃的。** 若只算活跃条目，废弃 `S-003` 后下一个新条目会拿到 `S-003` —— ID 被复用了，而引用它的历史审查报告会指向另一个东西。这正是「永不复用」要防的唯一一种事故。
- 序号超过 999 时**不报错、直接扩位**（`S-1000`）。理由：一部超长篇小说可能真的突破千条设定，而拒绝分配会让用户手改 ID —— 那才是真正的失控。
- 传入的 ID 不符合 `<前缀>-<数字>` 格式时忽略它（而不是抛错）—— 用户手工录过一条 `S-设定` 不应该导致整本书无法分配新 ID。

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
| `novel_read_index` | 读某一类资料的索引（设定/人物/关系/事件/章节） | `kind` |
| `novel_meta_update` | 更新元信息（一句话简介 / 视角 / 时态） | `logline?`, `pov?`, `tense?` |
| `novel_setting_upsert` | 新增或更新设定条目 | `id?`, `name`, `category`, `summary`, `body`, `establishedIn?`, `tags?`, `deprecated?` |
| `novel_setting_append_revision` | 往设定条目追加修订记录 | `id`, `chapter`, `text` |
| `novel_character_upsert` | 新增或更新人物（静态档案 + 状态） | `id?`, `name`, `aliases?`, `role`, `status?`, `firstAppeared?`, `static?`, `body?` |
| `novel_character_append_timeline` | 给人物追加一条关键事件 | `id`, `chapter`, `text` |
| `novel_relation_upsert` | 新增或更新关系 | `id?`, `from`, `to`, `type`, `directed?`, `status?`, `since?` |
| `novel_relation_append_history` | 追加关系变更 | `id`, `chapter`, `change`, `nextStatus?` |
| `novel_outline_write` | 写主线大纲（覆盖式） | `markdown` |
| `novel_outline_append_revision` | 追加大纲修订记录 | `text` |
| `novel_event_upsert` | 新增或更新事件元信息 | `id?`, `title`, `stage`, `origin`, `status?`, `order?`, `dependsOn?`, `leadsTo?`, `characters?`, `settings?`, `plantedIn?`, `payoffExpectedAt?` |
| `novel_event_refine` | 事件细化：更新「当前描述」+ 追加「细化历史」 | `id`, `chapter`, `description` |
| `novel_event_set_status` | 改事件状态 | `id`, `status` |
| `novel_event_link_chapter` | 把章节挂到事件 | `eventId`, `chapter`, `primary` |
| `novel_chapter_outline_write` | 写本章大纲（覆盖式 + 追加确认记录） | `chapter`, `title`, `markdown`, `confirmNote?` |
| `novel_event_link_chapter` | 把章节挂到事件 | `eventId`, `chapter`, `primary` |
| `novel_chapter_outline_write` | 写本章大纲（覆盖式 + 追加确认记录） | `chapter`, `title`, `markdown`, `confirmNote?` |
| `novel_chapter_write` | 写正文（含正文校验） | `chapter`, `text`, `acknowledgeMarkdown?` |
| `novel_chapter_summary_write` | 写本章摘要（固定小节） | `chapter`, `sections` |
| `novel_chapter_report_write` | 写审查/去 AI 味/回填报告 | `chapter`, `kind`, `markdown` |
| `novel_state_update` | 更新状态机（受转移表约束） | `chapterStatus?`, `currentChapter?`, `currentEventId?`, `pendingReflow?` |
| `novel_inbox_append` | 追加想法 | `text`, `tags?` |
| `novel_brainstorm` | **主会话**：按给定方向起多 agent 讨论 | `angle`, `perspectives[]` |
| `submit_brainstorm` | **仅讨论子会话可见**：提交角色产出 | `angle`, `points[]` |
| `novel_review` | **主会话**：跑一次审查（3 个只读子会话 → 合并 → 落盘报告） | 无参数（章号取自 `state.json`） |
| `submit_findings` | **仅审查子会话可见**：提交结构化审查结果 | `findings[]`（见 `pipeline.md「审查引擎」`） |
| `submit_findings` | **仅审查子会话可见**：提交结构化审查结果 | 见 `pipeline.md「审查引擎」` |
| `submit_brainstorm` | **仅脑暴子会话可见**：提交角色产出 | `angle`, `points[]` |

表格之外的参数细节，这些是「枚举值写死在代码里」的落点 —— 让 LLM 自造枚举值是另一种形式的结构漂移：

**共 24 个 `novel_*` 工具定义**，其中 **22 个注册给主会话**；`submit_brainstorm` 只注入讨论子会话（里程碑 4b）、`submit_findings` 只注入审查子会话（里程碑 8）。

**为什么子会话专属工具不能注册给主会话**：如果主会话也能调 `submit_brainstorm`，它就能自己「提交」一份假产出冒充某个角色 —— 那套「多视角」当场作废。工具的可见性就是这条约束的代码实现。

`novel_meta_update` 只改 `logline` / `pov` / `tense` 这三个「整理后的元信息」。**不改 `title`**：书名对应目录名 `slug`，改名会连带旧目录、旧报告里的书名、以及对外的所有引用一起变，而这是一项独立的、需要用户明确确认的操作 —— 混在一次普通修改里做，会出现「只想改个简介结果书目录换了」。

几条不写在参数表里、但会改变工具行为的约束：

- `novel_event_upsert`：`order` 省略时新建取「现有最大值 + 10」，保证新事件排在最后。
- `novel_event_upsert`：非伏笔事件带 `plantedIn` / `payoffExpectedAt`（非 `null`）会被拒绝 —— 这两个字段只属于伏笔。
- `novel_event_link_chapter`：**该章必须已有章节记录**（先写过章节大纲）。否则拒绝，而不是静默丢掉 `primaryEventId`。
- `novel_character_append_timeline` / `novel_setting_append_revision` 等追加类工具：只增不改，原有行必须全保留，否则拒绝写入。

| 参数 | 取值 |
|------|------|
| `novel_read_index.kind` | `setting` / `character` / `relation` / `event` / `chapter` |
| `novel_setting_upsert.category` | `world_rule` / `location` / `faction` / `item` / `taboo` / `custom` |
| `novel_character_upsert.role` | `protagonist` / `antagonist` / `supporting` / `minor` |
| `novel_character_upsert.status` | `alive` / `dead` / `missing` / `unknown` |
| `novel_relation_upsert.status` | `active` / `broken` / `ended` |
| `novel_event_upsert.origin` | `ai_proposed` / `user_specified` / `foreshadow` |
| `novel_event_set_status.status` | `planned` / `in_progress` / `done` / `abandoned` |
| `novel_chapter_report_write.kind` | `review` / `deai` / `reflow` → 落 `.review.md` / `.deai.md` / `.reflow.md` |

**`novel_chapter_summary_write.sections` 是结构化对象，不是一段 markdown。** 小节标题由代码生成，不由 LLM 写：

```json
{
  "synopsis": "150–300 字梗概",
  "appearedCharacters": ["C-001"],
  "appearedLocations": ["S-004"],
  "advancedEvents": [{ "id": "E-003", "note": "细化一档" }],
  "newSettings": [],
  "newForeshadows": ["E-009"],
  "endState": "本章结束时的人物位置、处境、悬念"
}
```

理由：`data.md「chapters/NNN.summary.md」`要求固定小节，而「固定」只有写死在代码里才成立。如果让 LLM 传整段 markdown，小节标题会随章节漂移成「出场人物」「登场人物」「主要人物」，而下游要靠这些小节做机器读取（见 `ai.md「装配规格」`）。

### 7.3 状态转移校验

`novel_state_update` 必须校验状态转移合法性：非法转移（如 `drafted → accepted`）**直接拒绝**并返回错误文本。

**理由**：状态机是闸门的执行体（见 `pipeline.md「回填：结章闸门」`）。如果它可被 LLM 绕过，闸门就不存在 —— 提示词约束挡不住一个想抄近路的模型，schema 校验才能。

合法转移的**唯一来源**是 `pipeline.md「章状态机」`里的转移表，实现在 `src/data/state.ts`。转移表不放这里，避免同一张表在文档里出现两次。

### 7.4 写入护栏：把「只能走工具」变成代码事实

7.1 的决策若只写在提示词里，它就不是约束，是建议。护栏挡在 `src/tools/guard.ts`，只有一条：

| 拦住的路径 | 落点 | 理由 |
|-----------|------|------|
| `write` / `edit` 写 `<小说根>/` 下的任何路径 | `pi.on("tool_call")` 返回 `{ block: true, reason }` | 模型不知道有 `novel_*` 工具时，会直接手写 `meta.json`；手写的 JSON 会漂移，而依据链建立在这些文件上 |

除了拦，它还把**正确的工具名写进错误文本** —— 模型被拦后的自然反应是换工具，而不是想办法绕。

**不拦 `bash` / `powershell`，这是明确的取舍。** shell 确实能绕过护栏（一句 `echo '{}' > meta.json`），但：

- 关掉它的代价是**真实且立刻发生**的 —— AI 不能帮你跑 git、查日志、跑测试、看目录树；
- 而走这条旁路要求模型**主动绕开一个明确的拒绝提示**，那不是它被拦住后的行为。

护栏的价值在于**把正常路径摆正**，不在于穷举所有绕法。为堵一条模型不会走的旁路而砍掉一整项能力，是把「机制闭合」当成了目的本身。

**不受影响的三件事**：用户自己在输入框敲 `!` 执行的 shell、pi 的内建命令、以及 `<小说根>/` 目录**之外**的 write/edit。

**只读工具保留**：审查引擎要靠读原始资料来判断「有据可查」，把 `read` 关掉会让依据链无从建立。

### 7.5 校验失败的处置

| 情形 | 行为 |
|------|------|
| schema 校验失败 | 拒绝写入，返回**具体哪个字段、错在哪**（不是「参数非法」这种无法修正的提示），让 LLM 修正后重试 |
| 同类工具连续 3 次校验失败 | 中止并明确报给用户。理由：连续失败通常不是「模型手滑」而是「模型理解错了数据结构」，第 4 次不会更好，只会烧 token |
| 引用的 ID 不存在 | 拒绝写入并列出**最接近的候选 ID**。理由：`C-001` 写成 `C-01` 是最常见的错误形态，给出候选比要求用户重述更省事 |
| 追加式写入检测到原有行丢失 | 拒绝写入并报警（数据损坏级，见 `ops.md「错误处理」`） |

**错误文本是给 LLM 看的接口，不是给用户看的日志。** 它必须包含「哪个字段、期望什么、实际是什么」，因为 LLM 唯一的修正途径就是这段文本。

### 7.6 操作留痕

每次成功的写操作追加一行到 `logs/operations.jsonl`，格式见 `data.md「写入约定」`。

**实现落点是工具层而不是数据层**：数据层的写函数不知道自己是被 LLM 还是被别的东西调用的，而留痕的语义是「LLM 对资料做了什么」。在工具层统一包一层，日志内容与工具调用一一对应，不会漏也不会重复。

### 7.7 写入结果的 diff 摘要

工具返回的文本必须让用户能看出**改了什么**，而不只是「改成功了」。

| 情形 | 返回文本 |
|------|----------|
| 新建 | `已新建设定条目 S-001（异能等级体系）。` —— 新建没有 diff，说清建了什么即可 |
| 更新 | `已更新设定条目 S-001：` + 逐条 `- summary：一到九级 → 一到十二级` |
| 更新但无实际变化 | `S-001 没有实际变化（传入的值与现有值相同）。` |
| 追加（时间轴 / 修订记录） | `已给 C-001 追加时间轴条目，lastUpdatedChapter 推进到 7。` —— 追加本身就是「发生了什么事」 |

长文本字段（`body`、档案详述）只报长度变化（`800 字 → 950 字`），不贴全文：diff 的用途是让人一眼看出「这次动了什么」，把 800 字正文贴进返回值只会把其他变化挤掉。

实现：`src/data/diff.ts` 的 `diffFields(before, after, fields, longTextFields)` 算差异；各写函数把变更集放进自己的返回值；工具层只负责排版。

**为什么这算规格而不是文案问题**：`interaction.md「各资料层行为规格」`要求「回显 diff 摘要让用户确认」。确认的前提是看得到变化 —— 只有「改好了」三个字时，用户唯一的回应就是「好」；有 diff，他才能说「等等，第 3 条别改」。

**为什么用转述而不是阻断式闸门**（像正文校验那样）：资料层的改动是**用户自己要求的**，不是 AI 自主决定的，所以不需要额外的拍板环节；而阻断会强制 LLM 再调一次工具，对「改个摘要」这种操作太重。两种场合的区别在于「谁发起的改动」，不在于「改动大不大」。

**已实现的工具**：`novel_setting_upsert`、`novel_character_upsert`、`novel_relation_upsert`（里程碑 3）、`novel_event_upsert`（里程碑 5）。章节类的写工具在里程碑 7 补 —— 但规格是全局的：**新增任何 upsert 类工具都要走 `diffFields` + `upsertText`**，否则「改了却没报」就成了一种静默行为。

**非 upsert 类的写工具不需要 diff**：`novel_event_refine`（"已细化 E-001：当前描述 45 → 78 字"）、`novel_event_set_status`（"已把 E-001 的状态改为 done"）、`novel_event_link_chapter`（"已把第 12 章挂到 E-003"）—— 这些工具**本身就是一次变化**，返回文本说清「发生了什么」就够，列 before → after 反而是同义重复。
