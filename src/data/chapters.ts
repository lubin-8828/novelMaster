/**
 * 章节文件与章节索引的读写。
 *
 * 正文 `NNN.txt` 是**唯一**受「禁止 markdown」约束的文件，写前跑正文校验。
 * 校验只提示不阻断，落点是两段式：首次调用（不带 `acknowledgeMarkdown`）命中
 * 标记时不落盘，把命中清单返回给 LLM 去问用户；用户确认后带 `acknowledgeMarkdown: true`
 * 重调才落盘。理由见 docs/design/data.md「正文校验」。
 *
 * 章节索引里的 `status` 是**派生数据**：进度真相只有 `state.json` 一份（见 data.md「四条设计原则」）。
 * 状态变化时由 `syncChapterStatus` 同步，读的时候不要把它当独立真相。
 */

import { readText, writeTextAtomic } from "./io.ts";
import {
  NAMES,
  chapterIndexPath,
  chapterOutlinePath,
  chapterReportPath,
  chapterSummaryPath,
  chapterTextPath,
} from "./paths.ts";
import { applySectionOps, chapterLine, composeDoc, readSectionLines, stamp, stripSection } from "./md.ts";
import { readDocOrNull, writeDoc } from "./doc.ts";
import { chapterNo } from "./ids.ts";
import { DataError } from "./errors.ts";
import {
  ChapterIndexSchema,
  emptyChapterIndex,
  type ChapterRecord,
  type ChapterStatus,
  type ReportKind,
  type SummarySections,
} from "./schema.ts";

/* ---------- 正文校验 ---------- */

export interface MarkdownHit {
  /** 行号，从 1 开始。 */
  line: number;
  pattern: string;
  snippet: string;
}

const MARKDOWN_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["markdown 标题", /^#{1,6} /],
  ["加粗", /\*\*[^*]+\*\*/],
  ["引用", /^> /],
  ["代码", /`/],
  ["列表", /^[-*] /],
];

export function scanMarkdown(text: string): MarkdownHit[] {
  const hits: MarkdownHit[] = [];
  text.split("\n").forEach((line, index) => {
    for (const [pattern, regex] of MARKDOWN_PATTERNS) {
      if (regex.test(line)) {
        hits.push({ line: index + 1, pattern, snippet: line.trim().slice(0, 40) });
        break;
      }
    }
  });
  return hits;
}

/** 中文字数口径：去掉全部空白后的字符数。标点计入，因为中文标点占据正文篇幅。 */
export function countWords(text: string): number {
  return text.replace(/\s/gu, "").length;
}

/* ---------- 写入 ---------- */

export interface WriteChapterTextInput {
  chapter: number;
  text: string;
  /** 用户已确认「正文里确实要有这些 markdown 标记」。省略时不落盘。 */
  acknowledgeMarkdown?: boolean | undefined;
}

export interface WriteChapterTextResult {
  hits: MarkdownHit[];
  written: boolean;
  wordCount: number;
}

export function writeChapterText(root: string, input: WriteChapterTextInput): WriteChapterTextResult {
  const hits = scanMarkdown(input.text);
  const wordCount = countWords(input.text);
  if (hits.length > 0 && input.acknowledgeMarkdown !== true) {
    return { hits, written: false, wordCount };
  }
  const text = input.text.endsWith("\n") ? input.text : `${input.text}\n`;
  writeTextAtomic(chapterTextPath(root, input.chapter), text);
  upsertChapterRecord(root, { chapter: input.chapter, wordCount }, true);
  return { hits, written: true, wordCount };
}

export interface WriteChapterOutlineInput {
  chapter: number;
  title: string;
  markdown: string;
  /** 用户确认本轮大纲时传入（内容记入「确认记录」）；草稿态省略。 */
  confirmNote?: string | undefined;
}

export function writeChapterOutline(root: string, input: WriteChapterOutlineInput): void {
  const path = chapterOutlinePath(root, input.chapter);
  const existing = readText(path);
  const kept = existing === null ? [] : readSectionLines(existing, "确认记录");
  const confirmations =
    input.confirmNote === undefined ? kept : [...kept, `- [${stamp()}] ${input.confirmNote}`];
  const body = stripSection(input.markdown, "确认记录").trim();
  writeTextAtomic(
    path,
    composeDoc(`第 ${chapterNo(input.chapter)} 章 ${input.title}`, body, [
      { title: "确认记录", lines: confirmations },
    ]),
  );
  upsertChapterRecord(root, { chapter: input.chapter, title: input.title }, false);
}

export function writeChapterSummary(root: string, chapter: number, sections: SummarySections): void {
  const text = composeDoc(`第 ${chapterNo(chapter)} 章 摘要`, sections.synopsis, [
    {
      title: "出场",
      lines: [
        `- 人物：${sections.appearedCharacters.join("、") || "无"}`,
        `- 地点：${sections.appearedLocations.join("、") || "无"}`,
      ],
    },
    {
      title: "推进",
      lines: [
        `- 事件：${sections.advancedEvents.map((e) => `${e.id}（${e.note}）`).join("、") || "无"}`,
      ],
    },
    {
      title: "新增信息",
      lines: [
        `- 设定：${sections.newSettings.join("、") || "无"}`,
        `- 伏笔：${sections.newForeshadows.join("、") || "无"}`,
      ],
    },
    { title: "结尾状态", lines: [sections.endState] },
  ]);
  writeTextAtomic(chapterSummaryPath(root, chapter), text);
}

export function writeChapterReport(
  root: string,
  chapter: number,
  kind: ReportKind,
  markdown: string,
): void {
  writeTextAtomic(chapterReportPath(root, chapter, kind), composeDoc(`第 ${chapterNo(chapter)} 章 ${reportTitle(kind)}`, markdown, []));
}

function reportTitle(kind: ReportKind): string {
  if (kind === "review") return "审查报告";
  if (kind === "deai") return "去 AI 味报告";
  return "回填报告";
}

/* ---------- 章节索引 ---------- */

export interface ChapterRecordInput {
  chapter: number;
  title?: string | undefined;
  eventIds?: string[] | undefined;
  primaryEventId?: string | null | undefined;
  wordCount?: number | undefined;
}

export function listChapters(root: string): ChapterRecord[] {
  const index = readDocOrNull(chapterIndexPath(root), ChapterIndexSchema, NAMES.chaptersIndex);
  return index?.chapters ?? [];
}

/**
 * 新建或更新章节记录。
 *
 * `bumpRevision` 只在**正文被重写**时为真（含 AI 改稿）。理由：`revisionCount`
 * 的用途是回答「这一版正文是第几次改出来的」，而重新写一遍大纲不算改正文。
 */
export function upsertChapterRecord(root: string, input: ChapterRecordInput, bumpRevision: boolean): void {
  const path = chapterIndexPath(root);
  const index = readDocOrNull(path, ChapterIndexSchema, NAMES.chaptersIndex) ?? emptyChapterIndex();
  const previous = index.chapters.find((entry) => entry.no === input.chapter);

  const record: ChapterRecord = {
    no: input.chapter,
    title: input.title ?? previous?.title ?? "",
    eventIds: input.eventIds ?? previous?.eventIds ?? [],
    primaryEventId: input.primaryEventId ?? previous?.primaryEventId ?? null,
    status: previous?.status ?? "not_started",
    wordCount: input.wordCount ?? previous?.wordCount ?? 0,
    revisionCount: (previous?.revisionCount ?? 0) + (bumpRevision ? 1 : 0),
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    acceptedAt: previous?.acceptedAt ?? null,
  };

  const chapters =
    previous === undefined
      ? [...index.chapters, record].sort((a, b) => a.no - b.no)
      : index.chapters.map((entry) => (entry.no === input.chapter ? record : entry));
  writeDoc(path, ChapterIndexSchema, { ...index, chapters }, NAMES.chaptersIndex);
}

/**
 * 把当前状态同步进章节记录的 `status`（派生字段）。
 *
 * 状态真相在 `state.json`；这里只是把它的值展开到章节索引里，
 * 好让「按章查历史」时不必再回读 state。两边不一致时以 state.json 为准。
 */
export function syncChapterStatus(root: string, chapter: number, status: ChapterStatus): void {
  const path = chapterIndexPath(root);
  const index = readDocOrNull(path, ChapterIndexSchema, NAMES.chaptersIndex) ?? emptyChapterIndex();
  if (!index.chapters.some((entry) => entry.no === chapter)) return;
  const chapters = index.chapters.map((entry) =>
    entry.no === chapter
      ? {
          ...entry,
          status,
          acceptedAt: status === "accepted" ? (entry.acceptedAt ?? new Date().toISOString()) : entry.acceptedAt,
        }
      : entry,
  );
  writeDoc(path, ChapterIndexSchema, { ...index, chapters }, NAMES.chaptersIndex);
}

/** 读第 N 章正文。不存在返回 null（不是错误，章还没写）。 */
export function readChapterText(root: string, chapter: number): string | null {
  return readText(chapterTextPath(root, chapter));
}

/** 读章节大纲。不存在抛错 —— 「大纲没了」不是常态。 */
export function readChapterOutline(root: string, chapter: number): string {
  const text = readText(chapterOutlinePath(root, chapter));
  if (text === null) throw new DataError(`第 ${chapter} 章还没有大纲文件`);
  return text;
}
