/**
 * 章状态工具。
 *
 * 状态转移受 `src/data/state.ts` 的转移表约束：非法转移（如 `drafted → accepted`）
 * 直接拒绝。状态机是 `/done` 闸门的执行体，如果它可被 LLM 绕过，闸门就不存在。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ChapterStatusSchema, NovelStateSchema, STRICT, type NovelState } from "../data/schema.ts";
import { NAMES, statePath } from "../data/paths.ts";
import { writeDoc } from "../data/doc.ts";
import { assertTransition } from "../data/state.ts";
import { listEvents } from "../data/events.ts";
import { syncChapterStatus } from "../data/chapters.ts";
import { requireId } from "../data/ids.ts";
import { withNovel } from "./helper.ts";

export const stateTools = [
  defineTool({
    name: "novel_state_update",
    label: "更新章状态",
    description:
      "更新章状态机的当前状态。转移规则由代码校验：正向推进合法，回退只能由用户触发，" +
      "同状态重复设置会被拒绝。只改 pendingReflow / currentChapter 等字段时不必传 chapterStatus。" +
      "开下一章时同时传 currentChapter（+1）与 chapterStatus: not_started。",
    parameters: Type.Object(
      {
        chapterStatus: Type.Optional(ChapterStatusSchema),
        currentChapter: Type.Optional(Type.Integer({ minimum: 1 })),
        currentEventId: Type.Optional(
          Type.Union([Type.String(), Type.Null()], { description: "当前主事件；传 null 表示清空" }),
        ),
        pendingReflow: Type.Optional(Type.Boolean()),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel(ctx, "novel_state_update", (novel) => {
        const { root, state } = novel;

        // 状态转移只在显式传了 chapterStatus 时校验。只改 pendingReflow
        // 这类「不是转移」的更新不该被转移表拦住。
        if (params.chapterStatus !== undefined) {
          assertTransition(state.chapterStatus, params.chapterStatus);
        }
        if (params.currentEventId !== undefined && params.currentEventId !== null) {
          requireId(
            "event",
            params.currentEventId,
            listEvents(root).map((entry) => entry.id),
          );
        }

        const next: NovelState = {
          ...state,
          chapterStatus: params.chapterStatus ?? state.chapterStatus,
          currentChapter: params.currentChapter ?? state.currentChapter,
          currentEventId: params.currentEventId === undefined ? state.currentEventId : params.currentEventId,
          pendingReflow: params.pendingReflow ?? state.pendingReflow,
        };

        const changes: string[] = [];
        if (params.chapterStatus !== undefined) changes.push(`章状态 ${state.chapterStatus} → ${next.chapterStatus}`);
        if (params.currentChapter !== undefined && params.currentChapter !== state.currentChapter) {
          changes.push(`当前章 ${state.currentChapter} → ${next.currentChapter}`);
        }
        if (params.currentEventId !== undefined) {
          changes.push(`当前主事件 = ${next.currentEventId ?? "（无）"}`);
        }
        if (params.pendingReflow !== undefined) changes.push(`pendingReflow = ${next.pendingReflow}`);

        if (changes.length === 0) {
          return { text: "没有提供任何要更新的字段，状态未变。" };
        }

        writeDoc(statePath(root), NovelStateSchema, next, NAMES.state);
        // 章节索引里的 status 是派生字段：真相只有 state.json 一份，
        // 这里顺手把展开值同步过去，避免两处对不上。
        syncChapterStatus(root, next.currentChapter, next.chapterStatus);

        return {
          text: `已更新：${changes.join("；")}。`,
          target: NAMES.state,
          details: { state: next },
        };
      });
    },
  }),
];
