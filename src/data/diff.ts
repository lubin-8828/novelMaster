/**
 * 字段差异计算：把「这次改了什么」变成可读的逐行文本。
 *
 * 用途是让用户能确认改动（见 docs/design/data.md「写入结果的 diff 摘要」）：
 * 只说「已更新」时，用户唯一的回应是「好」；列出 diff，他才能说「第 3 条别动」。
 */

export interface FieldChange {
  /** 字段名，如 `summary`。 */
  field: string;
  from: string;
  to: string;
}

/** 超过这个长度的字符串只报长度，不贴全文。 */
const LONG_TEXT = 80;

/**
 * 比较指定字段的变化。`before` 为 undefined（新建）时返回空数组 —— 新建没有 diff。
 *
 * 长字符串只报长度（`800 字 → 950 字`）而不贴全文：diff 要能一眼看完，
 * 把一段详述贴进来只会把它之后的其他变化挤到视野外。
 */
export function diffFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  fields: readonly string[],
): FieldChange[] {
  if (before === undefined) return [];
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const from = before[field];
    const to = after[field];
    if (same(from, to)) continue;
    changes.push({ field, from: render(from), to: render(to) });
  }
  return changes;
}

/** 把变更集渲染成工具返回值里的几行。 */
export function renderChanges(changes: readonly FieldChange[]): string {
  return changes.map((change) => `- ${change.field}：${change.from} → ${change.to}`).join("\n");
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function render(value: unknown): string {
  if (value === null || value === undefined) return "（无）";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") {
    if (value.length > LONG_TEXT) return `${value.length} 字`;
    return value === "" ? "（空）" : value;
  }
  if (Array.isArray(value)) return value.length === 0 ? "（空）" : value.map((item) => String(item)).join("、");
  return String(value);
}
