import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.ts";
import { registerPromptSections } from "./prompt-sections.ts";

/**
 * novelMaster 扩展。
 *
 * 它是整个应用的本体：TUI、会话、编辑器、流式渲染都由 pi 的 InteractiveMode 提供，
 * 这里只负责命令、层面、提示词与（后续里程碑的）工具。
 */
export function novelMasterExtension(pi: ExtensionAPI): void {
  registerCommands(pi);
  registerPromptSections(pi);
}
