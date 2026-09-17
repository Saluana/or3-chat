import { resolve } from 'node:path';
import { assertPackageRoot, materializePackTree } from './shared';
import { packV2Package, type PackCommandResult } from './pack';

export interface BuildCommandResult {
    readonly sourceRoot: string;
    readonly buildRoot: string;
    readonly files: readonly string[];
    readonly pack: PackCommandResult;
}

/**
 * Materialize a deterministic build tree, then pack it.
 * Two builds of an unchanged package must share the same canonical digest.
 */
export async function buildV2Package(
    packageRoot: string,
    options: {
        readonly buildDirectory?: string;
        readonly packDirectory?: string;
    } = {}
): Promise<BuildCommandResult> {
    const sourceRoot = assertPackageRoot(packageRoot);
    const buildRoot = resolve(options.buildDirectory ?? resolve(sourceRoot, 'dist'));
    const files = materializePackTree(sourceRoot, buildRoot);
    const pack = await packV2Package(buildRoot, {
        outputDirectory: options.packDirectory ?? resolve(sourceRoot, '.or3-pack'),
    });
    return {
        sourceRoot,
        buildRoot,
        files: Object.freeze(files.slice().sort()),
        pack,
    };
}
