/**
 * 多 agent 讨论的编排。
 *
 * 规格见 docs/design/ai.md「多 agent 讨论」；协议见 docs/design/interaction.md「多 agent 脑暴协议」。
 *
 * **关键设计：把「起会话」抽成可注入的 `RoleRunner`。** 不这么做，并发、失败处置、
 * 未产出标记这些逻辑就只能靠手工试；注入之后它们全部可自动测，剩下不可测的只有
 * 「讨论得好不好」—— 那本来就只能由用户判断。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { errorText } from "../../data/errors.ts";
import { runParallel, type TaskOutcome, type TaskStatus } from "../parallel.ts";
import { STRICT } from "../../data/schema.ts";
import type { OpenNovel } from "../../data/novel.ts";
import { readIndexTool } from "../../tools/read.ts";
import { resolveModel } from "../models.ts";
import { runSubSession } from "../session.ts";
import { renderBaseline, renderRolePrompt, renderRoleSystemPrompt, type RoleSpec } from "./input.ts";

export type { RoleSpec } from "./input.ts";

/** 单个角色的时间上限。讨论可能要多想一会儿，但用户不能无限等。 */
export const ROLE_TIMEOUT_MS = 120_000;

export interface Point {
  claim: string;
  reason: string;
  risk?: string | undefined;
}

export type RoleStatus = TaskStatus;

export interface RoleOutcome {
  role: RoleSpec;
  status: RoleStatus;
  points: Point[];
  /** `missing` / `fatal` 时为原因；`ok` 时为空串。 */
  detail: string;
}

export interface DiscussResult {
  outcomes: RoleOutcome[];
  /** 任一角色属设施级失败时为 true。调用方应**中止并报错**，不降级为「少一个角色」。 */
  fatal: boolean;
}

/** 与 `parallel.TaskOutcome` 同一形状 —— 失败处置只有一处实现。 */
export type RoleRunOutcome = TaskOutcome<Point[]>;

export type RoleRunner = (
  role: RoleSpec,
  context: { baseline: string; angle: string; novel: OpenNovel; cwd: string },
) => Promise<RoleRunOutcome>;

export interface DiscussOptions {
  novel: OpenNovel;
  angle: string;
  roles: readonly RoleSpec[];
  /**
   * 子会话的 cwd，**必须是主会话的 cwd，不是小说根**。
   *
   * `novel_*` 工具靠 `openNovelStrict(ctx.cwd)` 读 `.novelmaster/config.json` 定位小说；
   * 如果把它设成小说根，那些工具在子会话里全会报「没有打开小说」—— 而这正好会
   * 静默削掉「角色需要资料时自己查」这个能力（模型会以为没有工具可用）。
   * 小说根路径改为写进基线文本，让模型知道去哪读。
   */
  cwd: string;
  onProgress?: ((done: number, total: number, role: RoleSpec) => void) | undefined;
}

export async function discuss(options: DiscussOptions, runner?: RoleRunner): Promise<DiscussResult> {
  const baseline = renderBaseline(options.novel);
  const run = runner ?? defaultRoleRunner();

  const results = await runParallel(
    options.roles,
    (role) => run(role, { baseline, angle: options.angle, novel: options.novel, cwd: options.cwd }),
    options.onProgress,
  );

  const outcomes: RoleOutcome[] = results.map((result) => ({
    role: result.role,
    status: result.status,
    points: result.value ?? [],
    detail: result.detail,
  }));

  return { outcomes, fatal: results.some((result) => result.status === "fatal") };
}

/** 生产实现：起一个只读子会话，产出通过 submit_brainstorm 收集。 */
function defaultRoleRunner(): RoleRunner {
  return async (role, context) => {
    const collected: Point[] = [];
    const resolved = await resolveModel("brainstorm", context.novel.state);

    const result = await runSubSession({
      cwd: context.cwd,
      systemPrompt: renderRoleSystemPrompt(role),
      prompt: renderRolePrompt(context.baseline, context.angle, role),
      // 只给读工具与提交工具。**没有任何写工具** —— 讨论角色不落盘，落盘是主会话的事。
      customTools: [readIndexTool, createSubmitTool(collected)],
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel,
      timeoutMs: ROLE_TIMEOUT_MS,
    });

    if (result.timedOut) {
      // 超时归入「未产出」而不是「设施失败」：会话起来了、跑过了，只是没按时交卷。
      return { kind: "missing", detail: `超过 ${Math.round(ROLE_TIMEOUT_MS / 1000)} 秒未完成` };
    }
    if (result.error !== null) {
      return { kind: "fatal", detail: result.error };
    }
    if (collected.length === 0) {
      // 把子会话的最后一段输出附在原因里：**「未产出」有两种完全不同的成因** ——
      // 模型没按格式交付（可容忍），或它想交但交不上（设施问题，比如工具没注册）。
      // 只报「模型没提交」会把后者伪装成前者，而两者的处置完全不同。
      // 不猜哪一个（不嗅字符串），把它的原话端出来。
      const excerpt = result.text.trim().slice(-200);
      return {
        kind: "missing",
        detail:
          `模型没有调用 submit_brainstorm` + (excerpt === "" ? "，也未留下输出" : `；它的最后输出：…${excerpt}`),
      };
    }
    return { kind: "ok", value: collected };
  };
}

/** submit 工具在闭包里写 `collector`，这样 `runSubSession` 不需要知道业务概念。 */
// 导出供测试：`submit` 真的把参数收进数组，是「产出回收」链上最关键的一环。
export function createSubmitTool(collector: Point[]) {
  return defineTool({
    name: "submit_brainstorm",
    label: "提交讨论结论",
    description:
      "提交你这一轮讨论的结构化结论。**必须调用** —— 只在对话里说明不算产出，父层收不到。",
    parameters: Type.Object(
      {
        angle: Type.String({ description: "你实际采用的视角" }),
        points: Type.Array(
          Type.Object(
            {
              claim: Type.String({ description: "主张" }),
              reason: Type.String({ description: "理由" }),
              risk: Type.Optional(Type.String({ description: "这个主张的代价 / 风险" })),
            },
            STRICT,
          ),
          { minItems: 1 },
        ),
      },
      STRICT,
    ),
    async execute(_toolCallId, params) {
      for (const point of params.points) {
        collector.push({
          claim: point.claim,
          reason: point.reason,
          ...(point.risk === undefined ? {} : { risk: point.risk }),
        });
      }
      return {
        content: [{ type: "text", text: `已记录 ${params.points.length} 条观点。` }],
        details: {},
      };
    },
  });
}

/** 把各角色产出渲染成给主会话（父层）的文本。 */
export function renderOutcomes(angle: string, outcomes: readonly RoleOutcome[]): string {
  const lines = [`讨论方向：${angle}`, ""];

  for (const outcome of outcomes) {
    lines.push(`【${outcome.role.name}】${outcome.role.focus}`);
    if (outcome.status === "ok") {
      for (const point of outcome.points) {
        lines.push(`- ${point.claim}`);
        lines.push(`  理由：${point.reason}`);
        if (point.risk !== undefined) lines.push(`  风险：${point.risk}`);
      }
    } else {
      lines.push(`（未产出：${outcome.detail}）`);
    }
    lines.push("");
  }

  const missing = outcomes.filter((outcome) => outcome.status !== "ok");
  if (missing.length > 0) {
    lines.push(`注意：${missing.length} 个角色没有产出（已如实标出，**不要替它们编内容**）。`, "");
  }
  lines.push(
    "以上是各角色独立给出的观点。请**你来综合**：哪些是共识、哪些是真分歧、哪些选项被忽略了、" +
      "暴露了哪些新假设。**不要投票决定取舍** —— 分歧本身就是要给用户看的东西。",
  );
  return lines.join("\n");
}
