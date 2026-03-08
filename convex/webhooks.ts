import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const webhookHealth = v.union(
    v.literal('healthy'),
    v.literal('failing'),
    v.literal('unknown')
);

const deliveryStatus = v.union(
    v.literal('pending'),
    v.literal('in_flight'),
    v.literal('success'),
    v.literal('failed'),
    v.literal('cancelled')
);

export const createWebhook = mutation({
    args: {
        id: v.string(),
        scope: v.union(v.literal('user'), v.literal('admin')),
        user_id: v.optional(v.union(v.string(), v.null())),
        workspace_id: v.optional(v.union(v.string(), v.null())),
        url: v.string(),
        label: v.string(),
        events: v.array(v.string()),
        custom_hooks: v.array(v.string()),
        signing_secret_enc: v.string(),
        enabled: v.boolean(),
        health: webhookHealth,
        created_at: v.number(),
        updated_at: v.number(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert('webhook_registrations', {
            ...args,
            user_id: args.user_id ?? undefined,
            workspace_id: args.workspace_id ?? undefined,
        });
        return args;
    },
});

export const updateWebhook = mutation({
    args: {
        webhook_id: v.string(),
        url: v.string(),
        label: v.string(),
        events: v.array(v.string()),
        custom_hooks: v.array(v.string()),
        enabled: v.boolean(),
        workspace_id: v.optional(v.union(v.string(), v.null())),
        health: webhookHealth,
        updated_at: v.number(),
    },
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query('webhook_registrations')
            .withIndex('by_webhook_id', (q) => q.eq('id', args.webhook_id))
            .first();

        if (!row) return null;

        await ctx.db.patch(row._id, {
            url: args.url,
            label: args.label,
            events: args.events,
            custom_hooks: args.custom_hooks,
            enabled: args.enabled,
            workspace_id: args.workspace_id ?? undefined,
            health: args.health,
            updated_at: args.updated_at,
        });

        return {
            ...row,
            url: args.url,
            label: args.label,
            events: args.events,
            custom_hooks: args.custom_hooks,
            enabled: args.enabled,
            workspace_id: args.workspace_id ?? null,
            health: args.health,
            updated_at: args.updated_at,
        };
    },
});

export const deleteWebhook = mutation({
    args: { webhook_id: v.string() },
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query('webhook_registrations')
            .withIndex('by_webhook_id', (q) => q.eq('id', args.webhook_id))
            .first();
        if (!row) return false;

        await ctx.db.delete(row._id);

        const logs = await ctx.db
            .query('webhook_delivery_logs')
            .withIndex('by_webhook_created', (q) => q.eq('webhook_id', args.webhook_id))
            .collect();
        await Promise.all(logs.map((log) => ctx.db.delete(log._id)));

        return true;
    },
});

export const getWebhook = query({
    args: { webhook_id: v.string() },
    handler: async (ctx, args) => {
        return ctx.db
            .query('webhook_registrations')
            .withIndex('by_webhook_id', (q) => q.eq('id', args.webhook_id))
            .first();
    },
});

export const listWebhooks = query({
    args: {
        user_id: v.string(),
        workspace_id: v.string(),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query('webhook_registrations')
            .withIndex('by_scope_user_workspace_created', (q) =>
                q
                    .eq('scope', 'user')
                    .eq('user_id', args.user_id)
                    .eq('workspace_id', args.workspace_id)
            )
            .order('desc')
            .collect();
        return rows;
    },
});

export const listAdminWebhooks = query({
    args: {},
    handler: async (ctx) => {
        return ctx.db
            .query('webhook_registrations')
            .withIndex('by_scope_created', (q) => q.eq('scope', 'admin'))
            .order('desc')
            .collect();
    },
});

export const listWebhooksByEvent = query({
    args: {
        event_type: v.string(),
        scope: v.union(v.literal('user'), v.literal('admin')),
        workspace_id: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query('webhook_registrations')
            .withIndex('by_scope_enabled_created', (q) =>
                q.eq('scope', args.scope).eq('enabled', true)
            )
            .collect();

        return rows.filter((row) => {
            if (!Array.isArray(row.events) || !row.events.includes(args.event_type)) {
                return false;
            }

            if (!args.workspace_id) {
                return args.scope === 'admin' ? row.workspace_id == null : false;
            }

            if (args.scope === 'admin') {
                return !row.workspace_id || row.workspace_id === args.workspace_id;
            }

            return row.workspace_id === args.workspace_id;
        });
    },
});

export const listWebhooksByCustomHook = query({
    args: {
        hook_name: v.string(),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query('webhook_registrations')
            .withIndex('by_scope_enabled_created', (q) =>
                q.eq('scope', 'admin').eq('enabled', true)
            )
            .collect();

        return rows.filter(
            (row) => Array.isArray(row.custom_hooks) && row.custom_hooks.includes(args.hook_name)
        );
    },
});

export const listActiveCustomHookNames = query({
    args: {},
    handler: async (ctx) => {
        const rows = await ctx.db
            .query('webhook_registrations')
            .withIndex('by_scope_enabled_created', (q) =>
                q.eq('scope', 'admin').eq('enabled', true)
            )
            .collect();

        const names = new Set<string>();
        for (const row of rows) {
            for (const hook of row.custom_hooks) {
                names.add(hook);
            }
        }

        return [...names].sort((a, b) => a.localeCompare(b));
    },
});

export const updateWebhookHealth = mutation({
    args: {
        webhook_id: v.string(),
        health: webhookHealth,
        updated_at: v.number(),
    },
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query('webhook_registrations')
            .withIndex('by_webhook_id', (q) => q.eq('id', args.webhook_id))
            .first();
        if (!row) return false;

        await ctx.db.patch(row._id, {
            health: args.health,
            updated_at: args.updated_at,
        });

        return true;
    },
});

export const disableAllWebhooks = mutation({
    args: {
        user_id: v.string(),
        workspace_id: v.string(),
        updated_at: v.number(),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query('webhook_registrations')
            .withIndex('by_scope_user_workspace_created', (q) =>
                q
                    .eq('scope', 'user')
                    .eq('user_id', args.user_id)
                    .eq('workspace_id', args.workspace_id)
            )
            .collect();

        const enabledRows = rows.filter((row) => row.enabled);
        await Promise.all(
            enabledRows.map((row) =>
                ctx.db.patch(row._id, {
                    enabled: false,
                    updated_at: args.updated_at,
                })
            )
        );

        return enabledRows.length;
    },
});

export const createDeliveryLog = mutation({
    args: {
        id: v.string(),
        webhook_id: v.string(),
        event_id: v.string(),
        event_type: v.string(),
        attempt: v.number(),
        status: deliveryStatus,
        claimed_by: v.optional(v.union(v.string(), v.null())),
        claimed_at: v.optional(v.union(v.number(), v.null())),
        http_status: v.optional(v.union(v.number(), v.null())),
        error_message: v.optional(v.union(v.string(), v.null())),
        request_payload: v.string(),
        response_body: v.optional(v.union(v.string(), v.null())),
        duration_ms: v.optional(v.union(v.number(), v.null())),
        next_retry_at: v.optional(v.union(v.number(), v.null())),
        created_at: v.number(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert('webhook_delivery_logs', {
            ...args,
            claimed_by: args.claimed_by ?? undefined,
            claimed_at: args.claimed_at ?? undefined,
            claimed_at_sort: args.claimed_at ?? 0,
            http_status: args.http_status ?? undefined,
            error_message: args.error_message ?? undefined,
            response_body: args.response_body ?? undefined,
            duration_ms: args.duration_ms ?? undefined,
            next_retry_at: args.next_retry_at ?? undefined,
            next_retry_at_sort: args.next_retry_at ?? 0,
        });

        return args;
    },
});

export const updateDeliveryLog = mutation({
    args: {
        log_id: v.string(),
        status: v.optional(deliveryStatus),
        http_status: v.optional(v.union(v.number(), v.null())),
        error_message: v.optional(v.union(v.string(), v.null())),
        response_body: v.optional(v.union(v.string(), v.null())),
        duration_ms: v.optional(v.union(v.number(), v.null())),
        next_retry_at: v.optional(v.union(v.number(), v.null())),
        attempt: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query('webhook_delivery_logs')
            .withIndex('by_log_id', (q) => q.eq('id', args.log_id))
            .first();

        if (!row) return false;

        const nextStatus = args.status ?? row.status;
        const clearClaim = nextStatus !== 'in_flight';

        await ctx.db.patch(row._id, {
            status: nextStatus,
            attempt: args.attempt ?? row.attempt,
            http_status: args.http_status === undefined ? row.http_status : (args.http_status ?? undefined),
            error_message:
                args.error_message === undefined
                    ? row.error_message
                    : (args.error_message ?? undefined),
            response_body:
                args.response_body === undefined
                    ? row.response_body
                    : (args.response_body ?? undefined),
            duration_ms:
                args.duration_ms === undefined ? row.duration_ms : (args.duration_ms ?? undefined),
            next_retry_at:
                args.next_retry_at === undefined
                    ? row.next_retry_at
                    : (args.next_retry_at ?? undefined),
            next_retry_at_sort:
                args.next_retry_at === undefined
                    ? row.next_retry_at_sort
                    : (args.next_retry_at ?? 0),
            claimed_by: clearClaim ? undefined : row.claimed_by,
            claimed_at: clearClaim ? undefined : row.claimed_at,
            claimed_at_sort: clearClaim ? 0 : row.claimed_at_sort,
        });

        return true;
    },
});

export const getDeliveryLogs = query({
    args: {
        webhook_id: v.string(),
        since: v.number(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query('webhook_delivery_logs')
            .withIndex('by_webhook_created', (q) =>
                q.eq('webhook_id', args.webhook_id).gte('created_at', args.since)
            )
            .order('desc')
            .collect();
    },
});

export const getRecentTerminalDeliveries = query({
    args: {
        webhook_id: v.string(),
        limit: v.number(),
    },
    handler: async (ctx, args) => {
        const safeLimit = Math.max(1, Math.floor(args.limit));
        const [successRows, failedRows] = await Promise.all([
            ctx.db
                .query('webhook_delivery_logs')
                .withIndex('by_webhook_status_created', (q) =>
                    q
                        .eq('webhook_id', args.webhook_id)
                        .eq('status', 'success')
                )
                .order('desc')
                .take(safeLimit),
            ctx.db
                .query('webhook_delivery_logs')
                .withIndex('by_webhook_status_created', (q) =>
                    q
                        .eq('webhook_id', args.webhook_id)
                        .eq('status', 'failed')
                )
                .order('desc')
                .take(safeLimit),
        ]);

        return [...successRows, ...failedRows]
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, safeLimit);
    },
});

export const claimPendingDeliveries = mutation({
    args: {
        worker_id: v.string(),
        limit: v.number(),
        now: v.number(),
    },
    handler: async (ctx, args) => {
        const safeLimit = Math.max(0, Math.floor(args.limit));
        if (safeLimit === 0) return [];

        const rows = await ctx.db
            .query('webhook_delivery_logs')
            .withIndex('by_status_retry_created', (q) =>
                q.eq('status', 'pending').lte('next_retry_at_sort', args.now)
            )
            .order('asc')
            .take(safeLimit);

        const claimed: typeof rows = [];
        for (const row of rows) {
            await ctx.db.patch(row._id, {
                status: 'in_flight',
                claimed_by: args.worker_id,
                claimed_at: args.now,
                claimed_at_sort: args.now,
            });

            claimed.push({
                ...row,
                status: 'in_flight',
                claimed_by: args.worker_id,
                claimed_at: args.now,
                claimed_at_sort: args.now,
            });
        }

        return claimed;
    },
});

export const resetStaleInFlightDeliveries = mutation({
    args: {
        cutoff: v.number(),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query('webhook_delivery_logs')
            .withIndex('by_status_claimed', (q) =>
                q.eq('status', 'in_flight').lt('claimed_at_sort', args.cutoff)
            )
            .collect();

        await Promise.all(
            rows.map((row) =>
                ctx.db.patch(row._id, {
                    status: 'pending',
                    claimed_by: undefined,
                    claimed_at: undefined,
                    claimed_at_sort: 0,
                })
            )
        );

        return rows.length;
    },
});

export const cancelDeliveriesByWebhook = mutation({
    args: {
        webhook_id: v.string(),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query('webhook_delivery_logs')
            .withIndex('by_webhook_created', (q) => q.eq('webhook_id', args.webhook_id))
            .collect();

        const cancelable = rows.filter(
            (row) => row.status === 'pending' || row.status === 'in_flight'
        );

        await Promise.all(
            cancelable.map((row) =>
                ctx.db.patch(row._id, {
                    status: 'cancelled',
                    claimed_by: undefined,
                    claimed_at: undefined,
                    claimed_at_sort: 0,
                    next_retry_at: undefined,
                    next_retry_at_sort: 0,
                })
            )
        );

        return cancelable.length;
    },
});

export const deleteDeliveryLogsByWebhook = mutation({
    args: {
        webhook_id: v.string(),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query('webhook_delivery_logs')
            .withIndex('by_webhook_created', (q) => q.eq('webhook_id', args.webhook_id))
            .collect();

        await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
        return rows.length;
    },
});

export const purgeExpiredLogs = mutation({
    args: {
        before_timestamp: v.number(),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query('webhook_delivery_logs')
            .withIndex('by_created', (q) => q.lt('created_at', args.before_timestamp))
            .collect();

        await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
        return rows.length;
    },
});
