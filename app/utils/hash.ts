import { reportError, err } from '~/utils/errors';
/**
 * Hashing utilities for file deduplication.
 * - New files use SHA-256 with `sha256:` prefix.
 * - Legacy MD5 hashes remain supported for reads/verification.
 *
 * Optimizations:
 * - Cached SparkMD5 module to avoid repeated dynamic imports
 * - Pre-allocated hex lookup table for O(n) conversion
 * - Adaptive yielding: scheduler.yield() → requestIdleCallback → setTimeout
 */

const CHUNK_SIZE = 256 * 1024; // 256KB
const WEBCRYPTO_THRESHOLD = 8 * 1024 * 1024; // 8MB - covers ~95% of files
const SHA256_HEX_LENGTH = 64;
const MD5_HEX_LENGTH = 32;
const HEX_REGEX = /^[a-f0-9]+$/;

export type HashAlgorithm = 'sha256' | 'md5';

export interface ParsedHash {
    algorithm: HashAlgorithm;
    hex: string;
    full: string;
}

type SparkMd5ArrayBuffer = {
    append(data: ArrayBuffer | ArrayBufferView): SparkMd5ArrayBuffer;
    end(raw?: boolean): string;
};

type SparkMd5Module = {
    ArrayBuffer: new () => SparkMd5ArrayBuffer;
};

// Cached SparkMD5 module to avoid repeated dynamic imports
let sparkCache: SparkMd5Module | null = null;

async function loadSpark(): Promise<SparkMd5Module> {
    if (sparkCache) return sparkCache;
    const mod = (await import('spark-md5')) as { default: SparkMd5Module };
    sparkCache = mod.default;
    return sparkCache;
}

// Pre-allocated hex lookup table for O(n) conversion (2x faster than string concat)
const HEX_LOOKUP: string[] = Array.from({ length: 256 }, (_, i) =>
    i.toString(16).padStart(2, '0')
);

function bufferToHex(buf: Uint8Array): string {
    const hexArray = new Array<string>(buf.length);
    for (let i = 0; i < buf.length; i++) {
        // Uint8Array index access can be typed as number | undefined under some TS/lib combos
        const b = buf[i];
        hexArray[i] = HEX_LOOKUP[b ?? 0] ?? '00';
    }
    return hexArray.join('');
}

// Adaptive yielding with fallback chain for 60fps during large file uploads
async function yieldToMain(): Promise<void> {
    // scheduler.yield() is the most efficient (Chromium 115+)
    const sched = (globalThis as unknown as { scheduler?: unknown }).scheduler;
    if (sched && typeof (sched as { yield?: unknown }).yield === 'function') {
        return (sched as { yield: () => Promise<void> }).yield();
    }
    // requestIdleCallback for browsers that support it
    if (
        typeof globalThis !== 'undefined' &&
        'requestIdleCallback' in globalThis
    ) {
        return new Promise((resolve) =>
            (
                globalThis as unknown as {
                    requestIdleCallback: (cb: () => void) => void;
                }
            ).requestIdleCallback(() => resolve())
        );
    }
    // Fallback to setTimeout
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export function parseHash(hash: string): ParsedHash | null {
    if (!hash) return null;
    const trimmed = hash.trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed.startsWith('sha256:')) {
        const hex = trimmed.slice(7);
        if (hex.length !== SHA256_HEX_LENGTH || !HEX_REGEX.test(hex))
            return null;
        return { algorithm: 'sha256', hex, full: `sha256:${hex}` };
    }
    if (trimmed.startsWith('md5:')) {
        const hex = trimmed.slice(4);
        if (hex.length !== MD5_HEX_LENGTH || !HEX_REGEX.test(hex)) return null;
        return { algorithm: 'md5', hex, full: `md5:${hex}` };
    }
    if (trimmed.length === MD5_HEX_LENGTH && HEX_REGEX.test(trimmed)) {
        return { algorithm: 'md5', hex: trimmed, full: `md5:${trimmed}` };
    }
    return null;
}

export function formatHash(algorithm: HashAlgorithm, hex: string): string {
    return `${algorithm}:${hex.toLowerCase()}`;
}

export function isValidHash(hash: string): boolean {
    return parseHash(hash) !== null;
}

/** Compute hash hex (lowercase) using the requested algorithm. */
export async function computeHashHex(
    blob: Blob,
    algorithm: HashAlgorithm
): Promise<string> {
    if (algorithm === 'sha256') {
        const dev = import.meta.dev;
        const hasPerf = typeof performance !== 'undefined';
        const markId =
            dev && hasPerf
                ? `hash-${Date.now()}-${Math.random().toString(36).slice(2)}`
                : undefined;
        if (markId && hasPerf) performance.mark(`${markId}:start`);
        try {
            const canUseSubtle =
                typeof crypto !== 'undefined' &&
                typeof crypto.subtle !== 'undefined' &&
                typeof crypto.subtle.digest === 'function';
            if (!canUseSubtle) {
                throw new Error('WebCrypto unavailable for SHA-256 hashing');
            }
            const buf = await blob.arrayBuffer();
            const digest = await crypto.subtle.digest('SHA-256', buf);
            const hex = bufferToHex(new Uint8Array(digest));
            if (markId && hasPerf)
                finishMark(markId, blob.size, 'subtle', dev, 'sha256');
            return hex;
        } catch (error) {
            if (markId && hasPerf) {
                performance.mark(`${markId}:error`);
                performance.measure(
                    `hash:sha256:error:${
                        error instanceof Error ? error.message : 'unknown'
                    }`,
                    `${markId}:start`
                );
            }
            throw error;
        }
    }
    return computeMd5Hex(blob);
}

/** Compute SHA-256 hash with prefix for new files. */
export async function computeFileHash(blob: Blob): Promise<string> {
    const hex = await computeHashHex(blob, 'sha256');
    return formatHash('sha256', hex);
}

async function computeMd5Hex(blob: Blob): Promise<string> {
    const dev = import.meta.dev;
    const hasPerf = typeof performance !== 'undefined';
    const markId =
        dev && hasPerf
            ? `hash-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;
    if (markId && hasPerf) performance.mark(`${markId}:start`);
    try {
        // Try Web Crypto subtle.digest for files up to 8MB (covers ~95% of files)
        try {
            const canUseSubtle =
                typeof crypto !== 'undefined' &&
                typeof crypto.subtle !== 'undefined' &&
                typeof crypto.subtle.digest === 'function';
            if (blob.size <= WEBCRYPTO_THRESHOLD && canUseSubtle) {
                const buf = await blob.arrayBuffer();
                // MD5 not in lib types but supported in some browsers
                const digest = await crypto.subtle.digest('MD5' as string, buf);
                const hex = bufferToHex(new Uint8Array(digest));
                if (markId && hasPerf)
                    finishMark(markId, blob.size, 'subtle', dev, 'md5');
                return hex;
            }
        } catch {
            // ignore and fallback to streaming spark-md5
        }
        // Streaming approach with spark-md5 for large files
        const SparkMD5 = await loadSpark();
        const hash = new SparkMD5.ArrayBuffer();
        let offset = 0;
        while (offset < blob.size) {
            const slice = blob.slice(offset, offset + CHUNK_SIZE);
            const buf = await slice.arrayBuffer();
            hash.append(buf);
            offset += CHUNK_SIZE;
            // Yield to main thread to maintain 60fps
            if (offset < blob.size) await yieldToMain();
        }
        const hex = hash.end();
        if (markId && hasPerf) finishMark(markId, blob.size, 'stream', dev, 'md5');
        return hex;
    } catch (error) {
        if (markId && hasPerf) {
            performance.mark(`${markId}:error`);
            performance.measure(
                `hash:md5:error:${
                    error instanceof Error ? error.message : 'unknown'
                }`,
                `${markId}:start`
            );
        }
        throw error;
    }
}

function finishMark(
    id: string,
    size: number,
    mode: 'subtle' | 'stream',
    dev: boolean,
    algo: HashAlgorithm
) {
    try {
        performance.mark(`${id}:end`);
        performance.measure(
            `hash:${algo}:${mode}:bytes=${size}`,
            `${id}:start`,
            `${id}:end`
        );
        const entry = performance
            .getEntriesByName(`hash:${algo}:${mode}:bytes=${size}`)
            .slice(-1)[0];
        if (entry && entry.duration && entry.duration > 0) {
            if (dev) {
                console.debug(
                    '[perf] computeFileHash',
                    mode,
                    `${(size / 1024).toFixed(1)}KB`,
                    `${entry.duration.toFixed(1)}ms`
                );
            }
        }
    } catch {
        // Perf instrumentation failure is non-fatal
        reportError(err('ERR_INTERNAL', 'perf mark failed'), {
            silent: true,
            tags: { domain: 'files', stage: 'hash_perf' },
        });
    }
}
