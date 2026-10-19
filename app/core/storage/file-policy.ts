import { useRuntimeConfig } from '#imports';
import { FilePolicySchema, type FilePolicy } from '~~/shared/storage/file-policy';

export function isCloudFileStorageEnabled(): boolean {
    try {
        const config = useRuntimeConfig().public;
        return config.ssrAuthEnabled === true && (config.storage as { enabled?: boolean } | undefined)?.enabled === true;
    } catch { return false; }
}

/** Canonical sync also forbids unsafe local replacement when storage is disabled. */
export function isCloudWorkspaceBackupEnabled(): boolean {
    try {
        const config = useRuntimeConfig().public;
        return config.ssrAuthEnabled === true && (config.sync as { enabled?: boolean } | undefined)?.enabled === true;
    } catch { return false; }
}

export async function loadFilePolicy(workspaceId: string): Promise<FilePolicy> {
    const response = await fetch(`/api/storage/policy?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('File storage settings are unavailable. Please retry.');
    return FilePolicySchema.parse(await response.json());
}
