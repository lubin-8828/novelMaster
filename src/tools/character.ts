/**
 * 人物类工具。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../data/schema.ts";
import { appendCharacterTimeline, upsertCharacter } from "../data/characters.ts";
import { upsertText, withNovel } from "./helper.ts";

const STATIC_FIELDS = {
  age: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  gender: Type.Optional(Type.String()),
  appearance: Type.Optional(Type.String()),
  background: Type.Optional(Type.String()),
  personality: Type.Optional(Type.String()),
  speechHabits: Type.Optional(Type.String()),
  goal: Type.Optional(Type.String()),
  fear: Type.Optional(Type.String()),
} as const;

export const characterTools = [
  defineTool({
    name: "novel_character_upsert",
    label: "新增或更新人物",
    description:
      "新增或更新一个人物。省略 id 表示新建（自动分配 C-NNN）。静态档案是覆盖式：只覆盖你传进来的字段，" +
      "没传的字段保持原值。状态变了（死了、失踪了）也用它改 status。关键事件请用 novel_character_append_timeline。",
    parameters: Type.Object(
      {
        id: Type.Optional(Type.String({ description: "已有人的 ID，如 C-001；新建时省略" })),
        name: Type.String(),
        aliases: Type.Optional(Type.Array(Type.String(), { description: "别名/称呼" })),
        role: Type.Union([
          Type.Literal("protagonist"),
          Type.Literal("antagonist"),
          Type.Literal("supporting"),
          Type.Literal("minor"),
        ]),
        status: Type.Optional(
          Type.Union([
            Type.Literal("alive"),
            Type.Literal("dead"),
            Type.Literal("missing"),
            Type.Literal("unknown"),
          ]),
        ),
        firstAppeared: Type.Optional(Type.Integer({ minimum: 0, description: "首次出场章号" })),
        static: Type.Optional(Type.Object(STATIC_FIELDS, STRICT)),
        body: Type.Optional(Type.String({ description: "档案详述（markdown）；省略则由结构化字段渲染" })),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_character_upsert", (novel) => {
        const result = upsertCharacter(
          novel.root,
          {
            id: params.id,
            name: params.name,
            aliases: params.aliases,
            role: params.role,
            status: params.status,
            firstAppeared: params.firstAppeared,
            static: params.static,
            body: params.body,
          },
          novel.state.currentChapter,
        );
        return {
          text: upsertText({
            label: "人物",
            id: result.id,
            name: params.name,
            created: result.created,
            changes: result.changes,
          }),
          target: `characters/${result.id}.md`,
          details: { id: result.id, created: result.created, changes: result.changes },
        };
      });
    },
  }),

  defineTool({
    name: "novel_character_append_timeline",
    label: "追加人物时间轴",
    description:
      "往人物的「关键事件时间轴」追加一条。**只记关键事件，不记流水账** —— 时间轴是历史事实，只增不改。" +
      "写入后会自动推进该人物的 lastUpdatedChapter。",
    parameters: Type.Object(
      {
        id: Type.String({ description: "人物 ID，如 C-001" }),
        chapter: Type.Integer({ minimum: 1, description: "发生在第几章" }),
        text: Type.String({ description: "关键事件内容" }),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_character_append_timeline", (novel) => {
        appendCharacterTimeline(novel.root, params.id, params.chapter, params.text);
        return {
          text: `已给 ${params.id} 追加时间轴条目，lastUpdatedChapter 推进到 ${params.chapter}。`,
          target: `characters/${params.id}.md`,
        };
      });
    },
  }),
];
