/**
 * md 资料的写入原语：区段追加、区段替换、保行断言。
 *
 * 追加式的实现是「先读、定位锚点、插入、整体覆盖写」—— 看起来像重写，
 * 因为原子写只能整体替换。校验层因此必须断言「原有行全部保留」，
 * 否则这就不是追加式，只是看起来像。
 *
 * 断言用**非空行的子序列比对**而非行数比对：
 * - 行数比对无效 —— 删一行加一行也能保持行数不变，而那正是最该被抓住的偷改；
 * - 空行不参与比对 —— 插入操作会重组区段边界的空行，把它们算进去只会误报。
 */

import { readText, writeTextAtomic } from "./io.ts";
import { DataError } from "./errors.ts";

const SECTION_PATTERN = /^##\s+(.+?)\s*$/;

export type SectionOp =
  /** 追加：原有非空行必须全部保留（追加式区段）。 */
  | { kind: "append"; title: string; lines: readonly string[] }
  /** 替换：区段内容整体换掉（覆盖式区段，如「当前描述」）。 */
  | { kind: "replace"; title: string; lines: readonly string[] };

interface SectionRange {
  start: number;
  end: number;
}

/** 定位一级区段 `## <title>` 的行范围：含标题行，不含下一个 `## `。 */
function locate(lines: readonly string[], title: string): SectionRange | null {
  const start = lines.findIndex((line) => {
    const matched = SECTION_PATTERN.exec(line);
    return matched !== null && matched[1] === title;
  });
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_PATTERN.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** 读一个区段的内容行（不含标题行）。区段不存在返回 null。 */
export function readSection(text: string, title: string): string[] | null {
  const range = locate(text.split("\n"), title);
  if (range === null) return null;
  return text.split("\n").slice(range.start + 1, range.end);
}

/** 剥掉某个区段及其后的全部内容。用于防止覆盖式写入吃掉追加式区段。 */
export function stripSection(text: string, title: string): string {
  const lines = text.split("\n");
  const range = locate(lines, title);
  if (range === null) return text;
  return [...lines.slice(0, range.start), ...lines.slice(range.end)].join("\n");
}

/**
 * 按顺序施加若干区段操作，返回新文本。不落盘 —— 调用方决定何时写。
 *
 * 任何 op 找不到区段都直接抛错，**不新建区段**：区段消失说明文件结构已被破坏
 * （用户手工删掉了标题，或被别的工具改写过），自动补一个空区段会让后面
 * 所有依据都建立在这个假结构上。
 */
export function applySectionOps(text: string, ops: readonly SectionOp[], label: string): string {
  let lines = text.split("\n");
  for (const op of ops) {
    const range = locate(lines, op.title);
    if (range === null) {
      throw new DataError(
        `${label} 里找不到区段「## ${op.title}」。结构可能已被破坏，请用户确认后再写。`,
      );
    }
    const oldBody = lines.slice(range.start + 1, range.end);

    if (op.kind === "append") {
      let insertAt = range.end;
      while (insertAt > range.start + 1 && (lines[insertAt - 1] ?? "").trim() === "") insertAt--;
      const next = [...lines.slice(0, insertAt), ...op.lines, ...lines.slice(insertAt)];
      const nextRange = locate(next, op.title);
      const newBody = nextRange === null ? [] : next.slice(nextRange.start + 1, nextRange.end);
      assertPreserved(oldBody, newBody, label, op.title);
      lines = next;
    } else {
      // 区段内容整体换掉。先把区段后面原有的空行吃掉，再补一个，
      // 否则反复替换会让空行越积越多。
      let end = range.end;
      while (end < lines.length && (lines[end] ?? "").trim() === "") end++;
      lines = [
        ...lines.slice(0, range.start + 1),
        ...op.lines,
        "",
        ...lines.slice(end),
      ];
    }
  }
  return lines.join("\n");
}

/** 往区段末尾追加若干行（读文件 → 施加 → 原子写）。 */
export function appendUnderSection(path: string, title: string, additions: readonly string[]): void {
  const text = readText(path);
  if (text === null) throw new DataError(`文件不存在：${path}`);
  writeTextAtomic(path, applySectionOps(text, [{ kind: "append", title, lines: additions }], path));
}

/**
 * 断言原有非空行全部按原顺序保留。
 *
 * 判据是「原有非空行序列是新区段非空行序列的子序列」：只要 before 的每一行
 * 都能在 after 里按序找到，就没有行被删掉或改写。插入新行不影响判定。
 */
export function assertPreserved(
  before: readonly string[],
  after: readonly string[],
  path: string,
  what: string,
): void {
  const expected = before.filter((line) => line.trim() !== "");
  const actual = after.filter((line) => line.trim() !== "");
  let cursor = 0;
  for (const line of actual) {
    if (cursor < expected.length && line === expected[cursor]) cursor++;
  }
  if (cursor === expected.length) return;
  throw new DataError(
    `追加式写入被拒绝：原有内容有 ${expected.length - cursor} 行在写入后消失或被改动了` +
      `（${path} 的「${what}」区段）。这是数据损坏级信号，已放弃写入。`,
  );
}

/**
 * 合成一份「标题 + 正文 + 若干区段」的 md 文本。区段按传入顺序输出。
 *
 * 空正文不会留下多余空行：反复重写同一份文档时，空行会越积越多，
 * 而频出的空行会让「两个文件内容是否一致」这种比对变成噪声。
 */
export function composeDoc(
  title: string,
  body: string,
  sections: ReadonlyArray<{ title: string; lines: readonly string[] }>,
): string {
  const parts = [`# ${title}`];
  const trimmed = body.trim();
  if (trimmed !== "") parts.push("", trimmed);
  for (const section of sections) {
    parts.push("", `## ${section.title}`, ...section.lines);
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

/** 读区段并丢掉空行，用于「覆盖式重建时保留追加式区段」。 */
export function readSectionLines(text: string, title: string): string[] {
  return (readSection(text, title) ?? []).filter((line) => line.trim() !== "");
}

/** 本地时间戳 `YYYY-MM-DD HH:mm`。用于大纲修订与章节确认记录。 */
export function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 一行追加记录的统一格式：`- [CH-007] 内容`。章节号 0 表示设定期。 */
export function chapterLine(chapter: number, text: string): string {
  return `- [CH-${String(chapter).padStart(3, "0")}] ${text}`;
}
