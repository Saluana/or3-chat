/**
 * The published surface of @or3/plugin-sdk, in one place.
 *
 * `SUBPATH_ENTRIES` is what `prepack` rewrites into `exports` (dist JS +
 * declarations), and `BUILD_ENTRIES` is what the JavaScript build compiles. A
 * subpath that is not built would resolve to a file that does not exist, so the
 * two lists must agree; `tests/unit/plugin-sdk-publish-surface.test.ts` enforces
 * that.
 */

export const SUBPATH_ENTRIES = {
    '.': 'index',
    './manifest': 'manifest',
    './host': 'host',
    './testing': 'testing',
    './package-tree': 'package-tree',
    './profile': 'profile',
    './state-compatibility': 'state-compatibility',
    './package-archive': 'cli/archive',
    './ui': 'ui',
    './portable': 'portable',
    './portable-runtime': 'portable-runtime',
};

export const BUILD_ENTRIES = [
    'src/index.ts',
    'src/manifest.ts',
    'src/host.ts',
    'src/testing.ts',
    'src/ui.ts',
    'src/portable.ts',
    'src/portable-runtime.ts',
    'src/profile.ts',
    'src/package-tree.ts',
    'src/state-compatibility.ts',
    'src/cli/index.ts',
    'src/cli/archive.ts',
];
