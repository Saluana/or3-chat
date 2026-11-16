import { createError, type H3Event } from 'h3';
import { HISTORY_INCARNATION_CAPABILITY, HistoryIncarnationSchema } from '~~/shared/sync/schemas';
import type { SyncScope } from '~~/shared/sync/types';
import type { SyncGatewayAdapter } from '../../sync/gateway/types';

export function requireHistoryCapability(body: unknown): void {
    if (body && typeof body === 'object' && 'historyIncarnationCapability' in body &&
        body.historyIncarnationCapability === HISTORY_INCARNATION_CAPABILITY) return;
    throw createError({ statusCode: 426, statusMessage: 'Update OR3 Chat for history recovery',
        data: { code: 'OR3_SYNC_UPDATE_REQUIRED', requiredCapability: HISTORY_INCARNATION_CAPABILITY } });
}

export function historyChanged(historyIncarnation: string): never {
    throw createError({ statusCode: 409, statusMessage: 'Sync history changed',
        data: { code: 'OR3_SYNC_HISTORY_CHANGED', historyIncarnation, requiresSnapshot: true } });
}

/** Call after authorization, before any per-operation settlement or history decode. */
export async function checkHistory(event: H3Event, adapter: SyncGatewayAdapter | null | undefined,
    input: { scope: SyncScope; historyIncarnation?: string | null }, discovery = false): Promise<string> {
    if (adapter?.capabilities?.historyIncarnation !== 'v1' || !adapter.getHistoryIncarnation) {
        throw createError({ statusCode: 503, statusMessage: 'Sync provider requires history incarnation qualification',
            data: { code: 'OR3_SYNC_HISTORY_UNSUPPORTED' } });
    }
    if (input.historyIncarnation === undefined ||
        (input.historyIncarnation !== null && !HistoryIncarnationSchema.safeParse(input.historyIncarnation).success)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid history incarnation' });
    }
    const current = await adapter.getHistoryIncarnation(event, input.scope);
    assertHistoryResponse(current, current);
    if (!discovery && input.historyIncarnation !== current) historyChanged(current);
    return current;
}

/** Never stamp a response with an identity read after its data was captured. */
export function assertHistoryResponse(response: unknown, expected: string): void {
    if (!HistoryIncarnationSchema.safeParse(response).success || response !== expected) {
        throw createError({ statusCode: 502, statusMessage: 'Invalid bound sync history response' });
    }
}
