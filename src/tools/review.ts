/**
 * 审查工具（主会话侧）。
 *
 * 子会话专用的 `submit_findings` 不在这里 —— 它由 `src/ai/review/index.ts` 用闭包造出，
 * 只注入审查子会话（否则主会话能自己「提交」一份假审查结果）。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../data/schema.ts";
import { chapterNo } from "../data/ids.ts";
import { runReviewAndPersist } from "../ai/review/index.ts";
import { withNovel } from "./helper.ts";

export const reviewTools = [
  defineTool({
    name: "novel_review",
    label: "审查本章",
    description:
      "对当前章跑一次审查：三个独立只读审查员（设定 / 人物关系 / 逻辑叙事）并发审，各自提交结构化问题，" +
      "再机械合并 + 依据校验，最后落盘 chapters/NNN.review.md（并在 drafted 时把状态推进到 auto_reviewed）。" +
      "**生成正文后必须立即调用它** —— 流水线不得跳步。审查员只读、不改稿；报告出来后要逐条交给用户拍板。",
    parameters: Type.Object({}, STRICT),
    async execute(_toolCallId, _params, _signal, onUpdate, ctx) {
      return withNovel(ctx, "novel_review", async (novel) => {
        const result = await runReviewAndPersist({
          novel,
          chapter: novel.state.currentChapter,
          cwd: ctx.cwd,
          onProgress: (done, total, reviewer) => {
            onUpdate?.({
              content: [{ type: "text", text: `审查进行中：${done}/${total}（${reviewer.name} 已完成）` }],
              details: {},
            });
          },
        });
        return {
          text: result.text,
          target: `chapters/${chapterNo(result.chapter)}.review.md`,
          details: {
            chapter: result.chapter,
            findings: result.findings.length,
            missing: result.missing,
          },
        };
      });
    },
  }),
];
