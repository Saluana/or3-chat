import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import { checkRateLimit } from '../../utils/rate-limit';
import { openRouterCredentialOperation } from '../../secrets/openrouter';

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    if (!isSsrAuthEnabled(event)) throw createError({ statusCode: 404 });
    requireCloudMutation(event);
    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user?.id) throw createError({ statusCode: 401 });
    // Cookies may switch accounts before the tab's reactive session state.
    if (getHeader(event, 'x-or3-account') !== JSON.stringify([session.provider, session.user.id]))
        throw createError({ statusCode: 409, statusMessage: 'The signed-in account changed. Refresh before trying again.' });
    if (!await checkRateLimit(`openrouter-credentials:${session.user.id}`, { max: 30, window: 60 })) {
        setResponseHeader(event, 'Retry-After', 60); throw createError({ statusCode: 429 });
    }
    return openRouterCredentialOperation(session, await readLimitedJsonBody(event, 2048));
});
