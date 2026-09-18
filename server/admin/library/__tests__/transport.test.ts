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

/** A real Response, so the transport reads real body streams. */
function respond(status: number, body: unknown): void {
    fetchMock.mockResolvedValueOnce(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
        })
    );
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

    it('passes a replacement proof through unchanged', async () => {
        respond(200, startedResponse());
        const transport = createHttpLibraryLinkTransport(CONFIG);
        await transport.start({
            label: 'or3.smoke.test',
            origin: 'https://or3.smoke.test',
            replace: { pairingId: `prs_${'b'.repeat(32)}`, secret: 'pss_previous' },
        });
        expect(JSON.parse(String(calls()[0]?.init.body))).toEqual({
            label: 'or3.smoke.test',
            origin: 'https://or3.smoke.test',
            replace: { pairingId: `prs_${'b'.repeat(32)}`, secret: 'pss_previous' },
        });
    });

    it('refuses a verification URL that is not this deployment’s own link page', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);
        const variants = [
            'https://evil.example.test/link?code=ZRAY-ASH2',
            'https://marketplace.example.test/sign-in?code=ZRAY-ASH2',
            'https://marketplace.example.test/link?code=OTHER-CODE',
            'http://marketplace.example.test/link?code=ZRAY-ASH2',
            'not-a-url',
        ];
        for (const verificationUrl of variants) {
            const body = startedResponse();
            (body.pairing as Record<string, unknown>).verificationUrl = verificationUrl;
            respond(200, body);
            expect(await transport.start({ label: 'host', origin: 'https://host.test' })).toMatchObject({
                ok: false,
                failure: { code: 'invalid-response' },
            });
        }
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

    it('polls with the secret in a header and requires link and account with a token', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);
        const consumed = {
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
            user: { id: 'usr_1' },
        };
        respond(200, consumed);
        const result = await transport.poll(`prs_${'a'.repeat(32)}`, 'pss_secret_value');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.token).toBe(TOKEN);
            expect(result.value.user?.id).toBe('usr_1');
        }

        const [call] = calls();
        expect(call?.url).not.toContain('pss_secret_value');
        expect((call?.init.headers as Record<string, string>)['x-or3-pairing-secret']).toBe(
            'pss_secret_value'
        );

        // A token without the link and account it belongs to is unusable.
        respond(200, { pairing: consumed.pairing, token: TOKEN });
        expect(await transport.poll(`prs_${'a'.repeat(32)}`, 'pss_secret_value')).toMatchObject({
            ok: false,
            failure: { code: 'invalid-response' },
        });

        respond(200, { ...consumed, token: 'not-a-token' });
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

    it('reads the Nitro error envelope so precise states survive', async () => {
        // Exactly how `server/utils/errors.ts:fail()` serializes.
        const envelope = (status: number, code: string) =>
            respond(status, {
                error: true,
                statusCode: status,
                statusMessage: code,
                message: 'nope',
                data: { error: { code, message: 'nope', retryable: false } },
            });
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
            envelope(status, code);
            expect(await transport.verify(TOKEN)).toMatchObject({
                ok: false,
                failure: { code: expected, retryable },
            });
        }

        // A body with only a status message still maps by status.
        respond(401, { statusMessage: 'link-revoked' });
        expect(await transport.verify(TOKEN)).toMatchObject({
            ok: false,
            failure: { code: 'link-revoked' },
        });
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

        // Error bodies are bounded too, not parsed as an unbounded JSON read.
        respond(500, 'x'.repeat(70 * 1024));
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

describe('library entitlements transport', () => {
    beforeEach(() => {
        fetchMock.mockReset();
    });

    const LISTING = {
        plus: { status: 'active', until: '2027-01-01T00:00:00.000Z' },
        pluginCoverage: [
            { pluginId: 'com.fixture.paid-plugin', until: '2027-01-01T00:00:00.000Z', status: 'valid' },
        ],
        acquired: [
            {
                releaseId: 'rel_fixture_100',
                pluginId: 'com.fixture.paid-plugin',
                version: '1.0.0',
                archiveSha256: `sha256-${'a'.repeat(64)}`,
                packageTreeSha256: null,
                manifestSha256: null,
                authoritySha256: null,
                publishedAt: '2026-09-17T00:00:00.000Z',
                acquiredAt: '2026-09-17T12:00:00.000Z',
                coverageKind: 'plus',
                coverageUntil: '2027-01-01T00:00:00.000Z',
            },
        ],
        acquiredCursor: null,
    };

    it('reads the listing with the token in a header and tolerates extra release fields', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);
        respond(200, LISTING);

        const result = await transport.entitlements(TOKEN);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.acquired[0]?.releaseId).toBe('rel_fixture_100');
        expect(calls()[0]?.url).toBe('https://marketplace.example.test/api/v1/library/entitlements');
        expect((calls()[0]?.init.headers as Record<string, string>)['x-or3-library-token']).toBe(TOKEN);
    });

    it('refuses a structurally wrong listing instead of showing an empty Library', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);
        respond(200, { ...LISTING, acquired: [{ releaseId: 'rel_only' }] });
        expect(await transport.entitlements(TOKEN)).toMatchObject({
            ok: false,
            failure: { code: 'invalid-response' },
        });

        respond(200, { ...LISTING, plus: { status: 'granted', until: null } });
        expect(await transport.entitlements(TOKEN)).toMatchObject({
            ok: false,
            failure: { code: 'invalid-response' },
        });
    });

    it('maps a revoked credential to the terminal link failure', async () => {
        const transport = createHttpLibraryLinkTransport(CONFIG);
        respond(401, { error: { code: 'link-revoked' } });
        expect(await transport.entitlements(TOKEN)).toMatchObject({
            ok: false,
            failure: { code: 'link-revoked', retryable: false },
        });
    });
});
