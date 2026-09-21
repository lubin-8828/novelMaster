/**
 * 数据模型的类型定义。
 *
 * 这里是数据结构的名义真相；里程碑 2 会在此基础上加 typebox 运行时校验。
 * 字段含义见 docs/DESIGN.md §5.3。
 */

export const SCHEMA_VERSION = 1;

/* ---------- meta.json ---------- */

export interface NovelMeta {
  schemaVersion: number;
  title: string;
  slug: string;
  genre: string[];
  /** 用户最初想法的原文。不改写 —— 它是一切推断的根。 */
  premise: string;
  /** 整理后的一句话简介，可反复修改。 */
  logline: string;
  pov: string;
  tense: string;
  createdAt: string;
}

/* ---------- state.json ---------- */

export type ChapterStatus =
  | "not_started"
  | "outlined"
  | "drafted"
  | "auto_reviewed"
  | "deai_done"
  | "awaiting_user_review"
  | "user_edited"
  | "reflowed"
  | "ai_revised"
  | "accepted";

export interface NovelState {
  schemaVersion: number;
  currentChapter: number;
  currentEventId: string | null;
  chapterStatus: ChapterStatus;
  /** true 表示用户改了正文但还没回填资料。它是 /done 的闸门之一。 */
  pendingReflow: boolean;
  config: {
    /** 装配上下文时注入的最近正文章节数。 */
    recentChapters: number;
    /** 按用途覆盖模型；null 表示用 pi 默认。 */
    models: {
      draft: string | null;
      review: string | null;
      brainstorm: string | null;
    };
  };
}

/* ---------- setting/ ---------- */

export type SettingCategory = "world_rule" | "location" | "faction" | "item" | "taboo" | "custom";

export interface SettingItem {
  id: string;
  name: string;
  category: SettingCategory;
  summary: string;
  /** 首次确立于第几章；0 表示在设定期建立。 */
  establishedIn: number;
  tags: string[];
  deprecated: boolean;
  updatedAt: string;
}

export interface SettingIndex {
  schemaVersion: number;
  items: SettingItem[];
}

/* ---------- characters/ ---------- */

export type CharacterRole = "protagonist" | "antagonist" | "supporting" | "minor";
export type CharacterStatus = "alive" | "dead" | "missing" | "unknown";

export interface CharacterStatic {
  age: number | null;
  gender: string;
  appearance: string;
  background: string;
  personality: string;
  speechHabits: string;
  goal: string;
  fear: string;
}

export interface Character {
  id: string;
  name: string;
  aliases: string[];
  role: CharacterRole;
  firstAppeared: number;
  status: CharacterStatus;
  /** 最后一次被回填更新的章节号。用于发现"这个角色很久没更新了"。 */
  lastUpdatedChapter: number;
  static: CharacterStatic;
}

export interface CharacterIndex {
  schemaVersion: number;
  characters: Character[];
}

/* ---------- relations.json ---------- */

export type RelationStatus = "active" | "broken" | "ended";

export interface RelationHistoryEntry {
  chapter: number;
  change: string;
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  type: string;
  directed: boolean;
  status: RelationStatus;
  since: number;
  history: RelationHistoryEntry[];
}

export interface RelationsDoc {
  schemaVersion: number;
  relations: Relation[];
}

/* ---------- events/ ---------- */

export type EventStatus = "planned" | "in_progress" | "done" | "abandoned";
export type EventOrigin = "ai_proposed" | "user_specified" | "foreshadow";

export interface StoryEvent {
  id: string;
  title: string;
  stage: string;
  status: EventStatus;
  order: number;
  chapters: number[];
  dependsOn: string[];
  leadsTo: string[];
  origin: EventOrigin;
  /** 伏笔专用：埋设章节。非伏笔为 null。 */
  plantedIn: number | null;
  /** 伏笔专用：预计回收章节，可为空。非伏笔为 null。 */
  payoffExpectedAt: number | null;
}

export interface EventIndex {
  schemaVersion: number;
  events: StoryEvent[];
}

/* ---------- chapters/ ---------- */

export interface ChapterRecord {
  no: number;
  title: string;
  eventIds: string[];
  primaryEventId: string | null;
  status: ChapterStatus;
  wordCount: number;
  revisionCount: number;
  createdAt: string;
  acceptedAt: string | null;
}

export interface ChapterIndex {
  schemaVersion: number;
  chapters: ChapterRecord[];
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
