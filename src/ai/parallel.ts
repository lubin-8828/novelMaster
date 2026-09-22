/**
 * 并发跑 N 个独立子任务的骨架。
 *
 * 脑暴与审查用的是同一套形状：并发起、各自通过 `submit_*` 回收产出、
 * 「没交付」与「设施失败」分开处置。
 *
 * **抽出来不是为了省代码，是为了让失败处置只有一处实现** —— 两处各写一遍，
 * 迟早出现「一条链降级了、另一条链中止了」，而用户看不出为什么。
 * 见 docs/design/ai.md「失败处置」。
 */

import { errorText } from "../data/errors.ts";

/**
 * 三种结局：
 * - `ok`：拿到了产出；
 * - `missing`：跑完了但没交付（**可容忍**，如实标注）；
 * - `fatal`：设施起不来（**中止，不降级**）。
 */
export type TaskOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "missing"; detail: string }
  | { kind: "fatal"; detail: string };

export type TaskStatus = "ok" | "missing" | "fatal";

export interface TaskResult<R, T> {
  role: R;
  status: TaskStatus;
  /** 仅 `ok` 时有值。 */
  value: T | undefined;
  /** 仅 `missing` / `fatal` 时有值。 */
  detail: string;
}

export async function runParallel<R extends { name: string }, T>(
  roles: readonly R[],
  run: (role: R) => Promise<TaskOutcome<T>>,
  onProgress?: ((done: number, total: number, role: R) => void) | undefined,
): Promise<Array<TaskResult<R, T>>> {
  let done = 0;
  const settled = await Promise.all(
    roles.map(async (role) => {
      let outcome: TaskOutcome<T>;
      try {
        outcome = await run(role);
      } catch (err) {
        // 走到这里说明 run 自己没兜住 —— 当成设施级失败，不猜它想表达什么。
        outcome = { kind: "fatal", detail: errorText(err) };
      }
      done += 1;
      onProgress?.(done, roles.length, role);
      return { role, outcome };
    }),
  );

  return settled.map(({ role, outcome }) =>
    outcome.kind === "ok"
      ? { role, status: "ok" as const, value: outcome.value, detail: "" }
      : { role, status: outcome.kind, value: undefined, detail: outcome.detail },
  );
}

/** 任一角色属设施级失败时为 true。调用方应**中止并报错**，不降级。 */
export function hasFatal<R, T>(results: readonly TaskResult<R, T>[]): boolean {
  return results.some((result) => result.status === "fatal");
}

/** 把设施失败的角色拼成一句给用户看的话。 */
export function fatalSummary<R extends { name: string }, T>(results: readonly TaskResult<R, T>[]): string {
  return results
    .filter((result) => result.status === "fatal")
    .map((result) => `${result.role.name}：${result.detail}`)
    .join("；");
}
