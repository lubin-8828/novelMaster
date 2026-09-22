/**
 * 只读工具：读各类资料的索引。
 *
 * 索引是「有什么」的清单；条目详述让人（或 LLM）用 `read` 工具读 md 文件 ——
 * 为每类资料再造一个「读详述」工具只会让工具表变长，而 read 已经够用。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  ChapterIndexSchema,
  CharacterIndexSchema,
  EventIndexSchema,
  RelationsDocSchema,
  SettingIndexSchema,
  STRICT,
} from "../data/schema.ts";
import {
  chapterIndexPath,
  characterIndexPath,
  eventIndexPath,
  relationsPath,
  settingIndexPath,
} from "../data/paths.ts";
import { readDoc } from "../data/doc.ts";
import { withNovel } from "./helper.ts";

const KINDS = ["setting", "character", "relation", "event", "chapter"] as const;
type Kind = (typeof KINDS)[number];

const READERS: Record<Kind, (root: string) => unknown> = {
  setting: (root) => readDoc(settingIndexPath(root), SettingIndexSchema, "setting/index.json"),
  character: (root) => readDoc(characterIndexPath(root), CharacterIndexSchema, "characters/index.json"),
  relation: (root) => readDoc(relationsPath(root), RelationsDocSchema, "relations.json"),
  event: (root) => readDoc(eventIndexPath(root), EventIndexSchema, "events/index.json"),
  chapter: (root) => readDoc(chapterIndexPath(root), ChapterIndexSchema, "chapters/index.json"),
};

export const readIndexTool = defineTool({
  name: "novel_read_index",
  label: "读资料索引",
  description:
    "读当前小说的某一类资料索引。kind 取 setting（设定）/ character（人物）/ relation（关系）/ event（事件）/ chapter（章节）。" +
    "返回的是索引（含 ID、名称、摘要等元信息）；条目的完整详述请用 read 工具读对应的 md 文件。",
  parameters: Type.Object(
    {
      kind: Type.Union([
        Type.Literal("setting"),
        Type.Literal("character"),
        Type.Literal("relation"),
        Type.Literal("event"),
        Type.Literal("chapter"),
      ]),
    },
    STRICT,
  ),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    return withNovel("novel_read_index", (novel) => ({
      text: JSON.stringify(READERS[params.kind](novel.root), null, 2),
    }));
  },
});

export const readTools = [readIndexTool];
