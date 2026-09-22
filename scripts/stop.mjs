/**
 * 跨平台停止 novelMaster（Node 实现）。
 *
 * **正常情况下你不需要它** —— novelMaster 是 TUI，直接在那个终端按 Ctrl+C，
 * 或者在对话里敲 /quit 就行（那是优雅退出，正在跑的子会话能收尾）。
 *
 * 这个脚本给两种情况：
 *   1. 它在另一个终端里跑着，你懒得去找那个终端；
 *   2. 它卡住了（比如某个子会话卡在网络请求上），Ctrl+C 没反应。
 *
 * 平台差异（刻意保留）：
 *   - Linux / macOS：SIGTERM + 5 秒宽限 + SIGKILL（子会话有机会收尾）；
 *   - Windows：Node 发不了 SIGTERM（process.kill 等价 TerminateProcess 强杀），
 *     会先提示优先用 Ctrl+C 或 /quit。强杀是安全的：所有写入都是
 *     「临时文件 + rename」的原子写，不会留半截 JSON 或半截正文。
 *
 * 见 docs/design/architecture.md「开发与调试」。
 */

import process from "node:process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = join(projectRoot, ".novelmaster", "novelmaster.pid");
const isWindows = process.platform === "win32";

if (!existsSync(pidFile)) {
  console.log(`没有找到运行中的 novelMaster（${pidFile} 不存在）。`);
  console.log("如果它跑在某个终端里，直接在那个终端按 Ctrl+C 或敲 /quit。");
  process.exit(0);
}

const raw = readFileSync(pidFile, "utf8").trim();
if (raw === "") {
  console.error("pidfile 是空的，清掉它。");
  rmSync(pidFile, { force: true });
  process.exit(1);
}

const pid = Number(raw);
function isAlive() {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (!isAlive()) {
  console.log(`pidfile 里的进程（${pid}）已经不在了，清掉这个文件。`);
  rmSync(pidFile, { force: true });
  process.exit(0);
}

if (isWindows) {
  // Windows 无优雅退出信号：先说明，再强杀（原子写保证不留半截文件）。
  console.log(`正在停止 novelMaster（pid ${pid}）…`);
  console.log("提示：Windows 下没有优雅退出信号，这是强杀。");
  console.log("正常情况下请优先在 TUI 里按 Ctrl+C 或敲 /quit（正在跑的子会话能收尾）。");
  process.kill(pid);
  rmSync(pidFile, { force: true });
  console.log("已停止。");
  process.exit(0);
}

console.log(`正在停止 novelMaster（pid ${pid}）…`);
try {
  process.kill(pid, "SIGTERM");
} catch {
  // 信号发不出去，进程可能刚退出 —— 交给下面的探测循环。
}

// 给它 5 秒优雅退出：正在跑的子会话（审查 / 去 AI 味可能好几分钟）有机会收尾。
for (let i = 0; i < 5; i++) {
  if (!isAlive()) {
    console.log("已停止。");
    rmSync(pidFile, { force: true });
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.log("5 秒内没有退出，强制结束。");
console.log("（原子写保证不会留半截文件；被中断的只是那次正在跑的工具调用）");
try {
  process.kill(pid, "SIGKILL");
} catch {
  // 已经在探测间隙里退出了。
}
rmSync(pidFile, { force: true });
console.log("已强制停止。");
