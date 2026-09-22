import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LAYERS, getLayer } from "./layers.ts";
import { renderLayerSection, renderProjectSection } from "./render.ts";
import { loadLayerData, renderLayerData, safeLayerData } from "./layer-data.ts";
import { openNovel } from "../data/novel.ts";

/**
 * 把「当前层面」「当前小说」「本层数据」注入系统提示词。
 *
 * 用 sections 而不是整体替换 systemPrompt：pi 会把变化的 section 作为补丁追加，
 * 保留其余部分的前缀缓存。层面切换是低频动作，但整体替换会让每次切层都丢缓存。
 *
 * 三个 section 是按「多久变一次」切的：项目段只在换书时变，层面段只在切层时变，
 * 数据段每次会话都要重新读盘（用户在 TUI 外改了文件，这里必须看到最新的）。
 * 粒度分对了，缓存的命中范围才最大。
 */
export function registerPromptSections(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    const layer = getLayer();
    if (LAYERS[layer].rules) {
      event.systemPromptOptions.sections["novelmaster-layer"] = renderLayerSection(layer);
    }

    const novel = openNovel(ctx.cwd);
    if (novel === null) return;

    event.systemPromptOptions.sections["novelmaster-project"] = renderProjectSection(
      novel.root,
      novel.meta.title,
    );

    const data = safeLayerData(layer, novel);
    if (data !== null) event.systemPromptOptions.sections["novelmaster-layer-data"] = renderLayerData(data);
  });
}
