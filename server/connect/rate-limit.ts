import type { RateLimitProvider } from '../utils/rate-limit/types';
import { getRateLimitProvider } from '../utils/rate-limit/store';
import { getRateLimitProviderById } from '../utils/rate-limit/registry';
import type { ConnectServerConfig } from './config';

/** Prefer the Connect persistence provider's distributed request budget. */
export function getConnectRateLimitProvider(
    config: Pick<ConnectServerConfig, 'provider'>
): RateLimitProvider {
    return (
        (config.provider
            ? getRateLimitProviderById(config.provider)
            : null) ?? getRateLimitProvider()
    );
}
