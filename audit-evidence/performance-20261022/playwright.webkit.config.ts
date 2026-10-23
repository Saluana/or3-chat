import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

// Opt-in audit only; the repository's regular test matrix remains unchanged.
export default defineConfig({
    ...base,
    testDir: '../../tests/e2e',
    projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
});
