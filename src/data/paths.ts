import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { writeJsonAtomic } from "./io.ts";
import { chapterNo } from "./ids.ts";

/** 应用级配置目录（相对运行目录）。 */
export const APP_DIR = ".novelmaster";
/** 应用级配置文件名。 */
export const CONFIG_FILE = "config.json";
/** 默认的小说根目录名（相对运行目录）。 */
export const DEFAULT_NOVELS_DIR = "novels";

/** 小说根目录内部的文件与目录名。集中在这里，避免各处硬编码字符串。 */
export const NAMES = {
  meta: "meta.json",
  state: "state.json",
  inbox: "inbox.md",
  outline: "outline.md",
  relations: "relations.json",
  settingDir: "setting",
  settingIndex: "index.json",
  charactersDir: "characters",
  charactersIndex: "index.json",
  eventsDir: "events",
  eventsIndex: "index.json",
  chaptersDir: "chapters",
  chaptersIndex: "index.json",
  logsDir: "logs",
  operations: "operations.jsonl",
} as const;

export interface AppConfig {
  /** 当前打开的小说根目录（绝对路径）；未打开时为 null。 */
  novelRoot: string | null;
}

/* ---------- 小说根下的具体路径 ---------- */

/**
 * 集中路径构造。
 *
 * 与 `NAMES` 分开的理由：`NAMES` 是文件名的单点来源，这些函数是「在哪里」的单点来源。
 * 散在各模块里拼 `join(root, "chapters", ...)` 的后果是重命名一个目录时
 * 要全局搜字符串，而漏掉的那处会在运行时才炸。
 */

export function metaPath(root: string): string {
  return join(root, NAMES.meta);
}

export function statePath(root: string): string {
  return join(root, NAMES.state);
}

export function relationsPath(root: string): string {
  return join(root, NAMES.relations);
}

export function inboxPath(root: string): string {
  return join(root, NAMES.inbox);
}

export function outlinePath(root: string): string {
  return join(root, NAMES.outline);
}

export function operationsPath(root: string): string {
  return join(root, NAMES.logsDir, NAMES.operations);
}

export function settingIndexPath(root: string): string {
  return join(root, NAMES.settingDir, NAMES.settingIndex);
}

export function settingDocPath(root: string, id: string): string {
  return join(root, NAMES.settingDir, `${id}.md`);
}

export function characterIndexPath(root: string): string {
  return join(root, NAMES.charactersDir, NAMES.charactersIndex);
}

export function characterDocPath(root: string, id: string): string {
  return join(root, NAMES.charactersDir, `${id}.md`);
}

export function eventIndexPath(root: string): string {
  return join(root, NAMES.eventsDir, NAMES.eventsIndex);
}

export function eventDocPath(root: string, id: string): string {
  return join(root, NAMES.eventsDir, `${id}.md`);
}

export function chapterIndexPath(root: string): string {
  return join(root, NAMES.chaptersDir, NAMES.chaptersIndex);
}

export function chapterTextPath(root: string, no: number): string {
  return join(root, NAMES.chaptersDir, `${chapterNo(no)}.txt`);
}

export function chapterOutlinePath(root: string, no: number): string {
  return join(root, NAMES.chaptersDir, `${chapterNo(no)}.outline.md`);
}

export function chapterSummaryPath(root: string, no: number): string {
  return join(root, NAMES.chaptersDir, `${chapterNo(no)}.summary.md`);
}

/** 报告文件名由 `kind` 决定：`review` / `deai` / `reflow`。 */
export function chapterReportPath(root: string, no: number, kind: string): string {
  return join(root, NAMES.chaptersDir, `${chapterNo(no)}.${kind}.md`);
}

const EMPTY_CONFIG: AppConfig = { novelRoot: null };

export function appDir(cwd: string): string {
  return join(cwd, APP_DIR);
}

export function configPath(cwd: string): string {
  return join(appDir(cwd), CONFIG_FILE);
}

export function defaultNovelRoot(cwd: string, slug: string): string {
  return join(cwd, DEFAULT_NOVELS_DIR, slug);
}

export function readConfig(cwd: string): AppConfig {
  try {
    const raw = readFileSync(configPath(cwd), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...EMPTY_CONFIG };
    const root = (parsed as { novelRoot?: unknown }).novelRoot;
    return { novelRoot: typeof root === "string" ? resolve(root) : null };
  } catch {
    // 配置不存在或损坏都视为"没有打开小说"。不抛错：
    // 首启动是常态，不该让用户先看到一堆异常。
    return { ...EMPTY_CONFIG };
  }
}

export function writeConfig(cwd: string, config: AppConfig): void {
  writeJsonAtomic(configPath(cwd), config);
}
