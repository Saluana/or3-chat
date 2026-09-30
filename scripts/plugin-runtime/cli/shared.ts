import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Host CLI helpers are re-exported from the published `or3-plugin` SDK CLI so
 * there is a single implementation of the package-tree materialization and JSON
 * conventions. Only the repo-root lookup stays host-specific.
 */
export {
    PACK_IGNORE_NAMES,
    assertPackageRoot,
    ensureDir,
    isShippablePackageFile,
    listArtifactFiles,
    listPackageFiles,
    materializePackTree,
    packageRootFromCli,
    posix,
    printJson,
    readJsonObject,
    sdkTemplateRoot,
    writeStableJson,
} from '../../../packages/plugin-sdk/src/cli/shared';

export const CLI_NAME = 'plugin-runtime:cli';

export function repoRootFromCli(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}
