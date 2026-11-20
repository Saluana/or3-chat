import { expect, type APIRequestContext } from '@playwright/test';
import { HISTORY_INCARNATION_CAPABILITY, PullResponseSchema } from '../../../shared/sync/schemas';

export async function discoverSyncHistory(
    request: APIRequestContext,
    headers: Record<string, string>,
    workspaceId: string
) {
    const historyIncarnationCapability = HISTORY_INCARNATION_CAPABILITY;
    const response = await request.post('/api/sync/pull', {
        headers,
        data: { scope: { workspaceId }, cursor: 0, limit: 1, historyIncarnationCapability, historyIncarnation: null },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const page = PullResponseSchema.parse(await response.json());
    expect(page.requiresSnapshot).toBe(true);
    expect(page.changes).toEqual([]);
    const { historyIncarnation } = page;
    if (!historyIncarnation) throw new Error('Sync discovery did not return a history incarnation');
    return { historyIncarnationCapability, historyIncarnation };
}
