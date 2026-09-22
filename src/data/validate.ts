/**
 * 依据引用校验：把「有据可查」从口号变成机制。
 *
 * 审查报告里每条问题都要带依据引用（`setting#S-001`、`chapter#012:para7`）。
 * 校验的作用是**认出幻觉** —— 如果引用指向一个不存在的东西，那这条指控就是编的：
 * 降级为 `note` 并明示，用户一眼能看出哪些是 AI 编的。
 *
 * 见 docs/design/pipeline.md「依据引用校验」。
 */

import { readText } from "./io.ts";
import { chapterNo } from "./ids.ts";
import { NAMES, chapterTextPath, metaPath, outlinePath } from "./paths.ts";
import { readDoc } from "./doc.ts";
import { NovelMetaSchema } from "./schema.ts";
import { listSettings } from "./settings.ts";
import { listCharacters } from "./characters.ts";
import { listRelations } from "./relations.ts";
import { listEvents } from "./events.ts";

export interface EvidenceCheck {
  ref: string;
  valid: boolean;
  /** 无效时的说明（会进报告，所以要说清「为什么不算数」）。 */
  reason: string;
}

const REF_PATTERN = /^(setting|character|relation|event|chapter)#([^:]+)(?::para(\d+))?$/;

export function validateEvidence(root: string, refs: readonly string[]): EvidenceCheck[] {
  return refs.map((ref) => checkOne(root, ref));
}

function checkOne(root: string, ref: string): EvidenceCheck {
  const trimmed = ref.trim();

  if (trimmed === "outline") {
    const body = readText(outlinePath(root));
    return body === null || body.trim() === ""
      ? { ref, valid: false, reason: "outline.md 不存在或为空" }
      : { ref, valid: true, reason: "" };
  }

  const metaField = /^meta#(\w+)$/.exec(trimmed);
  if (metaField !== null) {
    const field = metaField[1] ?? "";
    const meta = readDoc(metaPath(root), NovelMetaSchema, NAMES.meta);
    return Object.hasOwn(meta, field)
      ? { ref, valid: true, reason: "" }
      : { ref, valid: false, reason: `meta.json 没有字段 ${field}` };
  }

  const matched = REF_PATTERN.exec(trimmed);
  if (matched === null) return { ref, valid: false, reason: "引用格式无法识别" };

  const kind = matched[1] ?? "";
  const id = matched[2] ?? "";
  const para = matched[3];

  if (kind === "setting") {
    const item = listSettings(root).find((entry) => entry.id === id);
    if (item === undefined) return { ref, valid: false, reason: `${id} 不存在` };
    // 已废止的条目不算有效依据：它可以被引用（历史报告里可能引），但不该是
    // 「当前设定」的依据 —— 用它当依据意味着拿一条已经推翻的规则来指控正文。
    if (item.deprecated) return { ref, valid: false, reason: `${id} 已废止` };
    return { ref, valid: true, reason: "" };
  }

  if (kind === "character") {
    return listCharacters(root).some((entry) => entry.id === id)
      ? { ref, valid: true, reason: "" }
      : { ref, valid: false, reason: `${id} 不存在` };
  }

  if (kind === "relation") {
    return listRelations(root).some((entry) => entry.id === id)
      ? { ref, valid: true, reason: "" }
      : { ref, valid: false, reason: `${id} 不存在` };
  }

  if (kind === "event") {
    return listEvents(root).some((entry) => entry.id === id)
      ? { ref, valid: true, reason: "" }
      : { ref, valid: false, reason: `${id} 不存在` };
  }

  // chapter
  const no = Number(id);
  if (!Number.isInteger(no) || no < 1) return { ref, valid: false, reason: `章号 ${id} 不合法` };
  const text = readText(chapterTextPath(root, no));
  if (text === null) return { ref, valid: false, reason: `第 ${chapterNo(no)} 章正文不存在` };
  if (para === undefined) return { ref, valid: true, reason: "" };

  // 段落编号是「尽力而为」的：段落按空行切分，用户手工编辑打乱空行后可能偏移
  // （见 ops.md「已知限制」）。所以校验只要求「段落数 ≥ N」。
  const wanted = Number(para);
  const count = countParagraphs(text);
  return count >= wanted
    ? { ref, valid: true, reason: "" }
    : { ref, valid: false, reason: `第 ${chapterNo(no)} 章只有 ${count} 段，没有第 ${wanted} 段` };
}

/** 段落数：被空行分隔的非空块。与 `data.md「依据引用格式」`的口径一致。 */
export function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((block) => block.trim() !== "").length;
}
