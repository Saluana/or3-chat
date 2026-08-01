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

export type SelectedPackageRouteCatalog =
    | {
          readonly status: 'ready';
          readonly pluginId: string;
          readonly packageDigest: Sha256;
          readonly manifest: Or3ExtensionManifestV2;
          readonly routes: readonly PackageRuntimeRouteDef[];
      }
    | {
          readonly status: 'inactive';
          readonly pluginId: string;
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

    async readSelected(pluginId: string): Promise<SelectedPackageRouteCatalog> {
        const selection = await this.pointers.readStartupSelection(pluginId);
        if (!selection.selected) {
            return Object.freeze({ status: 'inactive', pluginId });
        }
        const packageRoot = this.packages.packagePath(
            pluginId,
            selection.selected.packageDigest
        );
        const raw = JSON.parse(
            await fs.readFile(resolve(packageRoot, 'or3.manifest.json'), 'utf8')
        ) as unknown;
        const parsed = Or3ExtensionManifestV2Schema.safeParse(raw);
        if (!parsed.success) {
            return Object.freeze({ status: 'inactive', pluginId });
        }
        const routes = (parsed.data.runtime.server?.routes ?? []).map((route) =>
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
            manifest: parsed.data,
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
