/**
 * humanizer skill 的注入。
 *
 * **读文件内容，不让模型自主加载 skill。**
 *
 * 根因：本项目要求去 AI 味**必然发生**，而 skill 自主加载是模型驱动的 ——
 * 模型这章想不起来加载，去 AI 味就静默跳过了，而用户无法从结果上分辨
 * 「这章做过去 AI 味」与「这章模型忘了」。显式注入让「做没做」变成代码事实，
 * 而不是模型的心情（见 docs/design/ai.md「humanizer 的注入方式」）。
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HUMANIZER_SKILL_PATH = join(homedir(), ".pi", "agent", "skills", "humanizer", "SKILL.md");

/**
 * 读 skill 正文。读不到返回 null —— 调用方应当**报错而不是静默跳过**。
 *
 * `path` 可注入：测试用临时假 skill 文件，不依赖用户全局目录里恰好装了这个
 * skill（见 docs/design/decisions.md「踩坑记录」4.9）。
 */
export function readHumanizerSkill(path: string = HUMANIZER_SKILL_PATH): string | null {
  try {
    return stripFrontmatter(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** 去掉 YAML frontmatter：那是给 pi 的 skill 系统读的元数据，不是给模型的指令。 */
function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? text : text.slice(end + 4).trim();
}
