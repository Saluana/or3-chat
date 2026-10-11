import config from './playwright.config';
export default {
    ...config,
    testDir: new URL('./', import.meta.url).pathname,
    testMatch: 'gallery-browser.e2e.ts',
    outputDir: new URL('./gallery-browser-artifacts/', import.meta.url).pathname,
    use: { ...config.use, trace: 'on', screenshot: 'on' },
    webServer: config.webServer ? { ...config.webServer, reuseExistingServer: false } : undefined,
};
