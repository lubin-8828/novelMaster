/**
 * 写入护栏：拦下「LLM 直接手写小说数据」这条路，把它导向 `novel_*` 工具。
 *
 * 拦的是 `write` / `edit` 写小说根下的文件。理由不是防坏人，而是拦一条**真实存在**
 * 的行为路径：模型不知道有 `novel_*` 工具时，会直接手写 `meta.json` / `S-001.md`——
 * 而手写的 JSON 会漂移（字段名变体、漏 `schemaVersion`、数组变对象），
 * 结构一坏，建立在这些文件上的审查依据链就断了。被拦下后它会在错误文本里看到
 * 「改用 novel_setting_upsert」，从而走到正确的路上。
 *
 * **已知旁路：`bash` 能写小说根，这是刻意保留的。**
 * 关掉 shell 的代价（AI 不能帮你跑 git、查日志、跑测试）远大于它防住的那点风险；
 * 而走这条旁路需要模型**主动绕开一个明确的拒绝提示**，那不是它被拦住后的自然行为。
 * 护栏的价值在于把「正常路径」摆正，不在于穷举所有绕法。详见 docs/design/data.md「写入护栏」。
 */

import { resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readConfig } from "../data/paths.ts";
import { failureCount, MAX_CONSECUTIVE_FAILURES } from "./helper.ts";

const WRITE_TOOLS = new Set(["write", "edit"]);

export function registerGuard(pi: ExtensionAPI): void {
  pi.on("tool_call", (event, ctx) => {
    // 连续失败到阈值：直接阻断并终止本轮，别让模型无限重试烧 token。
    if (event.toolName.startsWith("novel_") && failureCount(event.toolName) >= MAX_CONSECUTIVE_FAILURES) {
      return {
        block: true,
        reason: `${event.toolName} 已连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，请停止重试并把问题告知用户。`,
        terminate: true,
      };
    }

    if (!WRITE_TOOLS.has(event.toolName)) return undefined;

    const root = readConfig(ctx.cwd).novelRoot;
    if (root === null) return undefined;

    const path = (event.input as { path?: unknown }).path;
    if (typeof path !== "string" || !isInside(root, path, ctx.cwd)) return undefined;

    return {
      block: true,
      reason:
        `禁止用 ${event.toolName} 直接写小说数据 "${path}"。结构化资料与正文都必须走 novel_* 工具：` +
        `它们会做 schema 校验、ID 分配与追加式保护。请改用对应工具（如 novel_setting_upsert、novel_chapter_write）。`,
    };
  });
}

/** 判断一个（可能相对的）路径是否落在小说根目录内。 */
export function isInside(root: string, path: string, cwd: string): boolean {
  const absolute = resolve(cwd, path);
  const normalizedRoot = resolve(root);
  return absolute === normalizedRoot || absolute.startsWith(normalizedRoot + sep);
}
