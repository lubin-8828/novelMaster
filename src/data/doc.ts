/**
 * 带 schema 校验的文档读写门面。
 *
 * 所有 JSON 资料都经过这里，「写盘前校验、读盘后也校验」就只有一处实现，
 * 不会有哪个模块漏掉 —— 漏掉的那个就是依据链上的一个洞。
 */

import { type Static, type TSchema } from "typebox";
import { readJsonFile, writeJsonAtomic } from "./io.ts";
import { assertSchema } from "./schema.ts";
import { DataError } from "./errors.ts";

/** 读文档，不存在或非法都抛错。用于「这份文件本该存在」的场景。 */
export function readDoc<T extends TSchema>(path: string, schema: T, label: string): Static<T> {
  const raw = readJsonFile(path);
  if (raw === null) throw new DataError(`${label} 不存在：${path}`);
  assertSchema(schema, raw, label);
  return raw;
}

/** 文件不存在返回 null（用于「首次创建」的判断），存在但非法则抛错。 */
export function readDocOrNull<T extends TSchema>(
  path: string,
  schema: T,
  label: string,
): Static<T> | null {
  const raw = readJsonFile(path);
  if (raw === null) return null;
  assertSchema(schema, raw, label);
  return raw;
}

export function writeDoc<T extends TSchema>(
  path: string,
  schema: T,
  value: Static<T>,
  label: string,
): void {
  assertSchema(schema, value, label);
  writeJsonAtomic(path, value);
}

/**
 * 断言数组是「只增不改」的：after 的前 before.length 项必须与 before 逐项相同。
 *
 * 用于 JSON 里的追加式数组（人物时间轴若走 JSON、关系变更史、事件章节列表）。
 * 与 md 的保行断言是同一个理由：历史可改 = 依据可伪造。
 */
export function assertExtended(before: readonly unknown[], after: readonly unknown[], label: string): void {
  if (after.length < before.length) {
    throw new DataError(`${label} 被删减了：原有 ${before.length} 项，现在只剩 ${after.length} 项。已放弃写入。`);
  }
  for (let i = 0; i < before.length; i++) {
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) {
      throw new DataError(`${label} 的第 ${i + 1} 项被改动了。追加式数组只增不改，已放弃写入。`);
    }
  }
}
