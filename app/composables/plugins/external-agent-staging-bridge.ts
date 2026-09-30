const STAGING_BATCH = /^\.or3-upload-[0-9]{10,}-[a-z0-9]{6}$/u;
const CLEANUP_FAILED = 'Temporary attachment cleanup could not be confirmed. The files are retained to protect the runner; remove the generated .or3-upload-* folder from the workspace after the failed turn if needed.';
const CLEANUP_UNSUPPORTED = 'This host cannot release temporary attachment files yet. The files are retained to protect the runner; remove the generated .or3-upload-* folder from the workspace after the failed turn if needed.';

interface AgentStagingHost { readonly id: string; readonly baseUrl: string }
interface AgentUpload {
    readonly id: string;
    readonly kind: 'file' | 'image' | 'audio' | 'video' | 'text';
    readonly name: string;
    readonly mimeType?: string;
    readonly sizeBytes?: number;
    readonly data: Blob;
}
interface AgentStagedFile {
    readonly id: string;
    readonly source: 'workspace_ref' | 'local_artifact' | 'text_block';
    readonly kind: AgentUpload['kind'];
    readonly name: string;
    readonly mime_type?: string;
    readonly size_bytes?: number;
    readonly root_id?: string;
    readonly path?: string;
    readonly preview?: string;
}
type CleanupResult = { readonly status: 'released' | 'unsupported' | 'failed'; readonly warning?: string };

function stagingBaseUrl(host: AgentStagingHost): string {
    const parsed = new URL(host.baseUrl);
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('External Agent staging host URL is not trusted');
    }
    return parsed.toString().replace(/\/+$/u, '');
}

function stagingBatchFromPath(path: string): string | null {
    const [batch, name, ...extra] = path.replaceAll('\\', '/').split('/');
    return batch && name && !extra.length && name !== '.' && name !== '..' && STAGING_BATCH.test(batch)
        ? batch : null;
}

/** File grant implementation limited to Intern's workspace staging endpoints. */
export function createExternalAgentStagingBridge(fetchImpl: typeof fetch = globalThis.fetch) {
    const request = async <T>(host: AgentStagingHost, token: string, path: string, init: RequestInit = {}): Promise<T> => {
        if (!token.trim()) throw new Error('No credential is available for the selected host.');
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token.trim()}`);
        headers.set('Accept', 'application/json');
        if (host.id.startsWith('or3-connect:')) headers.set('X-Or3-Auth-Method', 'paired-device');
        const response = await fetchImpl(`${stagingBaseUrl(host)}${path}`, {
            ...init, headers, cache: 'no-store', redirect: 'error',
        });
        if (!response.ok) throw Object.assign(new Error('External Agent staging request failed'), { status: response.status });
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
    };
    const json = (body: unknown, signal?: AbortSignal): RequestInit => ({
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
    const releaseBatch = async (host: AgentStagingHost, token: string, batch: string): Promise<CleanupResult> => {
        if (!STAGING_BATCH.test(batch)) return { status: 'failed', warning: CLEANUP_FAILED };
        try {
            await request(host, token, '/internal/v1/files/staging/release',
                json({ root_id: 'workspace', path: batch }, AbortSignal.timeout(3_000)));
            return { status: 'released' };
        } catch (error) {
            const status = (error as { status?: number }).status;
            return status === 403 || status === 404 || status === 405
                ? { status: 'unsupported', warning: CLEANUP_UNSUPPORTED }
                : { status: 'failed', warning: CLEANUP_FAILED };
        }
    };
    return {
        async stageFiles(host: AgentStagingHost, token: string, attachments: readonly AgentUpload[], signal?: AbortSignal): Promise<readonly AgentStagedFile[]> {
            if (!attachments.length) return [];
            const roots = await request<{ items?: Array<{ id: string; writable?: boolean }> }>(
                host, token, '/internal/v1/files/roots', { signal });
            const root = roots.items?.find((item) => item.id === 'workspace');
            if (!root) throw new Error('This host does not expose a workspace for agent attachments.');
            if (root.writable === false) throw new Error("This host's workspace is read-only, so files cannot be attached.");
            const batch = `.or3-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await request(host, token, '/internal/v1/files/mkdir', json({ root_id: 'workspace', path: '.', name: batch }, signal));
            const staged: AgentStagedFile[] = [];
            try {
                for (const attachment of attachments) {
                    const form = new FormData();
                    form.set('root_id', 'workspace');
                    form.set('path', batch);
                    form.set('file', attachment.data, attachment.name);
                    const uploaded = await request<{ root_id?: string; path?: string }>(host, token, '/internal/v1/files/upload', {
                        method: 'POST', body: form, signal,
                    });
                    if ((uploaded.root_id || 'workspace') !== 'workspace') throw new Error('The host returned an unexpected attachment root.');
                    const safeName = attachment.name.replaceAll('\\', '/').split('/').pop() || 'attachment';
                    const path = (uploaded.path || `${batch}/${safeName}`).replaceAll('\\', '/');
                    if (stagingBatchFromPath(path) !== batch || path.split('/')[1] !== safeName) {
                        throw new Error('The host returned an unsafe attachment path.');
                    }
                    staged.push({
                        id: `workspace:${path}`, source: 'workspace_ref', kind: attachment.kind,
                        name: attachment.name, mime_type: attachment.mimeType,
                        size_bytes: attachment.sizeBytes, root_id: 'workspace', path, preview: path,
                    });
                }
                return staged;
            } catch (error) {
                const cleanup = await releaseBatch(host, token, batch);
                if (cleanup.warning) throw new Error(`${error instanceof Error ? error.message : String(error)} ${cleanup.warning}`, { cause: error });
                throw error;
            }
        },
        async releaseStagedFiles(host: AgentStagingHost, token: string, attachments: readonly AgentStagedFile[]): Promise<CleanupResult> {
            const batches = new Set<string>();
            for (const attachment of attachments) {
                if (attachment.source !== 'workspace_ref') continue;
                const batch = attachment.path ? stagingBatchFromPath(attachment.path) : null;
                if (attachment.root_id !== 'workspace' || !batch) return { status: 'failed', warning: CLEANUP_FAILED };
                batches.add(batch);
            }
            const results = await Promise.all([...batches].map((batch) => releaseBatch(host, token, batch)));
            const failed = results.find((result) => result.warning);
            if (!failed) return { status: 'released' };
            return results.some((result) => result.status === 'failed')
                ? { status: 'failed', warning: failed.warning }
                : { status: 'unsupported', warning: failed.warning };
        },
    };
}
