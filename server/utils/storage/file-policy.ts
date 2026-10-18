import type { H3Event } from 'h3';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { DEFAULT_FILE_POLICY, FILE_POLICY_KEY, FilePolicySchema } from '~~/shared/storage/file-policy';
import { or3Config } from '~~/config.or3';

export async function readFilePolicy(event: H3Event, workspaceId: string) {
    const raw = await getWorkspaceSettingsStore(event).get(workspaceId, FILE_POLICY_KEY);
    return raw === null ? FilePolicySchema.parse({ ...DEFAULT_FILE_POLICY,
        maxUploadBytes: Math.min(1024 * 1024 * 1024, or3Config.limits.maxCloudFileSizeBytes),
    }) : FilePolicySchema.parse(JSON.parse(raw));
}
