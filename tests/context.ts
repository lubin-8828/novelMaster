/**
 * 上下文装配器与 `/context` 的测试。
 *
 * 装配器读七八个文件、做三层并集，它是「AI 到底看到了什么」的唯一决定者 ——
 * 所以这里测的不是「函数返回了没有」，而是**每一段的来源与并集是否如规格所述**。
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { check, section } from "./harness.ts";
import { initNovel } from "../src/data/init.ts";
import { openNovelAt } from "../src/data/novel.ts";
import { upsertSetting } from "../src/data/settings.ts";
import { upsertCharacter } from "../src/data/characters.ts";
import { upsertRelation } from "../src/data/relations.ts";
import { upsertEvent, linkEventChapter } from "../src/data/events.ts";
import { writeChapterOutline, writeChapterSummary, writeChapterText, readOutlineHeader, readSummaryAppearances } from "../src/data/chapters.ts";
import { assemble } from "../src/ai/context-assembler.ts";
import { charCount, displayWidth, estimateTokens, padDisplay } from "../src/ai/tokens.ts";
import { renderContext } from "../src/extension/render.ts";
import { ALL_COMMANDS, COMMANDS, CMD } from "../src/extension/layers.ts";

const ROOT = join(process.cwd(), ".tmp-context");

export default function run(): void {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  /* ---------------- token 估算 ---------------- */

  section("token 估算");

  check("空字符串为 0", estimateTokens("") === 0);
  check("纯英文按 4 字符 1 token", estimateTokens("abcd") === 1);
  check("英文不足 4 字符向上取整", estimateTokens("ab") === 1);
  check("**纯中文按字算**（不按 4 字符 1 token）", estimateTokens("四个汉字") === 4);
  check("中文标点也算 CJK", estimateTokens("，。") === 2);
  check("中英混合分别计算", estimateTokens("中文ab") === 3);
  check("emoji 不数错码点", estimateTokens("😀") === 1);
  check("字符数按码点计", charCount("😀中") === 2);
  check("显示宽度：中文占 2 列", displayWidth("中文") === 4);
  check("显示宽度：英文占 1 列", displayWidth("ab") === 2);
  check("按显示宽度补空格", padDisplay("中文", 8) === "中文    ");
  check("补空格不会截断更长的文本", padDisplay("中文字很长", 4) === "中文字很长");

  /* ---------------- 头块解析 ---------------- */

  section("章节大纲头块解析");

  const header = readOutlineHeader(
    ["<!-- novelmaster:outline", "characters: [C-001, C-002]", "settings: [S-001]", "events: [E-003]", "primaryEvent: E-003", "-->", "", "# 第 012 章"].join("\n"),
  );
  check("解析出人物", header?.characters.join(",") === "C-001,C-002");
  check("解析出设定", header?.settings.join(",") === "S-001");
  check("解析出事件", header?.events.join(",") === "E-003");
  check("解析出主事件", header?.primaryEvent === "E-003");

  const emptyHeader = readOutlineHeader("<!-- novelmaster:outline\ncharacters: []\n-->");
  check("空列表解析为空数组", emptyHeader?.characters.length === 0);
  check("缺失的键解析为空数组", emptyHeader?.settings.length === 0);
  check("缺失的 primaryEvent 为 null", emptyHeader?.primaryEvent === null);
  check("没有头块时返回 null", readOutlineHeader("# 只有标题和正文") === null);

  /* ---------------- 摘要出场解析 ---------------- */

  section("章节摘要出场解析");

  const appearances = readSummaryAppearances(
    ["## 出场", "", "- 人物：C-001 李明、C-002 张局", "- 地点：S-004 研究所", "", "## 推进"].join("\n"),
  );
  check("读出人物 ID", appearances.characters.join(",") === "C-001,C-002");
  check("读出地点（设定）ID", appearances.settings.join(",") === "S-004");
  check("没有「出场」区段时返回空", readSummaryAppearances("## 梗概\n\n没什么。").characters.length === 0);
  check("「人物：无」读出空数组", readSummaryAppearances("## 出场\n\n- 人物：无\n- 地点：无\n").characters.length === 0);

  /* ---------------- 准备一本书 ---------------- */

  const root = join(ROOT, "装配书");
  initNovel(root, { title: "装配书", genre: ["科幻"], premise: "海底信号是一种语言。" });

  upsertSetting(root, { name: "异能等级", category: "world_rule", summary: "一到九级。", body: "九级详述。" });
  upsertSetting(root, { name: "研究所", category: "location", summary: "海底研究站。", body: "常驻 12 人。" });
  upsertSetting(root, { name: "旧能量体系", category: "world_rule", summary: "已废止。", body: "旧。", deprecated: true });
  upsertSetting(root, { name: "无人提及的设定", category: "item", summary: "没人提到它。", body: "详述。" });
  upsertCharacter(root, { name: "李明", role: "protagonist", static: { age: 34, goal: "查清真相" } }, 1);
  upsertCharacter(root, { name: "张局", role: "supporting" }, 1);
  upsertCharacter(root, { name: "无关人物", role: "minor" }, 1);
  upsertCharacter(root, { name: "只出现在摘要里的人", role: "minor" }, 1);
  upsertRelation(root, { from: "C-001", to: "C-002", type: "subordinate" }, ["C-001", "C-002", "C-003", "C-004"], 1);
  upsertRelation(root, { from: "C-001", to: "C-003", type: "rival" }, ["C-001", "C-002", "C-003", "C-004"], 1);

  // 三个相关性来源各贡献一份，才测得出是哪个来源起的作用：
  //   事件涉及 → C-001 / S-001；头块标注 → C-002 / S-003；最近摘要 → C-004 / S-002。
  upsertEvent(
    root,
    { title: "发现信号", stage: "第一幕", origin: "user_specified", characters: ["C-001"], settings: ["S-001"] },
    { characters: ["C-001", "C-002", "C-003", "C-004"], settings: ["S-001", "S-002", "S-003", "S-004"] },
  );

  // 前三章：正文 + 摘要（摘要的「出场」是相关性判定的第三个来源）
  for (const no of [1, 2, 3]) {
    writeChapterText(root, { chapter: no, text: `这是第 ${no} 章的正文内容。` });
    writeChapterSummary(root, no, {
      synopsis: `第 ${no} 章的梗概。`,
      appearedCharacters: no === 1 ? ["C-001", "C-004"] : ["C-001"],
      appearedLocations: no === 1 ? ["S-002"] : [],
      advancedEvents: [],
      newSettings: [],
      newForeshadows: [],
      endState: `第 ${no} 章结尾。`,
    });
  }

  // 第 4 章：大纲（带头块） + 主事件关联
  writeChapterOutline(root, {
    chapter: 4,
    title: "汇报",
    markdown: ["<!-- novelmaster:outline", "characters: [C-002]", "settings: [S-003]", "-->", "", "李明向张局汇报。"].join("\n"),
  });
  linkEventChapter(root, "E-001", 4, true);

  const novel = openNovelAt(root);
  check("测试用小说可打开", novel !== null);
  if (novel === null) return;

  /* ---------------- 装配器 ---------------- */

  section("装配器：九段");

  const bundle = assemble(novel, 4);
  check("恰好九段", bundle.segments.length === 9, String(bundle.segments.length));
  check(
    "段的顺序与规格一致（从最稳定到最易变）",
    bundle.segments.map((item) => item.key).join(",") ===
      "meta,outline,settings,event,characters,relations,recent,summaries,chapter-outline",
    bundle.segments.map((item) => item.key).join(","),
  );
  check("总 token 是各段之和", bundle.totalEstimatedTokens === bundle.segments.reduce((sum, item) => sum + item.estimatedTokens, 0));
  check("每段都算了 token", bundle.segments.every((item) => item.estimatedTokens >= 0));
  check("有内容的段都标了来源", bundle.segments.filter((item) => item.content !== "").every((item) => item.sources.length > 0 || item.content.startsWith("（")));
  check("第一段是 meta（最稳定的放最前）", bundle.segments[0]?.key === "meta");
  check("最后一段是本章大纲（最当下的放最后）", bundle.segments[8]?.key === "chapter-outline");

  section("装配器：各段内容");

  const byKey = new Map(bundle.segments.map((item) => [item.key, item]));
  check("meta 含书名与视角", (byKey.get("meta")?.content ?? "").includes("装配书") && (byKey.get("meta")?.content ?? "").includes("第三人称限知"));
  check("大纲段含大纲正文", (byKey.get("outline")?.content ?? "").includes("故事主线大纲"));
  check("设定段含全部条目的摘要", (byKey.get("settings")?.content ?? "").includes("一到九级") && (byKey.get("settings")?.content ?? "").includes("海底研究站"));
  check("设定段标出已废止条目", (byKey.get("settings")?.content ?? "").includes("[已废止]"));
  check("当前事件段给了事件全文", (byKey.get("event")?.content ?? "").includes("E-001") && (byKey.get("event")?.content ?? "").includes("当前描述"));
  check("最近正文档含第 3 章（N=5 时往前 5 章）", (byKey.get("recent")?.content ?? "").includes("第 3 章的正文"));
  check("实际章数不足 N 时标题写实际章数", (byKey.get("recent")?.title ?? "").includes("实际 3 章"), byKey.get("recent")?.title);
  check("更早摘要段：还没有更早的章节", (byKey.get("summaries")?.content ?? "").includes("没有更早的章节"));
  check("本章大纲段含头块与正文", (byKey.get("chapter-outline")?.content ?? "").includes("李明向张局汇报"));
  check("本章大纲段的来源指向本章文件", (byKey.get("chapter-outline")?.sources.join(",") ?? "").includes("004.outline.md"));

  section("装配器：相关性判定（取并集）");

  const characters = byKey.get("characters")?.content ?? "";
  check("**主事件涉及的人物**进了相关人物（C-001）", characters.includes("C-001"));
  check("**头块标注的人物**进了相关人物（C-002）", characters.includes("C-002"));
  check("**最近 N 章摘要出场的人物**进了相关人物（C-004 只出现在第 1 章摘要里）", characters.includes("C-004"));
  check("三个来源之外的人物不进上下文（C-003）", !characters.includes("C-003"));
  check("相关人物给了全量档案（含静态字段）", characters.includes("查清真相"));

  const settings = byKey.get("settings")?.content ?? "";
  check("**主事件涉及的设定**给了全文（S-001）", settings.includes("—— S-001 异能等级 ——"));
  check("**头块标注的设定**给了全文（S-003）", settings.includes("—— S-003 旧能量体系 ——"));
  check("**最近 N 章出现过的设定**给了全文（S-002 来自第 1 章摘要）", settings.includes("—— S-002 研究所 ——"));
  check("不相关的设定只给摘要、不给全文（S-004）", settings.includes("没人提到它") && !settings.includes("—— S-004"));
  check("相关设定的全文含修订记录（沿革也是依据）", settings.includes("## 修订记录"));

  const relations = byKey.get("relations")?.content ?? "";
  check("**两端都在**相关人物内的关系进上下文（R-001）", relations.includes("R-001"));
  check("**只有一端在集合内的关系被排除**（R-002 的 C-003 不在集合）", !relations.includes("R-002"));

  section("装配器：N 的切分");

  const narrow = assemble({ ...novel, state: { ...novel.state, config: { ...novel.state.config, recentChapters: 1 } } }, 4);
  const narrowByKey = new Map(narrow.segments.map((item) => [item.key, item]));
  check("N=1 时只注入最近 1 章正文", (narrowByKey.get("recent")?.content ?? "").includes("第 3 章的正文") && !(narrowByKey.get("recent")?.content ?? "").includes("第 2 章的正文"));
  check("N=1 时更早章节改用摘要", (narrowByKey.get("summaries")?.content ?? "").includes("第 2 章的梗概"));
  check("N 变大时总 token 增加", assemble({ ...novel, state: { ...novel.state, config: { ...novel.state.config, recentChapters: 3 } } }, 4).totalEstimatedTokens > narrow.totalEstimatedTokens);

  section("装配器：空段保留");

  const noEvent = assemble({ ...novel, state: { ...novel.state, currentEventId: null } }, 99);
  const noEventByKey = new Map(noEvent.segments.map((item) => [item.key, item]));
  check("第 99 章的当前事件段仍在（不跳过空段）", noEvent.segments.some((item) => item.key === "event"));
  check("没有主事件时显式说明（而不是静默留空）", (noEventByKey.get("event")?.content ?? "").includes("没有确定的主事件"));
  check("没有章节大纲时显式说明", (noEventByKey.get("chapter-outline")?.content ?? "").includes("还没有大纲"));
  check("没有相关人物时显式说明", (noEventByKey.get("characters")?.content ?? "").includes("未关联任何人物"));

  /* ---------------- /context 输出 ---------------- */

  section("/context 输出");

  const text = renderContext(bundle);
  check("总表含章号与总 token", text.includes("第 004 章") && text.includes(String(bundle.totalEstimatedTokens)));
  check("总表含段数", text.includes("9 段"));
  check("总表列出每段的标题", bundle.segments.every((item) => text.includes(item.title)));
  check("总表列出来源文件", text.includes("meta.json") && text.includes("outline.md"));
  check("展开各段内容", text.includes("李明向张局汇报"));
  check("长段标注截断与行数", text.includes("共") && text.includes("行，只显示前"));

  const focused = renderContext(bundle, "outline");
  check("按 key 展开单段全文", focused.includes("（全文）") && focused.includes("故事主线大纲"));
  check("单段视图不含其他段的内容", !focused.includes("李明向张局汇报"));

  const byNumber = renderContext(bundle, "2");
  check("按序号展开单段", byNumber.includes("（全文）") && byNumber.includes("故事主线大纲"));

  const missing = renderContext(bundle, "不存在的段");
  check("未知段名时列出可用段名", missing.includes("没有匹配") && missing.includes("chapter-outline"));
  check("未知段名不报错", !missing.includes("undefined"));

  /* ---------------- 命令已实现 ---------------- */

  section("/context 已从占位变为实现");

  check("/context 在命令表里", ALL_COMMANDS.includes(CMD.context));
  check("/context 不再标里程碑（已实现）", COMMANDS[CMD.context].milestone === undefined);

  rmSync(ROOT, { recursive: true, force: true });
}
