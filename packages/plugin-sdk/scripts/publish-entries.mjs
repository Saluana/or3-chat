/**
 * The published surface of @or3/plugin-sdk, in one place.
 *
 * `SUBPATH_ENTRIES` is what `prepack` rewrites into `exports` (dist JS +
 * declarations). The JavaScript build entries derive from those same subpaths,
 * plus the CLI entry, so every exported module is compiled.
 */

export const SUBPATH_ENTRIES = {
    '.': 'index',
    './manifest': 'manifest',
    './host': 'host',
    './testing': 'testing',
    './cards': 'cards',
    './cards/vue': 'cards-vue',
    './cards/react': 'cards-react',
    './package-tree': 'package-tree',
    './plugin-icon': 'plugin-icon',
    './profile': 'profile',
    './state-compatibility': 'state-compatibility',
    './package-archive': 'cli/archive',
    './candidate': 'candidate',
    './ui': 'ui',
    './portable': 'portable',
    './portable-runtime': 'portable-runtime',
};

export const BUILD_ENTRIES = [
    ...Object.values(SUBPATH_ENTRIES).map((entry) => `src/${entry}.ts`),
    'src/cli/index.ts',
];
