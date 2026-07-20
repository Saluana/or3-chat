import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { EXTENSIONS_BASE_DIR } from '../extensions/paths';

export type PackageOperationLockErrorCode =
    | 'invalid-plugin-id'
    | 'lock-timeout'
    | 'lock-aborted';

export class PackageOperationLockError extends Error {
    constructor(readonly code: PackageOperationLockErrorCode, message: string) {
        super(message);
        this.name = 'PackageOperationLockError';
    }
}

export interface PackageOperationLockOptions {
    readonly timeoutMs?: number;
    readonly pollIntervalMs?: number;
    readonly staleAfterMs?: number;
    readonly signal?: AbortSignal;
}

export interface PackageOperationLease {
    readonly pluginId: string;
    readonly ownerId: string;
    readonly lockPath: string;
    heartbeat(): Promise<boolean>;
    release(): Promise<boolean>;
}

interface LockOwnerRecord {
    readonly schemaVersion: 1;
    readonly pluginId: string;
    readonly ownerId: string;
    readonly pid: number;
    readonly hostname: string;
    readonly acquiredAt: number;
    readonly heartbeatAt: number;
}

interface InspectedLock {
    readonly stale: boolean;
    readonly inode: bigint;
    readonly owner: LockOwnerRecord | null;
}

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const OWNER_FILENAME = 'owner.json';

function assertPluginId(pluginId: string): void {
    if (!PLUGIN_ID_PATTERN.test(pluginId) || pluginId.includes('..')) {
        throw new PackageOperationLockError('invalid-plugin-id', `Invalid V2 plugin id: ${pluginId}`);
    }
}

function errorCode(error: unknown): string | undefined {
    return error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
}

async function exists(path: string): Promise<boolean> {
    try {
        await fs.lstat(path);
        return true;
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return false;
        throw error;
    }
}

function validOwner(value: unknown): value is LockOwnerRecord {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<LockOwnerRecord>;
    return (
        record.schemaVersion === 1 &&
        typeof record.pluginId === 'string' &&
        typeof record.ownerId === 'string' &&
        typeof record.pid === 'number' &&
        Number.isSafeInteger(record.pid) &&
        record.pid > 0 &&
        typeof record.hostname === 'string' &&
        typeof record.acquiredAt === 'number' &&
        typeof record.heartbeatAt === 'number'
    );
}

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return errorCode(error) === 'EPERM';
    }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.reject(new PackageOperationLockError('lock-aborted', 'Package operation lock was aborted'));
    }
    return new Promise((resolvePromise, reject) => {
        const finish = () => {
            signal?.removeEventListener('abort', abort);
            resolvePromise();
        };
        const timer = setTimeout(finish, milliseconds);
        const abort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            reject(new PackageOperationLockError('lock-aborted', 'Package operation lock was aborted'));
        };
        signal?.addEventListener('abort', abort, { once: true });
    });
}

async function writeOwner(path: string, owner: LockOwnerRecord): Promise<void> {
    const temporary = resolve(path, `.owner-${owner.ownerId}.tmp`);
    await fs.writeFile(temporary, `${JSON.stringify(owner)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, resolve(path, OWNER_FILENAME));
}

async function readOwner(lockPath: string): Promise<LockOwnerRecord | null> {
    try {
        const parsed = JSON.parse(await fs.readFile(resolve(lockPath, OWNER_FILENAME), 'utf8')) as unknown;
        return validOwner(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

async function inspectLock(
    lockPath: string,
    localHostname: string,
    staleAfterMs: number
): Promise<InspectedLock | null> {
    let stat;
    try {
        stat = await fs.lstat(lockPath, { bigint: true });
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
    }
    const owner = await readOwner(lockPath);
    if (!owner) {
        return {
            stale: Date.now() - Number(stat.mtimeMs) > staleAfterMs,
            inode: stat.ino,
            owner: null,
        };
    }
    const stale = owner.hostname === localHostname
        ? !processIsAlive(owner.pid)
        : Date.now() - owner.heartbeatAt > staleAfterMs;
    return { stale, inode: stat.ino, owner };
}

export class AdvisoryPluginOperationLock {
    readonly #locksRoot: string;
    readonly #hostname: string;

    constructor(extensionsRoot = EXTENSIONS_BASE_DIR, localHostname = hostname()) {
        this.#locksRoot = resolve(extensionsRoot, '.locks');
        this.#hostname = localHostname;
    }

    get locksRoot(): string {
        return this.#locksRoot;
    }

    async #recoverStale(
        pluginId: string,
        lockPath: string,
        recoveryPath: string,
        staleAfterMs: number
    ): Promise<boolean> {
        try {
            await fs.mkdir(recoveryPath, { mode: 0o700 });
        } catch (error) {
            if (errorCode(error) === 'EEXIST') return false;
            throw error;
        }
        const quarantine = resolve(
            this.#locksRoot,
            `.${pluginId}.stale-${randomUUID()}`
        );
        try {
            const inspected = await inspectLock(lockPath, this.#hostname, staleAfterMs);
            if (!inspected?.stale) return false;
            try {
                await fs.rename(lockPath, quarantine);
            } catch (error) {
                if (errorCode(error) === 'ENOENT') return true;
                throw error;
            }
            const moved = await fs.lstat(quarantine, { bigint: true });
            const movedOwner = await readOwner(quarantine);
            const sameOwner = inspected.owner
                ? movedOwner?.ownerId === inspected.owner.ownerId
                : moved.ino === inspected.inode;
            if (!sameOwner) {
                if (!(await exists(lockPath))) await fs.rename(quarantine, lockPath);
                return false;
            }
            await fs.rm(quarantine, { recursive: true, force: true });
            return true;
        } finally {
            await fs.rmdir(recoveryPath).catch(() => undefined);
        }
    }

    async acquire(
        pluginId: string,
        options: PackageOperationLockOptions = {}
    ): Promise<PackageOperationLease> {
        assertPluginId(pluginId);
        const timeoutMs = options.timeoutMs ?? 30_000;
        const pollIntervalMs = options.pollIntervalMs ?? 25;
        const staleAfterMs = options.staleAfterMs ?? 30_000;
        const startedAt = Date.now();
        const lockPath = resolve(this.#locksRoot, `${pluginId}.lock`);
        const recoveryPath = resolve(this.#locksRoot, `${pluginId}.recovery`);
        await fs.mkdir(this.#locksRoot, { recursive: true, mode: 0o700 });

        for (;;) {
            if (options.signal?.aborted) {
                throw new PackageOperationLockError('lock-aborted', `Lock acquisition aborted for ${pluginId}`);
            }
            if (!(await exists(recoveryPath))) {
                try {
                    await fs.mkdir(lockPath, { mode: 0o700 });
                    if (await exists(recoveryPath)) {
                        await fs.rmdir(lockPath).catch(() => undefined);
                    } else {
                        const now = Date.now();
                        const owner: LockOwnerRecord = {
                            schemaVersion: 1,
                            pluginId,
                            ownerId: randomUUID(),
                            pid: process.pid,
                            hostname: this.#hostname,
                            acquiredAt: now,
                            heartbeatAt: now,
                        };
                        try {
                            await writeOwner(lockPath, owner);
                            return this.#lease(lockPath, owner, staleAfterMs);
                        } catch (error) {
                            await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
                            throw error;
                        }
                    }
                } catch (error) {
                    if (errorCode(error) !== 'EEXIST') throw error;
                }
            }

            const inspected = await inspectLock(lockPath, this.#hostname, staleAfterMs);
            if (inspected?.stale) {
                await this.#recoverStale(pluginId, lockPath, recoveryPath, staleAfterMs);
                continue;
            }
            if (Date.now() - startedAt >= timeoutMs) {
                throw new PackageOperationLockError('lock-timeout', `Timed out waiting for package lock ${pluginId}`);
            }
            await delay(pollIntervalMs, options.signal);
        }
    }

    #lease(
        lockPath: string,
        initialOwner: LockOwnerRecord,
        staleAfterMs: number
    ): PackageOperationLease {
        let owner = initialOwner;
        let released = false;
        let heartbeatTail = Promise.resolve<boolean>(true);
        const performHeartbeat = async (): Promise<boolean> => {
            if (released) return false;
            const current = await readOwner(lockPath);
            if (current?.ownerId !== owner.ownerId) return false;
            owner = { ...owner, heartbeatAt: Date.now() };
            try {
                await writeOwner(lockPath, owner);
                return true;
            } catch {
                return false;
            }
        };
        const heartbeat = (): Promise<boolean> => {
            heartbeatTail = heartbeatTail.then(performHeartbeat, performHeartbeat);
            return heartbeatTail;
        };
        const interval = setInterval(() => void heartbeat(), Math.max(25, Math.floor(staleAfterMs / 3)));
        interval.unref();
        const release = async (): Promise<boolean> => {
            if (released) return false;
            released = true;
            clearInterval(interval);
            await heartbeatTail.catch(() => false);
            const current = await readOwner(lockPath);
            if (current?.ownerId !== owner.ownerId) return false;
            try {
                await fs.unlink(resolve(lockPath, OWNER_FILENAME));
                await fs.rmdir(lockPath);
                return true;
            } catch (error) {
                if (errorCode(error) === 'ENOENT') return false;
                throw error;
            }
        };
        return Object.freeze({
            pluginId: owner.pluginId,
            ownerId: owner.ownerId,
            lockPath,
            heartbeat,
            release,
        });
    }
}
