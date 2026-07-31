import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import type { PluginStateCompatibilityPolicy } from '../../../shared/plugins/state-compatibility';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import { EXTENSIONS_BASE_DIR } from '../extensions/paths';
import {
    ImmutablePluginPackageStore,
    PluginPackageStoreError,
} from './package-store';

export type PackagePointerSlot = 'current' | 'candidate' | 'previous';
export type PackagePointerWriteStep =
    | 'before-temp-write'
    | 'after-temp-write'
    | 'after-temp-fsync'
    | 'after-rename'
    | 'after-directory-fsync';

export interface PluginPackagePointerTarget {
    readonly packageDigest: Sha256;
    readonly manifestDigest: Sha256;
    readonly recordedAt: number;
    readonly stateCompatibility: PluginStateCompatibilityPolicy;
}

export interface PluginPackagePointer {
    readonly schemaVersion: 1;
    readonly pluginId: string;
    readonly revision: number;
    readonly current: PluginPackagePointerTarget | null;
    readonly candidate: PluginPackagePointerTarget | null;
    readonly previous: PluginPackagePointerTarget | null;
}

export interface PackagePointerWriteOptions {
    readonly fault?: (step: PackagePointerWriteStep) => void | Promise<void>;
}

export type PackagePointerStartupIssueCode =
    | 'pointer-missing'
    | 'pointer-invalid'
    | 'current-unavailable'
    | 'candidate-unavailable'
    | 'previous-unavailable';

export interface PackagePointerStartupSelection {
    readonly status: 'ready' | 'inactive' | 'recovered' | 'blocked';
    readonly pluginId: string;
    readonly pointer: PluginPackagePointer | null;
    readonly selectedSlot: 'current' | 'previous' | null;
    readonly selected: PluginPackagePointerTarget | null;
    readonly issues: readonly {
        readonly code: PackagePointerStartupIssueCode;
        readonly message: string;
    }[];
}

export class PackagePointerStoreError extends Error {
    constructor(
        readonly code: 'invalid-plugin-id' | 'pointer-invalid' | 'package-unavailable',
        message: string,
        override readonly cause?: unknown
    ) {
        super(message);
        this.name = 'PackagePointerStoreError';
    }
}

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const DIGEST_PATTERN = /^sha256-[a-f0-9]{64}$/;
const POINTER_KEYS = ['schemaVersion', 'pluginId', 'revision', 'current', 'candidate', 'previous'];
const TARGET_KEYS = ['packageDigest', 'manifestDigest', 'recordedAt', 'stateCompatibility'];
const STATE_KEYS = ['version', 'reads', 'rollback'];
const READS_KEYS = ['minimum', 'maximum'];

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
    const keys = Object.keys(record).sort();
    return keys.length === expected.length && [...expected].sort().every((key, index) => keys[index] === key);
}

function validPluginId(pluginId: string): boolean {
    return PLUGIN_ID_PATTERN.test(pluginId) && !pluginId.includes('..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseStateCompatibility(value: unknown): PluginStateCompatibilityPolicy | null {
    if (!isRecord(value) || !exactKeys(value, STATE_KEYS) || !isRecord(value.reads)) return null;
    if (!exactKeys(value.reads, READS_KEYS)) return null;
    const rollback = value.rollback;
    if (rollback !== 'safe' && rollback !== 'migration-required' && rollback !== 'unsupported') return null;
    const version = value.version;
    const minimum = value.reads.minimum;
    const maximum = value.reads.maximum;
    if (
        !Number.isSafeInteger(version) ||
        !Number.isSafeInteger(minimum) ||
        !Number.isSafeInteger(maximum) ||
        (version as number) < 0 ||
        (minimum as number) < 0 ||
        (maximum as number) < (minimum as number)
    ) return null;
    return Object.freeze({
        version: version as number,
        reads: Object.freeze({ minimum: minimum as number, maximum: maximum as number }),
        rollback,
    });
}

function parseTarget(value: unknown): PluginPackagePointerTarget | null {
    if (!isRecord(value) || !exactKeys(value, TARGET_KEYS)) return null;
    if (
        typeof value.packageDigest !== 'string' ||
        !DIGEST_PATTERN.test(value.packageDigest) ||
        typeof value.manifestDigest !== 'string' ||
        !DIGEST_PATTERN.test(value.manifestDigest) ||
        !Number.isSafeInteger(value.recordedAt) ||
        (value.recordedAt as number) < 0
    ) return null;
    const stateCompatibility = parseStateCompatibility(value.stateCompatibility);
    if (!stateCompatibility) return null;
    return Object.freeze({
        packageDigest: value.packageDigest as Sha256,
        manifestDigest: value.manifestDigest as Sha256,
        recordedAt: value.recordedAt as number,
        stateCompatibility,
    });
}

export function parsePluginPackagePointer(value: unknown): PluginPackagePointer | null {
    if (!isRecord(value) || !exactKeys(value, POINTER_KEYS)) return null;
    if (
        value.schemaVersion !== 1 ||
        typeof value.pluginId !== 'string' ||
        !validPluginId(value.pluginId) ||
        !Number.isSafeInteger(value.revision) ||
        (value.revision as number) < 1
    ) return null;
    const slots = ['current', 'candidate', 'previous'] as const;
    const targets = Object.fromEntries(slots.map((slot) => [
        slot,
        value[slot] === null ? null : parseTarget(value[slot]),
    ])) as Record<PackagePointerSlot, PluginPackagePointerTarget | null>;
    if (slots.some((slot) => value[slot] !== null && !targets[slot])) return null;
    const digests = slots.flatMap((slot) => targets[slot]?.packageDigest ?? []);
    if (new Set(digests).size !== digests.length) return null;
    return Object.freeze({
        schemaVersion: 1,
        pluginId: value.pluginId,
        revision: value.revision as number,
        current: targets.current,
        candidate: targets.candidate,
        previous: targets.previous,
    });
}

function issue(code: PackagePointerStartupIssueCode, message: string) {
    return Object.freeze({ code, message });
}

async function fsyncDirectory(directory: string): Promise<void> {
    const handle = await fs.open(directory, constants.O_RDONLY);
    try {
        await handle.sync();
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
            ? (error as { code?: string }).code
            : undefined;
        if (code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
    } finally {
        await handle.close();
    }
}

export class PluginPackagePointerStore {
    readonly #activeRoot: string;
    readonly #packages: ImmutablePluginPackageStore;

    constructor(
        extensionsRoot = EXTENSIONS_BASE_DIR,
        packages = new ImmutablePluginPackageStore(extensionsRoot)
    ) {
        this.#activeRoot = resolve(extensionsRoot, '.active');
        this.#packages = packages;
    }

    pointerPath(pluginId: string): string {
        if (!validPluginId(pluginId)) {
            throw new PackagePointerStoreError('invalid-plugin-id', `Invalid V2 plugin id: ${pluginId}`);
        }
        return resolve(this.#activeRoot, `${pluginId}.json`);
    }

    async readPointer(pluginId: string): Promise<PluginPackagePointer | null> {
        return this.#readPersistedPointer(pluginId);
    }

    async #readPersistedPointer(pluginId: string): Promise<PluginPackagePointer | null> {
        const path = this.pointerPath(pluginId);
        let handle;
        try {
            handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > 64 * 1024) {
                throw new PackagePointerStoreError('pointer-invalid', 'Persisted package pointer is invalid');
            }
            const pointer = parsePluginPackagePointer(JSON.parse(await handle.readFile('utf8')) as unknown);
            if (!pointer || pointer.pluginId !== pluginId) {
                throw new PackagePointerStoreError('pointer-invalid', 'Persisted package pointer is invalid');
            }
            return pointer;
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error
                ? (error as { code?: string }).code
                : undefined;
            if (code === 'ENOENT') return null;
            if (error instanceof PackagePointerStoreError) throw error;
            throw new PackagePointerStoreError('pointer-invalid', 'Persisted package pointer is unreadable', error);
        } finally {
            await handle?.close();
        }
    }

    async #validatePackages(pointer: PluginPackagePointer): Promise<void> {
        for (const slot of ['current', 'candidate', 'previous'] as const) {
            const target = pointer[slot];
            if (!target) continue;
            let verification;
            try {
                verification = await this.#packages.verifyStoredPackage(pointer.pluginId, target.packageDigest);
            } catch (error) {
                throw new PackagePointerStoreError(
                    'package-unavailable',
                    `${slot} package is unavailable for ${pointer.pluginId}`,
                    error
                );
            }
            if (verification.manifestDigest !== target.manifestDigest) {
                throw new PackagePointerStoreError(
                    'package-unavailable',
                    `${slot} manifest digest does not match its immutable package`
                );
            }
        }
    }

    async writePointer(
        pluginId: string,
        input: PluginPackagePointer,
        options: PackagePointerWriteOptions = {}
    ): Promise<void> {
        const pointer = parsePluginPackagePointer(input);
        if (!pointer || pointer.pluginId !== pluginId) {
            throw new PackagePointerStoreError('pointer-invalid', `Invalid package pointer for ${pluginId}`);
        }
        await this.#packages.runPluginOperation(pluginId, () =>
            this.writePointerWithinOperation(pluginId, pointer, options)
        );
    }

    /** Caller must already hold this package store instance's per-plugin operation lease. */
    async writePointerWithinOperation(
        pluginId: string,
        input: PluginPackagePointer,
        options: PackagePointerWriteOptions = {}
    ): Promise<void> {
        const pointer = parsePluginPackagePointer(input);
        if (!pointer || pointer.pluginId !== pluginId) {
            throw new PackagePointerStoreError('pointer-invalid', `Invalid package pointer for ${pluginId}`);
        }
        await fs.mkdir(this.#activeRoot, { recursive: true, mode: 0o700 });
        const persisted = await this.#readPersistedPointer(pluginId);
        const expectedRevision = (persisted?.revision ?? 0) + 1;
        if (pointer.revision !== expectedRevision) {
            throw new PackagePointerStoreError(
                'pointer-invalid',
                `Package pointer revision ${pointer.revision} must follow ${persisted?.revision ?? 0}`
            );
        }
        await this.#validatePackages(pointer);
        const targetPath = this.pointerPath(pluginId);
        const temporaryPath = resolve(this.#activeRoot, `.${pluginId}.${randomUUID()}.tmp`);
        const source = `${JSON.stringify(pointer)}\n`;
        await options.fault?.('before-temp-write');
        const handle = await fs.open(temporaryPath, 'wx', 0o600);
        try {
            await handle.writeFile(source, 'utf8');
            await options.fault?.('after-temp-write');
            await handle.sync();
            await options.fault?.('after-temp-fsync');
        } finally {
            await handle.close();
        }
        await fs.rename(temporaryPath, targetPath);
        await options.fault?.('after-rename');
        await fsyncDirectory(this.#activeRoot);
        await options.fault?.('after-directory-fsync');
    }

    async readStartupSelection(pluginId: string): Promise<PackagePointerStartupSelection> {
        const pointerPath = this.pointerPath(pluginId);
        let raw: unknown;
        try {
            const handle = await fs.open(pointerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const stat = await handle.stat();
                if (!stat.isFile() || stat.size > 64 * 1024) throw new Error('invalid pointer file');
                raw = JSON.parse(await handle.readFile('utf8')) as unknown;
            } finally {
                await handle.close();
            }
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error
                ? (error as { code?: string }).code
                : undefined;
            if (code === 'ENOENT') {
                return Object.freeze({
                    status: 'inactive',
                    pluginId,
                    pointer: null,
                    selectedSlot: null,
                    selected: null,
                    issues: Object.freeze([issue('pointer-missing', 'No active package pointer exists')]),
                });
            }
            return Object.freeze({
                status: 'blocked',
                pluginId,
                pointer: null,
                selectedSlot: null,
                selected: null,
                issues: Object.freeze([issue('pointer-invalid', 'Package pointer is unreadable or invalid')]),
            });
        }
        const pointer = parsePluginPackagePointer(raw);
        if (!pointer || pointer.pluginId !== pluginId) {
            return Object.freeze({
                status: 'blocked',
                pluginId,
                pointer: null,
                selectedSlot: null,
                selected: null,
                issues: Object.freeze([issue('pointer-invalid', 'Package pointer schema or identity is invalid')]),
            });
        }

        const issues: Array<PackagePointerStartupSelection['issues'][number]> = [];
        const availability = new Map<PackagePointerSlot, boolean>();
        for (const slot of ['current', 'candidate', 'previous'] as const) {
            const target = pointer[slot];
            if (!target) continue;
            try {
                const verification = await this.#packages.verifyStoredPackage(pluginId, target.packageDigest);
                const available = verification.manifestDigest === target.manifestDigest;
                availability.set(slot, available);
                if (!available) issues.push(issue(`${slot}-unavailable`, `${slot} manifest identity is unavailable`));
            } catch (error) {
                if (!(error instanceof PluginPackageStoreError)) throw error;
                availability.set(slot, false);
                issues.push(issue(`${slot}-unavailable`, `${slot} immutable package is unavailable`));
            }
        }
        if (pointer.current && availability.get('current')) {
            return Object.freeze({
                status: 'ready',
                pluginId,
                pointer,
                selectedSlot: 'current',
                selected: pointer.current,
                issues: Object.freeze(issues),
            });
        }
        if (pointer.current && pointer.previous && availability.get('previous')) {
            return Object.freeze({
                status: 'recovered',
                pluginId,
                pointer,
                selectedSlot: 'previous',
                selected: pointer.previous,
                issues: Object.freeze(issues),
            });
        }
        return Object.freeze({
            status: pointer.current ? 'blocked' : 'inactive',
            pluginId,
            pointer,
            selectedSlot: null,
            selected: null,
            issues: Object.freeze(issues),
        });
    }
}
