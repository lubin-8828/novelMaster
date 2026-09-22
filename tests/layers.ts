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
import { writeConfig } from "../src/data/paths.ts";

const ROOT = join(process.cwd(), ".tmp-layers");

function makeCtx(cwd: string): ExtensionContext {
  return { cwd, ui: { setStatus: () => {}, notify: () => {} } } as unknown as ExtensionContext;
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
  check("大纲层暂不装载（里程碑 4）", loadLayerData("outline", novel) === null);
  check("事件层暂不装载（里程碑 5）", loadLayerData("event", novel) === null);
  check("写作层暂不装载（里程碑 6）", loadLayerData("write", novel) === null);

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

  const outlineSections = await injectFor("outline");
  check("大纲层本里程碑不注入数据段", !("novelmaster-layer-data" in outlineSections));
  check("大纲层仍注入层面段", "novelmaster-layer" in outlineSections);

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
  check("进大纲层不发数据清单（还没有可发的）", messages.every((m) => m.customType !== "novelmaster-layer-data"));

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
