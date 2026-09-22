/**
 * 审查引擎的测试。
 *
 * 审查的**编排**用注入的假 runner 测（不调模型）；**依据校验、合并、报告渲染**
 * 是纯逻辑，全部可自动测。真正不可测的只有「审得准不准」——那由用户判断。
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { check, section } from "./harness.ts";
import { initNovel } from "../src/data/init.ts";
import { openNovelAt } from "../src/data/novel.ts";
import { upsertSetting } from "../src/data/settings.ts";
import { upsertCharacter } from "../src/data/characters.ts";
import { upsertRelation } from "../src/data/relations.ts";
import { upsertEvent } from "../src/data/events.ts";
import { listChapters, writeChapterText } from "../src/data/chapters.ts";
import { updateMeta } from "../src/data/meta.ts";
import { countParagraphs, validateEvidence } from "../src/data/validate.ts";
import { readDoc, writeDoc } from "../src/data/doc.ts";
import { statePath } from "../src/data/paths.ts";
import { NovelStateSchema } from "../src/data/schema.ts";
import { CHECKLIST, CHECKLIST_SIZE, REVIEWERS, checklistFor } from "../src/ai/review/checklist.ts";
import { countFindings, mergeFindings, type Finding } from "../src/ai/review/merge.ts";
import { renderReviewReport } from "../src/ai/review/report.ts";
import { createSubmitFindingsTool, review, runReviewAndPersist, type ReviewerRunner } from "../src/ai/review/index.ts";
import { runParallel, hasFatal } from "../src/ai/parallel.ts";
import { TOOL_NAMES } from "../src/tools/index.ts";

const ROOT = join(process.cwd(), ".tmp-report");

function finding(over: Partial<Finding> = {}): Finding {
  return {
    category: "A1",
    severity: "warning",
    paragraph: 1,
    phenomenon: "现象",
    evidence: [],
    suggestion: "建议",
    reviewer: "设定审查员",
    ...over,
  };
}

export default async function run(): Promise<void> {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  /* ---------------- 清单 ---------------- */

  section("审查清单");

  check("恰好 28 项", CHECKLIST_SIZE === 28, String(CHECKLIST_SIZE));
  const categories = [...new Set(CHECKLIST.map((item) => item.category))].sort();
  check("恰好 7 个类别", categories.join("") === "ABCDEFG", categories.join(""));
  check("编号无重复", new Set(CHECKLIST.map((item) => item.id)).size === 28);
  check("每项都有编号 / 标题 / 判定方式", CHECKLIST.every((item) => item.id !== "" && item.title !== "" && item.detail !== ""));
  check("编号形如字母+数字", CHECKLIST.every((item) => /^[A-G]\d$/.test(item.id)));

  const covered = new Set(REVIEWERS.flatMap((reviewer) => checklistFor(reviewer).map((item) => item.id)));
  check("三个审查员覆盖全部 28 项（不遗漏）", covered.size === 28, `覆盖 ${covered.size}`);
  check("分工不重叠（同一项不被两个审查员审）", REVIEWERS.flatMap((r) => checklistFor(r)).length === 28);
  check("恰好 3 个审查员", REVIEWERS.length === 3);
  check("每个审查员都分到了项目", REVIEWERS.every((reviewer) => checklistFor(reviewer).length > 0));
  check(
    "分工与 pipeline.md 一致（A / B·C / D·E·F·G）",
    REVIEWERS[0]?.categories.join("") === "A" &&
      REVIEWERS[1]?.categories.join("") === "BC" &&
      REVIEWERS[2]?.categories.join("") === "DEFG",
  );

  /* ---------------- 依据校验 ---------------- */

  section("依据校验");

  const root = join(ROOT, "审查书");
  initNovel(root, { title: "审查书", genre: [], premise: "测试。" });
  updateMeta(root, { logline: "一句话。" });
  upsertSetting(root, { name: "异能等级", category: "world_rule", summary: "一到九级。", body: "详述。" });
  upsertSetting(root, { name: "旧设定", category: "custom", summary: "废弃了。", body: "旧。", deprecated: true });
  upsertCharacter(root, { name: "李明", role: "protagonist" }, 1);
  upsertRelation(root, { from: "C-001", to: "C-001", type: "self" }, ["C-001"], 1);
  upsertEvent(root, { title: "事件", stage: "第一幕", origin: "user_specified" }, { characters: [], settings: [] });
  writeChapterText(root, { chapter: 1, text: "第一段。\n\n第二段。\n\n第三段。\n" });

  const one = (ref: string): ReturnType<typeof validateEvidence>[number] => validateEvidence(root, [ref])[0]!;
  check("存在的设定条目有效", one("setting#S-001").valid);
  check("不存在的设定条目无效", !one("setting#S-099").valid && one("setting#S-099").reason === "S-099 不存在");
  check("**已废止的设定不算有效依据**", !one("setting#S-002").valid && one("setting#S-002").reason === "S-002 已废止");
  check("存在的人物有效", one("character#C-001").valid);
  check("不存在的人物无效", !one("character#C-099").valid);
  check("存在的关系有效", one("relation#R-001").valid);
  check("不存在的关关系无效", !one("relation#R-099").valid);  check("存在的事件有效", one("event#E-001").valid);
  check("不存在的事件无效", !one("event#E-099").valid);
  check("存在的章节有效", one("chapter#001").valid);
  check("不存在的章节无效", !one("chapter#099").valid && one("chapter#099").reason.includes("不存在"));
  check("章号不合法时无效", !one("chapter#abc").valid && one("chapter#abc").reason.includes("不合法"));
  check("段落引用在范围内时有效", one("chapter#001:para2").valid);
  check("段落引用超出范围时无效", !one("chapter#001:para9").valid && one("chapter#001:para9").reason.includes("只有 3 段"));
  check("章节引用带段落时格式可解析", validateEvidence(root, ["chapter#001:para2"]).length === 1);
  check("outline 引用有效", one("outline").valid);
  check("meta 字段引用有效", one("meta#pov").valid);
  check("meta 不存在的字段无效", !one("meta#nope").valid);
  check("格式无法识别时无效", !one("乱写的").valid && one("乱写的").reason.includes("无法识别"));

  check("段落数按空行切分", countParagraphs("a\n\nb\n\n\nc\n") === 3);
  check("单段文本段落数为 1", countParagraphs("只有一段。") === 1);
  check("纯空行段落数为 0", countParagraphs("\n\n\n") === 0);

  /* ---------------- 合并 ---------------- */

  section("机械合并");

  check("空输入得到空结果", mergeFindings([]).length === 0);

  const downgraded = mergeFindings([finding({ severity: "blocking", invalidEvidence: ["setting#S-099"] })]);
  check("**依据无效 → 降级为 note**", downgraded[0]?.severity === "note");
  check("降级时附上说明", (downgraded[0]?.note ?? "").includes("可能是编造"));
  check("降级不删条目（用户要看到 AI 编了什么）", downgraded.length === 1);

  const sameSpot = mergeFindings([
    finding({ category: "A1", paragraph: 3, severity: "warning", phenomenon: "甲说" }),
    finding({ category: "A1", paragraph: 3, severity: "blocking", phenomenon: "乙说" }),
  ]);
  check("同类别同段落合并为一条", sameSpot.length === 1);
  check("合并后取最高 severity", sameSpot[0]?.severity === "blocking");
  check("合并后保留另一条的现象", (sameSpot[0]?.phenomenon ?? "").includes("乙说") && (sameSpot[0]?.phenomenon ?? "").includes("甲说"));

  const duplicated = mergeFindings([
    finding({ category: "B4", paragraph: 2, severity: "blocking", phenomenon: "老陈已死却出场" }),
    finding({ category: "B4", paragraph: 2, severity: "blocking", phenomenon: "老陈已死却出场。" }),
  ]);
  check("现象基本相同的重复提交不并列（真实运行里出现过）", duplicated.length === 1 && !(duplicated[0]?.phenomenon ?? "").includes("另一条判断"));

  const genuinelyDifferent = mergeFindings([
    finding({ category: "B4", paragraph: 2, severity: "warning", phenomenon: "老陈已死却出场" }),
    finding({ category: "B4", paragraph: 2, severity: "blocking", phenomenon: "老陈的状态与档案不符，且本章摘要里没列他" }),
  ]);
  check("真正不同的判断并列保留", (genuinelyDifferent[0]?.phenomenon ?? "").includes("另一条判断"));

  const crossCategory = mergeFindings([
    finding({ category: "A1", paragraph: 3, phenomenon: "设定问题" }),
    finding({ category: "F1", paragraph: 3, phenomenon: "逻辑问题" }),
  ]);
  check("**不同类别同段落都保留**（两个视角的不同问题）", crossCategory.length === 2);

  const sorted = mergeFindings([
    finding({ paragraph: 9, severity: "note" }),
    finding({ paragraph: 5, severity: "blocking" }),
    finding({ paragraph: 2, severity: "warning" }),
    finding({ paragraph: 1, severity: "blocking" }),
  ]);
  check("排序：blocking → warning → note", sorted.map((item) => item.severity).join(",") === "blocking,blocking,warning,note");
  check("同级按段落升序", sorted[0]?.paragraph === 1 && sorted[1]?.paragraph === 5);

  check("统计正确", ((): boolean => {
    const stats = countFindings([
      finding({ severity: "blocking" }),
      finding({ severity: "warning", paragraph: 2 }),
      finding({ severity: "note", paragraph: 3 }),
      finding({ severity: "note", paragraph: 4, invalidEvidence: ["x#1"] }),
    ]);
    return stats.blocking === 1 && stats.warning === 1 && stats.note === 2 && stats.invalidEvidence === 1;
  })());

  /* ---------------- 报告渲染 ---------------- */

  section("报告渲染");

  const report = renderReviewReport({
    chapter: 12,
    findings: mergeFindings([
      finding({ category: "A2", severity: "blocking", paragraph: 3, phenomenon: "出现「共鸣场」", evidence: ["setting#S-001"], suggestion: "补设条目" }),
      finding({ category: "B5", severity: "note", paragraph: 9, phenomenon: "称谓切换", evidence: ["character#C-099"], suggestion: "统一", invalidEvidence: ["character#C-099"] }),
    ]),
    reviewers: ["设定审查员", "人物关系审查员", "逻辑叙事审查员"],
    missing: [],
    generatedAt: "2026-09-22 10:00",
  });

  check("标题含章号", report.includes("# 第 012 章 审查报告"));
  check("含生成时间与审查员", report.includes("2026-09-22 10:00") && report.includes("设定审查员"));
  check("统计含三级与依据无效", report.includes("blocking 1") && report.includes("依据无效 1"));
  check("三级分节都在", report.includes("## blocking") && report.includes("## warning") && report.includes("## note"));
  check("空级别写「（无）」", report.includes("（无）"));
  check("blocking 排在 note 前", report.indexOf("## blocking") < report.indexOf("## note"));
  check("条目含编号与标题", report.includes("[A2]") && report.includes("设定未确立就用"));
  check("条目含位置 / 现象 / 依据 / 建议", report.includes("- **位置**：第 3 段") && report.includes("- **现象**：") && report.includes("- **依据**：") && report.includes("- **建议**："));
  check("依据以代码格式呈现", report.includes("`setting#S-001`"));
  check("**依据无效的条目被标出**", report.includes("依据无效") && report.includes("该引用不存在或不可用"));
  check("未产出的审查员明示（不假装它审过了）", ((): boolean => {
    const withMissing = renderReviewReport({ chapter: 1, findings: [], reviewers: ["设定审查员"], missing: [{ name: "人物关系审查员", detail: "未调用 submit_findings" }] });
    return withMissing.includes("未产出") && withMissing.includes("人物关系审查员");
  })());
  check("无问题时明说", renderReviewReport({ chapter: 1, findings: [], reviewers: [], missing: [] }).includes("没有发现问题"));

  /* ---------------- 编排（注入假 runner） ---------------- */

  section("审查编排");

  const novel = openNovelAt(root);
  check("测试用小说可打开", novel !== null);
  if (novel === null) return;

  const okRunner: ReviewerRunner = async (reviewer) => ({
    kind: "ok",
    value: [finding({ category: checklistFor(reviewer)[0]?.id ?? "A1", reviewer: reviewer.name })],
  });
  const allOk = await review({ novel, chapter: 1, cwd: ROOT }, okRunner);
  check("三个审查员都产出", allOk.outcomes.filter((outcome) => outcome.status === "ok").length === 3);
  check("条目来自三个审查员", new Set(allOk.findings.map((item) => item.reviewer)).size === 3);
  check("不致命", !allOk.fatal);
  const withInvalidRunner: ReviewerRunner = async () => ({
    kind: "ok",
    value: [finding({ evidence: ["setting#S-099"] })],
  });
  const withInvalid = await review({ novel, chapter: 1, cwd: ROOT }, withInvalidRunner);
  check("编排把无效引用标在条目上", (withInvalid.findings[0]?.invalidEvidence ?? []).includes("setting#S-099"));
  check("无效引用导致降级为 note", withInvalid.findings[0]?.severity === "note");

  const missingRunner: ReviewerRunner = async (reviewer) =>
    reviewer.name === "设定审查员" ? { kind: "missing", detail: "未调用 submit_findings" } : { kind: "ok", value: [] };
  const withMissing = await review({ novel, chapter: 1, cwd: ROOT }, missingRunner);
  check("未产出不算致命", !withMissing.fatal);
  check("未产出的审查员状态为 missing", withMissing.outcomes.find((outcome) => outcome.reviewer.name === "设定审查员")?.status === "missing");
  check("**提交空数组算产出**（审过但没问题 ≠ 没审）", withMissing.outcomes.filter((outcome) => outcome.status === "ok").length === 2);

  const fatalRunner: ReviewerRunner = async () => ({ kind: "fatal", detail: "子会话起不来" });
  const fatal = await review({ novel, chapter: 1, cwd: ROOT }, fatalRunner);
  check("设施失败标记为致命", fatal.fatal);

  let maxActive = 0;
  let active = 0;
  const concurrentRunner: ReviewerRunner = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { kind: "ok", value: [] };
  };
  await review({ novel, chapter: 1, cwd: ROOT }, concurrentRunner);
  check("三个审查员并发跑", maxActive > 1, `最大同时 ${maxActive}`);

  /* ---------------- 公共骨架 ---------------- */

  section("并发骨架（脑暴与审共同用）");

  const parallelResults = await runParallel(
    [{ name: "甲" }, { name: "乙" }],
    async (role) => (role.name === "甲" ? { kind: "ok", value: 1 } : { kind: "missing", detail: "没交" }),
  );
  check("ok 带回值", parallelResults[0]?.value === 1);
  check("missing 带回原因", parallelResults[1]?.detail === "没交");
  check("有 fatal 时 hasFatal 为真", hasFatal([{ role: { name: "x" }, status: "fatal", value: undefined, detail: "炸" }]));
  check("全 ok 时 hasFatal 为假", !hasFatal(parallelResults));

  /* ---------------- submit_findings 工具 ---------------- */

  section("submit_findings 工具");

  const collector = { findings: [] as Finding[], submitted: false };
  const tool = createSubmitFindingsTool(collector, "设定审查员");
  const submitted = await tool.execute(
    "t",
    { findings: [{ category: "A1", severity: "blocking", paragraph: 2, phenomenon: "p", evidence: ["setting#S-001"], suggestion: "s" }] },
    undefined,
    undefined,
    {} as never,
  );
  check("条目收进收集器", collector.findings.length === 1);
  check("标记已提交", collector.submitted);
  check("条目标注来源审查员", collector.findings[0]?.reviewer === "设定审查员");
  check("返回确认文本", (submitted as { content: Array<{ text?: string }> }).content[0]?.text?.includes("已记录 1 条") === true);

  const emptyCollector = { findings: [] as Finding[], submitted: false };
  const emptyTool = createSubmitFindingsTool(emptyCollector, "设定审查员");
  await emptyTool.execute("t", { findings: [] }, undefined, undefined, {} as never);
  check("**提交空数组也算已提交**（否则「审过、干净」会被当成「没审」）", emptyCollector.submitted && emptyCollector.findings.length === 0);

  /* ---------------- 落盘与状态 ---------------- */

  section("审查落盘与状态推进");

  writeChapterText(root, { chapter: 1, text: "第一段。\n\n第二段。\n\n第三段。\n" });
  check("前置状态不是 drafted（初始）", openNovelAt(root)?.state.chapterStatus === "not_started");

  const persisted = await runReviewAndPersist({ novel, chapter: 1, cwd: ROOT, }, okRunner);
  check("报告已生成", persisted.reportMarkdown.includes("第 001 章 审查报告"));
  check("返回摘要含统计", persisted.text.includes("blocking"));
  check("状态未推进（起点不是 drafted）", openNovelAt(root)?.state.chapterStatus === "not_started");

  const current = readDoc(statePath(root), NovelStateSchema, "state.json");
  writeDoc(statePath(root), NovelStateSchema, { ...current, chapterStatus: "drafted" }, "state.json");
  const novelDrafted = openNovelAt(root);
  check("前置状态已置为 drafted", novelDrafted?.state.chapterStatus === "drafted");
  if (novelDrafted !== null) {
    await runReviewAndPersist({ novel: novelDrafted, chapter: 1, cwd: ROOT }, okRunner);
    check("**审查完成后状态推进到 auto_reviewed**", openNovelAt(root)?.state.chapterStatus === "auto_reviewed");
    check("章节索引里的状态同步了", listChapters(root).find((c) => c.no === 1)?.status === "auto_reviewed");
  }

  /* ---------------- 注册 ---------------- */

  section("审查工具注册");

  check("novel_review 注册给主会话", TOOL_NAMES.includes("novel_review"));
  check(
    "**submit_findings 不注册给主会话**（否则主会话能自己交一份假审查结果）",
    !TOOL_NAMES.includes("submit_findings"),
  );

  rmSync(ROOT, { recursive: true, force: true });
}
