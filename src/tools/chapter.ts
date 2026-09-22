/**
 * 章节类工具。
 *
 * `novel_chapter_write` 是唯一带「两段式确认」的工具：工具没有二次交互能力，
 * 所以命中 markdown 标记时**不落盘**，把清单返回给 LLM 去问用户；
 * 用户确认后带 `acknowledgeMarkdown: true` 重调才写。理由见 docs/design/data.md「正文校验」。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ReportKindSchema, STRICT, SummarySectionsSchema } from "../data/schema.ts";
import {
  writeChapterOutline,
  writeChapterReport,
  writeChapterSummary,
  writeChapterText,
  type MarkdownHit,
} from "../data/chapters.ts";
import { withNovel } from "./helper.ts";

export const chapterTools = [
  defineTool({
    name: "novel_chapter_outline_write",
    label: "写章节大纲",
    description:
      "写某一章的章节大纲（覆盖式）。markdown 应包含开头的结构化头块（人物/设定/事件/主事件），" +
      "供上下文装配器判定相关性。「确认记录」区段由工具维护，不要在 markdown 里重复写。" +
      "用户确认本轮大纲时传 confirmNote（如「用户确认」），草稿态省略。",
    parameters: Type.Object(
      {
        chapter: Type.Integer({ minimum: 1 }),
        title: Type.String({ description: "本章标题" }),
        markdown: Type.String({ description: "大纲正文，含开头的 novelmaster:outline 注释头块" }),
        confirmNote: Type.Optional(Type.String({ description: "写入「确认记录」的说明；草稿态省略" })),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel("novel_chapter_outline_write", (novel) => {
        writeChapterOutline(novel.root, {
          chapter: params.chapter,
          title: params.title,
          markdown: params.markdown,
          confirmNote: params.confirmNote,
        });
        const suffix = params.confirmNote === undefined ? "（草稿态，尚未确认）" : "，并记入确认记录";
        return {
          text: `已写入第 ${params.chapter} 章大纲「${params.title}」${suffix}。`,
          target: `chapters/${String(params.chapter).padStart(3, "0")}.outline.md`,
        };
      });
    },
  }),

  defineTool({
    name: "novel_chapter_write",
    label: "写正文",
    description:
      "写某一章的正文。写入前会跑正文校验（扫 markdown 标记）。**命中标记时不会落盘**，" +
      "而是把命中清单返回给你 —— 请把清单交给用户看，用户确认正文里确实该有这些标记后，" +
      "带 acknowledgeMarkdown: true 重新调用。正文文件里只有正文，不要写标题或状态。",
    parameters: Type.Object(
      {
        chapter: Type.Integer({ minimum: 1 }),
        text: Type.String({ description: "正文纯文本" }),
        acknowledgeMarkdown: Type.Optional(
          Type.Boolean({ description: "用户已确认要保留检测到的 markdown 标记；未确认时不要传" }),
        ),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel("novel_chapter_write", (novel) => {
        const result = writeChapterText(novel.root, {
          chapter: params.chapter,
          text: params.text,
          acknowledgeMarkdown: params.acknowledgeMarkdown,
        });
        if (!result.written) {
          return {
            text:
              `正文未写入：检测到 ${result.hits.length} 处 markdown 标记。\n\n${renderHits(result.hits)}\n\n` +
              `请把这份清单给用户看。正文允许出现破折号与对话里的 "-"，所以这不是错误，不要求改写；` +
              `用户确认后带 acknowledgeMarkdown: true 重新调用即可落盘。`,
            details: { written: false, hits: result.hits },
          };
        }
        const note = result.hits.length > 0 ? `（用户已确认 ${result.hits.length} 处 markdown 标记）` : "";
        return {
          text:
            `已写入第 ${params.chapter} 章正文，共 ${result.wordCount} 字${note}。` +
            `\n\n**接下来两步必做**：① novel_state_update 置 drafted；② novel_review 跑审查（它会置 auto_reviewed）。`,
          target: `chapters/${String(params.chapter).padStart(3, "0")}.txt`,
          details: { written: true, wordCount: result.wordCount, hits: result.hits },
        };
      });
    },
  }),

  defineTool({
    name: "novel_chapter_summary_write",
    label: "写章节摘要",
    description:
      "写某一章的摘要。传结构化字段，小节标题由工具生成 —— 不要传整段 markdown，" +
      "因为下游要靠固定小节做机器读取。摘要**只压缩不改写**。",
    parameters: Type.Object(
      {
        chapter: Type.Integer({ minimum: 1 }),
        sections: SummarySectionsSchema,
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel("novel_chapter_summary_write", (novel) => {
        writeChapterSummary(novel.root, params.chapter, params.sections);
        return {
          text: `已写入第 ${params.chapter} 章摘要。`,
          target: `chapters/${String(params.chapter).padStart(3, "0")}.summary.md`,
        };
      });
    },
  }),

  defineTool({
    name: "novel_chapter_report_write",
    label: "写章节报告",
    description:
      "写某一章的审查 / 去 AI 味 / 回填报告。kind 取 review / deai / reflow，" +
      "分别落到 NNN.review.md / NNN.deai.md / NNN.reflow.md。",
    parameters: Type.Object(
      {
        chapter: Type.Integer({ minimum: 1 }),
        kind: ReportKindSchema,
        markdown: Type.String({ description: "报告正文（markdown）" }),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel("novel_chapter_report_write", (novel) => {
        writeChapterReport(novel.root, params.chapter, params.kind, params.markdown);
        return {
          text: `已写入第 ${params.chapter} 章的 ${params.kind} 报告。`,
          target: `chapters/${String(params.chapter).padStart(3, "0")}.${params.kind}.md`,
        };
      });
    },
  }),
];

function renderHits(hits: readonly MarkdownHit[]): string {
  return hits
    .slice(0, 20)
    .map((hit) => `- 第 ${hit.line} 行（${hit.pattern}）：${hit.snippet}`)
    .join("\n")
    .concat(hits.length > 20 ? `\n- …还有 ${hits.length - 20} 处` : "");
}
