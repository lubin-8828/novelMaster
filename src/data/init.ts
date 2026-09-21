import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { NAMES } from "./paths.ts";
import { exists, writeJsonAtomic, writeTextAtomic } from "./io.ts";
import {
  emptyMeta,
  emptyState,
  SCHEMA_VERSION,
  type ChapterIndex,
  type CharacterIndex,
  type EventIndex,
  type NovelMeta,
  type RelationsDoc,
  type SettingIndex,
} from "./schema.ts";

export interface NovelInitInput {
  title: string;
  genre: string[];
  premise: string;
}

export interface NovelInitResult {
  root: string;
  meta: NovelMeta;
  files: string[];
}

/**
 * 由书名生成目录名。
 *
 * 保留中文（\p{Letter} 覆盖汉字），只把空白与符号折成连字符 ——
 * 中文书名是常态，用 ASCII 化会得到一串没意义的 slug。
 */
export function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base || "novel";
}

export function isNovelRoot(root: string): boolean {
  return exists(join(root, NAMES.meta)) && exists(join(root, NAMES.state));
}

/**
 * 初始化一本小说。
 *
 * 已存在同名的 meta.json 时拒绝执行 —— 覆盖一本小说等于抹掉用户全部创作，
 * 这种操作不能有"手滑"的入口，必须是显式的、另起的动作。
 */
export function initNovel(root: string, input: NovelInitInput): NovelInitResult {
  if (isNovelRoot(root)) {
    throw new Error(`该目录已经是一本小说（存在 ${NAMES.meta}）：${root}`);
  }

  mkdirSync(join(root, NAMES.settingDir), { recursive: true });
  mkdirSync(join(root, NAMES.charactersDir), { recursive: true });
  mkdirSync(join(root, NAMES.eventsDir), { recursive: true });
  mkdirSync(join(root, NAMES.chaptersDir), { recursive: true });
  mkdirSync(join(root, NAMES.logsDir), { recursive: true });

  const files: string[] = [];
  const write = (name: string, run: () => void): void => {
    run();
    files.push(name);
  };

  const meta = emptyMeta(input.title, slugify(input.title), input.genre, input.premise);

  write(NAMES.meta, () => writeJsonAtomic(join(root, NAMES.meta), meta));
  write(NAMES.state, () => writeJsonAtomic(join(root, NAMES.state), emptyState()));
  write(NAMES.relations, () => writeJsonAtomic(join(root, NAMES.relations), emptyRelations()));
  write(`${NAMES.settingDir}/${NAMES.settingIndex}`, () =>
    writeJsonAtomic(join(root, NAMES.settingDir, NAMES.settingIndex), emptySettingIndex()),
  );
  write(`${NAMES.charactersDir}/${NAMES.charactersIndex}`, () =>
    writeJsonAtomic(join(root, NAMES.charactersDir, NAMES.charactersIndex), emptyCharacterIndex()),
  );
  write(`${NAMES.eventsDir}/${NAMES.eventsIndex}`, () =>
    writeJsonAtomic(join(root, NAMES.eventsDir, NAMES.eventsIndex), emptyEventIndex()),
  );
  write(`${NAMES.chaptersDir}/${NAMES.chaptersIndex}`, () =>
    writeJsonAtomic(join(root, NAMES.chaptersDir, NAMES.chaptersIndex), emptyChapterIndex()),
  );
  write(NAMES.inbox, () =>
    writeTextAtomic(
      join(root, NAMES.inbox),
      `# 想法收集箱 (Inbox)\n\n> 追加式。不整理、不评判、不删除。\n> - [YYYY-MM-DD HH:mm] 内容\n\n- [${stamp()}] 建书想法：${input.premise}\n`,
    ),
  );
  write(NAMES.outline, () =>
    writeTextAtomic(
      join(root, NAMES.outline),
      `# ${input.title} · 故事主线大纲\n\n## 一句话主题\n\n（待定）\n\n## 阶段划分\n\n（待定）\n\n## 主要冲突\n\n（待定）\n\n## 结局\n\n（待定）\n\n## 修订记录\n\n- [${stamp()}] 建立大纲骨架。\n`,
    ),
  );
  write(`${NAMES.logsDir}/${NAMES.operations}`, () =>
    writeTextAtomic(join(root, NAMES.logsDir, NAMES.operations), ""),
  );

  return { root, meta, files };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function emptySettingIndex(): SettingIndex {
  return { schemaVersion: SCHEMA_VERSION, items: [] };
}

function emptyCharacterIndex(): CharacterIndex {
  return { schemaVersion: SCHEMA_VERSION, characters: [] };
}

function emptyRelations(): RelationsDoc {
  return { schemaVersion: SCHEMA_VERSION, relations: [] };
}

function emptyEventIndex(): EventIndex {
  return { schemaVersion: SCHEMA_VERSION, events: [] };
}

function emptyChapterIndex(): ChapterIndex {
  return { schemaVersion: SCHEMA_VERSION, chapters: [] };
}
