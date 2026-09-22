import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { NAMES } from "./paths.ts";
import { exists, writeJsonAtomic, writeTextAtomic } from "./io.ts";
import { stamp } from "./md.ts";
import {
  emptyChapterIndex,
  emptyCharacterIndex,
  emptyEventIndex,
  emptyMeta,
  emptyRelations,
  emptySettingIndex,
  emptyState,
  type NovelMeta,
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
 * 这种操作不能有「手滑」的入口，必须是显式的、另起的动作。
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
      [
        "# 想法收集箱 (Inbox)",
        "",
        "> 追加式。不整理、不评判、不删除。",
        "",
        "## 记录",
        "",
        `- [${stamp()}] 建书想法：${input.premise}`,
        "",
      ].join("\n"),
    ),
  );
  write(NAMES.outline, () =>
    writeTextAtomic(
      join(root, NAMES.outline),
      [
        `# ${input.title} · 故事主线大纲`,
        "",
        "## 一句话主题",
        "",
        "（待定）",
        "",
        "## 阶段划分",
        "",
        "（待定）",
        "",
        "## 主要冲突",
        "",
        "（待定）",
        "",
        "## 结局",
        "",
        "（待定）",
        "",
        "## 修订记录",
        "",
        `- [${stamp()}] 建立大纲骨架。`,
        "",
      ].join("\n"),
    ),
  );
  write(`${NAMES.logsDir}/${NAMES.operations}`, () =>
    writeTextAtomic(join(root, NAMES.logsDir, NAMES.operations), ""),
  );

  return { root, meta, files };
}
