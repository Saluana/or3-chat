import type { H3Event } from 'h3';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { DEFAULT_FAST_MODEL, FAST_MODEL_SETTING, FastModelSchema } from '~~/shared/ai/fast-model';

/** The workspace's fast model; Cloud settings are authoritative over any client value. */
export async function readFastModel(event: H3Event, workspaceId: string): Promise<string> {
    try {
        const stored = await getWorkspaceSettingsStore(event).get(workspaceId, FAST_MODEL_SETTING);
        return FastModelSchema.safeParse(stored).data ?? DEFAULT_FAST_MODEL;
    } catch { throw new Error('Fast model settings unavailable.'); }
}
