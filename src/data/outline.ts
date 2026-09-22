/**
 * 主线大纲的读写。
 *
 * 大纲正文是**覆盖式**，「修订记录」是**追加式** —— 两者在同一个文件里，
 * 所以每次覆盖写入都必须先把修订记录原样带过来。这不是礼貌，是硬要求：
 * 修订记录是历史，被覆盖掉就没了（见 docs/design/data.md「写入约定」）。
 */

import { readText, writeTextAtomic } from "./io.ts";
import { NAMES, outlinePath } from "./paths.ts";
import { appendUnderSection, readSectionLines, stamp, stripSection } from "./md.ts";
import { DataError } from "./errors.ts";

/** 读大纲正文（不含「修订记录」）。文件不存在返回 null。 */
export function readOutlineBody(root: string): string | null {
  const text = readText(outlinePath(root));
  return text === null ? null : stripSection(text, "修订记录").trim();
}

/** 覆盖写大纲正文，原样保留「修订记录」。 */
export function writeOutline(root: string, markdown: string): void {
  const path = outlinePath(root);
  const existing = readText(path);
  const revisions = existing === null ? [] : readSectionLines(existing, "修订记录");
  const body = stripSection(markdown, "修订记录").trim();
  writeTextAtomic(path, [body, "", "## 修订记录", ...revisions, ""].join("\n"));
}

/** 往「修订记录」追加一行。追加式：原有行必须全保留，否则拒绝写入。 */
export function appendOutlineRevision(root: string, text: string): void {
  const path = outlinePath(root);
  if (readText(path) === null) {
    throw new DataError(`${NAMES.outline} 不存在，这本小说的数据不完整`);
  }
  appendUnderSection(path, "修订记录", [`- [${stamp()}] ${text}`]);
}
