import { join } from "node:path";
import { NAMES, readConfig } from "./paths.ts";
import { readJson } from "./io.ts";
import type { NovelMeta, NovelState } from "./schema.ts";

export interface OpenNovel {
  root: string;
  meta: NovelMeta;
  state: NovelState;
}

/** 按绝对路径打开小说。文件缺失或损坏返回 null，不抛错。 */
export function openNovelAt(root: string): OpenNovel | null {
  const meta = readJson<NovelMeta>(join(root, NAMES.meta));
  const state = readJson<NovelState>(join(root, NAMES.state));
  if (!meta || !state) return null;
  return { root, meta, state };
}

/** 打开当前 cwd 配置里指向的小说。 */
export function openNovel(cwd: string): OpenNovel | null {
  const root = readConfig(cwd).novelRoot;
  return root ? openNovelAt(root) : null;
}
