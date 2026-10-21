import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createError, defineEventHandler, deleteCookie, getCookie, getHeader, getQuery, sendRedirect, setCookie, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { checkRateLimit } from '../../utils/rate-limit';
import { fetchWithResponseDeadline } from '~~/shared/openrouter/deadlines';
import { openRouterCredentialOperation } from '../../secrets/openrouter';

/** Cloud PKCE lives in an HttpOnly transaction cookie, bound to the account. */
export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    setResponseHeader(event, 'Referrer-Policy', 'no-referrer');
    if (!useRuntimeConfig().auth.enabled) throw createError({ statusCode: 404 });
    const session = await resolveSessionContext(event);
    const local = /^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(getHeader(event, 'host') ?? '');
    const name = local ? 'or3-openrouter-local' : '__Host-or3-openrouter';
    const options = { httpOnly: true, secure: !local, sameSite: 'lax' as const, path: '/' };
    if (event.method === 'POST') {
        requireCloudMutation(event);
        if (!session.authenticated || !session.user?.id || !session.workspace?.id) throw createError({ statusCode: 401 });
        if (getHeader(event, 'x-or3-account') !== JSON.stringify([session.provider, session.user.id]))
            throw createError({ statusCode: 409, statusMessage: 'The signed-in account changed. Refresh before trying again.' });
        requireCan(session, 'workspace.write', { kind: 'workspace', id: session.workspace.id });
        if (!useRuntimeConfig().secrets?.provider) throw createError({ statusCode: 503, statusMessage: 'OpenRouter credential storage unavailable.' });
        if (!await checkRateLimit(`openrouter-oauth:${session.user.id}`, { max: 10, window: 60 })) throw createError({ statusCode: 429 });
        // The origin has just passed the proxy-aware same-origin guard. Never accept a callback URL from the body.
        const originHeader = getHeader(event, 'origin');
        if (!originHeader) throw createError({ statusCode: 400, statusMessage: 'A browser Origin is required.' });
        const origin = new URL(originHeader);
        if (origin.protocol !== 'https:' && !local) throw createError({ statusCode: 400, statusMessage: 'HTTPS is required.' });
        const verifier = randomBytes(32).toString('base64url');
        const state = randomBytes(32).toString('base64url');
        setCookie(event, name, JSON.stringify({ verifier, state, userId: session.user.id, expires: Date.now() + 600_000 }), { ...options, maxAge: 600 });
        const url = new URL('https://openrouter.ai/auth');
        url.search = new URLSearchParams({ callback_url: `${origin.origin}/api/openrouter/oauth`, state,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
        return { url: url.toString() };
    }
    if (event.method !== 'GET') throw createError({ statusCode: 405 });
    const cookie = getCookie(event, name);
    deleteCookie(event, name, options);
    let connected = false;
    try {
        const transaction = JSON.parse(cookie ?? 'null');
        const query = getQuery(event);
        if (!session.authenticated || !session.user?.id || !session.workspace?.id
            || !transaction || transaction.userId !== session.user.id || !Number.isFinite(transaction.expires) || transaction.expires < Date.now()
            || typeof transaction.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(transaction.verifier)
            || typeof query.code !== 'string' || query.code.length > 2048 || !query.code
            || typeof query.state !== 'string' || typeof transaction.state !== 'string'
            || Buffer.byteLength(query.state) !== Buffer.byteLength(transaction.state)
            || !timingSafeEqual(Buffer.from(query.state), Buffer.from(transaction.state))) throw new Error('Invalid transaction');
        requireCan(session, 'workspace.write', { kind: 'workspace', id: session.workspace.id });
        const response = await fetchWithResponseDeadline('https://openrouter.ai/api/v1/auth/keys', {
            method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: query.code, code_verifier: transaction.verifier, code_challenge_method: 'S256' }),
        }, { timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Exchange refused');
        const { readBoundedBody } = await import('../../utils/plugins/connections/bounded-body');
        const body = await readBoundedBody(response, { maxBytes: 2048 });
        if (!body.ok) throw new Error('Invalid response');
        const result = await openRouterCredentialOperation(session, { operation: 'save', key: JSON.parse(body.text).key });
        connected = result.connected;
    } catch { /* Fixed redirect only: provider errors and credentials never reach the browser. */ }
    return sendRedirect(event, `/openrouter-callback?connection=${connected ? 'connected' : 'failed'}`, 302);
});
