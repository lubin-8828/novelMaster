/**
 * 按用途取模型。
 *
 * 优先级（见 docs/design/ai.md「模型选择」）：
 * 1. `state.json` 的 `config.models[purpose]` —— 用户在层面里可改
 * 2. `~/.pi/agent/settings.json` 的 `defaultProvider` / `defaultModel`
 * 3. 第一个可用模型
 *
 * **为什么按用途分开**：审查是判定类任务（值得多想），起草要的是文风，脑暴要的是发散。
 * 用一个模型跑三种任务，等于要求一个模型同时擅长三件事 —— 而用户明确要的是「能按用途换」，
 * 不是「替他决定用哪个」。
 */

import process from "node:process";
import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { NovelState } from "../data/schema.ts";

export type Purpose = "draft" | "review" | "brainstorm";

/** 各用途的思考强度。review 用 high：判定类任务值得多想；其余 medium 够用。 */
export const THINKING_BY_PURPOSE = {
  draft: "medium",
  review: "high",
  brainstorm: "medium",
} as const;

export type ThinkingLevel = (typeof THINKING_BY_PURPOSE)[Purpose];

/** 从 ModelRuntime 推导模型类型，避免直接依赖 pi-ai 包名（它不是本项目的直接依赖）。 */
export type SessionModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

export interface ResolvedModel {
  model: SessionModel | undefined;
  thinkingLevel: ThinkingLevel;
  /** 模型来自哪一层配置。用于展示与排查「为什么用了这个模型」。 */
  source: "novel-config" | "pi-default" | "first-available" | "none";
}

/**
 * `ModelRuntime.create()` 会读缓存目录，不必每次重来。
 * 缓存在模块级：一次进程生命周期内配置不会变（要变也得重启，见「没有热更新」）。
 */
let cachedRuntime: Promise<ModelRuntime> | undefined;

function modelRuntime(): Promise<ModelRuntime> {
  cachedRuntime ??= ModelRuntime.create();
  return cachedRuntime;
}

/** pi 的全局设置（`~/.pi/agent/settings.json` + 项目覆盖）。只读默认模型两项。 */
function piSettings(): SettingsManager {
  return SettingsManager.create(process.cwd(), getAgentDir());
}

export async function resolveModel(purpose: Purpose, state: NovelState | null): Promise<ResolvedModel> {
  const runtime = await modelRuntime();
  const thinkingLevel = THINKING_BY_PURPOSE[purpose];

  const configured = state?.config.models[purpose] ?? null;
  if (configured !== null) {
    const found = findConfigured(runtime, configured);
    if (found !== undefined) return { model: found, thinkingLevel, source: "novel-config" };
  }

  const settings = piSettings();
  const provider = settings.getDefaultProvider();
  const id = settings.getDefaultModel();
  if (provider !== undefined && id !== undefined) {
    const found = runtime.getModel(provider, id);
    if (found !== undefined) return { model: found, thinkingLevel, source: "pi-default" };
  }

  const available = await runtime.getAvailable();
  const first = available[0];
  if (first !== undefined) return { model: first, thinkingLevel, source: "first-available" };

  // 一个都没有时**不抛错**：让 pi 用它自己的兜底逻辑，比我们在这里编一个模型要好。
  return { model: undefined, thinkingLevel, source: "none" };
}

/**
 * 解析 `config.models[purpose]` 的值。
 *
 * 接受两种写法：`provider/id`（明确）与单独的 `id`（用 pi 的默认 provider 补齐）。
 * 后者是为了让用户能只写 `deepseek-chat` 这种一眼能认的名字，而不用记住 provider 前缀。
 */
function findConfigured(runtime: ModelRuntime, value: string): SessionModel | undefined {
  const slash = value.indexOf("/");
  if (slash > 0) {
    return runtime.getModel(value.slice(0, slash), value.slice(slash + 1));
  }
  const provider = piSettings().getDefaultProvider();
  return provider === undefined ? undefined : runtime.getModel(provider, value);
}
