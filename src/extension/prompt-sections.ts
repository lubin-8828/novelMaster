import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LAYERS, getLayer } from "./layers.ts";
import { renderLayerSection, renderProjectSection } from "./render.ts";
import { openNovel } from "../data/novel.ts";

/**
 * 把「当前层面」与「当前小说」注入系统提示词。
 *
 * 用 sections 而不是整体替换 systemPrompt：pi 会把变化的 section 作为补丁追加，
 * 保留其余部分的前缀缓存。层面切换是低频动作，但整体替换会让每次切层都丢缓存。
 */
export function registerPromptSections(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    const layer = getLayer();
    if (LAYERS[layer].rules) {
      event.systemPromptOptions.sections["novelmaster-layer"] = renderLayerSection(layer);
    }

    const novel = openNovel(ctx.cwd);
    if (novel) {
      event.systemPromptOptions.sections["novelmaster-project"] = renderProjectSection(
        novel.root,
        novel.meta.title,
      );
    }
  });
}
