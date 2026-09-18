import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpLibraryLinkTransport } from '../transport';

const CONFIG = {
    registryOrigin: 'https://marketplace.example.test',
    requestTimeoutMs: 5_000,
};

const TOKEN = `lkl_${'t'.repeat(43)}`;

interface FetchCall {
    readonly url: string;
    readonly init: Record<string, unknown>;
}

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function calls(): FetchCall[] {
    return fetchMock.mock.calls.map(([url, init]) => ({
        url: String(url),
        init: (init ?? {}) as Record<string, unknown>,
    }));
}

function respond(status: number, body: unknown): void {
    fetchMock.mockResolvedValueOnce({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    });
}

/** Exactly the shape the deployed Worker returned in the phase-7 smoke run. */
function startedResponse(): Record<string, unknown> {
    return {
        pairing: {
            id: `prs_${'a'.repeat(32)}`,
            code: 'ZRAY-ASH2',
            status: 'pending',
            label: 'or3.smoke.test',
            origin: 'https://or3.smoke.test',
            scopes: ['library:read', 'downloads:acquire'],
            createdAt: '2026-09-18T01:15:32.186Z',
            expiresAt: '2026-09-18T01:25:32.186Z',
            verificationUrl: 'https://marketplace.example.test/link?code=ZRAY-ASH2',
        },
        secret: 'pss_HxYvEg9U72B08hf71wdiiEpOS6XBsGfajn24I52pkUk',
        retryAfterMs: 5_000,
    };
}

describe('library link transport', () => {
    beforeEach(() => {
        fetchMock.mockReset();
    });

    it('parses a real start response and never puts the secret in the URL', async () => {
        respond(200, startedResponse());
        const transport = createHttpLibraryLinkTransport(CONFIG);
        const result = await transport.start({ label: 'or3.smoke.test', origin: 'https://or3.smoke.test' });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.pairingId).toBe(`prs_${'a'.repeat(32)}`);
            expect(result.value.code).toBe('ZRAY-ASH2');
            expect(result.value.secret).toMatch(/^pss_/);
            expect(result.value.retryAfterMs).toBe(5_000);
        }

        const [call] = calls();
        expect(call?.url).toBe('https://marketplace.example.test/api/v1/connect/pairings');
        expect(call?.url).not.toContain('pss_');
        expect(call?.init.redirect).toBe('error');
        expect(call?.init.method).toBe('POST');
        expect(JSON.parse(String(call?.init.body))).toEqual({
            label: 'or3.smoke.test',
            origin: 'https://or3.smoke.test',
        });
    });

    it('rejects a start response whose secret or code is not the agreed shape', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);
        respond(200, { ...startedResponse(), secret: undefined });
        expect(await transport.start({ label: 'host', origin: 'https://host.test' })).toMatchObject({
            ok: false,
            failure: { code: 'invalid-response' },
        });

        respond(200, {
            ...startedResponse(),
            pairing: { ...(startedResponse().pairing as Record<string, unknown>), code: 'short' },
        });
        expect(await transport.start({ label: 'host', origin: 'https://host.test' })).toMatchObject({
            ok: false,
            failure: { code: 'invalid-response' },
        });
    });

    it('polls with the secret in a header and accepts only a valid token shape', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);
        respond(200, {
            pairing: {
                id: `prs_${'a'.repeat(32)}`,
                status: 'consumed',
                expiresAt: '2026-09-18T01:25:32.186Z',
                retryAfterMs: 0,
            },
            token: TOKEN,
            link: {
                id: `lnk_${'b'.repeat(32)}`,
                label: 'or3.smoke.test',
                origin: 'https://or3.smoke.test',
                status: 'active',
                scopes: ['library:read', 'downloads:acquire'],
                createdAt: '2026-09-18T01:15:32.186Z',
                expiresAt: '2026-12-17T01:15:32.186Z',
                revokedAt: null,
            },
        });

        const result = await transport.poll(`prs_${'a'.repeat(32)}`, 'pss_secret_value');
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.token).toBe(TOKEN);

        const [call] = calls();
        expect(call?.url).not.toContain('pss_secret_value');
        expect((call?.init.headers as Record<string, string>)['x-or3-pairing-secret']).toBe(
            'pss_secret_value'
        );

        respond(200, {
            pairing: {
                id: `prs_${'a'.repeat(32)}`,
                status: 'consumed',
                expiresAt: '2026-09-18T01:25:32.186Z',
                retryAfterMs: 0,
            },
            token: 'not-a-token',
        });
        expect(await transport.poll(`prs_${'a'.repeat(32)}`, 'pss_secret_value')).toMatchObject({
            ok: false,
            failure: { code: 'invalid-response' },
        });
    });

    it('verifies a linked session and confirms revocation', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);
        respond(200, {
            link: {
                id: `lnk_${'b'.repeat(32)}`,
                label: 'or3.smoke.test',
                origin: 'https://or3.smoke.test',
                status: 'active',
                scopes: ['library:read', 'downloads:acquire'],
                createdAt: '2026-09-18T01:15:32.186Z',
                expiresAt: '2026-12-17T01:15:32.186Z',
                revokedAt: null,
            },
            user: { id: 'usr_1', displayName: 'Example Publisher' },
            scopes: ['library:read', 'downloads:acquire'],
        });
        const verified = await transport.verify(TOKEN);
        expect(verified.ok).toBe(true);
        if (verified.ok) {
            expect(verified.value.user.displayName).toBe('Example Publisher');
            expect(verified.value.link.status).toBe('active');
        }

        respond(200, { revoked: true });
        expect(await transport.revoke(TOKEN)).toEqual({ ok: true, value: { revoked: true } });

        respond(200, { revoked: false });
        expect(await transport.revoke(TOKEN)).toMatchObject({
            ok: false,
            failure: { code: 'invalid-response' },
        });
    });

    it('maps marketplace failures to the small state machine the service acts on', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);
        const cases: [number, string, string, boolean][] = [
            [401, 'link-revoked', 'link-revoked', false],
            [401, 'link-expired', 'link-expired', false],
            [401, 'link-invalid', 'link-invalid', false],
            [403, 'account-restricted', 'account-restricted', false],
            [403, 'account-deleted', 'account-deleted', false],
            [404, 'pairing-not-found', 'pairing-not-found', false],
            [429, 'pairing-lookup-limited', 'rate-limited', true],
            [503, 'pairing-unavailable', 'pairing-unavailable', true],
            [500, 'internal-error', 'central-unreachable', true],
            [409, 'pairing-not-approvable', 'central-rejected', false],
        ];
        for (const [status, code, expected, retryable] of cases) {
            respond(status, { error: { code, message: 'nope', retryable } });
            const result = await transport.verify(TOKEN);
            expect(result).toMatchObject({ ok: false, failure: { code: expected, retryable } });
        }
    });

    it('treats a network failure, a redirect and an oversized body as bounded failures', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);

        fetchMock.mockRejectedValueOnce(new Error('socket closed'));
        expect(await transport.verify(TOKEN)).toMatchObject({
            ok: false,
            failure: { code: 'central-unreachable', retryable: true },
        });

        fetchMock.mockRejectedValueOnce(new TypeError('unexpected redirect'));
        expect(await transport.verify(TOKEN)).toMatchObject({
            ok: false,
            failure: { code: 'central-unreachable', retryable: true },
        });

        respond(200, 'x'.repeat(70 * 1024));
        expect(await transport.verify(TOKEN)).toMatchObject({
            ok: false,
            failure: { code: 'invalid-response' },
        });

        respond(200, 'not json');
        expect(await transport.verify(TOKEN)).toMatchObject({
            ok: false,
            failure: { code: 'invalid-response' },
        });
    });
});
