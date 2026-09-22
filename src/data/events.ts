/**
 * 事件的读写。
 *
 * 伏笔**复用同一结构**，不另建台账：`origin: "foreshadow"`，`plantedIn` 与
 * `payoffExpectedAt` 才有值（见 docs/design/data.md「events/index.json」）。
 * 收益是审查项 E2 不需要任何新数据结构，筛 `origin == foreshadow && status == planned` 即可。
 *
 * 事件的详述文件里，「当前描述」永远是覆盖式的最新版本，「细化历史」是追加式的历史。
 * 审查项 D3（事件进度倒挂）就是拿正文比「当前描述」。
 */

import { readText, writeTextAtomic } from "./io.ts";
import { NAMES, chapterIndexPath, eventDocPath, eventIndexPath } from "./paths.ts";
import { applySectionOps, chapterLine, composeDoc, readSectionLines } from "./md.ts";
import { readDocOrNull, writeDoc } from "./doc.ts";
import { chapterNo, nextId, requireId } from "./ids.ts";
import { DataError } from "./errors.ts";
import {
  ChapterIndexSchema,
  emptyEventIndex,
  EventIndexSchema,
  type EventOrigin,
  type EventStatus,
  type StoryEvent,
} from "./schema.ts";

const ORDER_STEP = 10;

export interface UpsertEventInput {
  id?: string | undefined;
  title: string;
  stage: string;
  origin: EventOrigin;
  status?: EventStatus | undefined;
  /** 省略则新建时取「最大 order + 10」，保证新增事件排在最后。 */
  order?: number | undefined;
  dependsOn?: string[] | undefined;
  leadsTo?: string[] | undefined;
  characters?: string[] | undefined;
  settings?: string[] | undefined;
  plantedIn?: number | null | undefined;
  payoffExpectedAt?: number | null | undefined;
}

export interface UpsertEventResult {
  id: string;
  created: boolean;
}

export function listEvents(root: string): StoryEvent[] {
  const index = readDocOrNull(eventIndexPath(root), EventIndexSchema, NAMES.eventsIndex);
  return index?.events ?? [];
}

export function upsertEvent(
  root: string,
  input: UpsertEventInput,
  known: { characters: readonly string[]; settings: readonly string[] },
): UpsertEventResult {
  const indexPath = eventIndexPath(root);
  const index = readDocOrNull(indexPath, EventIndexSchema, NAMES.eventsIndex) ?? emptyEventIndex();

  const knownIds = index.events.map((entry) => entry.id);
  const created = input.id === undefined;
  const id = input.id ?? nextId("event", knownIds);
  if (!created) requireId("event", id, knownIds);

  const previous = index.events.find((entry) => entry.id === id);
  const dependsOn = input.dependsOn ?? previous?.dependsOn ?? [];
  const leadsTo = input.leadsTo ?? previous?.leadsTo ?? [];

  // 引用完整性：事件之间的依赖链断了，审查项 D3 / E1 就无从判定。
  for (const ref of [...dependsOn, ...leadsTo]) requireId("event", ref, knownIds);
  for (const ref of input.characters ?? previous?.characters ?? []) requireId("character", ref, known.characters);
  for (const ref of input.settings ?? previous?.settings ?? []) requireId("setting", ref, known.settings);

  const origin = input.origin;
  const plantedIn = input.plantedIn ?? previous?.plantedIn ?? null;
  const payoffExpectedAt = input.payoffExpectedAt ?? previous?.payoffExpectedAt ?? null;
  assertForeshadowFields(origin, plantedIn, payoffExpectedAt);

  const order = input.order ?? previous?.order ?? nextOrder(index.events);

  const event: StoryEvent = {
    id,
    title: input.title,
    stage: input.stage,
    status: input.status ?? previous?.status ?? "planned",
    order,
    chapters: previous?.chapters ?? [],
    dependsOn,
    leadsTo,
    characters: input.characters ?? previous?.characters ?? [],
    settings: input.settings ?? previous?.settings ?? [],
    origin,
    plantedIn,
    payoffExpectedAt,
  };

  // 先详述 md，再索引 json（顺序理由同 settings.ts）。已有 md 时保留「当前描述」与「细化历史」。
  const path = eventDocPath(root, id);
  const existing = readText(path);
  const keptDescription = existing === null ? [] : readSectionLines(existing, "当前描述");
  const keptHistory = existing === null ? [] : readSectionLines(existing, "细化历史");
  writeTextAtomic(
    path,
    composeDoc(`${id} ${event.title}`, "", [
      { title: "当前描述", lines: keptDescription.length > 0 ? keptDescription : ["（待细化）"] },
      { title: "细化历史", lines: keptHistory },
      { title: "涉及", lines: renderInvolved(event) },
    ]),
  );

  const events = previous === undefined ? [...index.events, event] : index.events.map((x) => (x.id === id ? event : x));
  writeDoc(indexPath, EventIndexSchema, { ...index, events }, NAMES.eventsIndex);

  return { id, created };
}

/**
 * 事件细化：更新「当前描述」（覆盖）并追加「细化历史」（追加）。
 *
 * 旧描述不会被丢掉 —— 它已经在细化历史里；把最新最细的版本放到「当前描述」
 * 是为了让审查项 D3 拿正文比的就是最新版本。
 */
export function refineEvent(root: string, id: string, chapter: number, description: string): void {
  const path = eventDocPath(root, id);
  requireId("event", id, listEvents(root).map((entry) => entry.id));
  const current = readText(path);
  if (current === null) {
    throw new DataError(`事件详述文件不存在：${path}（索引里有 ${id} 但没有对应文件，数据已不一致）`);
  }
  const next = applySectionOps(
    current,
    [
      { kind: "replace", title: "当前描述", lines: [description] },
      { kind: "append", title: "细化历史", lines: [chapterLine(chapter, description)] },
    ],
    path,
  );
  writeTextAtomic(path, next);
}

export function setEventStatus(root: string, id: string, status: EventStatus): void {
  const indexPath = eventIndexPath(root);
  const index = readDocOrNull(indexPath, EventIndexSchema, NAMES.eventsIndex) ?? emptyEventIndex();
  requireId("event", id, index.events.map((entry) => entry.id));
  const events = index.events.map((entry) => (entry.id === id ? { ...entry, status } : entry));
  writeDoc(indexPath, EventIndexSchema, { ...index, events }, NAMES.eventsIndex);
}

/**
 * 把章节挂到事件上。
 *
 * `primary: true` 时同时设该章的 `primaryEventId` —— 一章可挂多个事件，
 * 但必须有主事件，因为上下文装配器要靠它决定注入哪条事件的全文。
 */
export function linkEventChapter(root: string, eventId: string, chapter: number, primary: boolean): void {
  const indexPath = eventIndexPath(root);
  const index = readDocOrNull(indexPath, EventIndexSchema, NAMES.eventsIndex) ?? emptyEventIndex();
  requireId("event", eventId, index.events.map((entry) => entry.id));

  const events = index.events.map((entry) => {
    if (entry.id !== eventId) return entry;
    const chapters = entry.chapters.includes(chapter) ? entry.chapters : [...entry.chapters, chapter].sort((a, b) => a - b);
    return { ...entry, chapters };
  });
  writeDoc(indexPath, EventIndexSchema, { ...index, events }, NAMES.eventsIndex);

  // 「涉及」区段的章节行随之更新，它是章节列表的展开。
  const updated = events.find((entry) => entry.id === eventId);
  if (updated === undefined) return;
  const path = eventDocPath(root, eventId);
  const current = readText(path);
  if (current === null) return;
  writeTextAtomic(
    path,
    applySectionOps(current, [{ kind: "replace", title: "涉及", lines: renderInvolved(updated) }], path),
  );

  if (primary) setPrimaryEvent(root, chapter, eventId);
}

function setPrimaryEvent(root: string, chapter: number, eventId: string): void {
  const path = chapterIndexPath(root);
  const doc = readDocOrNull(path, ChapterIndexSchema, `${NAMES.chaptersDir}/${NAMES.chaptersIndex}`);
  if (doc === null) throw new DataError(`${NAMES.chaptersIndex} 不存在，无法把事件挂到第 ${chapter} 章`);
  if (!doc.chapters.some((entry) => entry.no === chapter)) {
    throw new DataError(
      `第 ${chapter} 章还没有章节记录。先把章节大纲写入（novel_chapter_outline_write），再挂主事件 —— ` +
        `否则 primaryEventId 会静默丢失。`,
    );
  }
  const chapters = doc.chapters.map((entry) =>
    entry.no === chapter
      ? {
          ...entry,
          eventIds: entry.eventIds.includes(eventId) ? entry.eventIds : [...entry.eventIds, eventId],
          primaryEventId: eventId,
        }
      : entry,
  );
  writeDoc(path, ChapterIndexSchema, { ...doc, chapters }, `${NAMES.chaptersDir}/${NAMES.chaptersIndex}`);
}

function nextOrder(events: readonly StoryEvent[]): number {
  return events.reduce((max, entry) => Math.max(max, entry.order), 0) + ORDER_STEP;
}

function renderInvolved(event: StoryEvent): string[] {
  const lines: string[] = [];
  if (event.characters.length > 0) lines.push(`- 人物：${event.characters.join("、")}`);
  if (event.settings.length > 0) lines.push(`- 设定：${event.settings.join("、")}`);
  const chapters = event.chapters.map((no) => `CH-${chapterNo(no)}`).join(", ");
  lines.push(`- 章节：${chapters === "" ? "（无）" : chapters}`);
  return lines;
}

/** 伏笔字段只属于伏笔。非伏笔带了它们，说明调用方在混用两种语义。 */
function assertForeshadowFields(
  origin: EventOrigin,
  plantedIn: number | null,
  payoffExpectedAt: number | null,
): void {
  if (origin === "foreshadow") return;
  if (plantedIn === null && payoffExpectedAt === null) return;
  throw new DataError(
    `origin 为 ${origin} 的事件不能有 plantedIn / payoffExpectedAt（这两个字段只属于伏笔）。` +
      `如果这是一条伏笔，请把 origin 改成 foreshadow。`,
  );
}
