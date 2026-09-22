/**
 * 安装 novelMaster（Node 实现，跨平台）。
 *
 * 三步：检查 Node 版本 → npm install → npm link。
 * install.bat / install.sh 都是纯 ASCII 一行壳，转发到这里（见
 * docs/design/decisions.md「踩坑记录」4.10：bat 里写中文会被 GBK cmd 切碎）。
 */

import { spawnSync } from "node:child_process";

function run(args) {
  // Windows 上不能直接 spawn npm.cmd（libuv 在部分环境下报 EINVAL），
  // 用 cmd.exe 包装；参数是固定列表，无注入面。不用 shell: true +
  // args 数组（Node 24 的 DEP0190 弃用警告）。
  const r =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`], { stdio: "inherit" })
      : spawnSync("npm", args, { stdio: "inherit" });
  return r.status ?? 1;
}

// 本项目依赖 Node 的原生 TypeScript 类型剥离，需要 >= 22.19。
{
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    console.error(`[错误] Node 版本太低：当前 ${process.versions.node}，需要 >= 22.19.0`);
    console.error("（本项目的「无构建步骤」依赖原生 TS 类型剥离）");
    process.exit(1);
  }
}

console.log("[1/2] 安装依赖（npm install）...");
if (run(["install"]) !== 0) {
  console.error("[错误] 依赖安装失败。");
  process.exit(1);
}

console.log("");
console.log("[2/2] 安装全局命令 novelmaster（npm link）...");
if (run(["link"]) !== 0) {
  console.error("[错误] 全局命令安装失败。");
  process.exit(1);
}

console.log("");
console.log("安装完成！");
console.log("");
console.log("  现在可以在任意目录启动：novelmaster");
console.log("");
console.log("  数据位置：~/.novelmaster/（Windows：%USERPROFILE%\\.novelmaster\\）");
