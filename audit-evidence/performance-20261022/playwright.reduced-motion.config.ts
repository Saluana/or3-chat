import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

// Opt-in audit matrix; exercise existing journeys with the OS motion preference.
export default defineConfig({
    ...base,
    testDir: '../../tests/e2e',
    projects: [
        { name: 'chromium-reduced', use: { browserName: 'chromium', reducedMotion: 'reduce' } },
        { name: 'webkit-reduced', use: { browserName: 'webkit', reducedMotion: 'reduce' } },
    ],
});
