/**
 * 去 AI 味工具（主会话侧）。
 *
 * 子会话专用的 `submit_deai` 不在这里 —— 它由 `src/ai/deai/index.ts` 用闭包造出，
 * 只注入改写子会话。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../data/schema.ts";
import { chapterNo } from "../data/ids.ts";
import { runDeaiWithRecheck } from "../ai/deai/index.ts";
import { withNovel } from "./helper.ts";

export const deaiTools = [
  defineTool({
    name: "novel_deai",
    label: "去 AI 味",
    description:
      "对当前章跑去 AI 味：读 humanizer skill 的完整内容 → 以**本书前文为文风样本**改写 → " +
      "落盘改后正文与报告（命中清单 / 范围检查 / 改前 / 改后）→ **自动跑改稿复查（只覆盖 F / G）**。" +
      "**审查之后必须调用它**（流水线不得跳步）。只动表达层，不改事实 —— 报告里有一节机械校验这件事。",
    parameters: Type.Object({}, STRICT),
    async execute(_toolCallId, _params, _signal, onUpdate, ctx) {
      return withNovel("novel_deai", async (novel) => {
        const result = await runDeaiWithRecheck({
          novel,
          chapter: novel.state.currentChapter,
          cwd: ctx.cwd,
          onProgress: (message) => {
            onUpdate?.({ content: [{ type: "text", text: message }], details: {} });
          },
        });

        return {
          text: `${result.deai.text}\n\n${result.recheck.text}`,
          // 主产物是改后的正文（报告只是说明）；留痕记正文这条。
          target: `chapters/${chapterNo(result.deai.chapter)}.txt`,
          details: {
            chapter: result.deai.chapter,
            hits: result.deai.hits.length,
            scopeWarnings: result.deai.scope.hits.length + (result.deai.scope.paragraphCountChanged ? 1 : 0),
            recheckFindings: result.recheck.findings.length,
          },
        };
      });
    },
  }),
];
