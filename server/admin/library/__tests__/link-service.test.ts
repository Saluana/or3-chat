import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LibraryLinkService } from '../link-service';
import { createFileLibraryLinkStore, type LibraryLinkRecord } from '../link-store';
import type {
    LibraryLinkTransport,
    LinkedSessionPayload,
    PolledPairingPayload,
    StartedPairingPayload,
    TransportResult,
} from '../transport';

const KEY = 'library-link-secret-for-tests';
const INSTANCE = 'inst-1';
const USER = 'user-1';
const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const TOKEN = `lkl_${'t'.repeat(43)}`;
const TOKEN_2 = `lkl_${'u'.repeat(43)}`;

function started(overrides: Partial<StartedPairingPayload> = {}): StartedPairingPayload {
    return {
        pairingId: `prs_${'a'.repeat(32)}`,
        code: 'ABCD-EFGH',
        verificationUrl: 'https://marketplace.example.test/link?code=ABCD-EFGH',
        expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
        retryAfterMs: 5_000,
        secret: 'pss_polling_secret',
        ...overrides,
    };
}

function polled(overrides: Partial<PolledPairingPayload> = {}): PolledPairingPayload {
    return {
        status: 'pending',
        expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
        retryAfterMs: 5_000,
        ...overrides,
    };
}

function linkedSession(): LinkedSessionPayload {
    return {
        link: {
            id: `lnk_${'b'.repeat(32)}`,
            label: 'or3.example.test',
            origin: 'https://or3.example.test',
            status: 'active',
            scopes: ['library:read', 'downloads:acquire'],
            createdAt: new Date(NOW).toISOString(),
            expiresAt: new Date(NOW + 90 * 24 * 60 * 60_000).toISOString(),
            revokedAt: null,
        },
        user: { id: 'central-user', displayName: 'Example Publisher' },
        scopes: ['library:read', 'downloads:acquire'],
    };
}

interface Harness {
    readonly directory: string;
    readonly service: LibraryLinkService;
    readonly calls: {
        start: { label: string; origin: string }[];
        poll: { pairingId: string; secret: string }[];
        verify: string[];
        revoke: string[];
    };
    startResult: TransportResult<StartedPairingPayload>;
    pollResults: TransportResult<PolledPairingPayload>[];
    verifyResults: TransportResult<LinkedSessionPayload>[];
    revokeResults: TransportResult<{ revoked: true }>[];
    advance(ms: number): void;
    record(userId?: string): LibraryLinkRecord;
}

function harness(overrides: { configured?: boolean; encryptionKey?: string; userId?: string } = {}): Harness {
    const directory = mkdtempSync(join(tmpdir(), 'or3-library-link-service-'));
    const calls: Harness['calls'] = { start: [], poll: [], verify: [], revoke: [] };
    const state = {
        startResult: { ok: true, value: started() } as TransportResult<StartedPairingPayload>,
        pollResults: [] as TransportResult<PolledPairingPayload>[],
        verifyResults: [] as TransportResult<LinkedSessionPayload>[],
        revokeResults: [] as TransportResult<{ revoked: true }>[],
    };
    let now = NOW;

    const transport: LibraryLinkTransport = {
        async start(input) {
            calls.start.push(input);
            return state.startResult;
        },
        async poll(pairingId, secret) {
            calls.poll.push({ pairingId, secret });
            const result = state.pollResults.shift();
            if (!result) throw new Error('unexpected poll');
            return result;
        },
        async verify(token) {
            calls.verify.push(token);
            const result = state.verifyResults.shift();
            if (!result) throw new Error('unexpected verify');
            return result;
        },
        async revoke(token) {
            calls.revoke.push(token);
            const result = state.revokeResults.shift();
            if (!result) throw new Error('unexpected revoke');
            return result;
        },
    };

    const store = createFileLibraryLinkStore({ directory });
    const service = new LibraryLinkService({
        store,
        transport,
        encryptionKey: overrides.encryptionKey ?? KEY,
        instanceId: INSTANCE,
        configured: overrides.configured ?? true,
        now: () => now,
    });

    return {
        directory,
        service,
        calls,
        get startResult() {
            return state.startResult;
        },
        set startResult(value) {
            state.startResult = value;
        },
        get pollResults() {
            return state.pollResults;
        },
        set pollResults(value) {
            state.pollResults = value;
        },
        get verifyResults() {
            return state.verifyResults;
        },
        set verifyResults(value) {
            state.verifyResults = value;
        },
        get revokeResults() {
            return state.revokeResults;
        },
        set revokeResults(value) {
            state.revokeResults = value;
        },
        advance(ms: number) {
            now += ms;
        },
        record(userId = overrides.userId ?? USER): LibraryLinkRecord {
            return JSON.parse(
                readFileSync(join(directory, `${userId}.json`), 'utf8')
            ) as LibraryLinkRecord;
        },
    };
}

async function toPending(h: Harness): Promise<void> {
    const result = await h.service.start(USER, {
        label: 'or3.example.test',
        origin: 'https://or3.example.test',
    });
    expect(result.ok).toBe(true);
}

async function toLinked(h: Harness): Promise<void> {
    await toPending(h);
    h.pollResults = [
        {
            ok: true,
            value: polled({ status: 'consumed', token: TOKEN, link: linkedSession().link }),
        },
    ];
    h.advance(5_000);
    const status = await h.service.status(USER);
    expect(status.state).toBe('linked');
}

describe('library link service', () => {
    beforeEach(() => {
        // Each test builds its own harness.
    });

    it('reports an unlinked user without touching the marketplace', async () => {
        const h = harness();
        const status = await h.service.status(USER);
        expect(status).toEqual({ configured: true, state: 'unlinked' });
        expect(h.calls.start).toHaveLength(0);
        expect(h.calls.poll).toHaveLength(0);
    });

    it('reports itself unconfigured instead of storing anything', async () => {
        const h = harness({ configured: false, encryptionKey: undefined });
        const status = await h.service.status(USER);
        expect(status.configured).toBe(false);

        const started = await h.service.start(USER, { label: 'host', origin: 'https://host.test' });
        expect(started.ok).toBe(false);
        if (!started.ok) expect(started.failure.code).toBe('pairing-unavailable');
        expect(h.calls.start).toHaveLength(0);
        expect(readdirSync(h.directory)).toHaveLength(0);
    });

    it('stores the polling secret encrypted and never in the browser view', async () => {
        const h = harness();
        await toPending(h);

        const file = readFileSync(join(h.directory, `${USER}.json`), 'utf8');
        expect(file).not.toContain('pss_polling_secret');
        expect(file).not.toContain(TOKEN);
        const record = h.record();
        expect(record.state).toBe('pending');
        expect(record.pollingSecretCiphertext?.startsWith('llv1.')).toBe(true);
        expect(record.instanceId).toBe(INSTANCE);
        expect(record.userId).toBe(USER);
        expect(h.calls.start[0]).toEqual({ label: 'or3.example.test', origin: 'https://or3.example.test' });
    });

    it('polls only when the marketplace interval says so', async () => {
        const h = harness();
        await toPending(h);

        const early = await h.service.status(USER);
        expect(h.calls.poll).toHaveLength(0);
        expect(early.pairing?.retryAfterMs).toBe(5_000);

        h.pollResults = [{ ok: true, value: polled() }];
        h.advance(5_000);
        const due = await h.service.status(USER);
        expect(h.calls.poll).toHaveLength(1);
        expect(h.calls.poll[0]?.secret).toBe('pss_polling_secret');
        expect(due.state).toBe('pending');
        expect(due.pairing?.retryAfterMs).toBe(5_000);
    });

    it('becomes linked once, storing the token encrypted and dropping the pairing', async () => {
        const h = harness();
        await toLinked(h);

        const record = h.record();
        expect(record.state).toBe('linked');
        expect(record.tokenCiphertext?.startsWith('llv1.')).toBe(true);
        expect(record.pollingSecretCiphertext).toBeUndefined();
        expect(record.comparisonCode).toBeUndefined();
        expect(readFileSync(join(h.directory, `${USER}.json`), 'utf8')).not.toContain(TOKEN);

        const status = await h.service.status(USER);
        expect(status.link?.label).toBe('or3.example.test');
        expect(status.link?.scopes).toEqual(['library:read', 'downloads:acquire']);
        expect(JSON.stringify(status)).not.toContain(TOKEN);
    });

    it('treats a lost one-time response as unrecoverable and stops polling', async () => {
        const h = harness();
        await toPending(h);
        h.pollResults = [{ ok: true, value: polled({ status: 'consumed' }) }];
        h.advance(5_000);
        const status = await h.service.status(USER);
        expect(status.state).toBe('lost');
        expect(status.reason).toBe('lost-response');

        h.advance(60_000);
        h.pollResults = [];
        await h.service.status(USER);
        expect(h.calls.poll).toHaveLength(1);
    });

    it('reports denial, replacement and expiry as terminal states', async () => {
        const denied = harness();
        await toPending(denied);
        denied.pollResults = [{ ok: true, value: polled({ status: 'denied' }) }];
        denied.advance(5_000);
        expect((await denied.service.status(USER)).state).toBe('denied');

        const replaced = harness();
        await toPending(replaced);
        replaced.pollResults = [
            { ok: false, failure: { code: 'pairing-not-found', message: 'gone', retryable: false } },
        ];
        replaced.advance(5_000);
        const replacedStatus = await replaced.service.status(USER);
        expect(replacedStatus.state).toBe('expired');
        expect(replacedStatus.reason).toBe('pairing-replaced');

        const stale = harness();
        await toPending(stale);
        stale.advance(11 * 60_000);
        expect((await stale.service.status(USER)).state).toBe('expired');
        expect(stale.calls.poll).toHaveLength(0);
    });

    it('keeps waiting through a marketplace outage and retries later', async () => {
        const h = harness();
        await toPending(h);
        h.pollResults = [
            { ok: false, failure: { code: 'central-unreachable', message: 'down', retryable: true } },
        ];
        h.advance(5_000);
        const status = await h.service.status(USER);
        expect(status.state).toBe('pending');
        expect(status.notice?.code).toBe('central-unreachable');

        h.pollResults = [{ ok: true, value: polled({ status: 'denied' }) }];
        h.advance(60_000);
        expect((await h.service.status(USER)).state).toBe('denied');
    });

    it('re-verifies a linked session only after the interval and refreshes metadata', async () => {
        const h = harness();
        await toLinked(h);
        h.advance(60_000);
        await h.service.status(USER);
        expect(h.calls.verify).toHaveLength(0);

        h.verifyResults = [{ ok: true, value: linkedSession() }];
        h.advance(10 * 60_000);
        const status = await h.service.status(USER);
        expect(h.calls.verify).toHaveLength(1);
        expect(h.calls.verify[0]).toBe(TOKEN);
        expect(status.link?.account).toBe('Example Publisher');
        expect(Date.parse(h.record().lastVerifiedAt!)).toBe(NOW + 11 * 60_000 + 5_000);
    });

    it('a marketplace revocation ends private authority and drops the credential', async () => {
        const h = harness();
        await toLinked(h);
        h.verifyResults = [
            { ok: false, failure: { code: 'link-revoked', message: 'revoked', retryable: false } },
        ];
        h.advance(10 * 60_000);
        const status = await h.service.status(USER);
        expect(status.state).toBe('revoked');
        expect(status.reason).toBe('marketplace-revocation');
        expect(h.record().tokenCiphertext).toBeUndefined();

        // Already terminal: no further marketplace calls are made.
        h.advance(10 * 60_000);
        await h.service.status(USER);
        expect(h.calls.verify).toHaveLength(1);
    });

    it('an outage during verification never ends a working link', async () => {
        const h = harness();
        await toLinked(h);
        h.verifyResults = [
            { ok: false, failure: { code: 'central-unreachable', message: 'down', retryable: true } },
        ];
        h.advance(10 * 60_000);
        const status = await h.service.status(USER);
        expect(status.state).toBe('linked');
        expect(status.notice?.code).toBe('central-unreachable');
        expect(h.record().tokenCiphertext).toBeDefined();
    });

    it('expires a linked session locally at its fixed lifetime', async () => {
        const h = harness();
        await toLinked(h);
        h.advance(90 * 24 * 60 * 60_000 + 1);
        const status = await h.service.status(USER);
        expect(status.state).toBe('expired');
        expect(status.reason).toBe('link-expired');
        expect(h.record().tokenCiphertext).toBeUndefined();
        expect(h.calls.verify).toHaveLength(0);
    });

    it('disconnecting stops locally first and retries central revocation', async () => {
        const h = harness();
        await toLinked(h);
        h.revokeResults = [
            { ok: false, failure: { code: 'central-unreachable', message: 'down', retryable: true } },
        ];
        const disconnected = await h.service.disconnect(USER);
        expect(disconnected.ok).toBe(true);
        expect(h.calls.revoke).toEqual([TOKEN]);
        expect(h.record().state).toBe('revoked');
        expect(h.record().centralRevokePending).toBe(true);
        expect(h.record().tokenCiphertext).toBeDefined();

        h.revokeResults = [{ ok: true, value: { revoked: true } }];
        const settled = await h.service.status(USER);
        expect(settled.state).toBe('revoked');
        expect(settled.centralRevokePending).toBeUndefined();
        expect(h.record().centralRevokePending).toBe(false);
        expect(h.record().tokenCiphertext).toBeUndefined();

        // Idempotent: nothing left to revoke.
        h.revokeResults = [];
        await h.service.disconnect(USER);
        expect(h.calls.revoke).toHaveLength(2);
    });

    it('cancels a pending attempt locally without any marketplace call', async () => {
        const h = harness();
        await toPending(h);
        const canceled = await h.service.disconnect(USER);
        expect(canceled.ok).toBe(true);
        if (canceled.ok) {
            expect(canceled.value.state).toBe('expired');
            expect(canceled.value.reason).toBe('canceled');
        }
        expect(h.calls.poll).toHaveLength(0);
        expect(h.calls.revoke).toHaveLength(0);
        expect(h.record().pollingSecretCiphertext).toBeUndefined();
    });

    it('reconnect rotates the credential and revokes the replaced one immediately', async () => {
        const h = harness();
        await toLinked(h);

        h.startResult = { ok: true, value: started({ pairingId: `prs_${'c'.repeat(32)}`, code: 'ZZZZ-9999' }) };
        h.revokeResults = [{ ok: true, value: { revoked: true } }];
        const restarted = await h.service.start(USER, {
            label: 'or3.example.test',
            origin: 'https://or3.example.test',
        });

        expect(restarted.ok).toBe(true);
        expect(h.calls.revoke).toEqual([TOKEN]);
        const record = h.record();
        expect(record.state).toBe('pending');
        expect(record.previousTokenCiphertext).toBeUndefined();
        expect(record.tokenCiphertext).toBeUndefined();

        h.pollResults = [
            { ok: true, value: polled({ status: 'consumed', token: TOKEN_2, link: linkedSession().link }) },
        ];
        h.advance(5_000);
        expect((await h.service.status(USER)).state).toBe('linked');
        expect(h.calls.verify).toHaveLength(0);
    });

    it('a failed rotation revocation is retried instead of forgotten', async () => {
        const h = harness();
        await toLinked(h);
        h.startResult = { ok: true, value: started() };
        h.revokeResults = [
            { ok: false, failure: { code: 'central-unreachable', message: 'down', retryable: true } },
        ];
        await h.service.start(USER, { label: 'or3.example.test', origin: 'https://or3.example.test' });
        expect(h.record().previousTokenCiphertext).toBeDefined();

        h.revokeResults = [{ ok: true, value: { revoked: true } }];
        await h.service.status(USER);
        expect(h.record().previousTokenCiphertext).toBeUndefined();
    });

    it('requires reconnect when the encryption key no longer decrypts the binding', async () => {
        const h = harness();
        await toLinked(h);
        const rotated = new LibraryLinkService({
            store: createFileLibraryLinkStore({ directory: h.directory }),
            transport: {
                start: async () => ({ ok: false, failure: { code: 'central-unreachable', message: '', retryable: true } }),
                poll: async () => ({ ok: false, failure: { code: 'central-unreachable', message: '', retryable: true } }),
                verify: async () => ({ ok: false, failure: { code: 'central-unreachable', message: '', retryable: true } }),
                revoke: async () => ({ ok: false, failure: { code: 'central-unreachable', message: '', retryable: true } }),
            },
            encryptionKey: 'a-completely-different-key',
            instanceId: INSTANCE,
            now: () => NOW + 11 * 60_000,
        });
        const status = await rotated.status(USER);
        expect(status.state).toBe('lost');
        expect(status.reason).toBe('binding-undecryptable');
    });

    it('never destroys a binding just because configuration is missing', async () => {
        const h = harness();
        await toLinked(h);

        const unconfigured = new LibraryLinkService({
            store: createFileLibraryLinkStore({ directory: h.directory }),
            transport: {
                start: async () => {
                    throw new Error('must not be called');
                },
                poll: async () => {
                    throw new Error('must not be called');
                },
                verify: async () => {
                    throw new Error('must not be called');
                },
                revoke: async () => {
                    throw new Error('must not be called');
                },
            },
            encryptionKey: undefined,
            instanceId: INSTANCE,
            configured: false,
            now: () => NOW + 60 * 60_000,
        });

        const status = await unconfigured.status(USER);
        expect(status.configured).toBe(false);
        expect(status.state).toBe('linked');
        expect(h.record().tokenCiphertext).toBeDefined();

        // Restoring the key restores the link without a reconnect.
        h.verifyResults = [{ ok: true, value: linkedSession() }];
        h.advance(60 * 60_000);
        expect((await h.service.status(USER)).state).toBe('linked');
    });

    it('never forgets a credential it cannot decrypt while revoking', async () => {
        const h = harness();
        await toLinked(h);
        const unconfigured = new LibraryLinkService({
            store: createFileLibraryLinkStore({ directory: h.directory }),
            transport: {
                start: async () => {
                    throw new Error('must not be called');
                },
                poll: async () => {
                    throw new Error('must not be called');
                },
                verify: async () => {
                    throw new Error('must not be called');
                },
                revoke: async () => {
                    throw new Error('must not be called');
                },
            },
            encryptionKey: undefined,
            instanceId: INSTANCE,
            configured: false,
            now: () => NOW,
        });

        const result = await unconfigured.disconnect(USER);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.state).toBe('revoked');
            expect(result.value.centralRevokePending).toBe(true);
        }
        const record = h.record();
        expect(record.centralRevokePending).toBe(true);
        expect(record.tokenCiphertext).toBeDefined();
    });

    it('keeps each local user’s binding separate', async () => {
        const h = harness();
        await toPending(h);

        const other = await h.service.status('user-2');
        expect(other.state).toBe('unlinked');
        await h.service.disconnect('user-2');
        expect(h.record().state).toBe('pending');

        h.pollResults = [
            { ok: true, value: polled({ status: 'consumed', token: TOKEN, link: linkedSession().link }) },
        ];
        h.advance(5_000);
        expect((await h.service.status(USER)).state).toBe('linked');
        const files = readdirSync(h.directory).sort();
        expect(files).toEqual([`${USER}.json`]);
    });
});
