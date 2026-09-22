/**
 * 审查清单：7 类 28 项，写死在代码里。
 *
 * **为什么不交给 AI 自由审**：成功判据是「用户判断」，所以 AI 唯一能做的是
 * 不许自由发挥 —— 每次跑同一份清单，用户才能横向对比「这章和上章的审查结果」，
 * 也才能发现清单缺了什么、然后去补。让 AI 每次凭理解去审，它漏了什么用户根本不知道。
 *
 * 清单的**唯一来源是这份文件**；`pipeline.md` 是它的说明文档，两者不一致时以这里为准。
 */

export interface ChecklistItem {
  /** 审查项编号，如 `A2`。报告里的 `[A2]` 就是它。 */
  id: string;
  category: string;
  title: string;
  /** 判定方式 —— 写给审查员看，要说清「拿什么比什么」。 */
  detail: string;
}

export const CHECKLIST: readonly ChecklistItem[] = [
  // A. 设定一致性
  { id: "A1", category: "A", title: "世界规则违背", detail: "正文中的现象或能力与某条 world_rule 冲突。" },
  { id: "A2", category: "A", title: "设定未确立就用", detail: "引入了 setting 中不存在的规则/组织/地点/术语。判定：补设条目，还是删掉表述。" },
  { id: "A3", category: "A", title: "设定漂移", detail: "正文实际改写了已有设定，但条目未更新。" },
  { id: "A4", category: "A", title: "禁忌被忽略", detail: "taboo 类限制被角色轻易绕过。" },

  // B. 人物一致性
  { id: "B1", category: "B", title: "性格偏离", detail: "行为与 personality / speechHabits 不符。" },
  { id: "B2", category: "B", title: "能力越界", detail: "用了档案中不具备的能力。" },
  { id: "B3", category: "B", title: "信息越界", detail: "角色知道了以他的位置不可能知道的信息（悬疑／推理的命脉）。" },
  { id: "B4", category: "B", title: "状态错误", detail: "已死、失踪、重伤的角色照常活动。" },
  { id: "B5", category: "B", title: "称谓不一致", detail: "同一角色被不同称呼，需区分「有意」与「笔误」。" },
  { id: "B6", category: "B", title: "目标漂移", detail: "行为与 goal / fear 冲突且正文没有交代转变。" },

  // C. 关系一致性
  { id: "C1", category: "C", title: "关系状态不符", detail: "已决裂却仍以旧方式相处。" },
  { id: "C2", category: "C", title: "亲疏与称呼不匹配", detail: "称呼的亲密程度与关系类型矛盾。" },
  { id: "C3", category: "C", title: "关系变化未留痕", detail: "正文里关系变了，但 history 没有对应记录。" },

  // D. 时间线与因果
  { id: "D1", category: "D", title: "时间矛盾", detail: "季节、昼夜、时长、「三天前」与实际章节间隔对不上。" },
  { id: "D2", category: "D", title: "因果断裂", detail: "事件发生缺少前置条件（dependsOn 里的前置事件还没发生）。" },
  { id: "D3", category: "D", title: "事件进度倒挂", detail: "正文内容超出或倒退于事件的「当前描述」。" },
  { id: "D4", category: "D", title: "行程不合理", detail: "两地距离与耗时对不上。" },

  // E. 剧情与大纲
  { id: "E1", category: "E", title: "主线脱轨", detail: "本章与所在阶段目标无关联。" },
  { id: "E2", category: "E", title: "伏笔未回收", detail: "该收的伏笔没收。挂着的伏笔清单由代码机械筛出并给在输入里。" },
  { id: "E3", category: "E", title: "情节重复", detail: "本章事件与前面某章高度相似。" },

  // F. 逻辑与叙事
  { id: "F1", category: "F", title: "情节漏洞", detail: "角色本可轻易解决的问题被绕开。" },
  { id: "F2", category: "F", title: "动机不足", detail: "关键决定缺少铺垫。" },
  { id: "F3", category: "F", title: "视角越界", detail: "与 meta.pov 冲突（如限知视角写了别人的心理）。" },
  { id: "F4", category: "F", title: "信息冗余", detail: "重复交代前文已充分建立的信息。" },
  { id: "F5", category: "F", title: "场景内物理逻辑", detail: "同一场景里位置、人数、物件前后不一致。" },

  // G. 硬性规范
  { id: "G1", category: "G", title: "正文含 markdown 语法", detail: "行首 #、**、行首 >、反引号、行首 - / * 加空格。" },
  { id: "G2", category: "G", title: "人称／时态漂移", detail: "对照 meta.pov / meta.tense。" },
  { id: "G3", category: "G", title: "章节字数异常", detail: "相对本书均值偏离过大（弱提示，放 note 即可）。" },
];

export interface ReviewerSpec {
  name: string;
  /** 这个审查员负责哪些类别。 */
  categories: readonly string[];
  focus: string;
}

/** 三个审查员的分工。与 `pipeline.md「拓扑与核心约束」`的图一致。 */
export const REVIEWERS: readonly ReviewerSpec[] = [
  { name: "设定审查员", categories: ["A"], focus: "正文与 setting/ 的一致性" },
  { name: "人物关系审查员", categories: ["B", "C"], focus: "正文与 characters/、relations.json 的一致性" },
  { name: "逻辑叙事审查员", categories: ["D", "E", "F", "G"], focus: "时间线、因果、大纲、叙事逻辑与硬性规范" },
];

export function checklistFor(reviewer: ReviewerSpec): ChecklistItem[] {
  return CHECKLIST.filter((item) => reviewer.categories.includes(item.category));
}

/** 清单规模自检用：写死的项数变了，测试会立刻发现。 */
export const CHECKLIST_SIZE = CHECKLIST.length;
