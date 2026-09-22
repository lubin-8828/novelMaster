/**
 * 数据模型：typebox 定义 + 类型推导 + 校验辅助。
 *
 * 这里是数据结构的**唯一来源**：TypeScript 类型由 `Static<>` 从 typebox 定义推导，
 * 不再手写 interface。手写 interface 再配一套 typebox 就是同一个事实的两个副本，
 * 漂移的症状是「类型检查说合法、运行时校验说非法」—— 最难查的一种。
 *
 * 每个对象都显式写 `additionalProperties: false`。typebox 1.x 默认**允许**额外属性，
 * 不写就等于接受 LLM 传来的任意字段名变体（`characters` 写成 `characterList`），
 * 而那正是 schema 校验存在的全部理由。
 *
 * 字段语义见 docs/design/data.md「文件 schema」。
 */

import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { DataError } from "./errors.ts";

export const SCHEMA_VERSION = 1;

/** 严格对象基座：拒绝 schema 之外的任何字段。所有对象（含工具参数）都必须带上它。 */
export const STRICT = { additionalProperties: false } as const;

/* ---------- 枚举 ----------
 *
 * 枚举的常量列表与下面的 schema 是两份手写内容，这是刻意的取舍。
 *
 * 写过一版 `(...values: T) => Type.Union(values.map(Type.Literal))` 的 helper，
 * 想只写一处；但那样泛型 tuple 经过 `.map()` 后字面量信息丢失，
 * `Static<>` 会推导成 `never`，整个对象类型随之不可用。类型安全优先。
 *
 * 两份内容漂移的风险由 tests/data.ts 的互锁断言兜住：列表里每个值都必须被 schema 接受，
 * schema 也必须拒绝列表外的值。这套「手写两份 + 断言互锁」在本项目已有先例
 * （见 src/extension/layers.ts 的两张命令表，以及 decisions.md 的踩坑记录）。
 */

export const CHAPTER_STATUSES = [
  "not_started",
  "outlined",
  "drafted",
  "auto_reviewed",
  "deai_done",
  "awaiting_user_review",
  "user_edited",
  "reflowed",
  "ai_revised",
  "accepted",
] as const;

export const SETTING_CATEGORIES = ["world_rule", "location", "faction", "item", "taboo", "custom"] as const;
export const CHARACTER_ROLES = ["protagonist", "antagonist", "supporting", "minor"] as const;
export const CHARACTER_STATUSES = ["alive", "dead", "missing", "unknown"] as const;
export const RELATION_STATUSES = ["active", "broken", "ended"] as const;
export const EVENT_STATUSES = ["planned", "in_progress", "done", "abandoned"] as const;
export const EVENT_ORIGINS = ["ai_proposed", "user_specified", "foreshadow"] as const;
export const REPORT_KINDS = ["review", "deai", "reflow"] as const;

export const ChapterStatusSchema = Type.Union([
  Type.Literal("not_started"),
  Type.Literal("outlined"),
  Type.Literal("drafted"),
  Type.Literal("auto_reviewed"),
  Type.Literal("deai_done"),
  Type.Literal("awaiting_user_review"),
  Type.Literal("user_edited"),
  Type.Literal("reflowed"),
  Type.Literal("ai_revised"),
  Type.Literal("accepted"),
]);

export const SettingCategorySchema = Type.Union([
  Type.Literal("world_rule"),
  Type.Literal("location"),
  Type.Literal("faction"),
  Type.Literal("item"),
  Type.Literal("taboo"),
  Type.Literal("custom"),
]);

export const CharacterRoleSchema = Type.Union([
  Type.Literal("protagonist"),
  Type.Literal("antagonist"),
  Type.Literal("supporting"),
  Type.Literal("minor"),
]);

export const CharacterStatusSchema = Type.Union([
  Type.Literal("alive"),
  Type.Literal("dead"),
  Type.Literal("missing"),
  Type.Literal("unknown"),
]);

export const RelationStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("broken"),
  Type.Literal("ended"),
]);

export const EventStatusSchema = Type.Union([
  Type.Literal("planned"),
  Type.Literal("in_progress"),
  Type.Literal("done"),
  Type.Literal("abandoned"),
]);

export const EventOriginSchema = Type.Union([
  Type.Literal("ai_proposed"),
  Type.Literal("user_specified"),
  Type.Literal("foreshadow"),
]);

export const ReportKindSchema = Type.Union([
  Type.Literal("review"),
  Type.Literal("deai"),
  Type.Literal("reflow"),
]);

export type ChapterStatus = Static<typeof ChapterStatusSchema>;
export type SettingCategory = Static<typeof SettingCategorySchema>;
export type CharacterRole = Static<typeof CharacterRoleSchema>;
export type CharacterStatus = Static<typeof CharacterStatusSchema>;
export type RelationStatus = Static<typeof RelationStatusSchema>;
export type EventStatus = Static<typeof EventStatusSchema>;
export type EventOrigin = Static<typeof EventOriginSchema>;
export type ReportKind = Static<typeof ReportKindSchema>;

/** 可空字符串。用 Union 而不是 Optional —— 字段必须存在，值可以是 null。 */
const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableInteger = Type.Union([Type.Integer(), Type.Null()]);

/* ---------- meta.json ---------- */

export const NovelMetaSchema = Type.Object(
  {
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    title: Type.String(),
    slug: Type.String(),
    genre: Type.Array(Type.String()),
    /** 用户最初想法的原文。不改写 —— 它是一切推断的根。 */
    premise: Type.String(),
    /** 整理后的一句话简介，可反复修改。 */
    logline: Type.String(),
    pov: Type.String(),
    tense: Type.String(),
    createdAt: Type.String(),
  },
  STRICT,
);

export type NovelMeta = Static<typeof NovelMetaSchema>;

/* ---------- state.json ---------- */

export const NovelStateSchema = Type.Object(
  {
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    currentChapter: Type.Integer({ minimum: 1 }),
    currentEventId: NullableString,
    chapterStatus: ChapterStatusSchema,
    /** true 表示用户改了正文但还没回填资料。它是 /done 的闸门之一。 */
    pendingReflow: Type.Boolean(),
    config: Type.Object(
      {
        /** 装配上下文时注入的最近正文章节数。 */
        recentChapters: Type.Integer({ minimum: 0 }),
        /** 按用途覆盖模型；null 表示用 pi 默认。 */
        models: Type.Object(
          {
            draft: NullableString,
            review: NullableString,
            brainstorm: NullableString,
          },
          STRICT,
        ),
      },
      STRICT,
    ),
  },
  STRICT,
);

export type NovelState = Static<typeof NovelStateSchema>;

/* ---------- setting/ ---------- */

export const SettingItemSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    category: SettingCategorySchema,
    summary: Type.String(),
    /** 首次确立于第几章；0 表示在设定期建立。 */
    establishedIn: Type.Integer({ minimum: 0 }),
    tags: Type.Array(Type.String()),
    deprecated: Type.Boolean(),
    updatedAt: Type.String(),
  },
  STRICT,
);

export const SettingIndexSchema = Type.Object(
  {
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    items: Type.Array(SettingItemSchema),
  },
  STRICT,
);

export type SettingItem = Static<typeof SettingItemSchema>;
export type SettingIndex = Static<typeof SettingIndexSchema>;

/* ---------- characters/ ---------- */

export const CharacterStaticSchema = Type.Object(
  {
    age: NullableInteger,
    gender: Type.String(),
    appearance: Type.String(),
    background: Type.String(),
    personality: Type.String(),
    speechHabits: Type.String(),
    goal: Type.String(),
    fear: Type.String(),
  },
  STRICT,
);

export const CharacterSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    aliases: Type.Array(Type.String()),
    role: CharacterRoleSchema,
    firstAppeared: Type.Integer({ minimum: 0 }),
    status: CharacterStatusSchema,
    /** 最后一次被回填更新的章节号。用于发现「这个角色很久没更新了」。 */
    lastUpdatedChapter: Type.Integer({ minimum: 0 }),
    static: CharacterStaticSchema,
  },
  STRICT,
);

export const CharacterIndexSchema = Type.Object(
  {
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    characters: Type.Array(CharacterSchema),
  },
  STRICT,
);

export type CharacterStatic = Static<typeof CharacterStaticSchema>;
export type Character = Static<typeof CharacterSchema>;
export type CharacterIndex = Static<typeof CharacterIndexSchema>;

/* ---------- relations.json ---------- */

export const RelationHistoryEntrySchema = Type.Object(
  {
    chapter: Type.Integer({ minimum: 0 }),
    change: Type.String(),
  },
  STRICT,
);

export const RelationSchema = Type.Object(
  {
    id: Type.String(),
    from: Type.String(),
    to: Type.String(),
    type: Type.String(),
    directed: Type.Boolean(),
    status: RelationStatusSchema,
    since: Type.Integer({ minimum: 0 }),
    history: Type.Array(RelationHistoryEntrySchema),
  },
  STRICT,
);

export const RelationsDocSchema = Type.Object(
  {
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    relations: Type.Array(RelationSchema),
  },
  STRICT,
);

export type RelationHistoryEntry = Static<typeof RelationHistoryEntrySchema>;
export type Relation = Static<typeof RelationSchema>;
export type RelationsDoc = Static<typeof RelationsDocSchema>;

/* ---------- events/ ---------- */

export const StoryEventSchema = Type.Object(
  {
    id: Type.String(),
    title: Type.String(),
    stage: Type.String(),
    status: EventStatusSchema,
    order: Type.Integer(),
    chapters: Type.Array(Type.Integer({ minimum: 1 })),
    dependsOn: Type.Array(Type.String()),
    leadsTo: Type.Array(Type.String()),
    /** 本事件涉及的人物，写入详述文件的「涉及」区段。 */
    characters: Type.Array(Type.String()),
    /** 本事件涉及的设定条目，写入详述文件的「涉及」区段。 */
    settings: Type.Array(Type.String()),
    origin: EventOriginSchema,
    /** 伏笔专用：埋设章节。非伏笔为 null。 */
    plantedIn: NullableInteger,
    /** 伏笔专用：预计回收章节，可为空。非伏笔为 null。 */
    payoffExpectedAt: NullableInteger,
  },
  STRICT,
);

export const EventIndexSchema = Type.Object(
  {
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    events: Type.Array(StoryEventSchema),
  },
  STRICT,
);

export type StoryEvent = Static<typeof StoryEventSchema>;
export type EventIndex = Static<typeof EventIndexSchema>;

/* ---------- chapters/ ---------- */

export const ChapterRecordSchema = Type.Object(
  {
    no: Type.Integer({ minimum: 1 }),
    title: Type.String(),
    eventIds: Type.Array(Type.String()),
    primaryEventId: NullableString,
    status: ChapterStatusSchema,
    wordCount: Type.Integer({ minimum: 0 }),
    revisionCount: Type.Integer({ minimum: 0 }),
    createdAt: Type.String(),
    acceptedAt: NullableString,
  },
  STRICT,
);

export const ChapterIndexSchema = Type.Object(
  {
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    chapters: Type.Array(ChapterRecordSchema),
  },
  STRICT,
);

export type ChapterRecord = Static<typeof ChapterRecordSchema>;
export type ChapterIndex = Static<typeof ChapterIndexSchema>;

/* ---------- 摘要（工具参数，落盘为 md） ---------- */

export const SummaryAdvancedEventSchema = Type.Object(
  {
    id: Type.String(),
    note: Type.String(),
  },
  STRICT,
);

/**
 * `novel_chapter_summary_write` 的结构化参数。
 *
 * 小节标题由代码渲染，不由 LLM 写。理由：「固定小节」只有写死在代码里才成立，
 * 让模型传整段 markdown 会让标题漂移成「出场人物」「登场人物」「主要人物」，
 * 而下游要靠这些小节做机器读取（见 docs/design/ai.md「装配规格」）。
 */
export const SummarySectionsSchema = Type.Object(
  {
    synopsis: Type.String(),
    appearedCharacters: Type.Array(Type.String()),
    appearedLocations: Type.Array(Type.String()),
    advancedEvents: Type.Array(SummaryAdvancedEventSchema),
    newSettings: Type.Array(Type.String()),
    newForeshadows: Type.Array(Type.String()),
    endState: Type.String(),
  },
  STRICT,
);

export type SummarySections = Static<typeof SummarySectionsSchema>;

/* ---------- 校验辅助 ---------- */

/** 数据结构不合法。message 是给 LLM 看的（含字段路径），不是给用户看的日志。 */
export function schemaErrors(schema: TSchema, value: unknown): string[] {
  return Value.Errors(schema, value).map((e) => `${e.instancePath || "/"}：${e.message}`);
}

export function isValid<T extends TSchema>(schema: T, value: unknown): value is Static<T> {
  return Value.Check(schema, value);
}

/**
 * 校验失败即抛错。
 *
 * `label` 是给 LLM 定位用的文件/参数名，例如 `meta.json`、`novel_setting_upsert.summary`。
 */
export function assertSchema<T extends TSchema>(
  schema: T,
  value: unknown,
  label: string,
): asserts value is Static<T> {
  if (Value.Check(schema, value)) return;
  const details = schemaErrors(schema, value).join("；");
  throw new DataError(`${label} 不符合 schema —— ${details}`);
}

/* ---------- 构造函数 ---------- */

export function emptyMeta(title: string, slug: string, genre: string[], premise: string): NovelMeta {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    slug,
    genre,
    premise,
    logline: "",
    pov: "第三人称限知",
    tense: "过去时",
    createdAt: new Date().toISOString(),
  };
}

export function emptyState(): NovelState {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentChapter: 1,
    currentEventId: null,
    chapterStatus: "not_started",
    pendingReflow: false,
    config: {
      recentChapters: 5,
      models: { draft: null, review: null, brainstorm: null },
    },
  };
}

export function emptySettingIndex(): SettingIndex {
  return { schemaVersion: SCHEMA_VERSION, items: [] };
}

export function emptyCharacterIndex(): CharacterIndex {
  return { schemaVersion: SCHEMA_VERSION, characters: [] };
}

export function emptyRelations(): RelationsDoc {
  return { schemaVersion: SCHEMA_VERSION, relations: [] };
}

export function emptyEventIndex(): EventIndex {
  return { schemaVersion: SCHEMA_VERSION, events: [] };
}

export function emptyChapterIndex(): ChapterIndex {
  return { schemaVersion: SCHEMA_VERSION, chapters: [] };
}
