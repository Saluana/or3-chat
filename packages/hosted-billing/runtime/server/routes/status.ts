import { defineEventHandler } from 'h3';
import { billingUser } from './helpers';
import { useBillingService } from '../runtime';

export default defineEventHandler(async event => {
    const userId = await billingUser(event);
    return useBillingService().status(userId);
});
