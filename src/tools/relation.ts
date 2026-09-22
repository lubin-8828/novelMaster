/**
 * 关系类工具。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../data/schema.ts";
import { appendRelationHistory, upsertRelation } from "../data/relations.ts";
import { listCharacters } from "../data/characters.ts";
import { withNovel } from "./helper.ts";

export const relationTools = [
  defineTool({
    name: "novel_relation_upsert",
    label: "新增或更新关系",
    description:
      "新增或更新两个人之间的有向关系。省略 id 表示新建（自动分配 R-NNN）。from / to 必须是已存在的人物 ID。" +
      "关系变化的过程用 novel_relation_append_history 记录 —— 这里的 status 只表达当前状态。",
    parameters: Type.Object(
      {
        id: Type.Optional(Type.String({ description: "已有关系的 ID，如 R-001；新建时省略" })),
        from: Type.String({ description: "起点人物 ID，如 C-001" }),
        to: Type.String({ description: "终点人物 ID，如 C-002" }),
        type: Type.String({ description: "关系类型，如 subordinate / mentor / rival" }),
        directed: Type.Optional(Type.Boolean({ description: "是否有向，默认 true" })),
        status: Type.Optional(
          Type.Union([Type.Literal("active"), Type.Literal("broken"), Type.Literal("ended")]),
        ),
        since: Type.Optional(Type.Integer({ minimum: 0, description: "关系始于第几章" })),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_relation_upsert", (novel) => {
        const result = upsertRelation(
          novel.root,
          {
            id: params.id,
            from: params.from,
            to: params.to,
            type: params.type,
            directed: params.directed,
            status: params.status,
            since: params.since,
          },
          listCharacters(novel.root).map((entry) => entry.id),
          novel.state.currentChapter,
        );
        const verb = result.created ? "已新建关系" : "已更新关系";
        return {
          text: `${verb} ${result.id}（${params.from} → ${params.to}）。`,
          target: "relations.json",
          details: { id: result.id, created: result.created },
        };
      });
    },
  }),

  defineTool({
    name: "novel_relation_append_history",
    label: "追加关系变更",
    description:
      "往关系的变更史追加一条。变更史是追加式的，只增不改 —— 关系是有历史的（敌 → 友 → 决裂），" +
      "当前状态用 nextStatus 同步，历史记录由这个工具保留。",
    parameters: Type.Object(
      {
        id: Type.String({ description: "关系 ID，如 R-001" }),
        chapter: Type.Integer({ minimum: 0, description: "变更发生在第几章" }),
        change: Type.String({ description: "这次发生了什么变化" }),
        nextStatus: Type.Optional(
          Type.Union([Type.Literal("active"), Type.Literal("broken"), Type.Literal("ended")], {
            description: "顺带把当前状态改成它；省略则状态不变",
          }),
        ),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_relation_append_history", (novel) => {
        appendRelationHistory(novel.root, params.id, params.chapter, params.change, params.nextStatus);
        return {
          text: `已给 ${params.id} 追加变更记录${params.nextStatus === undefined ? "" : `，状态改为 ${params.nextStatus}`}。`,
          target: "relations.json",
        };
      });
    },
  }),
];
