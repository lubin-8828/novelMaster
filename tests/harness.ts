/**
 * 测试脚手架：断言、分组、失败计数、退出码。
 *
 * 继续不用测试框架：本项目的断言全是「比较两个已知值」和「断言抛不抛错」，
 * 框架提供的 fixture / mock / 并发调度在这里没有用武之地，而多一层框架就多一层
 * 「断言为什么没跑」的可能（见 docs/design/architecture.md「源码结构」）。
 *
 * 分组计数会打印出来，它是 ops.md 验收清单里那些「（N 项）」数字的来源 ——
 * 手写数字和实际断言数对不上时，这里能看出差在哪。
 */

let failures = 0;
let total = 0;
let current = "";
let currentCount = 0;
const groups: Array<{ title: string; count: number }> = [];

function flush(): void {
  if (current === "") return;
  groups.push({ title: current, count: currentCount });
  current = "";
  currentCount = 0;
}

export function check(name: string, condition: boolean, detail?: string): void {
  total++;
  currentCount++;
  if (condition) {
    console.log(`  ok    ${name}`);
    return;
  }
  failures++;
  console.log(`  FAIL  ${name}${detail === undefined ? "" : ` — ${detail}`}`);
}

export function section(title: string): void {
  flush();
  current = title;
  console.log(`\n${title}`);
}

/** 断言某个调用会抛错。返回 true 表示确实抛了。 */
export function throws(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

/** 捕获抛出的错误文本，用于断言「错误文本对 LLM 有修正价值」。 */
export function errorOf(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function finish(): never {
  flush();
  console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}（共 ${total} 项断言）`);
  for (const group of groups) console.log(`  ${group.title}：${group.count} 项`);
  process.exit(failures === 0 ? 0 : 1);
}
