/**
 * 卸载 novelMaster（Node 实现，跨平台）。
 *
 * 只卸载全局命令（npm rm -g novelmaster）。小说数据在 ~/.novelmaster/，
 * 与软件分开，卸载不删数据。uninstall.bat / uninstall.sh 是纯 ASCII 壳，
 * 转发到这里（见 docs/design/decisions.md「踩坑记录」4.10）。
 */

import { spawnSync } from "node:child_process";

console.log("卸载全局命令 novelmaster（npm rm -g novelmaster）...");
// Windows 上不能直接 spawn npm.cmd（见 scripts/install.mjs 的 run），用 cmd.exe 包装。
const r =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "npm rm -g novelmaster"], { stdio: "inherit" })
    : spawnSync("npm", ["rm", "-g", "novelmaster"], { stdio: "inherit" });
if (r.status !== 0) {
  console.log("（卸载失败 —— 如果从未安装过全局命令，这是正常的。）");
}

console.log("");
console.log("卸载完成。");
console.log("");
console.log("注意：小说数据没有被删除，它在 ~/.novelmaster/（Windows：%USERPROFILE%\\.novelmaster\\）。");
console.log("确认不要了再手动删除该目录。");
console.log("项目目录与依赖（node_modules）也还在，不要了可自行删除。");
