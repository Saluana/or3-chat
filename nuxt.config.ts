// https://nuxt.com/docs/api/configuration/nuxt-config
import { themeCompilerPlugin } from './plugins/vite-theme-compiler';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'path';
import { or3CloudConfig } from './config.or3cloud';
import { or3Config } from './config.or3';
import { printStartupBanner as printOr3StartupBanner } from './shared/dev/startup-banner';
import { discoverNonCorePlugins } from './shared/plugins/safe-mode';
import { requiredProviderModules } from './shared/cloud/provider-compatibility';
import { readProviderMetadata } from './shared/cloud/provider-metadata';
import { modulePackageName, resolveModuleEntry } from './shared/config/module-resolution';
import { buildApplicationPlan } from './shared/config/application-plan';
import { stripBrokenOpenRouterSourcemapsPlugin } from './plugins/vite-strip-broken-openrouter-sourcemaps';
import { resolveDevProviderModule } from './shared/dev/local-providers';
import { resolveLocalPackageAliases } from './shared/dev/local-packages';
import { hostEsmFacadeImportMapScript } from './shared/plugins/host-esm-facade';

const env = { ...process.env };

// SSR auth is gated by environment variable to preserve static builds
const isSsrAuthEnabled = or3CloudConfig.auth.enabled;
const isWizardUiProcess = process.env.OR3_WIZARD_UI_ENABLED === 'true';
const isScrollTestHarnessEnabled =
    process.env.OR3_SCROLL_TEST_HARNESS === 'true';
const isProductionJourneyTestHarnessEnabled =
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS === 'true';
const isStaticGenerateBuild = process.argv.includes('generate');
const shouldLoadCloudProviderModules =
    !isWizardUiProcess && isSsrAuthEnabled && !isStaticGenerateBuild;

const sqliteRuntime = process.env.OR3_SQLITE_DRIVER?.trim().toLowerCase() ||
    'better-sqlite3';
const sqliteNativeTraceIncludes =
    sqliteRuntime === 'turso' || sqliteRuntime === 'libsql'
        ? [resolve(__dirname, 'node_modules/libsql/index.js')]
        : sqliteRuntime === 'bun' ||
            sqliteRuntime === 'bun:sqlite' ||
            sqliteRuntime === 'd1' ||
            sqliteRuntime === 'cloudflare-d1' ||
            sqliteRuntime === 'cloudflare'
          ? []
          : [resolve(__dirname, 'node_modules/better-sqlite3/lib/index.js')];

// Sibling source checkouts are used for every `nuxt dev` run and fall back to
// the installed registry package per alias, so one missing or renamed checkout
// never breaks the app.
const localPackages = resolveLocalPackageAliases(__dirname);
const localPackageAliases = [...localPackages.aliases];

// The SDK checkout exposes TypeScript source through its `exports`. Vite can
// transpile that source, but Nitro's Rollup pipeline cannot parse TypeScript
// inside `node_modules`, so point both at the workspace source (the same live
// source Vitest aliases) whenever this is the OR3 source checkout. Generated
// projects and deployment images without the workspace fall back to the
// installed `@or3/plugin-sdk` package.
const pluginSdkSourceRoot = resolve(__dirname, 'packages/plugin-sdk/src');
const hasPluginSdkSource = existsSync(resolve(pluginSdkSourceRoot, 'index.ts'));
const pluginSdkSourceAliases: Record<string, string> = hasPluginSdkSource
    ? {
          '@or3/plugin-sdk/cards/vue': resolve(
              pluginSdkSourceRoot,
              'cards-vue.ts'
          ),
          '@or3/plugin-sdk/cards/react': resolve(
              pluginSdkSourceRoot,
              'cards-react.ts'
          ),
          '@or3/plugin-sdk/cards': resolve(pluginSdkSourceRoot, 'cards.ts'),
          '@or3/plugin-sdk/host': resolve(pluginSdkSourceRoot, 'host.ts'),
          '@or3/plugin-sdk/package-tree': resolve(
              pluginSdkSourceRoot,
              'package-tree.ts',
          ),
          '@or3/plugin-sdk/state-compatibility': resolve(
              pluginSdkSourceRoot,
              'state-compatibility.ts',
          ),
          '@or3/plugin-sdk/package-archive': resolve(
              pluginSdkSourceRoot,
              'cli/archive.ts',
          ),
          '@or3/plugin-sdk/candidate': resolve(
              pluginSdkSourceRoot,
              'candidate.ts',
          ),
          // Server-side setup descriptors are parsed with the shared SDK
          // parser, so the package profile source must resolve to the
          // transformable source in a checkout build.
          '@or3/plugin-sdk/profile': resolve(pluginSdkSourceRoot, 'profile.ts'),
          // The root entry too: a plugin loaded from a sibling checkout must
          // resolve the *same* SDK instance this app runs, or its `ui` helpers
          // come from a second copy with a different shape.
          '@or3/plugin-sdk': resolve(pluginSdkSourceRoot, 'index.ts'),
      }
    : {};
const pluginSdkViteAliases = Object.entries(pluginSdkSourceAliases)
    .map(([find, replacement]) => ({ find, replacement }))
    .sort((left, right) => right.find.length - left.find.length);

// Keep cloud discovery outside the helpers: static/offline/setup need no provider files.
if (isStaticGenerateBuild && isSsrAuthEnabled) {
    throw new Error(
        '[or3-config] Static generation cannot enable server auth. Use bun run generate:static or a server build.',
    );
}
const providerMetadata =
    shouldLoadCloudProviderModules && !env.OR3_PLUGIN_WATCH_ROOT
        ? readProviderMetadata(__dirname)
        : { modules: [], warnings: [] };
const configuredPluginModules =
    discoverNonCorePlugins(
        or3CloudConfig.admin,
        () =>
            or3Config.extensions?.plugins?.modules?.filter((id) => id.trim()) ??
            [],
    ) ?? [];
const moduleIds = [
    ...new Set(
        [
            ...providerMetadata.modules,
            ...requiredProviderModules(or3CloudConfig, env).map(
                ({ moduleId }) => moduleId,
            ),
            ...configuredPluginModules.filter(
                (id) =>
                    shouldLoadCloudProviderModules ||
                    !modulePackageName(id)
                        ?.split('/')
                        .at(-1)
                        ?.startsWith('or3-provider-'),
            ),
        ].map((id) => id.trim()),
    ),
];
const availableModules = new Map(
    moduleIds.map((id) => [
        id,
        resolveModuleEntry(resolveDevProviderModule(id, env), __dirname),
    ]),
);
const result = buildApplicationPlan({
    or3Config,
    or3CloudConfig,
    env,
    modules: availableModules,
    isStaticGenerateBuild,
    now: Date.now(),
});
if (!result.ok)
    throw new Error(
        `[or3-config] Invalid application configuration:\n- ${result.errors.join('\n- ')}`,
    );
const applicationPlan = result.plan;
for (const warning of [...providerMetadata.warnings, ...result.warnings])
    console.warn(warning);
const effectiveSsrAuthEnabled = applicationPlan.features.auth.enabled;
const effectiveSyncEnabled = applicationPlan.features.sync.enabled;
const effectiveStorageEnabled = applicationPlan.features.storage.enabled;

// Branding defaults (sourced from or3Config)
const appName = or3Config.site.name;
const appShortName = appName.length > 12 ? appName.slice(0, 12) : appName;
const pwaNavigateFallback = isStaticGenerateBuild ? '/index.html' : null;
// Server builds never serve prerendered HTML online; this shell is precached
// and used only when a navigation fails because the network is unavailable.
const pwaOfflineShell = '/200.html';
const pwaOpenRouterCallbackFallback = isStaticGenerateBuild
    ? '/openrouter-callback/index.html'
    : undefined;

export default defineNuxtConfig({
    ...(process.env.OR3_PLUGIN_WATCH_ROOT && process.env.OR3_PLUGIN_DEV_PROFILE
        ? { buildDir: resolve(__dirname, '.nuxt-plugin-dev', basename(process.env.OR3_PLUGIN_DEV_PROFILE)) }
        : process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS === 'true'
            ? { buildDir: resolve(__dirname, '.nuxt-e2e-journeys') }
            : {}),
    app: {
        head: {
            script: [hostEsmFacadeImportMapScript()],
            link: [
                {
                    rel: 'icon',
                    type: 'image/svg+xml',
                    href:
                        or3Config.site.faviconUrl || '/logos/icon-logo-svg.svg',
                },
                {
                    rel: 'icon',
                    type: 'image/x-icon',
                    href: or3Config.site.faviconUrl || '/favicon.ico',
                    sizes: '32x32',
                },
                {
                    rel: 'apple-touch-icon',
                    sizes: '180x180',
                    href: '/logos/apple-touch-icon.png',
                },
            ],
        },
    },
    alias: {
        types: resolve(__dirname, './types'),
        '~/types': resolve(__dirname, './types'),
        '~~/shared': resolve(__dirname, './shared'),
    },
    // Disable SSR for test pages to avoid hydration mismatches
    routeRules: {
        '/_tests/**': { ssr: false },
        ...(process.env.NODE_ENV !== 'production' && process.env.OR3_TOOL_CARDS_TEST_HARNESS === 'true'
            ? {'/__or3-tool-cards-test':{ssr:false}}
            : {}),
        // Renderer harness for the portable Tasks plugin. The page itself
        // refuses to render outside development, so this never ships.
        '/__tasks-preview': { ssr: false },
        ...(isScrollTestHarnessEnabled
            ? { '/__or3-scroll-test': { ssr: false } }
            : {}),
        ...(isProductionJourneyTestHarnessEnabled
            ? {
                  '/__or3-chat-journey-test': { ssr: false },
                  '/__or3-document-journey-test': { ssr: false },
                  '/__or3-mobile-auth-test': { ssr: false },
              }
            : {}),
    },
    compatibilityDate: '2025-07-15',
    // Nuxt does not auto-scan individual plugins in nested example folders.
    plugins: process.env.NODE_ENV !== 'production'
        ? [
              '~/plugins/examples/quiz-card-example.client',
              '~/plugins/examples/weather-card-example.client',
              '~/plugins/examples/map-card-example.client',
          ]
        : [],
    runtimeConfig: {
        ...applicationPlan.runtimeConfig,
        public: {
            ...applicationPlan.runtimeConfig.public,
            toolCardsTestHarness:
                process.env.NODE_ENV !== 'production' &&
                process.env.OR3_TOOL_CARDS_TEST_HARNESS === 'true',
        },
    },
    experimental: {
        defaults: {
            nuxtLink: {
                // Nuxt type defs currently expect booleans, but runtime accepts the string literal
                // to force interaction-only prefetching.
                prefetchOn: 'interaction' as unknown as {
                    visibility?: boolean;
                    interaction?: boolean;
                },
            },
        },
    },
    devtools: {
        enabled: process.env.NODE_ENV !== 'production',
        // Vite Inspect retains resolution and transform history across HMR.
        // Keep the DevTools UI available without the unbounded inspector state.
        viteInspect: false,
        timeline: {
            enabled: false,
        },
    },
    modules: [
        './modules/plugin-runtime-catalog',
        '@nuxt/ui',
        '@nuxt/fonts',
        '@vite-pwa/nuxt',
        ...applicationPlan.modules,
    ],
    // Use the "app" folder as the source directory (where app.vue, pages/, layouts/, etc. live)
    srcDir: 'app',
    // Linked provider packages (or3-provider-*) are file-level symlinks.
    // preserveSymlinks prevents TypeScript from resolving them to their real
    // paths outside the project root, which would break module resolution.
    typescript: {
            tsConfig: {
                compilerOptions: {
                    preserveSymlinks: true,
                },
            },
        },
    // Load Tailwind + theme variables globally
    css: ['~/assets/css/fonts.css', '~/assets/css/main.css'],
    icon: {
        serverBundle: {
            // Only bundle the iconify collections we actually use
            // (pixelarticons = theme tokens, tabler/lucide/carbon = inline
            // prefixes, simple-icons = provider brand logos).
            collections: [
                'pixelarticons',
                'lucide',
                'carbon',
                'tabler',
                'simple-icons',
            ],
        },
    },
    // Nuxt UI registers this module as a dependency. Keep its resolver local so
    // production builds cannot block on external font services.
    fonts: {
        provider: 'local',
    },
    nitro: {
        alias: {
            ...pluginSdkSourceAliases,
        },
        // Emit precompressed variants for the self-hosted Node server while
        // keeping the original assets for hosts that do their own compression.
        compressPublicAssets: true,
        // Local native runtimes resolve their binding dynamically at runtime.
        // Trace only the selected runtime so Bun and D1 builds stay native-free.
        externals: {
            // Nitro's production package tracing can flatten incompatible
            // transitive packages into the server output. Bundle Dexie so SSR
            // retains its ESM named exports, and bundle Unhead so Nuxt's v3
            // renderer cannot be paired with Nuxt UI's transitive v2 runtime.
            inline: ['dexie', 'unhead'],
            traceInclude: sqliteNativeTraceIncludes,
        },
        // Server tsconfig needs preserveSymlinks for file:-linked provider packages.
        typescript: {
            tsConfig: {
                compilerOptions: {
                    preserveSymlinks: true,
                },
            },
        },
        prerender: {
            crawlLinks: false,
            // Prerendered HTML embeds the build-time public runtimeConfig, so
            // only static generation prerenders real routes. Server builds
            // render them per request (honouring NUXT_PUBLIC_* overrides) and
            // prerender just the client-only shell the service worker serves
            // when the network is down.
            routes: isStaticGenerateBuild
                ? ['/', '/openrouter-callback', '/documentation']
                : [pwaOfflineShell],
        },
        routeRules: {
            // Hashed Nuxt chunks - immutable forever
            '/_nuxt/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
            // Font files - immutable forever
            '/_fonts/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
            // Static images with versioning - cache for 1 week
            '/**/*.webp': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            '/**/*.png': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            '/**/*.svg': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            '/**/*.jpg': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            '/**/*.jpeg': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            // Font files (both woff and woff2)
            '/**/*.woff': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
            '/**/*.woff2': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            // CSS files from Nuxt build
            '/**/*.css': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
        },
    },
    // PWA configuration
    pwa: {
        // Auto update SW when new content is available
        registerType: 'autoUpdate',
        // Enable PWA in dev so you can install/test while developing
        devOptions: {
            enabled: false,
            suppressWarnings: true,
        },
        // Expose $pwa and intercept install prompt
        client: {
            installPrompt: true,
            registerPlugin: true,
            periodicSyncForUpdates: 60 * 60, // Check every 1 hour (reduced from 12 hours for faster updates)
        },
        // Basic offline support; let Workbox handle common assets
        workbox: {
            skipWaiting: true, // activate new SW immediately
            clientsClaim: true, // control pages right away
            cleanupOutdatedCaches: true,
            // The app bundle currently exceeds Workbox's 2 MiB default during
            // production preview/E2E builds. Raise the cap so local preview and
            // Playwright can boot instead of hard-failing the build.
            maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
            // Ensure the prerendered callback HTML can be matched regardless of auth params
            ignoreURLParametersMatching: [/^code$/, /^state$/],
            // Never serve the generic SPA fallback for these routes.
            // /openrouter-callback uses a dedicated runtime rule below with
            // a precache fallback to the prerendered callback HTML.
            navigateFallbackDenylist: [
                /\/openrouter-callback(?:[?/].*)?$/,
                /\/streamsaver(?:\/.*)?$/,
                /\/documentation(?:\/.*)?$/,
            ],
            // Explicitly set null for SSR builds to disable vite-plugin-pwa's default fallback.
            navigateFallback: pwaNavigateFallback,
            manifestTransforms: [
                (entries) => ({
                    manifest: entries.filter((entry) => {
                        // Remove streamsaver app shell from precache
                        if (
                            entry.url === 'streamsaver' ||
                            entry.url === 'streamsaver/index.html'
                        )
                            return false;
                        // Exclude heavy KaTeX assets from precache (loaded lazily when Markdown with math is viewed)
                        // This avoids large install-time caches without affecting runtime loading
                        if (/^_nuxt\/KaTeX_/i.test(entry.url)) return false;
                        if (/^_nuxt\/katex\..*\.css$/i.test(entry.url))
                            return false;
                        // The exact tokenizer is a worker-only, on-demand asset.
                        // Do not force its ~1 MB gzip payload into every PWA
                        // installation; the browser will cache it after use.
                        if (
                            entry.url.endsWith('.js') &&
                            entry.size > 1.5 * 1024 * 1024
                        )
                            return false;
                        return true;
                    }),
                    warnings: [],
                }),
            ],
            globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
            globIgnores: [
                'streamsaver/**',
                // These assets remain available online, but are not required to
                // install or operate the offline application shell.
                'screenshots/chat-screenshot.png',
                'screenshots/editor-screenshot.png',
                'logos/logo-8bit-raw.png',
                'logos/logo-xl.png',
                'logos/logo-1024.png',
                'logos/icon-logo.png',
            ],
            importScripts: ['/sw-bypass-streamsaver.js'],
            runtimeCaching: [
                // OpenRouter callback: prefer network, but fall back to the
                // prerendered callback page from precache if localhost drops.
                {
                    urlPattern: ({ request, url }) =>
                        request.mode === 'navigate' &&
                        /^\/openrouter-callback\/?$/.test(url.pathname),
                    handler: 'NetworkFirst',
                    options: {
                        cacheName: 'openrouter-callback-pages',
                        matchOptions: { ignoreSearch: true },
                        networkTimeoutSeconds: 2,
                        ...(pwaOpenRouterCallbackFallback
                            ? {
                                  precacheFallback: {
                                      fallbackURL:
                                          pwaOpenRouterCallbackFallback,
                                  },
                              }
                            : {}),
                    },
                },
                // HTML navigation - always try network first for fresh content
                {
                    urlPattern: ({ request }) => request.mode === 'navigate',
                    handler: 'NetworkFirst',
                    options: {
                        cacheName: 'pages-cache',
                        expiration: {
                            maxEntries: 50,
                            maxAgeSeconds: 24 * 60 * 60, // 1 day
                        },
                        networkTimeoutSeconds: 3, // Fast timeout, then fallback to cache
                        ...(isStaticGenerateBuild
                            ? {}
                            : {
                                  precacheFallback: {
                                      fallbackURL: pwaOfflineShell,
                                  },
                              }),
                    },
                },
                // Nuxt chunks
                {
                    urlPattern: /^\/_nuxt\//,
                    handler: 'NetworkFirst',
                    method: 'GET',
                    options: {
                        cacheName: 'nuxt-dev-chunks',
                        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 },
                    },
                },
                // Static images
                {
                    urlPattern: /\.(?:png|webp|jpg|jpeg|gif|svg|ico)$/,
                    handler: 'CacheFirst',
                    method: 'GET',
                    options: {
                        cacheName: 'static-images',
                        expiration: {
                            maxEntries: 200,
                            maxAgeSeconds: 7 * 24 * 60 * 60,
                        },
                    },
                },
                // Fonts
                {
                    urlPattern: /^\/_fonts\//,
                    handler: 'CacheFirst',
                    method: 'GET',
                    options: {
                        cacheName: 'nuxt-fonts',
                        expiration: {
                            maxEntries: 50,
                            maxAgeSeconds: 30 * 24 * 60 * 60,
                        },
                    },
                },
                // Icon API
                {
                    urlPattern: /\/api\/_nuxt_icon\/.*$/,
                    handler: 'StaleWhileRevalidate',
                    method: 'GET',
                    options: {
                        cacheName: 'nuxt-icons',
                        expiration: {
                            maxEntries: 200,
                            maxAgeSeconds: 30 * 24 * 60 * 60,
                        },
                    },
                },
            ],
        },
        // Web App Manifest
        manifest: {
            name: appName,
            short_name: appShortName,
            description:
                'The open, extensible AI chat platform for the people.',
            start_url: '/',
            display: 'standalone',
            background_color: '#0b0f1a',
            theme_color: '#0b0f1a',
            icons: [
                {
                    src: '/logos/app-icon-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                },
                {
                    src: '/logos/app-icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                },
                {
                    src: '/logos/app-icon-1024.png',
                    sizes: '1024x1024',
                    type: 'image/png',
                    purpose: 'any',
                },
                {
                    src: '/logos/app-icon-maskable-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'maskable',
                },
                {
                    src: '/logos/app-icon-maskable-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                },
            ],
        },
    },
    imports: {
        dirs: [
            // Scan top-level composables
            '~/composables',
            // Scan all composables within subdirectories
            // Note: Keep non-composable internals out of composables/ to avoid Nuxt auto-import collisions.
            '~/composables/**',
            // Core directory for auth and other utilities (excluding sync which uses barrel exports)
            '~/core',
            '~/core/auth',
            '~/core/auth/**',
            '~/core/hooks',
            '~/core/hooks/**',
            '~/core/theme',
            '~/core/theme/**',
        ],
    },
    vite: {
        resolve: {
            // Use sibling source checkouts during multi-repo development, but
            // fall back to installed registry packages in generated projects
            // and deployment images where those checkouts do not exist.
            alias: [...pluginSdkViteAliases, ...localPackageAliases],
        },
        optimizeDeps: {
            // These packages are reached through lazy theme/editor/search
            // components. Without an explicit include Vite discovers them
            // after the browser has already requested those chunks, then
            // invalidates the generated URLs while re-optimizing. The 504
            // responses make Vue's async ChatInput component fail fatally on
            // a cold dev-server start.
            include: [
                '@noble/hashes/sha2.js',
                '@noble/hashes/utils.js',
                '@openrouter/sdk',
                '@openrouter/sdk/models/errors',
                '@orama/orama',
                '@tiptap/core',
                '@tiptap/extension-mention',
                '@tiptap/extensions/placeholder',
                '@tiptap/pm/state',
                '@tiptap/starter-kit',
                '@tiptap/suggestion',
                '@tiptap/vue-3',
                '@vue/devtools-core',
                '@vue/devtools-kit',
                '@vueuse/core',
                'ajv',
                'ajv/dist/2020.js',
                'dexie',
                'gpt-tokenizer',
                'lru-cache',
                'spark-md5',
                'tiptap-markdown',
                'zod',
            ],
            exclude: localPackageAliases.length ? ['or3-scroll'] : [],
        },
        server: {
            fs: {
                allow: [resolve(__dirname, '..')],
                // Profile databases and credentials must never be served through
                // Vite's /@fs route, even when they sit inside its allow tree.
                deny: [
                    '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}',
                    '.npmrc', '.yarnrc.yml', '**/.git/**',
                    '**/.or3-plugin-dev/**',
                ],
            },
            watch: {
                ignored: isWizardUiProcess
                    ? [
                          '**/.env',
                          '**/.env.local',
                          '**/or3.providers.generated.json',
                      ]
                    : [],
            },
        },
        plugins: [
            stripBrokenOpenRouterSourcemapsPlugin(),
            themeCompilerPlugin({
                failOnError: true,
                showWarnings: true,
            }),
        ],
        worker: {
            format: 'es',
        },
        build: {
            rolldownOptions: {
                // Nitro bundles shared source externals in the next stage. Keep
                // their absolute IDs: relative paths derived from the app entry
                // root do not resolve from .nuxt/dist/server in clean builds.
                makeAbsoluteExternalsRelative: false,
                output: {
                    codeSplitting: {
                        groups: [
                            {
                                name: 'gpt-tokenizer',
                                test: /[\\/]node_modules[\\/]gpt-tokenizer[\\/]/,
                            },
                        ],
                    },
                },
            },
        },
    },
    // Exclude test artifacts & example plugins from scanning and server bundle (saves build time & size)
    ignore: [
        '**/*.test.*',
        '**/__tests__/**',
        'tests/**',
        ...(isStaticGenerateBuild ? [
            'server/routes/or3/tool-card-frame/**',
            'server/routes/or3/tool-card-probe.get.ts',
        ] : []),
        // Example plugins and test pages (dev only); keep them out of production build
        ...(process.env.NODE_ENV === 'production'
            ? [
                  'app/plugins/examples/**',
                  'app/pages/_tests/**',
                  'app/pages/tests/**',
                  'app/pages/_test.vue',
              ]
            : []),
        // Note: Admin pages are no longer excluded based on ssrAuthEnabled.
        // The new super admin feature uses JWT-based authentication and is gated
        // at runtime via isAdminEnabled() check in server/middleware/admin-gate.ts.
    ].filter(Boolean) as string[],
    hooks: {
        'build:manifest'(manifest) {
            // Dynamic imports still load on navigation and NuxtLink keeps its
            // interaction prefetch. Avoid fetching every possible route from
            // SSR-generated <link rel="prefetch"> tags during initial load.
            for (const resource of Object.values(manifest)) {
                resource.prefetch = false;
            }
        },
        'pages:extend'(pages) {
            if (
                process.env.NODE_ENV !== 'production' &&
                process.env.OR3_TOOL_CARDS_TEST_HARNESS === 'true'
            )
                pages.push({
                    name: 'or3-tool-cards-test',
                    path: '/__or3-tool-cards-test',
                    file: resolve(
                        __dirname,
                        'tests/e2e/fixtures/ToolCardsJourney.vue'
                    ),
                });
            if (isScrollTestHarnessEnabled) {
                pages.push({
                    name: 'or3-scroll-test-harness',
                    path: '/__or3-scroll-test',
                    file: resolve(
                        __dirname,
                        'tests/e2e/fixtures/Or3ScrollCanary.vue'
                    ),
                });
            }
            if (isProductionJourneyTestHarnessEnabled) {
                pages.push(
                    {
                        name: 'or3-chat-journey-test-harness',
                        path: '/__or3-chat-journey-test',
                        file: resolve(
                            __dirname,
                            'tests/e2e/fixtures/ProductionChatJourney.vue'
                        ),
                    },
                    {
                        name: 'or3-document-journey-test-harness',
                        path: '/__or3-document-journey-test',
                        file: resolve(
                            __dirname,
                            'tests/e2e/fixtures/ProductionDocumentJourney.vue'
                        ),
                    },
                    {
                        name: 'or3-mobile-auth-test-harness',
                        path: '/__or3-mobile-auth-test',
                        file: resolve(
                            __dirname,
                            'tests/e2e/fixtures/MobileAuthJourney.vue'
                        ),
                    }
                );
            }
        },
        listen(_server, listener) {
            if (isWizardUiProcess) return;
            const url =
                listener &&
                typeof (listener as { url?: unknown }).url === 'string'
                    ? (listener as { url: string }).url
                    : undefined;
            // Defer so this prints after Nuxt's own URL output.
            setTimeout(() => {
                printOr3StartupBanner({
                    appUrl: url,
                    ssrAuthEnabled: effectiveSsrAuthEnabled,
                    degradedCloud: false,
                    authProvider: or3CloudConfig.auth.provider,
                    syncEnabled: effectiveSyncEnabled,
                    syncProvider: or3CloudConfig.sync.provider,
                    storageEnabled: effectiveStorageEnabled,
                    storageProvider: or3CloudConfig.storage.provider,
                    localPackages: localPackages.selected,
                });
            }, 1200);
        },
    },
});
