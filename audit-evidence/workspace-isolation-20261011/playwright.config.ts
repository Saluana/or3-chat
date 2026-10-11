// Container-only browser harness: use the already installed system Chromium.
import config from '../../playwright.config';
export default {
    ...config,
    testDir: `${process.cwd()}/tests/e2e`,
    workers: 1,
    projects: config.projects!.map(project => ({
        ...project,
        use: { ...project.use, launchOptions: { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] } },
    })),
    webServer: config.webServer ? { ...config.webServer, cwd: process.cwd() } : undefined,
};
