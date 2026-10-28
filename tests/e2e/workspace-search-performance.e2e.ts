import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Real IndexedDB scheduling and structured-clone costs are not covered by the
// simulated database source regression. This fixture exercises production owners
// through Vite, without adding application exports or seeding an active workspace.
test.skip(
    process.env.OR3_E2E_PERFORMANCE !== 'true',
    'Use bun run test:e2e:workspace-scale'
);

interface ScaleRun {
    resources: number;
    digest: number;
    source: {
        maxRowsPerRead: number;
        readRows: number;
        maxHeartbeatGapMs: number;
        longTasks: number[];
    };
    queries: Array<{ ids: string[]; fallback: boolean }>;
    unicodeQuery: { ids: string[]; durationMs: number };
    fixture: { threads: number; messages: number };
}
interface ScaleProbe {
    seed(threads: number): Promise<unknown>;
    run(): Promise<ScaleRun>;
    abort(): Promise<{ aborted: boolean }>;
    close(): Promise<unknown>;
}
declare global {
    interface Window {
        __workspaceScale: ScaleProbe;
    }
}

for (const threads of [1000, 10000]) {
    test(`${threads} chats retain complete search coverage with bounded browser work`, async ({
        page,
        context,
    }, info) => {
        test.setTimeout(180_000);
        await context.route('**/*', (route) =>
            new URL(route.request().url()).origin ===
            String(info.project.use.baseURL)
                ? route.continue()
                : route.abort('blockedbyclient')
        );
        await page.goto('/chat');
        await page.getByRole('textbox', { name: 'Message input' }).waitFor();
        const script = await readFile(
            new URL('./fixtures/workspace-search-probe.js', import.meta.url),
            'utf8'
        );
        await page.evaluate(script);
        const client = await context.newCDPSession(page);
        const runs: ScaleRun[] = [];
        const cpuRate = Number(process.env.OR3_SCALE_CPU_RATE || 1);
        try {
            await page.evaluate(
                (threads) => window.__workspaceScale.seed(threads),
                threads
            );
            await client.send('Emulation.setCPUThrottlingRate', {
                rate: cpuRate,
            });
            for (let repeat = 0; repeat < 3; repeat++) {
                const run = await page.evaluate(() =>
                    window.__workspaceScale.run()
                );
                runs.push(run);
                expect(run.resources).toBe(threads);
                expect(run.source.readRows).toBe(
                    run.fixture.threads + run.fixture.messages
                );
                expect(run.source.maxRowsPerRead).toBeLessThanOrEqual(1000);
                for (const [index, query] of run.queries.entries()) {
                    expect(query.fallback).toBe(false);
                    expect(query.ids).toContain(
                        index % 2
                            ? 'thread-000000'
                            : `thread-${String(threads - 1).padStart(6, '0')}`
                    );
                }
                expect(run.unicodeQuery.ids).toContain(
                    `thread-${String(threads - 1).padStart(6, '0')}`
                );
                // A responsive-source budget; not a claim about end-to-end INP.
                expect(run.source.maxHeartbeatGapMs).toBeLessThanOrEqual(
                    Number(process.env.OR3_SCALE_MAX_GAP_MS || 150)
                );
            }
            expect(
                await page.evaluate(() => window.__workspaceScale.abort())
            ).toMatchObject({ aborted: true });
        } finally {
            const report = JSON.stringify({ cpuRate, runs }, null, 2);
            await writeFile(
                info.outputPath('workspace-search-scale.json'),
                report
            );
            await info.attach('workspace-search-scale', {
                contentType: 'application/json',
                body: report,
            });
            await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
            await client.detach();
            await page.evaluate(() => window.__workspaceScale?.close());
        }
    });
}
