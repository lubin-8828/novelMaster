/**
 * 审查条目的机械合并。
 *
 * **不做 LLM 汇总层。** 条目已经是结构化的，机械合并足够；多一层 LLM 只会引入
 * 新的编造风险 —— 而「编造」正是这套审查机制要防的东西。
 */

import { errorText } from "../../data/errors.ts";

export type Severity = "blocking" | "warning" | "note";

export interface Finding {
  /** 审查项编号，如 `A2`。 */
  category: string;
  severity: Severity;
  /** 段落号，从 1 开始。 */
  paragraph: number;
  phenomenon: string;
  evidence: string[];
  suggestion: string;
  /** 来自哪个审查员。 */
  reviewer: string;
  /** 依据校验发现的无效引用（由调用方填）。 */
  invalidEvidence?: string[] | undefined;
  /** 依据无效时追加的说明。 */
  note?: string | undefined;
}

const SEVERITY_ORDER: Record<Severity, number> = { blocking: 0, warning: 1, note: 2 };

export { SEVERITY_ORDER };

/**
 * 合并规则（见 docs/design/pipeline.md「合并与依据校验」）：
 *
 * 1. 依据无效 → **降级为 note** 并标注（不删条目：用户要能看到「AI 编了什么」）；
 * 2. 同 `(category, paragraph)` 去重 —— **范围故意取窄**，只去「同一审查员报了两次
 *    同一类别同一段落」。跨类别的条目本来就不同问题，去掉等于把第二个视角的意见删了；
 * 3. 排序：severity → paragraph。
 */
export function mergeFindings(findings: readonly Finding[]): Finding[] {
  const normalized = findings.map((finding) => {
    const invalid = finding.invalidEvidence ?? [];
    if (invalid.length === 0) return finding;
    return {
      ...finding,
      severity: "note" as const,
      note: `依据引用无效（${invalid.join("、")}），可能是编造`,
    };
  });

  const grouped = new Map<string, Finding[]>();
  for (const finding of normalized) {
    const key = `${finding.category}@${finding.paragraph}`;
    const list = grouped.get(key) ?? [];
    list.push(finding);
    grouped.set(key, list);
  }

  const merged: Finding[] = [];
  for (const group of grouped.values()) {
    const best = group.reduce((a, b) => (SEVERITY_ORDER[b.severity] < SEVERITY_ORDER[a.severity] ? b : a));
    // 现象基本相同的两条不并列 —— 同一个审查员对同一段重复提交（真实运行里出现过）
    // 会让报告里出现两段逐字几乎一样的文字，那是噪声，不是第二个视角。
    const others = group.filter((finding) => finding !== best && !similarPhenomenon(finding.phenomenon, best.phenomenon));
    if (others.length === 0) {
      merged.push(best);
      continue;
    }
    // 真正不同的判断都保留内容：现象并列，依据取并集。
    merged.push({
      ...best,
      phenomenon: [best.phenomenon, ...others.map((finding) => `（同一位置的另一条判断：${finding.phenomenon}）`)].join(
        "\n",
      ),
      evidence: [...new Set([...best.evidence, ...others.flatMap((finding) => finding.evidence)])],
    });
  }

  return merged.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.paragraph - b.paragraph,
  );
}

export interface FindingStats {
  blocking: number;
  warning: number;
  note: number;
  invalidEvidence: number;
}

/** 两条现象是不是在说同一件事（包含关系即算）。用于避免把重复提交并列进报告。 */
function similarPhenomenon(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  return left === right || left.includes(right) || right.includes(left);
}

export function countFindings(findings: readonly Finding[]): FindingStats {
  return {
    blocking: findings.filter((finding) => finding.severity === "blocking").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    note: findings.filter((finding) => finding.severity === "note").length,
    invalidEvidence: findings.filter((finding) => (finding.invalidEvidence?.length ?? 0) > 0).length,
  };
}
