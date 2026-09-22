/**
 * 想法收集箱。
 *
 * 追加式，不整理、不评判、不删除 —— 它的价值正在于「想到什么随手扔进来」，
 * 任何整理动作都会提高记录的门槛。
 */

import { appendUnderSection, stamp } from "./md.ts";
import { NAMES, inboxPath } from "./paths.ts";

/**
 * 追加一条想法。
 *
 * 锚点是「## 记录」而不是文件标题 —— 标题是一级标题（`#`），不是可追加区段。
 * 区段不存在时 `appendUnderSection` 会拒绝写入，而不是把行丢到文件末尾。
 */
export function appendInbox(root: string, text: string, tags: readonly string[] = []): void {
  const suffix = tags.length > 0 ? ` ${tags.map((tag) => `#${tag}`).join(" ")}` : "";
  appendUnderSection(inboxPath(root), "记录", [`- [${stamp()}] ${text}${suffix}`]);
}
