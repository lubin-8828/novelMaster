/**
 * 只读子会话工厂。
 *
 * 子会话是「一次性、不落盘、不带历史」的独立 agent（见 docs/design/ai.md「会话类型与生命周期」）。
 * 三条特征全靠参数保证，缺一条就退化：
 *
 * - `SessionManager.inMemory()` → 不落盘、不带历史（否则会带上前一个角色的上下文，
 *   「独立视角」就成了「被污染的视角」）；
 * - `tools` 白名单 → 改不了任何东西（审查员与讨论角色都只读）；
 * - `dispose()` → 不泄漏。
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionModel, ThinkingLevel } from "./models.ts";

/** 只读内置工具。子会话永远拿不到写工具 —— 这是「审查者不改稿」的代码级实现。 */
export const READ_ONLY_BUILTINS = ["read", "grep", "find", "ls"] as const;

type CreateOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;
export type SubSessionTools = NonNullable<CreateOptions["customTools"]>;

export interface RunSubSessionOptions {
  cwd: string;
  /** 角色人格：**整段替换**系统提示词。 */
  systemPrompt: string;
  /** 本回合的输入。 */
  prompt: string;
  /** 该子会话可见的自定义工具（如 `novel_read_index`、`submit_brainstorm`）。 */
  customTools?: SubSessionTools;
  /** 额外的内置只读工具（默认给 `READ_ONLY_BUILTINS`）。 */
  builtinTools?: readonly string[];
  model?: SessionModel | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  /** 超时（毫秒）。超时即中止，不用部分结果。 */
  timeoutMs: number;
}

export interface SubSessionResult {
  /** 子会话的最终文本输出（可能为空 —— 产出走 submit_* 工具时为常态）。 */
  text: string;
  /** 出错信息；成功为 null。 */
  error: string | null;
  timedOut: boolean;
}

/**
 * 起一个子会话、跑一轮、清理。
 *
 * **只负责「起、跑、清」**：产出怎么收集由调用方决定（通常是 `submit_*` 工具写进闭包数组）。
 * 这样这个函数不需要知道任何业务概念。
 */
export async function runSubSession(options: RunSubSessionOptions): Promise<SubSessionResult> {
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: getAgentDir(),
    systemPromptOverride: () => options.systemPrompt,
    // 不追加 AGENTS.md / APPEND_SYSTEM.md：子会话的人格必须是确定的，
    // 混进项目规则会让「3 个独立视角」各自带上同一份偏见。
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const created = await createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    // `tools` 是**白名单**：自定义工具的名字也必须列进来，否则它会被自己的白名单挡在门外
    //（pi 文档原话："If you pass `tools`, include each custom or extension tool name you want enabled"）。
    // 这个坑的症状很隐：工具注册了、调用报 "Tool xxx not found"，而模型只能看到白名单里的那几个。
    tools: [...(options.builtinTools ?? READ_ONLY_BUILTINS), ...(options.customTools ?? []).map((tool) => tool.name)],
    ...(options.customTools === undefined ? {} : { customTools: options.customTools }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.thinkingLevel === undefined ? {} : { thinkingLevel: options.thinkingLevel }),
  });

  const session = created.session;
  const chunks: string[] = [];
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      chunks.push(event.assistantMessageEvent.delta);
    }
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void session.abort();
  }, options.timeoutMs);

  try {
    await session.prompt(options.prompt);
    if (timedOut) {
      return { text: chunks.join(""), error: `超时（${Math.round(options.timeoutMs / 1000)} 秒）未完成`, timedOut: true };
    }
    return { text: chunks.join(""), error: null, timedOut: false };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: chunks.join(""), error: detail, timedOut };
  } finally {
    clearTimeout(timer);
    unsubscribe();
    session.dispose();
  }
}
