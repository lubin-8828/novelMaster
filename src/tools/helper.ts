/**
 * 工具层的公共外壳。
 *
 * 每个 `novel_*` 工具都走同一条路：打开当前小说 → 干活 → 操作留痕。
 * 把这条路只写一遍的理由不是省代码，而是「留痕不能有例外」——
 * 漏记一次写入，`operations.jsonl` 就不再是完整记录，而它的全部价值在于完整。
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderChanges, type FieldChange } from "../data/diff.ts";
import { DataError, errorText } from "../data/errors.ts";
import { logOperation } from "../data/log.ts";
import { openNovelStrict, type OpenNovel } from "../data/novel.ts";

export interface TextContent {
  type: "text";
  text: string;
}

/**
 * 工具返回值。`details` 必填 —— pi 的 `AgentToolResult` 要求它存在，
 * 即使没有任何附加信息也要给个空对象。
 */
export interface ToolResult {
  content: TextContent[];
  details: Record<string, unknown>;
  isError?: boolean;
}

/** 一次工具执行的产出。`target` 是相对小说根的写入路径，省略表示这次没写文件。 */
export interface ToolOutcome {
  text: string;
  target?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export function ok(text: string, details?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], details: details ?? {} };
}

export function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], details: {}, isError: true };
}

/** 连续失败到这个次数就要求 LLM 停下来。第 4 次调用会被 guard 直接阻断并终止。 */
export const MAX_CONSECUTIVE_FAILURES = 3;

const failures = new Map<string, number>();

export function noteFailure(op: string): number {
  const next = (failures.get(op) ?? 0) + 1;
  failures.set(op, next);
  return next;
}

export function noteSuccess(op: string): void {
  failures.delete(op);
}

export function failureCount(op: string): number {
  return failures.get(op) ?? 0;
}

/** 测试用：清空失败计数，避免用例之间互相影响。 */
export function resetFailures(): void {
  failures.clear();
}

export function withNovel(
  ctx: ExtensionContext,
  op: string,
  run: (novel: OpenNovel) => ToolOutcome,
): ToolResult {
  const opened = openNovelStrict(ctx.cwd);
  if (!opened.ok) return failWith(op, opened.error);

  let outcome: ToolOutcome;
  try {
    outcome = run(opened.novel);
  } catch (err) {
    // DataError 的 message 已经是写给 LLM 的修正提示，原样透出。
    return failWith(op, err instanceof DataError ? err.message : `意外错误：${errorText(err)}`);
  }

  if (outcome.target !== undefined) logOperation(opened.novel.root, op, outcome.target);
  noteSuccess(op);
  return ok(outcome.text, outcome.details);
}

function failWith(op: string, text: string): ToolResult {
  const count = noteFailure(op);
  const suffix =
    count >= MAX_CONSECUTIVE_FAILURES
      ? `\n\n（${op} 已连续失败 ${count} 次。停止重试，把这个错误原样告知用户并等他的指示；再次调用会被直接阻断。）`
      : "";
  return fail(`${text}${suffix}`);
}

/** 章节索引文件的展示用相对路径。 */
export function indexLabel(dir: string): string {
  return `${dir}/index.json`;
}

/**
 * 渲染一次 upsert 的结果文本（见 docs/design/data.md「写入结果的 diff 摘要」）。
 *
 * 三种情形分开写是有意的：
 * - 新建没有 diff，说清建了什么；
 * - 「没有实际变化」值得明说 —— 用户以为改了其实没改，是最需要被指出的一种结果；
 * - 有变化就列 diff，用户据此才能说「第 3 条别动」。
 */
export function upsertText(options: {
  label: string;
  id: string;
  name: string;
  created: boolean;
  changes: readonly FieldChange[];
}): string {
  if (options.created) return `已新建${options.label} ${options.id}（${options.name}）。`;
  if (options.changes.length === 0) {
    return `${options.label} ${options.id} 没有实际变化（传入的值与现有值相同）。`;
  }
  return `已更新${options.label} ${options.id}：\n${renderChanges(options.changes)}`;
}
