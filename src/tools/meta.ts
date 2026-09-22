/**
 * 元信息工具。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../data/schema.ts";
import { NAMES } from "../data/paths.ts";
import { updateMeta } from "../data/meta.ts";
import { renderChanges } from "../data/diff.ts";
import { withNovel } from "./helper.ts";

export const metaTools = [
  defineTool({
    name: "novel_meta_update",
    label: "更新元信息",
    description:
      "更新小说的一句话简介（logline）、叙事视角（pov）或时态（tense）。" +
      "**不能改书名** —— 书名对应目录名，改名是另一回事。" +
      "pov / tense 会被审查用来判定视角越界与人称漂移，所以不要随手留空。",
    parameters: Type.Object(
      {
        logline: Type.Optional(Type.String({ description: "整理后的一句话简介" })),
        pov: Type.Optional(Type.String({ description: "叙事视角，如「第三人称限知」" })),
        tense: Type.Optional(Type.String({ description: "时态，如「过去时」" })),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_meta_update", (novel) => {
        const result = updateMeta(novel.root, {
          logline: params.logline,
          pov: params.pov,
          tense: params.tense,
        });
        if (result.changes.length === 0) {
          return { text: "元信息没有实际变化（传入的值与现有值相同）。" };
        }
        return {
          text: `已更新元信息：\n${renderChanges(result.changes)}`,
          target: NAMES.meta,
          details: { changes: result.changes },
        };
      });
    },
  }),
];
