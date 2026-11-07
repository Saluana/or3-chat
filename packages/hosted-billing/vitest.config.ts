import { defineConfig } from 'vitest/config';
import base from '../../vitest.config.ts';

// Optional dependency tests run only when this module has been installed.
export default defineConfig({
    ...base,
    test: {
        ...base.test,
        projects: [
            { extends: true, test: { name: 'billing-server', environment: 'node', include: ['packages/hosted-billing/tests/**/*.test.ts'], exclude: ['**/*.client.test.ts'] } },
            { extends: true, define: { 'import.meta.client': true }, test: { name: 'billing-client', environment: 'jsdom', include: ['packages/hosted-billing/tests/**/*.client.test.ts'] } },
        ],
    },
});
