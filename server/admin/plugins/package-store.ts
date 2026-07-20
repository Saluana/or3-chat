import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { PerPluginLifecycleMutex } from '../../../shared/plugins/lifecycle-coordinator';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import { EXTENSIONS_BASE_DIR } from '../extensions/paths';
import { AdvisoryPluginOperationLock } from './package-operation-lock';
import {
    PackageTreeValidationError,
    verifyPackageTree,
    type VerifiedPackageTree,
} from './package-tree';

export type PluginPackageStoreErrorCode =
    | 'invalid-plugin-id'
    | 'invalid-package-digest'
    | 'package-identity-mismatch'
    | 'stored-package-corrupt';

export class PluginPackageStoreError extends Error {
    constructor(
        readonly code: PluginPackageStoreErrorCode,
        message: string,
        readonly cause?: unknown
    ) {
        super(message);
        this.name = 'PluginPackageStoreError';
    }
}

export interface StoredPluginPackage {
    readonly status: 'installed' | 'existing';
    readonly pluginId: string;
    readonly digest: Sha256;
    readonly path: string;
    readonly verification: VerifiedPackageTree;
}

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const DIGEST_PATTERN = /^sha256-[a-f0-9]{64}$/;

function assertPluginId(pluginId: string): void {
    if (!PLUGIN_ID_PATTERN.test(pluginId) || pluginId.includes('..')) {
        throw new PluginPackageStoreError('invalid-plugin-id', `Invalid V2 plugin id: ${pluginId}`);
    }
}

function assertDigest(digest: string): asserts digest is Sha256 {
    if (!DIGEST_PATTERN.test(digest)) {
        throw new PluginPackageStoreError('invalid-package-digest', `Invalid package digest: ${digest}`);
    }
}

function isInside(root: string, candidate: string): boolean {
    return candidate.startsWith(`${root}${sep}`);
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await fs.lstat(path);
        return true;
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function chmodTreeReadOnly(root: string): Promise<void> {
    const children = await fs.readdir(root, { withFileTypes: true });
    for (const child of children) {
        const path = resolve(root, child.name);
        if (child.isDirectory()) {
            await chmodTreeReadOnly(path);
            await fs.chmod(path, 0o555);
        } else if (child.isFile()) {
            const stat = await fs.lstat(path);
            await fs.chmod(path, (stat.mode & 0o111) !== 0 ? 0o555 : 0o444);
        }
    }
    await fs.chmod(root, 0o555);
}

async function removeStagingTree(path: string): Promise<void> {
    if (!(await pathExists(path))) return;
    const rootStat = await fs.lstat(path);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        await fs.unlink(path);
        return;
    }
    const makeWritable = async (directory: string): Promise<void> => {
        await fs.chmod(directory, 0o755).catch(() => undefined);
        const children = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const child of children) {
            if (child.isDirectory()) await makeWritable(resolve(directory, child.name));
        }
    };
    await makeWritable(path);
    await fs.rm(path, { recursive: true, force: true });
}

/**
 * Owns digest-addressed package bytes only. Pointer/state/lock files are added by
 * later store layers; this class never edits or replaces a verified digest tree.
 */
export class ImmutablePluginPackageStore {
    readonly #storeRoot: string;
    readonly #mutex = new PerPluginLifecycleMutex();
    readonly #processLock: AdvisoryPluginOperationLock;

    constructor(extensionsRoot = EXTENSIONS_BASE_DIR) {
        this.#storeRoot = resolve(extensionsRoot, '.store');
        this.#processLock = new AdvisoryPluginOperationLock(extensionsRoot);
    }

    get storeRoot(): string {
        return this.#storeRoot;
    }

    packagePath(pluginId: string, digest: Sha256): string {
        assertPluginId(pluginId);
        assertDigest(digest);
        const path = resolve(this.#storeRoot, pluginId, digest);
        if (!isInside(this.#storeRoot, path)) {
            throw new PluginPackageStoreError('invalid-package-digest', 'Package path escaped the immutable store');
        }
        return path;
    }

    runPluginOperation<T>(
        pluginId: string,
        operation: () => T | PromiseLike<T>
    ): Promise<T> {
        assertPluginId(pluginId);
        return this.#mutex.runExclusive(pluginId, async () => {
            const lease = await this.#processLock.acquire(pluginId);
            try {
                return await operation();
            } finally {
                await lease.release();
            }
        });
    }

    async verifyStoredPackage(pluginId: string, digest: Sha256): Promise<VerifiedPackageTree> {
        const path = this.packagePath(pluginId, digest);
        try {
            const verification = await verifyPackageTree(path, { expectedDigest: digest });
            if (verification.manifestVersion !== 2 || verification.manifestId !== pluginId) {
                throw new PluginPackageStoreError(
                    'package-identity-mismatch',
                    `Stored package identity does not match ${pluginId}`
                );
            }
            return verification;
        } catch (error) {
            throw new PluginPackageStoreError(
                'stored-package-corrupt',
                `Stored package ${pluginId}@${digest} failed immutable verification`,
                error
            );
        }
    }

    installPackage(
        pluginId: string,
        sourceRoot: string,
        expectedDigest?: Sha256
    ): Promise<StoredPluginPackage> {
        assertPluginId(pluginId);
        if (expectedDigest) assertDigest(expectedDigest);
        return this.runPluginOperation(pluginId, async () => {
            const sourceVerification = await verifyPackageTree(sourceRoot, { expectedDigest });
            if (
                sourceVerification.manifestVersion !== 2 ||
                sourceVerification.manifestId !== pluginId
            ) {
                throw new PluginPackageStoreError(
                    'package-identity-mismatch',
                    `Package manifest identity does not match ${pluginId}`
                );
            }
            const digest = sourceVerification.digest;
            const target = this.packagePath(pluginId, digest);
            if (await pathExists(target)) {
                const verification = await this.verifyStoredPackage(pluginId, digest);
                return Object.freeze({
                    status: 'existing',
                    pluginId,
                    digest,
                    path: target,
                    verification,
                });
            }

            const pluginStore = resolve(this.#storeRoot, pluginId);
            await fs.mkdir(pluginStore, { recursive: true, mode: 0o755 });
            const staging = resolve(pluginStore, `.staging-${randomUUID()}`);
            if (basename(staging).startsWith('.staging-') === false || !isInside(pluginStore, staging)) {
                throw new PluginPackageStoreError('invalid-package-digest', 'Invalid package staging path');
            }
            try {
                await fs.cp(resolve(sourceRoot), staging, {
                    recursive: true,
                    dereference: false,
                    errorOnExist: true,
                    force: false,
                });
                await verifyPackageTree(staging, { expectedDigest: digest });
                await chmodTreeReadOnly(staging);
                await verifyPackageTree(staging, { expectedDigest: digest });
                try {
                    await fs.rename(staging, target);
                } catch (error) {
                    const code = error && typeof error === 'object' && 'code' in error
                        ? (error as { code?: string }).code
                        : undefined;
                    if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error;
                    await removeStagingTree(staging);
                    const verification = await this.verifyStoredPackage(pluginId, digest);
                    return Object.freeze({
                        status: 'existing',
                        pluginId,
                        digest,
                        path: target,
                        verification,
                    });
                }
                return Object.freeze({
                    status: 'installed',
                    pluginId,
                    digest,
                    path: target,
                    verification: await this.verifyStoredPackage(pluginId, digest),
                });
            } catch (error) {
                await removeStagingTree(staging).catch(() => undefined);
                throw error;
            }
        });
    }
}

export function isPackageTreeValidationFailure(error: unknown): error is PackageTreeValidationError {
    return error instanceof PackageTreeValidationError;
}
