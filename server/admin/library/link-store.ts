/**
 * Per-user Library link binding storage.
 *
 * One file per local user under the admin data directory, written atomically and
 * owner-only. The file belongs to the initiating local user and instance: another
 * local user reads a different path and can never see or use this binding
 * (R15.AC4, R15.AC6, LK02). Only ciphertext for the polling secret and the
 * library token is ever stored here.
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
    /** Display name central reported for the approving account, when known. */
    readonly accountDisplayName?: string;
    /** A replaced link whose central revocation has not been confirmed yet. */
    readonly previousTokenCiphertext?: string;
    /** Local Disconnect done, central revocation still outstanding. */
    readonly centralRevokePending?: boolean;
    /** Why the record is in its current terminal state. */
    readonly reason?: string;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface LibraryLinkStore {
    read(userId: string): Promise<LibraryLinkRecord | null>;
    write(record: LibraryLinkRecord): Promise<void>;
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

    return {
        async read(userId: string): Promise<LibraryLinkRecord | null> {
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
                return parsed;
            } catch {
                // Keep unreadable evidence instead of silently overwriting it,
                // then behave as if no binding exists (reconnect is required).
                await rename(pathFor(userId), `${pathFor(userId)}.corrupt-${Date.now()}`).catch(
                    () => undefined
                );
                return null;
            }
        },

        async write(record: LibraryLinkRecord): Promise<void> {
            assertUserId(record.userId);
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const target = pathFor(record.userId);
            const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
            await writeFile(temporary, JSON.stringify(record, null, 2), {
                encoding: 'utf8',
                mode: 0o600,
            });
            try {
                await rename(temporary, target);
            } catch (error) {
                await rm(temporary, { force: true }).catch(() => undefined);
                throw error;
            }
        },
    };
}
