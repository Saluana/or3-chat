import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3';
import { useBillingService } from '../runtime';
import { billingOperation } from './helpers';

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const signature = getHeader(event, 'stripe-signature');
    if (!signature) throw createError({ statusCode: 400, statusMessage: 'Missing webhook signature' });
    const maxBytes = 1024 * 1024;
    const declared = Number(getHeader(event, 'content-length') || 0);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
        throw createError({ statusCode: 413, statusMessage: 'Webhook body too large' });
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of event.node.req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.byteLength;
        if (length > maxBytes) throw createError({ statusCode: 413, statusMessage: 'Webhook body too large' });
        chunks.push(bytes);
    }
    const service = useBillingService();
    let stripeEvent;
    try { stripeEvent = service.verifyWebhook(Buffer.concat(chunks), signature); }
    catch { throw createError({ statusCode: 400, statusMessage: 'Invalid webhook signature' }); }
    await billingOperation(event, () => service.webhook(stripeEvent));
    return { received: true };
});
