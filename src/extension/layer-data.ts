/**
 * 层面数据装载：把「这一层有哪些东西」渲染成一份清单。
 *
 * 同一份文本有两个去处（见 docs/design/ai.md「层面数据的装载」）：
 *
 * - 注入系统提示词 —— AI 知道有哪些条目，不会编一条重复的；
 * - 进层面时发给用户 —— 他知道该说什么，而不是对着空屏幕。
 *
 * 两者共用同一个渲染函数，因为它们本来就该是同一份东西。
 *
 * 只读索引，不读详述：详述动辄几百字，全量注入会淹没重点，而且它该由里程碑 6
 * 的上下文装配器按相关性取，不是每层都塞一遍。
 */

import { listSettings } from "../data/settings.ts";
import { listCharacters } from "../data/characters.ts";
import { listRelations } from "../data/relations.ts";
import type { OpenNovel } from "../data/novel.ts";
import type { Layer } from "./layers.ts";

export interface LayerData {
  /** 清单标题，如「设定条目清单（3 条）」。 */
  title: string;
  lines: string[];
}

/**
 * 该层的索引摘要。返回 null 表示这一层不需要装载（主菜单），
 * 或该层的装载尚未实现（`/outline` `/event` `/write` 属各自里程碑）。
 */
export function loadLayerData(layer: Layer, novel: OpenNovel | null): LayerData | null {
  if (novel === null) return null;
  if (layer === "setting") return settingData(novel);
  if (layer === "person") return personData(novel);
  return null;
}

/** 渲染成一段文本。AI 的 section 与给用户的消息用的是同一个结果。 */
export function renderLayerData(data: LayerData): string {
  return [`${data.title}`, "", ...data.lines].join("\n");
}

/**
 * 装载失败时返回 null 而不抛错。
 *
 * 两个调用点（注入提示词、进层时发给用户）都不应该因为「索引读不动」而整个失败：
 * 那会表现成「进不了设定层」或「AI 连书名都不知道」。数据坏了要在**工具执行时**
 * 明确报错（那时有明确的意图和错误文本），不是在这里。
 */
export function safeLayerData(layer: Layer, novel: OpenNovel): LayerData | null {
  try {
    return loadLayerData(layer, novel);
  } catch {
    return null;
  }
}

function settingData(novel: OpenNovel): LayerData {
  const items = listSettings(novel.root);
  if (items.length === 0) {
    return {
      title: "设定条目清单（0 条）",
      lines: ["（还没有任何设定条目。用户说要加一条时，直接建。）"],
    };
  }
  const lines = items.map((item) => {
    const flag = item.deprecated ? "[已废止] " : "";
    const when = item.establishedIn === 0 ? "确立于设定期" : `确立于第 ${item.establishedIn} 章`;
    return `- ${item.id} [${item.category}] ${flag}${item.name}：${item.summary}（${when}）`;
  });
  return { title: `设定条目清单（${items.length} 条）`, lines };
}

function personData(novel: OpenNovel): LayerData {
  const characters = listCharacters(novel.root);
  const relations = listRelations(novel.root);
  const lines: string[] = [];

  if (characters.length === 0) {
    lines.push("（还没有任何人物。）");
  } else {
    for (const entry of characters) {
      // lastUpdatedChapter 摆在这里不是装饰：它让「这个角色已经 8 章没更新过」
      // 从靠记性变成一眼可见。
      const updated = entry.lastUpdatedChapter === 0 ? "尚未回填过" : `最近更新于第 ${entry.lastUpdatedChapter} 章`;
      lines.push(`- ${entry.id} ${entry.name}（${entry.role} / ${entry.status}，${updated}）`);
    }
  }

  if (relations.length > 0) {
    lines.push("", "关系：");
    for (const relation of relations) {
      lines.push(`- ${relation.id} ${relation.from} → ${relation.to}（${relation.type} / ${relation.status}）`);
    }
  }

  return { title: `人物清单（${characters.length} 人，${relations.length} 条关系）`, lines };
}
