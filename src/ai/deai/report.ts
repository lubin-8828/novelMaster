/**
 * 去 AI 味报告的渲染（`NNN.deai.md`）。
 *
 * 固定三节。**「命中清单」单独成节** —— 用户的核对动作是逐条检查它标的对不对，
 * 所以它必须是一份能从上往下划勾的清单，不是一段说明文字。
 *
 * 「改前」保留原文的理由：用户可能不同意某处改写，需要能对照着把它改回去。
 */

import { chapterNo } from "../../data/ids.ts";
import { stamp } from "../../data/md.ts";
import { scopeWarningCount, type ScopeReport } from "./scope.ts";

export interface DeaiHit {
  /** 命中的模式，如 `§1 not-X-but-Y`。 */
  pattern: string;
  paragraph: number;
  /** 原文片段。 */
  original: string;
  /** 处理方式，如「已改写」。 */
  action: string;
}

export interface DeaiReportInput {
  chapter: number;
  hits: readonly DeaiHit[];
  before: string;
  after: string;
  /** 文风样本的章节范围；null 表示无样本（第 1 章）。 */
  voiceSample: { from: number; to: number } | null;
  scope: ScopeReport;
  generatedAt?: string;
}

export function renderDeaiReport(input: DeaiReportInput): string {
  const lines: string[] = [
    `# 第 ${chapterNo(input.chapter)} 章 去 AI 味报告`,
    "",
    `- 生成：${input.generatedAt ?? stamp()}`,
    `- 文风样本：${
      input.voiceSample === null
        ? "**无**（本书还没有已写章节，本次退回 humanizer 的通用规则）"
        : `chapters/${chapterNo(input.voiceSample.from)}.txt ~ ${chapterNo(input.voiceSample.to)}.txt`
    }`,
    `- 命中：${input.hits.length} 处`,
    "",
    "## 一、命中清单",
    "",
  ];

  if (input.hits.length === 0) {
    lines.push("本次没有命中任何模式。", "");
  } else {
    lines.push("| # | 模式 | 位置 | 原文片段 | 处理 |", "|---|------|------|----------|------|");
    input.hits.forEach((hit, index) => {
      lines.push(
        `| ${index + 1} | ${hit.pattern} | 第 ${hit.paragraph} 段 | ${escapeCell(hit.original)} | ${escapeCell(hit.action)} |`,
      );
    });
    lines.push("");
  }

  // 机械防线：去 AI 味只该动表达层，这里报告它有没有碰到事实层。
  lines.push("## 二、范围检查（机械）", "");
  const scopeWarnings = scopeWarningCount(input.scope);
  if (input.scope.paragraphCountChanged) {
    lines.push(
      "- ⚠️ **段落数发生了变化** —— 逐段对比不成立，本次无法机械核对专有名词。",
      "  请人工确认改写没有碰人名、设定术语与数字。",
      "",
    );
  } else if (scopeWarnings === 0) {
    lines.push("- 改动只发生在表达层：人名、设定术语、数字都没有被增删。", "");
  } else {
    lines.push("- ⚠️ **改动涉及专有名词 —— 请确认没有越界**：", "");
    for (const hit of input.scope.hits) {
      const parts: string[] = [];
      if (hit.added.length > 0) parts.push(`新增：${hit.added.join("、")}`);
      if (hit.removed.length > 0) parts.push(`丢失：${hit.removed.join("、")}`);
      if (hit.numbersChanged) parts.push("数字数量变了");
      lines.push(`  - 第 ${hit.paragraph} 段：${parts.join("；")}`);
    }
    lines.push("");
  }

  lines.push("## 三、改前", "", input.before.trim(), "", "## 四、改后", "", input.after.trim(), "");
  return lines.join("\n");
}

/** 表格单元格里的竖线会破坏表格结构。 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
