/**
 * 多 agent 讨论工具（主会话侧）。
 *
 * 子会话专用的 `submit_brainstorm` 不在这里 —— 它由 `src/ai/brainstorm/index.ts` 用闭包造出来，
 * 只注入讨论子会话，主会话看不到它（否则主会话可以自己"提交"一份假产出）。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STRICT } from "../data/schema.ts";
import { DataError } from "../data/errors.ts";
import { discuss, renderOutcomes } from "../ai/brainstorm/index.ts";
import { withNovel } from "./helper.ts";

export const brainstormTools = [
  defineTool({
    name: "novel_brainstorm",
    label: "多 agent 讨论",
    description:
      "按用户给定的方向起多个独立视角讨论，各自产出后**由你（父层）综合**。" +
      "**必须先有用户给的方向**：没有方向就不要启动（否则容易偏离用户思路）。" +
      "perspectives 由你按方向设计：至少 2 个、至多 6 个 —— 一个视角的「多 agent 讨论」是自欺。" +
      "返回各角色的结构化产出。**综合（共识 / 真实分歧 / 被忽略的选项 / 新假设）由你做，不要投票决定取舍。**",
    parameters: Type.Object(
      {
        angle: Type.String({ description: "用户给的讨论方向" }),
        perspectives: Type.Array(
          Type.Object(
            {
              name: Type.String({ description: "视角名，如「结构视角」" }),
              focus: Type.String({ description: "这个视角关心什么" }),
            },
            STRICT,
          ),
          { minItems: 2, maxItems: 6 },
        ),
      },
      STRICT,
    ),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      return withNovel(ctx, "novel_brainstorm", async (novel) => {
        const result = await discuss({
          novel,
          angle: params.angle,
          roles: params.perspectives,
          onProgress: (done, total, role) => {
            onUpdate?.({
              content: [{ type: "text", text: `讨论进行中：${done}/${total}（${role.name} 已完成）` }],
              details: {},
            });
          },
        });

        // 设施级失败 → 中止并报错，**不降级为「少一个角色」**：
        // 用户看到 3 份产出会以为是 3 个独立视角的完整结论，而实际只有 2 个。
        if (result.fatal) {
          const failed = result.outcomes.filter((outcome) => outcome.status === "fatal");
          throw new DataError(
            `讨论中止：${failed.length} 个角色的子会话起不来 —— ${failed
              .map((outcome) => `${outcome.role.name}：${outcome.detail}`)
              .join("；")}。本次讨论无效，请把原因告知用户。`,
          );
        }

        return {
          text: renderOutcomes(params.angle, result.outcomes),
          details: {
            outcomes: result.outcomes.map((outcome) => ({
              role: outcome.role.name,
              status: outcome.status,
              points: outcome.points.length,
            })),
          },
        };
      });
    },
  }),
];
