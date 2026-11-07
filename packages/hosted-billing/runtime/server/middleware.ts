import { createError, defineEventHandler, getRequestURL, setResponseHeader } from 'h3';
import { resolveSessionContext } from '~~/server/auth/session';
import { requiresHostedAccess } from './access';
import { useBillingService } from './runtime';
import { ensureTrial } from './trial';

export default defineEventHandler(async event => {
    let path: string;
    try { path = decodeURIComponent(getRequestURL(event).pathname).replace(/\/+$/, ''); }
    catch { throw createError({ statusCode: 400, statusMessage: 'Invalid request path' }); }
    if (!requiresHostedAccess(event.method, path)) return;
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user?.id) throw createError({ statusCode: 401, statusMessage: 'Sign in to use hosted services' });
    ensureTrial(event, session, useBillingService().store);
    if (!useBillingService().store.status(session.user.id).allowed) {
        throw createError({ statusCode: 402, statusMessage: 'Cloud plan required', data: { code: 'cloud_plan_required', billingUrl: '/billing' } });
    }
    // This is an additional admission gate. Route-specific can(), origin checks,
    // validation and provider authorization still run normally.
});
