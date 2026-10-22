import { createHash, randomUUID } from 'node:crypto';
import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireCan, requireSession } from '../../auth/can';
import { getAuthorizationRevision, resolveSessionContext } from '../../auth/session';
import { EXTENSIONS_BASE_DIR } from '../../admin/extensions/paths';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { ImmutablePluginPackageStore } from '../../admin/plugins/package-store';
import { readPackageManifest } from '../../admin/plugins/package-operation-support';
import { resolvePluginPackage } from '../../utils/plugins/setup/discovery';
import { requirePluginMutation } from '../../utils/plugins/connections/api-context';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import { authorizeHostActivation, checkHostActivationLive } from '../../utils/plugins/isolation/activation-authorization';
import { getActiveSecretStore } from '../../secrets/registry';
import { checkRateLimit } from '../../utils/rate-limit';

let inFlight = 0;
function refuse(statusCode: number, code?: 'conflict'): never { throw createError({ statusCode, ...(code ? { data: { code } } : {}), statusMessage: statusCode === 400 ? 'Invalid secret request' : 'Secret operation refused' }); };
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 128 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && Buffer.from(value).toString('utf8') === value;
export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    requirePluginMutation(event);
    const config = useRuntimeConfig();
    const secrets = config.secrets as typeof config.secrets | undefined;
    if (!config.auth.enabled || !secrets?.provider) refuse(404);
    const session = await resolveSessionContext(event);
    requireSession(session);
    const userId = session.user?.id, workspaceId = session.workspace?.id;
    if (!userId || !workspaceId) refuse(401);
    requireCan(session, 'workspace.write', { kind: 'workspace', id: workspaceId });
    const storeId = config.sync.provider || config.public.sync.provider || 'convex';
    const revision = () => getAuthorizationRevision(session.provider ?? '', session.providerUserId ?? '', storeId);
    const authorizationRevision = revision();
    const live = (activationId: string) => {
        if (revision() !== authorizationRevision || !checkHostActivationLive(activationId).ok) refuse(409);
    };
    if (!await checkRateLimit(`plugin-secrets:${userId}`, { max: 60, window: 60 })) {
        setResponseHeader(event, 'Retry-After', 60); refuse(429);
    }
    const body = await readLimitedJsonBody<unknown>(event, 256 * 1024);
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['operation', 'pluginId', 'activationId', 'key', 'value'].includes(key))) refuse(400);
    const { operation, pluginId, activationId, key, value } = body as Record<string, unknown>;
    if (!identifier(pluginId) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(pluginId) || pluginId.includes('..') || typeof activationId !== 'string' || !activationId || activationId.length > 512 || typeof operation !== 'string' || !['get', 'set', 'delete', 'ref', 'status', 'unlock'].includes(operation)) refuse(400);
    if (operation !== 'unlock' && (operation !== 'status' || key !== undefined) && !identifier(key)) refuse(400);
    if (operation === 'unlock' && key !== undefined) refuse(400);
    if (operation === 'set' ? typeof value !== 'string' || Buffer.byteLength(value) > 32 * 1024 || Buffer.from(value).toString('utf8') !== value : value !== undefined) refuse(400);
    if (!identifier(secrets.namespace)) refuse(503);
    // Slow uploads cannot hold a vault slot. Reserve before joining a package's
    // operation queue; all concurrent requests share the same process budget.
    if (inFlight >= 16) { setResponseHeader(event, 'Retry-After', 1); refuse(429); }
    inFlight++;
    try {
        const packages = new ImmutablePluginPackageStore(EXTENSIONS_BASE_DIR);
        return await packages.runPluginOperation(pluginId, async () => {
            const selected = await resolvePluginPackage(pluginId, EXTENSIONS_BASE_DIR, 'current');
            if (!selected || selected.status === 'blocked' || selected.source !== 'package' || !selected.path || !selected.digest) refuse(409);
            const manifest = await readPackageManifest(selected.path);
            if (manifest.trust !== 'trusted-host') refuse(403);
            const authorized = await authorizeHostActivation({ event, activationId, pluginId, workspaceId, userId, packagePath: selected.path, packageDigest: selected.digest, settingsStore: getWorkspaceSettingsStore(event) });
            if (!authorized.ok) refuse(authorized.statusCode);
            const grant = operation === 'set' || operation === 'delete' ? 'secrets.write' : operation === 'ref' || operation === 'unlock' ? 'secrets.use' : 'secrets.read';
            if (!authorized.record.grants.approvedGrants.includes(grant)) refuse(403);
            live(activationId);
            const context = { requestId: randomUUID(), actorId: userId, activationId: createHash('sha256').update(activationId).digest('hex') };
            const scope = { namespace: secrets.namespace, ownerUserId: userId, workspaceId, consumerId: pluginId };
            // Fixed fields only; the corresponding vault event records this same request/actor/activation.
            console.info(JSON.stringify({ event: 'plugin_secret_authorized', operation, ...context }));
            try {
                const store = getActiveSecretStore(); if (!store) refuse(503);
                let result: unknown;
                if (operation === 'get') {
                    try { result = (await store.resolve({ scope, selector: { name: key as string } }, context)).value; }
                    catch (error) { if ((error as { code?: string }).code === 'not_found') result = null; else throw error; }
                } else if (operation === 'set' || operation === 'delete') {
                    const meta = await store.inspect({ scope, name: key as string }, context);
                    live(activationId);
                    if (operation === 'set') await store.put({ scope, name: key as string, value: value as string, expectedRevision: meta?.ref.revision ?? 0 }, context);
                    else if (meta && meta.state !== 'deleted') await store.delete({ scope, name: key as string, expectedRevision: meta.ref.revision }, context);
                } else if (operation === 'ref' || operation === 'status' && key !== undefined) {
                    const meta = await store.inspect({ scope, name: key as string }, context);
                    const state = meta?.state === 'available' ? 'available' : 'missing';
                    result = operation === 'ref' ? { id: meta?.ref.id ?? key, revision: meta?.ref.revision ?? 0, state, persistence: 'persistent', owner: 'plugin' } : state;
                } else { await store.available(context); result = operation === 'status' ? 'available' : undefined; }
                live(activationId);
                return { value: result };
            } catch (error) {
                live(activationId);
                const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode;
                refuse(status === 409 ? 409 : status === 403 ? 403 : 503, (error as { code?: string }).code === 'revision_conflict' ? 'conflict' : undefined);
            }
        });
    } finally { inFlight--; }
});
