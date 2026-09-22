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
import { listEvents } from "../data/events.ts";
import { readOutlineBody } from "../data/outline.ts";
import { readSection } from "../data/md.ts";
import { chapterNo } from "../data/ids.ts";
import type { OpenNovel } from "../data/novel.ts";
import type { Layer } from "./layers.ts";

export interface LayerData {
  /** 清单标题，如「设定条目清单（3 条）」。 */
  title: string;
  lines: string[];
}

/**
 * 该层的索引摘要。返回 null 表示这一层不需要装载（主菜单），
 * 或该层的装载尚未实现（`/event` `/write` 属各自里程碑）。
 */
export function loadLayerData(layer: Layer, novel: OpenNovel | null): LayerData | null {
  if (novel === null) return null;
  if (layer === "setting") return settingData(novel);
  if (layer === "person") return personData(novel);
  if (layer === "outline") return outlineData(novel);
  if (layer === "event") return eventData(novel);
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

/**
 * 大纲层装载的是**全文**，不是摘要 —— 大纲是本层的工作对象。
 *
 * 但**不含「修订记录」**：那是追加式的历史，每改一次加一行，会越长越长，
 * 而它对「现在该怎么改大纲」没有直接帮助。省下的 token 换来的是更长的可用对话。
 */
function outlineData(novel: OpenNovel): LayerData {
  const lines: string[] = [];

  const body = readOutlineBody(novel.root);
  lines.push("【主线大纲】", "");
  if (body === null) lines.push("（大纲文件缺失）");
  else if (body === "") lines.push("（大纲还是空的）");
  else lines.push(body);

  const events = listEvents(novel.root);
  lines.push("", `【事件清单（${events.length} 条）】`, "");
  if (events.length === 0) {
    lines.push("（还没有推演出事件。事件在 /event 层做。）");
  } else {
    for (const event of events) {
      const foreshadow = event.origin === "foreshadow" ? "，伏笔" : "";
      const chapters = event.chapters.length > 0 ? `，涉及 ${event.chapters.length} 章` : "";
      lines.push(`- ${event.id} [${event.stage}] ${event.title}（${event.status}${foreshadow}${chapters}）`);
    }
  }

  return { title: "大纲层数据", lines };
}

/**
 * 事件层装载「阶段划分 + 主要冲突」而不是整份大纲。
 *
 * 与 `/outline` 的内容有重叠，但重点相反：大纲层审的是大纲（事件清单是校验材料），
 * 事件层干的是事件（大纲只用来定位「这个事件放哪一幕」）。所以「结局」之类的区段
 * 在这里没有必要出现。
 *
 * **区段抽不到时退化为整份大纲** —— 大纲的区段标题是用户可改的，抽不到不代表
 * 内容不存在。退一步比什么都不给好。
 */
function eventData(novel: OpenNovel): LayerData {
  const lines: string[] = [];
  const body = readOutlineBody(novel.root);

  if (body === null) {
    lines.push("【大纲】", "", "（大纲文件缺失。）");
  } else {
    const stages = readSection(body, "阶段划分");
    const conflicts = readSection(body, "主要冲突");
    if (stages === null || conflicts === null) {
      lines.push("【大纲】", "", body);
    } else {
      lines.push("【阶段划分】", "", ...trimBlank(stages), "", "【主要冲突】", "", ...trimBlank(conflicts));
    }
  }

  const events = [...listEvents(novel.root)].sort((a, b) => a.order - b.order);
  lines.push("", `【事件清单（${events.length} 条）】`, "");

  if (events.length === 0) {
    lines.push("（还没有事件。按上面的阶段逐个推演候选，交用户挑选后再落盘。）");
  } else {
    for (const event of events) {
      const tags: string[] = [event.status, event.origin];
      if (event.origin === "foreshadow") {
        tags.push(`埋于 CH-${chapterNo(event.plantedIn ?? 0)}`);
        if (event.payoffExpectedAt !== null) tags.push(`预计 CH-${chapterNo(event.payoffExpectedAt)} 回收`);
      }
      const chapters =
        event.chapters.length === 0 ? "" : `，涉及 ${event.chapters.map((no) => `CH-${chapterNo(no)}`).join("/")}`;
      lines.push(`- ${event.id} [${event.stage}] ${event.title}（${tags.join("，")}${chapters}）`);
    }
  }

  return { title: "事件层数据", lines };
}

/** 去掉区段内容首尾的空行，避免把占位空行也注入进去。 */
function trimBlank(lines: readonly string[]): string[] {
  const result = [...lines];
  while (result.length > 0 && (result[0] ?? "").trim() === "") result.shift();
  while (result.length > 0 && (result[result.length - 1] ?? "").trim() === "") result.pop();
  return result;
}
