import { createError, getHeader, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import type { SessionContext } from '~/core/hooks/hook-types';
import { requireCan } from '../auth/can';
import { resolveSessionContext } from '../auth/session';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { requireCloudMutation } from '../utils/security/cloud-mutation';
import { accountStore, requireAccount } from './openrouter';

const KEY_NAME = 'api-key';
const CONSUMER = '@or3.openai';
const unavailable = () => createError({ statusCode: 503, statusMessage: 'OpenAI credential storage unavailable. Contact the administrator.' });
export const OPENAI_KEY_HEADER = 'x-or3-openai-key';

/** A personal key wins over the instance key. The returned credential must stay on the server. */
export async function resolveOpenAiCredential(event: H3Event, knownSession?: SessionContext | null): Promise<{ apiKey: string | undefined; source: 'personal' | 'server' }> {
    const config = useRuntimeConfig(event);
    const cloud = isSsrAuthEnabled(event);
    let personal: string | undefined;
    if (cloud) {
        const session = knownSession ?? await resolveSessionContext(event);
        requireAccount(session, 'OpenAI');
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial runtime configs can omit secrets.
        if (config.secrets?.provider) {
            const { store, scope, context } = accountStore(session, CONSUMER, unavailable);
            try { personal = (await store.resolve({ scope, selector: { name: KEY_NAME } }, context)).value; }
            catch (error) { if ((error as { code?: string }).code !== 'not_found') throw unavailable(); }
        }
    } else personal = getHeader(event, OPENAI_KEY_HEADER)?.trim() || undefined;
    if (personal) return { apiKey: personal, source: 'personal' };
    const apiKey = config.openaiApiKey || undefined;
    if (apiKey && !cloud) {
        requireCloudMutation(event);
        requireCan(knownSession ?? await resolveSessionContext(event), 'workspace.write');
    }
    return { apiKey, source: 'server' };
}

/** Metadata and write operations only; a saved key is never read back to the browser. */
export async function openAiCredentialOperation(session: SessionContext, body: unknown) {
    requireAccount(session, 'OpenAI');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400 });
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !['operation', 'key'].includes(key))
        || !['status', 'save', 'delete'].includes(String(input.operation))
        || (input.operation === 'save'
            ? typeof input.key !== 'string' || !/^sk-[A-Za-z0-9_-]{20,512}$/.test(input.key.trim())
            : input.key !== undefined)) throw createError({ statusCode: 400, statusMessage: 'Invalid OpenAI connection request.' });
    const instance = Boolean(useRuntimeConfig().openaiApiKey);
    if (input.operation === 'status' && useRuntimeConfig().secrets.provider === '')
        return { connected: false, available: false, instance };
    const { store, scope, context } = accountStore(session, CONSUMER, unavailable);
    try {
        let meta = await store.inspect({ scope, name: KEY_NAME }, context);
        if (input.operation === 'save')
            meta = await store.put({ scope, name: KEY_NAME, value: (input.key as string).trim(), expectedRevision: meta?.ref.revision ?? 0 }, context);
        else if (input.operation === 'delete' && meta?.state === 'available')
            meta = await store.delete({ scope, name: KEY_NAME, expectedRevision: meta.ref.revision }, context);
        return { connected: meta?.state === 'available', available: true, instance };
    } catch (error) {
        if ((error as { code?: string }).code === 'revision_conflict')
            throw createError({ statusCode: 409, statusMessage: 'The connection changed. Refresh before trying again.' });
        throw unavailable();
    }
}
