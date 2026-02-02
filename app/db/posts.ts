/**
 * @module app/db/posts
 *
 * Purpose:
 * CRUD helpers for posts stored in the local database.
 *
 * Responsibilities:
 * - Validate and persist post rows
 * - Emit hook events for post lifecycle operations
 *
 * Non-responsibilities:
 * - Rendering or formatting post content
 * - Handling document or prompt specific logic
 */
import { getDb } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { nowSec, parseOrThrow, nextClock } from './util';
import {
    PostSchema,
    PostCreateSchema,
    type Post,
    type PostCreate,
} from './schema';
import type { PostEntity } from '../core/hooks/hook-types';

// Convert Post schema type to PostEntity for hooks (where applicable)
function toPostEntity(post: Post): PostEntity {
    return {
        id: post.id,
        title: post.title,
        body: undefined, // Post schema doesn't have body
        created_at: post.created_at,
        updated_at: post.updated_at,
    };
}

// Normalize meta to stored string form (JSON) regardless of input shape
// Rejects unserialisable objects by returning undefined
function normalizeMeta(meta: unknown): string | null | undefined {
    if (meta === null) return null; // keep null as-is
    if (meta === undefined) return undefined; // preserve undefined (omit column)
    if (typeof meta === 'string') return meta; // assume already JSON or raw string

    // Reject functions, symbols, and other non-serializable types
    if (typeof meta === 'function' || typeof meta === 'symbol') {
        console.warn(
            '[posts] Meta contains non-serializable type, dropping value'
        );
        return undefined;
    }

    try {
        const serialized = JSON.stringify(meta);
        // Verify it round-trips to catch edge cases
        JSON.parse(serialized);
        return serialized;
    } catch (e) {
        console.warn('[posts] Failed to serialize meta, dropping value:', e);
        return undefined; // fallback: drop invalid meta
    }
}

/**
 * Purpose:
 * Create a post row in the local database.
 *
 * Behavior:
 * Applies filters, normalizes input, validates schemas, and writes to Dexie.
 *
 * Constraints:
 * - Throws on validation errors.
 *
 * Non-Goals:
 * - Does not attach files or metadata beyond the post schema.
 */
export async function createPost(input: PostCreate): Promise<Post> {
    const hooks = useHooks();
    const filtered: unknown = await hooks.applyFilters(
        'db.posts.create:filter:input',
        input
    );
    // Ensure title present & trimmed early (schema will enforce non-empty)
    const mutable = filtered as Record<string, unknown>;
    if (typeof mutable.title === 'string') {
        mutable.title = mutable.title.trim();
    }
    if (mutable.meta !== undefined) {
        mutable.meta = normalizeMeta(mutable.meta);
    }
    const prepared = parseOrThrow(PostCreateSchema, filtered);
    const value = parseOrThrow(PostSchema, prepared);
    const next = { ...value, clock: nextClock(value.clock) };
    await hooks.doAction('db.posts.create:action:before', {
        entity: toPostEntity(next),
        tableName: 'posts',
    });
    await dbTry(
        () => getDb().posts.put(next),
        { op: 'write', entity: 'posts', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.posts.create:action:after', {
        entity: toPostEntity(next),
        tableName: 'posts',
    });
    return next;
}

/**
 * Purpose:
 * Upsert a post row with updated clocks.
 *
 * Behavior:
 * Validates the post, updates clock values, and writes to Dexie.
 *
 * Constraints:
 * - Requires a fully shaped `Post` value.
 *
 * Non-Goals:
 * - Does not merge partial updates.
 */
export async function upsertPost(value: Post): Promise<void> {
    const hooks = useHooks();
    const filtered: unknown = await hooks.applyFilters(
        'db.posts.upsert:filter:input',
        value
    );
    const mutable = filtered as Record<string, unknown>;
    if (typeof mutable.title === 'string') {
        mutable.title = mutable.title.trim();
    }
    if (mutable.meta !== undefined) {
        mutable.meta = normalizeMeta(mutable.meta);
    }
    const validated = parseOrThrow(PostSchema, filtered);
    const existing = await dbTry(() => getDb().posts.get(validated.id), {
        op: 'read',
        entity: 'posts',
        action: 'get',
    });
    const next = {
        ...validated,
        clock: nextClock(existing?.clock ?? validated.clock),
    };
    await hooks.doAction('db.posts.upsert:action:before', {
        entity: toPostEntity(next),
        tableName: 'posts',
    });
    await dbTry(
        () => getDb().posts.put(next),
        { op: 'write', entity: 'posts', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.posts.upsert:action:after', {
        entity: toPostEntity(next),
        tableName: 'posts',
    });
}

/**
 * Purpose:
 * Fetch a post by id with hook filtering.
 *
 * Behavior:
 * Reads the row and applies output filters.
 *
 * Constraints:
 * - Returns undefined when missing or filtered out.
 *
 * Non-Goals:
 * - Does not parse content beyond stored string.
 */
export function getPost(id: string) {
    const hooks = useHooks();
    return dbTry(() => getDb().posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'get',
    }).then((res) =>
        res ? hooks.applyFilters('db.posts.get:filter:output', res) : undefined
    );
}

/**
 * Purpose:
 * List all posts.
 *
 * Behavior:
 * Reads the full posts table and applies output filters.
 *
 * Constraints:
 * - Intended for small data sets.
 *
 * Non-Goals:
 * - Does not support pagination.
 */
export function allPosts() {
    const hooks = useHooks();
    return dbTry(() => getDb().posts.toArray(), {
        op: 'read',
        entity: 'posts',
        action: 'all',
    }).then((res) =>
        res ? hooks.applyFilters('db.posts.all:filter:output', res) : []
    );
}

/**
 * Purpose:
 * Search posts by title substring.
 *
 * Behavior:
 * Performs a case-insensitive substring match and applies output filters.
 *
 * Constraints:
 * - Uses in-memory filtering.
 *
 * Non-Goals:
 * - Does not provide full-text search.
 */
export function searchPosts(term: string) {
    const q = term.toLowerCase();
    const hooks = useHooks();
    return dbTry(
        () =>
            getDb().posts.filter((p) => p.title.toLowerCase().includes(q)).toArray(),
        { op: 'read', entity: 'posts', action: 'search' }
    ).then((res) =>
        res ? hooks.applyFilters('db.posts.search:filter:output', res) : []
    );
}

/**
 * Purpose:
 * Soft delete a post by marking it deleted.
 *
 * Behavior:
 * Updates the deleted flag and timestamps with hook emission.
 *
 * Constraints:
 * - No-op if the post does not exist.
 *
 * Non-Goals:
 * - Does not remove the row permanently.
 */
export async function softDeletePost(id: string): Promise<void> {
    const hooks = useHooks();
    await getDb().transaction('rw', getDb().posts, async () => {
        const p = await dbTry(() => getDb().posts.get(id), {
            op: 'read',
            entity: 'posts',
            action: 'get',
        });
        if (!p) return;
        await hooks.doAction('db.posts.delete:action:soft:before', {
            entity: toPostEntity(p),
            id: p.id,
            tableName: 'posts',
        });
        await getDb().posts.put({
            ...p,
            deleted: true,
            updated_at: nowSec(),
            clock: nextClock(p.clock),
        });
        await hooks.doAction('db.posts.delete:action:soft:after', {
            entity: toPostEntity(p),
            id: p.id,
            tableName: 'posts',
        });
    });
}

/**
 * Purpose:
 * Hard delete a post row by id.
 *
 * Behavior:
 * Deletes the row and emits delete hooks.
 *
 * Constraints:
 * - No-op if the post does not exist.
 *
 * Non-Goals:
 * - Does not clean up related data.
 */
export async function hardDeletePost(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => getDb().posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'get',
    });
    await hooks.doAction('db.posts.delete:action:hard:before', {
        entity: toPostEntity(existing!),
        id,
        tableName: 'posts',
    });
    await getDb().posts.delete(id);
    await hooks.doAction('db.posts.delete:action:hard:after', {
        entity: toPostEntity(existing!),
        id,
        tableName: 'posts',
    });
}
