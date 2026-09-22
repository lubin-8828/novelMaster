/**
 * 审查引擎的编排。
 *
 * 三个只读审查员并发跑，产出经 `submit_findings` 回收，然后**机械合并 + 依据校验**。
 * 「只读」是代码级实现：子会话的工具白名单里没有任何写工具 —— 它连改的能力都没有，
 * 不靠提示词约束（那会变成「请自觉」）。
 *
 * 为什么不许它改：一旦允许顺手改，**「哪一版是被审查过的」就说不清了** ——
 * 而用户的验收对象必须是确定的（见 docs/design/pipeline.md「拓扑与核心约束」）。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../../data/schema.ts";
import { chapterNo } from "../../data/ids.ts";
import { DataError } from "../../data/errors.ts";
import { advanceStatus } from "../../data/state.ts";
import { writeChapterReport } from "../../data/chapters.ts";
import { validateEvidence } from "../../data/validate.ts";
import type { OpenNovel } from "../../data/novel.ts";
import { readIndexTool } from "../../tools/read.ts";
import { resolveModel } from "../models.ts";
import { runParallel, type TaskOutcome, type TaskStatus } from "../parallel.ts";
import { runSubSession } from "../session.ts";
import { REVIEWERS, type ReviewerSpec } from "./checklist.ts";
import { renderReviewInput, renderReviewerSystemPrompt } from "./input.ts";
import { mergeFindings, countFindings, type Finding } from "./merge.ts";
import { renderReviewReport } from "./report.ts";

/**
 * 单个审查员的时间上限。
 *
 * 比讨论角色（120 秒）宽：审查要读全上下文（含最近 N 章正文）并逐个比对 14 项清单，
 * 而「逻辑叙事审查员」一人负责 D·E·F·G 四类 —— 真实运行里它在 180 秒时撞线超时，
 * 于是整整四类审查项一项没审。宁等一会儿，也不要让四类静默丢失。
 */
export const REVIEWER_TIMEOUT_MS = 300_000;

export interface ReviewerOutcome {
  reviewer: ReviewerSpec;
  status: TaskStatus;
  findings: Finding[];
  /** `missing` / `fatal` 时为原因。 */
  detail: string;
}

export interface ReviewResult {
  /** 已合并、已排序、已做依据校验。 */
  findings: Finding[];
  outcomes: ReviewerOutcome[];
  /** 任一审查员属设施级失败时为 true —— 调用方**中止并报错**，不降级为「两个视角」。 */
  fatal: boolean;
}

export type ReviewerRunner = (
  reviewer: ReviewerSpec,
  context: { input: string; novel: OpenNovel; cwd: string },
) => Promise<TaskOutcome<Finding[]>>;

/**
 * 默认的三个审查员（完整审查）。
 *
 * 另一个集合是「改稿复查」：去 AI 味之后只重查 F / G —— 理由见
 * docs/design/pipeline.md「去 AI 味之后必须重查」。
 */
export const POST_DEAI_REVIEWERS: readonly ReviewerSpec[] = [
  { name: "改稿复查员", categories: ["F", "G"], focus: "去 AI 味之后，表达层有没有被改坏" },
];

export type ReviewMode = "full" | "post-deai";

export function reviewersFor(mode: ReviewMode): readonly ReviewerSpec[] {
  return mode === "full" ? REVIEWERS : POST_DEAI_REVIEWERS;
}

export interface ReviewOptions {
  novel: OpenNovel;
  chapter: number;
  /** 主会话 cwd（**不是小说根**：`novel_*` 工具靠它读 config.json 定位小说）。 */
  cwd: string;
  /** 审查员集合，默认三个。 */
  reviewers?: readonly ReviewerSpec[] | undefined;
  onProgress?: ((done: number, total: number, reviewer: ReviewerSpec) => void) | undefined;
}

export async function review(options: ReviewOptions, runner?: ReviewerRunner): Promise<ReviewResult> {
  const input = renderReviewInput(options.novel, options.chapter);
  const run = runner ?? defaultReviewerRunner();
  const reviewers = options.reviewers ?? REVIEWERS;

  const results = await runParallel(
    reviewers,
    (reviewer) => run(reviewer, { input, novel: options.novel, cwd: options.cwd }),
    options.onProgress,
  );

  const outcomes: ReviewerOutcome[] = results.map((result) => ({
    reviewer: result.role,
    status: result.status,
    findings: result.value ?? [],
    detail: result.detail,
  }));

  const all = outcomes.flatMap((outcome) => outcome.findings);
  return {
    findings: mergeFindings(withEvidenceChecks(options.novel.root, all)),
    outcomes,
    fatal: results.some((result) => result.status === "fatal"),
  };
}

/** 依据校验：把无效引用标在条目上，由 `mergeFindings` 降级为 note。 */
function withEvidenceChecks(root: string, findings: readonly Finding[]): Finding[] {
  return findings.map((finding) => {
    const invalid = validateEvidence(root, finding.evidence)
      .filter((check) => !check.valid)
      .map((check) => check.ref);
    return invalid.length === 0 ? finding : { ...finding, invalidEvidence: invalid };
  });
}

export interface PersistedReview {
  chapter: number;
  findings: Finding[];
  /** 未产出的审查员数。 */
  missing: number;
  reportMarkdown: string;
  /** 给 AI / 用户看的摘要。 */
  text: string;
}

/**
 * 跑一次审查、落盘报告、推进状态。**工具与命令共用这一条路**。
 *
 * 状态只在 `drafted` 时推进到 `auto_reviewed`：手动补跑（`/review`）时状态可能已经是
 * `awaiting_user_review`，那时只出报告、不动状态 —— 否则会违反转移表。
 */
export async function runReviewAndPersist(
  options: {
    novel: OpenNovel;
    chapter: number;
    cwd: string;
    /** `full` = 三个审查员；`post-deai` = 只跑 F/G 的改稿复查。 */
    mode?: ReviewMode | undefined;
    onProgress?: ((done: number, total: number, reviewer: ReviewerSpec) => void) | undefined;
  },
  /** 注入假 runner 供测试；生产不传。 */
  runner?: ReviewerRunner,
): Promise<PersistedReview> {
  const { novel, chapter } = options;
  const mode: ReviewMode = options.mode ?? "full";
  const result = await review(
    { novel, chapter, cwd: options.cwd, reviewers: reviewersFor(mode), onProgress: options.onProgress },
    runner,
  );

  if (result.fatal) {
    const failed = result.outcomes.filter((outcome) => outcome.status === "fatal");
    throw new DataError(
      `审查中止：${failed.map((outcome) => `${outcome.reviewer.name}：${outcome.detail}`).join("；")}。` +
        `本次审查无效（**不降级为两个视角**），请把原因告知用户。`,
    );
  }

  const missing = result.outcomes.filter((outcome) => outcome.status !== "ok");
  const markdown = renderReviewReport({
    chapter,
    mode,
    findings: result.findings,
    reviewers: result.outcomes.filter((outcome) => outcome.status === "ok").map((outcome) => outcome.reviewer.name),
    missing: missing.map((outcome) => ({ name: outcome.reviewer.name, detail: outcome.detail })),
  });

  writeChapterReport(novel.root, chapter, "review", markdown);
  advanceToAutoReviewed(novel, chapter, mode);

  const stats = countFindings(result.findings);
  const lines = [
    `已完成第 ${chapterNo(chapter)} 章的${mode === "full" ? "审查" : "改稿复查（只覆盖 F / G）"}，` +
      `报告已写入 chapters/${chapterNo(chapter)}.review.md。`,
    `统计：blocking ${stats.blocking} ｜ warning ${stats.warning} ｜ note ${stats.note} ｜ 依据无效 ${stats.invalidEvidence}`,
  ];
  if (missing.length > 0) {
    lines.push(`**未产出**：${missing.map((outcome) => `${outcome.reviewer.name}（${outcome.detail}）`).join("；")}`);
  }
  lines.push("", "请把报告呈现给用户，逐条等他拍板。blocking 必须先处理。");

  return {
    chapter,
    findings: result.findings,
    missing: missing.length,
    reportMarkdown: markdown,
    text: lines.join("\n"),
  };
}

function advanceToAutoReviewed(novel: OpenNovel, chapter: number, mode: ReviewMode): void {
  // 改稿复查发生在去 AI 味**之后**（那时状态已过 auto_reviewed），所以不动状态。
  if (mode !== "full") return;
  advanceStatus(novel.root, chapter, "drafted", "auto_reviewed");
}

function defaultReviewerRunner(): ReviewerRunner {
  return async (reviewer, context) => {
    const collector: FindingCollector = { findings: [], submitted: false };
    const resolved = await resolveModel("review", context.novel.state);

    const result = await runSubSession({
      cwd: context.cwd,
      systemPrompt: renderReviewerSystemPrompt(reviewer),
      prompt: context.input,
      // 只给读工具与提交工具。**没有任何写工具**。
      customTools: [readIndexTool, createSubmitFindingsTool(collector, reviewer.name)],
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel,
      timeoutMs: REVIEWER_TIMEOUT_MS,
    });

    if (result.timedOut) {
      return { kind: "missing", detail: `超过 ${Math.round(REVIEWER_TIMEOUT_MS / 1000)} 秒未完成` };
    }
    if (result.error !== null) return { kind: "fatal", detail: result.error };

    // **「没调用工具」与「提交了空数组」是两回事。**
    // 审查员确实可能一个问题都没发现（它不该为了凑数编问题），所以不能拿
    // `findings.length === 0` 当「未产出」—— 那会把「审过、干净」误判成「没审」。
    if (!collector.submitted) {
      const excerpt = result.text.trim().slice(-200);
      return {
        kind: "missing",
        detail: `未调用 submit_findings` + (excerpt === "" ? "，也未留下输出" : `；它的最后输出：…${excerpt}`),
      };
    }
    return { kind: "ok", value: collector.findings };
  };
}

interface FindingCollector {
  findings: Finding[];
  submitted: boolean;
}

/** submit 工具在闭包里写 collector，这样 `runSubSession` 不需要知道业务概念。导出供测试。 */
export function createSubmitFindingsTool(collector: FindingCollector, reviewerName: string) {
  return defineTool({
    name: "submit_findings",
    label: "提交审查结果",
    description:
      `提交你（${reviewerName}）的审查结果。**必须调用** —— 即使一个问题都没发现，也要调用并传空数组，` +
      "否则父层无法区分「审过、干净」与「没审」。不要为了凑数编问题。",
    parameters: Type.Object(
      {
        findings: Type.Array(
          Type.Object(
            {
              category: Type.String({ description: "审查项编号，如 A2、D3" }),
              severity: Type.Union([Type.Literal("blocking"), Type.Literal("warning"), Type.Literal("note")]),
              paragraph: Type.Integer({ minimum: 1, description: "段落号，从 1 开始" }),
              phenomenon: Type.String({ description: "现象：具体哪里有问题" }),
              evidence: Type.Array(Type.String(), { description: "依据引用，如 setting#S-001、chapter#012:para7" }),
              suggestion: Type.String({ description: "建议怎么改" }),
            },
            STRICT,
          ),
        ),
      },
      STRICT,
    ),
    async execute(_toolCallId, params) {
      collector.submitted = true;
      for (const finding of params.findings) {
        collector.findings.push({
          category: finding.category,
          severity: finding.severity,
          paragraph: finding.paragraph,
          phenomenon: finding.phenomenon,
          evidence: [...finding.evidence],
          suggestion: finding.suggestion,
          reviewer: reviewerName,
        });
      }
      return {
        content: [
          {
            type: "text",
            text: params.findings.length === 0 ? "已提交：本次没发现问题。" : `已记录 ${params.findings.length} 条。`,
          },
        ],
        details: {},
      };
    },
  });
}
