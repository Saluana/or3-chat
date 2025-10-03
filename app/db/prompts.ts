import { db } from './client';
import { newId, nowSec } from './util';
import { useHooks } from '../composables/useHooks';
import type {
    DbCreatePayload,
    DbDeletePayload,
    DbUpdatePayload,
    PromptEntity,
} from '../utils/hook-types';

/**
 * Internal stored row shape (reuses posts table with postType = 'prompt').
 * We intentionally DO NOT add a new Dexie version / table to keep scope minimal.
 * Content is persisted as a JSON string (TipTap JSON) for flexibility.
 */
export interface PromptRow {
    id: string;
    title: string; // non-empty trimmed
    content: string; // JSON string
    postType: string; // always 'prompt'
    created_at: number; // seconds
    updated_at: number; // seconds
    deleted: boolean;
}

/** Public facing record with content already parsed. */
export interface PromptRecord {
    id: string;
    title: string;
    content: any; // TipTap JSON object
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

const PROMPT_TABLE = 'prompts';

function toPromptEntity(row: PromptRow): PromptEntity {
    return {
        id: row.id,
        name: row.title,
        text: row.content,
    };
}

function promptEntityToRow(entity: PromptEntity, base?: PromptRow): PromptRow {
    const fallback: PromptRow =
        base ??
        ({
            id: entity.id,
            title: normalizeTitle(entity.name ?? null, {
                allowEmpty: false,
            }),
            content: entity.text ?? JSON.stringify(emptyPromptJSON()),
            postType: 'prompt',
            created_at: nowSec(),
            updated_at: nowSec(),
            deleted: false,
        } as PromptRow);

    return {
        ...fallback,
        id: entity.id ?? fallback.id,
        title: entity.name ?? fallback.title,
        content: entity.text ?? fallback.content,
        created_at: fallback.created_at,
        updated_at: fallback.updated_at,
        postType: 'prompt',
        deleted: fallback.deleted,
    };
}

function mergePromptEntities(
    entities: PromptEntity[],
    baseRows: Map<string, PromptRow>
): PromptRow[] {
    return entities.map((entity) =>
        promptEntityToRow(entity, baseRows.get(entity.id))
    );
}

function buildPromptUpdatePayload(
    existingRow: PromptRow,
    updatedRow: PromptRow,
    patch: UpdatePromptPatch
): DbUpdatePayload<PromptEntity> {
    const patchEntity: Partial<PromptEntity> = {
        id: existingRow.id,
    };
    if (patch.title !== undefined) patchEntity.name = updatedRow.title;
    if (patch.content !== undefined) patchEntity.text = updatedRow.content;

    return {
        existing: toPromptEntity(existingRow),
        updated: toPromptEntity(updatedRow),
        patch: patchEntity,
        tableName: PROMPT_TABLE,
    };
}

function emptyPromptJSON() {
    return { type: 'doc', content: [] };
}

function normalizeTitle(
    title?: string | null,
    {
        fallback = 'Untitled Prompt',
        allowEmpty = true,
    }: { fallback?: string; allowEmpty?: boolean } = {}
): string {
    const raw = title ?? '';
    const trimmed = raw.trim();
    if (!trimmed && !allowEmpty) return fallback;
    return trimmed; // may be '' when allowEmpty true
}

function parseContent(raw: string | null | undefined): any {
    if (!raw) return emptyPromptJSON();
    try {
        const parsed = JSON.parse(raw);
        // Basic structural guard
        if (parsed && typeof parsed === 'object' && parsed.type) return parsed;
        return emptyPromptJSON();
    } catch {
        return emptyPromptJSON();
    }
}

function rowToRecord(row: PromptRow): PromptRecord {
    return {
        id: row.id,
        title: row.title,
        content: parseContent(row.content),
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted: row.deleted,
    };
}

export interface CreatePromptInput {
    title?: string | null;
    content?: any; // TipTap JSON object
}

export async function createPrompt(
    input: CreatePromptInput = {}
): Promise<PromptRecord> {
    const hooks = useHooks();
    const baseRow: PromptRow = {
        id: newId(),
        title: normalizeTitle(input.title, { allowEmpty: false }),
        content: JSON.stringify(input.content ?? emptyPromptJSON()),
        postType: 'prompt',
        created_at: nowSec(),
        updated_at: nowSec(),
        deleted: false,
    };
    const filteredEntity = await hooks.applyFilters(
        'db.prompts.create:filter:input',
        toPromptEntity(baseRow)
    );
    const filteredRow = promptEntityToRow(filteredEntity, baseRow);
    let actionPayload: DbCreatePayload<PromptEntity> = {
        entity: toPromptEntity(filteredRow),
        tableName: PROMPT_TABLE,
    };
    await hooks.doAction('db.prompts.create:action:before', actionPayload);
    const persistedRow = promptEntityToRow(actionPayload.entity, filteredRow);
    await db.posts.put(persistedRow as any); // reuse posts table
    actionPayload = {
        ...actionPayload,
        entity: toPromptEntity(persistedRow),
    };
    await hooks.doAction('db.prompts.create:action:after', actionPayload);
    return rowToRecord(persistedRow);
}

export async function getPrompt(id: string): Promise<PromptRecord | undefined> {
    const hooks = useHooks();
    const row = await db.posts.get(id);
    if (!row || (row as any).postType !== 'prompt') return undefined;
    const baseRow = row as PromptRow;
    const filteredEntity = await hooks.applyFilters(
        'db.prompts.get:filter:output',
        toPromptEntity(baseRow)
    );
    const mergedRow = promptEntityToRow(filteredEntity, baseRow);
    return rowToRecord(mergedRow);
}

export async function listPrompts(limit = 100): Promise<PromptRecord[]> {
    const hooks = useHooks();
    // Filter by postType (indexed) and non-deleted
    const rows = await db.posts
        .where('postType')
        .equals('prompt')
        .and((r) => !(r as any).deleted)
        .reverse() // by primary key order soon? we'll sort manually after fetch
        .toArray();
    // Sort by updated_at desc (Dexie compound index not defined for this pair; manual sort ok for small N)
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const sliced = rows.slice(0, limit) as unknown as PromptRow[];
    const baseMap = new Map(sliced.map((row) => [row.id, row]));
    const filteredEntities = await hooks.applyFilters(
        'db.prompts.list:filter:output',
        sliced.map(toPromptEntity)
    );
    return mergePromptEntities(filteredEntities, baseMap).map(rowToRecord);
}

export interface UpdatePromptPatch {
    title?: string;
    content?: any; // TipTap JSON object
}

export async function updatePrompt(
    id: string,
    patch: UpdatePromptPatch
): Promise<PromptRecord | undefined> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'prompt') return undefined;
    const existingRow = existing as PromptRow;
    const updatedRow: PromptRow = {
        id: existingRow.id,
        title:
            patch.title !== undefined
                ? normalizeTitle(patch.title, { allowEmpty: true })
                : existingRow.title,
        content: patch.content
            ? JSON.stringify(patch.content)
            : existingRow.content,
        postType: 'prompt',
        created_at: existingRow.created_at,
        updated_at: nowSec(),
        deleted: existingRow.deleted ?? false,
    };

    const basePayload = buildPromptUpdatePayload(
        existingRow,
        updatedRow,
        patch
    );
    const filteredPayload = await hooks.applyFilters(
        'db.prompts.update:filter:input',
        basePayload
    );
    const mergedRow = promptEntityToRow(filteredPayload.updated, updatedRow);

    let actionPayload: DbUpdatePayload<PromptEntity> = {
        ...filteredPayload,
        updated: toPromptEntity(mergedRow),
    };

    await hooks.doAction('db.prompts.update:action:before', actionPayload);
    const persistedRow = promptEntityToRow(actionPayload.updated, mergedRow);
    await db.posts.put(persistedRow as any);
    actionPayload = {
        ...actionPayload,
        updated: toPromptEntity(persistedRow),
    };
    await hooks.doAction('db.prompts.update:action:after', actionPayload);
    return rowToRecord(persistedRow);
}

export async function softDeletePrompt(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'prompt') return;
    const existingRow = existing as PromptRow;
    const payload: DbDeletePayload<PromptEntity> = {
        entity: toPromptEntity(existingRow),
        id: existingRow.id,
        tableName: PROMPT_TABLE,
    };
    await hooks.doAction('db.prompts.delete:action:soft:before', payload);
    await db.posts.put({
        ...existingRow,
        deleted: true,
        updated_at: nowSec(),
    });
    await hooks.doAction('db.prompts.delete:action:soft:after', payload);
}

export async function hardDeletePrompt(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'prompt') return;
    const existingRow = existing as PromptRow;
    const payload: DbDeletePayload<PromptEntity> = {
        entity: toPromptEntity(existingRow),
        id: existingRow.id,
        tableName: PROMPT_TABLE,
    };
    await hooks.doAction('db.prompts.delete:action:hard:before', payload);
    await db.posts.delete(id);
    await hooks.doAction('db.prompts.delete:action:hard:after', payload);
}

// Convenience for ensuring DB open (mirrors pattern in other modules)
export async function ensureDbOpen() {
    if (!db.isOpen()) await db.open();
}

export type { PromptRecord as Prompt };
