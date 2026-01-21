import { getDb } from './client';
import { newId, nowSec, nextClock } from './util';
import { useHooks } from '../core/hooks/useHooks';
import type {
    DbCreatePayload,
    DbDeletePayload,
    DbUpdatePayload,
    PromptEntity,
} from '../core/hooks/hook-types';
import type { TipTapDocument } from '~/types/database';
import type { Post } from './schema';

/**
 * Type guard to check if a post is a prompt
 */
function isPromptPost(
    post: Post | undefined | null
): post is Post & { postType: 'prompt' } {
    return post !== undefined && post !== null && post.postType === 'prompt';
}

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
    clock?: number;
}

/** Public facing record with content already parsed. */
export interface PromptRecord {
    id: string;
    title: string;
    content: TipTapDocument | null; // TipTap JSON object
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
            title: normalizeTitle(entity.name, {
                allowEmpty: false,
            }),
            content: entity.text,
            postType: 'prompt',
            created_at: nowSec(),
            updated_at: nowSec(),
            deleted: false,
            clock: 0,
        } as PromptRow);

    return {
        ...fallback,
        id: entity.id,
        title: entity.name,
        content: entity.text,
        created_at: fallback.created_at,
        updated_at: fallback.updated_at,
        postType: 'prompt',
        deleted: fallback.deleted,
        clock: fallback.clock,
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

function emptyPromptJSON(): TipTapDocument {
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

function parseContent(raw: string | null | undefined): TipTapDocument {
    if (!raw) return emptyPromptJSON();
    try {
        const parsed: unknown = JSON.parse(raw);
        // Basic structural guard - ensure it's a valid TipTap document
        if (
            parsed &&
            typeof parsed === 'object' &&
            'type' in parsed &&
            (parsed as { type: unknown }).type === 'doc'
        ) {
            return parsed as TipTapDocument;
        }
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
    content?: TipTapDocument | null; // TipTap JSON object
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
        clock: nextClock(),
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
    // Convert PromptRow to Post type for getDb().posts.put
    const postRow: Post = {
        id: persistedRow.id,
        title: persistedRow.title,
        content: persistedRow.content,
        postType: persistedRow.postType,
        created_at: persistedRow.created_at,
        updated_at: persistedRow.updated_at,
        deleted: persistedRow.deleted,
        meta: '',
        clock: persistedRow.clock ?? 0,
    };
    await getDb().posts.put(postRow); // reuse posts table
    actionPayload = {
        ...actionPayload,
        entity: toPromptEntity(persistedRow),
    };
    await hooks.doAction('db.prompts.create:action:after', actionPayload);
    return rowToRecord(persistedRow);
}

export async function getPrompt(id: string): Promise<PromptRecord | undefined> {
    const hooks = useHooks();
    const row = await getDb().posts.get(id);
    if (!isPromptPost(row)) return undefined;
    const baseRow: PromptRow = {
        id: row.id,
        title: row.title,
        content: row.content,
        postType: row.postType,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted: row.deleted,
        clock: row.clock,
    };
    const filteredEntity = await hooks.applyFilters(
        'db.prompts.get:filter:output',
        toPromptEntity(baseRow)
    );
    if (!filteredEntity) return undefined;
    const mergedRow = promptEntityToRow(filteredEntity, baseRow);
    return rowToRecord(mergedRow);
}

export async function listPrompts(limit = 100): Promise<PromptRecord[]> {
    const hooks = useHooks();
    // Filter by postType (indexed) and non-deleted
    const rows = await getDb().posts
        .where('postType')
        .equals('prompt')
        .and((r) => !r.deleted)
        .reverse() // by primary key order soon? we'll sort manually after fetch
        .toArray();
    // Sort by updated_at desc (Dexie compound index not defined for this pair; manual sort ok for small N)
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const sliced = rows.slice(0, limit) as PromptRow[];
    const baseMap = new Map(sliced.map((row) => [row.id, row]));
    const filteredEntities = await hooks.applyFilters(
        'db.prompts.list:filter:output',
        sliced.map(toPromptEntity)
    );
    return mergePromptEntities(filteredEntities, baseMap).map(rowToRecord);
}

export interface UpdatePromptPatch {
    title?: string;
    content?: TipTapDocument | null; // TipTap JSON object
}

export async function updatePrompt(
    id: string,
    patch: UpdatePromptPatch
): Promise<PromptRecord | undefined> {
    const hooks = useHooks();
    const existing = await getDb().posts.get(id);
    if (!isPromptPost(existing)) return undefined;
    const existingRow: PromptRow = {
        id: existing.id,
        title: existing.title,
        content: existing.content,
        postType: existing.postType,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
        deleted: existing.deleted,
        clock: existing.clock,
    };
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
        deleted: existingRow.deleted,
        clock: nextClock(existingRow.clock),
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
    // Convert PromptRow to Post type for getDb().posts.put
    const postRow: Post = {
        id: persistedRow.id,
        title: persistedRow.title,
        content: persistedRow.content,
        postType: persistedRow.postType,
        created_at: persistedRow.created_at,
        updated_at: persistedRow.updated_at,
        deleted: persistedRow.deleted,
        meta: '',
        clock: persistedRow.clock ?? 0,
    };
    await getDb().posts.put(postRow);
    actionPayload = {
        ...actionPayload,
        updated: toPromptEntity(persistedRow),
    };
    await hooks.doAction('db.prompts.update:action:after', actionPayload);
    return rowToRecord(persistedRow);
}

export async function softDeletePrompt(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await getDb().posts.get(id);
    if (!isPromptPost(existing)) return;
    const existingRow: PromptRow = {
        id: existing.id,
        title: existing.title,
        content: existing.content,
        postType: existing.postType,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
        deleted: existing.deleted,
        clock: existing.clock,
    };
    const payload: DbDeletePayload<PromptEntity> = {
        entity: toPromptEntity(existingRow),
        id: existingRow.id,
        tableName: PROMPT_TABLE,
    };
    await hooks.doAction('db.prompts.delete:action:soft:before', payload);
    const updatedRow = {
        ...existingRow,
        deleted: true,
        updated_at: nowSec(),
        clock: nextClock(existingRow.clock),
    };
    // Convert to Post type for getDb().posts.put
    const postRow: Post = {
        id: updatedRow.id,
        title: updatedRow.title,
        content: updatedRow.content,
        postType: updatedRow.postType,
        created_at: updatedRow.created_at,
        updated_at: updatedRow.updated_at,
        deleted: updatedRow.deleted,
        meta: '',
        clock: updatedRow.clock,
    };
    await getDb().posts.put(postRow);
    await hooks.doAction('db.prompts.delete:action:soft:after', payload);
}

export async function hardDeletePrompt(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await getDb().posts.get(id);
    if (!isPromptPost(existing)) return;
    const existingRow: PromptRow = {
        id: existing.id,
        title: existing.title,
        content: existing.content,
        postType: existing.postType,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
        deleted: existing.deleted,
        clock: existing.clock,
    };
    const payload: DbDeletePayload<PromptEntity> = {
        entity: toPromptEntity(existingRow),
        id: existingRow.id,
        tableName: PROMPT_TABLE,
    };
    await hooks.doAction('db.prompts.delete:action:hard:before', payload);
    await getDb().posts.delete(id);
    await hooks.doAction('db.prompts.delete:action:hard:after', payload);
}

export type { PromptRecord as Prompt };
