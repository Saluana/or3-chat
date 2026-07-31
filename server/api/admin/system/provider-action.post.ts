/**
 * @module server/api/admin/system/provider-action.post
 *
 * Purpose:
 * Executes provider-specific administrative tasks (e.g. database migration, index rebuild).
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../admin/api';
import { getProviderAdminAdapter } from '../../../admin/providers/registry';
import { createStubProviderAdapter } from '../../../admin/providers/adapters/stub';
import type { ProviderKind } from '../../../admin/providers/types';

const BodySchema = z.object({
    kind: z.enum(['auth', 'sync', 'storage']),
    actionId: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/admin/system/provider-action
 *
 * Purpose:
 * Generic gateway for provider RPCs.
 *
 * Behavior:
 * - Resolves the provider adapter for the requested `kind`.
 * - Dispatches `actionId` to the adapter.
 * - Handles `stub` adapters gracefully if no real provider is configured.
 */
export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event, { ownerOnly: true, mutation: true });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const config = useRuntimeConfig();
    const kind = body.data.kind as ProviderKind;
    const provider =
        kind === 'auth'
            ? config.auth.provider
            : kind === 'sync'
            ? config.sync.provider
            : config.storage.provider;

    const adapter =
        getProviderAdminAdapter(kind, provider) ??
        createStubProviderAdapter(kind, provider);

    if (!adapter.runAction) {
        throw createError({ statusCode: 501, statusMessage: 'Action not supported' });
    }

    const enabled =
        kind === 'auth'
            ? Boolean(config.auth.enabled)
            : kind === 'sync'
            ? Boolean(config.sync.enabled)
            : Boolean(config.storage.enabled);

    const result = await adapter.runAction(event, body.data.actionId, body.data.payload, {
        provider,
        enabled,
        session,
    });

    return { ok: true, result };
});
