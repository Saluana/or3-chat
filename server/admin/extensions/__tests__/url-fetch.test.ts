/* @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    validateFetchUrl,
    isPrivateIp,
    validateResolvedIps,
    fetchZipFromUrl,
} from '../url-fetch';

// ── isPrivateIp (CIDR) ─────────────────────────────────────────────

describe('isPrivateIp', () => {
    it.each([
        ['127.0.0.1', true],
        ['127.255.255.255', true],
        ['10.0.0.1', true],
        ['10.255.255.255', true],
        ['192.168.0.1', true],
        ['192.168.255.255', true],
        ['172.16.0.1', true],
        ['172.17.0.1', true],
        ['172.20.5.3', true],
        ['172.31.255.254', true],
        ['169.254.169.254', true],
        ['100.64.0.1', true],
        ['0.0.0.1', true],
        ['0.1.2.3', true],
        ['192.0.2.1', true],
        ['198.51.100.1', true],
        ['203.0.113.1', true],
        ['255.255.255.255', true],
        // Public IPs
        ['8.8.8.8', false],
        ['1.1.1.1', false],
        ['172.32.0.1', false],
        ['172.15.255.255', false],
        ['100.63.255.255', false],
        ['192.0.3.1', false],
        ['203.0.114.1', false],
    ])('isPrivateIp(%s) → %s', (ip, expected) => {
        expect(isPrivateIp(ip)).toBe(expected);
    });
});

// ── validateFetchUrl ────────────────────────────────────────────────

describe('validateFetchUrl', () => {
    it('accepts valid HTTPS URLs', () => {
        const url = validateFetchUrl('https://github.com/user/repo/archive/main.zip');
        expect(url.hostname).toBe('github.com');
        expect(url.protocol).toBe('https:');
    });

    it('rejects HTTP URLs', () => {
        expect(() => validateFetchUrl('http://example.com/file.zip')).toThrow(
            'Only HTTPS URLs are allowed'
        );
    });

    it('rejects non-URL strings', () => {
        expect(() => validateFetchUrl('not a url')).toThrow('Invalid URL');
    });

    it('rejects empty strings', () => {
        expect(() => validateFetchUrl('')).toThrow('Invalid URL');
    });

    it('rejects FTP scheme', () => {
        expect(() => validateFetchUrl('ftp://example.com/file.zip')).toThrow(
            'Only HTTPS URLs are allowed'
        );
    });

    it('rejects file scheme', () => {
        expect(() => validateFetchUrl('file:///etc/passwd')).toThrow(
            'Only HTTPS URLs are allowed'
        );
    });

    it('rejects URLs with credentials', () => {
        expect(() => validateFetchUrl('https://user:pass@example.com/file.zip')).toThrow(
            'URLs with credentials are not allowed'
        );
    });

    it('rejects localhost', () => {
        expect(() => validateFetchUrl('https://localhost/file.zip')).toThrow(
            'URLs pointing to local/internal hosts are not allowed'
        );
    });

    it('rejects 0.0.0.0', () => {
        expect(() => validateFetchUrl('https://0.0.0.0/file.zip')).toThrow(
            'URLs pointing to local/internal hosts are not allowed'
        );
    });

    it('rejects .local hostnames', () => {
        expect(() => validateFetchUrl('https://myservice.local/file.zip')).toThrow(
            'URLs pointing to local/internal hosts are not allowed'
        );
    });

    it('rejects .internal hostnames', () => {
        expect(() => validateFetchUrl('https://service.internal/file.zip')).toThrow(
            'URLs pointing to local/internal hosts are not allowed'
        );
    });

    it('rejects IPv6 loopback', () => {
        expect(() => validateFetchUrl('https://[::1]/file.zip')).toThrow(
            'URLs pointing to local/internal hosts are not allowed'
        );
    });

    // CIDR-based IP blocking via validateFetchUrl
    it.each([
        '127.0.0.1',
        '10.0.0.5',
        '192.168.1.1',
        '172.16.0.1',
        '172.17.0.1',
        '172.31.255.254',
        '169.254.169.254',
        '100.64.0.1',
        '0.1.2.3',
    ])('rejects private IP %s', (ip) => {
        expect(() => validateFetchUrl(`https://${ip}/file.zip`)).toThrow(
            'private IP'
        );
    });

    it('accepts 172.32.0.1 (first public IP after 172.16/12)', () => {
        expect(validateFetchUrl('https://172.32.0.1/file.zip').hostname).toBe('172.32.0.1');
    });

    it('accepts public IP addresses', () => {
        const url = validateFetchUrl('https://8.8.8.8/file.zip');
        expect(url.hostname).toBe('8.8.8.8');
    });

    it('accepts known public hosts', () => {
        const url = validateFetchUrl('https://codeload.github.com/user/repo/zip/refs/heads/main');
        expect(url.hostname).toBe('codeload.github.com');
    });

    it('accepts gitlab URLs', () => {
        const url = validateFetchUrl('https://gitlab.com/user/repo/-/archive/main/repo-main.zip');
        expect(url.hostname).toBe('gitlab.com');
    });
});

// ── validateResolvedIps (DNS rebinding) ─────────────────────────────

describe('validateResolvedIps', () => {
    it('rejects hostname resolving to 127.0.0.1', async () => {
        const resolver = vi.fn().mockResolvedValue(['127.0.0.1']);
        await expect(
            validateResolvedIps('evil.com', resolver)
        ).rejects.toThrow('private/reserved IP');
    });

    it('rejects hostname resolving to AWS metadata endpoint', async () => {
        const resolver = vi.fn().mockResolvedValue(['169.254.169.254']);
        await expect(
            validateResolvedIps('evil.com', resolver)
        ).rejects.toThrow('private/reserved IP');
    });

    it('rejects hostname resolving to 172.17.0.1', async () => {
        const resolver = vi.fn().mockResolvedValue(['172.17.0.1']);
        await expect(
            validateResolvedIps('evil.com', resolver)
        ).rejects.toThrow('private/reserved IP');
    });

    it('accepts hostname resolving to public IP', async () => {
        const resolver = vi.fn().mockResolvedValue(['140.82.121.3']);
        await expect(
            validateResolvedIps('github.com', resolver)
        ).resolves.toBeUndefined();
    });

    it('rejects if any resolved IP is private', async () => {
        const resolver = vi.fn().mockResolvedValue(['8.8.8.8', '192.168.1.1']);
        await expect(
            validateResolvedIps('mixed.com', resolver)
        ).rejects.toThrow('private/reserved IP');
    });

    it('throws on DNS resolution failure', async () => {
        const resolver = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
        await expect(
            validateResolvedIps('nonexistent.example', resolver)
        ).rejects.toThrow('DNS resolution failed');
    });

    it('throws on empty DNS result', async () => {
        const resolver = vi.fn().mockResolvedValue([]);
        await expect(
            validateResolvedIps('empty.example', resolver)
        ).rejects.toThrow('no records');
    });

    it('skips resolution for bare IPv4 hostnames', async () => {
        const resolver = vi.fn();
        await validateResolvedIps('8.8.8.8', resolver);
        expect(resolver).not.toHaveBeenCalled();
    });
});

// ── fetchZipFromUrl (integration) ───────────────────────────────────

describe('fetchZipFromUrl', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    /** Create a vi.fn() mock that satisfies Bun's `typeof fetch` (includes `preconnect`). */
    function mockFetch(impl?: (...args: Parameters<typeof fetch>) => unknown) {
        const fn = impl ? vi.fn(impl) : vi.fn();
        // Bun's fetch type requires a `preconnect` method; stub it for tests.
        (fn as unknown as Record<string, unknown>).preconnect = vi.fn();
        globalThis.fetch = fn as unknown as typeof fetch;
        return fn;
    }

    function mockFetchResponse(body: Uint8Array, opts?: {
        status?: number;
        headers?: Record<string, string>;
    }) {
        const status = opts?.status ?? 200;
        const headers = new Headers(opts?.headers ?? {});

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(body);
                controller.close();
            },
        });

        return new Response(stream, {
            status,
            statusText: status === 200 ? 'OK' : 'Error',
            headers,
        });
    }

    // Common DNS resolver that always returns a public IP
    const publicDns = vi.fn().mockResolvedValue(['140.82.121.3']);

    it('returns a Buffer for a valid response', async () => {
        const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK header
        mockFetch().mockResolvedValue(mockFetchResponse(payload));

        const buf = await fetchZipFromUrl('https://example.com/ext.zip', {
            _dnsResolve: publicDns,
        });
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBe(4);
    });

    it('normalizes GitHub blob URLs to raw download requests', async () => {
        const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
        const fetchMock = mockFetch().mockResolvedValue(mockFetchResponse(payload));

        await fetchZipFromUrl(
            'https://github.com/Saluana/or3-theme-cyberpunk/blob/main/cyberpunk-theme.zip',
            { _dnsResolve: publicDns }
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const firstCall = fetchMock.mock.calls[0];
        const requestedUrl = String(firstCall?.[0]);
        expect(requestedUrl).toContain('github.com/Saluana/or3-theme-cyberpunk/blob/main/cyberpunk-theme.zip');
        expect(requestedUrl).toContain('raw=1');
    });

    it('rejects empty response body', async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.close();
            },
        });
        mockFetch().mockResolvedValue(
            new Response(stream, { status: 200 })
        );

        await expect(
            fetchZipFromUrl('https://example.com/empty.zip', {
                _dnsResolve: publicDns,
            })
        ).rejects.toThrow('empty response');
    });

    it('rejects non-zip payloads with a helpful message', async () => {
        const html = new TextEncoder().encode('<!doctype html><html><body>Not a zip</body></html>');
        mockFetch().mockResolvedValue(mockFetchResponse(html, {
            headers: { 'content-type': 'text/html' },
        }));

        await expect(
            fetchZipFromUrl('https://example.com/not-zip', {
                _dnsResolve: publicDns,
            })
        ).rejects.toThrow('did not return a ZIP archive');
    });

    it('rejects when Content-Length exceeds maxBytes', async () => {
        mockFetch().mockResolvedValue(
            mockFetchResponse(new Uint8Array(10), {
                headers: { 'content-length': '999999999' },
            })
        );

        await expect(
            fetchZipFromUrl('https://example.com/big.zip', {
                maxBytes: 100,
                _dnsResolve: publicDns,
            })
        ).rejects.toThrow('too large');
    });

    it('rejects when streamed body exceeds maxBytes', async () => {
        const bigBody = new Uint8Array(200);
        mockFetch().mockResolvedValue(mockFetchResponse(bigBody));

        await expect(
            fetchZipFromUrl('https://example.com/big.zip', {
                maxBytes: 100,
                _dnsResolve: publicDns,
            })
        ).rejects.toThrow('exceeded');
    });

    it('rejects on HTTP error status', async () => {
        mockFetch().mockResolvedValue(
            new Response(null, { status: 404, statusText: 'Not Found' })
        );

        await expect(
            fetchZipFromUrl('https://example.com/missing.zip', {
                _dnsResolve: publicDns,
            })
        ).rejects.toThrow('404');
    });

    it('throws on too many redirects', async () => {
        mockFetch().mockResolvedValue(
            new Response(null, {
                status: 302,
                headers: { location: 'https://example.com/loop.zip' },
            })
        );

        await expect(
            fetchZipFromUrl('https://example.com/loop.zip', {
                maxRedirects: 3,
                _dnsResolve: publicDns,
            })
        ).rejects.toThrow('Too many redirects');
    });

    it('rejects redirect to private IP literal', async () => {
        mockFetch().mockResolvedValue(
            new Response(null, {
                status: 302,
                headers: { location: 'https://192.168.1.1/internal.zip' },
            })
        );

        await expect(
            fetchZipFromUrl('https://example.com/redirect.zip', {
                _dnsResolve: publicDns,
            })
        ).rejects.toThrow('private IP');
    });

    it('rejects when redirect target DNS resolves to private IP', async () => {
        let callCount = 0;
        mockFetch(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve(new Response(null, {
                    status: 302,
                    headers: { location: 'https://evil-redirect.com/payload.zip' },
                }));
            }
            return Promise.resolve(mockFetchResponse(new Uint8Array([1, 2, 3, 4])));
        });

        const dnsResolver = vi.fn()
            .mockResolvedValueOnce(['140.82.121.3']) // example.com — public
            .mockResolvedValueOnce(['10.0.0.5']); // evil-redirect.com — private

        await expect(
            fetchZipFromUrl('https://example.com/redirect.zip', {
                _dnsResolve: dnsResolver,
            })
        ).rejects.toThrow('private/reserved IP');
    });

    it('follows redirects successfully', async () => {
        let callCount = 0;
        const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

        mockFetch(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve(new Response(null, {
                    status: 302,
                    headers: { location: 'https://cdn.example.com/ext.zip' },
                }));
            }
            return Promise.resolve(mockFetchResponse(payload));
        });

        const buf = await fetchZipFromUrl('https://example.com/ext.zip', {
            _dnsResolve: publicDns,
        });
        expect(buf.length).toBe(4);
        expect(callCount).toBe(2);
    });
});
