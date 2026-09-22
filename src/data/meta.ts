/**
 * 元信息的写入。
 *
 * 只涵盖 `logline` / `pov` / `tense` 这三个「整理后的元信息」。
 *
 * **不含 `title`**：书名对应目录名 `slug`，改名会连带旧目录、旧报告里的书名、
 * 以及对外的所有引用一起变。那是一项独立的、需要用户明确确认的操作 ——
 * 混在一次普通修改里做，会出现「只想改个简介结果书目录换了」。
 *
 * `premise` 同样不可改：它是用户最初想法的原文，是一切推断的根
 * （见 docs/design/data.md「meta.json」）。
 */

import { NAMES, metaPath } from "./paths.ts";
import { diffFields, type FieldChange } from "./diff.ts";
import { readDoc, writeDoc } from "./doc.ts";
import { NovelMetaSchema, type NovelMeta } from "./schema.ts";

export interface UpdateMetaInput {
  logline?: string | undefined;
  pov?: string | undefined;
  tense?: string | undefined;
}

export interface UpdateMetaResult {
  /** 实际变化的字段；无变化时为空数组，此时不落盘。 */
  changes: FieldChange[];
}

export function updateMeta(root: string, input: UpdateMetaInput): UpdateMetaResult {
  const path = metaPath(root);
  const meta = readDoc(path, NovelMetaSchema, NAMES.meta);

  const next: NovelMeta = {
    ...meta,
    logline: input.logline ?? meta.logline,
    pov: input.pov ?? meta.pov,
    tense: input.tense ?? meta.tense,
  };

  const changes = diffFields(
    { logline: meta.logline, pov: meta.pov, tense: meta.tense },
    { logline: next.logline, pov: next.pov, tense: next.tense },
    ["logline", "pov", "tense"],
  );

  // 没有变化就不写盘：一次无意义的写入会留下一个看不出区别的 mtime，
  // 而「文件什么时候变的」在排查问题时有价值。
  if (changes.length > 0) writeDoc(path, NovelMetaSchema, next, NAMES.meta);
  return { changes };
}
