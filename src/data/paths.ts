import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import process from "node:process";
import { homedir } from "node:os";
import { writeJsonAtomic } from "./io.ts";
import { chapterNo } from "./ids.ts";

/** 应用状态目录名（位于用户主目录下）。 */
export const APP_DIR = ".novelmaster";
/** 应用级配置文件名。 */
export const CONFIG_FILE = "config.json";
/** 小说目录名（位于状态目录下）。 */
export const DEFAULT_NOVELS_DIR = "novels";
/** 覆盖状态目录的环境变量名。 */
export const HOME_ENV = "NOVELMASTER_HOME";

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

/**
 * 应用状态目录：`~/.novelmaster/`。
 *
 * **全局，与运行目录无关** —— 任何目录敲 `novelmaster` 都是同一本书。
 * 早期版本把它放在运行目录下，结果是「换个目录书就没了」的惊吓（见 `decisions.md`）。
 *
 * `NOVELMASTER_HOME` 可覆盖它：状态全局化后测试会互写同一个 config.json，
 * 而这个开关把「数据放哪」从不可控变成可注入。
 */
export function appDir(): string {
  const override = process.env[HOME_ENV];
  return override !== undefined && override !== "" ? resolve(override) : join(homedir(), APP_DIR);
}

export function configPath(): string {
  return join(appDir(), CONFIG_FILE);
}

/** 新建小说时的默认根目录：`~/.novelmaster/novels/<slug>/`。 */
export function defaultNovelRoot(slug: string): string {
  return join(appDir(), DEFAULT_NOVELS_DIR, slug);
}

export function readConfig(): AppConfig {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...EMPTY_CONFIG };
    const root = (parsed as { novelRoot?: unknown }).novelRoot;
    return { novelRoot: typeof root === "string" ? resolve(root) : null };
  } catch {
    // 配置不存在或损坏都视为「没有打开小说」。不抛错：
    // 首次启动是常态，不该让用户先看到一堆异常。
    return { ...EMPTY_CONFIG };
  }
}

export function writeConfig(config: AppConfig): void {
  writeJsonAtomic(configPath(), config);
}
