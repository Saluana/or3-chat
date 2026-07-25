/**
 * Fixed command-palette search/index benchmark.
 *
 * Measures:
 * - build-batch wall time (with yielding)
 * - warm Orama query p95
 * - fallback query
 * - grouped-hit reduction
 * - disposal
 *
 * Run:
 *   bun run command-palette:benchmarks:check
 *
 * Budgets (plan R12):
 * - warm query p95 <= 75ms (excluding debounce)
 * - indexing batch tasks ideally <= 50ms each (reported as max batch)
 */

import { PaletteSourceIndex } from '../source-index';
import { groupHitsByResource } from '../group-hits';
import type { PaletteResource } from '../types';

const RESOURCE_COUNT = 10_000;
const CHUNKS_PER_RESOURCE = 5;

function percentile(values: number[], p: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
    );
    return sorted[idx]!;
}

function makeResources(): PaletteResource[] {
    const resources: PaletteResource[] = [];
    for (let i = 0; i < RESOURCE_COUNT; i++) {
        const body = Array.from({ length: CHUNKS_PER_RESOURCE }, (_, chunk) =>
            `resource-${i} chunk-${chunk} lorem ipsum dolor sit amet consectetur adipiscing elit `.repeat(
                40
            )
        ).join('\n');
        resources.push({
            key: `bench:${i}`,
            sourceId: 'bench',
            categoryId: 'chat',
            recordId: String(i),
            title: `Bench resource ${i}`,
            content: body,
            updatedAt: i,
            revision: String(i),
            primaryAction: {
                id: `open-${i}`,
                label: 'Open',
                target: {
                    kind: 'chat',
                    threadId: String(i),
                    destination: 'active',
                },
            },
        });
    }
    return resources;
}

async function main(): Promise<void> {
    if (typeof window === 'undefined') {
        // Minimal window stub so Orama import guard passes under Bun.
        (globalThis as { window?: unknown }).window = globalThis;
    }

    const resources = makeResources();
    const index = new PaletteSourceIndex('bench');
    const batchDurations: number[] = [];

    const buildStarted = performance.now();
    await index.replaceAll(resources, {
        onBatchComplete: (durationMs) => batchDurations.push(durationMs),
    });
    const buildMs = performance.now() - buildStarted;
    const maxBatchMs = Math.max(0, ...batchDurations);

    const warmSamples: number[] = [];
    for (let i = 0; i < 30; i++) {
        const started = performance.now();
        await index.search({ term: `resource-${i * 97}` });
        warmSamples.push(performance.now() - started);
    }
    const warmP95 = percentile(warmSamples, 95);

    const fallbackStarted = performance.now();
    await index.search({ term: 'resource-42', forceFallback: true });
    const fallbackMs = performance.now() - fallbackStarted;

    const groupStarted = performance.now();
    groupHitsByResource(
        resources.slice(0, 100).flatMap((resource, idx) => [
            {
                score: 10 - (idx % 5),
                document: {
                    id: `${resource.key}:0`,
                    resourceKey: resource.key,
                    recordId: resource.recordId,
                    title: resource.title,
                    subtitle: '',
                    keywords: '',
                    body: resource.content?.slice(0, 200) ?? '',
                    updatedAt: resource.updatedAt ?? 0,
                    chunkIndex: 0,
                },
            },
            {
                score: 5,
                document: {
                    id: `${resource.key}:1`,
                    resourceKey: resource.key,
                    recordId: resource.recordId,
                    title: resource.title,
                    subtitle: '',
                    keywords: '',
                    body: resource.content?.slice(200, 400) ?? '',
                    updatedAt: resource.updatedAt ?? 0,
                    chunkIndex: 1,
                },
            },
        ]),
        new Map(resources.slice(0, 100).map((r) => [r.key, r])),
        'resource'
    );
    const groupMs = performance.now() - groupStarted;

    const disposeStarted = performance.now();
    index.dispose();
    const disposeMs = performance.now() - disposeStarted;

    const report = {
        resources: RESOURCE_COUNT,
        approxChunks: RESOURCE_COUNT * CHUNKS_PER_RESOURCE,
        buildMs: Number(buildMs.toFixed(2)),
        maxBatchMs: Number(maxBatchMs.toFixed(2)),
        warmQueryP95Ms: Number(warmP95.toFixed(2)),
        fallbackMs: Number(fallbackMs.toFixed(2)),
        groupMs: Number(groupMs.toFixed(2)),
        disposeMs: Number(disposeMs.toFixed(2)),
        budgets: {
            warmQueryP95Ms: 75,
            warmQueryP95Passed: warmP95 <= 75,
            maxBatchMs: 50,
            maxBatchPassed: maxBatchMs <= 50,
        },
    };

    console.log(JSON.stringify(report, null, 2));
    if (!report.budgets.warmQueryP95Passed) {
        console.error(
            `[benchmark] warm query p95 ${report.warmQueryP95Ms}ms exceeded 75ms budget`
        );
        process.exitCode = 1;
    }
    if (!report.budgets.maxBatchPassed) {
        console.error(
            `[benchmark] max indexing batch ${report.maxBatchMs}ms exceeded 50ms budget`
        );
        process.exitCode = 1;
    }
}

void main();
