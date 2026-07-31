import { createError } from 'h3';
import { getActiveConnectStore } from './registry';
import type { ConnectStore } from './types';

export function requireConnectStore(): ConnectStore {
    const store = getActiveConnectStore();
    if (store) return store;

    throw createError({
        statusCode: 503,
        statusMessage:
            'Remote access is not available on this OR3 installation.',
    });
}
