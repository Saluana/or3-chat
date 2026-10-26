import { defineConfig } from 'vitest/config';
import base from '../../vitest.config.ts';

export default defineConfig({
    ...base,
    test: {
        ...base.test,
        projects: undefined,
        environment: 'jsdom',
        include: ['audit-evidence/document-editor-review-20261024/*.probe.test.ts'],
        bail: 0,
        reporters: ['verbose'],
        silent: 'passed-only',
    },
});
