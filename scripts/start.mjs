/**
 * 跨平台启动 novelMaster（Node 实现，Linux / macOS / Windows / Termux 通用）。
 *
 * 它是 **TUI 程序，不是服务** —— 必须在能交互的终端里前台跑（用户要看着界面输入）。
 * 所以这个脚本不做「后台 daemon」，它做的是：把该检查的检查好，然后把终端交给你。
 *
 * 为什么用 Node 写而不是 shell：bash 在 Windows 上不可用，而「bash 一份 +
 * PowerShell 一份」是两个副本。Node 是运行时本来就有的依赖，一份实现跨平台。
 * 安装 / 卸载脚本（install.* / uninstall.*）是平台壳，不在这里。
 *
 * 同进程直接 import cli.ts，不是 spawn 子进程：脚本自己就是 node 进程，
 * process.pid 就是 novelMaster 的 pid，pidfile 不需要「exec 保留 pid」那套绕法。
 *
 * 见 docs/design/architecture.md「开发与调试」。
 */

import process from "node:process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = join(projectRoot, ".novelmaster", "novelmaster.pid");
const isWindows = process.platform === "win32";

/* ---------- 1. 前置检查（宁可在启动前失败，也不要在半路崩） ---------- */

// 本项目依赖 Node 的原生 TypeScript 类型剥离，需要 >= 22.19。
{
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    console.error(`Node 版本太低：当前 ${process.versions.node}，需要 >= 22.19.0`);
    console.error("（本项目的「无构建步骤」依赖原生 TS 类型剥离）");
    process.exit(1);
  }
}

if (!existsSync(join(projectRoot, "node_modules"))) {
  console.error("还没有装依赖。先跑：npm install");
  process.exit(1);
}

/* ---------- 2. pidfile 互斥（已经在跑就不重复启动） ---------- */

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (existsSync(pidFile)) {
  const existing = readFileSync(pidFile, "utf8").trim();
  const pid = Number(existing);
  if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
    console.error(`已经有一个 novelMaster 在跑（pid ${pid}）。`);
    console.error("要停止它：node scripts/stop.mjs");
    process.exit(1);
  }
  // pidfile 指向的进程已经不在了 —— 自愈清理，继续启动。
  rmSync(pidFile, { force: true });
}

// TUI 需要交互终端。这个检查是**有意的**：后台启动它的结果是「进程活着，
// 但你既看不到界面也没法输入」—— 与其让人对着一个不响应的进程发呆，不如现在说清。
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("novelMaster 需要交互终端（它是个 TUI，不是后台服务）。");
  if (isWindows) {
    console.error("");
    console.error("请在终端（Windows Terminal / PowerShell / cmd）里运行：");
    console.error("  node scripts/start.mjs");
  } else {
    console.error("");
    console.error("想让它常驻（比如手机息屏后还在）：");
    console.error("  pkg install tmux");
    console.error("  tmux new -s novelmaster 'node scripts/start.mjs'   # 起来后 Ctrl+B 然后 D 脱离");
    console.error("  tmux attach -t novelmaster              # 下次接回去");
  }
  process.exit(1);
}

/* ---------- 3. 启动 ---------- */

mkdirSync(dirname(pidFile), { recursive: true });
// 写自己的 pid：本脚本就是 node 进程，同进程 import cli.ts 跑 TUI。
writeFileSync(pidFile, `${process.pid}\n`, "utf8");

console.log("启动 novelMaster…");
console.log("  退出：Ctrl+C，或在对话里敲 /quit");
console.log("  在另一个终端停止：node scripts/stop.mjs");
console.log("");

try {
  await import("../src/cli.ts");
} finally {
  // 正常退出后清掉 pidfile（bash 版靠「探测到进程不存在」自愈，这里直接清）。
  rmSync(pidFile, { force: true });
}
