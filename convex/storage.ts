import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

const nowSec = (): number => Math.floor(Date.now() / 1000);

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

export const generateUploadUrl = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        hash: v.string(),
        mime_type: v.string(),
        size_bytes: v.number(),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);
        const uploadUrl = await ctx.storage.generateUploadUrl();
        return { uploadUrl };
    },
});

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

        await ctx.db.insert('file_meta', {
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
    },
});

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
        return { url };
    },
});

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
