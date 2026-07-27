import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
    assertBudgets,
    maxBudget,
    positiveNumber,
    writePerformanceReport,
} from './report';

type ArtifactStats = {
    files: number;
    rawBytes: number;
    gzipBytes: number;
    largest: {
        path: string;
        rawBytes: number;
        gzipBytes: number;
    } | null;
};

export type ProductionBuildStats = {
    javascript: ArtifactStats;
    css: ArtifactStats;
};

function artifactFiles(root: string, extension: string): string[] {
    if (!existsSync(root)) return [];
    const files: string[] = [];
    const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (extname(entry.name) === extension) files.push(path);
        }
    };
    visit(root);
    return files.sort();
}

function summarize(root: string, files: string[]): ArtifactStats {
    const artifacts = files.map((path) => {
        const contents = readFileSync(path);
        return {
            path: relative(root, path),
            rawBytes: statSync(path).size,
            gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
        };
    });
    const largest = artifacts.reduce<(typeof artifacts)[number] | null>(
        (current, artifact) =>
            !current || artifact.rawBytes > current.rawBytes
                ? artifact
                : current,
        null
    );
    return {
        files: artifacts.length,
        rawBytes: artifacts.reduce(
            (total, artifact) => total + artifact.rawBytes,
            0
        ),
        gzipBytes: artifacts.reduce(
            (total, artifact) => total + artifact.gzipBytes,
            0
        ),
        largest,
    };
}

export function inspectProductionBuild(
    outputRoot = resolve(process.cwd(), '.output')
): ProductionBuildStats {
    const assetRoot = resolve(outputRoot, 'public', '_nuxt');
    if (!existsSync(assetRoot)) {
        throw new Error(
            `Production client assets are missing at ${relative(process.cwd(), assetRoot)}. Run bun run build or bun run generate:static first.`
        );
    }
    return {
        javascript: summarize(outputRoot, artifactFiles(assetRoot, '.js')),
        css: summarize(outputRoot, artifactFiles(assetRoot, '.css')),
    };
}

if (import.meta.main) {
    const stats = inspectProductionBuild();
    if (stats.javascript.files === 0) {
        throw new Error('Production build contains no JavaScript assets');
    }
    if (stats.css.files === 0) {
        throw new Error('Production build contains no CSS assets');
    }

    const limits = {
        totalJavascriptRawBytes: positiveNumber(
            process.env.OR3_PERF_MAX_TOTAL_JS_BYTES,
            12_000_000
        ),
        totalJavascriptGzipBytes: positiveNumber(
            process.env.OR3_PERF_MAX_TOTAL_JS_GZIP_BYTES,
            4_000_000
        ),
        largestJavascriptRawBytes: positiveNumber(
            process.env.OR3_PERF_MAX_CHUNK_JS_BYTES,
            2_200_000
        ),
        largestJavascriptGzipBytes: positiveNumber(
            process.env.OR3_PERF_MAX_CHUNK_JS_GZIP_BYTES,
            1_100_000
        ),
        totalCssRawBytes: positiveNumber(
            process.env.OR3_PERF_MAX_TOTAL_CSS_BYTES,
            800_000
        ),
        totalCssGzipBytes: positiveNumber(
            process.env.OR3_PERF_MAX_TOTAL_CSS_GZIP_BYTES,
            140_000
        ),
    };
    const budgets = {
        totalJavascriptRawBytes: maxBudget(
            stats.javascript.rawBytes,
            limits.totalJavascriptRawBytes
        ),
        totalJavascriptGzipBytes: maxBudget(
            stats.javascript.gzipBytes,
            limits.totalJavascriptGzipBytes
        ),
        largestJavascriptRawBytes: maxBudget(
            stats.javascript.largest?.rawBytes ?? 0,
            limits.largestJavascriptRawBytes
        ),
        largestJavascriptGzipBytes: maxBudget(
            stats.javascript.largest?.gzipBytes ?? 0,
            limits.largestJavascriptGzipBytes
        ),
        totalCssRawBytes: maxBudget(
            stats.css.rawBytes,
            limits.totalCssRawBytes
        ),
        totalCssGzipBytes: maxBudget(
            stats.css.gzipBytes,
            limits.totalCssGzipBytes
        ),
    };

    const reportPath = writePerformanceReport('production-build-assets', {
        benchmark: 'production-build-assets',
        stats,
        budgets,
    });
    assertBudgets('production-build-assets', budgets);
    console.log(
        `[production-build-assets] ${stats.javascript.files} JS and ${stats.css.files} CSS assets are within budget; report=${relative(process.cwd(), reportPath)}`
    );
}
