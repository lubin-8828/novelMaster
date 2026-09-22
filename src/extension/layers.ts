/**
 * 层面（layer）定义、命令表与当前层面状态。
 *
 * 「层面」= 用户在哪个视角工作。它和章状态机（state.json 的 chapterStatus）
 * 是两个正交的维度：层面管"用户在做什么"，章状态管"这一章走到哪一步"。
 * 不要把它们合成一个枚举。
 *
 * ── 为什么命令表拆成两张 ──
 * COMMANDS 只描述命令自身（说明、里程碑），LAYER_COMMAND_ORDER 只描述
 * 命令出现在哪些层面、按什么顺序。分开的直接好处：一个命令跨多层出现时
 * 只定义一次，注册时也只注册一次 —— 否则同名命令会被 pi 后缀化成
 * /brainstorm:1、/brainstorm:2，用户看到的就是坏掉的命令名。
 */

export const CMD = {
  help: "help",
  back: "back",
  init: "init",
  setting: "setting",
  person: "person",
  outline: "outline",
  event: "event",
  write: "write",
  next: "next",
  context: "context",
  review: "review",
  deai: "deai",
  done: "done",
  brainstorm: "brainstorm",
} as const;

export type CmdName = (typeof CMD)[keyof typeof CMD];

export type Layer = "menu" | "setting" | "person" | "outline" | "event" | "write";

export interface LayerSpec {
  label: string;
  /** 一句话说明这一层做什么（用于 /help 与状态栏）。 */
  blurb: string;
  /**
   * 注入系统提示词的层面规则。空字符串表示不注入。
   * 这条文本是「每层只装载该层数据」的落点：AI 在这一层只知道这一层的事。
   */
  rules: string;
}

export const LAYERS: Record<Layer, LayerSpec> = {
  menu: {
    label: "主菜单",
    blurb: "选择要进入的层面",
    rules: "",
  },
  setting: {
    label: "设定",
    blurb: "维护世界观设定条目",
    rules: [
      "你处在「世界观设定层」。",
      "本层只讨论与维护世界观设定条目：世界规则（world_rule）、地点（location）、势力（faction）、物品（item）、禁忌（taboo）。",
      "不要写正文，不要改大纲或事件。",
      "数据位置：setting/index.json 是索引，setting/S-xxx.md 是条目详述。ID 形如 S-001，一经分配永不复用；废弃条目改为 deprecated 而不是删除（历史审查报告可能引用它）。",
      "每次落盘后，把工具返回的变更摘要（改了什么、从什么变成什么）**原样**汇报给用户。不要只说「已更新」，也不要自己重写摘要 —— 那段摘要就是用户用来判断「改动对不对」的依据。",
    ].join("\n"),
  },
  person: {
    label: "人物",
    blurb: "维护人物档案与人物关系",
    rules: [
      "你处在「人物层」。",
      "本层维护三类东西：人物的静态档案（性格、外貌、目标、说话习惯）、人物的关键事件时间轴、人物之间的关系。",
      "静态档案是「当前结论」，可以直接修正笔误；时间轴和关系变更史是「历史事实」，只追加、不修改。",
      "时间轴只记关键事件，不记流水账。",
      "数据位置：characters/index.json（档案与状态）、characters/C-xxx.md（时间轴）、relations.json（关系）。",
      "每次落盘后，把工具返回的变更摘要**原样**汇报给用户（同设定层的约定）。",
    ].join("\n"),
  },
  outline: {
    label: "大纲",
    blurb: "建立与修改故事主线大纲",
    rules: [
      "你处在「故事大纲层」。",
      "本层只讨论主线结构：一句话主题、阶段划分、主要冲突、结局走向。不要写正文，不要细化到章节。",
      "创建大纲必须与用户交互进行 —— 逐段提出、逐段确认，不要一次性产出一份完整大纲让用户被动接受。",
      "推鑫定的一句话简介用 novel_meta_update 写进 logline；视角（pov）与时态（tense）也在本层定下，它们是审查判定「视角越界」「人称漂移」的依据，不要留空。",
      "大纲正文用 novel_outline_write 覆盖写入（它会原样保留底部的「修订记录」）；每次修改再往修订记录追加一行。",
      "每次落盘后，把工具返回的变更摘要**原样**汇报给用户（同设定层的约定）。",
      "数据位置：outline.md（正文 + 修订记录）、meta.json（logline / pov / tense）。",
    ].join("\n"),
  },
  event: {
    label: "事件",
    blurb: "推演与细化剧情事件",
    rules: [
      "你处在「事件推演层」。",
      "本层把大纲落成具体事件：推演、确认、细化、关联章节。",
      "事件有「当前描述」和「细化历史」两段：当前描述永远是最新最细的版本，每次细化把旧描述压进历史。",
      "伏笔不是特殊结构，它就是 origin=foreshadow 的事件：status=planned 表示已埋未收，done 表示已回收。",
      "推演结果必须经用户确认才能写入，不要自动落盘。一个事件可以铺很多章。",
      "数据位置：events/index.json（列表）、events/E-xxx.md（当前描述与细化历史）。",
    ].join("\n"),
  },
  write: {
    label: "写作",
    blurb: "写章节并走完审查、去 AI 味、验收、回填闭环",
    rules: [
      "你处在「写作模式」。",
      "每一章必须走完这条流水线，不得跳步：",
      "推演本章大纲 → 用户确认 → 生成正文 → 审查 → 去 AI 味 → 用户验收 → 回填资料 → 清空上下文。",
      "用户确认之前的任何一步都不算数。用户没有明确说通过，就不要推进到下一步。",
    ].join("\n"),
  },
};

export interface CommandMeta {
  desc: string;
  /** 未实现的能力标注交付里程碑；已实现则省略。 */
  milestone?: number;
}

/** 命令自身的信息。与"出现在哪些层面"无关，所以一条命令只写一次。 */
export const COMMANDS: Record<CmdName, CommandMeta> = {
  [CMD.help]: { desc: "显示当前层面可用命令" },
  [CMD.back]: { desc: "返回主菜单" },
  [CMD.init]: { desc: "新建一本小说（书名 / 类型 / 核心想法）" },
  [CMD.setting]: { desc: "进入设定层" },
  [CMD.person]: { desc: "进入人物层" },
  [CMD.outline]: { desc: "进入大纲层" },
  [CMD.event]: { desc: "进入事件层" },
  [CMD.write]: { desc: "进入写作模式" },
  [CMD.context]: { desc: "打印本章上下文包（喂给 AI 了什么）", milestone: 6 },
  [CMD.next]: { desc: "推演下一章大纲，交你确认", milestone: 7 },
  [CMD.review]: { desc: "审查（章末自动触发，也可手动补跑）", milestone: 8 },
  [CMD.deai]: { desc: "去 AI 味（章末自动触发，也可手动补跑）", milestone: 9 },
  [CMD.done]: { desc: "验收通过：落盘 + 回填资料 + 清空上下文", milestone: 10 },
  [CMD.brainstorm]: { desc: "按你给定的方向起多 agent 头脑风暴", milestone: 11 },
};

/** 每个层面的命令清单与显示顺序。这是"命令出现在哪里"的唯一来源。 */
export const LAYER_COMMAND_ORDER: Record<Layer, CmdName[]> = {
  menu: [CMD.init, CMD.setting, CMD.person, CMD.outline, CMD.event, CMD.write, CMD.help],
  setting: [CMD.help, CMD.back],
  person: [CMD.help, CMD.back],
  outline: [CMD.brainstorm, CMD.help, CMD.back],
  event: [CMD.brainstorm, CMD.help, CMD.back],
  write: [CMD.context, CMD.next, CMD.review, CMD.deai, CMD.brainstorm, CMD.done, CMD.help, CMD.back],
};

export interface ResolvedCommand extends CommandMeta {
  name: CmdName;
}

export function commandsForLayer(layer: Layer): ResolvedCommand[] {
  return LAYER_COMMAND_ORDER[layer].map((name) => ({ name, ...COMMANDS[name] }));
}

/** 需要向 pi 注册的全部命令名。按 COMMANDS 的键去重，注册不可能重复。 */
export const ALL_COMMANDS = Object.keys(COMMANDS) as CmdName[];

function isLayerName(name: string): name is Layer {
  return Object.hasOwn(LAYERS, name);
}

/**
 * 层面入口命令所指向的层面。
 * 由"主菜单里出现了哪些层面名"推出，而不是另外维护一张映射表 ——
 * 入口命令名与层面名同形（/outline → outline），所以这层推导是安全的。
 */
export const ENTRY_LAYERS = LAYER_COMMAND_ORDER.menu.filter(
  (name: string): name is Exclude<Layer, "menu"> => isLayerName(name) && name !== "menu",
);

let currentLayer: Layer = "menu";

export function getLayer(): Layer {
  return currentLayer;
}

export function setLayer(layer: Layer): void {
  currentLayer = layer;
}
