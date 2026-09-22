/**
 * 设定条目的读写。
 *
 * 一个条目由两个文件组成：`setting/index.json`（索引，机器读）与 `setting/S-001.md`（详述 + 修订记录，人读）。
 * 写入顺序固定为**先详述 md、再索引 json**，理由见 docs/design/data.md「索引与详述的双写顺序」：
 * 孤儿 md 无害且下次可覆写，而「索引有、文件无」是坏引用，会让审查报告引用一个不存在的东西。
 */

import { readText, writeTextAtomic } from "./io.ts";
import { NAMES, settingDocPath, settingIndexPath } from "./paths.ts";
import { applySectionOps, chapterLine, composeDoc, readSectionLines } from "./md.ts";
import { readDocOrNull, writeDoc } from "./doc.ts";
import { nextId, requireId } from "./ids.ts";
import { DataError } from "./errors.ts";
import { emptySettingIndex, SettingIndexSchema, type SettingCategory, type SettingItem } from "./schema.ts";

export interface UpsertSettingInput {
  /** 省略则新建并分配 ID；提供则更新已有条目。 */
  id?: string | undefined;
  name: string;
  category: SettingCategory;
  summary: string;
  /** 详述正文（覆盖式）。 */
  body: string;
  /** 首次确立于第几章；0 表示在设定期建立。省略则沿用原值，新建时默认 0。 */
  establishedIn?: number | undefined;
}

export interface UpsertSettingResult {
  id: string;
  created: boolean;
}

export function listSettings(root: string): SettingItem[] {
  const index = readDocOrNull(settingIndexPath(root), SettingIndexSchema, NAMES.settingIndex);
  return index?.items ?? [];
}

export function upsertSetting(root: string, input: UpsertSettingInput): UpsertSettingResult {
  const indexPath = settingIndexPath(root);
  const index = readDocOrNull(indexPath, SettingIndexSchema, NAMES.settingIndex) ?? emptySettingIndex();

  const known = index.items.map((item) => item.id);
  const created = input.id === undefined;
  const id = input.id ?? nextId("setting", known);
  if (!created) requireId("setting", id, known);

  const previous = index.items.find((item) => item.id === id);
  const establishedIn = input.establishedIn ?? previous?.establishedIn ?? 0;

  // 先详述 md，再索引 json。
  writeSettingDoc(root, id, input, establishedIn, previous === undefined);

  const item: SettingItem = {
    id,
    name: input.name,
    category: input.category,
    summary: input.summary,
    establishedIn,
    tags: previous?.tags ?? [],
    deprecated: previous?.deprecated ?? false,
    updatedAt: new Date().toISOString(),
  };
  const items = previous === undefined ? [...index.items, item] : index.items.map((x) => (x.id === id ? item : x));
  writeDoc(indexPath, SettingIndexSchema, { ...index, items }, NAMES.settingIndex);

  return { id, created };
}

/** 往设定条目的「修订记录」追加一行。历史只增不改。 */
export function appendSettingRevision(root: string, id: string, chapter: number, text: string): void {
  requireId("setting", id, listSettings(root).map((item) => item.id));
  const path = settingDocPath(root, id);
  const current = readText(path);
  if (current === null) throw new DataError(`条目详述文件不存在：${path}（索引里有 ${id} 但没有对应文件，数据已不一致）`);
  const next = applySectionOps(current, [{ kind: "append", title: "修订记录", lines: [chapterLine(chapter, text)] }], path);
  writeTextAtomic(path, next);
}

/**
 * 重写条目 md：标题与详述是覆盖式，「修订记录」是追加式，重建时必须原样带过来。
 *
 * 新建时补一行「建立」记录 —— 否则新条目在修订记录里是空的，
 * 而「这个条目什么时候来的」是有价值的信息。
 */
function writeSettingDoc(
  root: string,
  id: string,
  input: UpsertSettingInput,
  establishedIn: number,
  isNew: boolean,
): void {
  const path = settingDocPath(root, id);
  const existing = readText(path);
  const kept = existing === null ? [] : readSectionLines(existing, "修订记录");
  const revisions = isNew || kept.length === 0 ? [chapterLine(establishedIn, `建立：${input.summary}`)] : kept;
  writeTextAtomic(path, composeDoc(`${id} ${input.name}`, input.body, [{ title: "修订记录", lines: revisions }]));
}
