import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { writeJsonAtomic } from "./io.ts";

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
