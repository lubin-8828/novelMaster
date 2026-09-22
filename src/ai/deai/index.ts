/**
 * 去 AI 味引擎的编排。
 *
 * **一个子会话，不是三个。** 审查要三个独立视角（单视角会漏），而改写是**一次产出** ——
 * 三个人各改一遍，最后还得挑一份或合并，那只会让「哪一版是最终稿」说不清。
 *
 * **子会话依然只读**：它只输出改后文本，落盘由这里完成。这样不会让几千字正文
 * 过一次 LLM 的手（转抄即改写）。
 *
 * 见 docs/design/pipeline.md「去 AI 味引擎」。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../../data/schema.ts";
import { DataError } from "../../data/errors.ts";
import { chapterTextPath } from "../../data/paths.ts";
import { chapterNo } from "../../data/ids.ts";
import { readText, writeTextAtomic } from "../../data/io.ts";
import { advanceStatus } from "../../data/state.ts";
import { writeChapterReport } from "../../data/chapters.ts";
import type { OpenNovel } from "../../data/novel.ts";
import { readIndexTool } from "../../tools/read.ts";
import { resolveModel } from "../models.ts";
import { runSubSession } from "../session.ts";
import { runReviewAndPersist, type PersistedReview, type ReviewerRunner } from "../review/index.ts";
import { renderDeaiReport, type DeaiHit } from "./report.ts";
import { collectProperNouns, scanDeaiScope, type ScopeReport } from "./scope.ts";
import { readHumanizerSkill, HUMANIZER_SKILL_PATH } from "./skill.ts";

export const DEAI_TIMEOUT_MS = 300_000;

export interface DeaiResult {
  chapter: number;
  hits: DeaiHit[];
  scope: ScopeReport;
  reportMarkdown: string;
  text: string;
}

export interface DeaiRunner {
  (context: { systemPrompt: string; prompt: string; novel: OpenNovel; cwd: string }): Promise<{
    hits: DeaiHit[];
    rewritten: string;
    error: string | null;
  }>;
}

export interface DeaiOptions {
  novel: OpenNovel;
  chapter: number;
  /** 主会话 cwd（**不是小说根**）。 */
  cwd: string;
  runner?: DeaiRunner | undefined;
  /** 注入假复查 runner 供测试（否则复查会起真实子会话，测试会跑几分钟）。 */
  reviewRunner?: ReviewerRunner | undefined;
  /** 阶段进度（改写 → 复查），用于让用户知道没卡死。 */
  onProgress?: ((message: string) => void) | undefined;
}

/** 去 AI 味 + 改稿复查。**两步是一个环节**，拆开会让「忘了复查」变成可能。 */
export async function runDeaiWithRecheck(options: DeaiOptions): Promise<{
  deai: DeaiResult;
  recheck: PersistedReview;
}> {
  options.onProgress?.("正在改写（humanizer）…");
  const deai = await runDeaiAndPersist(options);
  options.onProgress?.("改写完成，正在跑改稿复查（F / G）…");
  const recheck = await runReviewAndPersist(
    {
      novel: options.novel,
      chapter: options.chapter,
      cwd: options.cwd,
      mode: "post-deai",
    },
    options.reviewRunner,
  );
  // 复查过了才能进「待你验收」：那一步的准入条件是「被审查过」。
  advanceStatus(options.novel.root, options.chapter, "deai_done", "awaiting_user_review");
  return { deai, recheck };
}

export async function runDeaiAndPersist(options: DeaiOptions): Promise<DeaiResult> {
  const { novel, chapter } = options;

  const skill = readHumanizerSkill();
  if (skill === null) {
    // **不静默跳过**：读不到 skill 就意味着「去 AI 味」不会按既定标准发生。
    throw new DataError(
      `读不到 humanizer skill（${HUMANIZER_SKILL_PATH}）。去 AI 味依赖它的模式清单与改写流程，` +
        `读不到就不能假装做过了 —— 请确认该 skill 存在，或明确跳过这一步。`,
    );
  }

  const before = readText(chapterTextPath(novel.root, chapter));
  if (before === null || before.trim() === "") {
    throw new DataError(`第 ${chapter} 章还没有正文，无法去 AI 味。先生成正文（在写作模式下说「写吧」）。`);
  }

  const sample = voiceSample(novel, chapter);
  const run = options.runner ?? defaultDeaiRunner();
  const outcome = await run({
    systemPrompt: renderDeaiSystemPrompt(skill, sample),
    prompt: renderDeaiPrompt(before, sample),
    novel,
    cwd: options.cwd,
  });

  if (outcome.error !== null) {
    throw new DataError(`去 AI 味失败：${outcome.error}。正文未被改动。`);
  }
  if (outcome.rewritten.trim() === "") {
    throw new DataError("去 AI 味没有产出改后正文，正文未被改动。请把原因告知用户。");
  }

  const scope = scanDeaiScope({ before, after: outcome.rewritten, properNouns: collectProperNouns(novel) });
  const markdown = renderDeaiReport({
    chapter,
    hits: outcome.hits,
    before,
    after: outcome.rewritten,
    voiceSample: sample,
    scope,
  });

  // 正文落盘走同一个写入口：正文校验、章节索引、留痕都由它保证。
  writeTextAtomic(chapterTextPath(novel.root, chapter), outcome.rewritten.endsWith("\n") ? outcome.rewritten : `${outcome.rewritten}\n`);
  writeChapterReport(novel.root, chapter, "deai", markdown);
  advanceState(novel, chapter);

  const scopeWarnings = scope.hits.length + (scope.paragraphCountChanged ? 1 : 0);
  const lines = [
    `已完成第 ${chapterNo(chapter)} 章的去 AI 味，报告写入 chapters/${chapterNo(chapter)}.deai.md，改后正文已覆盖。`,
    `命中 ${outcome.hits.length} 处；范围检查：${scopeWarnings === 0 ? "没有碰到专有名词或数字" : `⚠️ ${scopeWarnings} 处需要你确认`}`,
    "",
    "接下来会自动跑**改稿复查**（只覆盖 F / G）。",
  ];

  return { chapter, hits: outcome.hits, scope, reportMarkdown: markdown, text: lines.join("\n") };
}

/** 状态：auto_reviewed → deai_done（复查之后再推到 awaiting_user_review）。 */
function advanceState(novel: OpenNovel, chapter: number): void {
  advanceStatus(novel.root, chapter, "auto_reviewed", "deai_done");
}

/** 文风样本：本书最近 N 章正文（第 1 章时没有）。 */
function voiceSample(novel: OpenNovel, chapter: number): { from: number; to: number; text: string } | null {
  const recent = novel.state.config.recentChapters;
  const parts: string[] = [];
  let from = 0;
  let to = 0;
  for (let no = Math.max(1, chapter - recent); no < chapter; no += 1) {
    const text = readText(chapterTextPath(novel.root, no));
    if (text === null || text.trim() === "") continue;
    if (from === 0) from = no;
    to = no;
    parts.push(text.trim());
  }
  return parts.length === 0 ? null : { from, to, text: parts.join("\n\n") };
}

/**
 * 系统提示词 = humanizer skill 全文 + 本书语境。
 *
 * **skill 优先于通用规则这一条要显式转述**：skill 自己写了「样本优先」，
 * 但这里是「样本 = 本书前文」，模型需要知道这一点才会拿前文当参照。
 */
function renderDeaiSystemPrompt(skill: string, sample: { from: number; to: number; text: string } | null): string {
  const lines = [
    "你在做小说正文的去 AI 味改写。下面是 humanizer skill 的完整内容，按它工作：",
    "",
    "══════ humanizer skill ══════",
    skill,
    "══════ skill 结束 ══════",
    "",
    "本次任务的额外约束（比 skill 里的通用规则更具体）：",
    "",
    "1. **你在改的是小说正文，不是文章。** skill 里「Fiction is exempt」指的就是这种文本：",
    "   虚构细节是任务本身，所以不要因为「像是编的」而删掉人物、动作、对话。",
    "2. **只动表达层。** 不许改：人名、称谓、设定术语、数字、日期、因果关系、情节走向、",
    "   人物已经做过的事。改完之后，这些事实必须一模一样。",
    "3. **保留特异细节。** 具体的物件、动作、口语、地方感是这篇文本里最不像 AI 的部分 ——",
    "   它们是改写的锚点，不是要去掉的东西。",
    "4. skill 第 3 步的「复检五类」必须做完（not-X-but-Y、单句收尾、破折号、三段式、加粗标签）。",
    "",
  ];

  if (sample === null) {
    lines.push(
      "**本次没有文风样本**（本书还没有已写章节）。退回 skill 的通用规则，",
      "并在提交时把这一点说清楚。",
      "",
    );
  } else {
    lines.push(
      `**文风样本：本书第 ${chapterNo(sample.from)} 章到第 ${chapterNo(sample.to)} 章的正文**（附在用户消息里）。`,
      "按 skill 的 Voice 一节：**样本优先于通用模式规则** —— 如果样本里惯用破折号，",
      "就保持差不多的频率，不要按 §6 把它们全部删掉。目标是改完之后**还是这本书的写法**。",
      "",
    );
  }

  lines.push(
    "最后必须调用 submit_deai 提交：命中清单 + **改后全文**（全文是必填的，落盘用的是它）。",
  );
  return lines.join("\n");
}

function renderDeaiPrompt(before: string, sample: { from: number; to: number; text: string } | null): string {
  const lines: string[] = [];
  if (sample !== null) {
    lines.push(`【文风样本（本书第 ${chapterNo(sample.from)}–${chapterNo(sample.to)} 章）】`, "", sample.text, "");
  }
  lines.push("【本次要改的本章正文】", "", before.trim());
  return lines.join("\n");
}

function defaultDeaiRunner(): DeaiRunner {
  return async (context) => {
    const collected: { hits: DeaiHit[]; rewritten: string } = { hits: [], rewritten: "" };
    const resolved = await resolveModel("draft", context.novel.state);

    const result = await runSubSession({
      cwd: context.cwd,
      systemPrompt: context.systemPrompt,
      prompt: context.prompt,
      // 只读 + 提交。改后正文通过工具回传，落盘由主流程做。
      customTools: [readIndexTool, createSubmitDeaiTool(collected)],
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel,
      timeoutMs: DEAI_TIMEOUT_MS,
    });

    if (result.timedOut) return { hits: [], rewritten: "", error: `超过 ${Math.round(DEAI_TIMEOUT_MS / 1000)} 秒未完成` };
    if (result.error !== null) return { hits: [], rewritten: "", error: result.error };
    if (collected.rewritten === "") {
      const excerpt = result.text.trim().slice(-200);
      return {
        hits: [],
        rewritten: "",
        error: `模型没有调用 submit_deai` + (excerpt === "" ? "" : `；它的最后输出：…${excerpt}`),
      };
    }
    return { hits: collected.hits, rewritten: collected.rewritten, error: null };
  };
}

/** submit 工具在闭包里写 collector。导出供测试。 */
export function createSubmitDeaiTool(collector: { hits: DeaiHit[]; rewritten: string }) {
  return defineTool({
    name: "submit_deai",
    label: "提交去 AI 味结果",
    description:
      "提交去 AI 味的结果：命中清单 + **改后全文**。**必须调用** —— 落盘用的是你提交的全文，" +
      "只在对话里输出不算产出。全文要完整，不要截断、不要省略号。",
    parameters: Type.Object(
      {
        hits: Type.Array(
          Type.Object(
            {
              pattern: Type.String({ description: "命中的模式，如 §1 not-X-but-Y" }),
              paragraph: Type.Integer({ minimum: 1, description: "段落号，从 1 开始" }),
              original: Type.String({ description: "原文片段" }),
              action: Type.String({ description: "处理方式，如「已改写」" }),
            },
            STRICT,
          ),
        ),
        rewritten: Type.String({ description: "改后的完整正文（落盘用的就是它）" }),
      },
      STRICT,
    ),
    async execute(_toolCallId, params) {
      collector.hits = params.hits.map((hit) => ({
        pattern: hit.pattern,
        paragraph: hit.paragraph,
        original: hit.original,
        action: hit.action,
      }));
      collector.rewritten = params.rewritten;
      return {
        content: [{ type: "text", text: `已记录 ${collector.hits.length} 处命中与改后全文（${collector.rewritten.length} 字）。` }],
        details: {},
      };
    },
  });
}
