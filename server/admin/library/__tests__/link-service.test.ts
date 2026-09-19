import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibraryLinkService } from '../link-service';
import {
    createFileLibraryLinkStore,
    LibraryLinkStoreConflictError,
    type LibraryLinkRecord,
    type LibraryLinkStore,
    type LibraryLinkWriteOptions,
} from '../link-store';
import type {
    LibraryLinkTransport,
    LibraryTransportFailureCode,
    LinkedSessionPayload,
    PolledPairingPayload,
    RemoteAcquisition,
    RemoteLibraryEntitlements,
    StartedPairingPayload,
    TransportResult,
} from '../transport';
import type { PluginAcquisitionReceipt } from '~~/shared/plugins/acquisition/contracts';

const KEY = 'library-link-secret-for-tests';
const INSTANCE = 'or3dep_inst_test';
const USER = 'user-1';
const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const TOKEN = `lkl_${'t'.repeat(43)}`;
const TOKEN_2 = `lkl_${'u'.repeat(43)}`;

const RECEIPT: PluginAcquisitionReceipt = {
    payload: {
        schemaVersion: 1,
        receiptId: 'acq_test1234',
        marketplaceUserId: 'central-user',
        release: {
            releaseId: 'rel_paid',
            pluginId: 'com.fixture.paid-plugin',
            version: '1.0.0',
            archiveSha256: `sha256-${'a'.repeat(64)}`,
            packageTreeSha256: null,
            manifestSha256: null,
            authoritySha256: null,
        },
        coverage: { kind: 'plus', grantId: 'grant_test', until: '2027-01-01T00:00:00.000Z' },
        issuedAt: '2026-09-17T11:00:00.000Z',
    },
    algorithm: 'ed25519',
    keyId: 'receipt-test',
    signature: 'signature',
};

function failure(code: LibraryTransportFailureCode, retryable = false) {
    return { ok: false as const, failure: { code, message: code, retryable } };
}

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
        start: { label: string; origin: string; replace?: { pairingId: string; secret: string } }[];
        poll: { pairingId: string; secret: string }[];
        verify: string[];
        revoke: string[];
        entitlements: string[];
        acquire: { token: string; releaseId: string }[];
    };
    startResult: TransportResult<StartedPairingPayload>;
    pollResults: TransportResult<PolledPairingPayload>[];
    verifyResults: TransportResult<LinkedSessionPayload>[];
    revokeResults: TransportResult<{ revoked: true }>[];
    entitlementsResult: TransportResult<RemoteLibraryEntitlements>;
    acquireResults: TransportResult<RemoteAcquisition>[];
    advance(ms: number): void;
    holdPoll(): { release: () => void };
    record(userId?: string): LibraryLinkRecord;
    store: LibraryLinkStore;
}

function createHarness(overrides: { configured?: boolean; encryptionKey?: string } = {}): Harness {
    const directory = mkdtempSync(join(tmpdir(), 'or3-library-link-service-'));
    const calls: Harness['calls'] = {
        start: [],
        poll: [],
        verify: [],
        revoke: [],
        entitlements: [],
        acquire: [],
    };
    const state = {
        startResult: { ok: true, value: started() } as TransportResult<StartedPairingPayload>,
        pollResults: [] as TransportResult<PolledPairingPayload>[],
        verifyResults: [] as TransportResult<LinkedSessionPayload>[],
        revokeResults: [] as TransportResult<{ revoked: true }>[],
        acquireResults: [] as TransportResult<RemoteAcquisition>[],
        entitlementsResult: {
            ok: true,
            value: {
                plus: { status: 'none', until: null },
                pluginCoverage: [],
                acquired: [],
                acquiredCursor: null,
            },
        } as TransportResult<RemoteLibraryEntitlements>,
    };
    let now = NOW;
    let pollGate: Promise<void> | null = null;

    const transport: LibraryLinkTransport = {
        async start(input) {
            calls.start.push(input);
            return state.startResult;
        },
        async poll(pairingId, secret) {
            calls.poll.push({ pairingId, secret });
            if (pollGate) await pollGate;
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
        async entitlements(token) {
            calls.entitlements.push(token);
            return state.entitlementsResult;
        },
        async acquire(token, releaseId) {
            calls.acquire.push({ token, releaseId });
            const result = state.acquireResults.shift();
            if (!result) throw new Error('unexpected acquire');
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
        store,
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
        get entitlementsResult() {
            return state.entitlementsResult;
        },
        set entitlementsResult(value) {
            state.entitlementsResult = value;
        },
        get acquireResults() {
            return state.acquireResults;
        },
        set acquireResults(value) {
            state.acquireResults = value;
        },
        advance(ms: number) {
            now += ms;
        },
        holdPoll() {
            let release: () => void = () => undefined;
            pollGate = new Promise<void>((resolve) => {
                release = () => {
                    pollGate = null;
                    resolve();
                };
            });
            return { release: () => release() };
        },
        record(userId = USER): LibraryLinkRecord {
            return JSON.parse(readFileSync(join(directory, `${userId}.json`), 'utf8')) as LibraryLinkRecord;
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
            value: polled({ status: 'consumed', token: TOKEN, link: linkedSession().link, user: linkedSession().user }),
        },
    ];
    h.advance(5_000);
    const status = await h.service.status(USER);
    expect(status.state).toBe('linked');
}

describe('library link service', () => {
    it('reports an unlinked user without touching the marketplace', async () => {
        const h = createHarness();
        const status = await h.service.status(USER);
        expect(status).toEqual({ configured: true, state: 'unlinked' });
        expect(h.calls.start).toHaveLength(0);
        expect(h.calls.poll).toHaveLength(0);
    });

    it('acquires a covered release through this user link only', async () => {
        const h = createHarness();
        await toLinked(h);
        h.acquireResults = [
            {
                ok: true,
                value: {
                    releaseId: 'rel_paid',
                    artifactPath: '/api/v1/library/releases/rel_paid/artifact',
                    receipt: RECEIPT,
                    alreadyAcquired: true,
                },
            },
        ];

        const access = await h.service.artifactAccess(USER, 'rel_paid');
        expect(access.ok).toBe(true);
        if (!access.ok) return;
        expect(access.artifactPath).toBe('/api/v1/library/releases/rel_paid/artifact');
        expect(access.headers['x-or3-library-token']).toBe(TOKEN);
        expect(access.alreadyAcquired).toBe(true);
        expect(h.calls.acquire).toEqual([{ token: TOKEN, releaseId: 'rel_paid' }]);
    });

    it('refuses covered access when the user has no link', async () => {
        const h = createHarness();
        expect(await h.service.artifactAccess(USER, 'rel_paid')).toMatchObject({
            ok: false,
            code: 'link-required',
        });
        expect(h.calls.acquire).toEqual([]);
    });

    it('surfaces a marketplace refusal without pretending an acquisition exists', async () => {
        const h = createHarness();
        await toLinked(h);
        h.acquireResults = [failure('central-unreachable')];

        expect(await h.service.artifactAccess(USER, 'rel_paid')).toMatchObject({
            ok: false,
            code: 'library-unavailable',
        });
    });

    it('reports itself unconfigured instead of storing anything', async () => {
        const h = createHarness({ configured: false, encryptionKey: undefined });
        const status = await h.service.status(USER);
        expect(status.configured).toBe(false);

        const started = await h.service.start(USER, { label: 'host', origin: 'https://host.test' });
        expect(started.ok).toBe(false);
        if (!started.ok) expect(started.failure.code).toBe('pairing-unavailable');
        expect(h.calls.start).toHaveLength(0);
        expect(readdirSync(h.directory)).toHaveLength(0);
    });

    it('stores the polling secret encrypted and never in the browser view', async () => {
        const h = createHarness();
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

    it('proves possession of the previous attempt before replacing it', async () => {
        const h = createHarness();
        await toPending(h);

        await h.service.start(USER, {
            label: 'or3.example.test',
            origin: 'https://or3.example.test',
        });
        expect(h.calls.start[1]?.replace).toEqual({
            pairingId: `prs_${'a'.repeat(32)}`,
            secret: 'pss_polling_secret',
        });

        const fresh = createHarness();
        await fresh.service.start(USER, { label: 'host', origin: 'https://host.test' });
        expect(fresh.calls.start[0]).not.toHaveProperty('replace');
    });

    it('polls only when the marketplace interval says so', async () => {
        const h = createHarness();
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

    it('becomes linked once, storing the token encrypted and identifying the account', async () => {
        const h = createHarness();
        await toLinked(h);

        const record = h.record();
        expect(record.state).toBe('linked');
        expect(record.tokenCiphertext?.startsWith('llv1.')).toBe(true);
        expect(record.pollingSecretCiphertext).toBeUndefined();
        expect(record.comparisonCode).toBeUndefined();
        expect(record.accountId).toBe('central-user');
        expect(readFileSync(join(h.directory, `${USER}.json`), 'utf8')).not.toContain(TOKEN);

        const status = await h.service.status(USER);
        expect(status.link?.label).toBe('or3.example.test');
        expect(status.link?.account).toBe('Example Publisher');
        expect(status.link?.accountId).toBe('central-user');
        expect(status.link?.scopes).toEqual(['library:read', 'downloads:acquire']);
        expect(JSON.stringify(status)).not.toContain(TOKEN);
    });

    it('serializes concurrent status calls so the credential is consumed once', async () => {
        const h = createHarness();
        await toPending(h);
        h.pollResults = [
            {
                ok: true,
                value: polled({ status: 'consumed', token: TOKEN, link: linkedSession().link, user: linkedSession().user }),
            },
        ];
        h.advance(5_000);

        const [first, second] = await Promise.all([h.service.status(USER), h.service.status(USER)]);
        expect(h.calls.poll).toHaveLength(1);
        expect([first.state, second.state].every((state) => state === 'linked')).toBe(true);
        expect(h.record().state).toBe('linked');
    });

    it('never lets a slow poll overwrite a Disconnect that landed meanwhile', async () => {
        const h = createHarness();
        await toPending(h);
        h.pollResults = [
            {
                ok: true,
                value: polled({ status: 'consumed', token: TOKEN, link: linkedSession().link, user: linkedSession().user }),
            },
        ];
        h.advance(5_000);
        h.revokeResults = [{ ok: true, value: { revoked: true } }];

        const held = h.holdPoll();
        const polling = h.service.status(USER);
        // The Disconnect is requested while the poll is still in flight. It must
        // not read the stale (pending) binding and then be overwritten by the
        // poll's result; the credential the poll receives must be revoked.
        const disconnecting = h.service.disconnect(USER);
        await Promise.resolve();
        held.release();

        const [polledView, disconnected] = await Promise.all([polling, disconnecting]);
        expect(polledView.state).toBe('linked');
        expect(disconnected.ok).toBe(true);
        expect(h.record().state).toBe('revoked');
        expect(h.calls.revoke).toEqual([TOKEN]);
    });

    it('treats a lost one-time response as unrecoverable and stops polling', async () => {
        const h = createHarness();
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
        const denied = createHarness();
        await toPending(denied);
        denied.pollResults = [{ ok: true, value: polled({ status: 'denied' }) }];
        denied.advance(5_000);
        expect((await denied.service.status(USER)).state).toBe('denied');

        const replaced = createHarness();
        await toPending(replaced);
        replaced.pollResults = [failure('pairing-not-found')];
        replaced.advance(5_000);
        const replacedStatus = await replaced.service.status(USER);
        expect(replacedStatus.state).toBe('expired');
        expect(replacedStatus.reason).toBe('pairing-replaced');

        const stale = createHarness();
        await toPending(stale);
        stale.advance(11 * 60_000);
        expect((await stale.service.status(USER)).state).toBe('expired');
        expect(stale.calls.poll).toHaveLength(0);
    });

    it('keeps waiting through a marketplace outage and retries later', async () => {
        const h = createHarness();
        await toPending(h);
        h.pollResults = [failure('central-unreachable', true)];
        h.advance(5_000);
        const status = await h.service.status(USER);
        expect(status.state).toBe('pending');
        expect(status.notice?.code).toBe('central-unreachable');

        h.pollResults = [{ ok: true, value: polled({ status: 'denied' }) }];
        h.advance(60_000);
        expect((await h.service.status(USER)).state).toBe('denied');
    });

    it('re-verifies a linked session only after the interval and refreshes metadata', async () => {
        const h = createHarness();
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
        const h = createHarness();
        await toLinked(h);
        h.verifyResults = [failure('link-revoked')];
        h.advance(10 * 60_000);
        const status = await h.service.status(USER);
        expect(status.state).toBe('revoked');
        expect(status.reason).toBe('marketplace-revocation');
        expect(h.record().tokenCiphertext).toBeUndefined();
        expect(h.record().pendingRevocations).toBeUndefined();

        h.advance(10 * 60_000);
        await h.service.status(USER);
        expect(h.calls.verify).toHaveLength(1);
    });

    it('an outage during verification never ends a working link', async () => {
        const h = createHarness();
        await toLinked(h);
        h.verifyResults = [failure('central-unreachable', true)];
        h.advance(10 * 60_000);
        const status = await h.service.status(USER);
        expect(status.state).toBe('linked');
        expect(status.notice?.code).toBe('central-unreachable');
        expect(h.record().tokenCiphertext).toBeDefined();
    });

    it('expires a linked session locally at its fixed lifetime', async () => {
        const h = createHarness();
        await toLinked(h);
        h.advance(90 * 24 * 60 * 60_000 + 1);
        const status = await h.service.status(USER);
        expect(status.state).toBe('expired');
        expect(status.reason).toBe('link-expired');
        expect(h.record().tokenCiphertext).toBeUndefined();
        expect(h.calls.verify).toHaveLength(0);
    });

    it('disconnecting stops locally first and retries central revocation', async () => {
        const h = createHarness();
        await toLinked(h);
        h.revokeResults = [failure('central-unreachable', true)];
        const disconnected = await h.service.disconnect(USER);
        expect(disconnected.ok).toBe(true);
        expect(h.calls.revoke).toEqual([TOKEN]);
        expect(h.record().state).toBe('revoked');
        expect(h.record().centralRevokePending).toBe(true);
        expect(h.record().pendingRevocations).toHaveLength(1);
        if (disconnected.ok) expect(disconnected.value.centralRevokePending).toBe(true);

        h.revokeResults = [{ ok: true, value: { revoked: true } }];
        const settled = await h.service.status(USER);
        expect(settled.state).toBe('revoked');
        expect(settled.centralRevokePending).toBeUndefined();
        expect(h.record().centralRevokePending).toBe(false);
        expect(h.record().pendingRevocations).toBeUndefined();

        h.revokeResults = [];
        await h.service.disconnect(USER);
        expect(h.calls.revoke).toHaveLength(2);
    });

    it('settles a revocation only on confirmation or proof it is already invalid', async () => {
        const h = createHarness();
        await toLinked(h);
        h.revokeResults = [failure('central-rejected')];
        await h.service.disconnect(USER);
        // An unexpected rejection proves nothing: the credential is kept and the
        // obligation stays visible instead of being reported as done.
        expect(h.record().pendingRevocations).toHaveLength(1);
        expect(h.record().centralRevokePending).toBe(true);

        h.revokeResults = [failure('link-invalid')];
        const settled = await h.service.status(USER);
        expect(settled.centralRevokePending).toBeUndefined();
        expect(h.record().pendingRevocations).toBeUndefined();
    });

    it('cancels a pending attempt locally without any marketplace call', async () => {
        const h = createHarness();
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
        const h = createHarness();
        await toLinked(h);

        h.startResult = {
            ok: true,
            value: started({ pairingId: `prs_${'c'.repeat(32)}`, code: 'ZZZZ-9999' }),
        };
        h.revokeResults = [{ ok: true, value: { revoked: true } }];
        const restarted = await h.service.start(USER, {
            label: 'or3.example.test',
            origin: 'https://or3.example.test',
        });

        expect(restarted.ok).toBe(true);
        expect(h.calls.revoke).toEqual([TOKEN]);
        const record = h.record();
        expect(record.state).toBe('pending');
        expect(record.pendingRevocations).toBeUndefined();
        expect(record.tokenCiphertext).toBeUndefined();

        h.pollResults = [
            {
                ok: true,
                value: polled({ status: 'consumed', token: TOKEN_2, link: linkedSession().link, user: linkedSession().user }),
            },
        ];
        h.advance(5_000);
        expect((await h.service.status(USER)).state).toBe('linked');
    });

    it('repeated rotation never forgets a credential that still needs revocation', async () => {
        const h = createHarness();
        await toLinked(h);

        // Every revocation attempt fails retryably: one for the first rotation,
        // one for the retry that runs with the consume, and two more for the
        // second rotation.
        h.revokeResults = Array.from({ length: 5 }, () => failure('central-unreachable', true));

        // First rotation: the old credential's revocation fails retryably.
        await h.service.start(USER, { label: 'or3.example.test', origin: 'https://or3.example.test' });
        expect(h.record().pendingRevocations).toHaveLength(1);

        // Second rotation while the first obligation is still open: both the
        // replaced credential and the new one must be retained.
        h.pollResults = [
            {
                ok: true,
                value: polled({ status: 'consumed', token: TOKEN_2, link: linkedSession().link, user: linkedSession().user }),
            },
        ];
        h.advance(5_000);
        expect((await h.service.status(USER)).state).toBe('linked');
        h.startResult = { ok: true, value: started({ pairingId: `prs_${'d'.repeat(32)}`, code: 'YYYY-8888' }) };
        await h.service.start(USER, { label: 'or3.example.test', origin: 'https://or3.example.test' });

        const queue = h.record().pendingRevocations ?? [];
        expect(queue).toHaveLength(2);
        expect([...new Set(queue)]).toHaveLength(2);
    });

    it('preserves an undecryptable binding and can still revoke it after the key returns', async () => {
        const h = createHarness();
        await toLinked(h);

        const wrongKey = new LibraryLinkService({
            store: createFileLibraryLinkStore({ directory: h.directory }),
            transport: {
                start: async () => failure('central-unreachable', true),
                poll: async () => failure('central-unreachable', true),
                verify: async () => failure('central-unreachable', true),
                revoke: async () => failure('central-unreachable', true),
                entitlements: async () => failure('central-unreachable', true),
                acquire: async () => failure('central-unreachable', true),
            },
            encryptionKey: 'a-completely-different-key',
            instanceId: INSTANCE,
            now: () => NOW + 11 * 60_000,
        });
        const lost = await wrongKey.status(USER);
        expect(lost.state).toBe('lost');
        expect(lost.reason).toBe('binding-undecryptable');
        // The ciphertext is preserved (the file still contains it) even though
        // this key cannot read it, and the obligation stays visible.
        expect(h.record().pendingRevocations).toHaveLength(1);
        expect(readFileSync(join(h.directory, `${USER}.json`), 'utf8')).toContain('llv1.');

        h.advance(11 * 60_000);
        h.verifyResults = [{ ok: true, value: linkedSession() }];
        h.revokeResults = [{ ok: true, value: { revoked: true } }];
        const recovered = await h.service.status(USER);
        expect(h.calls.revoke).toEqual([TOKEN]);
        expect(h.record().pendingRevocations).toBeUndefined();
        expect(recovered).toBeTruthy();
    });

    it('reports the fresh binding when another writer advanced it', async () => {
        const h = createHarness();
        await toLinked(h);

        // A second writer (another replica) revokes the binding between this
        // service's read and its write. The stale operation must not overwrite
        // that decision.
        const racing: LibraryLinkStore = {
            read: (userId) => h.store.read(userId),
            async write(record: LibraryLinkRecord, options: LibraryLinkWriteOptions) {
                const current = (await h.store.read(record.userId)) as LibraryLinkRecord;
                if (current.state === 'linked') {
                    await h.store.write(
                        {
                            ...current,
                            state: 'revoked',
                            reason: 'disconnected',
                            tokenCiphertext: undefined,
                            pendingRevocations: undefined,
                            centralRevokePending: false,
                        },
                        { expectRevision: current.revision }
                    );
                }
                return await h.store.write(record, options);
            },
        };
        const service = new LibraryLinkService({
            store: racing,
            transport: {
                start: async () => failure('central-unreachable', true),
                poll: async () => failure('central-unreachable', true),
                verify: async () => failure('central-unreachable', true),
                revoke: async () => ({ ok: true, value: { revoked: true } }),
                entitlements: async () => failure('central-unreachable', true),
                acquire: async () => failure('central-unreachable', true),
            },
            encryptionKey: KEY,
            instanceId: INSTANCE,
            now: () => NOW,
        });

        const result = await service.disconnect(USER);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.state).toBe('revoked');
        expect(h.record().state).toBe('revoked');
    });

    it('never leaves an orphan credential when the link write loses a race', async () => {
        const h = createHarness();
        await toPending(h);
        h.pollResults = [
            {
                ok: true,
                value: polled({ status: 'consumed', token: TOKEN, link: linkedSession().link, user: linkedSession().user }),
            },
        ];
        h.advance(5_000);

        // The binding changes (another replica) between the poll and the write.
        // The token this poll received was never handed to anyone else, so it
        // must be revoked rather than dropped.
        const racing: LibraryLinkStore = {
            read: (userId) => h.store.read(userId),
            async write(record: LibraryLinkRecord, options: LibraryLinkWriteOptions) {
                const current = (await h.store.read(record.userId)) as LibraryLinkRecord;
                await h.store.write(
                    {
                        ...current,
                        state: 'revoked',
                        reason: 'disconnected',
                        updatedAt: new Date().toISOString(),
                    },
                    { expectRevision: current.revision }
                );
                return await h.store.write(record, options);
            },
        };
        h.revokeResults = [{ ok: true, value: { revoked: true } }];
        const service = new LibraryLinkService({
            store: racing,
            transport: {
                start: async () => failure('central-unreachable', true),
                poll: async (_pairingId, _secret) => ({
                    ok: true,
                    value: polled({
                        status: 'consumed',
                        token: TOKEN,
                        link: linkedSession().link,
                        user: linkedSession().user,
                    }),
                }),
                verify: async () => failure('central-unreachable', true),
                revoke: async (token) => {
                    h.calls.revoke.push(token);
                    const result = h.revokeResults.shift();
                    if (!result) throw new Error('unexpected revoke');
                    return result;
                },
                entitlements: async () => {
                    throw new Error('must not be called');
                },
                acquire: async () => { throw new Error('must not be called'); },
            },
            encryptionKey: KEY,
            instanceId: INSTANCE,
            now: () => NOW + 5_000,
        });

        const status = await service.status(USER);
        expect(h.calls.revoke).toEqual([TOKEN]);
        expect(status.state).toBe('revoked');
    });

    it('never destroys a binding just because configuration is missing', async () => {
        const h = createHarness();
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
                entitlements: async () => {
                    throw new Error('must not be called');
                },
                acquire: async () => { throw new Error('must not be called'); },
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

        h.verifyResults = [{ ok: true, value: linkedSession() }];
        h.advance(60 * 60_000);
        expect((await h.service.status(USER)).state).toBe('linked');
    });

    it('keeps each local user’s binding separate', async () => {
        const h = createHarness();
        await toPending(h);

        const other = await h.service.status('user-2');
        expect(other.state).toBe('unlinked');
        await h.service.disconnect('user-2');
        expect(h.record().state).toBe('pending');

        h.pollResults = [
            {
                ok: true,
                value: polled({ status: 'consumed', token: TOKEN, link: linkedSession().link, user: linkedSession().user }),
            },
        ];
        h.advance(5_000);
        expect((await h.service.status(USER)).state).toBe('linked');
        const files = readdirSync(h.directory).sort();
        expect(files).toEqual([`${USER}.json`]);
    });
});

describe('library entitlements view', () => {
    it('answers an unlinked user without a marketplace request', async () => {
        const h = createHarness();
        const view = await h.service.entitlements(USER);
        expect(view).toEqual({ configured: true, linked: false });
        expect(h.calls.entitlements).toHaveLength(0);
    });

    it('lists the linked account’s purchases with its identity', async () => {
        const h = createHarness();
        await toLinked(h);
        h.entitlementsResult = {
            ok: true,
            value: {
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
                        coverageKind: 'plus',
                        coverageUntil: '2027-01-01T00:00:00.000Z',
                        acquiredAt: '2026-09-17T12:00:00.000Z',
                    },
                ],
                acquiredCursor: null,
            },
        };

        const view = await h.service.entitlements(USER);
        expect(h.calls.entitlements).toEqual([TOKEN]);
        expect(view).toMatchObject({
            configured: true,
            linked: true,
            accountId: 'central-user',
            plus: { status: 'active', until: '2027-01-01T00:00:00.000Z' },
        });
        expect(view.acquired?.[0]?.releaseId).toBe('rel_fixture_100');
        expect(JSON.stringify(view)).not.toContain(TOKEN);
    });

    it('ends the link locally when central proves it is gone', async () => {
        const h = createHarness();
        await toLinked(h);
        h.entitlementsResult = failure('link-revoked');

        const view = await h.service.entitlements(USER);
        expect(view).toMatchObject({ configured: true, linked: false });
        expect(view.notice?.code).toBe('link-revoked');
        expect(h.record().state).toBe('revoked');
        expect(h.record().tokenCiphertext).toBeUndefined();
    });

    it('keeps a working link through an outage and reports the failure', async () => {
        const h = createHarness();
        await toLinked(h);
        h.entitlementsResult = failure('central-unreachable', true);

        const view = await h.service.entitlements(USER);
        expect(view).toMatchObject({ configured: true, linked: false });
        expect(view.notice?.retryable).toBe(true);
        expect(h.record().state).toBe('linked');
    });
});
