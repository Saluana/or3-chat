import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import {
    isBlockedWebhookAddress,
    normalizeWebhookAddress,
} from './ssrf-safe-agent';

export type WebhookUrlResolver = (hostname: string) => Promise<LookupAddress[]>;

export interface WebhookUrlValidationOptions {
    requireHttps?: boolean;
    blockPrivateIps?: boolean;
    resolver?: WebhookUrlResolver;
}

async function defaultResolver(hostname: string): Promise<LookupAddress[]> {
    return dnsLookup(hostname, {
        all: true,
        verbatim: true,
    }) as Promise<LookupAddress[]>;
}

export async function validateWebhookUrl(
    rawUrl: string,
    options: WebhookUrlValidationOptions = {}
): Promise<URL> {
    const { requireHttps = false, blockPrivateIps = false } = options;

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Invalid webhook URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Webhook URL must use http or https');
    }

    if (parsed.username || parsed.password) {
        throw new Error('Webhook URL cannot include credentials');
    }

    if (requireHttps && parsed.protocol !== 'https:') {
        throw new Error('Webhook URL must use HTTPS');
    }

    if (!blockPrivateIps) {
        return parsed;
    }

    const hostname = normalizeWebhookAddress(parsed.hostname);
    if (!hostname) {
        throw new Error('Invalid webhook URL');
    }

    if (hostname === 'localhost') {
        throw new Error('Webhook URL cannot target a private IP');
    }

    if (isIP(hostname) > 0) {
        if (isBlockedWebhookAddress(hostname)) {
            throw new Error('Webhook URL cannot target a private IP');
        }

        return parsed;
    }

    const resolver = options.resolver ?? defaultResolver;

    let addresses: LookupAddress[];
    try {
        addresses = await resolver(hostname);
    } catch {
        throw new Error(`Webhook URL DNS lookup failed for ${hostname}`);
    }

    if (addresses.length === 0) {
        throw new Error(`Webhook URL DNS lookup returned no addresses for ${hostname}`);
    }

    if (addresses.some((address) => isBlockedWebhookAddress(address.address))) {
        throw new Error('Webhook URL cannot target a private IP');
    }

    return parsed;
}
