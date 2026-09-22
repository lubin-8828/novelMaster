import { readConfig, metaPath, statePath, NAMES } from "./paths.ts";
import { readDoc } from "./doc.ts";
import { errorText } from "./errors.ts";
import { type NovelMeta, NovelMetaSchema, type NovelState, NovelStateSchema } from "./schema.ts";

export interface OpenNovel {
  root: string;
  meta: NovelMeta;
  state: NovelState;
}

/**
 * 按绝对路径打开小说。**读盘后校验 schema**：这些文件用户可以直接编辑，
 * 手改出的非法结构必须在这里暴露，而不是等审查报告引用它时才炸。
 *
 * 失败返回 null（用于「这是不是一本小说」的探测），不抛错。
 */
export function openNovelAt(root: string): OpenNovel | null {
  try {
    const meta = readDoc(metaPath(root), NovelMetaSchema, NAMES.meta);
    const state = readDoc(statePath(root), NovelStateSchema, NAMES.state);
    return { root, meta, state };
  } catch {
    return null;
  }
}

/**
 * 打开「当前打开的小说」。未打开或文件损坏都返回 null，不抛错。
 *
 * 不需要 `cwd`：状态是全局的（`~/.novelmaster/`），与运行目录无关。
 */
export function openNovel(): OpenNovel | null {
  const root = readConfig().novelRoot;
  return root === null ? null : openNovelAt(root);
}

export interface OpenFailure {
  ok: false;
  /** 给 LLM 看的错误文本：它唯一的修正途径就是这段文字。 */
  error: string;
}

export interface OpenSuccess {
  ok: true;
  novel: OpenNovel;
}

export type OpenStrictResult = OpenSuccess | OpenFailure;

/**
 * 打开「当前打开的小说」，失败时给出可操作的错误文本。
 *
 * 与 `openNovelAt` 的分工：这里服务工具层，**必须说清为什么失败** ——
 * 「没打开小说」和「小说文件坏了」对 LLM 是两个完全不同的行动指令。
 */
export function openNovelStrict(): OpenStrictResult {
  const config = readConfig();
  if (config.novelRoot === null) {
    return { ok: false, error: "当前没有打开小说。请用户先执行 /init 新建一本，或从已有小说继续。" };
  }
  const root = config.novelRoot;
  try {
    const meta = readDoc(metaPath(root), NovelMetaSchema, NAMES.meta);
    const state = readDoc(statePath(root), NovelStateSchema, NAMES.state);
    return { ok: true, novel: { root, meta, state } };
  } catch (err) {
    return { ok: false, error: `打开小说失败（${root}）：${errorText(err)}。请不要自行修复文件，先告知用户。` };
  }
}
