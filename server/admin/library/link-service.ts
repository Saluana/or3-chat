/**
 * Library link lifecycle for one local user.
 *
 * The local server keeps the polling secret and the linked credential, polls on
 * the central schedule, and reconciles centrally-revoked/expired authority
 * before any private acquisition. A Disconnect always stops the local server
 * first and then confirms revocation centrally, retrying later if the
 * marketplace was unreachable. Installed plugins never consult this state, so a
 * link ending cannot disable already acquired execution (R15.AC6, R15.AC7,
 * LK07, LK08, LK09, LK12).
 *
 * Every operation for one user runs under a per-user lock and commits through a
 * compare-and-swap on the binding revision, so concurrent requests (two polls,
 * a poll and a Disconnect, two rotations) cannot interleave a stale decision
 * over a newer one.
 */
import {
    decryptLibrarySecret,
    encryptLibrarySecret,
    requireLibraryLinkKey,
} from './link-crypto';
import {
    LibraryLinkStoreConflictError,
    type LibraryLinkRecord,
    type LibraryLinkStore,
} from './link-store';
import type {
    LibraryLinkTransport,
    LibraryTransportFailure,
    LinkedSessionPayload,
    RemoteLinkSummary,
} from './transport';

/** A linked session is re-verified at most this often while the UI is used. */
const VERIFY_INTERVAL_MS = 10 * 60_000;
/** Do not hammer central after a failure; the schedule resumes after this. */
const FAILURE_RETRY_MS = 60_000;
/** Outstanding revocations are retried at most this many per status call. */
const REVOCATIONS_PER_RETRY = 2;

export interface LibraryLinkPairingView {
    readonly code: string;
    readonly verificationUrl: string;
    readonly expiresAt: string;
    readonly retryAfterMs: number;
}

export interface LibraryLinkedView {
    readonly id: string;
    readonly label: string;
    readonly origin: string;
    readonly scopes: readonly string[];
    readonly expiresAt: string;
    readonly account?: string;
    readonly accountId?: string;
    readonly lastVerifiedAt?: string;
}

export interface LibraryLinkStatusView {
    readonly configured: boolean;
    readonly state: 'unlinked' | LibraryLinkRecord['state'];
    readonly pairing?: LibraryLinkPairingView;
    readonly link?: LibraryLinkedView;
    readonly reason?: string;
    /** A credential still needs central confirmation; the host keeps retrying. */
    readonly centralRevokePending?: boolean;
    readonly notice?: LibraryTransportFailure;
}

export type LibraryLinkResult =
    | { readonly ok: true; readonly value: LibraryLinkStatusView }
    | { readonly ok: false; readonly failure: LibraryTransportFailure };

export interface LibraryLinkServiceDeps {
    readonly store: LibraryLinkStore;
    readonly transport: LibraryLinkTransport;
    readonly encryptionKey: string | undefined;
    readonly instanceId: string;
    readonly now?: () => number;
}

/**
 * Runs one task at a time per local user. The lock is module scope because each
 * request builds its own service instance: an instance-level lock would not
 * serialize concurrent requests.
 */
const userOperationTails = new Map<string, Promise<unknown>>();

function withUserLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const previous = userOperationTails.get(userId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => undefined);
    userOperationTails.set(userId, tail);
    void tail.finally(() => {
        if (userOperationTails.get(userId) === tail) userOperationTails.delete(userId);
    });
    return next;
}

class LibraryLinkUnavailableError extends Error {}

function unconfiguredFailure(): LibraryTransportFailure {
    return {
        code: 'pairing-unavailable',
        message:
            'Library linking is not configured on this server. An administrator must set the marketplace origin and the library link secret.',
        retryable: false,
    };
}

/**
 * Central responses that prove a credential is already unusable, so the host may
 * forget it without a successful revoke. Everything else — an unexpected error,
 * a malformed response, a restriction that an unban could lift — keeps the
 * obligation instead of assuming success.
 */
const SETTLED_REVOCATION_CODES: readonly LibraryTransportFailure['code'][] = [
    'link-invalid',
    'link-revoked',
    'link-expired',
    'account-deleted',
];

function revocationSettled(failure: LibraryTransportFailure): boolean {
    return SETTLED_REVOCATION_CODES.includes(failure.code);
}

export class LibraryLinkService {
    readonly #store: LibraryLinkStore;
    readonly #transport: LibraryLinkTransport;
    readonly #key: string | undefined;
    readonly #instanceId: string;
    readonly #now: () => number;
    readonly #configured: boolean;

    constructor(deps: LibraryLinkServiceDeps & { readonly configured?: boolean }) {
        this.#store = deps.store;
        this.#transport = deps.transport;
        this.#key = deps.encryptionKey;
        this.#instanceId = deps.instanceId;
        this.#now = deps.now ?? (() => Date.now());
        this.#configured = deps.configured ?? true;
    }

    get configured(): boolean {
        return this.#configured && this.#key !== undefined;
    }

    async status(userId: string): Promise<LibraryLinkStatusView> {
        return await withUserLock(userId, () => this.#guardStale(userId, () => this.#status(userId)));
    }

    async start(
        userId: string,
        input: { readonly label: string; readonly origin: string }
    ): Promise<LibraryLinkResult> {
        if (!this.configured) return { ok: false, failure: unconfiguredFailure() };
        return await withUserLock(userId, async () => {
            try {
                return { ok: true, value: await this.#start(userId, input) };
            } catch (error) {
                if (error instanceof LibraryLinkStoreConflictError) {
                    return { ok: true, value: await this.#freshView(userId) };
                }
                if (error instanceof LibraryLinkUnavailableError) {
                    return { ok: false, failure: unconfiguredFailure() };
                }
                throw error;
            }
        });
    }

    async disconnect(userId: string): Promise<LibraryLinkResult> {
        return await withUserLock(userId, async () => {
            try {
                return { ok: true, value: await this.#disconnect(userId) };
            } catch (error) {
                if (error instanceof LibraryLinkStoreConflictError) {
                    return { ok: true, value: await this.#freshView(userId) };
                }
                throw error;
            }
        });
    }

    /** A conflict means another writer advanced the binding; report its state. */
    async #guardStale<T extends LibraryLinkStatusView>(
        userId: string,
        run: () => Promise<T>
    ): Promise<LibraryLinkStatusView> {
        try {
            return await run();
        } catch (error) {
            if (error instanceof LibraryLinkStoreConflictError) return this.#freshView(userId);
            throw error;
        }
    }

    async #freshView(userId: string): Promise<LibraryLinkStatusView> {
        const fresh = await this.#store.read(userId);
        return fresh ? this.#view(fresh) : { configured: this.configured, state: 'unlinked' };
    }

    async #status(userId: string): Promise<LibraryLinkStatusView> {
        const record = await this.#store.read(userId);
        if (!record) return { configured: this.configured, state: 'unlinked' };
        // Configuration can be missing while a binding is intact (an operator
        // removed the secret, or a prebuilt image started without it). Report
        // what is recorded instead of decrypting, advancing or destroying it.
        if (!this.configured) return this.#view(record);

        if (record.state === 'pending') return await this.#pending(userId, record);
        if (record.state === 'linked') return await this.#linked(userId, record);
        if (record.state === 'revoked' || this.#hasOutstandingRevocations(record)) {
            const settled = await this.#retryRevocations(userId, record);
            return { ...this.#view(settled.record), ...(settled.notice ? { notice: settled.notice } : {}) };
        }
        return this.#view(record);
    }

    async #start(
        userId: string,
        input: { readonly label: string; readonly origin: string }
    ): Promise<LibraryLinkStatusView> {
        const previous = await this.#store.read(userId);

        // Replacing an earlier attempt requires proof: central cancels a session
        // only when the polling secret that belongs to it is presented, so host
        // metadata (shared by every user of a host and publicly knowable) cannot
        // cancel anyone's attempt.
        const replace = this.#replacementFor(userId, previous);
        const started = await this.#transport.start({
            label: input.label,
            origin: input.origin,
            ...(replace ? { replace } : {}),
        });
        if (!started.ok) return this.#viewAfterFailure(previous, started.failure);

        let secret: string;
        try {
            secret = encryptLibrarySecret(started.value.secret, this.#key, {
                userId,
                instanceId: this.#instanceId,
                purpose: 'polling-secret',
            });
        } catch {
            throw new LibraryLinkUnavailableError('library link encryption is unavailable');
        }

        const now = this.#now();
        const record: LibraryLinkRecord = {
            version: 1,
            revision: previous?.revision ?? 0,
            userId,
            instanceId: this.#instanceId,
            state: 'pending',
            pairingId: started.value.pairingId,
            comparisonCode: started.value.code,
            verificationUrl: started.value.verificationUrl,
            pairingExpiresAt: started.value.expiresAt,
            pollingSecretCiphertext: secret,
            nextPollAt: new Date(now + started.value.retryAfterMs).toISOString(),
            createdAt: previous?.createdAt ?? new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
            // Rotating does not forget any credential the previous binding still
            // owes central a revocation for.
            ...this.#carryRevocations(previous),
        };
        const stored = await this.#store.write(record, { expectRevision: previous?.revision ?? null });
        const settled = await this.#retryRevocations(userId, stored);
        return {
            ...this.#view(settled.record),
            ...(settled.notice ? { notice: settled.notice } : {}),
        };
    }

    async #disconnect(userId: string): Promise<LibraryLinkStatusView> {
        const record = await this.#store.read(userId);
        if (!record || (record.state !== 'linked' && record.state !== 'pending')) {
            return record ? this.#view(record) : { configured: this.configured, state: 'unlinked' };
        }

        const now = new Date(this.#now()).toISOString();
        if (record.state === 'pending') {
            // No credential exists yet; canceling the local attempt is enough
            // (the central session expires on its own, and a replacement is
            // proven by the secret we already hold).
            const canceled: LibraryLinkRecord = {
                ...record,
                state: 'expired',
                reason: 'canceled',
                updatedAt: now,
            };
            const stored = await this.#store.write(stripPairing(canceled), {
                expectRevision: record.revision,
            });
            return this.#view(stored);
        }

        // Stop this server first: the local record must not keep using the
        // credential while central revocation is attempted or retried.
        const localRevocation: LibraryLinkRecord = {
            ...record,
            state: 'revoked',
            reason: 'disconnected',
            centralRevokePending: true,
            pendingRevocations: this.#allCredentials(record),
            tokenCiphertext: undefined,
            updatedAt: now,
        };
        const stored = await this.#store.write(localRevocation, { expectRevision: record.revision });
        const settled = await this.#retryRevocations(userId, stored);
        return {
            ...this.#view(settled.record),
            ...(settled.notice ? { notice: settled.notice } : {}),
        };
    }

    async #pending(userId: string, record: LibraryLinkRecord): Promise<LibraryLinkStatusView> {
        let current = record;
        if (this.#hasOutstandingRevocations(current)) {
            const settled = await this.#retryRevocations(userId, current);
            current = settled.record;
        }

        const now = this.#now();
        if (current.pairingExpiresAt && Date.parse(current.pairingExpiresAt) <= now) {
            const ended: LibraryLinkRecord = {
                ...current,
                state: 'expired',
                reason: 'pairing-expired',
                updatedAt: new Date(now).toISOString(),
            };
            const stored = await this.#store.write(dropCredentials(ended, { retain: false }), {
                expectRevision: current.revision,
            });
            return this.#view(stored);
        }

        const dueAt = current.nextPollAt ? Date.parse(current.nextPollAt) : 0;
        if (dueAt > now) return this.#view(current);

        if (!current.pairingId || !current.pollingSecretCiphertext) {
            return await this.#failTerminal(userId, current, 'lost', 'binding-incomplete');
        }

        const secret = this.#decrypt(userId, current.pollingSecretCiphertext, 'polling-secret');
        if (!secret) {
            // Keep the encrypted material: restoring the correct key must still
            // be able to recover this attempt or revoke its credential.
            return await this.#failTerminal(userId, current, 'lost', 'binding-undecryptable');
        }

        const polled = await this.#transport.poll(current.pairingId, secret);
        if (!polled.ok) {
            if (polled.failure.code === 'pairing-not-found') {
                return await this.#failTerminal(userId, current, 'expired', 'pairing-replaced');
            }
            const waited: LibraryLinkRecord = {
                ...current,
                nextPollAt: new Date(now + FAILURE_RETRY_MS).toISOString(),
                updatedAt: new Date(now).toISOString(),
            };
            const stored = await this.#store.write(waited, { expectRevision: current.revision });
            return { ...this.#view(stored), notice: polled.failure };
        }

        if (polled.value.status === 'pending' || polled.value.status === 'approved') {
            const waiting: LibraryLinkRecord = {
                ...current,
                nextPollAt: new Date(now + Math.max(polled.value.retryAfterMs, 1_000)).toISOString(),
                updatedAt: new Date(now).toISOString(),
            };
            const stored = await this.#store.write(waiting, { expectRevision: current.revision });
            return this.#view(stored);
        }

        if (polled.value.status === 'denied') {
            return await this.#failTerminal(userId, current, 'denied', 'approval-denied');
        }
        if (polled.value.status === 'expired' || polled.value.status === 'canceled') {
            return await this.#failTerminal(userId, current, 'expired', 'pairing-expired');
        }
        // Consumed without a token: the one-time response was lost. There is no
        // recovery path by design; a new pairing is required (LK07).
        if (!polled.value.token) {
            return await this.#failTerminal(userId, current, 'lost', 'lost-response');
        }

        return await this.#becomeLinked(
            userId,
            current,
            polled.value.token,
            polled.value.link,
            polled.value.user,
        );
    }

    async #becomeLinked(
        userId: string,
        record: LibraryLinkRecord,
        token: string,
        link: RemoteLinkSummary | undefined,
        user: { readonly id: string; readonly displayName?: string } | undefined
    ): Promise<LibraryLinkStatusView> {
        if (!link) {
            return await this.#failTerminal(userId, record, 'lost', 'lost-response');
        }

        let tokenCiphertext: string;
        try {
            tokenCiphertext = encryptLibrarySecret(token, this.#key, {
                userId,
                instanceId: this.#instanceId,
                purpose: 'library-token',
            });
        } catch {
            return await this.#failTerminal(userId, record, 'lost', 'binding-undecryptable');
        }

        const now = new Date(this.#now()).toISOString();
        const linked: LibraryLinkRecord = {
            ...stripPairing(record),
            state: 'linked',
            linkId: link.id,
            tokenCiphertext,
            label: link.label,
            centralOrigin: link.origin,
            scopes: [...link.scopes],
            linkExpiresAt: link.expiresAt,
            lastVerifiedAt: now,
            accountId: user?.id,
            accountDisplayName: user?.displayName,
            updatedAt: now,
        };

        let stored: LibraryLinkRecord;
        try {
            stored = await this.#store.write(linked, { expectRevision: record.revision });
        } catch (error) {
            if (error instanceof LibraryLinkStoreConflictError) {
                // Another writer (another replica, or a Disconnect that landed
                // first) advanced the binding. This token was never handed to
                // anyone else, so end it rather than leaving an orphan.
                await this.#transport.revoke(token).catch(() => undefined);
            }
            throw error;
        }

        const settled = await this.#retryRevocations(userId, stored);
        return {
            ...this.#view(settled.record),
            ...(settled.notice ? { notice: settled.notice } : {}),
        };
    }

    async #linked(userId: string, record: LibraryLinkRecord): Promise<LibraryLinkStatusView> {
        let current = record;
        if (this.#hasOutstandingRevocations(current)) {
            const settled = await this.#retryRevocations(userId, current);
            if (settled.notice) {
                return { ...this.#view(settled.record), notice: settled.notice };
            }
            current = settled.record;
        }
        const now = this.#now();
        if (current.linkExpiresAt && Date.parse(current.linkExpiresAt) <= now) {
            const ended: LibraryLinkRecord = {
                ...current,
                state: 'expired',
                reason: 'link-expired',
                updatedAt: new Date(now).toISOString(),
            };
            // Reaching the fixed lifetime means central expires it at the same
            // instant; there is nothing left to revoke.
            const stored = await this.#store.write(dropCredentials(ended, { retain: false }), {
                expectRevision: current.revision,
            });
            return this.#view(stored);
        }

        const verifiedAt = current.lastVerifiedAt ? Date.parse(current.lastVerifiedAt) : 0;
        if (now - verifiedAt < VERIFY_INTERVAL_MS) return this.#view(current);

        const token = this.#tokenFor(userId, current);
        if (!token) return await this.#failTerminal(userId, current, 'lost', 'binding-undecryptable');

        const verified = await this.#transport.verify(token);
        if (!verified.ok) {
            if (revocationSettled(verified.failure)) {
                const reason =
                    verified.failure.code === 'link-expired'
                        ? 'link-expired'
                        : verified.failure.code === 'account-deleted'
                          ? 'account-unavailable'
                          : 'marketplace-revocation';
                const state = verified.failure.code === 'link-expired' ? 'expired' : 'revoked';
                const ended: LibraryLinkRecord = {
                    ...current,
                    state,
                    reason,
                    updatedAt: new Date(now).toISOString(),
                };
                // Central already refuses this credential (revoked/expired/
                // account gone), so no revocation is owed.
                const stored = await this.#store.write(dropCredentials(ended, { retain: false }), {
                    expectRevision: current.revision,
                });
                return this.#view(stored);
            }
            return { ...this.#view(current), notice: verified.failure };
        }

        const refreshed = this.#refreshedFromSession(current, verified.value, now);
        const stored = await this.#store.write(refreshed, { expectRevision: current.revision });
        return this.#view(stored);
    }

    #refreshedFromSession(
        record: LibraryLinkRecord,
        session: LinkedSessionPayload,
        now: number
    ): LibraryLinkRecord {
        return {
            ...record,
            linkId: session.link.id,
            label: session.link.label,
            centralOrigin: session.link.origin,
            scopes: [...session.link.scopes],
            linkExpiresAt: session.link.expiresAt,
            accountId: session.user.id,
            accountDisplayName: session.user.displayName,
            lastVerifiedAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
        };
    }

    /**
     * Confirm outstanding central revocations. A credential is dropped only when
     * central confirms it (or an authoritative response proves it is already
     * unusable); an unexpected failure, or a ciphertext this key cannot decrypt,
     * keeps the obligation for a later retry.
     */
    async #retryRevocations(
        userId: string,
        record: LibraryLinkRecord
    ): Promise<{ record: LibraryLinkRecord; notice?: LibraryTransportFailure }> {
        let current = record;
        const queue = this.#revocationQueue(current);
        if (queue.length === 0) {
            // A flag without a credential can only be stale bookkeeping.
            if (current.centralRevokePending) {
                current = await this.#store.write(
                    { ...current, centralRevokePending: false, updatedAt: new Date(this.#now()).toISOString() },
                    { expectRevision: current.revision }
                );
            }
            return { record: current };
        }
        const settled: string[] = [];
        const remaining: string[] = [];
        let notice: LibraryTransportFailure | undefined;
        let attempted = 0;

        for (const ciphertext of queue) {
            if (notice || attempted >= REVOCATIONS_PER_RETRY) {
                remaining.push(ciphertext);
                continue;
            }
            const token = this.#decrypt(userId, ciphertext, 'library-token');
            if (!token) {
                // Keep it: restoring the key must still revoke this credential.
                remaining.push(ciphertext);
                continue;
            }
            attempted += 1;
            const result = await this.#transport.revoke(token);
            if (result.ok || revocationSettled(result.failure)) {
                settled.push(ciphertext);
                continue;
            }
            remaining.push(ciphertext);
            notice = result.failure;
        }

        if (settled.length === 0 && remaining.length === queue.length && !notice) {
            // Nothing decryptable yet (wrong key); keep the record untouched.
            return { record: current };
        }

        current = await this.#store.write(
            {
                ...current,
                // Outside `linked` the active credential is accounted for by the
                // queue above; inside `linked` it stays the working credential.
                tokenCiphertext: current.state === 'linked' ? current.tokenCiphertext : undefined,
                pendingRevocations: remaining.length > 0 ? remaining : undefined,
                centralRevokePending: remaining.length > 0,
                updatedAt: new Date(this.#now()).toISOString(),
            },
            { expectRevision: current.revision }
        );
        return { record: current, ...(notice ? { notice } : {}) };
    }

    async #failTerminal(
        userId: string,
        record: LibraryLinkRecord,
        state: 'denied' | 'expired' | 'revoked' | 'lost',
        reason: string
    ): Promise<LibraryLinkStatusView> {
        // A terminal transition keeps any credential central still needs to
        // revoke. Material this key cannot read is also kept verbatim: a
        // temporarily wrong key must not be an irreversible loss of the ability
        // to recover or revoke what is stored.
        const base = reason === 'binding-undecryptable' ? record : stripPairing(record);
        // The active credential becomes an obligation the moment the link ends,
        // so it moves into the revocation queue with everything already there.
        const queue = this.#allCredentials(record);
        const ended: LibraryLinkRecord = {
            ...base,
            state,
            reason,
            tokenCiphertext: undefined,
            pendingRevocations: queue.length > 0 ? queue : undefined,
            centralRevokePending: queue.length > 0,
            updatedAt: new Date(this.#now()).toISOString(),
        };
        const stored = await this.#store.write(ended, { expectRevision: record.revision });
        return this.#view(stored);
    }

    /** Every stored credential, whether active or awaiting revocation. */
    #allCredentials(record: LibraryLinkRecord): string[] {
        return [
            ...new Set([
                ...(record.pendingRevocations ?? []),
                ...(record.tokenCiphertext ? [record.tokenCiphertext] : []),
            ]),
        ];
    }

    /**
     * Credentials that still need a central revocation: replaced/ended ones, and
     * the active credential once the link is no longer `linked`.
     */
    #revocationQueue(record: LibraryLinkRecord): string[] {
        return [
            ...new Set([
                ...(record.pendingRevocations ?? []),
                ...(record.state !== 'linked' && record.tokenCiphertext
                    ? [record.tokenCiphertext]
                    : []),
            ]),
        ];
    }

    #hasOutstandingRevocations(record: LibraryLinkRecord): boolean {
        return this.#revocationQueue(record).length > 0 || record.centralRevokePending === true;
    }

    #carryRevocations(previous: LibraryLinkRecord | null): Partial<LibraryLinkRecord> {
        if (!previous) return {};
        // Rotation always ends the previous credential, so every stored
        // ciphertext becomes an obligation — including the one that was active.
        const queue = this.#allCredentials(previous);
        return queue.length > 0 ? { pendingRevocations: queue, centralRevokePending: true } : {};
    }

    #replacementFor(
        userId: string,
        previous: LibraryLinkRecord | null
    ): { pairingId: string; secret: string } | null {
        if (!previous?.pairingId || !previous.pollingSecretCiphertext) return null;
        if (previous.state !== 'pending' && previous.state !== 'lost') return null;
        const secret = this.#decrypt(userId, previous.pollingSecretCiphertext, 'polling-secret');
        return secret ? { pairingId: previous.pairingId, secret } : null;
    }

    #tokenFor(userId: string, record: LibraryLinkRecord): string | null {
        return record.tokenCiphertext
            ? this.#decrypt(userId, record.tokenCiphertext, 'library-token')
            : null;
    }

    #decrypt(
        userId: string,
        payload: string,
        purpose: 'polling-secret' | 'library-token'
    ): string | null {
        try {
            return decryptLibrarySecret(payload, this.#key, {
                userId,
                instanceId: this.#instanceId,
                purpose,
            });
        } catch {
            return null;
        }
    }

    #viewAfterFailure(
        previous: LibraryLinkRecord | null,
        failure: LibraryTransportFailure
    ): LibraryLinkStatusView {
        if (!previous) return { configured: this.configured, state: 'unlinked', notice: failure };
        return { ...this.#view(previous), notice: failure };
    }

    #view(record: LibraryLinkRecord): LibraryLinkStatusView {
        const outstanding = this.#hasOutstandingRevocations(record);
        const base: LibraryLinkStatusView = {
            configured: this.configured,
            state: record.state,
            ...(record.reason ? { reason: record.reason } : {}),
            ...(outstanding ? { centralRevokePending: true } : {}),
        };
        if (record.state === 'pending' && record.comparisonCode && record.verificationUrl && record.pairingExpiresAt) {
            const dueAt = record.nextPollAt ? Date.parse(record.nextPollAt) : this.#now();
            return {
                ...base,
                pairing: {
                    code: record.comparisonCode,
                    verificationUrl: record.verificationUrl,
                    expiresAt: record.pairingExpiresAt,
                    retryAfterMs: Math.max(dueAt - this.#now(), 0),
                },
            };
        }
        if (record.state === 'linked' && record.linkId && record.label && record.centralOrigin) {
            return {
                ...base,
                link: {
                    id: record.linkId,
                    label: record.label,
                    origin: record.centralOrigin,
                    scopes: record.scopes ?? [],
                    expiresAt: record.linkExpiresAt ?? '',
                    ...(record.accountDisplayName ? { account: record.accountDisplayName } : {}),
                    ...(record.accountId ? { accountId: record.accountId } : {}),
                    ...(record.lastVerifiedAt ? { lastVerifiedAt: record.lastVerifiedAt } : {}),
                },
            };
        }
        return base;
    }
}

function stripPairing(record: LibraryLinkRecord): LibraryLinkRecord {
    return {
        ...record,
        pairingId: undefined,
        comparisonCode: undefined,
        verificationUrl: undefined,
        pairingExpiresAt: undefined,
        pollingSecretCiphertext: undefined,
        nextPollAt: undefined,
    };
}

/**
 * Ends a link's credentials. With `retain`, the ciphertexts become outstanding
 * revocations (the caller cannot prove central ended them); without it, the
 * credential is already invalid centrally and nothing is owed.
 */
function dropCredentials(
    record: LibraryLinkRecord,
    options: { readonly retain: boolean }
): LibraryLinkRecord {
    const queue = [
        ...new Set([
            ...(record.pendingRevocations ?? []),
            ...(record.tokenCiphertext ? [record.tokenCiphertext] : []),
        ]),
    ];
    // `retain: false` ends only the current credential; obligations from an
    // earlier rotation are unrelated and stay.
    const pending = options.retain ? queue : [...new Set(record.pendingRevocations ?? [])];
    return {
        ...stripPairing(record),
        tokenCiphertext: undefined,
        pendingRevocations: pending.length > 0 ? pending : undefined,
        centralRevokePending: pending.length > 0,
    };
}

export { requireLibraryLinkKey };
