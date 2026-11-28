import { createError, defineEventHandler, getRequestURL, setResponseHeader } from 'h3';
import { resolveSessionContext } from '~~/server/auth/session';
import { requiresHostedAccess } from './access';
import { requireCloudAccess } from '~~/server/cloud/access';
import { useAccountQuota, useBillingService } from './runtime';
import { ensureTrial } from './trial';

export default defineEventHandler(async event => {
    let path: string;
    try { path = decodeURIComponent(getRequestURL(event).pathname).replace(/\/+$/, ''); }
    catch { throw createError({ statusCode: 400, statusMessage: 'Invalid request path' }); }
    const recovery = (event.method === 'POST' && path === '/api/storage/presign-download') ||
        (event.method === 'GET' && path === '/api/workspaces/backup');
    if (!recovery && !requiresHostedAccess(event.method, path)) return;
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user?.id) throw createError({ statusCode: 401, statusMessage: 'Sign in to use hosted services' });
    if (recovery) {
        // Keep explicit recovery available to the canonical owner. A membership
        // in someone else's workspace only includes hosted reads while it is paid.
        const workspaceId = session.workspace?.id;
        if (workspaceId && useAccountQuota().workspaceOwner(workspaceId) !== session.user.id) {
            await requireCloudAccess(event, session);
        }
        return;
    }
    if (path.startsWith('/api/sync/') || path === '/api/storage/presign-upload' ||
        path === '/api/storage/delete' || path === '/api/storage/chat-attachment-capability') {
        await requireCloudAccess(event, session);
        return;
    }
    ensureTrial(event, session, useBillingService().store);
    if (!useBillingService().store.status(session.user.id).allowed) {
        throw createError({ statusCode: 402, statusMessage: 'Cloud plan required', data: { code: 'cloud_plan_required', billingUrl: '/billing' } });
    }
    // This is an additional admission gate. Route-specific can(), origin checks,
    // validation and provider authorization still run normally.
});
