/**
 * 事件类工具。
 *
 * 伏笔不单独建工具：它就是一个 `origin: "foreshadow"` 的事件，
 * 只是多两个字段（plantedIn / payoffExpectedAt）。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../data/schema.ts";
import { linkEventChapter, refineEvent, setEventStatus, upsertEvent } from "../data/events.ts";
import { listCharacters } from "../data/characters.ts";
import { listSettings } from "../data/settings.ts";
import { upsertText, withNovel } from "./helper.ts";

const NullableChapter = Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]);

export const eventTools = [
  defineTool({
    name: "novel_event_upsert",
    label: "新增或更新事件",
    description:
      "新增或更新一个剧情事件。省略 id 表示新建（自动分配 E-NNN，order 自动排在最后）。" +
      "伏笔也用它建：origin 填 foreshadow，并填 plantedIn / payoffExpectedAt；非伏笔事件不能填这两个字段。",
    parameters: Type.Object(
      {
        id: Type.Optional(Type.String({ description: "已有事件的 ID，如 E-003；新建时省略" })),
        title: Type.String(),
        stage: Type.String({ description: "所属阶段，如「第一幕」" }),
        origin: Type.Union([
          Type.Literal("ai_proposed"),
          Type.Literal("user_specified"),
          Type.Literal("foreshadow"),
        ]),
        status: Type.Optional(
          Type.Union([
            Type.Literal("planned"),
            Type.Literal("in_progress"),
            Type.Literal("done"),
            Type.Literal("abandoned"),
          ]),
        ),
        order: Type.Optional(Type.Integer({ description: "排序权重，省略时新建自动排最后" })),
        dependsOn: Type.Optional(Type.Array(Type.String(), { description: "依赖的事件 ID" })),
        leadsTo: Type.Optional(Type.Array(Type.String(), { description: "引出的事件 ID" })),
        characters: Type.Optional(Type.Array(Type.String(), { description: "涉及的人物 ID" })),
        settings: Type.Optional(Type.Array(Type.String(), { description: "涉及的设定 ID" })),
        plantedIn: Type.Optional(NullableChapter),
        payoffExpectedAt: Type.Optional(NullableChapter),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel("novel_event_upsert", (novel) => {
        const result = upsertEvent(
          novel.root,
          {
            id: params.id,
            title: params.title,
            stage: params.stage,
            origin: params.origin,
            status: params.status,
            order: params.order,
            dependsOn: params.dependsOn,
            leadsTo: params.leadsTo,
            characters: params.characters,
            settings: params.settings,
            plantedIn: params.plantedIn,
            payoffExpectedAt: params.payoffExpectedAt,
          },
          {
            characters: listCharacters(novel.root).map((entry) => entry.id),
            settings: listSettings(novel.root).map((entry) => entry.id),
          },
        );
        return {
          text: upsertText({
            label: "事件",
            id: result.id,
            name: params.title,
            created: result.created,
            changes: result.changes,
          }),
          target: `events/${result.id}.md`,
          details: { id: result.id, created: result.created, changes: result.changes },
        };
      });
    },
  }),

  defineTool({
    name: "novel_event_refine",
    label: "事件细化",
    description:
      "用本章实际发生的内容细化事件：覆盖「当前描述」（最新最细的版本），并把这次的描述追加进「细化历史」。" +
      "审查项会拿正文比对「当前描述」，所以这里要写本章真正发生了什么，而不是计划。",
    parameters: Type.Object(
      {
        id: Type.String({ description: "事件 ID，如 E-003" }),
        chapter: Type.Integer({ minimum: 1, description: "细化发生在第几章" }),
        description: Type.String({ description: "本次细化后的完整描述（会成为新的「当前描述」）" }),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel("novel_event_refine", (novel) => {
        const result = refineEvent(novel.root, params.id, params.chapter, params.description);
        return {
          text:
            `已细化 ${params.id}：当前描述 ${result.previousLength} → ${result.newLength} 字，` +
            `旧描述保留在细化历史里。`,
          target: `events/${params.id}.md`,
          details: { previousLength: result.previousLength, newLength: result.newLength },
        };
      });
    },
  }),

  defineTool({
    name: "novel_event_set_status",
    label: "改事件状态",
    description: "改一个事件的状态。事件完成时置 done；这条线不要了置 abandoned（不物理删除，历史引用会失效）。",
    parameters: Type.Object(
      {
        id: Type.String({ description: "事件 ID，如 E-003" }),
        status: Type.Union([
          Type.Literal("planned"),
          Type.Literal("in_progress"),
          Type.Literal("done"),
          Type.Literal("abandoned"),
        ]),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel("novel_event_set_status", (novel) => {
        setEventStatus(novel.root, params.id, params.status);
        return {
          text: `已把 ${params.id} 的状态改为 ${params.status}。`,
          target: "events/index.json",
        };
      });
    },
  }),

  defineTool({
    name: "novel_event_link_chapter",
    label: "事件关联章节",
    description:
      "把章节挂到事件上。primary 为 true 时同时把该章的主事件设为它 —— " +
      "一章可挂多个事件，但必须有主事件，因为上下文装配器要按主事件决定注入哪条事件的全文。" +
      "注意：需要该章已有章节记录（先写过章节大纲）。",
    parameters: Type.Object(
      {
        eventId: Type.String({ description: "事件 ID，如 E-003" }),
        chapter: Type.Integer({ minimum: 1 }),
        primary: Type.Boolean({ description: "是否设为本主事件" }),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return withNovel("novel_event_link_chapter", (novel) => {
        linkEventChapter(novel.root, params.eventId, params.chapter, params.primary);
        return {
          text: `已把第 ${params.chapter} 章挂到 ${params.eventId}${params.primary ? "，并设为主事件" : ""}。`,
          target: "events/index.json",
        };
      });
    },
  }),
];
