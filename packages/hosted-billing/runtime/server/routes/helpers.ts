import { createError, setResponseHeader, type H3Event } from 'h3';
import { requireCan } from '~~/server/auth/can';
import { resolveSessionContext } from '~~/server/auth/session';
import { requireCloudMutation } from '~~/server/utils/security/cloud-mutation';
import { getRateLimitProvider } from '~~/server/utils/rate-limit/store';
import { enforceRateLimit } from '~~/server/utils/rate-limit/enforce';
import { BillingBusyError, BillingCommandError } from '../store';
import { ensureTrial } from '../trial';
import { useBillingService } from '../runtime';

export async function billingUser(event: H3Event, mutation = false): Promise<string> {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    if (mutation) requireCloudMutation(event);
    const session = await resolveSessionContext(event);
    requireCan(session, 'workspace.read');
    if (!session.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    ensureTrial(event, session, useBillingService().store);
    const limit = await getRateLimitProvider().checkAndRecord(`billing:${mutation ? 'write' : 'read'}:${session.user.id}`, {
        windowMs: 60_000, maxRequests: mutation ? 10 : 60,
    });
    enforceRateLimit(event, limit);
    return session.user.id;
}

export async function billingOperation<T>(event: H3Event, operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
        if (error instanceof BillingCommandError) throw createError({ statusCode: error.statusCode, statusMessage: error.message, data: { code: error.code } });
        // Stripe errors can contain request details. Never return or log raw provider errors.
        setResponseHeader(event, 'Retry-After', 5);
        throw createError({ statusCode: 503, statusMessage: error instanceof BillingBusyError
            ? 'Billing is updating. Try again shortly.' : 'Billing is temporarily unavailable. Please try again or contact support.' });
    }
}
