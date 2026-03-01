import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { isPrivateIp } from '../../admin/extensions/url-fetch';

type LookupResponseFamily = number | undefined;
type RequestedLookupFamily = LookupOptions['family'];
type NodeLookup = (
    hostname: string,
    options: LookupOptions & { all?: boolean; verbatim?: boolean },
    callback: (
        error: NodeJS.ErrnoException | null,
        address: string | LookupAddress[],
        family?: LookupResponseFamily
    ) => void
) => void;
type LookupCallback = Parameters<LookupFunction>[2];

export interface SsrfSafeAgentOptions {
    blockPrivateIps?: boolean;
    lookup?: NodeLookup;
}

export function normalizeWebhookAddress(value: string): string {
    let normalized = value.trim().toLowerCase();

    if (normalized.startsWith('[') && normalized.endsWith(']')) {
        normalized = normalized.slice(1, -1);
    }

    const zoneIndex = normalized.indexOf('%');
    if (zoneIndex >= 0) {
        normalized = normalized.slice(0, zoneIndex);
    }

    return normalized;
}

export function isPrivateIpv6Address(value: string): boolean {
    const normalized = normalizeWebhookAddress(value);

    if (!normalized) return false;
    if (normalized === '::1' || normalized === '::') return true;

    const firstGroup = normalized.split(':', 1)[0] ?? '';
    if (firstGroup.startsWith('fc') || firstGroup.startsWith('fd')) {
        return true;
    }

    if (!firstGroup.startsWith('fe')) {
        return false;
    }

    const thirdNibble = firstGroup[2];
    return thirdNibble === '8'
        || thirdNibble === '9'
        || thirdNibble === 'a'
        || thirdNibble === 'b';
}

export function isBlockedWebhookAddress(value: string): boolean {
    const normalized = normalizeWebhookAddress(value);
    if (!normalized) return false;
    if (normalized === 'localhost') return true;

    const family = isIP(normalized);
    if (family === 4) {
        return isPrivateIp(normalized);
    }

    if (family === 6) {
        return isPrivateIpv6Address(normalized);
    }

    return false;
}

function failLookup(
    options: LookupOptions,
    callback: LookupCallback,
    error: NodeJS.ErrnoException
): void {
    if (options.all) {
        callback(error, []);
        return;
    }

    callback(error, '', 0);
}

function selectAddress(
    addresses: LookupAddress[],
    family?: RequestedLookupFamily
): LookupAddress | undefined {
    const normalizedFamily =
        family === 'IPv4' ? 4 : family === 'IPv6' ? 6 : family;

    if (normalizedFamily === 4 || normalizedFamily === 6) {
        return addresses.find((address) => address.family === normalizedFamily);
    }

    return addresses[0];
}

export function createSsrfSafeLookup(
    options: SsrfSafeAgentOptions = {}
): LookupFunction {
    const { blockPrivateIps = false, lookup = dnsLookup as NodeLookup } = options;

    return (hostname, lookupOptions, callback) => {
        if (!blockPrivateIps) {
            lookup(hostname, lookupOptions, callback);
            return;
        }

        lookup(
            hostname,
            {
                ...lookupOptions,
                all: true,
                verbatim: true,
            },
            (
                error: NodeJS.ErrnoException | null,
                resolvedAddress: string | LookupAddress[],
                family?: LookupResponseFamily
            ) => {
                if (error) {
                    void resolvedAddress;
                    void family;
                    callback(error, '', 0);
                    return;
                }

                const addresses = Array.isArray(resolvedAddress)
                    ? resolvedAddress
                    : [
                          {
                              address: resolvedAddress,
                              family: family === 6 ? 6 : 4,
                          },
                      ];

                const blockedAddress = addresses.find((address) =>
                    isBlockedWebhookAddress(address.address)
                );

                if (blockedAddress) {
                    const privateIpError = new Error(
                        `Webhook target resolved to a private IP: ${blockedAddress.address}`
                    ) as NodeJS.ErrnoException;
                    privateIpError.code = 'EPRIVATEIP';
                    failLookup(lookupOptions, callback, privateIpError);
                    return;
                }

                if (lookupOptions.all) {
                    callback(null, addresses);
                    return;
                }

                const selectedAddress = selectAddress(
                    addresses,
                    lookupOptions.family
                );

                if (!selectedAddress) {
                    const noAddressError = new Error(
                        `No address found for ${hostname}`
                    ) as NodeJS.ErrnoException;
                    noAddressError.code = 'ENOTFOUND';
                    failLookup(lookupOptions, callback, noAddressError);
                    return;
                }

                callback(
                    null,
                    selectedAddress.address,
                    selectedAddress.family
                );
            }
        );
    };
}

export function createSsrfSafeAgent(
    options: SsrfSafeAgentOptions = {}
): Agent {
    return new Agent({
        connect: {
            lookup: createSsrfSafeLookup(options),
        },
    });
}
