/**
 * 层面测试：索引摘要的装载、注入给 AI 与给用户看的是不是同一份。
 *
 * 入口是 tests/all.ts。
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { check, section } from "./harness.ts";
import { novelMasterExtension } from "../src/extension/index.ts";
import { loadLayerData, renderLayerData } from "../src/extension/layer-data.ts";
import { setLayer, type Layer } from "../src/extension/layers.ts";
import { initNovel } from "../src/data/init.ts";
import { openNovelAt } from "../src/data/novel.ts";
import { upsertSetting } from "../src/data/settings.ts";
import { upsertCharacter } from "../src/data/characters.ts";
import { upsertRelation } from "../src/data/relations.ts";
import { upsertEvent } from "../src/data/events.ts";
import { writeOutline } from "../src/data/outline.ts";
import { writeConfig } from "../src/data/paths.ts";
import { statePath } from "../src/data/paths.ts";
import { readDoc, writeDoc } from "../src/data/doc.ts";
import { NovelStateSchema } from "../src/data/schema.ts";
import { writeChapterSummary } from "../src/data/chapters.ts";

const ROOT = join(process.cwd(), ".tmp-layers");

function makeCtx(cwd: string, onNewSession?: () => void): ExtensionContext {
  return {
    cwd,
    ui: { setStatus: () => {}, notify: () => {} },
    newSession: async () => {
      onNewSession?.();
    },
    sessionManager: { getSessionFile: () => undefined },
  } as unknown as ExtensionContext;
}

export default async function run(): Promise<void> {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  const novelRoot = join(ROOT, "层面书");
  initNovel(novelRoot, { title: "层面书", genre: [], premise: "测试用。" });

  /* ---------------- 装载 ---------------- */

  section("层面数据装载");

  const novel = openNovelAt(novelRoot);
  check("打开小说成功", novel !== null);
  if (novel === null) return;

  check("未打开小说时不装载", loadLayerData("setting", null) === null);
  check("主菜单层不装载", loadLayerData("menu", novel) === null);
  const writeData0 = loadLayerData("write", novel);
  check("写作层已装载（里程碑 7）", writeData0 !== null);
  const writeText0 = renderLayerData(writeData0!);
  check("写作层装载完整上下文包（九段全文）", writeText0.includes("【1】") && writeText0.includes("【9】"));
  check("写作层装载的是段内容、不是总表", !writeText0.includes("（无来源）"));
  check("写作层给出总段数与 token 量", writeText0.includes("9 段") && writeText0.includes("tokens"));
  check(
    "写作层给用户的只有摘要（不刷屏）",
    (writeData0?.userSummary ?? "").includes("/context") && !(writeData0?.userSummary ?? "").includes("【9】"),
  );
  const emptyEvent = loadLayerData("event", novel);
  check("事件层已装载（里程碑 5）", emptyEvent !== null);
  const emptyEventText = renderLayerData(emptyEvent!);
  check("事件层含【阶段划分】", emptyEventText.includes("【阶段划分】"));
  check("事件层含【主要冲突】", emptyEventText.includes("【主要冲突】"));
  check("事件层**不**含【结局】（与大纲层重点不同）", !emptyEventText.includes("【结局】"));
  check("事件层含【主线大纲】以外的清单区段", emptyEventText.includes("【事件清单（0 条）】"));
  check("没有事件时指向推演流程", emptyEventText.includes("交用户挑选后再落盘"));

  const emptyOutline = loadLayerData("outline", novel);
  check("大纲层已装载（里程碑 4）", emptyOutline !== null);
  const emptyOutlineText = renderLayerData(emptyOutline!);
  check("大纲层含【主线大纲】区段", emptyOutlineText.includes("【主线大纲】"));
  check("新建书的大纲显示占位内容", emptyOutlineText.includes("（待定）"));
  check("大纲层含事件清单区段", emptyOutlineText.includes("【事件清单（0 条）】"));
  check("没有事件时指向 /event 层", emptyOutlineText.includes("/event"));
  check("大纲层不含「修订记录」（历史不进上下文）", !emptyOutlineText.includes("修订记录"));

  const emptySetting = loadLayerData("setting", novel);
  check("设定层空清单：标题含条数 0", emptySetting?.title.includes("0 条") === true, emptySetting?.title);
  check("设定层空清单：给出可行动提示", emptySetting?.lines[0]?.includes("还没有任何设定条目") === true);

  const emptyPerson = loadLayerData("person", novel);
  check("人物层空清单：标题含 0 人 0 关系", emptyPerson?.title.includes("0 人") === true && emptyPerson?.title.includes("0 条关系") === true, emptyPerson?.title);
  check("人物层空清单：给出可行动提示", emptyPerson?.lines[0]?.includes("还没有任何人物") === true);

  /* ---------------- 建数据后的装载 ---------------- */

  section("层面数据装载：有数据时");

  upsertSetting(novelRoot, { name: "异能等级体系", category: "world_rule", summary: "一到九级，越级会反噬。", body: "详述正文，这段不该出现在清单里。" });
  upsertSetting(novelRoot, { name: "深海研究所", category: "location", summary: "建在海底的研究站。", body: "常驻 12 人。", establishedIn: 3 });
  upsertSetting(novelRoot, { name: "旧设定", category: "custom", summary: "已废止的例子。", body: "x", deprecated: true });

  const settingData = loadLayerData("setting", novel);
  const settingText = renderLayerData(settingData!);
  check("清单标题含条数", settingData?.title.includes("3 条") === true, settingData?.title);
  check("清单含 ID 与名称", settingText.includes("S-001") && settingText.includes("异能等级体系"));
  check("清单含分类", settingText.includes("world_rule") && settingText.includes("location"));
  check("清单含摘要", settingText.includes("一到九级，越级会反噬"));
  check("清单含确立章节（设定期）", settingText.includes("确立于设定期"));
  check("清单含确立章节（具体章）", settingText.includes("确立于第 3 章"));
  check("已废止条目被标出", settingText.includes("[已废止]"));
  check("清单不含详述正文（装载的是索引不是详述）", !settingText.includes("详述正文，这段不该出现"));

  upsertCharacter(novelRoot, { name: "李明", role: "protagonist", static: { age: 34 } }, 1);
  upsertCharacter(novelRoot, { name: "张局", role: "supporting", status: "dead" }, 2);
  upsertRelation(novelRoot, { from: "C-001", to: "C-002", type: "subordinate" }, ["C-001", "C-002"], 1);

  const personData = loadLayerData("person", novel);
  const personText = renderLayerData(personData!);
  check("人物清单标题含人数与关系数", personData?.title.includes("2 人") === true && personData?.title.includes("1 条关系") === true, personData?.title);
  check("清单含人物 ID 与姓名", personText.includes("C-001") && personText.includes("李明"));
  check("清单含角色与状态", personText.includes("protagonist") && personText.includes("dead"));
  check("清单含 lastUpdatedChapter 信息", personText.includes("尚未回填过"));
  check("清单含关系", personText.includes("R-001") && personText.includes("C-001 → C-002"));
  check("关系单独成段", personText.includes("关系："));

  writeOutline(
    novelRoot,
    [
      "# 深海回声 · 故事主线大纲",
      "",
      "## 一句话主题",
      "",
      "海底的信号是一种语言。",
      "",
      "## 阶段划分",
      "",
      "第一幕：发现。",
      "",
      "## 主要冲突",
      "",
      "李明想公开，研究所想封锁。",
      "",
      "## 修订记录",
      "",
      "- [2026-01-01 00:00] 这段不该进上下文。",
      "",
    ].join("\n"),
  );

  const outlineLoaded = renderLayerData(loadLayerData("outline", novel)!);
  check("大纲层注入大纲正文", outlineLoaded.includes("海底的信号是一种语言"));
  check("大纲层注入阶段划分", outlineLoaded.includes("第一幕：发现"));
  check("大纲层注入时丢掉修订记录", !outlineLoaded.includes("这段不该进上下文"));
  check("大纲层含事件清单区段", outlineLoaded.includes("【事件清单"));

  upsertEvent(novelRoot, { title: "发现信号", stage: "第一幕", origin: "user_specified" }, { characters: [], settings: [] });
  upsertEvent(
    novelRoot,
    { title: "神秘来电", stage: "第二幕", origin: "foreshadow", plantedIn: 1, payoffExpectedAt: 9 },
    { characters: [], settings: [] },
  );

  const eventLoaded = renderLayerData(loadLayerData("event", novel)!);
  check("事件层注入阶段划分的内容", eventLoaded.includes("第一幕：发现"));
  check("事件层注入主要冲突的内容", eventLoaded.includes("李明想公开，研究所想封锁"));
  check("事件层注入事件 ID 与阶段", eventLoaded.includes("E-001") && eventLoaded.includes("[第一幕]"));
  check("事件层注入状态与来源", eventLoaded.includes("planned") && eventLoaded.includes("user_specified"));
  check(
    "伏笔在清单里标出埋设与预计回收章",
    eventLoaded.includes("foreshadow") && eventLoaded.includes("埋于 CH-001") && eventLoaded.includes("预计 CH-009 回收"),
  );
  check("非伏笔事件不标埋设章", !eventLoaded.includes("埋于 CH-000"));

  // 大纲区段结构被改过 → 退化为整份大纲，而不是什么都不给。
  const brokenRoot = join(ROOT, "区段损坏书");
  initNovel(brokenRoot, { title: "区段损坏书", genre: [], premise: "p" });
  writeOutline(brokenRoot, "# 自由格式大纲\n\n第一幕发现自己是谁。第三幕发现代价。\n");
  const brokenNovel = openNovelAt(brokenRoot);
  const brokenLoaded = renderLayerData(loadLayerData("event", brokenNovel!)!);
  check("区段抽不到时退化为整份大纲", brokenLoaded.includes("【大纲】") && brokenLoaded.includes("第三幕发现代价"));
  check("退化时不误报「大纲缺失」", !brokenLoaded.includes("（大纲文件缺失。）"));

  /* ---------------- 注入 ---------------- */

  section("层面注入");

  const messages: Array<{ customType?: string; content: string }> = [];
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();

  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
      commands.set(name, options.handler);
    },
    registerTool: () => {},
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    sendMessage: (message: { customType?: string; content: string }) => {
      messages.push(message);
    },
  } as unknown as ExtensionAPI;

  novelMasterExtension(pi);
  writeConfig(ROOT, { novelRoot });

  async function injectFor(layer: Layer): Promise<Record<string, string>> {
    setLayer(layer);
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
    for (const handler of handlers.get("before_agent_start") ?? []) {
      await handler(event, makeCtx(ROOT));
    }
    return event.systemPromptOptions.sections;
  }

  const settingSections = await injectFor("setting");
  check("设定层注入 novelmaster-layer-data", "novelmaster-layer-data" in settingSections);
  check("数据段含条目清单", settingSections["novelmaster-layer-data"]?.includes("S-001") === true);
  check("数据段与层面段是两个 section（粒度按变化频率切）", "novelmaster-layer" in settingSections);
  check("设定层不注入关系数据", settingSections["novelmaster-layer-data"]?.includes("R-001") !== true);

  const personSections = await injectFor("person");
  check("人物层注入人物与关系", personSections["novelmaster-layer-data"]?.includes("C-001") === true && personSections["novelmaster-layer-data"]?.includes("R-001") === true);

  const outlineSections = await injectFor("outline");  check("大纲层注入数据段", "novelmaster-layer-data" in outlineSections);
  check("大纲层数据段含大纲正文", outlineSections["novelmaster-layer-data"]?.includes("海底的信号是一种语言") === true);
  check("大纲层数据段不含设定条目（每层只装载该层数据）", outlineSections["novelmaster-layer-data"]?.includes("S-001") !== true);
  check("大纲层仍注入层面段", "novelmaster-layer" in outlineSections);

  const eventSections = await injectFor("event");
  check("事件层注入数据段", "novelmaster-layer-data" in eventSections);
  check("事件层数据段含事件清单", eventSections["novelmaster-layer-data"]?.includes("E-001") === true);
  check("事件层数据段不含设定条目", eventSections["novelmaster-layer-data"]?.includes("S-001") !== true);

  /* ---------------- 进层面时的用户清单 ---------------- */

  section("进层面：用户看到的清单");

  messages.length = 0;
  await commands.get("setting")?.("", makeCtx(ROOT));
  const userSetting = messages.find((m) => m.customType === "novelmaster-layer-data");
  check("进设定层给用户发了清单", userSetting !== undefined);
  check(
    "给用户的清单与注入给 AI 的是同一份",
    userSetting?.content === settingSections["novelmaster-layer-data"],
    "两者必须共用同一个渲染函数，否则迟早出现「AI 知道而用户不知道」",
  );

  messages.length = 0;
  await commands.get("person")?.("", makeCtx(ROOT));
  const userPerson = messages.find((m) => m.customType === "novelmaster-layer-data");
  check("进人物层给用户发了清单", userPerson !== undefined);
  check("人物层清单含人物与关系", userPerson?.content.includes("C-001") === true && userPerson?.content.includes("R-001") === true);

  messages.length = 0;
  await commands.get("outline")?.("", makeCtx(ROOT));
  const userOutline = messages.find((m) => m.customType === "novelmaster-layer-data");
  check("进大纲层给用户发了清单", userOutline !== undefined);
  check("大纲层清单与注入给 AI 的是同一份", userOutline?.content === outlineSections["novelmaster-layer-data"]);

  /* ---------------- /next 命令 ---------------- */

  section("/next 命令");

  setLayer("write");
  messages.length = 0;
  await commands.get("next")?.("", makeCtx(ROOT));
  const task = messages.find((m) => m.customType === "novelmaster-task");
  check("状态允许时发任务段", task !== undefined);
  check("任务段是推演大纲（含章号）", (task?.content ?? "").includes("推演第") && (task?.content ?? "").includes("章"));
  check("任务段给出结构化头块的格式", (task?.content ?? "").includes("novelmaster:outline") && (task?.content ?? "").includes("primaryEvent"));
  check("任务段含完整上下文包（九段）", (task?.content ?? "").includes("【9】"));
  check("任务段要求不传 confirmNote（那是确认后才写的）", (task?.content ?? "").includes("不要传 confirmNote"));
  check("任务段明确不许 AI 自己宣告确认", (task?.content ?? "").includes("不要说「已确认」"));

  setLayer("menu");
  messages.length = 0;
  await commands.get("next")?.("", makeCtx(ROOT));
  check("不在写作层时拒绝推演", messages.every((m) => m.customType !== "novelmaster-task"));

  const stateFile = statePath(novelRoot);
  writeDoc(
    stateFile,
    NovelStateSchema,
    { ...readDoc(stateFile, NovelStateSchema, "state.json"), chapterStatus: "drafted" },
    "state.json",
  );
  setLayer("write");
  messages.length = 0;
  await commands.get("next")?.("", makeCtx(ROOT));
  check("正文已生成时拒绝又推一份新大纲", messages.every((m) => m.customType !== "novelmaster-task"));

  /* ---------------- /done、/brainstorm ---------------- */

  section("/done 与 /brainstorm");

  // 闸门：状态不对时拒绝，且**不**清上下文。
  let cleared = 0;
  setLayer("write");
  messages.length = 0;
  await commands.get("done")?.("", makeCtx(ROOT, () => { cleared += 1; }));
  check("状态不满足时 /done 被拒绝", cleared === 0);

  const stateFile2 = statePath(novelRoot);
  const setState = (patch: Record<string, unknown>): void => {
    writeDoc(stateFile2, NovelStateSchema, { ...readDoc(stateFile2, NovelStateSchema, "state.json"), ...patch } as never, "state.json");
  };

  setState({ chapterStatus: "reflowed", pendingReflow: true });
  await commands.get("done")?.("", makeCtx(ROOT, () => { cleared += 1; }));
  check("pendingReflow 为 true 时 /done 被拒绝", cleared === 0);

  setState({ chapterStatus: "reflowed", pendingReflow: false });
  await commands.get("done")?.("", makeCtx(ROOT, () => { cleared += 1; }));
  check("缺章节摘要时 /done 被拒绝", cleared === 0);

  // 补上摘要，闸门应当放行。
  writeChapterSummary(novelRoot, 1, {
    synopsis: "本章梗概。",
    appearedCharacters: ["C-001"],
    appearedLocations: [],
    advancedEvents: [],
    newSettings: [],
    newForeshadows: [],
    endState: "结尾。",
  });
  setState({ chapterStatus: "reflowed", pendingReflow: false });
  await commands.get("done")?.("", makeCtx(ROOT, () => { cleared += 1; }));
  check("闸门全部满足时结章", cleared === 1);
  check("状态推进到 accepted", openNovelAt(novelRoot)?.state.chapterStatus === "accepted");
  check("**结章时清空上下文**（newSession 被调用）", cleared === 1);

  // /next 从 accepted 推进到下一章。
  messages.length = 0;
  await commands.get("next")?.("", makeCtx(ROOT));
  check("**/next 从 accepted 推进章号**", openNovelAt(novelRoot)?.state.currentChapter === 2);
  check("新章状态为 not_started", openNovelAt(novelRoot)?.state.chapterStatus === "not_started");
  check("新章注入任务段", messages.some((m) => m.customType === "novelmaster-task"));
  const advanced = openNovelAt(novelRoot);
  check("推进到第二章后主事件被清空（不把上章的事件带过来）", advanced?.state.currentEventId === null);

  // /brainstorm 的两道硬约束。
  setLayer("menu");
  messages.length = 0;
  await commands.get("brainstorm")?.("随便一个方向", makeCtx(ROOT));
  check("主菜单层不能用 /brainstorm", messages.every((m) => m.customType !== "novelmaster-task"));

  setLayer("outline");
  messages.length = 0;
  await commands.get("brainstorm")?.("   ", makeCtx(ROOT));
  check("**没给方向时不启动**（硬约束）", messages.every((m) => m.customType !== "novelmaster-task"));

  messages.length = 0;
  await commands.get("brainstorm")?.("如果主角是内鬼", makeCtx(ROOT));
  const brainstormTask = messages.find((m) => m.customType === "novelmaster-task");
  check("给了方向就发任务段", brainstormTask !== undefined);
  check("任务段带上方向", (brainstormTask?.content ?? "").includes("如果主角是内鬼"));
  check("任务段要求主会话设计视角", (brainstormTask?.content ?? "").includes("自行设计"));
  check("任务段要求不要投票", (brainstormTask?.content ?? "").includes("不要投票"));

  /* ---------------- 未打开小说 ---------------- */

  section("进层面：未打开小说时");

  setLayer("menu");
  writeConfig(ROOT, { novelRoot: null });
  messages.length = 0;
  await commands.get("setting")?.("", makeCtx(ROOT));
  check("未打开小说时进设定层不报错也不发清单", messages.every((m) => m.customType !== "novelmaster-layer-data"));
  const noNovelSections = await injectFor("setting");
  check("未打开小说时不注入数据段", !("novelmaster-layer-data" in noNovelSections));
  check("未打开小说时仍注入层面段", "novelmaster-layer" in noNovelSections);

  rmSync(ROOT, { recursive: true, force: true });
}
