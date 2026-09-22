/**
 * 工具注册入口。
 *
 * 全部工具一次性注册，**不按层面收窄可见集**。理由见 docs/design/decisions.md
 * 「已否决的方案」：按层收窄能降 token，但要做对得先知道每层真正需要哪些工具，
 * 现在只能靠猜；猜错就要反复改，而工具集变化会让 pi 重建 prompt、丢掉前缀缓存。
 * 等各层面在里程碑 3/4/5 定型后再按实际需要收窄。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readTools } from "./read.ts";
import { metaTools } from "./meta.ts";
import { settingTools } from "./setting.ts";
import { characterTools } from "./character.ts";
import { relationTools } from "./relation.ts";
import { outlineTools, inboxTools } from "./outline.ts";
import { eventTools } from "./event.ts";
import { chapterTools } from "./chapter.ts";
import { stateTools } from "./state.ts";
import { brainstormTools } from "./brainstorm.ts";
import { reviewTools } from "./review.ts";

export const ALL_TOOLS = [
  ...readTools,
  ...metaTools,
  ...settingTools,
  ...characterTools,
  ...relationTools,
  ...outlineTools,
  ...eventTools,
  ...chapterTools,
  ...stateTools,
  ...inboxTools,
  ...brainstormTools,
  ...reviewTools,
];

export const TOOL_NAMES = ALL_TOOLS.map((tool) => tool.name);

export function registerTools(pi: ExtensionAPI): void {
  for (const tool of ALL_TOOLS) pi.registerTool(tool);
}
