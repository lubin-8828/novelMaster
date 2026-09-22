/**
 * 数据层测试：schema 校验、ID 分配、追加式写入、各资料写入、章状态机。
 *
 * 入口是 tests/all.ts。
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { check, errorOf, section, throws } from "./harness.ts";
import { initNovel } from "../src/data/init.ts";
import { openNovelAt } from "../src/data/novel.ts";
import { updateMeta } from "../src/data/meta.ts";
import {
  assertSchema,
  CHARACTER_ROLES,
  CHARACTER_STATUSES,
  CharacterIndexSchema,
  CHAPTER_STATUSES,
  ChapterStatusSchema,
  emptyCharacterIndex,
  emptyMeta,
  emptyState,
  EVENT_ORIGINS,
  EVENT_STATUSES,
  EventIndexSchema,
  isValid,
  NovelMetaSchema,
  NovelStateSchema,
  RELATION_STATUSES,
  REPORT_KINDS,
  RelationsDocSchema,
  SettingCategorySchema,
  SettingIndexSchema,
  SETTING_CATEGORIES,
  type ChapterStatus,
} from "../src/data/schema.ts";
import { chapterNo, nextId } from "../src/data/ids.ts";
import { diffFields } from "../src/data/diff.ts";
import { applySectionOps, assertPreserved, chapterLine, composeDoc, readSectionLines, stripSection } from "../src/data/md.ts";
import { readDoc, writeDoc } from "../src/data/doc.ts";
import { readJsonFile, readText, writeTextAtomic } from "../src/data/io.ts";
import { appendUnderSection } from "../src/data/md.ts";
import { appendSettingRevision, listSettings, upsertSetting } from "../src/data/settings.ts";
import { appendCharacterTimeline, listCharacters, upsertCharacter } from "../src/data/characters.ts";
import { appendRelationHistory, listRelations, upsertRelation } from "../src/data/relations.ts";
import { listEvents, linkEventChapter, refineEvent, setEventStatus, upsertEvent } from "../src/data/events.ts";
import {
  countWords,
  listChapters,
  scanMarkdown,
  syncChapterStatus,
  upsertChapterRecord,
  writeChapterOutline,
  writeChapterReport,
  writeChapterSummary,
  writeChapterText,
} from "../src/data/chapters.ts";
import { assertTransition, TRANSITIONS } from "../src/data/state.ts";
import { appendInbox } from "../src/data/inbox.ts";
import {
  chapterIndexPath,
  characterDocPath,
  eventDocPath,
  inboxPath,
  outlinePath,
  relationsPath,
  settingDocPath,
  settingIndexPath,
} from "../src/data/paths.ts";

const ROOT = join(process.cwd(), ".tmp-data");

function text(path: string): string {
  return readText(path) ?? "";
}

export default function run(): void {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  const root = join(ROOT, "测试书");
  initNovel(root, { title: "测试书", genre: ["科幻"], premise: "一个测试用的小说。" });

  /* ---------------- schema 与校验 ---------------- */

  section("数据 schema 与校验");

  const meta = emptyMeta("书", "shu", ["科幻"], "想法");
  check("合法对象通过校验", isValid(NovelMetaSchema, meta));
  const { title: _t, ...metaNoTitle } = meta;
  check("缺必需字段被拒绝", !isValid(NovelMetaSchema, metaNoTitle));
  check("字段类型错被拒绝", !isValid(NovelMetaSchema, { ...meta, genre: "科幻" }));
  check("多余字段被拒绝", !isValid(NovelMetaSchema, { ...meta, extra: 1 }));
  check("schemaVersion 不为 1 被拒绝", !isValid(NovelMetaSchema, { ...meta, schemaVersion: 2 }));
  check("枚举值越界被拒绝", !isValid(SettingIndexSchema, { schemaVersion: 1, items: [{ id: "S-001", name: "x", category: "magic", summary: "", establishedIn: 0, tags: [], deprecated: false, updatedAt: "" }] }));
  check("嵌套对象的多余字段也被拒绝", !isValid(NovelStateSchema, { ...emptyState(), config: { ...emptyState().config, extra: 1 } }));

  const settingsError = errorOf(() => assertSchema(SettingIndexSchema, { schemaVersion: 1, items: "no" }, "setting/index.json"));
  check("错误文本含被校验对象名", settingsError.includes("setting/index.json"));
  check("错误文本含字段路径与期望", settingsError.includes("/items") && settingsError.includes("must be"));

  const brokenPath = join(ROOT, "broken.json");
  writeTextAtomic(brokenPath, "{ 这不是 JSON ");
  check("读盘遇到非法 JSON 抛错而不是静默返回 null", throws(() => readJsonFile(brokenPath)));
  check("读盘遇到不存在的文件返回 null", readJsonFile(join(ROOT, "nope.json")) === null);

  // 枚举常量列表与 schema 必须互锁：两份手写内容，任一边漂移都要被抓住。
  const enumPairs: Array<[string, readonly string[], (v: string) => boolean]> = [
    ["chapterStatus", CHAPTER_STATUSES, (v) => isValid(ChapterStatusSchema, v)],
    ["settingCategory", SETTING_CATEGORIES, (v) => isValid(SettingCategorySchema, v)],
    ["characterRole", CHARACTER_ROLES, (v) => isValid(CharacterIndexSchema, { schemaVersion: 1, characters: [{ id: "C-001", name: "x", aliases: [], role: v, firstAppeared: 1, status: "alive", lastUpdatedChapter: 1, static: { age: null, gender: "", appearance: "", background: "", personality: "", speechHabits: "", goal: "", fear: "" } }] })],
    ["characterStatus", CHARACTER_STATUSES, (v) => isValid(CharacterIndexSchema, { schemaVersion: 1, characters: [{ id: "C-001", name: "x", aliases: [], role: "minor", firstAppeared: 1, status: v, lastUpdatedChapter: 1, static: { age: null, gender: "", appearance: "", background: "", personality: "", speechHabits: "", goal: "", fear: "" } }] })],
    ["relationStatus", RELATION_STATUSES, (v) => isValid(RelationsDocSchema, { schemaVersion: 1, relations: [{ id: "R-001", from: "C-001", to: "C-002", type: "t", directed: true, status: v, since: 1, history: [] }] })],
    ["eventStatus", EVENT_STATUSES, (v) => isValid(EventIndexSchema, { schemaVersion: 1, events: [{ id: "E-001", title: "t", stage: "s", status: v, order: 1, chapters: [], dependsOn: [], leadsTo: [], characters: [], settings: [], origin: "ai_proposed", plantedIn: null, payoffExpectedAt: null }] })],
    ["eventOrigin", EVENT_ORIGINS, (v) => isValid(EventIndexSchema, { schemaVersion: 1, events: [{ id: "E-001", title: "t", stage: "s", status: "planned", order: 1, chapters: [], dependsOn: [], leadsTo: [], characters: [], settings: [], origin: v, plantedIn: null, payoffExpectedAt: null }] })],
    ["reportKind", REPORT_KINDS, (v) => v === "review" || v === "deai" || v === "reflow"],
  ];
  for (const [label, values, accepts] of enumPairs) {
    check(`${label}：常量列表里每个值都被 schema 接受`, values.every((v) => accepts(v)), values.filter((v) => !accepts(v)).join(", "));
  }
  check("chapterStatus：schema 拒绝列表外的值", !isValid(ChapterStatusSchema, "bogus"));
  check("settingCategory：schema 拒绝列表外的值", !isValid(SettingCategorySchema, "magic"));
  check("characterRole：schema 拒绝列表外的值", !(CHARACTER_ROLES as readonly string[]).includes("boss") && !isValid(CharacterIndexSchema, { schemaVersion: 1, characters: [{ id: "C-001", name: "x", aliases: [], role: "boss", firstAppeared: 1, status: "alive", lastUpdatedChapter: 1, static: { age: null, gender: "", appearance: "", background: "", personality: "", speechHabits: "", goal: "", fear: "" } }] }));
  check("eventStatus：schema 拒绝列表外的值", !(EVENT_STATUSES as readonly string[]).includes("dropped"));
  check("REPORT_KINDS 恰好三个", REPORT_KINDS.length === 3);

  /* ---------------- ID 分配 ---------------- */

  section("ID 分配");

  check("空集合分配 S-001", nextId("setting", []) === "S-001");
  check("最大序号 +1", nextId("setting", ["S-001", "S-002"]) === "S-003");
  check("不回填中间空号", nextId("setting", ["S-001", "S-003"]) === "S-004");
  check("废弃条目不释放 ID（仍占号）", nextId("setting", ["S-001", "S-002", "S-003"]) === "S-004");
  check("序号超过 999 时扩位", nextId("setting", ["S-999"]) === "S-1000");
  check("忽略其他前缀", nextId("setting", ["C-005", "R-002"]) === "S-001");
  check("忽略不合法格式", nextId("setting", ["S-设定", "S-abc"]) === "S-001");
  check("四个前缀各自独立编号", nextId("character", ["S-009"]) === "C-001" && nextId("relation", []) === "R-001" && nextId("event", ["E-007"]) === "E-008");
  check("章节号补零", chapterNo(7) === "007" && chapterNo(12) === "012" && chapterNo(1000) === "1000");

  /* ---------------- 追加式写入 ---------------- */

  section("追加式写入");

  const doc = composeDoc("标题", "正文", [{ title: "记录", lines: ["- A", "- B"] }]);
  const appended = applySectionOps(doc, [{ kind: "append", title: "记录", lines: ["- C"] }], "测试");
  check("追加保留原有行", appended.includes("- A") && appended.includes("- B") && appended.includes("- C"));
  check("追加内容落在目标区段内", (appended.split("## 记录")[1] ?? "").includes("- C"));
  check("追加不改变标题与正文", appended.includes("# 标题") && appended.includes("正文"));

  const twoSections = composeDoc("T", "B", [
    { title: "记录", lines: ["- A"] },
    { title: "其他", lines: ["- X"] },
  ]);
  const appendedTwice = applySectionOps(twoSections, [{ kind: "append", title: "记录", lines: ["- B"] }], "测试");
  check("只动目标区段，后续区段无损", appendedTwice.includes("- A") && appendedTwice.includes("- B") && appendedTwice.includes("- X"));
  check("追加内容不会插到别的区段里", appendedTwice.split("## 其他")[1]?.includes("- B") === false);

  check("锚点不存在时拒绝写入", throws(() => applySectionOps(doc, [{ kind: "append", title: "不存在", lines: ["- C"] }], "测试")));
  check("锚点不存在时不新建区段", !applySectionOps(doc, [{ kind: "append", title: "记录", lines: ["- C"] }], "测试").includes("## 不存在"));

  check("原有行被改动时拒绝（删一行加一行，行数不变）", throws(() => assertPreserved(["- A", "- B"], ["- A", "- C"], "x", "记录")));
  check("原有行被重排序时拒绝", throws(() => assertPreserved(["- A", "- B"], ["- B", "- A"], "x", "记录")));
  check("原有行保留时通过", !throws(() => assertPreserved(["- A", "- B"], ["- A", "- B", "- C"], "x", "记录")));

  const tampered = applySectionOps(composeDoc("T", "B", [{ title: "记录", lines: ["- A", "- B"] }]), [{ kind: "append", title: "记录", lines: ["- C"] }], "测试");
  check("真实写入路径也带保行校验", tampered.includes("- A") && tampered.includes("- B"));

  check("替换区段允许换掉旧行", applySectionOps(composeDoc("T", "B", [{ title: "描述", lines: ["旧的"] }]), [{ kind: "replace", title: "描述", lines: ["新的"] }], "测试").includes("新的"));
  check("stripSection 剥掉区段及其后内容", !stripSection(composeDoc("T", "B", [{ title: "尾", lines: ["- Z"] }]), "尾").includes("- Z"));
  check("readSectionLines 丢掉空行", readSectionLines(composeDoc("T", "B", [{ title: "记录", lines: ["- A", "", "- B"] }]), "记录").length === 2);
  check("chapterLine 格式化章节号", chapterLine(3, "x") === "- [CH-003] x");

  /* ---------------- 资料写入 · 设定 ---------------- */

  section("资料写入：设定");

  const s1 = upsertSetting(root, { name: "异能等级", category: "world_rule", summary: "一到九级", body: "分级详述。" });
  check("新建设定条目分配 S-001", s1.id === "S-001" && s1.created);
  check("索引与详述都被写入", text(settingIndexPath(root)).includes("S-001") && text(settingDocPath(root, "S-001")).includes("分级详述"));
  check("新建时写入「建立」修订记录", text(settingDocPath(root, "S-001")).includes("建立：一到九级"));
  check("索引里记录 establishedIn 默认 0", listSettings(root)[0]?.establishedIn === 0);

  const s2 = upsertSetting(root, { name: "研究所", category: "location", summary: "海边的研究所", body: "详述。" });
  check("第二个条目分配 S-002", s2.id === "S-002");
  check("更新已有条目不新分配 ID", upsertSetting(root, { id: "S-001", name: "异能等级", category: "world_rule", summary: "一到九级", body: "改过的详述。" }).id === "S-001");
  check("更新后索引条数不变", listSettings(root).length === 2);
  check("更新覆盖详述正文", text(settingDocPath(root, "S-001")).includes("改过的详述"));

  appendSettingRevision(root, "S-001", 11, "补充：越级使用会反噬。");
  check("修订记录追加成功", text(settingDocPath(root, "S-001")).includes("补充：越级使用会反噬"));
  check("原有修订记录不丢", text(settingDocPath(root, "S-001")).includes("建立：一到九级"));
  check("更新条目后修订记录仍保留（先写 md 后写索引的副作用之一）", text(settingDocPath(root, "S-001")).includes("补充：越级使用会反噬"));

  const missingId = errorOf(() => upsertSetting(root, { id: "S-099", name: "x", category: "item", summary: "s", body: "b" }));
  check("引用不存在的 ID 被拒绝", missingId !== "");
  check("错误文本给出最接近的候选", missingId.includes("S-001") || missingId.includes("S-002"));
  check("追加修订到不存在的条目被拒绝", throws(() => appendSettingRevision(root, "S-098", 1, "x")));

  // 双写顺序：让详述 md 写入必然失败，断言索引没被写下去 ——
  // 反过来（先写 index）会留下「索引有、文件无」的坏引用，而那是不可恢复的。
  const orderRoot = join(ROOT, "顺序书");
  initNovel(orderRoot, { title: "顺序书", genre: [], premise: "p" });
  rmSync(settingDocPath(orderRoot, "S-001"), { force: true });
  mkdirSync(settingDocPath(orderRoot, "S-001"), { recursive: true });
  check("详述 md 写入失败时确实抛错", throws(() => upsertSetting(orderRoot, { name: "先写 md", category: "item", summary: "s", body: "b" })));
  check("详述 md 写入失败时索引没有被写入（不留坏引用）", listSettings(orderRoot).length === 0);

  /* ---------------- 资料写入 · 人物与关系 ---------------- */

  section("资料写入：人物与关系");

  const c1 = upsertCharacter(root, { name: "李明", role: "protagonist", static: { age: 34, gender: "男", goal: "查清真相" } }, 1);
  check("新建人物分配 C-001", c1.id === "C-001" && c1.created);
  const c2 = upsertCharacter(root, { name: "张局", role: "supporting" }, 2);
  check("第二个人物分配 C-002", c2.id === "C-002");
  check("静态档案写入索引", listCharacters(root)[0]?.static.age === 34);
  check("未提供的静态字段用默认值补齐", listCharacters(root)[1]?.static.appearance === "");
  check("新建人物时记录 firstAppeared", listCharacters(root)[0]?.firstAppeared === 1);

  upsertCharacter(root, { id: "C-001", name: "李明", role: "protagonist", status: "dead", static: { goal: "改成新目标" } }, 3);
  const updated = listCharacters(root)[0];
  check("更新人物静态档案是增量的（未传的字段保留）", updated?.static.age === 34);
  check("更新人物可改 status", updated?.status === "dead");
  check("更新不改变 firstAppeared", updated?.firstAppeared === 1);

  appendCharacterTimeline(root, "C-001", 1, "在码头发现异常货箱。");
  check("时间轴追加成功", text(characterDocPath(root, "C-001")).includes("在码头发现异常货箱"));
  check("时间轴追加推进 lastUpdatedChapter", listCharacters(root)[0]?.lastUpdatedChapter === 1);
  appendCharacterTimeline(root, "C-001", 7, "向张局汇报。");
  check("时间轴第二次追加保留第一条", text(characterDocPath(root, "C-001")).includes("在码头发现异常货箱") && text(characterDocPath(root, "C-001")).includes("向张局汇报"));
  check("lastUpdatedChapter 取较大值", listCharacters(root)[0]?.lastUpdatedChapter === 7);
  check("追加时间轴到不存在的人物被拒绝", throws(() => appendCharacterTimeline(root, "C-099", 1, "x")));

  const r1 = upsertRelation(root, { from: "C-001", to: "C-002", type: "subordinate", status: "active" }, ["C-001", "C-002"], 1);
  check("新建关系分配 R-001", r1.id === "R-001" && r1.created);
  check("关系落盘", text(relationsPath(root)).includes("R-001"));
  check("关系引用不存在的人物被拒绝", throws(() => upsertRelation(root, { from: "C-001", to: "C-099", type: "x" }, ["C-001", "C-002"], 1)));
  check("关系变更史追加", !throws(() => appendRelationHistory(root, "R-001", 7, "改为直接向张局汇报", "active")));
  appendRelationHistory(root, "R-001", 8, "决裂。", "broken");
  check("关系变更史累积，旧记录保留", listRelations(root)[0]?.history.length === 2);
  check("关系当前状态随之更新", listRelations(root)[0]?.status === "broken");
  check("追加变更到不存在的关系被拒绝", throws(() => appendRelationHistory(root, "R-099", 1, "x")));

  /* ---------------- 资料写入 · 事件 ---------------- */

  section("资料写入：事件");

  const e1 = upsertEvent(
    root,
    { title: "发现信号", stage: "第一幕", origin: "user_specified", characters: ["C-001"], settings: ["S-001"] },
    { characters: ["C-001"], settings: ["S-001"] },
  );
  check("新建事件分配 E-001", e1.id === "E-001" && e1.created);
  const e2 = upsertEvent(root, { title: "确认事态", stage: "第一幕", origin: "ai_proposed", dependsOn: ["E-001"] }, { characters: [], settings: [] });
  check("第二个事件分配 E-002", e2.id === "E-002");
  check("order 自动递增（新建排在最后）", (listEvents(root)[1]?.order ?? 0) > (listEvents(root)[0]?.order ?? 0));
  check("事件的涉及字段落盘", listEvents(root)[0]?.characters[0] === "C-001");
  check("dependsOn 引用不存在的事件被拒绝", throws(() => upsertEvent(root, { title: "x", stage: "s", origin: "ai_proposed", dependsOn: ["E-099"] }, { characters: [], settings: [] })));
  check("characters 引用不存在的人物被拒绝", throws(() => upsertEvent(root, { title: "x", stage: "s", origin: "ai_proposed", characters: ["C-099"] }, { characters: ["C-001"], settings: [] })));
  check("settings 引用不存在的设定被拒绝", throws(() => upsertEvent(root, { title: "x", stage: "s", origin: "ai_proposed", settings: ["S-099"] }, { characters: [], settings: ["S-001"] })));

  refineEvent(root, "E-001", 11, "第一次细化：李明发现规律信号。");
  check("细化写入当前描述", text(eventDocPath(root, "E-001")).includes("第一次细化"));
  refineEvent(root, "E-001", 12, "第二次细化：确认信号来自海底遗迹。");
  const eventDoc = text(eventDocPath(root, "E-001"));
  check("细化覆盖当前描述（最新版本）", eventDoc.split("## 当前描述")[1]?.includes("第二次细化") === true);
  check("细化把旧描述压进细化历史", eventDoc.includes("第一次细化") && eventDoc.includes("第二次细化"));
  check("细化历史按章节记录", eventDoc.includes("[CH-011]") && eventDoc.includes("[CH-012]"));

  check("改事件状态", !throws(() => setEventStatus(root, "E-001", "done")) && listEvents(root)[0]?.status === "done");
  check("改不存在的事件状态被拒绝", throws(() => setEventStatus(root, "E-099", "done")));

  // 章节记录必须先存在，否则 primaryEventId 会静默丢失。
  check("章节记录不存在时挂主事件被拒绝（不静默丢失）", throws(() => linkEventChapter(root, "E-001", 11, true)));
  upsertChapterRecord(root, { chapter: 11, title: "信号" }, false);
  check("章节记录存在后可以挂事件", !throws(() => linkEventChapter(root, "E-001", 11, true)));
  check("事件侧记录章节", listEvents(root)[0]?.chapters.includes(11) === true);
  check("章节侧记录主事件", listChapters(root)[0]?.primaryEventId === "E-001");
  check("事件详述的「涉及」同步章节", text(eventDocPath(root, "E-001")).includes("CH-011"));
  linkEventChapter(root, "E-001", 11, true);
  check("重复关联不产生重复章节", listEvents(root)[0]?.chapters.filter((n) => n === 11).length === 1);

  const f1 = upsertEvent(root, { title: "神秘来电", stage: "第一幕", origin: "foreshadow", plantedIn: 11, payoffExpectedAt: 20 }, { characters: [], settings: [] });
  check("伏笔用同一结构建立", listEvents(root).some((e) => e.id === f1.id && e.plantedIn === 11 && e.payoffExpectedAt === 20));
  check("非伏笔事件不能带伏笔字段", throws(() => upsertEvent(root, { title: "x", stage: "s", origin: "ai_proposed", plantedIn: 3 }, { characters: [], settings: [] })));
  check("非伏笔可以显式给 null 伏笔字段", !throws(() => upsertEvent(root, { title: "x2", stage: "s", origin: "ai_proposed", plantedIn: null, payoffExpectedAt: null }, { characters: [], settings: [] })));

  /* ---------------- 资料写入 · 章节与收件箱 ---------------- */

  section("资料写入：章节");

  writeChapterOutline(root, { chapter: 12, title: "汇报", markdown: "<!-- novelmaster:outline\ncharacters: [C-001]\n-->\n正文大纲" });
  check("章节大纲落盘", text(join(root, "chapters", "012.outline.md")).includes("正文大纲"));
  check("章节大纲同时建了章节记录", listChapters(root).some((c) => c.no === 12));
  writeChapterOutline(root, { chapter: 12, title: "汇报", markdown: "改过的大纲", confirmNote: "用户确认" });
  const outlineDoc = text(join(root, "chapters", "012.outline.md"));
  check("确认记录写入", outlineDoc.includes("用户确认"));
  check("重新写大纲保留确认记录", outlineDoc.includes("用户确认") && outlineDoc.includes("改过的大纲"));
  check("确认记录区段由代码生成，重复写入不叠加", outlineDoc.split("用户确认").length === 2);

  check("正文校验能识别标题", scanMarkdown("# 标题").length === 1);
  check("正文校验能识别加粗", scanMarkdown("这是**重点**。").length === 1);
  check("正文校验能识别列表", scanMarkdown("- 项目").length === 1);
  check("正文校验能识别引用", scanMarkdown("> 引用").length === 1);
  check("正文校验能识别代码", scanMarkdown("`code`").length === 1);
  check("干净的正文没有命中", scanMarkdown("他说：\"走吧。\"\n她点头。").length === 0);

  const clean = writeChapterText(root, { chapter: 12, text: "这是干净的正文。\n" });
  check("干净正文直接落盘", clean.written && text(join(root, "chapters", "012.txt")).includes("干净的正文"));
  check("字数统计忽略空白", countWords("一二三 四\n五") === 5);
  check("写正文推进 revisionCount", listChapters(root).find((c) => c.no === 12)?.revisionCount === 1);
  check("写正文更新 wordCount", (listChapters(root).find((c) => c.no === 12)?.wordCount ?? 0) > 0);

  const hit = writeChapterText(root, { chapter: 12, text: "# 带标题的正文\n" });
  check("命中 markdown 时不落盘", !hit.written && hit.hits.length === 1);
  check("命中时返回行号与片段", hit.hits[0]?.line === 1 && (hit.hits[0]?.snippet ?? "").includes("带标题"));
  check("命中后原正文未被覆盖", text(join(root, "chapters", "012.txt")).includes("干净的正文"));
  const acked = writeChapterText(root, { chapter: 12, text: "# 带标题的正文\n", acknowledgeMarkdown: true });
  check("用户确认后落盘", acked.written && text(join(root, "chapters", "012.txt")).includes("带标题"));
  const countBefore = listChapters(root).find((c) => c.no === 12)?.revisionCount ?? 0;
  writeChapterText(root, { chapter: 12, text: "**x**" });
  check("未落盘时不推进 revisionCount", (listChapters(root).find((c) => c.no === 12)?.revisionCount ?? 0) === countBefore);

  writeChapterSummary(root, 12, {
    synopsis: "李明向张局汇报。",
    appearedCharacters: ["C-001"],
    appearedLocations: ["S-002"],
    advancedEvents: [{ id: "E-002", note: "细化一档" }],
    newSettings: [],
    newForeshadows: ["E-003"],
    endState: "张局要求组建研究团队。",
  });
  const summaryDoc = text(join(root, "chapters", "012.summary.md"));
  check("摘要小节标题由代码生成", ["## 出场", "## 推进", "## 新增信息", "## 结尾状态"].every((h) => summaryDoc.includes(h)));
  check("摘要内容落盘", summaryDoc.includes("李明向张局汇报") && summaryDoc.includes("E-002"));

  writeChapterReport(root, 12, "review", "问题清单");
  writeChapterReport(root, 12, "deai", "命中清单");
  writeChapterReport(root, 12, "reflow", "回填记录");
  check("review 报告落到 .review.md", text(join(root, "chapters", "012.review.md")).includes("问题清单"));
  check("deai 报告落到 .deai.md", text(join(root, "chapters", "012.deai.md")).includes("命中清单"));
  check("reflow 报告落到 .reflow.md", text(join(root, "chapters", "012.reflow.md")).includes("回填记录"));

  syncChapterStatus(root, 12, "accepted");
  check("状态同步到章节索引（派生字段）", listChapters(root).find((c) => c.no === 12)?.status === "accepted");
  check("同步到 accepted 时记 acceptedAt", listChapters(root).find((c) => c.no === 12)?.acceptedAt !== null);

  appendInbox(root, "也许可以加一个内鬼线。", ["脑洞"]);
  check("收件箱追加成功", text(inboxPath(root)).includes("也许可以加一个内鬼线") && text(inboxPath(root)).includes("#脑洞"));
  appendInbox(root, "第二条。");
  check("收件箱第二次追加保留第一条", text(inboxPath(root)).includes("也许可以加一个内鬼线") && text(inboxPath(root)).includes("第二条"));

  check("主线大纲的修订记录区段存在", text(outlinePath(root)).includes("## 修订记录"));
  check("追加大纲修订记录", !throws(() => appendUnderSection(outlinePath(root), "修订记录", ["- [CH-001] 测试"])) && text(outlinePath(root)).includes("测试"));

  /* ---------------- 写入差异 ---------------- */

  section("写入差异");

  check("diffFields：新建（before 为 undefined）不产生 diff", diffFields(undefined, { a: 1 }, ["a"]).length === 0);
  check("diffFields：未变字段不入列", diffFields({ a: 1, b: 2 }, { a: 1, b: 3 }, ["a", "b"]).length === 1);
  check("diffFields：boolean 渲染为 是/否", diffFields({ d: false }, { d: true }, ["d"])[0]?.to === "是");
  check("diffFields：数组用顿号连接", diffFields({ t: [] }, { t: ["甲", "乙"] }, ["t"])[0]?.to === "甲、乙");
  check("diffFields：空数组显式为（空）", diffFields({ t: ["甲"] }, { t: [] }, ["t"])[0]?.to === "（空）");
  check("diffFields：长字符串只报长度", diffFields({ b: "短" }, { b: "字".repeat(200) }, ["b"])[0]?.to === "200 字");
  check("diffFields：null 渲染为（无）", diffFields({ a: 1 }, { a: null }, ["a"])[0]?.to === "（无）");

  const created2 = upsertSetting(root, { name: "新条目", category: "item", summary: "新建摘要", body: "新建详述。" });
  check("新建时 changes 为空（没有 diff 可报）", created2.changes.length === 0);

  const updated2 = upsertSetting(root, {
    id: created2.id,
    name: "新条目",
    category: "item",
    summary: "改过的摘要",
    body: "新建详述。",
  });
  check("更新时列出变化的字段", updated2.changes.some((c) => c.field === "summary"));
  check("diff 带 before 与 after", updated2.changes.find((c) => c.field === "summary")?.from === "新建摘要" && updated2.changes.find((c) => c.field === "summary")?.to === "改过的摘要");
  check("未变字段不出现在 diff 里", !updated2.changes.some((c) => c.field === "name"));

  const noop = upsertSetting(root, { id: created2.id, name: "新条目", category: "item", summary: "改过的摘要", body: "新建详述。" });
  check("传入相同值时 changes 为空（「没有实际变化」可被机器判定）", noop.changes.length === 0);

  const bodyChanged = upsertSetting(root, { id: created2.id, name: "新条目", category: "item", summary: "改过的摘要", body: "字".repeat(200) });
  check("详述变化被 diff 捕获", bodyChanged.changes.some((c) => c.field === "body"));
  check("详述只报长度不贴全文", bodyChanged.changes.find((c) => c.field === "body")?.to === "200 字");

  upsertSetting(root, { id: created2.id, name: "新条目", category: "item", summary: "改过的摘要", body: "新建详述。", tags: ["甲", "乙"], deprecated: true });
  const tagged = listSettings(root).find((item) => item.id === created2.id);
  check("tags 可写入", tagged?.tags.join("/") === "甲/乙");
  check("deprecated 可写入（废止而不是删除）", tagged?.deprecated === true);
  check("废止的条目仍在索引里", listSettings(root).some((item) => item.id === created2.id));

  const resurrected = upsertSetting(root, {
    id: created2.id,
    name: "新条目",
    category: "item",
    summary: "改过的摘要",
    body: "新建详述。",
    tags: ["甲", "乙"],
    deprecated: false,
  });
  check("deprecated 可改回 false", listSettings(root).find((item) => item.id === created2.id)?.deprecated === false);
  check("取消废止也是一次可报告的 diff", resurrected.changes.some((c) => c.field === "deprecated" && c.from === "是" && c.to === "否"));

  // 注意：C-001 在前面的测试里已经被改成 dead 了，所以这里测的是 dead → alive。
  const c1Changed = upsertCharacter(root, { id: "C-001", name: "李明", role: "protagonist", status: "alive", static: { goal: "新目标" } }, 3);
  check("人物更新产生 diff", c1Changed.changes.length > 0);
  check("人物 diff 能看到状态变化", c1Changed.changes.some((c) => c.field === "status" && c.from === "dead" && c.to === "alive"));
  check("人物 diff 能看到静态档案变化", c1Changed.changes.some((c) => c.field === "goal"));

  // R-001 的 status 在前面的测试里已经是 broken，所以这里测 broken → ended。
  const r1Changed = upsertRelation(root, { id: "R-001", from: "C-001", to: "C-002", type: "subordinate", status: "ended" }, ["C-001", "C-002"], 1);
  check("关系更新产生 diff", r1Changed.changes.some((c) => c.field === "status" && c.from === "broken" && c.to === "ended"));

  /* ---------------- 元信息 ---------------- */

  section("元信息");

  check("初始 logline 为空", openNovelAt(root)?.meta.logline === "");
  check("初始 pov / tense 有默认值", openNovelAt(root)?.meta.pov === "第三人称限知" && openNovelAt(root)?.meta.tense === "过去时");

  const metaChange = updateMeta(root, { logline: "一段深海信号引出的真相。", pov: "第三人称限知", tense: "过去时" });
  check("更新 logline 产生 diff", metaChange.changes.some((c) => c.field === "logline"));
  check("未变字段不入 diff", !metaChange.changes.some((c) => c.field === "pov" || c.field === "tense"));
  check("logline 已落盘", openNovelAt(root)?.meta.logline === "一段深海信号引出的真相。");

  check("传入相同值时无 diff", updateMeta(root, { logline: "一段深海信号引出的真相。" }).changes.length === 0);

  const metaPov = updateMeta(root, { pov: "第一人称" });
  check("可改 pov", openNovelAt(root)?.meta.pov === "第一人称" && metaPov.changes.some((c) => c.field === "pov"));
  check("改 pov 不影响 logline", openNovelAt(root)?.meta.logline === "一段深海信号引出的真相。");
  check("可改 tense", updateMeta(root, { tense: "现在时" }).changes.some((c) => c.field === "tense"));

  check("meta 更新不改 premise（一切推断的根）", openNovelAt(root)?.meta.premise === "一个测试用的小说。");
  check("meta 更新不改 title（书名对应目录名）", openNovelAt(root)?.meta.title === "测试书");
  check("meta 更新不动其他字段的 schemaVersion", openNovelAt(root)?.meta.schemaVersion === 1);

  /* ---------------- 章状态机 ---------------- */

  section("章状态机");

  const allStatuses = Object.keys(TRANSITIONS) as ChapterStatus[];
  check("转移表覆盖全部 10 个状态", allStatuses.length === 10);
  for (const from of allStatuses) {
    for (const to of TRANSITIONS[from]) {
      check(`${from} → ${to} 合法`, !throws(() => assertTransition(from, to)));
    }
  }
  check("drafted → accepted 被拒绝", throws(() => assertTransition("drafted", "accepted")));
  check("not_started → accepted 被拒绝", throws(() => assertTransition("not_started", "accepted")));
  check("同状态转移被拒绝", throws(() => assertTransition("drafted", "drafted")));
  check("非法转移的错误文本含当前状态", errorOf(() => assertTransition("drafted", "accepted")).includes("drafted"));
  check("非法转移的错误文本含目标状态", errorOf(() => assertTransition("drafted", "accepted")).includes("accepted"));
  check("非法转移的错误文本含允许的目标", errorOf(() => assertTransition("drafted", "accepted")).includes("auto_reviewed"));
  check("同状态转移的错误文本说明原因", errorOf(() => assertTransition("drafted", "drafted")).includes("没有变化"));
  check("reflowed → awaiting_user_review 允许用户继续改", !throws(() => assertTransition("reflowed", "awaiting_user_review")));
  check("awaiting_user_review → reflowed 允许未改稿直接回填", !throws(() => assertTransition("awaiting_user_review", "reflowed")));
  check("ai_revised 必须重新走审查", !throws(() => assertTransition("ai_revised", "auto_reviewed")) && throws(() => assertTransition("ai_revised", "awaiting_user_review")));

  /* ---------------- 校验读盘与索引 ---------------- */

  section("读盘校验");

  const readBack = readDoc(settingIndexPath(root), SettingIndexSchema, "setting/index.json");
  check("readDoc 返回校验通过的数据", readBack.items.some((item) => item.id === "S-001"));
  writeTextAtomic(settingIndexPath(root), JSON.stringify({ schemaVersion: 1, items: [{ id: "S-001" }] }));
  check("readDoc 对结构非法的文件抛错", throws(() => readDoc(settingIndexPath(root), SettingIndexSchema, "setting/index.json")));
  check("readDocOrNull 对非法文件同样抛错（不静默返回 null）", throws(() => listSettings(root)));
  const badValue: unknown = JSON.parse("{ \"schemaVersion\": 1, \"items\": [{}] }");
  check("writeDoc 拒绝写入非法数据", throws(() => writeDoc(settingIndexPath(root), SettingIndexSchema, badValue as never, "setting/index.json")));

  rmSync(ROOT, { recursive: true, force: true });
}
