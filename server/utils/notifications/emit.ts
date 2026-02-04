/**
 * @module server/utils/notifications/emit
 *
 * Purpose:
 * Provider-agnostic notification emission. Core delegates to the registered
 * notification emitter for the configured backend.
 */
import { getNotificationEmitter } from './registry';

function getConfiguredEmitterId(): string | null {
    const config = useRuntimeConfig();
    return config.sync?.provider ?? null;
}

function requireEmitter() {
    const id = getConfiguredEmitterId();
    if (!id) {
        throw new Error('[notifications] No provider configured');
    }
    const emitter = getNotificationEmitter(id);
    if (!emitter) {
        throw new Error(`[notifications] No emitter registered for ${id}`);
    }
    return emitter;
}

export async function emitBackgroundJobComplete(
    workspaceId: string,
    userId: string,
    threadId: string,
    jobId: string
): Promise<string> {
    const emitter = requireEmitter();
    return emitter.emitBackgroundJobComplete({
        workspaceId,
        userId,
        threadId,
        jobId,
    });
}

export async function emitBackgroundJobError(
    workspaceId: string,
    userId: string,
    threadId: string,
    jobId: string,
    error: string
): Promise<string> {
    const emitter = requireEmitter();
    return emitter.emitBackgroundJobError({
        workspaceId,
        userId,
        threadId,
        jobId,
        error,
    });
}
