// https://nuxt.com/docs/api/configuration/nuxt-config
import { themeCompilerPlugin } from './plugins/vite-theme-compiler';
import { resolve } from 'path';

// SSR auth is gated by environment variable to preserve static builds
const isSsrAuthEnabled = process.env.SSR_AUTH_ENABLED === 'true';

// Convex client URL (required for convex-vue/convex-nuxt)
// Nuxt does not automatically expose VITE_* vars, so we map it explicitly.
const convexUrl =
    process.env.NUXT_PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL || '';

export default defineNuxtConfig({
    // convex-nuxt module options (mirrors into runtimeConfig.public.convex)
    convex: {
        url: convexUrl,
        // Avoid crashing the whole app when Convex isn't configured.
        // Call sites can decide whether to require Convex.
        manualInit: !convexUrl,
    },
    app: {
        head: {
            link: [
                {
                    rel: 'icon',
                    type: 'image/svg+xml',
                    href: '/logos/icon-logo-svg.svg',
                },
                {
                    rel: 'icon',
                    type: 'image/x-icon',
                    href: '/favicon.ico',
                    sizes: '32x32',
                },
                {
                    rel: 'apple-touch-icon',
                    sizes: '192x192',
                    href: '/logos/logo-192.png',
                },
            ],
        },
    },
    alias: {
        types: resolve(__dirname, './types'),
        '~/types': resolve(__dirname, './types'),
        '~~/shared': resolve(__dirname, './shared'),
    },
    compatibilityDate: '2025-07-15',
    runtimeConfig: {
        // Server-only env variables (auto-mapped from NUXT_*)
        openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
        clerkSecretKey: '', // Auto-mapped from NUXT_CLERK_SECRET_KEY
        auth: {
            enabled: isSsrAuthEnabled,
            provider: process.env.AUTH_PROVIDER || 'clerk',
        },
        public: {
            // Single source of truth for client gating.
            // Avoid inferring enablement from presence of publishable keys.
            ssrAuthEnabled: isSsrAuthEnabled,
            // Auto-mapped from NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY
            clerkPublishableKey: '',
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
        enabled: true,

        timeline: {
            enabled: true,
        },
    },
    modules: [
        '@nuxt/ui',
        '@nuxt/fonts',
        '@vite-pwa/nuxt',
        'convex-nuxt',
        // Only include Clerk when SSR auth is enabled to preserve static builds
        ...(isSsrAuthEnabled ? ['@clerk/nuxt'] : []),
    ],
    // Use the "app" folder as the source directory (where app.vue, pages/, layouts/, etc. live)
    srcDir: 'app',
    // Load Tailwind + theme variables globally
    css: ['~/assets/css/main.css'],
    fonts: {
        defaults: {
            // Only emit the latin subset + normal style to keep the global font CSS lightweight
            subsets: ['latin'],
            styles: ['normal'],
            weights: ['400'],
        },
        families: [
            {
                name: 'Press Start 2P',
                provider: 'google',
                styles: ['normal'],
                weights: ['400'],
                subsets: ['latin'],
            },
            {
                name: 'VT323',
                provider: 'google',
                styles: ['normal'],
                weights: ['400'],
                subsets: ['latin'],
            },
            {
                name: 'IBM Plex Sans',
                provider: 'google',
                styles: ['normal'],
                weights: ['400', '500', '600', '700'],
                subsets: ['latin'],
            },
        ],
        experimental: {
            // Skip generating local metric fallback @font-face blocks (saves ~20% of the CSS payload)
            disableLocalFallbacks: true,
        },
    },
    nitro: {
        prerender: {
            routes: ['/openrouter-callback', '/documentation'],
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
                        return true;
                    }),
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
            // Core directory for auth and other utilities
            '~/core',
            '~/core/**',
        ],
    },
    vite: {
        server: {
            fs: {
                allow: ['..'],
            },
        },
        plugins: [
            themeCompilerPlugin({
                failOnError: true,
                showWarnings: true,
            }),
        ],
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
            ? [
                  'app/plugins/examples/**',
                  'app/pages/_tests/**',
                  'app/pages/_test.vue',
              ]
            : []),
    ].filter(Boolean) as string[],
});
