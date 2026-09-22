/**
 * 主线大纲与想法收集箱的工具。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { NAMES, inboxPath } from "../data/paths.ts";
import { readText } from "../data/io.ts";
import { appendOutlineRevision, writeOutline } from "../data/outline.ts";
import { appendInbox } from "../data/inbox.ts";
import { DataError } from "../data/errors.ts";
import { STRICT } from "../data/schema.ts";
import { withNovel } from "./helper.ts";

export const outlineTools = [
  defineTool({
    name: "novel_outline_write",
    label: "写主线大纲",
    description:
      "覆盖式写主线大纲。markdown 是全文（一句话主题 / 阶段划分 / 主要冲突 / 结局）。" +
      "底部的「修订记录」由工具保留，不要在 markdown 里重复写 —— 想追加修订用 novel_outline_append_revision。",
    parameters: Type.Object(
      { markdown: Type.String({ description: "大纲全文（markdown）" }) },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_outline_write", (novel) => {
        writeOutline(novel.root, params.markdown);
        return { text: "已覆盖写入主线大纲，「修订记录」原样保留。", target: NAMES.outline };
      });
    },
  }),

  defineTool({
    name: "novel_outline_append_revision",
    label: "追加大纲修订记录",
    description: "往主线大纲的「修订记录」追加一行。修订记录是追加式的，已写入的行不会被改动。",
    parameters: Type.Object({ text: Type.String({ description: "这次的修订内容" }) }, STRICT),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_outline_append_revision", (novel) => {
        appendOutlineRevision(novel.root, params.text);
        return { text: "已往主线大纲的修订记录追加一行。", target: NAMES.outline };
      });
    },
  }),
];

export const inboxTools = [
  defineTool({
    name: "novel_inbox_append",
    label: "追加想法",
    description:
      "往想法收集箱追加一条。用于用户随口提到的、暂时不处理的想法 —— **不整理、不评判、不删除**。",
    parameters: Type.Object(
      {
        text: Type.String(),
        tags: Type.Optional(Type.Array(Type.String(), { description: "可选标签" })),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_inbox_append", (novel) => {
        const path = inboxPath(novel.root);
        if (readText(path) === null) throw new DataError(`${NAMES.inbox} 不存在，这本小说的数据不完整`);
        appendInbox(novel.root, params.text, params.tags ?? []);
        return { text: "已追加到想法收集箱。", target: NAMES.inbox };
      });
    },
  }),
];
