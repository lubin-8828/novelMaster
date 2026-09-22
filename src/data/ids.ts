import { DataError } from "./errors.ts";

export const ID_PREFIXES = {
  setting: "S",
  character: "C",
  relation: "R",
  event: "E",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ID_PATTERN = /^([SCRE])-(\d+)$/;

/**
 * 分配下一个 ID。
 *
 * 最大序号从「所有出现过该前缀的 ID」里算，**不只看未废弃的**。
 * 若只算活跃条目，废弃 `S-003` 之后下一个新条目会拿到 `S-003`，
 * 而引用它的历史审查报告会指向另一个东西 —— 这正是「ID 永不复用」
 * 要防的唯一一种事故（见 docs/design/data.md「ID 分配」）。
 *
 * 传到 `existing` 的 ID 不符合格式时**忽略而不是抛错**：用户手工录过一条
 * `S-设定` 不应该导致整本书无法再分配新 ID。
 */
export function nextId(kind: IdKind, existing: readonly string[]): string {
  const prefix = ID_PREFIXES[kind];
  let max = 0;
  for (const id of existing) {
    const matched = ID_PATTERN.exec(id);
    if (matched === null || matched[1] !== prefix) continue;
    max = Math.max(max, Number(matched[2]));
  }
  return formatId(prefix, max + 1);
}

/**
 * 序号超过 999 时直接扩位（`S-1000`），不报错。
 *
 * 一部超长篇可能真的突破千条设定，而拒绝分配会逼用户手改 ID —— 那才是真正的失控。
 */
export function formatId(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

/** 章节号的统一形式：三位零填充（7 → `007`）。文件名与依据引用都用它。 */
export function chapterNo(n: number): string {
  return String(n).padStart(3, "0");
}

/** 判断一个字符串是否是合法 ID（用于校验引用）。 */
export function isId(kind: IdKind, value: string): boolean {
  const matched = ID_PATTERN.exec(value);
  return matched !== null && matched[1] === ID_PREFIXES[kind];
}

/** 从候选集合里挑出与目标最接近的几个，用于「你是不是想写这个」的提示。 */
export function nearestIds(target: string, candidates: readonly string[], limit = 3): string[] {
  const score = (candidate: string): number => {
    const a = target.replace(/\D/g, "");
    const b = candidate.replace(/\D/g, "");
    const samePrefix = target.slice(0, 1) === candidate.slice(0, 1);
    const distance = Math.abs(Number(a) - Number(b));
    return (samePrefix ? 0 : 1000) + (Number.isNaN(distance) ? 1000 : distance);
  };
  return [...candidates].sort((x, y) => score(x) - score(y)).slice(0, limit);
}

/** 引用了一个不存在的 ID 时的统一报错。列出候选比要求用户重述更省事。 */
export function requireId(kind: IdKind, value: string, existing: readonly string[]): void {
  if (existing.includes(value)) return;
  const hints = nearestIds(value, existing);
  const suffix = hints.length > 0 ? `；最接近的是：${hints.join("、")}` : "；当前一个都没有";
  throw new DataError(`找不到 ${value}。现有 ${ID_PREFIXES[kind]}- 条目${suffix}`);
}
