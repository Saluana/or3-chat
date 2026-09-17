import { defineConfig } from 'vitest/config';
import path from 'path';
import vue from '@vitejs/plugin-vue';

const pluginCompatibilityTests = [
    'app/composables/__tests__/action-surface-adapters.test.ts',
    'app/composables/__tests__/admin-extensions-surface-adapter.test.ts',
    'app/composables/__tests__/dashboard-navigation-surface-adapter.test.ts',
    'app/composables/__tests__/dashboard-profile.test.ts',
    'app/composables/__tests__/dashboard-records-surface-adapter.test.ts',
    'app/composables/__tests__/differential-surface-harness.test.ts',
    'app/composables/__tests__/editor-admin-profiles.test.ts',
    'app/composables/__tests__/editor-extensions-surface-adapter.test.ts',
    'app/composables/__tests__/history-footer-surface-adapters.test.ts',
    'app/composables/__tests__/pane-apps-surface-adapter.test.ts',
    'app/composables/__tests__/project-editor-surface-adapters.test.ts',
    'app/composables/__tests__/registry-family-profiles.test.ts',
    'app/composables/__tests__/sidebar-pages-surface-adapter.test.ts',
    'app/composables/__tests__/sidebar-pane-profiles.test.ts',
    'app/composables/__tests__/sidebar-sections-surface-adapter.test.ts',
    'app/composables/plugins/__tests__/bundled-v1-manager-runtime.test.ts',
    'app/utils/chat/__tests__/client-tool-surface-adapter.test.ts',
    'app/utils/chat/__tests__/tool-registry-profiles.test.ts',
];

const releasePolicyTests = [
    'tests/unit/assets-size.test.ts',
    'tests/unit/dev-wrapper.test.ts',
    'tests/unit/nuxt-config-cache.test.ts',
    'tests/unit/nuxt-config-static-provider-boundary.test.ts',
    'tests/unit/provider-compatibility-matrix.test.ts',
    'tests/unit/sync-tx-scope-usage.test.ts',
];

export default defineConfig({
    plugins: [vue()],
    resolve: {
        // Prevent Vite from following symlinks to real paths, which would move
        // linked provider packages outside the project root and break bare imports.
        preserveSymlinks: true,
        // Force these modules to resolve from the host's node_modules, even when
        // files are loaded from linked provider packages with their own node_modules.
        dedupe: ['vue', 'nuxt', 'zod'],
        alias: {
            // Resolve `@or3/plugin-sdk` subpaths to the live workspace source so
            // the host re-export shims and direct SDK imports share one module
            // instance under Vitest (the `file:` dependency in node_modules is a
            // copy and would otherwise create a duplicate class identity).
            '@or3/plugin-sdk/package-tree': path.resolve(
                __dirname,
                'packages/plugin-sdk/src/package-tree.ts'
            ),
            '@or3/plugin-sdk/package-archive': path.resolve(
                __dirname,
                'packages/plugin-sdk/src/cli/archive.ts'
            ),
            '@or3/plugin-sdk/state-compatibility': path.resolve(
                __dirname,
                'packages/plugin-sdk/src/state-compatibility.ts'
            ),
            '@or3/plugin-sdk/profile': path.resolve(
                __dirname,
                'packages/plugin-sdk/src/profile.ts'
            ),
            '@or3/plugin-sdk/testing': path.resolve(
                __dirname,
                'packages/plugin-sdk/src/testing.ts'
            ),
            '@or3/plugin-sdk/manifest': path.resolve(
                __dirname,
                'packages/plugin-sdk/src/manifest.ts'
            ),
            '@or3/plugin-sdk/ui': path.resolve(
                __dirname,
                'packages/plugin-sdk/src/ui.ts'
            ),
            '@or3/plugin-sdk/portable': path.resolve(
                __dirname,
                'packages/plugin-sdk/src/portable.ts'
            ),
            '@or3/plugin-sdk/host': path.resolve(
                __dirname,
                'packages/plugin-sdk/src/host.ts'
            ),
            '#imports': path.resolve(__dirname, 'tests/stubs/nuxt-imports.ts'),
            '#build/or3/bundled-plugin-catalog': path.resolve(
                __dirname,
                'tests/stubs/bundled-plugin-catalog.ts'
            ),
            '#or3-bundled-plugin-catalog': path.resolve(
                __dirname,
                'tests/stubs/bundled-plugin-catalog.ts'
            ),
            '~': path.resolve(__dirname, 'app'),
            '~~': path.resolve(__dirname),
            '~~/': path.resolve(__dirname) + '/',
            '#app': path.resolve(__dirname, 'tests/stubs/nuxt-app.ts'),
            'nuxt/app': path.resolve(__dirname, 'tests/stubs/nuxt-app.ts'),
        },
    },
    test: {
        globals: true,
        projects: [
            {
                extends: true,
                test: {
                    name: 'core-node',
                    environment: 'node',
                    include: [
                        'server/**/__tests__/**/*.test.ts',
                        'shared/**/__tests__/**/*.test.ts',
                    ],
                    exclude: [
                        'shared/plugins/isolation/__tests__/**/*.test.ts',
                    ],
                },
            },
            {
                extends: true,
                test: {
                    name: 'core-app',
                    environment: 'jsdom',
                    include: [
                        'app/**/__tests__/**/*.test.ts',
                        'tests/unit/**/*.test.ts',
                    ],
                    exclude: [
                        '**/*.integration.test.ts',
                        '**/*.live.test.ts',
                        ...pluginCompatibilityTests,
                        ...releasePolicyTests,
                    ],
                },
            },
            {
                extends: true,
                test: {
                    name: 'app-integration',
                    environment: 'jsdom',
                    include: ['app/**/*.integration.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'integration',
                    environment: 'jsdom',
                    include: ['tests/integration/**/*.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'scripts',
                    environment: 'node',
                    include: ['scripts/__tests__/**/*.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'plugin-compatibility',
                    environment: 'jsdom',
                    include: [
                        ...pluginCompatibilityTests,
                        'shared/plugins/isolation/__tests__/**/*.test.ts',
                    ],
                },
            },
            {
                extends: true,
                test: {
                    name: 'release-policy',
                    environment: 'node',
                    include: releasePolicyTests,
                },
            },
            {
                extends: true,
                test: {
                    name: 'live',
                    environment: 'node',
                    include: ['**/*.live.test.ts'],
                },
            },
        ],
        exclude: ['node_modules', 'dist', '.nuxt'],
        setupFiles: ['tests/setup.ts'],
        testTimeout: 10000,
        hookTimeout: 10000,
        bail: 1,
        coverage: {
            provider: 'v8',
            reportsDirectory: './coverage',
            reporter: ['text', 'html'],
            include: ['app/composables/chat/useStreamAccumulator.ts'],
            thresholds: {
                lines: 90,
                statements: 90,
                branches: 90,
                functions: 75, // helper functions covered adequately
            },
        },
    },
});
