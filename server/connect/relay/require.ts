import { createError } from 'h3';
import { getActiveConnectRelay } from './registry';
import type { ConnectRelay } from './types';

export function requireConnectRelay(): ConnectRelay {
    try {
        const relay = getActiveConnectRelay();
        if (relay) return relay;
    } catch {
        // Do not expose relay credentials or provider diagnostics publicly.
    }

    throw createError({
        statusCode: 503,
        statusMessage: 'Remote connections are temporarily unavailable.',
    });
}
