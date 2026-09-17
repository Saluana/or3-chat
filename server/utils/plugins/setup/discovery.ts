/**
 * @module server/utils/plugins/setup/discovery
 *
 * Purpose:
 * Find the package a plugin id currently resolves to. A plugin may be a legacy
 * extension directory or an immutable V2 package recorded in the package pointer
 * store (including a candidate that is waiting for setup), and the setup page,
 * the setup save endpoint and the acquisition pipeline must all agree on which
 * one that is.
 *
 * Behavior:
 * - A recorded candidate is preferred (it is the version being installed or
 *   upgraded to), then the selected version, then a legacy extension directory.
 * - A missing or unreadable package resolves to `null` rather than a guess.
 *
 * Constraints:
 * - No network and no plugin code.
 */

import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { ImmutablePluginPackageStore } from '../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../admin/plugins/package-pointer-store';

export interface ResolvedPluginPackage {
    readonly pluginId: string;
    readonly path: string;
    readonly source: 'package' | 'extension';
    readonly digest: string | null;
}

export async function resolvePluginPackage(
    pluginId: string,
    extensionsRoot = EXTENSIONS_BASE_DIR
): Promise<ResolvedPluginPackage | null> {
    const packages = new ImmutablePluginPackageStore(extensionsRoot);
    const pointers = new PluginPackagePointerStore(extensionsRoot, packages);
    try {
        const selection = await pointers.readStartupSelection(pluginId);
        const target = selection.pointer?.candidate ?? selection.pointer?.current ?? null;
        if (target) {
            return {
                pluginId,
                path: packages.packagePath(pluginId, target.packageDigest),
                source: 'package',
                digest: target.packageDigest,
            };
        }
    } catch {
        // A pointer that cannot be read falls through to the legacy lookup.
    }
    const installed = (await listInstalledExtensions()).find(
        (extension) => extension.kind === 'plugin' && extension.id === pluginId
    );
    if (!installed) return null;
    return { pluginId, path: installed.path, source: 'extension', digest: null };
}
