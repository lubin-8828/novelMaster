/**
 * token 估算。
 *
 * 公式：`CJK 字符数 × 1 + 其他字符数 ÷ 4`，向上取整。
 *
 * **为什么不用 pi 导出的 `estimateTokens`**：它的公式是 `字符数 ÷ 4`（英文导向，
 * 英文 4 字符 ≈ 1 token）。对中文它会算成 `1 汉字 ≈ 0.25 token` —— 低估 4 倍，
 * 而低估会让用户以为自己很宽裕。
 *
 * **为什么取 1 而不是更接近真实的 0.6**：真实值取决于具体 tokenizer（常用汉字在
 * 多数实现里落在 0.6–1.2 之间），而本项目不为「猜得更准一点」引入 tokenizer 依赖。
 * 估算是为了让人能横向比较并调 N，不是为了算账 —— 所以宁可高估。
 *
 * 见 docs/design/ai.md「token 估算」。
 */

/** CJK：汉字（含扩展 A）、假名、谚文、CJK 标点与全角形式。 */
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;

export function estimateTokens(text: string): number {
  if (text === "") return 0;
  let cjk = 0;
  let other = 0;
  // 用 for...of 迭代**码点**而不是 UTF-16 单元：emoji 之类的代理对会被数错。
  for (const char of text) {
    if (CJK.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

/** 字符数（按码点，精确值）。与估算一起展示，供用户自己换算。 */
export function charCount(text: string): number {
  return [...text].length;
}

/**
 * 终端里的显示宽度：CJK 占 2 列，其余占 1 列。
 *
 * `String.prototype.padEnd` 按 UTF-16 长度补空格，对中文会参差不齐 ——
 * 而 `/context` 的整张表都要对齐才好读。
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += CJK.test(char) ? 2 : 1;
  return width;
}

/** 按显示宽度右侧补空格。 */
export function padDisplay(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/** 按显示宽度左侧补空格。 */
export function padDisplayStart(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - displayWidth(text))) + text;
}
