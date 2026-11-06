import { defineEventHandler } from 'h3';
import { billingUser, billingOperation } from './helpers';
import { useBillingService } from '../runtime';

export default defineEventHandler(async event => {
    const userId = await billingUser(event, true);
    return billingOperation(event, async () => ({ url: await useBillingService().checkout(userId) }));
});
