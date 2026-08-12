import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
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

type ReferencedArtifactStats = {
    files: number;
    rawBytes: number;
    gzipBytes: number;
    missing: string[];
};

type PrecacheStats = ReferencedArtifactStats & {
    present: boolean;
};

type ResourceHintStats = {
    present: boolean;
    modulepreload: ReferencedArtifactStats;
    prefetch: ReferencedArtifactStats;
};

type CompressionStats = {
    eligibleFiles: number;
    gzipFiles: number;
    brotliFiles: number;
    missingGzip: string[];
    missingBrotli: string[];
};

export type ProductionBuildStats = {
    javascript: ArtifactStats;
    css: ArtifactStats;
    precache: PrecacheStats;
    rootHtml: ResourceHintStats;
    compression: CompressionStats;
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

function localPublicPath(publicRoot: string, url: string): string | null {
    if (/^[a-z][a-z\d+.-]*:/i.test(url)) return null;
    const rawPath = url.split(/[?#]/, 1)[0]?.replace(/^\/+/, '');
    if (!rawPath) return null;

    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(rawPath);
    } catch {
        return null;
    }

    const path = resolve(publicRoot, decodedPath);
    const relativePath = relative(publicRoot, path);
    if (
        relativePath === '..' ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
    ) {
        return null;
    }
    return path;
}

function summarizeReferences(
    publicRoot: string,
    urls: string[]
): ReferencedArtifactStats {
    const uniqueUrls = [...new Set(urls)];
    let rawBytes = 0;
    let gzipBytes = 0;
    const missing: string[] = [];

    for (const url of uniqueUrls) {
        const path = localPublicPath(publicRoot, url);
        if (!path || !existsSync(path)) {
            missing.push(url);
            continue;
        }
        const contents = readFileSync(path);
        rawBytes += contents.byteLength;
        gzipBytes += gzipSync(contents, { level: 9 }).byteLength;
    }

    return {
        files: uniqueUrls.length,
        rawBytes,
        gzipBytes,
        missing,
    };
}

function arrayAfterMarker(source: string, marker: string): string | null {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) return null;
    const start = source.indexOf('[', markerIndex + marker.length);
    if (start < 0) return null;

    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
        const char = source[index]!;
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '[') depth += 1;
        else if (char === ']') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    return null;
}

function inspectPrecache(publicRoot: string): PrecacheStats {
    const swPath = resolve(publicRoot, 'sw.js');
    if (!existsSync(swPath)) {
        return {
            present: false,
            files: 0,
            rawBytes: 0,
            gzipBytes: 0,
            missing: [],
        };
    }

    const source = readFileSync(swPath, 'utf8');
    const manifest = arrayAfterMarker(source, 'precacheAndRoute(');
    if (!manifest) {
        return {
            present: false,
            files: 0,
            rawBytes: 0,
            gzipBytes: 0,
            missing: ['public/sw.js:precache-manifest'],
        };
    }

    const urls = [...manifest.matchAll(/\burl:"((?:\\.|[^"\\])*)"/g)].map(
        (match) => JSON.parse(`"${match[1]}"`) as string
    );
    return {
        present: true,
        ...summarizeReferences(publicRoot, urls),
    };
}

function linkAttributes(tag: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
        attributes[match[1]!.toLowerCase()] = match[3]!;
    }
    return attributes;
}

function inspectRootHtml(publicRoot: string): ResourceHintStats {
    const htmlPath = resolve(publicRoot, 'index.html');
    const empty = (): ReferencedArtifactStats => ({
        files: 0,
        rawBytes: 0,
        gzipBytes: 0,
        missing: [],
    });
    if (!existsSync(htmlPath)) {
        return {
            present: false,
            modulepreload: empty(),
            prefetch: empty(),
        };
    }

    const html = readFileSync(htmlPath, 'utf8');
    const urls: Record<'modulepreload' | 'prefetch', string[]> = {
        modulepreload: [],
        prefetch: [],
    };
    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
        const attributes = linkAttributes(match[0]);
        const rel = attributes.rel?.toLowerCase();
        if (
            (rel === 'modulepreload' || rel === 'prefetch') &&
            attributes.href
        ) {
            urls[rel].push(attributes.href);
        }
    }

    return {
        present: true,
        modulepreload: summarizeReferences(publicRoot, urls.modulepreload),
        prefetch: summarizeReferences(publicRoot, urls.prefetch),
    };
}

function inspectCompression(
    outputRoot: string,
    publicRoot: string
): CompressionStats {
    const eligible = ['.js', '.css', '.html']
        .flatMap((extension) => artifactFiles(publicRoot, extension))
        .filter((path) => statSync(path).size >= 1024)
        .filter((path) => {
            // vite-plugin-pwa emits these after Nitro's public-asset
            // compression phase, so they cannot have Nitro sidecars.
            const publicPath = relative(publicRoot, path)
                .split(sep)
                .join('/');
            return (
                publicPath !== 'sw.js' &&
                !/^workbox-[^/]+\.js$/.test(publicPath)
            );
        });
    const missingGzip = eligible.filter((path) => !existsSync(`${path}.gz`));
    const missingBrotli = eligible.filter((path) => !existsSync(`${path}.br`));
    return {
        eligibleFiles: eligible.length,
        gzipFiles: eligible.length - missingGzip.length,
        brotliFiles: eligible.length - missingBrotli.length,
        missingGzip: missingGzip.map((path) => relative(outputRoot, path)),
        missingBrotli: missingBrotli.map((path) => relative(outputRoot, path)),
    };
}

export function inspectProductionBuild(
    outputRoot = resolve(process.cwd(), '.output')
): ProductionBuildStats {
    const assetRoot = resolve(outputRoot, 'public', '_nuxt');
    const publicRoot = resolve(outputRoot, 'public');
    if (!existsSync(assetRoot)) {
        throw new Error(
            `Production client assets are missing at ${relative(process.cwd(), assetRoot)}. Run bun run build or bun run generate:static first.`
        );
    }
    return {
        javascript: summarize(outputRoot, artifactFiles(assetRoot, '.js')),
        css: summarize(outputRoot, artifactFiles(assetRoot, '.css')),
        precache: inspectPrecache(publicRoot),
        rootHtml: inspectRootHtml(publicRoot),
        compression: inspectCompression(outputRoot, publicRoot),
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
    if (!stats.precache.present) {
        throw new Error('Production build is missing a readable PWA precache manifest');
    }
    if (!stats.rootHtml.present) {
        throw new Error('Production build is missing public/index.html');
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
            1_000_000
        ),
        totalCssGzipBytes: positiveNumber(
            process.env.OR3_PERF_MAX_TOTAL_CSS_GZIP_BYTES,
            150_000
        ),
        precacheFiles: positiveNumber(
            process.env.OR3_PERF_MAX_PRECACHE_FILES,
            490
        ),
        precacheRawBytes: positiveNumber(
            process.env.OR3_PERF_MAX_PRECACHE_BYTES,
            17_500_000
        ),
        rootModulepreloadFiles: positiveNumber(
            process.env.OR3_PERF_MAX_ROOT_MODULEPRELOAD_FILES,
            185
        ),
        rootModulepreloadGzipBytes: positiveNumber(
            process.env.OR3_PERF_MAX_ROOT_MODULEPRELOAD_GZIP_BYTES,
            1_200_000
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
        precacheFiles: maxBudget(
            stats.precache.files,
            limits.precacheFiles
        ),
        precacheRawBytes: maxBudget(
            stats.precache.rawBytes,
            limits.precacheRawBytes
        ),
        rootModulepreloadFiles: maxBudget(
            stats.rootHtml.modulepreload.files,
            limits.rootModulepreloadFiles
        ),
        rootModulepreloadGzipBytes: maxBudget(
            stats.rootHtml.modulepreload.gzipBytes,
            limits.rootModulepreloadGzipBytes
        ),
        rootPrefetchFiles: maxBudget(stats.rootHtml.prefetch.files, 0),
        missingPrecacheFiles: maxBudget(stats.precache.missing.length, 0),
        missingRootHintFiles: maxBudget(
            stats.rootHtml.modulepreload.missing.length +
                stats.rootHtml.prefetch.missing.length,
            0
        ),
        missingGzipFiles: maxBudget(stats.compression.missingGzip.length, 0),
        missingBrotliFiles: maxBudget(
            stats.compression.missingBrotli.length,
            0
        ),
    };

    const reportPath = writePerformanceReport('production-build-assets', {
        benchmark: 'production-build-assets',
        stats,
        budgets,
    });
    assertBudgets('production-build-assets', budgets);
    console.log(
        `[production-build-assets] ${stats.javascript.files} JS, ${stats.css.files} CSS, ${stats.precache.files} precache entries, and ${stats.rootHtml.modulepreload.files} root modulepreloads are within budget; report=${relative(process.cwd(), reportPath)}`
    );
}
