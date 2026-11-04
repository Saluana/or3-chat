/** Host route discovery and request-scoped project ownership. */
interface ServerRouteCacheEntry {
    available: boolean;
    timestamp: number;
}

// Cache key for detecting static build (no server routes)
const SERVER_ROUTE_AVAILABLE_CACHE_KEY = 'or3:server-route-available';
const SERVER_ROUTE_AVAILABLE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check if server routes are available (not a static build).
 * Uses localStorage to cache the result to avoid repeated 404 attempts.
 * Includes a TTL so transient failures are periodically retried.
 */
export function isServerRouteAvailable(): boolean {
    if (typeof localStorage === 'undefined') return false;

    const cached = localStorage.getItem(SERVER_ROUTE_AVAILABLE_CACHE_KEY);
    if (cached === null) {
        // First time; assume available
        return true;
    }

    try {
        const parsed: unknown = JSON.parse(cached);
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'available' in parsed &&
            'timestamp' in parsed &&
            typeof (parsed as ServerRouteCacheEntry).available === 'boolean' &&
            typeof (parsed as ServerRouteCacheEntry).timestamp === 'number'
        ) {
            const { available, timestamp } = parsed as ServerRouteCacheEntry;
            const now = Date.now();
            const isExpired = now - timestamp > SERVER_ROUTE_AVAILABLE_TTL_MS;

            if (isExpired) {
                // TTL expired; retry the server route
                return true;
            }

            return available;
        }
        // Invalid shape; assume available
        return true;
    } catch {
        // Invalid cache; assume available
        return true;
    }
}

/**
 * A 404/405 only means the stream route is absent when the route did not
 * answer itself. The route marks every response (including relayed provider
 * errors such as "No endpoints found that support image input").
 */
export function isMissingServerRoute(response: Response): boolean {
    return (response.status === 404 || response.status === 405)
        && response.headers.get('x-or3-stream-route') !== '1';
}

/**
 * Mark server routes as available or unavailable with TTL.
 */
export function setServerRouteAvailable(available: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
        SERVER_ROUTE_AVAILABLE_CACHE_KEY,
        JSON.stringify({
            available,
            timestamp: Date.now(),
        })
    );
}

export async function assertDispatchOwner(params: {
    expectedProjectId?: string | null;
    threadId?: string;
    signal?: AbortSignal;
}) {
    if (params.expectedProjectId === undefined || !params.threadId) return;
    const { captureProjectOperation } = await import('~/utils/projects/context');
    const { resolveChatProject } = await import('~/db/project-workspace');
    const scope = captureProjectOperation(params.signal, params.threadId);
    if (await resolveChatProject(scope.db, params.threadId) !== params.expectedProjectId)
        throw new Error('This chat changed projects before dispatch. Start a new turn.');
    scope.assertCurrent();
}

