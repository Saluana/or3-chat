import { defineConfig } from 'vitest/config';
import path from 'path';
import vue from '@vitejs/plugin-vue';

// Duplicate vite type trees (root vs vitest's bundled) cause overload mismatch.
// We intentionally cast the plugin to any to bypass structural mismatch.
// No dependency version changes per instruction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vueAny: any = vue;

export default defineConfig({
    // Casted plugin to avoid TS 2769 noise only in editor; runtime unaffected.
    plugins: [vueAny()],
    resolve: {
        alias: {
            '#imports': path.resolve(__dirname, 'tests/stubs/nuxt-imports.ts'),
            '~': path.resolve(__dirname, 'app'),
            '#app': path.resolve(__dirname, 'tests/stubs/nuxt-app.ts'),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['app/**/__tests__/**/*.test.ts'],
        exclude: ['node_modules', 'dist', '.nuxt'],
        setupFiles: ['tests/setup.ts'],
        testTimeout: 10000,
        hookTimeout: 10000,
        bail: 1,
    },
});
