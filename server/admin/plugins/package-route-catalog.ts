import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import {
    Or3ExtensionManifestV2Schema,
    type Or3ExtensionManifestV2,
} from '../extensions/types';
import { ImmutablePluginPackageStore } from './package-store';
import { PluginPackagePointerStore } from './package-pointer-store';

export type PackageRuntimeRouteDef = {
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly path: string;
    readonly handler: string;
    readonly permission?: string;
};

export type PackageManifestRead =
    | {
          readonly status: 'ready';
          readonly pluginId: string;
          readonly packageDigest: Sha256;
          readonly packagePath: string;
          readonly manifest: Or3ExtensionManifestV2;
      }
    | { readonly status: 'inactive'; readonly pluginId: string }
    | {
          readonly status: 'blocked';
          readonly pluginId: string;
          readonly blockCode: 'package-manifest-invalid';
      };

export type SelectedPackageRouteCatalog =
    | {
          readonly status: 'ready';
          readonly pluginId: string;
          readonly packageDigest: Sha256;
          readonly packagePath: string;
          readonly manifest: Or3ExtensionManifestV2;
          readonly routes: readonly PackageRuntimeRouteDef[];
      }
    | {
          readonly status: 'inactive';
          readonly pluginId: string;
      }
    | {
          readonly status: 'blocked';
          readonly pluginId: string;
          readonly blockCode: 'package-pointer-unavailable' | 'package-manifest-invalid';
      };

/**
 * Reads server routes for the startup-selected immutable package version.
 * Does not authorize the caller; access checks remain in the dispatcher.
 */
export class PluginPackageRouteCatalog {
    private readonly packages: ImmutablePluginPackageStore;
    private readonly pointers: PluginPackagePointerStore;

    constructor(
        packages: ImmutablePluginPackageStore = new ImmutablePluginPackageStore(),
        pointers?: PluginPackagePointerStore
    ) {
        this.packages = packages;
        this.pointers = pointers ?? new PluginPackagePointerStore(undefined, packages);
    }

    /**
     * Read the manifest of one stored package by digest. Used for display (the
     * version a pointer slot actually holds) as well as routing.
     */
    async readManifest(pluginId: string, packageDigest: Sha256): Promise<PackageManifestRead> {
        try {
            const packageRoot = this.packages.packagePath(pluginId, packageDigest);
            const raw = JSON.parse(
                await fs.readFile(resolve(packageRoot, 'or3.manifest.json'), 'utf8')
            ) as unknown;
            const parsed = Or3ExtensionManifestV2Schema.safeParse(raw);
            if (!parsed.success) {
                return Object.freeze({
                    status: 'blocked',
                    pluginId,
                    blockCode: 'package-manifest-invalid',
                });
            }
            return Object.freeze({
                status: 'ready',
                pluginId,
                packageDigest,
                packagePath: packageRoot,
                manifest: parsed.data,
            });
        } catch {
            return Object.freeze({
                status: 'blocked',
                pluginId,
                blockCode: 'package-manifest-invalid',
            });
        }
    }

    async readSelected(pluginId: string): Promise<SelectedPackageRouteCatalog> {
        let selection: Awaited<ReturnType<PluginPackagePointerStore['readStartupSelection']>>;
        try {
            selection = await this.pointers.readStartupSelection(pluginId);
        } catch {
            return Object.freeze({
                status: 'blocked',
                pluginId,
                blockCode: 'package-pointer-unavailable',
            });
        }
        if (selection.status === 'blocked') {
            return Object.freeze({
                status: 'blocked',
                pluginId,
                blockCode: 'package-pointer-unavailable',
            });
        }
        if (!selection.selected) {
            return Object.freeze({ status: 'inactive', pluginId });
        }
        const read = await this.readManifest(pluginId, selection.selected.packageDigest);
        if (read.status !== 'ready') {
            return Object.freeze({
                status: 'blocked',
                pluginId,
                blockCode: 'package-manifest-invalid',
            });
        }
        const routes = (read.manifest.runtime.server?.routes ?? []).map((route) =>
            Object.freeze({
                method: route.method,
                path: route.path,
                handler: route.handler,
                ...(route.permission ? { permission: route.permission } : {}),
            })
        );
        return Object.freeze({
            status: 'ready',
            pluginId,
            packageDigest: selection.selected.packageDigest,
            packagePath: this.packages.packagePath(pluginId, selection.selected.packageDigest),
            manifest: read.manifest,
            routes: Object.freeze(routes),
        });
    }

    async listSelected(): Promise<readonly SelectedPackageRouteCatalog[]> {
        const pluginIds = await this.pointers.listPluginIds();
        return Object.freeze(
            await Promise.all(pluginIds.map((pluginId) => this.readSelected(pluginId)))
        );
    }
}
