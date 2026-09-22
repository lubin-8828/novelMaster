/**
 * 去 AI 味引擎的测试。
 *
 * 改写本身不可自动测（要真模型），但**范围检查（机械防线）**、**报告渲染**、
 * **编排的失败处置与状态推进**都是纯逻辑。真实改写的手工验收见 `ops.md §2.2`。
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { check, section } from "./harness.ts";
import { initNovel } from "../src/data/init.ts";
import { openNovelAt } from "../src/data/novel.ts";
import { upsertSetting } from "../src/data/settings.ts";
import { upsertCharacter } from "../src/data/characters.ts";
import { writeChapterText, listChapters } from "../src/data/chapters.ts";
import { readDoc, writeDoc } from "../src/data/doc.ts";
import { statePath } from "../src/data/paths.ts";
import { readText } from "../src/data/io.ts";
import { NovelStateSchema } from "../src/data/schema.ts";
import { chapterTextPath } from "../src/data/paths.ts";
import { collectProperNouns, scanDeaiScope, scopeWarningCount } from "../src/ai/deai/scope.ts";
import { renderDeaiReport } from "../src/ai/deai/report.ts";
import { createSubmitDeaiTool, runDeaiAndPersist, runDeaiWithRecheck } from "../src/ai/deai/index.ts";
import type { ReviewerRunner } from "../src/ai/review/index.ts";
import { readHumanizerSkill, HUMANIZER_SKILL_PATH } from "../src/ai/deai/skill.ts";
import { TOOL_NAMES } from "../src/tools/index.ts";

const ROOT = join(process.cwd(), ".tmp-deai");

export default async function run(): Promise<void> {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  /* ---------------- skill 注入 ---------------- */

  section("humanizer skill 注入");

  const skill = readHumanizerSkill();
  check("能读到 humanizer skill", skill !== null, HUMANIZER_SKILL_PATH);
  check("skill 去掉了 YAML frontmatter", !(skill ?? "").startsWith("---"));
  check("skill 正文含模式编号", (skill ?? "").includes("§1"));
  check("skill 含「样本优先于通用规则」这条接口", (skill ?? "").includes("The sample overrides the patterns"));

  /* ---------------- 机械范围检查 ---------------- */

  section("范围检查（机械防线）");

  const root = join(ROOT, "去味书");
  initNovel(root, { title: "去味书", genre: [], premise: "测试。" });
  upsertCharacter(root, { name: "李明", role: "protagonist", aliases: ["老李"] }, 1);
  upsertSetting(root, { name: "异能等级", category: "world_rule", summary: "一到九级。", body: "x" });
  const novel = openNovelAt(root);
  check("测试用小说可打开", novel !== null);
  if (novel === null) return;

  const nouns = collectProperNouns(novel);
  check("专有名词含人名", nouns.includes("李明"));
  check("专有名词含别名", nouns.includes("老李"));
  check("专有名词含设定名", nouns.includes("异能等级"));
  check("单字名被过滤（避免误报）", !nouns.includes("李"));

  const clean = scanDeaiScope({
    before: "李明走进实验室。\n\n他拿起杯子。",
    after: "李明走进实验室。\n\n他端起杯子。",
    properNouns: nouns,
  });
  check("**只动表达层时没有告警**", scopeWarningCount(clean) === 0);
  check("干净改写不算段落数变化", !clean.paragraphCountChanged);

  const addedNoun = scanDeaiScope({
    before: "他走进实验室。",
    after: "李明走进实验室。",
    properNouns: nouns,
  });
  check("**新增专有名词被抓住**", addedNoun.hits[0]?.added.includes("李明") === true);

  const removedNoun = scanDeaiScope({
    before: "李明走进实验室。",
    after: "他走进实验室。",
    properNouns: nouns,
  });
  check("**丢失专有名词被抓住**", removedNoun.hits[0]?.removed.includes("李明") === true);

  const numberChanged = scanDeaiScope({
    before: "周期是四十七分钟。",
    after: "周期是四十六分五十三秒。",
    properNouns: nouns,
  });
  check("**数字数量变化被抓住**", numberChanged.hits[0]?.numbersChanged === true);

  // 真实运行里暴露的误报：把「一」当成了数字。
  const noFalsePositive = scanDeaiScope({
    before: "这不是一次意外，而是一次必然。",
    after: "算不上意外。",
    properNouns: nouns,
  });
  check("**「一」不算数字**（否则一段改稿里误报三次）", scopeWarningCount(noFalsePositive) === 0);

  const repartitioned = scanDeaiScope({
    before: "第一段。\n\n第二段。",
    after: "第一段。第二段合并了。",
    properNouns: nouns,
  });
  check("段落数变化时如实标注（逐段对比不成立）", repartitioned.paragraphCountChanged);
  check("段落数变化也计入告警数", scopeWarningCount(repartitioned) === 1);

  /* ---------------- 报告渲染 ---------------- */

  section("去 AI 味报告渲染");

  const report = renderDeaiReport({
    chapter: 12,
    hits: [
      { pattern: "§1 not-X-but-Y", paragraph: 5, original: "这不是背叛，而是自保", action: "已改写" },
      { pattern: "§8 破折号", paragraph: 12, original: "他停住了 —— 不是因为怕", action: "已改写" },
    ],
    before: "原文内容。",
    after: "改写内容。",
    voiceSample: { from: 7, to: 11 },
    scope: clean,
    generatedAt: "2026-09-22 15:00",
  });

  check("标题含章号", report.includes("# 第 012 章 去 AI 味报告"));
  check("标注文风样本范围", report.includes("chapters/007.txt ~ 011.txt"));
  check("命中清单单独成节", report.includes("## 一、命中清单"));
  check("命中清单是表格（可逐条划勾）", report.includes("| # | 模式 | 位置 | 原文片段 | 处理 |"));
  check("表格含每处命中", report.includes("§1 not-X-but-Y") && report.includes("第 5 段"));
  check("含范围检查一节", report.includes("## 二、范围检查（机械）"));
  check("范围干净时说清", report.includes("改动只发生在表达层"));
  check("含改前与改后全文", report.includes("## 三、改前") && report.includes("## 四、改后") && report.includes("原文内容") && report.includes("改写内容"));
  check("表格里的竖线被转义（不破坏结构）", renderDeaiReport({ chapter: 1, hits: [{ pattern: "p", paragraph: 1, original: "a|b", action: "c" }], before: "x", after: "y", voiceSample: null, scope: clean }).includes("a\\|b"));
  check("无样本时明说（第 1 章）", renderDeaiReport({ chapter: 1, hits: [], before: "x", after: "y", voiceSample: null, scope: clean }).includes("**无**"));

  const warned = renderDeaiReport({ chapter: 1, hits: [], before: "x", after: "y", voiceSample: null, scope: addedNoun });
  check("范围有告警时要求用户确认", warned.includes("改动涉及专有名词") && warned.includes("李明"));

  /* ---------------- submit 工具 ---------------- */

  section("submit_deai 工具");

  const collector = { hits: [] as never[], rewritten: "" };
  const tool = createSubmitDeaiTool(collector as { hits: never[]; rewritten: string });
  const result = await tool.execute(
    "t",
    { hits: [{ pattern: "§1", paragraph: 2, original: "a", action: "已改写" }], rewritten: "改后全文。" },
    undefined,
    undefined,
    {} as never,
  );
  check("命中清单收进收集器", collector.hits.length === 1);
  check("**改后全文收进收集器**（落盘用的就是它）", collector.rewritten === "改后全文。");
  check("返回确认文本含字数", (result as { content: Array<{ text?: string }> }).content[0]?.text?.includes("改后全文") === true);

  /* ---------------- 编排 ---------------- */

  section("去 AI 味编排");

  writeChapterText(root, { chapter: 1, text: "李明走进实验室。\n\n他拿起杯子。\n" });
  const state = readDoc(statePath(root), NovelStateSchema, "state.json");
  writeDoc(statePath(root), NovelStateSchema, { ...state, chapterStatus: "auto_reviewed" }, "state.json");

  const okRunner = async () => ({
    hits: [{ pattern: "§1", paragraph: 1, original: "a", action: "已改写" }],
    rewritten: "李明走进实验室。\n\n他端起杯子。\n",
    error: null,
  });

  const withDeai = openNovelAt(root);
  check("前置状态为 auto_reviewed", withDeai?.state.chapterStatus === "auto_reviewed");
  if (withDeai !== null) {
    const outcome = await runDeaiAndPersist({ novel: withDeai, chapter: 1, cwd: ROOT, runner: okRunner });
    check("报告已生成", outcome.reportMarkdown.includes("第 001 章 去 AI 味报告"));
    check("**改后正文已落盘**", (readText(chapterTextPath(root, 1)) ?? "").includes("他端起杯子"));
    check("状态推进到 deai_done", openNovelAt(root)?.state.chapterStatus === "deai_done");
    check("章节索引状态同步", listChapters(root).find((c) => c.no === 1)?.status === "deai_done");
  }

  const failRunner = async () => ({ hits: [], rewritten: "", error: "模型没有调用 submit_deai" });
  const beforeText = readText(chapterTextPath(root, 1)) ?? "";
  let threw = false;
  try {
    await runDeaiAndPersist({ novel: openNovelAt(root)!, chapter: 1, cwd: ROOT, runner: failRunner });
  } catch {
    threw = true;
  }
  check("**改写失败时抛错（不静默跳过）**", threw);
  check("失败时正文**未被改动**", (readText(chapterTextPath(root, 1)) ?? "") === beforeText);

  /* ---------------- 改写 + 复查 ---------------- */

  section("去 AI 味 + 改稿复查");

  const state2 = readDoc(statePath(root), NovelStateSchema, "state.json");
  writeDoc(statePath(root), NovelStateSchema, { ...state2, chapterStatus: "auto_reviewed" }, "state.json");

  const progress: string[] = [];
  const fakeReview: ReviewerRunner = async () => ({ kind: "ok", value: [] });
  const both = await runDeaiWithRecheck({
    novel: openNovelAt(root)!,
    chapter: 1,
    cwd: ROOT,
    runner: okRunner,
    reviewRunner: fakeReview,
    onProgress: (message) => progress.push(message),
  });
  check("两步都跑了", both.deai.hits.length === 1 && both.recheck.text.includes("改稿复查"));
  check("进度上报了改写与复查两个阶段", progress.length === 2 && progress[0]?.includes("改写") === true);
  check("复查报告标明只覆盖 F / G", both.recheck.reportMarkdown.includes("改稿复查") && both.recheck.reportMarkdown.includes("只覆盖 F"));
  check("复查后状态到 awaiting_user_review", openNovelAt(root)?.state.chapterStatus === "awaiting_user_review");

  /* ---------------- 注册 ---------------- */

  section("去 AI 味工具注册");

  check("novel_deai 注册给主会话", TOOL_NAMES.includes("novel_deai"));
  check("**submit_deai 不注册给主会话**", !TOOL_NAMES.includes("submit_deai"));
  check("submit_findings 也不在主会话", !TOOL_NAMES.includes("submit_findings"));

  rmSync(ROOT, { recursive: true, force: true });
}
