/**
 * 建书工具 `novel_init`。
 *
 * `/init` 命令发引导任务段，AI 在对话里访谈收集「书名 / 类型 / 核心想法」、
 * 用户确认后调用本工具落盘。它是**唯一不需要先打开小说**的写工具：
 * 它的任务恰恰是建立小说，所以不走 withNovel 外壳（那个外壳的前提是
 * 「当前已打开小说」）。
 *
 * 见 docs/design/interaction.md「建书」。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../data/schema.ts";
import { initNovel, slugify } from "../data/init.ts";
import { defaultNovelRoot, writeConfig } from "../data/paths.ts";
import { logOperation } from "../data/log.ts";
import { ok, fail, type ToolResult } from "./helper.ts";

export const initTools = [
  defineTool({
    name: "novel_init",
    label: "新建小说",
    description:
      "新建一本小说：建目录、写初始文件、设为当前打开的小说。用户通过 /init 的引导访谈给出书名、类型与核心想法**并确认后**调用。" +
      "书名与核心想法必填；同书名已存在时拒绝（不覆盖已有小说）。",
    parameters: Type.Object(
      {
        title: Type.String({ minLength: 1 }),
        genre: Type.Optional(Type.Array(Type.String())),
        premise: Type.String({ minLength: 1 }),
      },
      STRICT,
    ),
    async execute(_toolCallId, params): Promise<ToolResult> {
      const title = params.title.trim();
      if (title === "") {
        return fail("书名不能为空 —— 不建无名之书。先向用户问清书名。");
      }
      const premise = params.premise.trim();
      if (premise === "") {
        return fail(
          "核心想法不能为空 —— 它是一切推断的根。继续追问用户最初想到这个故事时脑子里装的是什么，拿到他的**原话**（不要替他编）。",
        );
      }
      const root = defaultNovelRoot(slugify(title));
      try {
        const result = initNovel(root, { title, genre: params.genre ?? [], premise });
        writeConfig({ novelRoot: result.root });
        // 建书一次写 10 个文件，留痕 target 用 "."（相对小说根 = 整本小说）。
        logOperation(result.root, "novel_init", ".");
        return ok(
          [
            `已创建小说《${result.meta.title}》`,
            `根目录：${result.root}`,
            `类型：${result.meta.genre.length > 0 ? result.meta.genre.join(" / ") : "（未填）"}`,
            "",
            "已建立的文件：",
            ...result.files.map((f) => `  ${f}`),
            "",
            "把这些转述给用户，并提示下一步：/outline 进入大纲层搭主线。",
          ].join("\n"),
          { root: result.root, title: result.meta.title },
        );
      } catch (err) {
        return fail(`建书失败：${(err as Error).message}。把原因转述给用户。`);
      }
    },
  }),
];
