/**
 * 数据层的失败类型。
 *
 * `message` 是**给 LLM 看的接口**，不是给用户看的日志：它必须说清「哪个字段、
 * 期望什么、实际是什么」，因为 LLM 唯一的自我修正途径就是这段文本
 * （见 docs/design/data.md「校验失败的处置」）。
 */
export class DataError extends Error {}

/** 把任意 catch 到的东西转成可读文本。 */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
