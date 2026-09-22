import { LAYERS, commandsForLayer, type Layer, type ResolvedCommand } from "./layers.ts";
import type { ChapterStatus } from "../data/schema.ts";
import type { ContextBundle, Segment } from "../ai/context-assembler.ts";
import { charCount, padDisplay, padDisplayStart } from "../ai/tokens.ts";
import { chapterNo } from "../data/ids.ts";

/** 章状态的中文标签。放在这里而不是散在代码里，保证状态栏与报告口径一致。 */
export const CHAPTER_STATUS_LABEL: Record<ChapterStatus, string> = {
  not_started: "未开始",
  outlined: "大纲已确认",
  drafted: "正文已生成",
  auto_reviewed: "已审查",
  deai_done: "已去 AI 味",
  awaiting_user_review: "待你验收",
  user_edited: "你已改稿",
  reflowed: "资料已回填",
  ai_revised: "AI 已改稿",
  accepted: "已完成",
};

function commandLine(cmd: ResolvedCommand): string {
  const suffix = cmd.milestone === undefined ? "" : `  ← 待实现（里程碑 ${cmd.milestone}）`;
  return `  /${cmd.name.padEnd(12)}${cmd.desc}${suffix}`;
}

/** 注入系统提示词的层面段。告诉 AI 它在哪一层、能做什么、不能做什么。 */
export function renderLayerSection(layer: Layer): string {
  const spec = LAYERS[layer];
  const cmds = commandsForLayer(layer)
    .filter((c) => c.milestone === undefined)
    .map((c) => `/${c.name}`)
    .join(" ");

  return [
    `当前层面：${spec.label}（${spec.blurb}）`,
    "",
    spec.rules,
    "",
    `本层当前已实现的命令：${cmds}`,
  ].join("\n");
}

/** 每段在 `/context` 里默认展开的行数。 */
export const CONTEXT_PREVIEW_LINES = 12;

/**
 * `/context` 的输出。
 *
 * 两步：先一张总表（每段多大、来自哪），再按段展开。
 * 总表回答「这章上下文多大、大在哪」，展开回答「它具体给了我什么」。
 *
 * `focus` 给出时只展开那一段的**全文**（按序号 / key / 标题匹配）。
 * 要逐字看某段又不想敲参数时，直接 `read` 那个来源文件即可 —— 内容本来就来自磁盘。
 */
export function renderContext(bundle: ContextBundle, focus?: string, previewLines = CONTEXT_PREVIEW_LINES): string {
  const totalChars = bundle.segments.reduce((sum, item) => sum + charCount(item.content), 0);
  const head = [
    `本章上下文包（第 ${chapterNo(bundle.chapter)} 章）—— ${bundle.segments.length} 段，` +
      `共约 ${bundle.totalEstimatedTokens} tokens（${totalChars} 字）`,
    "",
  ];

  bundle.segments.forEach((item, index) => {
    const number = padDisplayStart(String(index + 1), 2);
    const title = padDisplay(item.title, 16);
    const tokens = padDisplayStart(String(item.estimatedTokens), 6);
    const chars = padDisplayStart(String(charCount(item.content)), 7);
    head.push(`  ${number}. ${title} 约${tokens} tokens（${chars} 字）  ${sourceLabel(item)}`);
  });

  if (focus !== undefined && focus !== "") {
    const picked = pickSegment(bundle.segments, focus);
    if (picked === null) {
      return [
        ...head,
        "",
        `没有匹配「${focus}」的段。可用的段：`,
        ...bundle.segments.map((item, index) => `  ${index + 1}. ${item.key}（${item.title}）`),
      ].join("\n");
    }
    return [...head, "", `【${picked.title}】（全文）`, "", picked.content].join("\n");
  }

  bundle.segments.forEach((item, index) => {
    const all = item.content.split("\n");
    head.push("", `【${index + 1}】${item.title}`, "");
    head.push(...all.slice(0, previewLines));
    if (all.length > previewLines) {
      head.push(`…（共 ${all.length} 行，只显示前 ${previewLines} 行；用 /context ${item.key} 看全文）`);
    }
  });

  return head.join("\n");
}

function sourceLabel(item: Segment): string {
  if (item.sources.length === 0) return "（无来源）";
  const first = item.sources[0] ?? "";
  return item.sources.length === 1 ? first : `${first} 等 ${item.sources.length} 个`;
}

/** 按序号 / key / 标题匹配段。序号从 1 开始，与总表一致。 */
function pickSegment(segments: readonly Segment[], focus: string): Segment | null {
  const index = Number(focus);
  if (Number.isInteger(index) && index >= 1 && index <= segments.length) {
    return segments[index - 1] ?? null;
  }
  return segments.find((item) => item.key === focus || item.title === focus) ?? null;
}

/** 注入系统提示词的项目段。描述小说数据布局与硬规则。 */
export function renderProjectSection(novelRoot: string, title: string): string {
  return [
    `当前打开的小说：《${title}》`,
    `根目录：${novelRoot}`,
    "",
    "数据布局：",
    "- meta.json          小说元信息（类型 / 简介 / 人称 / 时态）",
    "- state.json         进度指针与章状态机（唯一进度真相，不要手动改）",
    "- outline.md         故事主线大纲",
    "- setting/index.json 设定条目索引；setting/S-xxx.md 条目详述",
    "- characters/index.json 人物档案与状态；characters/C-xxx.md 人物时间轴",
    "- relations.json     人物关系（当前状态 + 变更历史）",
    "- events/index.json  事件列表；events/E-xxx.md 事件当前描述与细化历史",
    "- chapters/index.json 章节索引；chapters/NNN.* 每章的正文与各类报告",
    "- inbox.md           想法收集箱（只增不改）",
    "",
    "硬规则：",
    "1. 正文是纯文本 txt，禁止 markdown 语法（# 、** 、> 、反引号、行首列表符号）。",
    "2. 追加式文件（人物时间轴、事件细化历史、关系变更史、inbox）只增不改：改写历史等于伪造依据。",
    "3. 结构化 JSON 不要直接编辑，等专用写入工具交付后走工具（里程碑 2）。",
    "4. 不许编造依据：引用设定、人物、事件时必须用真实存在的 ID。",
  ].join("\n");
}

/** /help 的输出。 */
export function renderHelp(layer: Layer, novel: { title: string; root: string } | null): string {
  const spec = LAYERS[layer];
  const lines = [
    `【${spec.label}】${spec.blurb}`,
    "",
    "可用命令：",
    ...commandsForLayer(layer).map(commandLine),
    "",
    novel ? `当前小说：《${novel.title}》\n根目录：${novel.root}` : "当前没有打开的小说。用 /init 新建一本。",
    "",
    "提示：直接说话会交给 AI；以 / 开头的是命令。",
  ];
  if (layer !== "menu") lines.push("/back 返回主菜单。");
  return lines.join("\n");
}

/** 状态栏文本。 */
export function renderStatus(
  layer: Layer,
  novel: { title: string } | null,
  chapter: { no: number; status: ChapterStatus } | null,
): string {
  const parts = [`【${LAYERS[layer].label}】`];
  if (novel) parts.push(`《${novel.title}》`);
  if (chapter) parts.push(`第 ${chapter.no} 章 · ${CHAPTER_STATUS_LABEL[chapter.status]}`);
  return parts.join(" ");
}
