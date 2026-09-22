/**
 * 审查输入与审查员人格。
 *
 * 输入 = 装配产出（九段）+ **本章正文**。多出的那一段是关键：`assemble()` 的第 9 段
 * 是「本章大纲」，而审查对象是正文（见 docs/design/pipeline.md「审查员的输入」）。
 *
 * 另外预先给一份**机械算出**的东西：「当前挂着的伏笔」。E2 的判定是纯筛选
 * （`origin == foreshadow && status == planned`），交给代码比交给模型可靠。
 */

import { readText } from "../../data/io.ts";
import { chapterTextPath } from "../../data/paths.ts";
import { chapterNo } from "../../data/ids.ts";
import { listEvents } from "../../data/events.ts";
import { countParagraphs } from "../../data/validate.ts";
import type { OpenNovel } from "../../data/novel.ts";
import { assemble } from "../context-assembler.ts";
import { checklistFor, type ReviewerSpec } from "./checklist.ts";

/** 审查员的输入：九段上下文 + 本章正文 + 预先算好的辅助事实。 */
export function renderReviewInput(novel: OpenNovel, chapter: number): string {
  const bundle = assemble(novel, chapter);
  const parts = bundle.segments.map((segment) => `【${segment.title}】\n\n${segment.content}`);

  const text = readText(chapterTextPath(novel.root, chapter));
  parts.push(
    `【本章正文（审查对象，共 ${text === null ? 0 : countParagraphs(text)} 段）】\n\n` +
      (text === null ? "（正文不存在）" : text.trim()),
  );

  parts.push(`【预筛事实（由代码算出，直接采信）】\n\n${renderPrecomputedFacts(novel)}`);
  return parts.join("\n\n");
}

/**
 * 机械可算的事实，不让模型自己筛。
 *
 * 模型筛「哪些伏笔挂着」会漏、会编 ID；而这是纯筛选，代码算得更准。
 * 这也是「机械部分不交给 LLM」的落点之一。
 */
function renderPrecomputedFacts(novel: OpenNovel): string {
  const lines: string[] = [];

  const pending = listEvents(novel.root)
    .filter((event) => event.origin === "foreshadow" && event.status === "planned")
    .sort((a, b) => (a.payoffExpectedAt ?? 0) - (b.payoffExpectedAt ?? 0));

  if (pending.length === 0) {
    lines.push("挂着的伏笔：无。");
  } else {
    lines.push(`挂着的伏笔（${pending.length} 条，按预计回收章排序）：`);
    for (const event of pending) {
      const due = event.payoffExpectedAt === null ? "未定" : `CH-${chapterNo(event.payoffExpectedAt)}`;
      lines.push(`- ${event.id} ${event.title}（${event.stage}，埋于 CH-${chapterNo(event.plantedIn ?? 0)}，预计 ${due} 回收）`);
    }
  }

  return lines.join("\n");
}

/** 审查员人格：**整段替换**系统提示词（与讨论角色同一套做法）。 */
export function renderReviewerSystemPrompt(reviewer: ReviewerSpec): string {
  const items = checklistFor(reviewer)
    .map((item) => `- [${item.id}] ${item.title} —— ${item.detail}`)
    .join("\n");

  return [
    `你是小说审查员，负责「${reviewer.focus}」。`,
    "",
    "你**只审不改**。你手里的工具只有只读的 read / grep / find / ls 与 novel_read_index —— 连改的能力都没有。",
    "这是刻意的：如果你能顺手改，「哪一版是被审查过的」就说不清了，而用户验收的对象必须是确定的。",
    "",
    "你只负责下面这些审查项，**不要越界去审其它类别**（有别的审查员负责，你报了反而会重复）：",
    "",
    items,
    "",
    "提交要求：",
    "- 每条问题都要带 `evidence`（依据引用），格式：`setting#S-001` / `character#C-001` / `relation#R-001` /",
    "  `event#E-003` / `chapter#012` / `chapter#012:para7` / `outline` / `meta#pov`。",
    "- **依据必须真实存在**。引用一个不存在的 ID 等于编造，会被机械校验标出来并降级 —— 那是这套机制最想防的事。",
    "- 找不到依据的问题不要报，或者明确说明「无依据，仅供参考」并设为 note。",
    "- `severity` 三级：blocking（必须处理）／warning（建议处理）／note（供参考）。**不要滥用 blocking**。",
    "- 条目粒度 = 段落级，一条问题对应一个段落。段落号按空行分段计数，从 1 开始。",
    "- 没问题就**不要提交**（或者提交空数组）。不要为了凑数编问题。",
    "",
    "最后必须调用 submit_findings 提交结论。",
  ].join("\n");
}
