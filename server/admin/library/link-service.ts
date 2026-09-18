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
 */
import {
    decryptLibrarySecret,
    encryptLibrarySecret,
    requireLibraryLinkKey,
} from './link-crypto';
import type { LibraryLinkRecord, LibraryLinkStore } from './link-store';
import type {
    LibraryLinkTransport,
    LibraryTransportFailure,
    RemoteLinkSummary,
} from './transport';

/** A linked session is re-verified at most this often while the UI is used. */
const VERIFY_INTERVAL_MS = 10 * 60_000;
/** Do not hammer central after a failure; the schedule resumes after this. */
const FAILURE_RETRY_MS = 60_000;

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
    readonly lastVerifiedAt?: string;
}

export interface LibraryLinkStatusView {
    readonly configured: boolean;
    readonly state: 'unlinked' | LibraryLinkRecord['state'];
    readonly pairing?: LibraryLinkPairingView;
    readonly link?: LibraryLinkedView;
    readonly reason?: string;
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

function unconfiguredFailure(): LibraryTransportFailure {
    return {
        code: 'pairing-unavailable',
        message:
            'Library linking is not configured on this server. An administrator must set the marketplace origin and the library link secret.',
        retryable: false,
    };
}

function isTerminalFailure(failure: LibraryTransportFailure): boolean {
    return [
        'link-invalid',
        'link-revoked',
        'link-expired',
        'account-deleted',
        'account-restricted',
    ].includes(failure.code);
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
        const record = await this.#store.read(userId);
        if (!record) return { configured: this.configured, state: 'unlinked' };
        // Configuration can be missing while a binding is intact (an operator
        // removed the secret, or a prebuilt image started without it). Report
        // what is recorded instead of decrypting, advancing or destroying it.
        if (!this.configured) return this.#view(record);

        if (record.state === 'pending') return await this.#pending(userId, record);
        if (record.state === 'linked') return await this.#linked(userId, record);
        if (record.state === 'revoked') {
            const settled = await this.#retryRevocations(userId, record);
            return { ...this.#view(settled.record), ...(settled.notice ? { notice: settled.notice } : {}) };
        }
        return this.#view(record);
    }

    async start(
        userId: string,
        input: { readonly label: string; readonly origin: string }
    ): Promise<LibraryLinkResult> {
        if (!this.configured) return { ok: false, failure: unconfiguredFailure() };
        const previous = await this.#store.read(userId);
        const started = await this.#transport.start(input);
        if (!started.ok) return { ok: false, failure: started.failure };

        let secret: string;
        try {
            secret = encryptLibrarySecret(started.value.secret, this.#key, {
                userId,
                instanceId: this.#instanceId,
                purpose: 'polling-secret',
            });
        } catch {
            return { ok: false, failure: unconfiguredFailure() };
        }

        const now = this.#now();
        // Reconnecting rotates the credential: the replaced token is revoked
        // now, not after the new approval, so no stale authority stays live.
        const carryOver = this.#revocationsToRetain(previous);
        const record: LibraryLinkRecord = {
            version: 1,
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
            ...carryOver,
        };
        await this.#store.write(record);
        const settled = await this.#retryRevocations(userId, record);
        return {
            ok: true,
            value: {
                ...this.#view(settled.record),
                ...(settled.notice ? { notice: settled.notice } : {}),
            },
        };
    }

    async disconnect(userId: string): Promise<LibraryLinkResult> {
        const record = await this.#store.read(userId);
        if (!record || (record.state !== 'linked' && record.state !== 'pending')) {
            return { ok: true, value: record ? this.#view(record) : { configured: this.configured, state: 'unlinked' } };
        }

        const now = new Date(this.#now()).toISOString();
        if (record.state === 'pending') {
            const canceled: LibraryLinkRecord = {
                ...record,
                state: 'expired',
                reason: 'canceled',
                updatedAt: now,
            };
            await this.#store.write(stripPairing(canceled));
            return { ok: true, value: this.#view(canceled) };
        }

        // Stop this server first: the local record must not keep using the
        // credential while central revocation is attempted or retried.
        const localRevocation: LibraryLinkRecord = {
            ...record,
            state: 'revoked',
            reason: 'disconnected',
            centralRevokePending: true,
            updatedAt: now,
        };
        await this.#store.write(localRevocation);
        const settled = await this.#retryRevocations(userId, localRevocation);
        return {
            ok: true,
            value: {
                ...this.#view(settled.record),
                ...(settled.notice ? { notice: settled.notice } : {}),
            },
        };
    }

    async #pending(userId: string, record: LibraryLinkRecord): Promise<LibraryLinkStatusView> {
        // A replaced credential from an earlier reconnect may still need its
        // central revocation confirmed; that never blocks the new pairing.
        let current = record;
        if (current.previousTokenCiphertext || current.centralRevokePending) {
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
            await this.#store.write(dropCredentials(ended));
            return this.#view(ended);
        }

        const dueAt = current.nextPollAt ? Date.parse(current.nextPollAt) : 0;
        if (dueAt > now) return this.#view(current);

        if (!current.pairingId || !current.pollingSecretCiphertext) {
            return await this.#failTerminal(userId, current, 'lost', 'binding-incomplete');
        }

        let secret: string;
        try {
            secret = decryptLibrarySecret(current.pollingSecretCiphertext, this.#key, {
                userId,
                instanceId: this.#instanceId,
                purpose: 'polling-secret',
            });
        } catch {
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
            await this.#store.write(waited);
            return { ...this.#view(waited), notice: polled.failure };
        }

        if (polled.value.status === 'pending' || polled.value.status === 'approved') {
            const waiting: LibraryLinkRecord = {
                ...current,
                nextPollAt: new Date(
                    now + Math.max(polled.value.retryAfterMs, 1_000)
                ).toISOString(),
                updatedAt: new Date(now).toISOString(),
            };
            await this.#store.write(waiting);
            return this.#view(waiting);
        }

        if (polled.value.status === 'denied') {
            return await this.#failTerminal(userId, current, 'denied', 'approval-denied');
        }
        if (polled.value.status === 'expired' || polled.value.status === 'canceled') {
            return await this.#failTerminal(userId, current, 'expired', 'pairing-expired');
        }
        // Consumed without a token: the one-time response was lost. There is no
        // recovery path by design; a new pairing is required (LK07).
        if (!polled.value.token || !polled.value.link) {
            return await this.#failTerminal(userId, current, 'lost', 'lost-response');
        }

        return await this.#becomeLinked(userId, current, polled.value.token, polled.value.link);
    }

    async #becomeLinked(
        userId: string,
        record: LibraryLinkRecord,
        token: string,
        link: RemoteLinkSummary
    ): Promise<LibraryLinkStatusView> {
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
            ...record,
            state: 'linked',
            linkId: link.id,
            tokenCiphertext,
            label: link.label,
            centralOrigin: link.origin,
            scopes: [...link.scopes],
            linkExpiresAt: link.expiresAt,
            lastVerifiedAt: now,
            updatedAt: now,
        };
        const stored = stripPairing(linked);
        await this.#store.write(stored);
        const settled = await this.#retryRevocations(userId, stored);
        return {
            ...this.#view(settled.record),
            ...(settled.notice ? { notice: settled.notice } : {}),
        };
    }

    async #linked(userId: string, record: LibraryLinkRecord): Promise<LibraryLinkStatusView> {
        let current = record;
        if (current.centralRevokePending || current.previousTokenCiphertext) {
            const settled = await this.#retryRevocations(userId, current);
            if (settled.notice) {
                return { ...this.#view(settled.record), notice: settled.notice };
            }
            current = settled.record;
        }
        const now = this.#now();
        if (current.linkExpiresAt && Date.parse(current.linkExpiresAt) <= now) {
            const expired: LibraryLinkRecord = {
                ...current,
                state: 'expired',
                reason: 'link-expired',
                updatedAt: new Date(now).toISOString(),
            };
            await this.#store.write(dropCredentials(expired));
            return this.#view(expired);
        }

        const verifiedAt = current.lastVerifiedAt ? Date.parse(current.lastVerifiedAt) : 0;
        if (now - verifiedAt < VERIFY_INTERVAL_MS) return this.#view(current);

        const token = this.#tokenFor(userId, current);
        if (!token) return await this.#failTerminal(userId, current, 'lost', 'binding-undecryptable');

        const verified = await this.#transport.verify(token);
        if (!verified.ok) {
            if (isTerminalFailure(verified.failure)) {
                const reason =
                    verified.failure.code === 'link-expired'
                        ? 'link-expired'
                        : verified.failure.code === 'account-deleted' ||
                            verified.failure.code === 'account-restricted'
                          ? 'account-unavailable'
                          : 'marketplace-revocation';
                const state = verified.failure.code === 'link-expired' ? 'expired' : 'revoked';
                const ended: LibraryLinkRecord = {
                    ...current,
                    state,
                    reason,
                    updatedAt: new Date(now).toISOString(),
                };
                await this.#store.write(dropCredentials(ended));
                return this.#view(ended);
            }
            return { ...this.#view(current), notice: verified.failure };
        }

        const refreshed: LibraryLinkRecord = {
            ...current,
            linkId: verified.value.link.id,
            label: verified.value.link.label,
            centralOrigin: verified.value.link.origin,
            scopes: [...verified.value.link.scopes],
            linkExpiresAt: verified.value.link.expiresAt,
            accountDisplayName: verified.value.user.displayName,
            lastVerifiedAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
        };
        await this.#store.write(refreshed);
        return this.#view(refreshed);
    }

    /** Confirm outstanding central revocations; retry later on failure. */
    async #retryRevocations(
        userId: string,
        record: LibraryLinkRecord
    ): Promise<{ record: LibraryLinkRecord; notice?: LibraryTransportFailure }> {
        let current = record;
        if (current.previousTokenCiphertext) {
            const token = this.#decrypt(userId, current.previousTokenCiphertext, 'library-token');
            // A credential that cannot be decrypted is never forgotten: the
            // revocation stays outstanding rather than being assumed done.
            if (!token) return { record: current };
            const result = await this.#transport.revoke(token);
            if (!result.ok && result.failure.retryable) {
                return { record: current, notice: result.failure };
            }
            current = {
                ...current,
                previousTokenCiphertext: undefined,
                updatedAt: new Date(this.#now()).toISOString(),
            };
            await this.#store.write(current);
        }

        if (current.centralRevokePending && current.tokenCiphertext) {
            const token = this.#decrypt(userId, current.tokenCiphertext, 'library-token');
            if (!token) return { record: current };
            const result = await this.#transport.revoke(token);
            if (!result.ok && result.failure.retryable) {
                return { record: current, notice: result.failure };
            }
            current = {
                ...current,
                centralRevokePending: false,
                tokenCiphertext: undefined,
                updatedAt: new Date(this.#now()).toISOString(),
            };
            await this.#store.write(current);
        }

        return { record: current };
    }

    async #failTerminal(
        userId: string,
        record: LibraryLinkRecord,
        state: 'denied' | 'expired' | 'revoked' | 'lost',
        reason: string
    ): Promise<LibraryLinkStatusView> {
        const ended: LibraryLinkRecord = dropCredentials({
            ...record,
            state,
            reason,
            updatedAt: new Date(this.#now()).toISOString(),
        });
        await this.#store.write(stripPairing(ended));
        return this.#view(ended);
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

    #revocationsToRetain(previous: LibraryLinkRecord | null): Partial<LibraryLinkRecord> {
        if (!previous) return {};
        if (previous.previousTokenCiphertext) {
            return { previousTokenCiphertext: previous.previousTokenCiphertext };
        }
        if (previous.tokenCiphertext) {
            return { previousTokenCiphertext: previous.tokenCiphertext };
        }
        return {};
    }

    #view(record: LibraryLinkRecord): LibraryLinkStatusView {
        const base: LibraryLinkStatusView = {
            configured: this.configured,
            state: record.state,
            ...(record.reason ? { reason: record.reason } : {}),
            ...(record.centralRevokePending ? { centralRevokePending: true } : {}),
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

function dropCredentials(record: LibraryLinkRecord): LibraryLinkRecord {
    return { ...stripPairing(record), tokenCiphertext: undefined };
}

export { requireLibraryLinkKey };
