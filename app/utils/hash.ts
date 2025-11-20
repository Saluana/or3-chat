import { reportError, err } from '~/utils/errors';
/**
 * Hashing utilities for file deduplication.
 * Implements async chunked MD5 with Web Crypto fallback to spark-md5.
 * Chunk size kept small (256KB) to avoid blocking the main thread.
 */

const CHUNK_SIZE = 256 * 1024; // 256KB

// Cache the loaded SparkMD5 module to avoid repeated dynamic imports
let sparkMD5Cache: any = null;

// Lazy import spark-md5 only if needed (returns default export class)
async function loadSpark() {
    if (sparkMD5Cache) return sparkMD5Cache;
    const mod = await import('spark-md5');
    sparkMD5Cache = (mod as any).default;
    return sparkMD5Cache;
}

/** Compute MD5 hash (hex lowercase) for a Blob using chunked reads. */
export async function computeFileHash(blob: Blob): Promise<string> {
    const dev = (import.meta as any).dev;
    const hasPerf = typeof performance !== 'undefined';
    const markId =
        dev && hasPerf
            ? `hash-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;
    let t0 = 0;
    if (markId && hasPerf) {
        t0 = performance.now();
        performance.mark(`${markId}:start`);
    }
    try {
        // Try Web Crypto subtle.digest if md5 supported (some browsers may block MD5; if so, fallback)
        try {
            if (
                blob.size <= 4 * 1024 * 1024 &&
                'crypto' in globalThis &&
                (globalThis as any).crypto?.subtle
            ) {
                const buf = await blob.arrayBuffer();
                // @ts-ignore - MD5 not in TypeScript lib, but some browsers support it; fallback otherwise
                const digest = await (globalThis as any).crypto.subtle.digest(
                    'MD5',
                    buf
                );
                const hex = bufferToHex(new Uint8Array(digest));
                if (markId && hasPerf) finishMark(markId, blob.size, 'subtle');
                return hex;
            }
        } catch (_) {
            // ignore and fallback to streaming spark-md5
        }
        // Streaming approach with spark-md5
        const SparkMD5 = await loadSpark();
        const hash = new SparkMD5.ArrayBuffer();
        let offset = 0;
        let chunkCount = 0;
        while (offset < blob.size) {
            const slice = blob.slice(offset, offset + CHUNK_SIZE);
            const buf = await slice.arrayBuffer();
            hash.append(buf as ArrayBuffer);
            offset += CHUNK_SIZE;
            chunkCount++;
            // Yield more frequently for large files to maintain UI responsiveness
            // For files > 5MB, yield every chunk; for smaller files, yield every 2 chunks
            if (offset < blob.size) {
                const shouldYield = blob.size > 5 * 1024 * 1024 || chunkCount % 2 === 0;
                if (shouldYield) await microTask();
            }
        }
        const hex = hash.end();
        if (markId && hasPerf) finishMark(markId, blob.size, 'stream');
        return hex;
    } catch (e) {
        if (markId && hasPerf) {
            performance.mark(`${markId}:error`);
            performance.measure(
                `hash:md5:error:${(e as any)?.message || 'unknown'}`,
                `${markId}:start`
            );
        }
        throw e;
    }
}

function finishMark(id: string, size: number, mode: 'subtle' | 'stream') {
    try {
        performance.mark(`${id}:end`);
        performance.measure(
            `hash:md5:${mode}:bytes=${size}`,
            `${id}:start`,
            `${id}:end`
        );
        const entry = performance
            .getEntriesByName(`hash:md5:${mode}:bytes=${size}`)
            .slice(-1)[0];
        if (entry && entry.duration && entry.duration > 0) {
            if ((import.meta as any).dev) {
                // eslint-disable-next-line no-console
                console.debug(
                    '[perf] computeFileHash',
                    mode,
                    `${(size / 1024).toFixed(1)}KB`,
                    `${entry.duration.toFixed(1)}ms`
                );
            }
        }
    } catch (e) {
        // Perf instrumentation failure is non-fatal
        reportError(err('ERR_INTERNAL', 'perf mark failed'), {
            silent: true,
            tags: { domain: 'files', stage: 'hash_perf' },
        });
    }
}

// Pre-allocate hex lookup table for faster conversion
const hexLookup = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function bufferToHex(buf: Uint8Array): string {
    // Use array join instead of string concatenation for better performance
    const hexArray = new Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
        hexArray[i] = hexLookup[buf[i]];
    }
    return hexArray.join('');
}

// Yield control back to browser more efficiently
// Use scheduler.yield if available (Chrome 115+), fallback to requestIdleCallback, then setTimeout
function microTask(): Promise<void> {
    // @ts-ignore - scheduler.yield is new API
    if (typeof scheduler !== 'undefined' && scheduler?.yield) {
        // @ts-ignore
        return scheduler.yield();
    }
    if (typeof requestIdleCallback !== 'undefined') {
        return new Promise((resolve) => requestIdleCallback(() => resolve()));
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
}
