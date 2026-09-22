import { join } from "node:path";
import { appendLine } from "./io.ts";
import { NAMES } from "./paths.ts";

/**
 * 操作留痕：每次成功的写操作往 `logs/operations.jsonl` 追加一行。
 *
 * `actor` 恒为 `"llm"`，这是诚实而不是冗余：用户直接编辑 txt 与 md 不走工具，
 * 也不会被记录。日志只声称「LLM 通过工具做了什么」，不声称「文件发生过什么变化」——
 * 把后者写进日志就是伪造完整性。
 *
 * 实现在工具层调用，不在数据层：数据层的写函数不知道自己是被 LLM 还是被别的东西
 * 调用的，而留痕的语义正是「LLM 对资料做了什么」。包在工具层，日志内容与工具调用
 * 一一对应，不会漏也不会重复。
 */
export function logOperation(root: string, op: string, target: string): void {
  appendLine(
    join(root, NAMES.logsDir, NAMES.operations),
    JSON.stringify({ ts: new Date().toISOString(), op, target, actor: "llm" }),
  );
}
