/**
 * @module app/utils/chat/files
 *
 * Purpose:
 * Small helpers for file and MIME handling used by chat features.
 */
import { fetchBoundedBlob } from '~/utils/fetch-bounded-blob';

const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
/**
 * `dataUrlToBlob`
 *
 * Purpose:
 * Converts a base64 data URL into a Blob.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
    try {
        const m: RegExpExecArray | null = /^data:([^;]+);base64,(.*)$/i.exec(
            dataUrl
        );
        if (!m) return null;
        const mime: string = m[1] as string;
        const b64: string = m[2] as string;
        if (b64.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4) {
            throw new Error('Generated image exceeds the size limit.');
        }
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
    } catch {
        return null;
    }
}

/**
 * `inferMimeFromUrl`
 *
 * Purpose:
 * Infers an image MIME type from a URL or provided value.
 */
export function inferMimeFromUrl(u: string, provided?: string) {
    if (provided && provided.startsWith('image/')) return provided;
    const m = /^data:([^;]+);/i.exec(u);
    if (m) return m[1];
    const lower = (u.split('?')[0] || '').toLowerCase();
    const ext = lower.substring(lower.lastIndexOf('.') + 1);
    const map: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        avif: 'image/avif',
        heic: 'image/heic',
        heif: 'image/heif',
        bmp: 'image/bmp',
        tif: 'image/tiff',
        tiff: 'image/tiff',
        ico: 'image/x-icon',
    };
    return map[ext] || 'image/png';
}

/**
 * `fetchImageBlob`
 *
 * Purpose:
 * Fetches an image with a 20 MiB cap and an eight-second body deadline.
 * Cancellation, download and storage failures must reach request finalization.
 */
export async function fetchImageBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
    return fetchBoundedBlob(url, { maxBytes: MAX_GENERATED_IMAGE_BYTES, timeoutMs: 8000, signal });
}
