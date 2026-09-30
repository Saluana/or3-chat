import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';
import { ImmutablePluginPackageStore } from './package-store';
import { readPackageManifest } from './package-operation-support';
import { POLICY_DESCRIPTOR_FILE, SETUP_DESCRIPTOR_FILE } from '../../utils/plugins/setup/load-descriptors';

async function descriptorAbsent(path: string): Promise<boolean> {
    try { await stat(path); return false; }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
        throw error;
    }
}

/** Trusted host packages may declare all authority in the manifest and need no setup form. */
export async function packageNeedsNoSetup(packages: ImmutablePluginPackageStore, pluginId: string, digest: Sha256): Promise<boolean> {
    const packagePath = packages.packagePath(pluginId, digest);
    const manifest = await readPackageManifest(packagePath);
    return manifest.trust === 'trusted-host' &&
        await descriptorAbsent(join(packagePath, POLICY_DESCRIPTOR_FILE)) &&
        await descriptorAbsent(join(packagePath, SETUP_DESCRIPTOR_FILE));
}
