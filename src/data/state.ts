/**
 * 章状态机。
 *
 * 这张转移表是「哪些转移合法」的**唯一来源**（docs/design/pipeline.md「转移表」）。
 * 图是给人看的，表是给代码用的 —— 两者不一致时以表为准并修正图。
 *
 * 为什么这个校验必须存在：状态机是 `/done` 闸门的执行体。如果它可被 LLM 绕过，
 * 闸门就不存在 —— 提示词约束挡不住一个想抄近路的模型，schema 校验才能。
 */

import { DataError } from "./errors.ts";
import { NAMES, statePath } from "./paths.ts";
import { writeDoc } from "./doc.ts";
import { openNovelAt } from "./novel.ts";
import { syncChapterStatus } from "./chapters.ts";
import { NovelStateSchema, type ChapterStatus } from "./schema.ts";

export const TRANSITIONS: Record<ChapterStatus, readonly ChapterStatus[]> = {
  not_started: ["outlined"],
  outlined: ["drafted"],
  drafted: ["auto_reviewed"],
  auto_reviewed: ["deai_done"],
  deai_done: ["awaiting_user_review"],
  // 用户手改 → user_edited；用户让 AI 改 → ai_revised；用户没改直接回填 → reflowed。
  // 第三条不要求经过 user_edited：回填是把本章进展落到资料层，跟用户改没改正文无关。
  awaiting_user_review: ["user_edited", "ai_revised", "reflowed"],
  user_edited: ["reflowed"],
  // 不是直接回 awaiting_user_review：AI 改的是正文，改过的正文还没被审查过，
  // 直接跳回「待验收」等于告诉用户「这一版审查过了」，而那是假的。
  ai_revised: ["auto_reviewed"],
  reflowed: ["awaiting_user_review", "accepted"],
  accepted: ["not_started"],
};

export function canTransition(from: ChapterStatus, to: ChapterStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * 开始下一章：仅当上一章已 `accepted`。
 *
 * 与 `advanceStatus` 分开，因为它连章号一起推 —— 而「下一章开始了吗」是独立于
 * 「上一章结了吗」的另一个事实（用户 `/done` 之后可能今天就停下）。
 *
 * 同时清掉 `currentEventId`：那是**上一章**的主事件，不带到新章。
 */
export function startNextChapter(root: string): number | null {
  const fresh = openNovelAt(root);
  if (fresh === null || fresh.state.chapterStatus !== "accepted") return null;
  assertTransition("accepted", "not_started");
  const next = fresh.state.currentChapter + 1;
  writeDoc(
    statePath(root),
    NovelStateSchema,
    { ...fresh.state, currentChapter: next, chapterStatus: "not_started", currentEventId: null },
    NAMES.state,
  );
  syncChapterStatus(root, next, "not_started");
  return next;
}

/**
 * 按「当前状态必须等于 `from`」推进到 `to`；不符就**什么都不做**。
 *
 * 为什么每次都重新读盘：调用方手里的 `novel` 是快照。流水线里一次工具调用可能连推两步
 * （如 `auto_reviewed → deai_done → awaiting_user_review`），拿旧快照判断会把第二步挡掉。
 *
 * 「不等就跳过」而非报错，是为手动补跑：`/review`、`/deai` 可以在任意状态下跑，
 * 那时只产出报告、不改状态。
 */
export function advanceStatus(root: string, chapter: number, from: ChapterStatus, to: ChapterStatus): boolean {
  const fresh = openNovelAt(root);
  if (fresh === null || fresh.state.chapterStatus !== from) return false;
  assertTransition(from, to);
  writeDoc(statePath(root), NovelStateSchema, { ...fresh.state, chapterStatus: to }, NAMES.state);
  syncChapterStatus(root, chapter, to);
  return true;
}

/**
 * 非法转移直接抛错，错误文本里必须含「当前状态、目标状态、当前允许的目标」。
 *
 * 只说「非法转移」的错误文本对 LLM 没有修正价值 —— 它不知道往哪走才是对的。
 */
export function assertTransition(from: ChapterStatus, to: ChapterStatus): void {
  if (from === to) {
    throw new DataError(
      `章状态没有变化（仍为 ${from}）。状态转移是一条边，不是「设为某值」；` +
        `同状态重复转移说明调用方逻辑有误，因此拒绝而不是静默成功。`,
    );
  }
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    throw new DataError(
      `非法的章状态转移：${from} → ${to}。` +
        `${from} 只允许转移到：${allowed.length > 0 ? allowed.join("、") : "（无）"}。`,
    );
  }
}
