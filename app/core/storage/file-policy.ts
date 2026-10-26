import { useRuntimeConfig } from '#imports';
import { FilePolicySchema, type FilePolicy } from '~~/shared/storage/file-policy';
import { withStorageDeadline } from './storage-request';

const verifiedPolicies = new Map<string, FilePolicy>();

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

export async function loadFilePolicy(workspaceId: string, signal?: AbortSignal): Promise<FilePolicy> {
    // Local intake can proceed offline after this workspace's settings were
    // verified. Uploads still pass the server's current policy on reconnect.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const policy = verifiedPolicies.get(workspaceId);
        if (policy) return policy;
        throw new Error('Connect once to load this workspace’s file storage settings.');
    }
    const policy = await withStorageDeadline(async requestSignal => {
        const response = await fetch(`/api/storage/policy?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: 'no-store', signal: requestSignal });
        if (!response.ok) throw new Error('File storage settings are unavailable. Please retry.');
        return FilePolicySchema.parse(await response.json());
    }, signal);
    verifiedPolicies.set(workspaceId, policy);
    return policy;
}
