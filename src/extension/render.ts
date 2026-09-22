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

/**
 * `/next` 的任务段。
 *
 * 两件事：把上下文交给 AI，把「这一回合要产出什么」说清楚。
 *
 * **不把「等用户确认」写成流程控制** —— 那是对话里的事实，不是代码状态。
 * 命令只说清「做完要等确认」，确认本身由用户的话决定。
 */
export function renderNextTask(bundle: ContextBundle): string {
  const lines = [
    `【任务】推演第 ${chapterNo(bundle.chapter)} 章的章节大纲`,
    "",
    "要求：",
    "1. 大纲开头写结构化头块 —— 它决定这套上下文包下次会带入哪些人物与设定：",
    "",
    "   <!-- novelmaster:outline",
    "   characters: [C-001, ...]",
    "   settings: [S-001, ...]",
    "   events: [E-003]",
    "   primaryEvent: E-003",
    "   -->",
    "",
    "2. 头块之后写大纲正文：本章推进什么、在哪里结束、留什么悬念。",
    "3. 用 novel_chapter_outline_write 落盘，**不要传 confirmNote**（那是用户确认后才写的）。",
    "4. 落盘后把大纲完整呈现给用户，等他的修改意见。**不要说「已确认」** —— 确认与否由用户说。",
    "",
    "以下是本章的上下文包（第 9 段「本章大纲」现在是空的，因为还没写）：",
    "",
  ];
  bundle.segments.forEach((segment, index) => {
    lines.push(`【${index + 1}】${segment.title}`, "", segment.content, "");
  });
  return lines.join("\n");
}

/**
 * `/brainstorm <方向>` 的任务段。
 *
 * 命令只做两件事：校验用户**给了方向**（硬约束：没有方向不启动），
 * 以及把「设计视角」交给主会话 —— 它刚跟用户聊过，比我更知道「这几条线」指什么。
 */
export function renderBrainstormTask(angle: string): string {
  return [
    "【任务】多 agent 讨论（脑暴）",
    "",
    `用户给的方向：${angle}`,
    "",
    "请你：",
    "1. **自行设计 2–6 个视角**（每个含 `name` 与 `focus`）。角度要切得开 ——",
    "   不要给两个同义的视角，那等于只有一个。",
    "2. 调 `novel_brainstorm` 起讨论（参数 `angle` + `perspectives`）。",
    "3. 拿到各角色的产出后，**你来综合**：共识 / 真实分歧 / 被忽略的选项 / 新暴露的假设。",
    "   **不要投票决定取舍** —— 分歧本身就是要给用户看的东西。",
    "",
    "注意：讨论角色是只读的，它们不会改任何文件（讨论是材料，不是数据）。",
    "如果你认为这个方向需要先补充资料（人物 / 设定）才能真正讨论，先说清这一点，而不是编。",
  ].join("\n");
}

/**
 * `/init` 的任务段：建书引导。
 *
 * 命令不弹表单，把建书交给对话（见 docs/design/interaction.md「建书」）。
 * 核心约束：premise 用用户原话；用户点头前不得调 novel_init。
 */
export function renderInitTask(): string {
  return [
    "【任务】引导用户新建一本小说",
    "",
    "用对话访谈的方式收集建书信息，像编辑一样引导，不要一次甩出所有问题：",
    "",
    "1. 先问书名。用户可能没有 —— 可以先取个占位名，以后能改（改书名是另一项操作）。",
    "2. 问类型（可留空）：科幻 / 悬疑 / 言情 / 历史……",
    "3. 问核心想法 —— 这是最关键的一步。用户往往只有一个模糊念头，用追问帮他说清楚：",
    "   - 什么时代、什么世界背景？",
    "   - 这是谁的故事？主角想要什么、怕什么？",
    "   - 最想写的一个画面 / 场景是什么？",
    "   - 你希望读者看完感受到什么？",
    "   一轮最多两三个问题，跟着用户的回答走，不要审问式连问。",
    "4. 收集齐后回显整理结果（书名 / 类型 / 核心想法），等用户确认。",
    "   **用户点头前不得调用 novel_init** —— 他说「可以」「行」才算确认。",
    "5. 用户确认后调 novel_init(title, genre, premise)。",
    "   premise 用用户的**原话**，不要改写、不要扩写 —— 它是一切推断的根。",
    "6. 建书成功后转述结果，并提示下一步：/outline 进入大纲层搭主线。",
    "7. 用户中途说「算了」就停下，不要建书。",
  ].join("\n");
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
