import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    verifyPackageTree,
    type VerifiedPackageTree,
} from '../package-tree';
import { writeDeterministicPackageZip } from './archive';
import {
    assertPackageRoot,
    ensureDir,
    isWithinPath,
    materializePackTree,
} from './shared';

export interface PackCommandResult {
    readonly sourceRoot: string;
    readonly packRoot: string;
    readonly files: readonly string[];
    readonly verification: VerifiedPackageTree;
    /** Absolute path of the deterministic ZIP transport, or null for directory output. */
    readonly archivePath: string | null;
}

export async function packV2Package(
    packageRoot: string,
    options: { readonly outputDirectory?: string; readonly archivePath?: string } = {}
): Promise<PackCommandResult> {
    const sourceRoot = assertPackageRoot(packageRoot);
    const packRoot = resolve(options.outputDirectory ?? resolve(sourceRoot, '.or3-pack'));
    const archivePath = options.archivePath ? resolve(options.archivePath) : null;
    if (archivePath && isWithinPath(packRoot, archivePath)) {
        throw new Error(
            `Archive destination "${archivePath}" is inside the pack tree "${packRoot}". ` +
                `Choose an archive path outside the pack directory (for example next to the ` +
                `package root or in a temp directory); writing into the verified pack tree ` +
                `would corrupt the sealed package.`
        );
    }
    // Exclude the destination archive so repeated packs of the same source stay
    // stable: without this, the second run would repack the first archive.
    const files = materializePackTree(sourceRoot, packRoot, {
        excludePaths: archivePath ? [archivePath] : [],
    });
    const verification = await verifyPackageTree(packRoot);
    if (archivePath) {
        ensureDir(dirname(archivePath));
        writeFileSync(archivePath, await writeDeterministicPackageZip(packRoot));
    }
    return {
        sourceRoot,
        packRoot,
        files: Object.freeze(files.slice().sort()),
        verification,
        archivePath,
    };
}
