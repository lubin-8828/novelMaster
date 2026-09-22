/**
 * 关系的读写。
 *
 * 关系 = 当前状态 + 追加式 `history`。关系是有历史的（敌 → 友 → 决裂），
 * 所以当前状态（`type` / `status`）是覆盖式，变更史只增不改。
 */

import { NAMES, relationsPath } from "./paths.ts";
import { assertExtended, readDocOrNull, writeDoc } from "./doc.ts";
import { diffFields, type FieldChange } from "./diff.ts";
import { nextId, requireId } from "./ids.ts";
import { DataError } from "./errors.ts";
import { emptyRelations, RelationsDocSchema, type Relation, type RelationStatus } from "./schema.ts";

export interface UpsertRelationInput {
  id?: string | undefined;
  from: string;
  to: string;
  type: string;
  directed?: boolean | undefined;
  status?: RelationStatus | undefined;
  /** 关系始于第几章。 */
  since?: number | undefined;
}

export interface UpsertRelationResult {
  id: string;
  created: boolean;
  /** 更新时的字段变化；新建时为空数组。 */
  changes: FieldChange[];
}

export function listRelations(root: string): Relation[] {
  return readRelations(root).relations;
}

export function upsertRelation(
  root: string,
  input: UpsertRelationInput,
  knownCharacters: readonly string[],
  currentChapter: number,
): UpsertRelationResult {
  requireId("character", input.from, knownCharacters);
  requireId("character", input.to, knownCharacters);

  const path = relationsPath(root);
  const doc = readRelations(root);
  const known = doc.relations.map((entry) => entry.id);
  const created = input.id === undefined;
  const id = input.id ?? nextId("relation", known);
  if (!created) requireId("relation", id, known);

  const previous = doc.relations.find((entry) => entry.id === id);
  const relation: Relation = {
    id,
    from: input.from,
    to: input.to,
    type: input.type,
    directed: input.directed ?? previous?.directed ?? true,
    status: input.status ?? previous?.status ?? "active",
    since: input.since ?? previous?.since ?? currentChapter,
    history: previous?.history ?? [],
  };

  const relations = previous === undefined ? [...doc.relations, relation] : doc.relations.map((x) => (x.id === id ? relation : x));
  writeDoc(path, RelationsDocSchema, { ...doc, relations }, NAMES.relations);

  const changes = diffFields(
    previous === undefined
      ? undefined
      : {
          from: previous.from,
          to: previous.to,
          type: previous.type,
          directed: previous.directed,
          status: previous.status,
          since: previous.since,
        },
    {
      from: relation.from,
      to: relation.to,
      type: relation.type,
      directed: relation.directed,
      status: relation.status,
      since: relation.since,
    },
    ["from", "to", "type", "directed", "status", "since"],
  );

  return { id, created, changes };
}

/** 追加一条关系变更到 `history`，并可顺带更新当前状态。 */
export function appendRelationHistory(
  root: string,
  id: string,
  chapter: number,
  change: string,
  nextStatus?: RelationStatus,
): void {
  const path = relationsPath(root);
  const doc = readRelations(root);
  requireId("relation", id, doc.relations.map((entry) => entry.id));

  const relations = doc.relations.map((entry) => {
    if (entry.id !== id) return entry;
    const history = [...entry.history, { chapter, change }];
    assertExtended(entry.history, history, `${id} 的变更史`);
    return { ...entry, history, status: nextStatus ?? entry.status };
  });
  writeDoc(path, RelationsDocSchema, { ...doc, relations }, NAMES.relations);
}

function readRelations(root: string) {
  const doc = readDocOrNull(relationsPath(root), RelationsDocSchema, NAMES.relations);
  if (doc === null) throw new DataError(`${NAMES.relations} 不存在，这本小说的数据不完整`);
  return doc;
}
