/**
 * 设定类工具（docs/design/data.md「工具清单」）。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../data/schema.ts";
import { upsertSetting, appendSettingRevision } from "../data/settings.ts";
import { upsertText, withNovel } from "./helper.ts";

export const settingTools = [
  defineTool({
    name: "novel_setting_upsert",
    label: "新增或更新设定条目",
    description:
      "新增或更新一条世界观设定（规则、地点、势力、物品、禁忌）。省略 id 表示新建，工具会自动分配 S-NNN；" +
      "带 id 表示更新已有条目。更新是覆盖式的：body 会替换旧详述，但「修订记录」原样保留（要留痕请另调 novel_setting_append_revision）。" +
      "条目不想要了就置 deprecated: true，**不要重建一条来替代它** —— 历史审查报告可能引用旧 ID。",
    parameters: Type.Object(
      {
        id: Type.Optional(Type.String({ description: "已有条目的 ID，如 S-001；新建时省略" })),
        name: Type.String({ description: "条目名称" }),
        category: Type.Union([
          Type.Literal("world_rule"),
          Type.Literal("location"),
          Type.Literal("faction"),
          Type.Literal("item"),
          Type.Literal("taboo"),
          Type.Literal("custom"),
        ]),
        summary: Type.String({ description: "一句话摘要，进索引" }),
        body: Type.String({ description: "详述正文（markdown）" }),
        establishedIn: Type.Optional(
          Type.Integer({ minimum: 0, description: "首次确立于第几章；0 表示在设定期建立" }),
        ),
        tags: Type.Optional(Type.Array(Type.String(), { description: "分类标签" })),
        deprecated: Type.Optional(
          Type.Boolean({ description: "废弃标记。废止不等于删除（历史报告可能引用旧 ID）" }),
        ),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_setting_upsert", (novel) => {
        const result = upsertSetting(novel.root, {
          id: params.id,
          name: params.name,
          category: params.category,
          summary: params.summary,
          body: params.body,
          establishedIn: params.establishedIn,
          tags: params.tags,
          deprecated: params.deprecated,
        });
        return {
          text: upsertText({
            label: "设定条目",
            id: result.id,
            name: params.name,
            created: result.created,
            changes: result.changes,
          }),
          target: `setting/${result.id}.md`,
          details: { id: result.id, created: result.created, changes: result.changes },
        };
      });
    },
  }),

  defineTool({
    name: "novel_setting_append_revision",
    label: "追加设定修订记录",
    description:
      "往设定条目的「修订记录」追加一行。修订记录是追加式的，已写入的行不会被修改或删除 —— " +
      "改动设定后想留下「什么变了」请用这个工具。",
    parameters: Type.Object(
      {
        id: Type.String({ description: "设定条目 ID，如 S-001" }),
        chapter: Type.Integer({ minimum: 0, description: "发生在第几章；0 表示设定期" }),
        text: Type.String({ description: "这次的修订内容" }),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_setting_append_revision", (novel) => {
        appendSettingRevision(novel.root, params.id, params.chapter, params.text);
        return {
          text: `已往 ${params.id} 的修订记录追加一行。`,
          target: `setting/${params.id}.md`,
        };
      });
    },
  }),
];
