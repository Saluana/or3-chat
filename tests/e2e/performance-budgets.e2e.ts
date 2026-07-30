import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

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

test('browser Core Web Vitals stay inside release budgets', async ({
    page,
}, testInfo) => {
    await page.addInitScript(() => {
        const state = {
            fcpMs: 0,
            lcpMs: 0,
            cls: 0,
            inpMs: 0,
            totalBlockingTimeMs: 0,
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
            } catch {
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

    // Warm dev-server compilation before measuring a fresh document.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/?performance-gate=1', {
        waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1_500);
    await page.mouse.click(20, 20);
    await page.waitForTimeout(500);
    await expect(page.locator('body')).not.toBeEmpty();

    const metrics = await page.evaluate<BrowserMetrics>(() => {
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

    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        commit: process.env.GITHUB_SHA || null,
        browser: testInfo.project.name,
        metrics,
        budgets,
        passed: Object.entries(budgets).every(
            ([metric, limit]) =>
                metrics[metric as keyof BrowserMetrics] <= limit
        ),
    };
    const outputDir = resolve(process.cwd(), 'output/playwright');
    mkdirSync(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, 'browser-performance-vitals.json');
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await testInfo.attach('browser-performance-vitals', {
        body: Buffer.from(JSON.stringify(report, null, 2)),
        contentType: 'application/json',
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
});
