import { isIP } from 'node:net';
import type { H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import type { SessionContext } from '~/core/hooks/hook-types';
import { getClientIp, normalizeProxyTrustConfig } from '~~/server/utils/net/request-identity';
import type { BillingStore } from './store';

/** Normalize mapped IPv4 and group IPv6 temporary addresses by their /64. */
export function trialNetwork(input: string | null): string | null {
    if (!input || isIP(input) === 0) return null;
    if (isIP(input) === 4) return input;
    const canonical = new URL(`http://[${input}]/`).hostname.slice(1, -1);
    const [left = '', right = ''] = canonical.split('::');
    const leading = left ? left.split(':') : [];
    const trailing = right ? right.split(':') : [];
    const groups = canonical.includes('::')
        ? [...leading, ...Array<string>(8 - leading.length - trailing.length).fill('0'), ...trailing]
        : leading;
    if (groups.length !== 8) return null;
    const words = groups.map(group => Number.parseInt(group, 16));
    if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
        return `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`;
    }
    return `${words.slice(0, 4).map(word => word.toString(16)).join(':')}::/64`;
}

export function ensureTrial(event: H3Event, session: SessionContext, store: BillingStore): void {
    if (!session.authenticated || !session.user?.id) return;
    const email = session.user.email?.trim().toLowerCase() || null;
    const config = useRuntimeConfig(event);
    const ip = getClientIp(event, normalizeProxyTrustConfig(config.security.proxy));
    store.claimTrial(session.user.id, email, trialNetwork(ip));
}
