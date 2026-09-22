/**
 * 上下文装配器。
 *
 * 规格见 docs/design/ai.md「上下文装配器」。这是整个系统的中枢：
 * **装配器的质量 = 成书质量**。
 *
 * 顺序原则：**从最稳定排到最易变，最「当下」的放最后**（1–6 段在相邻章节间几乎不变，
 * 只有 7–9 段会变）。稳定部分放前面 = 可命中的 prompt 缓存前缀，而在「每章都要重建
 * 上下文」的架构下，命中的恰好是占比最大的那部分。
 *
 * 九段全部保留，**空的也保留**（内容写「（无…）」）：段号稳定，`/context` 才能把
 * 「第 4 段是空的」这个信号显示出来。过滤掉空段会把「没有主事件」变成「少了一行」，
 * 而这两者对用户的含义完全不同。
 */

import { readText } from "../data/io.ts";
import {
  chapterOutlinePath,
  chapterSummaryPath,
  chapterTextPath,
  characterDocPath,
  eventDocPath,
  settingDocPath,
} from "../data/paths.ts";
import { chapterNo } from "../data/ids.ts";
import { readOutlineBody } from "../data/outline.ts";
import { listChapters, readOutlineHeader, readSummaryAppearances, type SummaryAppearances } from "../data/chapters.ts";
import { listSettings } from "../data/settings.ts";
import { listCharacters } from "../data/characters.ts";
import { listRelations } from "../data/relations.ts";
import { listEvents } from "../data/events.ts";
import type { OpenNovel } from "../data/novel.ts";
import type { StoryEvent } from "../data/schema.ts";
import { estimateTokens } from "./tokens.ts";

export interface Segment {
  /** 稳定标识，用于 `/context <key>`。 */
  key: string;
  title: string;
  content: string;
  estimatedTokens: number;
  /** 这段内容来自哪些文件，供追溯。 */
  sources: string[];
}

export interface ContextBundle {
  chapter: number;
  segments: Segment[];
  totalEstimatedTokens: number;
}

export function assemble(novel: OpenNovel, chapter: number): ContextBundle {
  const recent = novel.state.config.recentChapters;

  // 相关性判定的三个来源（取并集，见 ai.md「相关性判定」）。
  const header = chapterOutlineHeader(novel.root, chapter);
  const primaryEvent = resolvePrimaryEvent(novel, chapter);
  const appearances = recentAppearances(novel.root, chapter, recent);

  const relatedCharacters = unique([
    ...(header?.characters ?? []),
    ...(primaryEvent?.characters ?? []),
    ...appearances.characters,
  ]);
  const relatedSettings = unique([
    ...(header?.settings ?? []),
    ...(primaryEvent?.settings ?? []),
    ...appearances.settings,
  ]);

  const segments = [
    metaSegment(novel),
    outlineSegment(novel),
    settingsSegment(novel, relatedSettings),
    eventSegment(novel, primaryEvent),
    charactersSegment(novel, relatedCharacters),
    relationsSegment(novel, relatedCharacters),
    recentChaptersSegment(novel, chapter, recent),
    earlierSummariesSegment(novel, chapter, recent),
    chapterOutlineSegment(novel, chapter),
  ];

  return {
    chapter,
    segments,
    totalEstimatedTokens: segments.reduce((sum, item) => sum + item.estimatedTokens, 0),
  };
}

/* ---------- 九段 ---------- */

function metaSegment(novel: OpenNovel): Segment {
  const meta = novel.meta;
  const content = [
    `《${meta.title}》`,
    `类型：${meta.genre.join("、") || "（未定）"}`,
    `核心想法（用户原文，未经改写）：${meta.premise}`,
    `一句话简介：${meta.logline === "" ? "（未定）" : meta.logline}`,
    `叙事视角：${meta.pov}`,
    `时态：${meta.tense}`,
  ].join("\n");
  return segment("meta", "meta", content, ["meta.json"]);
}

/** 大纲全文（不含修订记录 —— 那是历史，不参与「这章怎么写」）。 */
function outlineSegment(novel: OpenNovel): Segment {
  const body = readOutlineBody(novel.root);
  return segment("outline", "主线大纲", body === null ? "（大纲文件缺失）" : body === "" ? "（大纲还是空的）" : body, [
    "outline.md",
  ]);
}

/** 设定是**双层**的：全部条目的摘要（防止编新设定） + 相关条目的全文（防止写矛盾）。 */
function settingsSegment(novel: OpenNovel, related: readonly string[]): Segment {
  const items = listSettings(novel.root);
  const lines: string[] = [];
  const sources = ["setting/index.json"];

  if (items.length === 0) {
    lines.push("（还没有设定条目）");
  } else {
    lines.push("全部条目的摘要：", "");
    for (const item of items) {
      const flag = item.deprecated ? "[已废止] " : "";
      lines.push(`- ${item.id} [${item.category}] ${flag}${item.name}：${item.summary}`);
    }
  }

  const detailed = items.filter((item) => related.includes(item.id));
  if (detailed.length > 0) {
    lines.push("", "本章相关条目的全文：", "");
    for (const item of detailed) {
      const doc = readText(settingDocPath(novel.root, item.id));
      lines.push(`—— ${item.id} ${item.name} ——`, "", doc === null ? "（详述文件缺失）" : doc.trim(), "");
      sources.push(`setting/${item.id}.md`);
    }
  }

  return segment("settings", "设定", lines.join("\n"), sources);
}

function eventSegment(novel: OpenNovel, event: StoryEvent | null): Segment {
  if (event === null) {
    return segment(
      "event",
      "当前事件",
      "（没有确定的主事件：章节记录的 primaryEventId 与 state.json 的 currentEventId 都为空）",
      [],
    );
  }
  const doc = readText(eventDocPath(novel.root, event.id));
  return segment("event", `当前事件（${event.id}）`, doc === null ? "（事件详述缺失）" : doc.trim(), [
    `events/${event.id}.md`,
  ]);
}

/** 相关人物给**全量时间轴**：条目很短，截断会让 AI 以为早期经历没发生过。 */
function charactersSegment(novel: OpenNovel, related: readonly string[]): Segment {
  const picked = listCharacters(novel.root).filter((entry) => related.includes(entry.id));
  if (picked.length === 0) {
    return segment("characters", "相关人物", "（本章未关联任何人物）", []);
  }
  const lines: string[] = [];
  const sources: string[] = [];
  for (const entry of picked) {
    const doc = readText(characterDocPath(novel.root, entry.id));
    lines.push(`—— ${entry.id} ${entry.name} ——`, "", doc === null ? "（档案缺失）" : doc.trim(), "");
    sources.push(`characters/${entry.id}.md`);
  }
  return segment("characters", "相关人物", lines.join("\n"), sources);
}

/** 只取**两端都在**相关人物集合内的关系：只提一端的关系是无效信息。 */
function relationsSegment(novel: OpenNovel, related: readonly string[]): Segment {
  const picked = listRelations(novel.root).filter(
    (relation) => related.includes(relation.from) && related.includes(relation.to),
  );
  if (picked.length === 0) {
    return segment("relations", "相关关系", "（没有两端都在相关人物集合内的关系）", []);
  }
  const lines = picked.map((relation) => {
    const head = `- ${relation.id} ${relation.from} → ${relation.to}（${relation.type} / ${relation.status}）`;
    if (relation.history.length === 0) return head;
    const history = relation.history.map((entry) => `[CH-${chapterNo(entry.chapter)}] ${entry.change}`).join("；");
    return `${head}\n  变更史：${history}`;
  });
  return segment("relations", "相关关系", lines.join("\n"), ["relations.json"]);
}

/** 唯一注入原文正文的一段，也是成本主项。 */
function recentChaptersSegment(novel: OpenNovel, chapter: number, recent: number): Segment {
  const parts: string[] = [];
  const sources: string[] = [];
  for (let no = Math.max(1, chapter - recent); no < chapter; no += 1) {
    const text = readText(chapterTextPath(novel.root, no));
    if (text === null) continue;
    parts.push(`—— 第 ${chapterNo(no)} 章 ——`, "", text.trim(), "");
    sources.push(`chapters/${chapterNo(no)}.txt`);
  }
  // 标题写实际章数：N 是「最多往前几章」，而用户看到「最近 5 章」会按 5 章的
  // 体量算账——这本书才写了 2 章时，那是 2.5 倍的误判。
  const title = sources.length === recent ? `最近 ${recent} 章正文` : `最近 ${recent} 章正文（实际 ${sources.length} 章）`;
  return segment("recent", title, parts.length === 0 ? "（还没有已写的章节）" : parts.join("\n"), sources);
}

function earlierSummariesSegment(novel: OpenNovel, chapter: number, recent: number): Segment {
  const upTo = chapter - recent - 1;
  const parts: string[] = [];
  const sources: string[] = [];
  for (let no = 1; no <= upTo; no += 1) {
    const text = readText(chapterSummaryPath(novel.root, no));
    if (text === null) continue;
    parts.push(text.trim(), "");
    sources.push(`chapters/${chapterNo(no)}.summary.md`);
  }
  return segment(
    "summaries",
    "更早章节摘要",
    parts.length === 0 ? "（没有更早的章节）" : parts.join("\n"),
    sources,
  );
}

/** 放最后：当下任务最不该被忽略。 */
function chapterOutlineSegment(novel: OpenNovel, chapter: number): Segment {
  const text = readText(chapterOutlinePath(novel.root, chapter));
  return segment(
    "chapter-outline",
    `第 ${chapter} 章大纲`,
    text === null ? `（第 ${chapter} 章还没有大纲）` : text.trim(),
    text === null ? [] : [`chapters/${chapterNo(chapter)}.outline.md`],
  );
}

/* ---------- 辅助 ---------- */

function segment(key: string, title: string, content: string, sources: readonly string[]): Segment {
  return { key, title, content, estimatedTokens: estimateTokens(content), sources: [...sources] };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ""))];
}

function chapterOutlineHeader(root: string, chapter: number): ReturnType<typeof readOutlineHeader> {
  const text = readText(chapterOutlinePath(root, chapter));
  return text === null ? null : readOutlineHeader(text);
}

/** 章节记录的主事件优先；写正文前它可能还没设，回退到 `state.json`。 */
function resolvePrimaryEvent(novel: OpenNovel, chapter: number): StoryEvent | null {
  const record = listChapters(novel.root).find((entry) => entry.no === chapter);
  const id = record?.primaryEventId ?? novel.state.currentEventId;
  if (id === null || id === undefined) return null;
  return listEvents(novel.root).find((entry) => entry.id === id) ?? null;
}

function recentAppearances(root: string, chapter: number, recent: number): SummaryAppearances {
  const characters = new Set<string>();
  const settings = new Set<string>();
  for (let no = Math.max(1, chapter - recent); no < chapter; no += 1) {
    const text = readText(chapterSummaryPath(root, no));
    if (text === null) continue;
    const found = readSummaryAppearances(text);
    for (const id of found.characters) characters.add(id);
    for (const id of found.settings) settings.add(id);
  }
  return { characters: [...characters], settings: [...settings] };
}
