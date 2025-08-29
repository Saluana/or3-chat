import { db } from './client';
import { newId, nowSec } from './util';
import { useHooks } from '../composables/useHooks';

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
    const prepared: PromptRow = {
        id: newId(),
        title: normalizeTitle(input.title, { allowEmpty: false }),
        content: JSON.stringify(input.content ?? emptyPromptJSON()),
        postType: 'prompt',
        created_at: nowSec(),
        updated_at: nowSec(),
        deleted: false,
    };
    const filtered = (await hooks.applyFilters(
        'db.prompts.create:filter:input',
        prepared
    )) as PromptRow;
    await hooks.doAction('db.prompts.create:action:before', filtered);
    await db.posts.put(filtered as any); // reuse posts table
    await hooks.doAction('db.prompts.create:action:after', filtered);
    return rowToRecord(filtered);
}

export async function getPrompt(id: string): Promise<PromptRecord | undefined> {
    const hooks = useHooks();
    const row = await db.posts.get(id);
    if (!row || (row as any).postType !== 'prompt') return undefined;
    const filtered = (await hooks.applyFilters(
        'db.prompts.get:filter:output',
        row
    )) as PromptRow | undefined;
    return filtered ? rowToRecord(filtered) : undefined;
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
    const filtered = (await hooks.applyFilters(
        'db.prompts.list:filter:output',
        sliced
    )) as PromptRow[];
    return filtered.map(rowToRecord);
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
    const updated: PromptRow = {
        id: existing.id,
        title:
            patch.title !== undefined
                ? normalizeTitle(patch.title, { allowEmpty: true })
                : existing.title,
        content: patch.content
            ? JSON.stringify(patch.content)
            : (existing as any).content,
        postType: 'prompt',
        created_at: existing.created_at,
        updated_at: nowSec(),
        deleted: (existing as any).deleted ?? false,
    };
    const filtered = (await hooks.applyFilters(
        'db.prompts.update:filter:input',
        { existing, updated, patch }
    )) as { updated: PromptRow } | PromptRow;
    const row = (filtered as any).updated
        ? (filtered as any).updated
        : (filtered as any as PromptRow);
    await hooks.doAction('db.prompts.update:action:before', row);
    await db.posts.put(row as any);
    await hooks.doAction('db.prompts.update:action:after', row);
    return rowToRecord(row);
}

export async function softDeletePrompt(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'prompt') return;
    const row = {
        ...(existing as any),
        deleted: true,
        updated_at: nowSec(),
    };
    await hooks.doAction('db.prompts.delete:action:soft:before', row);
    await db.posts.put(row);
    await hooks.doAction('db.prompts.delete:action:soft:after', row);
}

export async function hardDeletePrompt(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'prompt') return;
    await hooks.doAction('db.prompts.delete:action:hard:before', existing);
    await db.posts.delete(id);
    await hooks.doAction('db.prompts.delete:action:hard:after', id);
}

// Convenience for ensuring DB open (mirrors pattern in other modules)
export async function ensureDbOpen() {
    if (!db.isOpen()) await db.open();
}

export type { PromptRecord as Prompt };
