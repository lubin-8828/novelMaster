/**
 * 讨论角色的输入包。
 *
 * 基线（所有角色相同）+ 视角（每个角色不同）。规格见 docs/design/ai.md「多 agent 讨论」。
 */

import { readOutlineBody } from "../../data/outline.ts";
import { listEvents } from "../../data/events.ts";
import type { OpenNovel } from "../../data/novel.ts";

export interface RoleSpec {
  /** 视角名，如「结构视角」。 */
  name: string;
  /** 这个视角关心什么。 */
  focus: string;
}

/**
 * 基线：所有角色看到同样的东西。
 *
 * **刻意不含设定条目、人物档案、章节正文。** 判据与审查不同：讨论是探索性的，
 * 而角色手里有 `read` / `novel_read_index`，需要时自己取（见 `ai.md`）。
 */
export function renderBaseline(novel: OpenNovel): string {
  const events = listEvents(novel.root);
  const lines = [
    `《${novel.meta.title}》`,
    `小说根目录（绝对路径）：${novel.root}`,
    `类型：${novel.meta.genre.join("、") || "（未定）"}`,
    `核心想法（用户原文，未经改写）：${novel.meta.premise}`,
    `一句话简介：${novel.meta.logline === "" ? "（未定）" : novel.meta.logline}`,
    `视角 / 时态：${novel.meta.pov} / ${novel.meta.tense}`,
    "",
    "【主线大纲】",
    "",
    readOutlineBody(novel.root) ?? "（无）",
    "",
    `【事件清单（${events.length} 条）】`,
    "",
  ];

  if (events.length === 0) {
    lines.push("（尚未推演出事件）");
  } else {
    for (const event of events) {
      lines.push(`- ${event.id} [${event.stage}] ${event.title}（${event.status}，${event.origin}）`);
    }
  }
  return lines.join("\n");
}

/** 把基线 + 方向 + 视角拼成一个角色的完整输入。 */
export function renderRolePrompt(baseline: string, angle: string, role: RoleSpec): string {
  return [
    baseline,
    "",
    `【本次讨论方向】${angle}`,
    "",
    `【你的视角】${role.name} —— ${role.focus}`,
    "",
    "只从你的视角给出判断。**不要试图平衡各方观点** —— 平衡是父层的事，你只需要把你看见的东西说透。",
    "想不到的风险、被忽略的选项、站不住的假设，都在你的视角里说。",
    "",
    "结论用 submit_brainstorm 提交（不要只在对话里说）。",
  ].join("\n");
}

/**
 * 角色的系统提示词。
 *
 * 与审查员同样的理由：**人格必须是确定的**，所以整段替换系统提示词，
 * 且不追加项目规则（见 `session.ts`）。
 */
export function renderRoleSystemPrompt(role: RoleSpec): string {
  return [
    `你是小说创作讨论中的一个独立角色。你的视角是「${role.name}」：${role.focus}。`,
    "",
    "规则：",
    "- 只谈结构与因果，不写正文、不写具体台词。",
    "- 每个判断都要给出理由。只有结论没有理由的观点对用户没有价值。",
    "- 与主流意见相左时**照直说** —— 讨论的价值在于暴露分歧，不是达成一致。",
    "- 需要查资料时用 read / novel_read_index 自己查，不要凭印象编设定。",
    "- 最后必须调用 submit_brainstorm 提交结论。",
  ].join("\n");
}
