/**
 * @module server/admin/extensions/url-fetch.ts
 *
 * Purpose:
 * Fetches a ZIP archive from a remote URL with SSRF protection and size limits.
 * Used by the extension install endpoint to support URL-based installation
 * (e.g., GitHub archive links).
 *
 * Security:
 * - HTTPS-only (no HTTP, no other schemes).
 * - Blocks private/reserved IP ranges via proper CIDR matching (loopback, link-local, RFC1918, CGNAT, documentation).
 * - DNS rebinding protection: resolves hostname to IP and validates before fetch.
 * - Manual redirect loop with per-hop URL + DNS validation.
 * - Enforces a maximum response size to prevent DoS.
 * - Enforces a connection/response timeout.
 */
import { resolve as dnsResolve } from 'node:dns/promises';

/** Configuration for URL fetch operations. */
export interface UrlFetchOptions {
    /** Maximum allowed response body size in bytes. Default: 25MB. */
    maxBytes?: number;
    /** Request timeout in milliseconds. Default: 30_000. */
    timeoutMs?: number;
    /** Maximum number of redirects to follow. Default: 5. */
    maxRedirects?: number;
    /**
     * Optional DNS resolver for testing. Defaults to node:dns/promises resolve.
     * Returns an array of IPv4 address strings.
     */
    _dnsResolve?: (hostname: string) => Promise<string[]>;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;

// ── CIDR-based IP blocking ──────────────────────────────────────────

/**
 * Convert a dotted-quad IPv4 string to a 32-bit unsigned integer.
 */
function ipToNum(ip: string): number {
    const parts = ip.split('.').map(Number);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

/**
 * Blocked CIDR ranges. Each entry is { base, mask } where mask is a bitmask
 * derived from the CIDR prefix length.
 */
const BLOCKED_CIDRS: Array<{ base: number; mask: number }> = [
    // 0.0.0.0/8 — "this" network
    { base: ipToNum('0.0.0.0'), mask: 0xFF000000 },
    // 127.0.0.0/8 — loopback
    { base: ipToNum('127.0.0.0'), mask: 0xFF000000 },
    // 10.0.0.0/8 — RFC 1918 private
    { base: ipToNum('10.0.0.0'), mask: 0xFF000000 },
    // 172.16.0.0/12 — RFC 1918 private (172.16.0.0 – 172.31.255.255)
    { base: ipToNum('172.16.0.0'), mask: 0xFFF00000 },
    // 192.168.0.0/16 — RFC 1918 private
    { base: ipToNum('192.168.0.0'), mask: 0xFFFF0000 },
    // 169.254.0.0/16 — link-local
    { base: ipToNum('169.254.0.0'), mask: 0xFFFF0000 },
    // 100.64.0.0/10 — CGNAT (RFC 6598)
    { base: ipToNum('100.64.0.0'), mask: 0xFFC00000 },
    // 192.0.2.0/24 — documentation (TEST-NET-1)
    { base: ipToNum('192.0.2.0'), mask: 0xFFFFFF00 },
    // 198.51.100.0/24 — documentation (TEST-NET-2)
    { base: ipToNum('198.51.100.0'), mask: 0xFFFFFF00 },
    // 203.0.113.0/24 — documentation (TEST-NET-3)
    { base: ipToNum('203.0.113.0'), mask: 0xFFFFFF00 },
    // 255.255.255.255/32 — broadcast
    { base: ipToNum('255.255.255.255'), mask: 0xFFFFFFFF },
];

/**
 * Returns true if the given dotted-quad IPv4 address falls within any
 * blocked CIDR range (private, loopback, link-local, etc.).
 */
export function isPrivateIp(ip: string): boolean {
    const num = ipToNum(ip);
    return BLOCKED_CIDRS.some(({ base, mask }) => ((num & mask) >>> 0) === base);
}

// ── URL validation ──────────────────────────────────────────────────

/**
 * Validates that a URL is safe to fetch (HTTPS, public hostname, no credentials).
 * Throws on any violation. Does NOT resolve DNS — use validateResolvedIps for that.
 */
export function validateFetchUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Invalid URL');
    }

    if (parsed.protocol !== 'https:') {
        throw new Error('Only HTTPS URLs are allowed');
    }

    // Block credentials in URL
    if (parsed.username || parsed.password) {
        throw new Error('URLs with credentials are not allowed');
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    if (
        hostname === 'localhost' ||
        hostname === '[::1]' ||
        hostname === '0.0.0.0' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')
    ) {
        throw new Error('URLs pointing to local/internal hosts are not allowed');
    }

    // Block bare IPv4 addresses in private/reserved ranges (proper CIDR check)
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
        if (isPrivateIp(hostname)) {
            throw new Error('URLs pointing to private IP ranges are not allowed');
        }
    }

    // Block IPv6 addresses entirely (too many reserved ranges to safely validate)
    if (hostname.startsWith('[') || hostname.includes(':')) {
        throw new Error('IPv6 URLs are not supported');
    }

    return parsed;
}

// ── DNS rebinding protection ────────────────────────────────────────

/**
 * Resolves a hostname to IPv4 addresses and validates that none are
 * in blocked ranges. Prevents DNS rebinding attacks where a public
 * hostname resolves to a private IP.
 *
 * Skips resolution for bare IPv4 hostnames (already validated by validateFetchUrl).
 */
export async function validateResolvedIps(
    hostname: string,
    resolver?: (hostname: string) => Promise<string[]>
): Promise<void> {
    // If the hostname is already a bare IPv4, it was validated in validateFetchUrl
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
        return;
    }

    const resolve = resolver ?? ((h: string) => dnsResolve(h, 'A') as Promise<string[]>);

    let addresses: string[];
    try {
        addresses = await resolve(hostname);
    } catch {
        throw new Error(`DNS resolution failed for ${hostname}`);
    }

    if (addresses.length === 0) {
        throw new Error(`DNS resolution returned no records for ${hostname}`);
    }

    for (const ip of addresses) {
        if (isPrivateIp(ip)) {
            throw new Error(
                'URL resolved to a private/reserved IP address'
            );
        }
    }
}

// ── Redirect status codes ───────────────────────────────────────────

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ── Main fetch ──────────────────────────────────────────────────────

/**
 * Fetches a ZIP buffer from a remote HTTPS URL with safety checks.
 *
 * Security model:
 * 1. Validate URL string (scheme, credentials, hostname patterns).
 * 2. Resolve DNS and validate that IPs are public.
 * 3. Fetch with `redirect: 'manual'` and follow redirects ourselves,
 *    re-validating each hop.
 * 4. Stream body with a byte-count check.
 *
 * @param rawUrl - The URL to fetch the ZIP from.
 * @param options - Fetch configuration (size, timeout, redirects).
 * @returns The downloaded buffer.
 * @throws On SSRF violation, timeout, size exceeded, or HTTP error.
 */
export async function fetchZipFromUrl(
    rawUrl: string,
    options?: UrlFetchOptions
): Promise<Buffer> {
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const dnsResolver = options?._dnsResolve;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        let currentUrl = rawUrl;

        for (let hop = 0; hop <= maxRedirects; hop++) {
            // Validate URL string on every hop
            const parsed = validateFetchUrl(currentUrl);

            // Resolve DNS and validate IPs on every hop (prevents rebinding)
            await validateResolvedIps(parsed.hostname, dnsResolver);

            const response = await fetch(currentUrl, {
                signal: controller.signal,
                redirect: 'manual',
                headers: {
                    'Accept': 'application/zip, application/octet-stream, */*',
                    'User-Agent': 'OR3-Chat-Extension-Installer/1.0',
                },
            });

            // Handle redirects manually so we can validate each hop
            if (REDIRECT_STATUSES.has(response.status)) {
                const location = response.headers.get('location');
                if (!location) {
                    throw new Error('Redirect without Location header');
                }
                // Resolve relative redirects against current URL
                currentUrl = new URL(location, currentUrl).toString();
                continue;
            }

            if (!response.ok) {
                throw new Error(
                    `Remote server returned ${response.status}: ${response.statusText}`
                );
            }

            // Check Content-Length header early if available
            const contentLength = response.headers.get('content-length');
            if (contentLength) {
                const declaredSize = Number(contentLength);
                if (declaredSize > maxBytes) {
                    throw new Error(
                        `Remote file too large: ${declaredSize} bytes (max ${maxBytes})`
                    );
                }
            }

            // Stream the body with a size check
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            const chunks: Uint8Array[] = [];
            let totalSize = 0;

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                totalSize += value.byteLength;
                if (totalSize > maxBytes) {
                    reader.cancel().catch(() => {});
                    throw new Error(
                        `Remote file too large: exceeded ${maxBytes} byte limit`
                    );
                }
                chunks.push(value);
            }

            if (totalSize === 0) {
                throw new Error('Remote URL returned empty response');
            }

            // Combine chunks into a single buffer
            const combined = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.byteLength;
            }

            return Buffer.from(combined);
        }

        throw new Error(`Too many redirects (max ${maxRedirects})`);
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
