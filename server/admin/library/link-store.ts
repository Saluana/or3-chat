/**
 * Per-user Library link binding storage.
 *
 * One file per local user under the admin data directory, written atomically and
 * owner-only. The file belongs to the initiating local user and instance: another
 * local user reads a different path and can never see or use this binding
 * (R15.AC4, R15.AC6, LK02). Only ciphertext for the polling secret and the
 * library token is ever stored here.
 *
 * Every write is a compare-and-swap on a monotonically increasing `revision`, so
 * a request that read an older binding cannot overwrite the outcome of a newer
 * one (a losing poll must not replace a successful link with "lost", and an
 * in-flight poll must not undo a Disconnect).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveAdminDataDir } from '../auth/data-paths';

const DIRECTORY_NAME = 'library-links';
const USER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type LibraryLinkState =
    | 'pending'
    | 'linked'
    | 'denied'
    | 'expired'
    | 'revoked'
    | 'lost';

export interface LibraryLinkRecord {
    readonly version: 1;
    /** Bumped by the store on every write; the CAS token for the next write. */
    readonly revision: number;
    readonly userId: string;
    readonly instanceId: string;
    readonly state: LibraryLinkState;
    /** Pairing attempt in progress. */
    readonly pairingId?: string;
    readonly comparisonCode?: string;
    readonly verificationUrl?: string;
    readonly pairingExpiresAt?: string;
    readonly pollingSecretCiphertext?: string;
    readonly nextPollAt?: string;
    /** Established link. */
    readonly linkId?: string;
    readonly tokenCiphertext?: string;
    readonly label?: string;
    readonly centralOrigin?: string;
    readonly scopes?: readonly string[];
    readonly linkExpiresAt?: string;
    readonly lastVerifiedAt?: string;
    /** Central account identifier and display name, when reported. */
    readonly accountId?: string;
    readonly accountDisplayName?: string;
    /**
     * Credentials whose central revocation is still outstanding (a replaced
     * credential, or one ended by Disconnect). Every entry stays until central
     * confirms it, so repeated rotation cannot forget a live credential.
     */
    readonly pendingRevocations?: readonly string[];
    /** Local Disconnect done, central revocation still outstanding. */
    readonly centralRevokePending?: boolean;
    /** Why the record is in its current terminal state. */
    readonly reason?: string;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export class LibraryLinkStoreConflictError extends Error {
    constructor() {
        super('The library link binding changed while this operation was running');
    }
}

export interface LibraryLinkWriteOptions {
    /**
     * The revision this write is based on, or `null` to create a new binding.
     * A mismatch means another operation already advanced the binding.
     */
    readonly expectRevision: number | null;
}

export interface LibraryLinkStore {
    read(userId: string): Promise<LibraryLinkRecord | null>;
    /**
     * Writes `record` only if the stored revision still matches. Returns the
     * stored record (with its new revision) on success and throws
     * `LibraryLinkStoreConflictError` when another writer won.
     */
    write(
        record: LibraryLinkRecord,
        options: LibraryLinkWriteOptions
    ): Promise<LibraryLinkRecord>;
}

function assertUserId(userId: string): void {
    if (!USER_ID_PATTERN.test(userId)) {
        throw new Error('A local user id must be a simple identifier to own a link file');
    }
}

export interface FileLibraryLinkStoreOptions {
    readonly directory?: string;
}

export function resolveLibraryLinkDirectory(directory?: string): string {
    return directory ?? join(resolveAdminDataDir(), DIRECTORY_NAME);
}

export function createFileLibraryLinkStore(
    options: FileLibraryLinkStoreOptions = {}
): LibraryLinkStore {
    const directory = resolveLibraryLinkDirectory(options.directory);
    const pathFor = (userId: string): string => join(directory, `${userId}.json`);

    async function read(userId: string): Promise<LibraryLinkRecord | null> {
        assertUserId(userId);
        let raw: string;
        try {
            raw = await readFile(pathFor(userId), 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
        }
        try {
            const parsed = JSON.parse(raw) as LibraryLinkRecord;
            if (parsed?.version !== 1 || parsed.userId !== userId) {
                throw new Error('unexpected binding shape');
            }
            return { ...parsed, revision: typeof parsed.revision === 'number' ? parsed.revision : 0 };
        } catch {
            // Keep unreadable evidence instead of silently overwriting it, then
            // behave as if no binding exists (a reconnect is required).
            await rename(pathFor(userId), `${pathFor(userId)}.corrupt-${Date.now()}`).catch(
                () => undefined
            );
            return null;
        }
    }

    return {
        read,

        async write(record, { expectRevision }) {
            const existing = await read(record.userId);
            if (expectRevision === null) {
                if (existing) throw new LibraryLinkStoreConflictError();
            } else if (!existing || existing.revision !== expectRevision) {
                throw new LibraryLinkStoreConflictError();
            }

            const stored: LibraryLinkRecord = {
                ...record,
                revision: (existing?.revision ?? 0) + 1,
            };
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const target = pathFor(record.userId);
            const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
            await writeFile(temporary, JSON.stringify(stored, null, 2), {
                encoding: 'utf8',
                mode: 0o600,
            });
            try {
                await rename(temporary, target);
            } catch (error) {
                await rm(temporary, { force: true }).catch(() => undefined);
                throw error;
            }
            return stored;
        },
    };
}
