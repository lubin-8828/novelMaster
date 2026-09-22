/**
 * 冒烟测试：扩展装配、层面表自检、数据层基础、提示词注入、文档一致性。
 *
 * 入口是 tests/all.ts（`npm test`）。
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { check, section } from "./harness.ts";
import { novelMasterExtension } from "../src/extension/index.ts";
import { TOOL_NAMES } from "../src/tools/index.ts";
import { initNovel, isNovelRoot, slugify } from "../src/data/init.ts";
import { openNovelAt } from "../src/data/novel.ts";
import { writeConfig } from "../src/data/paths.ts";
import { exists, readText } from "../src/data/io.ts";
import { renderHelp, renderLayerSection, renderStatus } from "../src/extension/render.ts";
import {
  ALL_COMMANDS,
  COMMANDS,
  CMD,
  ENTRY_LAYERS,
  LAYERS,
  LAYER_COMMAND_ORDER,
  commandsForLayer,
  getLayer,
  setLayer,
  type CmdName,
  type Layer,
} from "../src/extension/layers.ts";

const ROOT = join(process.cwd(), ".tmp-smoke");

export default async function run(): Promise<void> {
/* ---------------- 1. 扩展装配 ---------------- */

interface CapturedCommand {
  name: string;
  description?: string;
}

const registered: CapturedCommand[] = [];
const registeredToolNames: string[] = [];
const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();

const mockPi = {
  registerCommand: (name: string, options: { description?: string }) => {
    registered.push({ name, description: options.description });
  },
  registerTool: (tool: { name: string }) => {
    registeredToolNames.push(tool.name);
  },
  on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return () => {};
  },
  sendMessage: () => {},
} as unknown as ExtensionAPI;

novelMasterExtension(mockPi);

section("扩展装配");
const registeredNames = registered.map((c) => c.name);
const registeredSet = new Set(registeredNames);
check(
  "命令无重复注册",
  registeredNames.length === registeredSet.size,
  `注册了 ${registeredNames.length} 个，去重后 ${registeredSet.size}`,
);
check(
  "COMMANDS 里每个命令都被注册",
  ALL_COMMANDS.every((n) => registeredSet.has(n)),
  `缺少：${ALL_COMMANDS.filter((n) => !registeredSet.has(n)).join(", ")}`,
);
check(
  "没有注册表外的命令",
  [...registeredSet].every((n) => (ALL_COMMANDS as string[]).includes(n)),
  `多出：${[...registeredSet].filter((n) => !(ALL_COMMANDS as string[]).includes(n)).join(", ")}`,
);

// pi 内建命令表（docs/usage.md）。撞名会被 pi 后缀化成 /quit:1，
// 用户体验直接崩，所以这条必须是机械检查而不是靠记性。
const PI_BUILTINS = new Set([
  "login", "logout", "llama", "model", "thinking", "scoped-models", "settings",
  "resume", "new", "name", "session", "tree", "trust", "fork", "clone", "compact",
  "copy", "export", "import", "share", "bug", "reload", "hotkeys", "changelog", "quit",
]);
const collisions = [...registeredSet].filter((n) => PI_BUILTINS.has(n));
check("命令名不与 pi 内建冲突", collisions.length === 0, `冲突：${collisions.join(", ")}`);

check("注册了 before_agent_start 钩子", handlers.has("before_agent_start"));
check("注册了 session_start 钩子", handlers.has("session_start"));

/* ---------------- 2. 层面表自检 ---------------- */

section("层面表自检");

// COMMANDS 与 LAYER_COMMAND_ORDER 是两张手写的表，必须互相完备。
// 用手写表就有漂移风险，所以用断言把它们锁在一起。
const placedNames = new Set<string>();
for (const layer of Object.keys(LAYERS) as Layer[]) {
  for (const name of LAYER_COMMAND_ORDER[layer]) placedNames.add(name);
}
check(
  "每个命令至少出现在一个层面表里",
  ALL_COMMANDS.every((n) => placedNames.has(n)),
  `遗漏：${ALL_COMMANDS.filter((n) => !placedNames.has(n)).join(", ")}`,
);
check(
  "层面表里没有未定义的命令名",
  [...placedNames].every((n) => Object.hasOwn(COMMANDS, n)),
  `多余：${[...placedNames].filter((n) => !Object.hasOwn(COMMANDS, n)).join(", ")}`,
);
check(
  "除主菜单外的每层都有入口命令",
  (Object.keys(LAYERS) as Layer[])
    .filter((l) => l !== "menu")
    .every((l) => LAYER_COMMAND_ORDER.menu.includes(l as CmdName)),
);
check(
  "ENTRY_LAYERS 推导正确",
  ENTRY_LAYERS.length === 5 && ENTRY_LAYERS.includes("write") && ENTRY_LAYERS.includes("setting"),
  `得到 ${ENTRY_LAYERS.join(", ")}`,
);

for (const layer of Object.keys(LAYERS) as Layer[]) {
  const names = commandsForLayer(layer).map((c) => c.name);
  check(`${LAYERS[layer].label}层有 /help`, names.includes(CMD.help));
  if (layer === "menu") {
    check("主菜单不注入层面规则", LAYERS[layer].rules === "");
  } else {
    check(`${LAYERS[layer].label}层有 /back`, names.includes(CMD.back));
    check(`${LAYERS[layer].label}层注入了层面规则`, LAYERS[layer].rules.length > 0);
    check(`${LAYERS[layer].label}层层面段非空`, renderLayerSection(layer).includes("当前层面"));
    check(`${LAYERS[layer].label}层 /help 非空`, renderHelp(layer, null).includes("/help"));
  }
}

const pending = ALL_COMMANDS.filter((n) => COMMANDS[n].milestone !== undefined);
check("未实现的命令都标了里程碑", pending.length === 6, `实际 ${pending.length} 个：${pending.join(", ")}`);

check(
  "状态栏包含层面标签与章状态",
  renderStatus("write", { title: "测试书" }, { no: 3, status: "drafted" }) === "【写作】 《测试书》 第 3 章 · 正文已生成",
  renderStatus("write", { title: "测试书" }, { no: 3, status: "drafted" }),
);

/* ---------------- 3. 数据层 ---------------- */

section("数据层");

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });

check("slug 保留中文", slugify("深海回声") === "深海回声", `得到 "${slugify("深海回声")}"`);
check("slug 折叠符号", slugify("Hello, World!") === "hello-world", `得到 "${slugify("Hello, World!")}"`);

const novelRoot = join(ROOT, "深海回声");
const result = initNovel(novelRoot, {
  title: "深海回声",
  genre: ["科幻", "悬疑"],
  premise: "一个海洋学家发现海底有规律的信号。",
});

check("返回全部落盘文件", result.files.length === 10, `实际 ${result.files.length}`);
check("识别为合法小说根目录", isNovelRoot(novelRoot));

const opened = openNovelAt(novelRoot);
check("能重新打开", opened !== null);
check("书名正确", opened?.meta.title === "深海回声");
check("类型正确", opened?.meta.genre.join("/") === "科幻/悬疑");
check("premise 原文保留", opened?.meta.premise === "一个海洋学家发现海底有规律的信号。");
check("初始状态为 not_started", opened?.state.chapterStatus === "not_started");
check("初始章号为 1", opened?.state.currentChapter === 1);
check("最近章节数默认 5", opened?.state.config.recentChapters === 5);
check("pendingReflow 初始为 false", opened?.state.pendingReflow === false);
check("schemaVersion 为 1", opened?.meta.schemaVersion === 1);

let refused = false;
try {
  initNovel(novelRoot, { title: "深海回声", genre: [], premise: "再来一次" });
} catch {
  refused = true;
}
check("重复初始化被拒绝（不会覆盖已有小说）", refused);

/* ---------------- 4. 提示词注入 ---------------- */

section("提示词注入");

interface FakePromptOptions {
  sections: Record<string, string>;
}

function makeEvent(): { systemPromptOptions: FakePromptOptions } {
  return { systemPromptOptions: { sections: {} } };
}

function makeCtx(cwd: string): ExtensionContext {
  return { cwd, ui: { setStatus: () => {} } } as unknown as ExtensionContext;
}

const beforeAgentStart = handlers.get("before_agent_start")?.[0];
check("before_agent_start 处理器存在", beforeAgentStart !== undefined);

async function runBeforeAgentStart(cwd: string, layer: Layer): Promise<Record<string, string>> {
  setLayer(layer);
  const event = makeEvent();
  await beforeAgentStart?.(event, makeCtx(cwd));
  return event.systemPromptOptions.sections;
}

// 没有打开小说：只注入层面段，不注入项目段。
let sections = await runBeforeAgentStart(ROOT, "outline");
check("大纲层注入了 novelmaster-layer", "novelmaster-layer" in sections);
check("大纲层文本含层面名", sections["novelmaster-layer"]?.includes("故事大纲层") ?? false);
check("未打开小说时不注入项目段", !("novelmaster-project" in sections));

// 主菜单层不注入层面段。
sections = await runBeforeAgentStart(ROOT, "menu");
check("主菜单层不注入层面段", !("novelmaster-layer" in sections));

// 打开小说之后：层面段与项目段都注入。
writeConfig(ROOT, { novelRoot });
sections = await runBeforeAgentStart(ROOT, "write");
check("打开小说后注入项目段", "novelmaster-project" in sections);
check("项目段含书名", sections["novelmaster-project"]?.includes("深海回声") ?? false);
check("项目段含正文纯文本规则", sections["novelmaster-project"]?.includes("禁止 markdown") ?? false);
check("项目段含不许编造依据规则", sections["novelmaster-project"]?.includes("不许编造依据") ?? false);
check(
  "章节层面段与项目段同时存在",
  "novelmaster-layer" in sections && "novelmaster-project" in sections,
);

check("层面状态可读回", getLayer() === "write");

/* ---------------- 5. 文档一致性 ---------------- */

section("文档一致性");

// 把「先改设计再改代码」「代码必须与文档一致」这两条规则变成机械检查。
// 只靠自觉的规则，在第二次改动时就会失效。

const BASE = process.cwd();
const SUB_DOCS = ["architecture", "data", "ai", "interaction", "pipeline", "ops", "decisions"];

check("根设计文档存在", exists(join(BASE, "DESIGN.md")));
check("CLAUDE.md 存在", exists(join(BASE, "CLAUDE.md")));
for (const name of SUB_DOCS) {
  check(`子文档 docs/design/${name}.md 存在`, exists(join(BASE, "docs", "design", `${name}.md`)));
}

const rootDesign = readText(join(BASE, "DESIGN.md")) ?? "";
const claude = readText(join(BASE, "CLAUDE.md")) ?? "";

// 规则 4：根文档必须索引全部子文档；子文档必须回指根文档。
for (const name of SUB_DOCS) {
  check(`根文档索引了 ${name}.md`, rootDesign.includes(`docs/design/${name}.md`));
  const sub = readText(join(BASE, "docs", "design", `${name}.md`)) ?? "";
  check(`${name}.md 回指父文档`, sub.includes("../../DESIGN.md"));
}

// 四条强制规则必须逐字或等价地存在于 CLAUDE.md。
const RULE_MARKERS: Array<[string, string]> = [
  ["规则 1 标题", "规则 1：动手前必读设计文档"],
  ["规则 1 正文", "必须先完整阅读设计文档"],
  ["规则 2 标题", "规则 2：先改设计，再改代码"],
  ["规则 2 正文", "不允许先写代码后补文档"],
  ["规则 3 正文", "以设计文档为标准修改代码"],
  ["规则 4 标题", "规则 4：树状拆分设计文档"],
  ["设计文档位置声明", "`DESIGN.md`（项目根目录）"],
];
for (const [label, marker] of RULE_MARKERS) {
  check(`CLAUDE.md 含${label}`, claude.includes(marker));
}

// 命令名：文档的命令表必须与代码里的 COMMANDS 完全对应。
const interaction = readText(join(BASE, "docs", "design", "interaction.md")) ?? "";
for (const name of ALL_COMMANDS) {
  check(`interaction.md 记录了 /${name}`, interaction.includes(`\`/${name}\``));
}const docCommands = [...interaction.matchAll(/^\| `\/([a-z-]+)/gm)].map((m) => m[1] ?? "");
const extraInDoc = [...new Set(docCommands)].filter(
  (n) => !(ALL_COMMANDS as string[]).includes(n) && !PI_BUILTINS.has(n),
);
check("interaction.md 没有代码里不存在的命令", extraInDoc.length === 0, `多余：${extraInDoc.join(", ")}`);

// 工具名：data.md 的工具表必须与代码注册的 novel_* 工具完全对应。
// 与上面命令表同构的理由：「LLM 能调哪些工具」不能有两份不同的事实。
const dataDoc = readText(join(BASE, "docs", "design", "data.md")) ?? "";
for (const name of TOOL_NAMES) {
  check(`data.md 记录了 ${name}`, dataDoc.includes(`\`${name}\``));
}
const docTools = [...dataDoc.matchAll(/^\| `(novel_[a-z_]+)`/gm)].map((m) => m[1] ?? "");
const extraTools = [...new Set(docTools)].filter((n) => !(TOOL_NAMES as string[]).includes(n));
check("data.md 没有代码里不存在的工具", extraTools.length === 0, `多余：${extraTools.join(", ")}`);

// 代码 → 文档：src/ 下每个源文件都必须在架构文档的源码树里出现。
const architecture = readText(join(BASE, "docs", "design", "architecture.md")) ?? "";
const srcFiles: string[] = [];
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".ts")) srcFiles.push(entry.name);
  }
};
walk(join(BASE, "src"));
check("src/ 下有源文件", srcFiles.length > 0);
const undocumented = srcFiles.filter((f) => !architecture.includes(f));
check(
  "architecture.md 收录了全部 src/ 源文件",
  undocumented.length === 0,
  `未记录：${undocumented.join(", ")}`,
);

// 链接 → 文件：文档里的相对 .md 链接必须都存在（双向导航不能是死链）。
let deadLinks = 0;
const checkLinks = (file: string): void => {
  const text = readText(file) ?? "";
  for (const m of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
    const target = m[1];
    if (target === undefined) continue;
    if (!exists(resolve(dirname(file), target))) {
      deadLinks++;
      console.log(`        死链：${file.replace(BASE, ".")} → ${target}`);
    }
  }
};
checkLinks(join(BASE, "DESIGN.md"));
checkLinks(join(BASE, "CLAUDE.md"));
for (const name of SUB_DOCS) checkLinks(join(BASE, "docs", "design", `${name}.md`));
check("文档链接无死链", deadLinks === 0, `${deadLinks} 条`);

rmSync(ROOT, { recursive: true, force: true });
}
