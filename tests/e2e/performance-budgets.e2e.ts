import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

type BrowserMetrics = {
    fcpMs: number;
    lcpMs: number;
    cls: number;
    inpMs: number;
    totalBlockingTimeMs: number;
    domContentLoadedMs: number;
};

const budgets = {
    fcpMs: Number(process.env.OR3_PERF_MAX_FCP_MS || 1_800),
    lcpMs: Number(process.env.OR3_PERF_MAX_LCP_MS || 2_500),
    cls: Number(process.env.OR3_PERF_MAX_CLS || 0.1),
    inpMs: Number(process.env.OR3_PERF_MAX_INP_MS || 200),
    totalBlockingTimeMs: Number(process.env.OR3_PERF_MAX_TBT_MS || 300),
    domContentLoadedMs: Number(process.env.OR3_PERF_MAX_DCL_MS || 2_500),
};

test.skip(
    process.env.OR3_E2E_PERFORMANCE !== 'true',
    'Performance budgets require OR3_E2E_PERFORMANCE=true'
);

for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 720 }],
    ['mobile', { width: 390, height: 844 }],
] as const) {
    test(`initial ${name} shell reserves responsive geometry before hydration`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({
            baseURL: String(testInfo.project.use.baseURL),
            viewport,
            javaScriptEnabled: false,
        });
        try {
            const page = await context.newPage();
            await page.goto('/', { waitUntil: 'load' });
            await page.locator('#main-content').waitFor({ state: 'attached' });
            const geometry = await page.evaluate(() => {
                const rectangle = (id: string) => document.getElementById(id)!.getBoundingClientRect().toJSON();
                const sidebar = getComputedStyle(document.getElementById('sidebar')!);
                return {
                    root: rectangle('page-container'),
                    sidebar: rectangle('sidebar'),
                    main: rectangle('main-content'),
                    sidebarWidth: sidebar.width,
                    sidebarMaxWidth: sidebar.maxWidth,
                    directDivs: Array.from(document.querySelectorAll<HTMLElement>('#__nuxt > div')).map((element) => ({
                        id: element.id,
                        empty: element.matches(':empty'),
                        rectangle: element.getBoundingClientRect().toJSON(),
                        display: getComputedStyle(element).display,
                        height: getComputedStyle(element).height,
                    })),
                };
            });
            await testInfo.attach('initial-shell-geometry', {
                body: Buffer.from(JSON.stringify({ viewport, geometry }, null, 2)),
                contentType: 'application/json',
            });
            await testInfo.attach('initial-shell', {
                body: await page.screenshot(), contentType: 'image/png',
            });
            expect(geometry.root.width, 'SSR shell must fill the viewport').toBeCloseTo(viewport.width, 0);
            expect(geometry.root.height).toBeCloseTo(viewport.height, 0);
            expect(geometry.root.x).toBeCloseTo(0, 0);
            expect(geometry.root.y, 'empty SSR placeholders must not displace the application').toBeCloseTo(0, 0);
            for (const placeholder of geometry.directDivs.filter((element) => element.empty)) {
                expect(placeholder.display, 'empty client placeholders retain their normal display').toBe('block');
                expect(placeholder.rectangle.height, 'empty client placeholders reserve no content height').toBe(0);
            }
            if (name === 'desktop') {
                expect(geometry.sidebar.width, 'desktop width must be reserved before JavaScript').toBeCloseTo(320, 0);
                expect(geometry.main.x).toBeCloseTo(320, 0);
                expect(geometry.main.width, 'main content must have its final initial width').toBeCloseTo(viewport.width - 320, 0);
                expect(geometry.sidebarMaxWidth).toBe('none');
            } else {
                expect(geometry.sidebar.width, 'mobile drawer must retain full viewport width').toBeCloseTo(viewport.width, 0);
                expect(geometry.main.x).toBeCloseTo(0, 0);
                expect(geometry.main.width).toBeCloseTo(viewport.width, 0);
                expect(geometry.sidebarMaxWidth).toBe(`${viewport.width}px`);
            }
        } finally {
            await context.close();
        }
    });
}

async function waitForFunctionalChat(page: Page): Promise<void> {
    // Dev imports can still be optimizing after load; interact with the mounted
    // editor only after its visible DOM and dependency graph are ready.
    await page.waitForFunction(() =>
        (window as typeof window & { __OR3_APP_INIT_FIRED__?: boolean }).__OR3_APP_INIT_FIRED__ === true
    );
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.waitFor({ state: 'visible' });
    await page.waitForLoadState('networkidle');
    await expect(input).toBeVisible();
    // The existing public preview makes the real welcome layer deterministic,
    // including after reload, without racing its asynchronous preference read.
    const dismiss = page.getByRole('button', { name: 'Dismiss welcome' });
    await dismiss.waitFor({ state: 'visible' });
    await dismiss.click();
    await expect(page.locator('[data-welcome-backdrop]')).toBeHidden();
}

test('client error recovery remains visible and dismissible after shell sizing', async ({ page }, testInfo) => {
    await page.route(/(?:openrouter\.ai\/|\/api\/openrouter\/)/, (route) =>
        route.request().method() === 'POST'
            ? route.abort('blockedbyclient')
            : route.fulfill({ json: { data: [] } })
    );
    await page.goto('/chat?welcome=1');
    await waitForFunctionalChat(page);
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'rejected-fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('Disposable unsupported attachment') });
    await expect(page.getByText('Attachment not accepted', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Details', exact: true }).first().click();
    const details = page.getByRole('dialog', { name: 'Error details', exact: true });
    await expect(details).toBeVisible();
    await expect(details).toBeInViewport({ ratio: 1 });
    await expect(details.locator('pre')).toContainText('ERR_FILE_VALIDATION');
    await testInfo.attach('client-error-recovery', {
        body: await page.screenshot(), contentType: 'image/png',
    });
    await details.locator('[data-slot="footer"]').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(details).toBeHidden();
    await input.fill('Recovered locally');
    await expect(input).toHaveText('Recovered locally');
    const root = await page.locator('#page-container').boundingBox();
    const viewport = page.viewportSize()!;
    expect(root!.x).toBeCloseTo(0, 0);
    expect(root!.y).toBeCloseTo(0, 0);
    expect(root!.width).toBeCloseTo(viewport.width, 0);
    expect(root!.height, 'the populated application wrapper retains full height after recovery').toBeCloseTo(viewport.height, 0);
});

test('sidebar resizing persists through collapse and responsive changes', async ({ page }, testInfo) => {
    await page.route(/(?:openrouter\.ai\/|\/api\/openrouter\/)/, (route) =>
        route.request().method() === 'POST'
            ? route.abort('blockedbyclient')
            : route.fulfill({ json: { data: [] } })
    );
    await page.goto('/chat?welcome=1');
    await waitForFunctionalChat(page);
    const sidebar = page.getByTestId('sidebar');
    const handle = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
    await expect(handle).toHaveAttribute('aria-valuenow', '320');
    await handle.focus();
    await handle.press('ArrowRight');
    await expect(handle).toBeFocused();
    await expect(handle).toHaveAttribute('aria-valuenow', '336');
    await expect(sidebar).toHaveCSS('width', '336px');
    await page.reload();
    await waitForFunctionalChat(page);
    await expect(handle).toHaveAttribute('aria-valuenow', '336');
    await expect(sidebar).toHaveCSS('width', '336px');
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await expect(sidebar).toHaveCSS('width', '64px');
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(sidebar).toHaveCSS('width', '336px');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(sidebar).toHaveCSS('width', '390px');
    await expect(sidebar).toHaveAttribute('inert', '');
    const open = page.getByRole('button', { name: 'Open sidebar', exact: true });
    await open.click();
    await expect(sidebar).not.toHaveAttribute('inert', '');
    await expect.poll(() => sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await testInfo.attach('resized-mobile-sidebar', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(sidebar).toHaveAttribute('inert', '');
    await expect(open).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(sidebar).toHaveCSS('width', '336px');
    await expect(handle).toHaveAttribute('aria-valuenow', '336');
});

test('browser Core Web Vitals stay inside release budgets', async ({
    page,
    context,
}, testInfo) => {
    let metrics: BrowserMetrics | null = null;
    let passed = false;
    const events: Array<Record<string, unknown>> = [];
    const documents: string[] = [];
    const record = (phase: string, event: string, detail: unknown) => {
        events.push({ at: new Date().toISOString(), phase, event, detail });
    };
    const capture = (target: Page, phase: string) => {
        target.on('console', (message) => record(phase, 'console', {
            type: message.type(), text: message.text(),
        }));
        target.on('pageerror', (error) => record(phase, 'pageerror', String(error)));
        target.on('request', (request) => {
            record(phase, 'resource', { url: request.url(), type: request.resourceType() });
            if (phase === 'measurement' && request.isNavigationRequest() && request.frame() === target.mainFrame()) {
                documents.push(request.url());
            }
        });
        target.on('requestfailed', (request) => record(phase, 'requestfailed', {
            url: request.url(), failure: request.failure(),
        }));
        target.on('framenavigated', (frame) => {
            if (frame === target.mainFrame()) record(phase, 'navigation', frame.url());
        });
        target.on('websocket', (socket) => {
            socket.on('framereceived', ({ payload }) => {
                if (String(payload).includes('full-reload')) record(phase, 'reload', String(payload));
            });
        });
    };
    capture(page, 'measurement');
    await page.addInitScript(() => {
        const state = {
            fcpMs: 0,
            lcpMs: 0,
            cls: 0,
            inpMs: 0,
            totalBlockingTimeMs: 0,
            observerErrors: [] as string[],
            layoutShifts: [] as unknown[],
        };
        Object.defineProperty(window, '__or3PerformanceMetrics', {
            value: state,
            configurable: true,
        });

        const observe = (
            type: string,
            callback: (entries: PerformanceEntry[]) => void,
            init: PerformanceObserverInit = { type, buffered: true }
        ) => {
            try {
                new PerformanceObserver((list) => {
                    callback(list.getEntries());
                }).observe(init);
            } catch (error) {
                state.observerErrors.push(`${type}: ${String(error)}`);
                // Unsupported entry types stay at zero and fail the evidence check.
            }
        };
        observe('paint', (entries) => {
            for (const entry of entries) {
                if (entry.name === 'first-contentful-paint') {
                    state.fcpMs = entry.startTime;
                }
            }
        });
        observe('largest-contentful-paint', (entries) => {
            for (const entry of entries) {
                state.lcpMs = entry.startTime;
            }
        });
        observe('layout-shift', (entries) => {
            for (const entry of entries as Array<
                PerformanceEntry & { value?: number; hadRecentInput?: boolean }
            >) {
                if (!entry.hadRecentInput) {
                    state.cls += entry.value || 0;
                    state.layoutShifts.push(entry.toJSON());
                }
            }
        });
        observe('longtask', (entries) => {
            for (const entry of entries) {
                state.totalBlockingTimeMs += Math.max(0, entry.duration - 50);
            }
        });
        observe('event', (entries) => {
            for (const entry of entries) {
                state.inpMs = Math.max(state.inpMs, entry.duration);
            }
        }, {
            type: 'event',
            buffered: true,
            durationThreshold: 16,
        } as PerformanceObserverInit);
    });

    const warmPage = await context.newPage();
    capture(warmPage, 'warmup');
    try {
        // DCL precedes hydration and lazy dependency optimization. Warm the actual
        // mounted UI through any dev reloads, then measure an independent document.
        await warmPage.goto('/', { waitUntil: 'domcontentloaded' });
        await warmPage.waitForFunction(() =>
            (window as typeof window & { __OR3_APP_INIT_FIRED__?: boolean }).__OR3_APP_INIT_FIRED__ === true
            && performance.getEntriesByName('first-contentful-paint').length > 0
        );
        await expect(warmPage.getByRole('textbox', { name: 'Message input' })).toBeVisible();
        await warmPage.waitForLoadState('networkidle');
        record('warmup', 'ready', await warmPage.evaluate(() => ({
            url: location.href, timeOrigin: performance.timeOrigin,
            visibility: document.visibilityState, readyState: document.readyState,
        })));
        await warmPage.close();
        await page.goto('/?performance-gate=1', {
            waitUntil: 'domcontentloaded',
        });
        const measuredTimeOrigin = await page.evaluate(() => performance.timeOrigin);
        await page.waitForFunction(() => {
            const state = (window as typeof window & {
                __or3PerformanceMetrics?: { fcpMs: number; lcpMs: number };
                __OR3_APP_INIT_FIRED__?: boolean;
            });
            return state.__OR3_APP_INIT_FIRED__ === true
                && document.visibilityState === 'visible'
                && (state.__or3PerformanceMetrics?.fcpMs ?? 0) > 0
                && (state.__or3PerformanceMetrics?.lcpMs ?? 0) > 0;
        });
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await page.mouse.click(20, 20);
        await page.evaluate(() => new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done()))
        ));
        await expect(page.locator('body')).not.toBeEmpty();
        expect(documents, 'measurement must retain its one fresh document').toHaveLength(1);
        expect(await page.evaluate(() => performance.timeOrigin), 'measured document must not reload').toBe(measuredTimeOrigin);

        metrics = await page.evaluate<BrowserMetrics>(() => {
            const observed = (
                window as typeof window & {
                    __or3PerformanceMetrics: Omit<
                        BrowserMetrics,
                        'domContentLoadedMs'
                    >;
                }
            ).__or3PerformanceMetrics;
            const navigation = performance.getEntriesByType(
                'navigation'
            )[0] as PerformanceNavigationTiming | undefined;
            const fcp = performance.getEntriesByName(
                'first-contentful-paint'
            )[0];
            return {
                ...observed,
                fcpMs: observed.fcpMs || fcp?.startTime || 0,
                domContentLoadedMs:
                    navigation?.domContentLoadedEventEnd ||
                    performance.now(),
            };
        });

        expect(metrics.fcpMs, 'FCP evidence must be observed').toBeGreaterThan(0);
        expect(metrics.lcpMs, 'LCP evidence must be observed').toBeGreaterThan(0);
        expect(
            metrics.domContentLoadedMs,
            'navigation evidence must be observed'
        ).toBeGreaterThan(0);
        expect(metrics.fcpMs, 'First Contentful Paint').toBeLessThanOrEqual(
            budgets.fcpMs
        );
        expect(metrics.lcpMs, 'Largest Contentful Paint').toBeLessThanOrEqual(
            budgets.lcpMs
        );
        expect(metrics.cls, 'Cumulative Layout Shift').toBeLessThanOrEqual(
            budgets.cls
        );
        expect(metrics.inpMs, 'Interaction to Next Paint').toBeLessThanOrEqual(
            budgets.inpMs
        );
        expect(metrics.totalBlockingTimeMs, 'Total Blocking Time').toBeLessThanOrEqual(
            budgets.totalBlockingTimeMs
        );
        expect(
            metrics.domContentLoadedMs,
            'DOM Content Loaded'
        ).toBeLessThanOrEqual(budgets.domContentLoadedMs);
        // Only the complete evidence and budget assertions can qualify this attempt.
        passed = true;
    } catch (error) {
        record('test', 'failure', String(error));
        throw error;
    } finally {
        if (!warmPage.isClosed()) await warmPage.close();
        const diagnostics = await page.evaluate(() => ({
            url: location.href, timeOrigin: performance.timeOrigin,
            visibility: document.visibilityState, readyState: document.readyState,
            observer: (window as typeof window & { __or3PerformanceMetrics?: unknown }).__or3PerformanceMetrics,
            navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
            paint: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
        })).catch((error: unknown) => ({ error: String(error) }));
        const report = {
            schemaVersion: 2,
            generatedAt: new Date().toISOString(),
            commit: process.env.GITHUB_SHA || null,
            browser: testInfo.project.name,
            profile: process.env.NODE_ENV || 'development',
            retry: testInfo.retry,
            repeat: testInfo.repeatEachIndex,
            metrics, budgets, passed, documents, diagnostics, events,
        };
        const outputDir = resolve(process.cwd(), 'output/playwright');
        mkdirSync(outputDir, { recursive: true });
        const filename = `browser-performance-vitals-${testInfo.project.name}-${testInfo.repeatEachIndex}-${testInfo.retry}-${Date.now()}.json`;
        const contents = `${JSON.stringify(report, null, 2)}\n`;
        writeFileSync(resolve(outputDir, filename), contents, 'utf8');
        writeFileSync(testInfo.outputPath('browser-performance-vitals.json'), contents, 'utf8');
        await testInfo.attach('browser-performance-vitals', {
            body: Buffer.from(contents), contentType: 'application/json',
        });
    }
});
