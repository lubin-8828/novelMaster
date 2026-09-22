/**
 * 人物档案的读写。
 *
 * 静态档案（`static`）与时间轴的处理方式不同：静态档案是「当前结论」，
 * 用户有权直接修正笔误，因此是覆盖式；时间轴是「历史事实」，只追加。
 * 这一差异在 `/person` 层的行为规格里有对应说明（见 docs/design/interaction.md）。
 */

import { readText, writeTextAtomic } from "./io.ts";
import { NAMES, characterDocPath, characterIndexPath } from "./paths.ts";
import { applySectionOps, chapterLine, composeDoc, readSectionLines } from "./md.ts";
import { readDocOrNull, writeDoc } from "./doc.ts";
import { nextId, requireId } from "./ids.ts";
import { DataError } from "./errors.ts";
import {
  CharacterIndexSchema,
  emptyCharacterIndex,
  type Character,
  type CharacterRole,
  type CharacterStatic,
  type CharacterStatus,
} from "./schema.ts";

export interface UpsertCharacterInput {
  id?: string | undefined;
  name: string;
  aliases?: string[] | undefined;
  role: CharacterRole;
  status?: CharacterStatus | undefined;
  /** 首次出场章号；省略则沿用原值，新建时默认当前章号。 */
  firstAppeared?: number | undefined;
  /** 静态档案的增量补丁（覆盖式）。省略的字段沿用原值。 */
  static?: Partial<CharacterStatic> | undefined;
  /** 档案详述 markdown（覆盖式）。 */
  body?: string | undefined;
}

export interface UpsertCharacterResult {
  id: string;
  created: boolean;
}

export const EMPTY_CHARACTER_STATIC: CharacterStatic = {
  age: null,
  gender: "",
  appearance: "",
  background: "",
  personality: "",
  speechHabits: "",
  goal: "",
  fear: "",
};

export function listCharacters(root: string): Character[] {
  const index = readDocOrNull(characterIndexPath(root), CharacterIndexSchema, NAMES.charactersIndex);
  return index?.characters ?? [];
}

export function upsertCharacter(
  root: string,
  input: UpsertCharacterInput,
  currentChapter: number,
): UpsertCharacterResult {
  const indexPath = characterIndexPath(root);
  const index = readDocOrNull(indexPath, CharacterIndexSchema, NAMES.charactersIndex) ?? emptyCharacterIndex();

  const known = index.characters.map((entry) => entry.id);
  const created = input.id === undefined;
  const id = input.id ?? nextId("character", known);
  if (!created) requireId("character", id, known);

  const previous = index.characters.find((entry) => entry.id === id);
  const firstAppeared = input.firstAppeared ?? previous?.firstAppeared ?? currentChapter;
  const staticFields = mergeStatic(previous?.static, input.static);

  const character: Character = {
    id,
    name: input.name,
    aliases: input.aliases ?? previous?.aliases ?? [],
    role: input.role,
    firstAppeared,
    status: input.status ?? previous?.status ?? "alive",
    lastUpdatedChapter: previous?.lastUpdatedChapter ?? 0,
    static: staticFields,
  };

  // 先详述 md，再索引 json（顺序理由同 settings.ts）。
  const docPath = characterDocPath(root, id);
  writeCharacterDoc(docPath, character, input.body ?? renderStatic(character), readText(docPath));

  const characters = previous === undefined ? [...index.characters, character] : index.characters.map((x) => (x.id === id ? character : x));
  writeDoc(indexPath, CharacterIndexSchema, { ...index, characters }, NAMES.charactersIndex);

  return { id, created };
}

/** 往人物时间轴追加一条关键事件，并推进 `lastUpdatedChapter`。 */
export function appendCharacterTimeline(root: string, id: string, chapter: number, text: string): void {
  const indexPath = characterIndexPath(root);
  const index = readDocOrNull(indexPath, CharacterIndexSchema, NAMES.charactersIndex) ?? emptyCharacterIndex();
  const known = index.characters.map((entry) => entry.id);
  requireId("character", id, known);

  const path = characterDocPath(root, id);
  const current = readText(path);
  if (current === null) {
    throw new DataError(`人物档案文件不存在：${path}（索引里有 ${id} 但没有对应文件，数据已不一致）`);
  }

  const next = applySectionOps(
    current,
    [{ kind: "append", title: "关键事件时间轴", lines: [chapterLine(chapter, text)] }],
    path,
  );
  writeTextAtomic(path, next);

  const characters = index.characters.map((entry) =>
    entry.id === id ? { ...entry, lastUpdatedChapter: Math.max(entry.lastUpdatedChapter, chapter) } : entry,
  );
  writeDoc(indexPath, CharacterIndexSchema, { ...index, characters }, NAMES.charactersIndex);
}

/**
 * 重写档案 md：标题与详述覆盖式，「关键事件时间轴」追加式，重建时必须原样带过来。
 *
 * `existing` 为 null 表示新建；此时补一行「出场」记录，避免时间轴是空的。
 */
function writeCharacterDoc(path: string, character: Character, body: string, existing: string | null): void {
  const kept = existing === null ? [] : readSectionLines(existing, "关键事件时间轴");
  const timeline = kept.length > 0 ? kept : [chapterLine(character.firstAppeared, `首次出场：${character.name}`)];
  writeTextAtomic(
    path,
    composeDoc(`${character.id} ${character.name}`, body, [{ title: "关键事件时间轴", lines: timeline }]),
  );
}

/** 把结构化静态档案渲染成可读 md。结构化字段是真相，这段文本是它的展开。 */
function renderStatic(character: Character): string {
  const s = character.static;
  const rows: Array<[string, string]> = [
    ["身份", character.role],
    ["状态", character.status],
    ["别名", character.aliases.join("、")],
    ["年龄", s.age === null ? "" : String(s.age)],
    ["性别", s.gender],
    ["外貌", s.appearance],
    ["背景", s.background],
    ["性格", s.personality],
    ["说话习惯", s.speechHabits],
    ["目标", s.goal],
    ["恐惧", s.fear],
  ];
  return rows
    .filter(([, value]) => value !== "")
    .map(([label, value]) => `- ${label}：${value}`)
    .join("\n");
}

/** 合并静态档案补丁，跳过 undefined（partial 的字段可能缺席）。 */
function mergeStatic(
  previous: CharacterStatic | undefined,
  patch: Partial<CharacterStatic> | undefined,
): CharacterStatic {
  const merged: Record<string, unknown> = { ...EMPTY_CHARACTER_STATIC, ...(previous ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue;
    merged[key] = value;
  }
  return merged as unknown as CharacterStatic;
}
