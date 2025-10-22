// https://nuxt.com/docs/api/configuration/nuxt-config

export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
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
        enabled: true,

        timeline: {
            enabled: true,
        },
    },
    modules: ['@nuxt/ui', '@nuxt/fonts', '@vite-pwa/nuxt'],
    // Use the "app" folder as the source directory (where app.vue, pages/, layouts/, etc. live)
    srcDir: 'app',
    // Load Tailwind + theme variables globally
    css: ['~/assets/css/main.css'],
    fonts: {
        families: [
            { name: 'Press Start 2P', provider: 'google' },
            { name: 'VT323', provider: 'google' },
            {
                name: 'IBM Plex Sans',
                provider: 'google',
                weights: ['400', '500', '600', '700'],
            },
        ],
    },
    nitro: {
        prerender: {
            routes: ['/openrouter-callback', '/documentation'],
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
            // Ensure the prerendered callback HTML can be matched regardless of auth params
            ignoreURLParametersMatching: [/^code$/, /^state$/],
            // Never serve the generic SPA fallback for the auth callback (with or without params)
            navigateFallbackDenylist: [
                /\/openrouter-callback$/,
                /\/openrouter-callback\?.*$/,
                /\/streamsaver(?:\/.*)?$/,
                /\/documentation(?:\/.*)?$/, // Don't fallback for documentation routes
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
                    },
                },
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
    imports: {
        dirs: [
            // Scan top-level composables
            '~/composables',
            // Scan all composables within subdirectories
            '~/composables/**',
            // Scan core directory for auth and other utilities
            '~/core',
            '~/core/**',
        ],
        imports: [
            { name: 'useOpenRouterAuth', from: '~/core/auth/useOpenrouter' },
        ],
    },
    vite: {
        worker: {
            format: 'es',
        },
        build: {
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (id.includes('/node_modules/gpt-tokenizer/')) {
                            return 'gpt-tokenizer';
                        }
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
        // Example plugins and test pages (dev only); keep them out of production build
        ...(process.env.NODE_ENV === 'production'
            ? ['app/plugins/examples/**', 'app/pages/_test.vue']
            : []),
    ].filter(Boolean) as string[],
});
