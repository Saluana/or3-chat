/**
 * @module convex/storage
 *
 * Purpose:
 * Manages file metadata and storage URLs for OR3 Cloud.
 * Blob bytes are stored in Convex storage while metadata is stored in `file_meta`.
 *
 * Behavior:
 * - Validates workspace membership for all operations
 * - Generates short-lived upload URLs
 * - Commits metadata and deduplicates by `hash`
 * - Provides read access to stored file URLs
 * - Supports GC of deleted metadata and storage blobs
 *
 * Constraints:
 * - File size is capped at 100MB in `generateUploadUrl`
 * - `hash` is the canonical identifier and must be stable across devices
 *
 * Non-Goals:
 * - Streaming uploads or multipart coordination
 * - Per-file authorization beyond workspace membership
 */

import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

// ============================================================
// CONSTANTS
// ============================================================

/** Maximum file size in bytes (100MB) */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

// ============================================================
// HELPERS
// ============================================================

const nowSec = (): number => Math.floor(Date.now() / 1000);

/**
 * Internal authorization helper.
 *
 * Purpose:
 * Ensures the caller is authenticated and a member of the target workspace.
 */
async function verifyWorkspaceMembership(
    ctx: MutationCtx | QueryCtx,
    workspaceId: Id<'workspaces'>
): Promise<Id<'users'>> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        throw new Error('Unauthorized: No identity');
    }

    const authAccount = await ctx.db
        .query('auth_accounts')
        .withIndex('by_provider', (q) =>
            q.eq('provider', 'clerk').eq('provider_user_id', identity.subject)
        )
        .first();

    if (!authAccount) {
        throw new Error('Unauthorized: No auth account');
    }

    const membership = await ctx.db
        .query('workspace_members')
        .withIndex('by_workspace_user', (q) =>
            q.eq('workspace_id', workspaceId).eq('user_id', authAccount.user_id)
        )
        .first();

    if (!membership) {
        throw new Error('Forbidden: Not a workspace member');
    }

    return authAccount.user_id;
}

/**
 * `storage.generateUploadUrl` (mutation)
 *
 * Purpose:
 * Returns a short-lived upload URL for Convex storage.
 *
 * Constraints:
 * - Enforces a 100MB size cap
 */
export const generateUploadUrl = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        hash: v.string(),
        mime_type: v.string(),
        size_bytes: v.number(),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        // Enforce file size limit
        if (args.size_bytes > MAX_FILE_SIZE_BYTES) {
            throw new Error(
                `File size ${args.size_bytes} exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes (100MB)`
            );
        }

        const uploadUrl = await ctx.storage.generateUploadUrl();
        return { uploadUrl };
    },
});

/**
 * `storage.commitUpload` (mutation)
 *
 * Purpose:
 * Persists file metadata and associates a Convex storage object.
 *
 * Behavior:
 * - If a record with the same `hash` exists, updates storage metadata only
 * - Otherwise inserts a new row with `ref_count = 1`
 * - Performs a small dedup sweep to resolve rare race duplicates
 */
export const commitUpload = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        hash: v.string(),
        storage_id: v.id('_storage'),
        storage_provider_id: v.string(),
        mime_type: v.string(),
        size_bytes: v.number(),
        name: v.string(),
        kind: v.union(v.literal('image'), v.literal('pdf')),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        page_count: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        const existing = await ctx.db
            .query('file_meta')
            .withIndex('by_workspace_hash', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('hash', args.hash)
            )
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                storage_id: args.storage_id,
                storage_provider_id: args.storage_provider_id,
                updated_at: nowSec(),
            });
            return;
        }

        const createdId = await ctx.db.insert('file_meta', {
            workspace_id: args.workspace_id,
            hash: args.hash,
            name: args.name,
            mime_type: args.mime_type,
            kind: args.kind,
            size_bytes: args.size_bytes,
            width: args.width,
            height: args.height,
            page_count: args.page_count,
            ref_count: 1,
            storage_id: args.storage_id,
            storage_provider_id: args.storage_provider_id,
            deleted: false,
            created_at: nowSec(),
            updated_at: nowSec(),
            clock: 0,
        });

        // Cleanup any race condition duplicates (should be rare with .first() check above)
        // Use .take() instead of .collect() for safety
        const matches = await ctx.db
            .query('file_meta')
            .withIndex('by_workspace_hash', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('hash', args.hash)
            )
            .take(10); // Limit to prevent abuse

        if (matches.length > 1) {
            const sorted = [...matches].sort(
                (a, b) => a._creationTime - b._creationTime
            );
            const keeper = sorted[0];
            if (!keeper) return;
            for (const file of sorted.slice(1)) {
                if (file._id === keeper._id) continue;
                await ctx.db.delete(file._id);
            }
            if (keeper._id !== createdId) {
                await ctx.db.patch(keeper._id, {
                    storage_id: args.storage_id,
                    storage_provider_id: args.storage_provider_id,
                    updated_at: nowSec(),
                });
            }
        }
    },
});

/**
 * `storage.getFileUrl` (query)
 *
 * Purpose:
 * Retrieves a signed URL for a stored file.
 *
 * Behavior:
 * - Returns `null` when metadata exists but the blob is missing
 */
export const getFileUrl = query({
    args: {
        workspace_id: v.id('workspaces'),
        hash: v.string(),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        const file = await ctx.db
            .query('file_meta')
            .withIndex('by_workspace_hash', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('hash', args.hash)
            )
            .first();

        if (!file?.storage_id) return null;

        const url = await ctx.storage.getUrl(file.storage_id);
        // Handle case where storage object was deleted but metadata remains
        if (!url) {
            return null;
        }
        return { url };
    },
});

/**
 * `storage.gcDeletedFiles` (mutation)
 *
 * Purpose:
 * Deletes storage blobs and metadata for files that are soft-deleted and
 * no longer referenced.
 *
 * Constraints:
 * - Skips files with `ref_count > 0`
 * - Uses a caller-provided retention window in seconds
 */
export const gcDeletedFiles = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        retention_seconds: v.number(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        const cutoff = nowSec() - args.retention_seconds;
        const limit = args.limit ?? 25;
        let deletedCount = 0;

        const candidates = await ctx.db
            .query('file_meta')
            .withIndex('by_workspace_deleted', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('deleted', true)
            )
            .collect();

        for (const file of candidates) {
            if (deletedCount >= limit) break;
            if (file.ref_count > 0) continue;
            if (!file.deleted_at || file.deleted_at > cutoff) continue;

            if (file.storage_id) {
                await ctx.storage.delete(file.storage_id);
            }
            await ctx.db.delete(file._id);
            deletedCount += 1;
        }

        return { deletedCount };
    },
});
