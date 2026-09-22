/**
 * 工具层与写入护栏测试。
 *
 * 全程直接调工具的 `execute()`，不经模型 —— 断言因此是确定且零成本的
 * （见 docs/design/architecture.md「调试方法」）。
 */

import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { check, section, throws } from "./harness.ts";
import { novelMasterExtension } from "../src/extension/index.ts";
import { ALL_TOOLS, TOOL_NAMES } from "../src/tools/index.ts";
import { resetFailures } from "../src/tools/helper.ts";
import { initNovel } from "../src/data/init.ts";
import { operationsPath, settingIndexPath, statePath, writeConfig } from "../src/data/paths.ts";
import { readText } from "../src/data/io.ts";
import { openNovelAt } from "../src/data/novel.ts";

const ROOT = join(process.cwd(), ".tmp-tools");

interface CallResult {
  text: string;
  isError: boolean;
  details: Record<string, unknown>;
}

function toolByName(name: string) {
  const found = ALL_TOOLS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`没有注册工具 ${name}`);
  return found;
}

function makeCtx(cwd: string): ExtensionContext {
  return { cwd, ui: { setStatus: () => {} } } as unknown as ExtensionContext;
}

async function call(name: string, params: unknown, cwd = ROOT): Promise<CallResult> {
  const raw = await toolByName(name).execute("test-call", params as never, undefined, undefined, makeCtx(cwd));
  const result = raw as {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
    isError?: boolean;
  };
  return {
    text: result.content.map((part) => part.text ?? "").join("\n"),
    isError: result.isError === true,
    details: (result.details ?? {}) as Record<string, unknown>,
  };
}

/** 截取操作留痕的行数，用于断言「哪些操作会留痕」。 */
function logLines(): number {
  const text = readText(operationsPath(join(ROOT, "工具书"))) ?? "";
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

export default async function run(): Promise<void> {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  resetFailures();

  /* ---------------- 装配与注册 ---------------- */

  section("工具层：装配");

  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();

  const pi = {
    registerCommand: () => {},
    registerTool: () => {},
    sendMessage: () => {},
    on: (event: string, handler: (e: unknown, c: unknown) => unknown) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
  } as unknown as ExtensionAPI;

  novelMasterExtension(pi);

  check("注册了 19 个 novel_* 工具", TOOL_NAMES.length === 19, `实际 ${TOOL_NAMES.length}：${TOOL_NAMES.join(", ")}`);
  check("工具名无重复", new Set(TOOL_NAMES).size === TOOL_NAMES.length);
  check("工具名都以 novel_ 开头", TOOL_NAMES.every((name) => name.startsWith("novel_")));
  check("注册了 tool_call 护栏钩子", handlers.has("tool_call"));

  /* ---------------- 未打开小说 ---------------- */

  section("工具层：未打开小说");

  writeConfig(ROOT, { novelRoot: null });
  const noNovel = await call("novel_setting_upsert", { name: "x", category: "item", summary: "s", body: "b" });
  check("写工具在未打开小说时报错", noNovel.isError);
  check("错误文本提示先 /init", noNovel.text.includes("/init"));
  const noNovelRead = await call("novel_read_index", { kind: "setting" });
  check("读索引在未打开小说时同样报错（不返回空结果）", noNovelRead.isError);

  /* ---------------- 正常写入与留痕 ---------------- */

  section("工具层：写入与留痕");

  const novelRoot = join(ROOT, "工具书");
  initNovel(novelRoot, { title: "工具书", genre: [], premise: "测试。" });
  writeConfig(ROOT, { novelRoot });
  resetFailures();

  const before = logLines();
  const created = await call("novel_setting_upsert", {
    name: "异能等级",
    category: "world_rule",
    summary: "一到九级",
    body: "分级详述。",
  });
  check("新建条目成功", !created.isError && created.text.includes("S-001"));
  check("新条目的 details 带 id", created.details.id === "S-001" && created.details.created === true);
  check("写操作留痕", logLines() === before + 1);

  const log = readText(operationsPath(novelRoot)) ?? "";
  const lastLine = log.trim().split("\n").at(-1) ?? "";
  check("留痕含工具名", lastLine.includes("novel_setting_upsert"));
  check("留痕含相对路径", lastLine.includes("setting/S-001.md"));
  check("留痕 actor 恒为 llm", lastLine.includes("\"actor\":\"llm\""));
  check("留痕含时间戳", lastLine.includes("\"ts\""));

  const afterWrite = logLines();
  const readResult = await call("novel_read_index", { kind: "setting" });
  check("读索引返回内容", !readResult.isError && readResult.text.includes("S-001"));
  check("读操作不留痕", logLines() === afterWrite);

  const failedWrite = await call("novel_setting_upsert", {
    id: "S-099",
    name: "x",
    category: "item",
    summary: "s",
    body: "b",
  });
  check("引用不存在的 ID 时返回可操作错误", failedWrite.isError && failedWrite.text.includes("S-001"));
  check("失败的写操作不留痕", logLines() === afterWrite);

  /* ---------------- 参数 schema ---------------- */

  section("工具层：参数 schema");

  const upsertParams = toolByName("novel_setting_upsert").parameters;
  check("多余参数被拒绝", !Value.Check(upsertParams, { name: "x", category: "item", summary: "s", body: "b", extra: 1 }));
  check("缺必需参数被拒绝", !Value.Check(upsertParams, { name: "x", summary: "s", body: "b" }));
  check("枚举越界被拒绝", !Value.Check(upsertParams, { name: "x", category: "magic", summary: "s", body: "b" }));
  check("合法参数通过", Value.Check(upsertParams, { name: "x", category: "item", summary: "s", body: "b" }));

  const indexParams = toolByName("novel_read_index").parameters;
  check("read_index 的 kind 恰好 5 个合法值", (["setting", "character", "relation", "event", "chapter"] as const).every((k) => Value.Check(indexParams, { kind: k })));
  check("read_index 拒绝非法 kind", !Value.Check(indexParams, { kind: "unknown" }));

  const summaryParams = toolByName("novel_chapter_summary_write").parameters;
  check("摘要参数要求结构化 sections", !Value.Check(summaryParams, { chapter: 1, sections: "一段 markdown" }));
  check("摘要参数接受结构化 sections", Value.Check(summaryParams, {
    chapter: 1,
    sections: { synopsis: "s", appearedCharacters: [], appearedLocations: [], advancedEvents: [], newSettings: [], newForeshadows: [], endState: "e" },
  }));

  /* ---------------- 正文两段式 ---------------- */

  section("工具层：正文两段式确认");

  await call("novel_chapter_outline_write", { chapter: 1, title: "开端", markdown: "大纲正文" });
  const pending = await call("novel_chapter_write", { chapter: 1, text: "# 标题\n正文" });
  check("命中 markdown 时不落盘且不报错", !pending.isError && pending.details.written === false);
  check("返回命中清单供转述给用户", pending.text.includes("第 1 行") && pending.text.includes("acknowledgeMarkdown"));
  check("未确认时文件不存在", (readText(join(novelRoot, "chapters", "001.txt")) ?? "") === "");
  const confirmed = await call("novel_chapter_write", { chapter: 1, text: "# 标题\n正文", acknowledgeMarkdown: true });
  check("确认后落盘", !confirmed.isError && confirmed.details.written === true);
  check("确认后文件有内容", (readText(join(novelRoot, "chapters", "001.txt")) ?? "").includes("正文"));

  /* ---------------- 状态机 ---------------- */

  section("工具层：状态机");

  const stateBefore = openNovelAt(novelRoot)?.state.chapterStatus;
  check("写正文不会自作主张改章状态", stateBefore === "not_started", String(stateBefore));
  const illegal = await call("novel_state_update", { chapterStatus: "accepted" });
  check("非法转移被拒绝", illegal.isError);
  check("非法转移的提示含允许目标", illegal.text.includes("outlined"));
  const onlyReflow = await call("novel_state_update", { pendingReflow: true });
  check("只改 pendingReflow 合法（不触发转移校验）", !onlyReflow.isError);
  check("pendingReflow 已落盘", openNovelAt(novelRoot)?.state.pendingReflow === true);
  const advance = await call("novel_state_update", { chapterStatus: "outlined" });
  check("合法转移通过", !advance.isError);
  check("状态已落盘", openNovelAt(novelRoot)?.state.chapterStatus === "outlined");
  const sameAgain = await call("novel_state_update", { chapterStatus: "outlined" });
  check("同状态转移被拒绝", sameAgain.isError);
  const badEvent = await call("novel_state_update", { currentEventId: "E-099" });
  check("currentEventId 引用不存在的事件被拒绝", badEvent.isError);

  /* ---------------- diff 摘要 ---------------- */

  section("工具层：diff 摘要");

  const newItem = await call("novel_setting_upsert", {
    name: "新条目",
    category: "item",
    summary: "初始摘要",
    body: "初始详述。",
  });
  check("新建的返回文本说清建了什么", newItem.text.includes("已新建设定条目") && newItem.text.includes("新条目"));
  check("新建的返回文本不含 diff", !newItem.text.includes("→"));

  const changed = await call("novel_setting_upsert", {
    id: "S-002",
    name: "新条目",
    category: "item",
    summary: "改过的摘要",
    body: "初始详述。",
  });
  check("更新的返回文本列出变化字段", changed.text.includes("summary") && changed.text.includes("初始摘要") && changed.text.includes("改过的摘要"));
  check("diff 用 → 表示变化方向", changed.text.includes("→"));
  check("details 里也带 changes（供上游消费）", Array.isArray(changed.details.changes));

  const sameAgain2 = await call("novel_setting_upsert", {
    id: "S-002",
    name: "新条目",
    category: "item",
    summary: "改过的摘要",
    body: "初始详述。",
  });
  check("无实际变化时明确告知（而不是报「已更新」）", sameAgain2.text.includes("没有实际变化"));

  const deprecated2 = await call("novel_setting_upsert", {
    id: "S-002",
    name: "新条目",
    category: "item",
    summary: "改过的摘要",
    body: "初始详述。",
    tags: ["甲"],
    deprecated: true,
  });
  check("工具能废止条目", deprecated2.text.includes("deprecated") && deprecated2.text.includes("是"));
  check("工具能写 tags", deprecated2.text.includes("tags") && deprecated2.text.includes("甲"));

  const newPerson = await call("novel_character_upsert", { name: "王五", role: "minor" });
  check("人物新建也走同一套渲染", newPerson.text.includes("已新建人物") && newPerson.text.includes("王五"));
  const personChanged = await call("novel_character_upsert", { id: "C-001", name: "李明", role: "protagonist", status: "dead" });
  check("人物更新返回 diff", personChanged.text.includes("status") && personChanged.text.includes("→"));

  /* ---------------- 连续失败熔断 ---------------- */

  section("工具层：连续失败熔断");

  resetFailures();
  for (let i = 0; i < 3; i++) {
    await call("novel_setting_upsert", { id: "S-098", name: "x", category: "item", summary: "s", body: "b" });
  }
  const third = await call("novel_setting_upsert", { id: "S-098", name: "x", category: "item", summary: "s", body: "b" });
  check("达到阈值后提示停止重试", third.text.includes("连续失败"));
  check("提示要求告知用户", third.text.includes("用户"));
  resetFailures();

  /* ---------------- 写入护栏 ---------------- */

  section("写入护栏");

  const guardHandlers = handlers.get("tool_call") ?? [];
  function guard(toolName: string, input: Record<string, unknown>, cwd = ROOT): { block?: boolean; reason?: string } | undefined {
    const event = { toolName, toolCallId: "t", input };
    const ctx = { cwd, hasUI: false, ui: { notify: () => {} } };
    for (const handler of guardHandlers) {
      const decision = handler(event, ctx);
      if (decision !== undefined && decision !== null) return decision as { block?: boolean; reason?: string };
    }
    return undefined;
  }

  check("write 写 meta.json 被阻断", guard("write", { path: join(novelRoot, "meta.json") })?.block === true);
  check("edit 写设定条目被阻断", guard("edit", { path: join(novelRoot, "setting", "S-001.md") })?.block === true);
  check("write 写正文被阻断", guard("write", { path: join(novelRoot, "chapters", "001.txt") })?.block === true);
  check("相对路径写小说根也被阻断", guard("write", { path: join("工具书", "state.json") })?.block === true);
  check("阻断提示指明改用 novel_* 工具", (guard("write", { path: join(novelRoot, "meta.json") })?.reason ?? "").includes("novel_"));
  check("write 写小说根之外放行", guard("write", { path: join(ROOT, "outside.txt") }) === undefined);
  check("写别的目录下同名的 meta.json 放行", guard("write", { path: join(ROOT, "other", "meta.json") }) === undefined);
  check("read 读小说根下的文件放行", guard("read", { path: join(novelRoot, "meta.json") }) === undefined);
  check("grep / find / ls 放行", guard("grep", { pattern: "x" }) === undefined && guard("find", { pattern: "x" }) === undefined && guard("ls", { path: "." }) === undefined);
  check("novel_* 工具不受护栏影响", guard("novel_setting_upsert", { name: "x", category: "item", summary: "s", body: "b" }) === undefined);

  // shell 是**刻意保留**的能力：关掉它能堵住「用 bash 手写 JSON」这条路，
  // 但代价（AI 不能跑 git / 查日志 / 跑测试）远大于收益。这几条断言把那个决定锁住，
  // 以防将来有人「顺手」再把 bash 关掉。（见 docs/design/data.md「写入护栏」）
  check("bash 不被护栏拦", guard("bash", { command: "ls" }) === undefined);
  check("powershell 不被护栏拦", guard("powershell", { command: "dir" }) === undefined);
  check("bash 命令里写了小说根路径也不拦（护栏只管 write/edit）", guard("bash", { command: `echo x > ${join(novelRoot, "meta.json")}` }) === undefined);

  /* ---------------- 落盘正确性 ---------------- */

  section("工具层：落盘");

  const indexText = readText(settingIndexPath(novelRoot)) ?? "";
  check("工具写入的索引是合法 JSON", !throws(() => JSON.parse(indexText)));
  check("工具写入的 state.json 是合法 JSON", !throws(() => JSON.parse(readText(statePath(novelRoot)) ?? "")));

  rmSync(ROOT, { recursive: true, force: true });
}
