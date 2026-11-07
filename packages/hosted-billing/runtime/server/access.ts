/** Cloud transport stops on Free Local; foreground BYOK chat and explicit recovery remain available. */
export function requiresHostedAccess(method: string, path: string): boolean {
    if (!path.startsWith('/api/')) return false;
    if (method !== 'OPTIONS' && path.startsWith('/api/sync/')) return true;
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
    if (/^\/api\/(?:auth|basic-auth|billing|admin)\//.test(path)) return false;
    if (method === 'POST' && new Set([
        '/api/storage/presign-download', '/api/storage/commit', '/api/workspaces/active',
        '/api/plugins/isolation/activation', '/api/plugins/isolation/capability',
        '/api/openrouter/stream', '/api/openrouter/title', '/api/openrouter/classify-memory',
        '/api/openrouter/credentials', '/api/openrouter/oauth', '/api/openai/credentials',
        '/api/openrouter/models', '/api/openai/models',
        '/api/jobs/admission-abort', '/api/connect/device/deny',
        '/api/connect/device/start', '/api/connect/device/token',
        '/api/connect/environments/revoke', '/api/connect/environments/remove',
    ]).has(path)) return false;
    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/abort$/.test(path)) return false;
    // Existing signed upload reservations remain bounded by their original expiry.
    if (method === 'PUT' && path === '/api/storage/fs/upload') return false;
    if (method === 'POST' && /^\/api\/plugins\/[^/]+\/(first-action|setup-values)$/.test(path)) return false;
    // Results belong to an already-admitted durable generation; expiry must not strand it.
    if (method === 'POST' && /^\/api\/jobs\/[^/]+\/client-tool\/(claim|result|validate)$/.test(path)) return false;
    // Removing a workspace is account/data management. Existing owner authorization still applies.
    if (method === 'DELETE' && /^\/api\/workspaces\/[^/]+$/.test(path)) return false;
    return true;
}
