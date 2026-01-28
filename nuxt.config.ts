// https://nuxt.com/docs/api/configuration/nuxt-config
import { themeCompilerPlugin } from './plugins/vite-theme-compiler';
import { resolve } from 'path';
import { or3CloudConfig } from './config.or3cloud';
import { or3Config } from './config.or3';

// SSR auth is gated by environment variable to preserve static builds
const isSsrAuthEnabled = or3CloudConfig.auth.enabled;

const convexUrl = or3CloudConfig.sync.convex?.url || '';
const convexEnabled =
    (or3CloudConfig.sync.enabled &&
        or3CloudConfig.sync.provider === 'convex') ||
    (or3CloudConfig.storage.enabled &&
        or3CloudConfig.storage.provider === 'convex');

// Branding defaults (sourced from or3Config)
const appName = or3Config.site.name;
const appShortName = appName.length > 12 ? appName.slice(0, 12) : appName;

// Shared config objects (DRY: used in both server and public runtimeConfig)
const limitsConfig = {
    enabled: or3CloudConfig.limits!.enabled!,
    requestsPerMinute: or3CloudConfig.limits!.requestsPerMinute!,
    maxConversations: or3CloudConfig.limits!.maxConversations!,
    maxMessagesPerDay: or3CloudConfig.limits!.maxMessagesPerDay!,
    storageProvider: or3CloudConfig.limits!.storageProvider || 'memory',
};
const brandingConfig = {
    appName: or3Config.site.name,
    logoUrl: or3Config.site.logoUrl,
    defaultTheme: or3Config.site.defaultTheme,
};
const legalConfig = {
    termsUrl: or3Config.legal.termsUrl,
    privacyUrl: or3Config.legal.privacyUrl,
};
const adminConfig = {
    basePath: or3CloudConfig.admin?.basePath || '/admin',
    allowedHosts: or3CloudConfig.admin?.allowedHosts || [],
    allowRestart: Boolean(or3CloudConfig.admin?.allowRestart),
    allowRebuild: Boolean(or3CloudConfig.admin?.allowRebuild),
    rebuildCommand: or3CloudConfig.admin?.rebuildCommand || 'bun run build',
    extensionMaxZipBytes: or3CloudConfig.admin?.extensionMaxZipBytes
        ? String(or3CloudConfig.admin.extensionMaxZipBytes)
        : undefined,
    extensionMaxFiles: or3CloudConfig.admin?.extensionMaxFiles
        ? String(or3CloudConfig.admin.extensionMaxFiles)
        : undefined,
    extensionMaxTotalBytes: or3CloudConfig.admin?.extensionMaxTotalBytes
        ? String(or3CloudConfig.admin.extensionMaxTotalBytes)
        : undefined,
    extensionAllowedExtensions: or3CloudConfig.admin?.extensionAllowedExtensions
        ? or3CloudConfig.admin.extensionAllowedExtensions.join(',')
        : undefined,
};

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
                    href: or3Config.site.faviconUrl || '/logos/icon-logo-svg.svg',
                },
                {
                    rel: 'icon',
                    type: 'image/x-icon',
                    href: or3Config.site.faviconUrl || '/favicon.ico',
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
    // Disable SSR for test pages to avoid hydration mismatches
    routeRules: {
        '/_tests/**': { ssr: false },
    },
    compatibilityDate: '2025-07-15',
    runtimeConfig: {
        // Server-only env variables (auto-mapped from NUXT_*)
        openrouterApiKey:
            or3CloudConfig.services.llm?.openRouter?.instanceApiKey || '',
        openrouterAllowUserOverride:
            or3CloudConfig.services.llm?.openRouter?.allowUserOverride ?? true,
        clerkSecretKey: '', // Auto-mapped from NUXT_CLERK_SECRET_KEY
        auth: {
            enabled: isSsrAuthEnabled,
            provider: or3CloudConfig.auth.provider,
        },
        sync: {
            enabled: or3CloudConfig.sync.enabled,
            provider: or3CloudConfig.sync.provider,
            convexUrl,
        },
        storage: {
            enabled: or3CloudConfig.storage.enabled,
            provider: or3CloudConfig.storage.provider,
        },
        limits: limitsConfig,
        branding: brandingConfig,
        legal: legalConfig,
        security: {
            allowedOrigins: or3CloudConfig.security!.allowedOrigins!,
            forceHttps: or3CloudConfig.security!.forceHttps!,
        },
        admin: adminConfig,
        // Background streaming configuration (SSR mode only)
        backgroundJobs: {
            enabled: or3CloudConfig.backgroundStreaming?.enabled ?? false,
            storageProvider: or3CloudConfig.backgroundStreaming?.storageProvider ?? 'memory',
            maxConcurrentJobs: or3CloudConfig.backgroundStreaming?.maxConcurrentJobs ?? 20,
            jobTimeoutMs: (or3CloudConfig.backgroundStreaming?.jobTimeoutSeconds ?? 300) * 1000,
            completedJobRetentionMs: 5 * 60 * 1000, // 5 minutes
        },
        public: {
            // Single source of truth for client gating.
            // Avoid inferring enablement from presence of publishable keys.
            ssrAuthEnabled: isSsrAuthEnabled,
            openRouter: {
                allowUserOverride:
                    or3CloudConfig.services.llm?.openRouter?.allowUserOverride ??
                    true,
                hasInstanceKey: Boolean(
                    or3CloudConfig.services.llm?.openRouter?.instanceApiKey
                ),
            },
            storage: {
                enabled: or3CloudConfig.storage.enabled,
                provider: or3CloudConfig.storage.provider,
            },
            sync: {
                enabled: or3CloudConfig.sync.enabled,
                provider: or3CloudConfig.sync.provider,
                convexUrl,
            },
            limits: limitsConfig,
            branding: brandingConfig,
            legal: legalConfig,
            backgroundStreaming: {
                enabled: or3CloudConfig.backgroundStreaming?.enabled ?? false,
            },
            admin: {
                basePath: adminConfig.basePath,
            },
            // Feature toggles from OR3 config - exposed for client-side gating
            features: {
                workflows: {
                    enabled: or3Config.features.workflows.enabled,
                    editor: or3Config.features.workflows.editor,
                    slashCommands: or3Config.features.workflows.slashCommands,
                    execution: or3Config.features.workflows.execution,
                },
                documents: {
                    enabled: or3Config.features.documents.enabled,
                },
                backup: {
                    enabled: or3Config.features.backup.enabled,
                },
                mentions: {
                    enabled: or3Config.features.mentions.enabled,
                    documents: or3Config.features.mentions.documents,
                    conversations: or3Config.features.mentions.conversations,
                },
                dashboard: {
                    enabled: or3Config.features.dashboard.enabled,
                },
            },
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
        ...(convexEnabled ? ['convex-nuxt'] : []),
        // Only include Clerk when SSR auth is enabled to preserve static builds
        ...(isSsrAuthEnabled && or3CloudConfig.auth.provider === 'clerk'
            ? ['@clerk/nuxt']
            : []),
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
        ...(!isSsrAuthEnabled
            ? [
                  'app/pages/admin/**',
                  'app/layouts/admin.vue',
                  'app/components/admin/**',
                  'app/composables/admin/**',
              ]
            : []),
    ].filter(Boolean) as string[],
});
