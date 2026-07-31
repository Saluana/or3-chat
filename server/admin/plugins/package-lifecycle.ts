import { promises as fs, type Dirent } from 'node:fs';
import { resolve } from 'node:path';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import type { WorkspaceSettingsStore } from '../stores/types';
import { ImmutablePluginPackageStore } from './package-store';
import {
    PluginPackagePointerStore,
    type PluginPackagePointer,
} from './package-pointer-store';
import {
    getEnabledPlugins,
    getPluginSettings,
    setPluginEnabled,
} from './workspace-plugin-store';

export type PackageUninstallRetentionReport = {
    readonly pluginId: string;
    readonly disabled: true;
    readonly retainedPackageDigests: readonly Sha256[];
    readonly retainedSettings: true;
    readonly retainedStateVersionKey: true;
    readonly dataDeleted: false;
};

export type PackageDataDeletionResult = {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly settingsDeleted: true;
    readonly stateVersionDeleted: true;
    readonly packagesRetained: readonly Sha256[];
};

export type PackageGarbageCollectionResult = {
    readonly pluginId: string;
    readonly deletedDigests: readonly Sha256[];
    readonly retainedDigests: readonly Sha256[];
};

/**
 * Separates disable, package uninstall, version GC, and data deletion.
 * Disable never deletes packages or settings.
 */
export class PluginPackageLifecycleService {
    constructor(
        readonly packages: ImmutablePluginPackageStore,
        readonly pointers: PluginPackagePointerStore,
        private readonly settings: WorkspaceSettingsStore
    ) {}

    /** Disable retains all packages and host-managed settings/data. */
    async disable(workspaceId: string, pluginId: string): Promise<string[]> {
        return setPluginEnabled(this.settings, workspaceId, pluginId, false);
    }

    async reportUninstallRetention(
        workspaceId: string,
        pluginId: string
    ): Promise<PackageUninstallRetentionReport> {
        await this.disable(workspaceId, pluginId);
        const pointer = await this.pointers.readPointer(pluginId);
        const digests = collectPointerDigests(pointer);
        // Touch settings so callers know the namespace still exists.
        await getPluginSettings(this.settings, workspaceId, pluginId);
        return Object.freeze({
            pluginId,
            disabled: true,
            retainedPackageDigests: Object.freeze(digests),
            retainedSettings: true,
            retainedStateVersionKey: true,
            dataDeleted: false,
        });
    }

    /**
     * Removes package selection (pointer) but retains immutable trees and data
     * until a distinct confirmed data/GC call.
     */
    async uninstallPackage(pluginId: string): Promise<{
        readonly pluginId: string;
        readonly pointerCleared: true;
        readonly retainedPackageDigests: readonly Sha256[];
    }> {
        return this.packages.runPluginOperation(pluginId, async () => {
            const pointer = await this.pointers.readPointer(pluginId);
            const digests = collectPointerDigests(pointer);
            const cleared: PluginPackagePointer = {
                schemaVersion: 1,
                pluginId,
                revision: (pointer?.revision ?? 0) + 1,
                current: null,
                candidate: null,
                previous: null,
            };
            if (pointer) {
                await this.pointers.writePointerWithinOperation(pluginId, cleared);
            }
            return Object.freeze({
                pluginId,
                pointerCleared: true,
                retainedPackageDigests: Object.freeze(digests),
            });
        });
    }

    /**
     * Deletes host-managed plugin settings/state for one workspace.
     * Requires an explicit confirmation token matching the plugin id.
     */
    async deletePluginData(input: {
        readonly workspaceId: string;
        readonly pluginId: string;
        readonly confirmPluginId: string;
    }): Promise<PackageDataDeletionResult> {
        if (input.confirmPluginId !== input.pluginId) {
            throw new Error('Plugin data deletion requires an exact confirmPluginId match');
        }
        const enabled = await getEnabledPlugins(this.settings, input.workspaceId);
        if (enabled.includes(input.pluginId)) {
            throw new Error('Disable the plugin before deleting its data');
        }
        const pointer = await this.pointers.readPointer(input.pluginId);
        // Settings store is set/get only; empty values are the confirmed deletion tombstone.
        await this.settings.set(
            input.workspaceId,
            `plugins.settings.${input.pluginId}`,
            JSON.stringify({})
        );
        await this.settings.set(
            input.workspaceId,
            `plugins.stateVersion.${input.pluginId}`,
            ''
        );
        return Object.freeze({
            pluginId: input.pluginId,
            workspaceId: input.workspaceId,
            settingsDeleted: true,
            stateVersionDeleted: true,
            packagesRetained: Object.freeze(collectPointerDigests(pointer)),
        });
    }

    /**
     * Deletes immutable package trees that are not referenced by the pointer.
     * Never deletes the selected current/candidate/previous digests.
     */
    async garbageCollectUnreferencedVersions(
        pluginId: string
    ): Promise<PackageGarbageCollectionResult> {
        return this.packages.runPluginOperation(pluginId, async () => {
            const pointer = await this.pointers.readPointer(pluginId);
            const retained = new Set(collectPointerDigests(pointer));
            const pluginStore = resolve(this.packages.storeRoot, pluginId);
            let entries: string[] = [];
            try {
                entries = await fs.readdir(pluginStore);
            } catch (error) {
                const code =
                    error && typeof error === 'object' && 'code' in error
                        ? (error as { code?: string }).code
                        : undefined;
                if (code === 'ENOENT') {
                    return Object.freeze({
                        pluginId,
                        deletedDigests: Object.freeze([]),
                        retainedDigests: Object.freeze([...retained] as Sha256[]),
                    });
                }
                throw error;
            }

            const deleted: Sha256[] = [];
            for (const entry of entries) {
                if (!entry.startsWith('sha256-') || retained.has(entry as Sha256)) continue;
                const path = this.packages.packagePath(pluginId, entry as Sha256);
                await makeTreeWritable(path);
                await fs.rm(path, { recursive: true, force: true });
                deleted.push(entry as Sha256);
            }
            return Object.freeze({
                pluginId,
                deletedDigests: Object.freeze(deleted),
                retainedDigests: Object.freeze([...retained] as Sha256[]),
            });
        });
    }
}

function collectPointerDigests(pointer: PluginPackagePointer | null): Sha256[] {
    if (!pointer) return [];
    const digests = new Set<Sha256>();
    for (const slot of ['current', 'candidate', 'previous'] as const) {
        const target = pointer[slot];
        if (target) digests.add(target.packageDigest);
    }
    return [...digests].sort();
}

async function makeTreeWritable(root: string): Promise<void> {
    await fs.chmod(root, 0o755).catch(() => undefined);
    let children: Dirent[] = [];
    try {
        children = await fs.readdir(root, { withFileTypes: true });
    } catch {
        return;
    }
    for (const child of children) {
        const path = resolve(root, child.name);
        if (child.isDirectory()) await makeTreeWritable(path);
        else await fs.chmod(path, 0o644).catch(() => undefined);
    }
}
