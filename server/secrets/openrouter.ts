import { createError, getHeader, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import type { SessionContext } from '~/core/hooks/hook-types';
import { requireCan } from '../auth/can';
import { resolveSessionContext } from '../auth/session';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { requireCloudMutation } from '../utils/security/cloud-mutation';
import { getActiveSecretStore } from './registry';

const KEY_NAME = 'api-key';
const unavailable = () => createError({ statusCode: 503, statusMessage: 'OpenRouter credential storage unavailable. Contact the administrator.' });

function requireAccount(session: SessionContext | null): asserts session is SessionContext & { user: { id: string }; workspace: { id: string } } {
    if (!session?.authenticated || !session.user?.id || !session.workspace?.id)
        throw createError({ statusCode: 401, statusMessage: 'Sign in to connect OpenRouter.' });
    requireCan(session, 'workspace.write', { kind: 'workspace', id: session.workspace.id });
}
function accountStore(session: SessionContext) {
    const config = useRuntimeConfig();
    const store = getActiveSecretStore();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial runtime configs can omit secrets.
    if (!store || !config.secrets?.namespace) throw unavailable();
    return { store, scope: { namespace: config.secrets.namespace, ownerUserId: session.user!.id,
        workspaceId: '@account', consumerId: '@or3.openrouter' }, context: { actorId: session.user!.id } };
}
function storageError(error: unknown): never {
    const code = (error as { code?: string }).code;
    if (code === 'revision_conflict') throw createError({ statusCode: 409, statusMessage: 'The connection changed. Refresh before trying again.' });
    throw unavailable();
}

/** The only billing-selection policy. The returned credential must stay on the server. */
export async function resolveOpenRouterCredential(event: H3Event, knownSession?: SessionContext | null): Promise<{ apiKey: string | undefined; source: 'personal' | 'server' }> {
    const config = useRuntimeConfig(event);
    const cloud = isSsrAuthEnabled(event);
    const required = config.openrouterRequireUserKey === true;
    const override = config.openrouterAllowUserOverride !== false;
    let personal: string | undefined;
    if (cloud) {
        const session = knownSession ?? await resolveSessionContext(event);
        requireAccount(session);
        if (required || override) {
            // An explicit opt-out supports instance billing only, never browser BYOK.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial runtime configs can omit secrets.
            if (config.secrets?.provider) {
                const { store, scope, context } = accountStore(session);
                try { personal = (await store.resolve({ scope, selector: { name: KEY_NAME } }, context)).value; }
                catch (error) { if ((error as { code?: string }).code !== 'not_found') storageError(error); }
            } else if (required) throw unavailable();
        }
    } else if (required || override) {
        personal = getHeader(event, 'x-or3-openrouter-key')?.trim()
            || getHeader(event, 'authorization')?.match(/^Bearer (.+)$/)?.[1];
    }
    if (personal || required) return { apiKey: personal, source: 'personal' };
    const apiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY || undefined;
    if (apiKey && !cloud) {
        requireCloudMutation(event);
        requireCan(knownSession ?? await resolveSessionContext(event), 'workspace.write');
    }
    return { apiKey, source: 'server' };
}

/** Metadata and write operations only. No user-facing read-for-disclosure operation. */
export async function openRouterCredentialOperation(session: SessionContext, body: unknown) {
    requireAccount(session);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400 });
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !['operation', 'key'].includes(key))
        || !['status', 'save', 'migrate', 'delete'].includes(String(input.operation))
        || (input.operation === 'save' || input.operation === 'migrate'
            ? typeof input.key !== 'string' || !/^sk-or-[A-Za-z0-9_-]{9,512}$/.test(input.key.trim())
            : input.key !== undefined)) throw createError({ statusCode: 400, statusMessage: 'Invalid OpenRouter connection request.' });
    // Explicit instance-only mode has no personal store to query. Distinguish
    // this from an unexpected vault outage, which must continue to fail closed.
    if (input.operation === 'status' && useRuntimeConfig().secrets.provider === '')
        return { connected: false, persisted: false, available: false };
    const { store, scope, context } = accountStore(session);
    try {
        let meta = await store.inspect({ scope, name: KEY_NAME }, context);
        if (input.operation === 'migrate' && meta)
            throw createError({ statusCode: 409, statusMessage: 'A server connection record already exists. Refresh connection status.' });
        if (input.operation === 'save' || input.operation === 'migrate')
            meta = await store.put({ scope, name: KEY_NAME, value: (input.key as string).trim(), expectedRevision: meta?.ref.revision ?? 0 }, context);
        else if (input.operation === 'delete' && meta?.state === 'available')
            meta = await store.delete({ scope, name: KEY_NAME, expectedRevision: meta.ref.revision }, context);
        return { connected: meta?.state === 'available', persisted: meta !== null };
    } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 409) throw error;
        storageError(error);
    }
}
