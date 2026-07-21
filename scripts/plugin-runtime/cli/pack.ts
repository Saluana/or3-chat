import { resolve } from 'node:path';
import {
    verifyPackageTree,
    type VerifiedPackageTree,
} from '../../../server/admin/plugins/package-tree';
import { assertPackageRoot, materializePackTree } from './shared';

export interface PackCommandResult {
    readonly sourceRoot: string;
    readonly packRoot: string;
    readonly files: readonly string[];
    readonly verification: VerifiedPackageTree;
}

export async function packV2Package(
    packageRoot: string,
    options: { readonly outputDirectory?: string } = {}
): Promise<PackCommandResult> {
    const sourceRoot = assertPackageRoot(packageRoot);
    const packRoot = resolve(options.outputDirectory ?? resolve(sourceRoot, '.or3-pack'));
    // Exclude nested prior outputs so repeated packs of the same source stay stable.
    const files = materializePackTree(sourceRoot, packRoot);
    const verification = await verifyPackageTree(packRoot);
    return {
        sourceRoot,
        packRoot,
        files: Object.freeze(files.slice().sort()),
        verification,
    };
}
