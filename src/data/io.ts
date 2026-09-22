import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 原子写 JSON。
 *
 * 先写临时文件再 rename —— rename 在同一文件系统内是原子的，
 * 所以进程中途被杀不会留下半截 JSON。这些文件是所有审查依据的载体，
 * 半截文件会让依据链直接失效。
 */
export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const text = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(tmp, text, "utf8");
  fsyncFile(tmp);
  renameSync(tmp, path);
}

/** 原子写纯文本（正文、报告、md 资料）。 */
export function writeTextAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf8");
  fsyncFile(tmp);
  renameSync(tmp, path);
}

/**
 * 追加一行到文件末尾并 fsync。
 *
 * 用于 operations.jsonl 这类追加式日志。fsync 是必要的：
 * 没有它，"操作已记录"这句话在断电场景下不成立，
 * 而这份日志的意义正是可追溯。
 */
export function appendLine(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeFileSync(fd, `${line}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * 读 JSON 文件，区分「文件不存在」与「文件坏了」。
 *
 * 不存在返回 null（首次启动、还没建书是常态）。
 * 存在但不是合法 JSON 则**抛错** —— 静默返回 null 会把「你的书坏了」
 * 伪装成「没有这本书」，用户看不到任何异常信号。这违反 ops.md 的
 * 「失败时绝不静默降级」：建立在假信号上的判断会让整套设计失效。
 */
export function readJsonFile(path: string): unknown | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${path} 不是合法 JSON：${detail}`);
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}

export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** 判断路径是否存在（不区分文件/目录）。 */
export function exists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function fsyncFile(path: string): void {
  // Windows 上对只读句柄 fsync 会报 EPERM（需要写访问权），必须用读写句柄。
  // 这些 tmp 文件都是本函数刚写出来的，一定有写权限。
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
