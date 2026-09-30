import { createError, setResponseStatus, type H3Event } from 'h3';
import { z } from 'zod';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import type { PluginRolloutCoordinator } from './rollout-service';
import type { PluginRolloutRecord } from './rollout-store';

const MutationBody = z.object({ expectedRevision: z.number().int().positive() }).strict();
type MutationStatus = { processing: boolean; failure: string | null };
const mutationStatuses = new Map<string, MutationStatus>();

/** Polling must distinguish an unfinished write from a request that failed after HTTP 202. */
export function rolloutMutationStatus(id: string): MutationStatus | null {
    return mutationStatuses.get(id) ?? null;
}

export async function expectedRolloutRevision(event: H3Event): Promise<number> {
    const parsed = MutationBody.safeParse(await readLimitedJsonBody(event));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'The current rollout revision is required.' });
    return parsed.data.expectedRevision;
}

/** Return a pending snapshot while a slow provider mutation retains the plugin lock. */
export async function respondToRolloutMutation(
    event: H3Event,
    coordinator: PluginRolloutCoordinator,
    id: string,
    mutation: Promise<PluginRolloutRecord>
) {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const status: MutationStatus = { processing: true, failure: null };
    mutationStatuses.set(id, status);
    const finish = () => {
        status.processing = false;
        const cleanup = setTimeout(() => {
            if (mutationStatuses.get(id) === status) mutationStatuses.delete(id);
        }, 300_000);
        cleanup.unref?.();
    };
    const observed = mutation.then((record) => {
        finish();
        return record;
    }, (error: unknown) => {
        finish();
        status.failure = rolloutHttpError(error).statusMessage ?? 'The rollout request failed. Refresh and retry.';
        if (timedOut) console.warn('[plugin-rollout] Background mutation failed after pending response', {
            operationId: id, code: (error as { code?: string })?.code ?? 'rollout-unavailable',
        });
        throw error;
    });
    try {
        const result = await Promise.race([
            observed.then((record) => ({ processing: false as const, record })),
            new Promise<{ processing: true }>((resolve) => {
                timer = setTimeout(() => { timedOut = true; resolve({ processing: true }); }, 8_000);
            }),
        ]);
        if (result.processing) setResponseStatus(event, 202);
        return {
            ok: true,
            processing: result.processing,
            operation: await coordinator.deps.records.page(id),
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Preserve expected recovery codes without exposing provider exception details. */
export function rolloutHttpError(error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code : 'rollout-unavailable';
    const statusCode = code === 'rollout-not-found' ? 404
        : code === 'rollout-invalid' || code === 'invalid-grants' ? 400
            : code === 'rollout-preview-stale' || code === 'rollout-conflict' ? 409
                : 503;
    const message = error instanceof Error && code !== 'rollout-unavailable'
        ? error.message : 'The rollout could not be checked. Retry after refreshing.';
    return createError({ statusCode, statusMessage: message, data: { code } });
}
