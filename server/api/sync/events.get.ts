import { createError, createEventStream, defineEventHandler, getQuery } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { requireStorageWorkspaceAccess } from '../../utils/storage/workspace-access';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import { setNoCacheHeaders } from '../../utils/headers';

// One origin leader normally owns each workspace subscription. Bound open
// requests per user as well as per-request queues to contain connection abuse.
const connections = new Map<string, number>();
const MAX_CONNECTIONS_PER_USER = 8;

/** Content-free wakeups. All data still crosses the ordinary pull/snapshot
 * authorization, retention, schema-validation and cursor-acknowledgement path.
 */
export default defineEventHandler(async event => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) throw createError({ statusCode: 404 });
    setNoCacheHeaders(event);
    const workspaceId = getQuery(event).workspaceId;
    if (typeof workspaceId !== 'string' || !workspaceId.trim() || workspaceId.length > 256) throw createError({ statusCode: 400 });
    const session = await resolveSessionContext(event);
    const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : Infinity;
    const startedAt = Date.now();
    await requireStorageWorkspaceAccess(event, session, workspaceId);
    const adapter = getActiveSyncGatewayAdapter();
    if (!adapter?.watchVersion) throw createError({ statusCode: 404 });
    const userId = session.user!.id;
    const count = connections.get(userId) ?? 0;
    if (count >= MAX_CONNECTIONS_PER_USER) throw createError({ statusCode: 429, statusMessage: 'Too many sync notification connections' });
    const stream = createEventStream(event);
    connections.set(userId, count + 1);
    let closed = false, draining = false;
    let pending: number | undefined;
    let stop: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let lifetime: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
        if (closed) return;
        closed = true;
        const remaining = (connections.get(userId) ?? 1) - 1;
        if (remaining > 0) connections.set(userId, remaining); else connections.delete(userId);
        if (heartbeat) clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        stop?.();
    };
    const close = () => { cleanup(); void stream.close().catch(() => {}); };
    stream.onClosed(cleanup);
    const drain = async () => {
        if (draining || closed) return;
        draining = true;
        try {
            while (!closed && pending !== undefined) {
                const version = pending; pending = undefined;
                if (Date.now() >= expiresAt) { close(); return; }
                await requireStorageWorkspaceAccess(event, session, workspaceId);
                if (!closed) await stream.push(JSON.stringify({ version }));
            }
        } catch { close(); }
        finally { draining = false; }
    };
    try {
        // Session rotation cannot depend on an idle heartbeat: a slow client
        // or permission lookup must still release its backend subscription.
        lifetime = setTimeout(() => {
            if (!closed && Date.now() < expiresAt) {
                void stream.push(JSON.stringify({ refresh: true })).catch(() => {});
            }
            close();
        }, Math.max(0, Math.min(startedAt + 60_000, expiresAt) - Date.now()));
        lifetime.unref?.();
        stop = await adapter.watchVersion(event, { workspaceId }, version => {
            if (!Number.isSafeInteger(version) || version < 0 || closed) return;
            pending = version;
            void drain();
        }, close);
        if (closed) { stop(); return await stream.send(); }
        // Keep proxies alive and revoke idle listeners without per-pull reads.
        // Do not queue heartbeats behind a slow client or an in-flight check.
        heartbeat = setInterval(() => {
            if (draining || closed) return;
            if (Date.now() >= expiresAt) { close(); return; }
            draining = true;
            void requireStorageWorkspaceAccess(event, session, workspaceId)
                .then(async () => {
                    if (closed) return;
                    await stream.push({ event: 'keepalive', data: '' });
                })
                .catch(close).finally(() => { draining = false; void drain(); });
        }, 30_000);
        heartbeat.unref?.();
        return await stream.send();
    } catch (error) { close(); throw error; }
});
