/**
 * 审查报告的渲染（`NNN.review.md`）。
 *
 * **blocking 排最前** —— 用户逐条拍板，必须先看必须看的。
 *
 * 报告是**给人读的**：所以每一条都要能回答「在哪、什么问题、凭什么、怎么改」。
 * 而「凭什么」那一行是可校验的引用，不是自然语言描述。
 */

import { chapterNo } from "../../data/ids.ts";
import { stamp } from "../../data/md.ts";
import { CHECKLIST } from "./checklist.ts";
import { countFindings, type Finding } from "./merge.ts";

export interface ReviewReportInput {
  chapter: number;
  /** `full` = 完整审查；`post-deai` = 改稿复查（只覆盖 F / G）。 */
  mode?: "full" | "post-deai" | undefined;
  findings: readonly Finding[];
  /** 实际参与并产出的审查员名。 */
  reviewers: readonly string[];
  /** 未产出的审查员（名字 + 原因）。**必须明示，不假装它审过了**。 */
  missing: readonly { name: string; detail: string }[];
  generatedAt?: string;
}

export function renderReviewReport(input: ReviewReportInput): string {
  const stats = countFindings(input.findings);
  const postDeai = input.mode === "post-deai";
  const lines: string[] = [
    `# 第 ${chapterNo(input.chapter)} 章 审查报告${postDeai ? "（改稿复查）" : ""}`,
    "",
    `- 生成：${input.generatedAt ?? stamp()}`,
    `- 审查员：${input.reviewers.join(" / ")}（独立会话）`,
    `- 统计：blocking ${stats.blocking} ｜ warning ${stats.warning} ｜ note ${stats.note} ｜ 依据无效 ${stats.invalidEvidence}`,
    "",
  ];

  // **必须标明覆盖范围**：不标的话，用户会以为这份报告和第一份一样全，而那是假的。
  if (postDeai) {
    lines.push(
      "- **覆盖范围**：本次只覆盖 F（逻辑与叙事）与 G（硬性规范） —— 去 AI 味只动表达层，",
      "  事实层（设定 / 人物 / 关系 / 事件 / 时间线）未被重查。要全查请跑 `/review`。",
      "",
    );
  }

  if (input.missing.length > 0) {
    lines.push(`- **未产出**：${input.missing.map((item) => `${item.name}（${item.detail}）`).join("；")}`, "");
  }

  if (input.findings.length === 0) {
    lines.push("本次审查没有发现问题。", "");
    return lines.join("\n");
  }

  for (const severity of ["blocking", "warning", "note"] as const) {
    const group = input.findings.filter((finding) => finding.severity === severity);
    lines.push(`## ${severity}`, "");
    if (group.length === 0) {
      lines.push("（无）", "");
      continue;
    }
    for (const finding of group) {
      lines.push(...renderFinding(finding));
    }
  }

  return lines.join("\n");
}

function renderFinding(finding: Finding): string[] {
  const invalid = finding.invalidEvidence ?? [];
  const title = CHECKLIST.find((item) => item.id === finding.category)?.title ?? "（未知审查项）";
  const flag = invalid.length > 0 ? " ⚠️ 依据无效" : "";
  const lines = [
    `### [${finding.category}]${flag} ${title}`,
    `- **位置**：第 ${finding.paragraph} 段`,
    `- **现象**：${finding.phenomenon}`,
  ];

  const evidence =
    finding.evidence.length === 0
      ? "（无依据）"
      : finding.evidence
          .map((ref) => (invalid.includes(ref) ? `\`${ref}\` ← **该引用不存在或不可用**` : `\`${ref}\``))
          .join(" ／ ");
  lines.push(`- **依据**：${evidence}`);
  lines.push(`- **建议**：${finding.suggestion}`);
  if (finding.note !== undefined) lines.push(`- **备注**：${finding.note}`);
  lines.push("");
  return lines;
}
