/**
 * 机械范围检查：去 AI 味只该动**表达层**，这段代码检查它有没有越界。
 *
 * 为什么值得单独做：改稿之后只重查 F / G（见 docs/design/pipeline.md
 * 「去 AI 味之后必须重查」），**事实层不再过审**。没有这道防线，
 * 「去 AI 味悄悄改了设定或人名」就没人会发现。
 *
 * 判据是机械的（不需要语义理解）：
 * - 某个专有名词**改后新出现**或**改前有而改后没了** → 越界；
 * - 段落里的**数字数量变了** → 越界（数字是最容易在「润色」时被改写的事实）。
 *
 * 正常的改写会保留人名、术语、数字，只是换个说法 —— 所以这两条判据误报很低。
 */

import { listCharacters } from "../../data/characters.ts";
import { listSettings } from "../../data/settings.ts";
import type { OpenNovel } from "../../data/novel.ts";

export interface ScopeHit {
  paragraph: number;
  /** 新增的专有名词。 */
  added: string[];
  /** 丢失的专有名词。 */
  removed: string[];
  /** 数字数量是否变了。 */
  numbersChanged: boolean;
}

export interface ScopeReport {
  hits: ScopeHit[];
  /** 段落数变了（改写合并/拆分了段落），无法逐段对比。 */
  paragraphCountChanged: boolean;
}

/** 收集「不该被改」的专有名词：人物名与别名、设定条目名。 */
export function collectProperNouns(novel: OpenNovel): string[] {
  const names = [
    ...listCharacters(novel.root).flatMap((entry) => [entry.name, ...entry.aliases]),
    ...listSettings(novel.root).map((entry) => entry.name),
  ];
  // 短的（单字名）会误报，去掉。
  return [...new Set(names.filter((name) => [...name].length >= 2))];
}

export function scanDeaiScope(options: {
  before: string;
  after: string;
  properNouns: readonly string[];
}): ScopeReport {
  const before = splitParagraphs(options.before);
  const after = splitParagraphs(options.after);

  // 段数不同说明改写合并或拆分了段落 —— 逐段对比不成立，只能如实标注。
  if (before.length !== after.length) {
    return { hits: [], paragraphCountChanged: true };
  }

  const hits: ScopeHit[] = [];
  for (let index = 0; index < before.length; index += 1) {
    const from = before[index] ?? "";
    const to = after[index] ?? "";
    if (from === to) continue;

    const fromNouns = new Set(options.properNouns.filter((noun) => from.includes(noun)));
    const toNouns = new Set(options.properNouns.filter((noun) => to.includes(noun)));
    const added = [...toNouns].filter((noun) => !fromNouns.has(noun));
    const removed = [...fromNouns].filter((noun) => !toNouns.has(noun));
    const numbersChanged = countNumbers(from) !== countNumbers(to);

    if (added.length > 0 || removed.length > 0 || numbersChanged) {
      hits.push({ paragraph: index + 1, added, removed, numbersChanged });
    }
  }

  return { hits, paragraphCountChanged: false };
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((block) => block.trim());
}

/** 阿拉伯数字与中文数字都算。 */
/** 阿拉伯数字与**中文数字**都算，**但排除单字「一」**。
 *
 * 中文数字必须算：「三章前」改成「两天前」是典型的「润色时改了事实」，
 * 而那两句里一个阿拉伯数字都没有。
 *
 * **为什么去掉「一」**：真实运行里它把「这不是**一**次意外」「**一**旦听懂」当成了数字，
 * 一段改稿里误报 3 次。而「一」在中文里作量词/副词/连词的频率远高于作数量，
 * 而「三」「两」基本就是数量。**一个总在误报的检查等于没有检查** —— 用户会很快
 * 学会忽略它，那时真正的越界也一起被忽略。
 */
function countNumbers(text: string): number {
  const arabic = text.match(/\d+/g)?.length ?? 0;
  const chinese = text.match(/[零二三四五六七八九十百千万亿两]+/g)?.length ?? 0;
  return arabic + chinese;
}

/** 供报告渲染：这段检查发现了多少问题。 */
export function scopeWarningCount(report: ScopeReport): number {
  return report.hits.length + (report.paragraphCountChanged ? 1 : 0);
}
