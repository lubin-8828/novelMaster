/**
 * 多 agent 讨论的测试。
 *
 * **不调用模型**：编排逻辑通过注入假的 `RoleRunner` 来测（见 docs/design/ai.md「可测试性」）。
 * 真实子会话只在手工验收时跑 —— 那部分（「讨论得好不好」）本来就只能由用户判断。
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import { check, section } from "./harness.ts";
import { initNovel } from "../src/data/init.ts";
import { openNovelAt } from "../src/data/novel.ts";
import { writeOutline } from "../src/data/outline.ts";
import { upsertEvent } from "../src/data/events.ts";
import { upsertSetting } from "../src/data/settings.ts";
import {
  createSubmitTool,
  discuss,
  renderOutcomes,
  ROLE_TIMEOUT_MS,
  type Point,
  type RoleRunner,
  type RoleSpec,
} from "../src/ai/brainstorm/index.ts";
import { renderBaseline, renderRolePrompt, renderRoleSystemPrompt } from "../src/ai/brainstorm/input.ts";
import { READ_ONLY_BUILTINS } from "../src/ai/session.ts";
import { TOOL_NAMES, ALL_TOOLS } from "../src/tools/index.ts";

const ROOT = join(process.cwd(), ".tmp-brainstorm");

const ROLES: RoleSpec[] = [
  { name: "结构视角", focus: "三幕结构是否站得住" },
  { name: "冲突视角", focus: "冲突强度是否足够" },
  { name: "节奏视角", focus: "中段会不会拖" },
];

const OK_RUNNER: RoleRunner = async (role) => ({
  kind: "ok",
  value: [{ claim: `${role.name}的主张`, reason: `${role.name}的理由` }],
});

const onePoint = (roleName: string): { kind: "ok"; value: Point[] } => ({
  kind: "ok",
  value: [{ claim: `${roleName}的主张`, reason: `${roleName}的理由` }],
});

export default async function run(): Promise<void> {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  const root = join(ROOT, "讨论书");
  initNovel(root, { title: "讨论书", genre: ["科幻"], premise: "海洋学家发现海底有规律的信号。" });
  upsertSetting(root, { name: "异能等级", category: "world_rule", summary: "一到九级", body: "详述。" });
  writeOutline(root, "# 讨论书 · 故事主线大纲\n\n## 一句话主题\n\n信号是一种语言。\n");
  upsertEvent(root, { title: "发现信号", stage: "第一幕", origin: "user_specified" }, { characters: [], settings: [] });

  const novel = openNovelAt(root);
  check("测试用小说可打开", novel !== null);
  if (novel === null) return;

  /* ---------------- 输入包 ---------------- */

  section("讨论：输入包");

  const baseline = renderBaseline(novel);
  check("基线含书名", baseline.includes("讨论书"));
  check("基线含小说根绝对路径（子会话要按它读文件）", baseline.includes(novel.root));
  check("基线含核心想法原文", baseline.includes("海洋学家发现海底有规律的信号"));
  check("基线含大纲正文", baseline.includes("信号是一种语言"));
  check("基线含事件清单与阶段", baseline.includes("E-001") && baseline.includes("第一幕"));
  check("基线含视角 / 时态", baseline.includes("第三人称限知") && baseline.includes("过去时"));
  check("**基线不含设定条目**（判据与审查不同）", !baseline.includes("异能等级"));
  check("基线不含设定 ID", !baseline.includes("S-001"));
  check("基线不含修订记录", !baseline.includes("修订记录"));

  const rolePrompt = renderRolePrompt(baseline, "如果主角其实是内鬼", ROLES[0]!);
  check("角色输入含讨论方向", rolePrompt.includes("如果主角其实是内鬼"));
  check("角色输入含本角色视角与关注点", rolePrompt.includes("结构视角") && rolePrompt.includes("三幕结构是否站得住"));
  check("角色输入要求只谈自己视角", rolePrompt.includes("不要试图平衡各方观点"));
  check("角色输入指向 submit 工具", rolePrompt.includes("submit_brainstorm"));

  const systemPrompt = renderRoleSystemPrompt(ROLES[0]!);
  check("角色人格含视角说明", systemPrompt.includes("结构视角"));
  check("角色人格要求给理由", systemPrompt.includes("理由"));
  check("角色人格鼓励照直说分歧", systemPrompt.includes("照直说"));
  check("角色人格禁止编设定", systemPrompt.includes("不要凭印象编设定"));
  check("角色人格要求提交产出", systemPrompt.includes("submit_brainstorm"));

  /* ---------------- 编排 ---------------- */

  section("讨论：编排");

  const allOk = await discuss({ novel, cwd: "/tmp/fake-cwd", angle: "如果主角是内鬼", roles: ROLES }, OK_RUNNER);
  check("全部产出时不算致命", !allOk.fatal);
  check("每个角色一份产出", allOk.outcomes.length === 3);
  check("产出归到正确的角色", allOk.outcomes[0]?.role.name === "结构视角");
  check("观点内容原样带回", allOk.outcomes[0]?.points[0]?.claim === "结构视角的主张");
  check("成功角色无 detail", allOk.outcomes[0]?.detail === "");

  const missingRunner: RoleRunner = async (role) =>
    role.name === "冲突视角" ? { kind: "missing", detail: "模型没有调用 submit_brainstorm" } : onePoint(role.name);
  const withMissing = await discuss({ novel, cwd: "x", angle: "方向", roles: ROLES }, missingRunner);
  check("未产出不算致命", !withMissing.fatal);
  check("未产出的角色被标为 missing", withMissing.outcomes.find((o) => o.role.name === "冲突视角")?.status === "missing");
  check("未产出带原因", (withMissing.outcomes.find((o) => o.role.name === "冲突视角")?.detail ?? "").includes("submit_brainstorm"));
  check("其余角色照常产出", withMissing.outcomes.filter((o) => o.status === "ok").length === 2);

  const fatalRunner: RoleRunner = async (role) =>
    role.name === "节奏视角" ? { kind: "fatal", detail: "子会话起不来" } : onePoint(role.name);
  const withFatal = await discuss({ novel, cwd: "x", angle: "方向", roles: ROLES }, fatalRunner);
  check("设施失败标记为致命", withFatal.fatal);
  check("失败角色状态为 fatal", withFatal.outcomes.find((o) => o.role.name === "节奏视角")?.status === "fatal");

  const throwingRunner: RoleRunner = async () => {
    throw new Error("连接被重置");
  };
  const threw = await discuss({ novel, cwd: "x", angle: "方向", roles: ROLES }, throwingRunner);
  check("runner 抛错按致命处理（不猜它想表达什么）", threw.fatal);
  check("抛错详情被带出", (threw.outcomes[0]?.detail ?? "").includes("连接被重置"));

  let active = 0;
  let maxActive = 0;
  const concurrentRunner: RoleRunner = async (role) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return onePoint(role.name);
  };
  await discuss({ novel, cwd: "x", angle: "方向", roles: ROLES }, concurrentRunner);
  check("角色并发执行（同时在跑数 > 1）", maxActive > 1, `最大同时在跑 ${maxActive}`);

  const seenCwd: string[] = [];
  const cwdRunner: RoleRunner = async (role, context) => {
    seenCwd.push(context.cwd);
    return onePoint(role.name);
  };
  await discuss({ novel, cwd: "/main/cwd", angle: "方向", roles: ROLES }, cwdRunner);
  check(
    "runner 拿到的是**主会话 cwd**（config.json 所在），不是小说根",
    seenCwd.every((value) => value === "/main/cwd"),
    seenCwd.join(","),
  );

  let progress = 0;
  await discuss({ novel, cwd: "x", angle: "方向", roles: ROLES, onProgress: () => { progress += 1; } }, OK_RUNNER);
  check("进度按角色逐一上报", progress === 3);

  check("角色超时是有限值（不会无限等）", ROLE_TIMEOUT_MS > 0 && ROLE_TIMEOUT_MS <= 300_000, String(ROLE_TIMEOUT_MS));

  /* ---------------- 产出渲染 ---------------- */

  section("讨论：产出渲染");

  const rendered = renderOutcomes("如果主角是内鬼", allOk.outcomes);
  check("渲染含讨论方向", rendered.includes("如果主角是内鬼"));
  check("渲染含各角色名与关注点", ROLES.every((role) => rendered.includes(role.name)));
  check("渲染含主张与理由", rendered.includes("结构视角的主张") && rendered.includes("结构视角的理由"));
  check("**要求主会话自己综合**", rendered.includes("你来综合"));
  check("**明确不要投票**", rendered.includes("不要投票"));

  const renderedMissing = renderOutcomes("方向", withMissing.outcomes);
  check("未产出在结果里明示", renderedMissing.includes("未产出"));
  check("明确要求不要替未产出角色编内容", renderedMissing.includes("不要替它们编内容"));

  /* ---------------- submit 工具 ---------------- */

  section("讨论：submit 工具");

  const collected: Point[] = [];
  const submit = createSubmitTool(collected);
  const submitResult = await submit.execute(
    "t",
    { angle: "结构视角", points: [{ claim: "a", reason: "b" }, { claim: "c", reason: "d", risk: "会拖慢中段" }] },
    undefined,
    undefined,
    {} as never,
  );
  check("submit 把观点收进收集器", collected.length === 2);
  check("可选 risk 被保留", collected[1]?.risk === "会拖慢中段");
  check("没传 risk 时不留下 undefined 键", !("risk" in (collected[0] ?? {})));
  const firstContent = (submitResult as { content: Array<{ text?: string }> }).content[0];
  check("submit 返回确认文本", firstContent?.text?.includes("已记录 2 条") === true);

  /* ---------------- 注册与参数 ---------------- */

  section("讨论：注册与参数");

  check("novel_brainstorm 注册给主会话", TOOL_NAMES.includes("novel_brainstorm"));
  check(
    "**submit_brainstorm 不注册给主会话**（否则主会话能自己交一份假产出）",
    !TOOL_NAMES.includes("submit_brainstorm"),
  );
  const readonlyNames: readonly string[] = READ_ONLY_BUILTINS;
  check("讨论子会话只给只读工具", readonlyNames.every((name) => ["read", "grep", "find", "ls"].includes(name)));
  check("讨论子会话拿不到写工具", !readonlyNames.includes("write") && !readonlyNames.includes("edit"));

  const params = (ALL_TOOLS.find((tool) => tool.name === "novel_brainstorm") ?? { parameters: undefined }).parameters;
  const twoRoles = [{ name: "a", focus: "b" }, { name: "c", focus: "d" }];
  check("angle 必填", !Value.Check(params, { perspectives: twoRoles }));
  check("**视角少于 2 个被拒绝**（一个视角的「多 agent」是自欺）", !Value.Check(params, { angle: "x", perspectives: [twoRoles[0]] }));
  check(
    "视角多于 6 个被拒绝",
    !Value.Check(params, { angle: "x", perspectives: Array.from({ length: 7 }, (_, i) => ({ name: `n${i}`, focus: "f" })) }),
  );
  check("合法参数通过", Value.Check(params, { angle: "x", perspectives: twoRoles }));
  check("视角项缺字段被拒绝", !Value.Check(params, { angle: "x", perspectives: [{ name: "a" }, twoRoles[1]] }));

  rmSync(ROOT, { recursive: true, force: true });
}
