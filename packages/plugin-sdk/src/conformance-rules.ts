/**
 * Static-authoring rule constants shared by the OR3 host conformance checker and
 * the `or3-plugin` SDK CLI. Keeping one definition prevents the reviewer and the
 * authoring tools from drifting. This module is intentionally dependency-free so
 * it can be bundled into the standalone CLI without pulling host code.
 */

/** Path prefixes that only exist inside the OR3 application checkout. */
export const PRIVATE_IMPORT_PREFIXES = [
    '~/',
    '~~/',
    '@/',
    '@@/',
    '#imports',
    '#app',
    '#build',
    '#internal',
] as const;

/** Bare specifiers a V2 package is allowed to import at runtime. */
export const ALLOWED_BARE_IMPORTS = new Set([
    '@or3/plugin-sdk',
    '@or3/plugin-sdk/manifest',
    'vue',
]);

/**
 * Nuxt auto-imports that exist only in the OR3 app build. The host checker adds
 * compatibility-ledger names to this base set.
 */
export const CORE_NUXT_AUTO_IMPORTS = new Set([
    '$fetch',
    'computed',
    'defineNuxtComponent',
    'defineNuxtPlugin',
    'navigateTo',
    'onMounted',
    'onUnmounted',
    'reactive',
    'ref',
    'useAsyncData',
    'useCookie',
    'useFetch',
    'useNuxtApp',
    'useRoute',
    'useRouter',
    'useRuntimeConfig',
    'useState',
    'watch',
    'watchEffect',
]);
