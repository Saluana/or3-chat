import { reportError, err } from '~/utils/errors';
/**
 * Hashing utilities for file deduplication.
 * Implements async chunked MD5 with Web Crypto fallback to spark-md5.
 * Chunk size kept small (256KB) to avoid blocking the main thread.
 */

const CHUNK_SIZE = 256 * 1024; // 256KB

type SparkMd5ArrayBuffer = {
    append(data: ArrayBuffer | ArrayBufferView): SparkMd5ArrayBuffer;
    end(raw?: boolean): string;
};

type SparkMd5Module = {
    ArrayBuffer: new () => SparkMd5ArrayBuffer;
};

// Lazy import spark-md5 only if needed (returns default export class)
async function loadSpark(): Promise<SparkMd5Module> {
    const mod = (await import('spark-md5')) as { default: SparkMd5Module };
    return mod.default; // SparkMD5 constructor with ArrayBuffer helper
}

/** Compute MD5 hash (hex lowercase) for a Blob using chunked reads. */
export async function computeFileHash(blob: Blob): Promise<string> {
    const dev = import.meta.dev;
    const hasPerf = typeof performance !== 'undefined';
    const markId =
        dev && hasPerf
            ? `hash-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;
    if (markId && hasPerf) performance.mark(`${markId}:start`);
    try {
        // Try Web Crypto subtle.digest if md5 supported (some browsers may block MD5; if so, fallback)
        try {
            const canUseSubtle =
                typeof crypto !== 'undefined' &&
                typeof crypto.subtle !== 'undefined' &&
                typeof crypto.subtle.digest === 'function';
            if (blob.size <= 4 * 1024 * 1024 && canUseSubtle) {
                const buf = await blob.arrayBuffer();
                // MD5 not in lib types but supported in some browsers
                const digest = await crypto.subtle.digest('MD5' as string, buf);
                const hex = bufferToHex(new Uint8Array(digest));
                if (markId && hasPerf)
                    finishMark(markId, blob.size, 'subtle', dev);
                return hex;
            }
        } catch {
            // ignore and fallback to streaming spark-md5
        }
        // Streaming approach with spark-md5
        const SparkMD5 = await loadSpark();
        const hash = new SparkMD5.ArrayBuffer();
        let offset = 0;
        while (offset < blob.size) {
            const slice = blob.slice(offset, offset + CHUNK_SIZE);
            const buf = await slice.arrayBuffer();
            hash.append(buf);
            offset += CHUNK_SIZE;
            if (offset < blob.size) await microTask();
        }
        const hex = hash.end();
        if (markId && hasPerf) finishMark(markId, blob.size, 'stream', dev);
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
    dev: boolean
) {
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

function bufferToHex(buf: Uint8Array): string {
    let hex = '';
    for (const b of buf) {
        hex += b.toString(16).padStart(2, '0');
    }
    return hex;
}

function microTask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
