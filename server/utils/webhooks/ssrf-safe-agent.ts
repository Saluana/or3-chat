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

function parseIpv4Octets(value: string): number[] | null {
    const parts = value.split('.');
    if (parts.length !== 4) {
        return null;
    }

    const octets = parts.map((segment) => {
        if (!/^\d{1,3}$/.test(segment)) {
            return Number.NaN;
        }
        return Number(segment);
    });

    return octets.every((segment) => Number.isInteger(segment) && segment >= 0 && segment <= 255)
        ? octets
        : null;
}

function parseIpv6Words(value: string): number[] | null {
    const normalized = normalizeWebhookAddress(value);
    if (!normalized) {
        return null;
    }

    let ipv6 = normalized;
    if (ipv6.includes('.')) {
        const lastColon = ipv6.lastIndexOf(':');
        if (lastColon < 0) {
            return null;
        }

        const octets = parseIpv4Octets(ipv6.slice(lastColon + 1));
        if (!octets) {
            return null;
        }

        ipv6 = `${ipv6.slice(0, lastColon)}:${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
    }

    const hasCompression = ipv6.includes('::');
    if (hasCompression && ipv6.indexOf('::') !== ipv6.lastIndexOf('::')) {
        return null;
    }

    const [headRaw, tailRaw = ''] = ipv6.split('::');
    const head = headRaw ? headRaw.split(':').filter(Boolean) : [];
    const tail = tailRaw ? tailRaw.split(':').filter(Boolean) : [];

    if (!hasCompression && head.length !== 8) {
        return null;
    }
    if (hasCompression && head.length + tail.length > 7) {
        return null;
    }

    const words: number[] = [];
    const pushWord = (segment: string) => {
        if (!/^[0-9a-f]{1,4}$/i.test(segment)) {
            return false;
        }

        const parsed = Number.parseInt(segment, 16);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) {
            return false;
        }

        words.push(parsed);
        return true;
    };

    for (const segment of head) {
        if (!pushWord(segment)) {
            return null;
        }
    }

    if (hasCompression) {
        const zeroFill = 8 - head.length - tail.length;
        for (let index = 0; index < zeroFill; index += 1) {
            words.push(0);
        }
    }

    for (const segment of tail) {
        if (!pushWord(segment)) {
            return null;
        }
    }

    return words.length === 8 ? words : null;
}

function wordsToIpv4(words: readonly number[]): string {
    return [
        (words[6]! >> 8) & 0xff,
        words[6]! & 0xff,
        (words[7]! >> 8) & 0xff,
        words[7]! & 0xff,
    ].join('.');
}

function extractEmbeddedIpv4(words: readonly number[]): string | null {
    const compatible = words.slice(0, 6).every((segment) => segment === 0);
    const mapped =
        compatible ||
        (words.slice(0, 5).every((segment) => segment === 0) && words[5] === 0xffff);

    return mapped ? wordsToIpv4(words) : null;
}

export function isPrivateIpv6Address(value: string): boolean {
    const words = parseIpv6Words(value);
    if (!words) return false;

    if (words.every((segment) => segment === 0)) {
        return true;
    }

    if (
        words.slice(0, 7).every((segment) => segment === 0) &&
        words[7] === 1
    ) {
        return true;
    }

    const embeddedIpv4 = extractEmbeddedIpv4(words);
    if (embeddedIpv4) {
        return isBlockedIpv4Address(embeddedIpv4);
    }

    const firstWord = words[0]!;
    if ((firstWord & 0xff00) === 0xff00) {
        return true;
    }

    if ((firstWord & 0xfe00) === 0xfc00) {
        return true;
    }

    if ((firstWord & 0xffc0) === 0xfe80 || (firstWord & 0xffc0) === 0xfec0) {
        return true;
    }

    // IPv6 special-use and documentation ranges are not routable webhook
    // destinations even though they are not all conventionally called private.
    if (
        (firstWord === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) ||
        (firstWord === 0x2001 &&
            (words[1] === 0x0000 ||
                words[1] === 0x0002 ||
                words[1] === 0x0010 ||
                words[1] === 0x0020 ||
                words[1] === 0x0db8))
    ) {
        return true;
    }

    return false;
}

function isBlockedIpv4Address(value: string): boolean {
    if (isPrivateIp(value)) return true;

    const parts = value.split('.');
    const first = Number(parts[0]);
    const second = Number(parts[1]);
    if (!Number.isInteger(first) || !Number.isInteger(second)) return true;

    // Multicast (224/4), future/reserved (240/4), protocol assignments
    // (192.0.0/24), and benchmarking (198.18/15) are not public targets.
    return (
        first >= 224 ||
        (first === 192 && second === 0) ||
        (first === 198 && (second === 18 || second === 19))
    );
}

export function isBlockedWebhookAddress(value: string): boolean {
    const normalized = normalizeWebhookAddress(value);
    if (!normalized) return false;
    if (normalized === 'localhost') return true;

    const family = isIP(normalized);
    if (family === 4) {
        return isBlockedIpv4Address(normalized);
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
    const { blockPrivateIps = true, lookup = dnsLookup as NodeLookup } = options;

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
                        'Webhook target resolved to a private or reserved address'
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
