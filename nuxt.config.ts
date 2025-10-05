// https://nuxt.com/docs/api/configuration/nuxt-config
import { resolve } from 'pathe';

export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: { enabled: true },
    modules: ['@nuxt/ui', '@nuxt/fonts', '@vite-pwa/nuxt'],
    // Use the "app" folder as the source directory (where app.vue, pages/, layouts/, etc. live)
    srcDir: 'app',
    // Load Tailwind + theme variables globally
    css: ['~/assets/css/main.css'],

    // Auto-register components from multiple directories
    components: [
        { path: '~/components' }, // Global atoms - use default pathPrefix behavior
        { path: '~/shared/components', pathPrefix: false }, // Shared components
        { path: '~/features/chat/components', pathPrefix: false }, // Chat components
        { path: '~/features/documents/components', pathPrefix: false }, // Document components
        { path: '~/features/editor/components', pathPrefix: false }, // Editor components
        { path: '~/features/sidebar/components', pathPrefix: false }, // Sidebar components
        { path: '~/features/dashboard/components', pathPrefix: false }, // Dashboard components
        { path: '~/features/images/components', pathPrefix: false }, // Image components
        { path: '~/features/threads/components', pathPrefix: false }, // Thread components
        { path: '~/features/projects/components', pathPrefix: false }, // Project components
    ],

    // Auto-import composables & utils from new directories
    // NOTE: core/* modules are NOT auto-imported - they use explicit imports via @core/* alias
    // This avoids duplicate import warnings from barrel exports (index.ts)
    imports: {
        dirs: [
            'composables', // Global bridges
            'shared/composables',
            'shared/utils',
            // core/* intentionally excluded - use explicit imports: import { useHooks } from '@core/hooks'
            'features/chat/composables',
            'features/chat/utils',
            'features/documents/composables',
            'features/editor/composables',
            'features/dashboard/composables',
            'features/sidebar/composables',
            'features/threads/composables',
            'features/projects/composables',
            'features/images/composables',
        ],
    },

    // Path aliases for clean imports
    alias: {
        '@core': resolve('./app/core'),
        '@shared': resolve('./app/shared'),
        '@features': resolve('./app/features'),
        '@db': resolve('./db'),
    },

    // TypeScript configuration
    typescript: {
        tsConfig: {
            compilerOptions: {
                baseUrl: '.',
                paths: {
                    '@core/*': ['./app/core/*'],
                    '@shared/*': ['./app/shared/*'],
                    '@features/*': ['./app/features/*'],
                    '@db/*': ['./db/*'],
                },
            },
        },
    },

    fonts: {
        families: [
            { name: 'Press Start 2P', provider: 'google' },
            { name: 'VT323', provider: 'google' },
        ],
    },

    // Vite configuration - suppress duplicate import warnings from core/* barrel exports
    vite: {
        build: {
            rollupOptions: {
                onwarn(warning, warn) {
                    // Suppress "Duplicated imports" warnings for core/* modules
                    if (
                        warning.code === 'UNUSED_EXTERNAL_IMPORT' ||
                        (warning.message &&
                            warning.message.includes('Duplicated imports') &&
                            warning.message.includes('/app/core/'))
                    ) {
                        return;
                    }
                    warn(warning);
                },
            },
        },
    },

    nitro: { prerender: { routes: ['/openrouter-callback'] } },
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
            periodicSyncForUpdates: 12 * 60 * 60, // Check every 12 hours
        },
        // Basic offline support; let Workbox handle common assets
        workbox: {
            skipWaiting: true, // activate new SW immediately
            clientsClaim: true, // control pages right away
            cleanupOutdatedCaches: true,
            // Ensure the prerendered callback HTML can be matched regardless of auth params
            ignoreURLParametersMatching: [/^code$/, /^state$/],
            // Never serve the generic SPA fallback for the auth callback (with or without params)
            navigateFallbackDenylist: [
                /\/openrouter-callback$/,
                /\/openrouter-callback\?.*$/,
                /\/streamsaver(?:\/.*)?$/,
            ],
            navigateFallback: '/index.html',
            manifestTransforms: [
                (entries) => ({
                    manifest: entries.filter(
                        (entry) =>
                            entry.url !== 'streamsaver' &&
                            entry.url !== 'streamsaver/index.html'
                    ),
                    warnings: [],
                }),
            ],
            globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
            globIgnores: ['streamsaver/**'],
            importScripts: ['/sw-bypass-streamsaver.js'],
            runtimeCaching: [
                // Auth callback: prefer fresh network, but fall back to cached prerender if offline
                {
                    urlPattern: /\/openrouter-callback(\?.*)?$/,
                    handler: 'NetworkOnly',
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
            name: 'Or3 Chat',
            short_name: 'Or3.Chat',
            description:
                'The open, extensible AI chat platform for the people.',
            start_url: '/',
            display: 'standalone',
            background_color: '#0b0f1a',
            theme_color: '#0b0f1a',
            icons: [
                {
                    src: '/logos/logo-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                },
                {
                    src: '/logos/logo-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                },
                // WebP is fine in many browsers; PNGs above cover platforms requiring PNG
                {
                    src: '/logos/logo-1024.webp',
                    sizes: '1024x1024',
                    type: 'image/webp',
                    purpose: 'any maskable',
                },
            ],
        },
    },
    // Exclude test artifacts & example plugins from scanning and server bundle (saves build time & size)
    // Also exclude core/* barrel exports to prevent duplicate type warnings
    ignore: [
        '**/*.test.*',
        '**/__tests__/**',
        'tests/**',
        // Exclude barrel exports (index.ts) from core/* to prevent duplicate import warnings
        'app/core/*/index.ts',
        // Example plugins and test pages (dev only); keep them out of production build
        ...(process.env.NODE_ENV === 'production'
            ? ['app/plugins/examples/**', 'app/pages/_test.vue']
            : []),
    ].filter(Boolean) as string[],
});
