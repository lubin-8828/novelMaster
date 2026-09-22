import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.ts";
import { registerPromptSections } from "./prompt-sections.ts";
import { registerTools } from "../tools/index.ts";
import { registerGuard } from "../tools/guard.ts";

/**
 * novelMaster 扩展。
 *
 * 它是整个应用的本体：TUI、会话、编辑器、流式渲染都由 pi 的 InteractiveMode 提供，
 * 这里负责命令、层面、提示词、工具与写入护栏。
 *
 * 四件事都装在这一处，因为它们共享同一份「进程内状态」（当前层面、失败计数）：
 * 拆成多个扩展工厂会让那些状态变成多份，而当前层面必须是单值的。
 */
export function novelMasterExtension(pi: ExtensionAPI): void {
  registerCommands(pi);
  registerPromptSections(pi);
  registerTools(pi);
  registerGuard(pi);
}
