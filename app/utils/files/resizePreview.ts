import { classifyFileBlob } from '~~/shared/files/file-kind';

async function isStaticPng(blob: Blob): Promise<boolean> {
    let offset = 8;
    while (offset + 12 <= blob.size) {
        const part = blob.slice(offset, offset + 8);
        const buffer = typeof part.arrayBuffer === 'function' ? await part.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(part);
        });
        const header = new Uint8Array(buffer);
        const size = new DataView(header.buffer).getUint32(0);
        const type = String.fromCharCode(...header.slice(4));
        if (size > blob.size - offset - 12 || type === 'acTL') return false;
        if (type === 'IDAT') return true;
        if (type === 'IEND') return false;
        offset += size + 12;
    }
    return false;
}

// All preview consumers share decode admission; blob retrieval happens before this queue.
let active = 0;
const waiting: Array<() => void> = [];
function drain() {
    while (active < 3 && waiting.length) {
        active++;
        waiting.shift()!();
    }
}

export async function withPreviewAdmission<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
    const acquired = await new Promise<boolean>(resolve => {
        if (signal?.aborted) { resolve(false); return; }
        const cancel = () => {
            const index = waiting.indexOf(start);
            if (index < 0) return;
            waiting.splice(index, 1);
            resolve(false);
        };
        const start = () => { signal?.removeEventListener('abort', cancel); resolve(true); };
        signal?.addEventListener('abort', cancel, { once: true });
        waiting.push(start);
        drain();
    });
    if (!acquired) return undefined;
    try {
        return await work();
    } finally {
        active--;
        drain();
    }
}

/** Produce an in-memory preview; preserve formats that may contain animation. */
export async function resizePreview(blob: Blob, maxWidth: number, current: () => boolean = () => true, admitted: () => void = () => {}, signal?: AbortSignal): Promise<Blob> {
    if (typeof createImageBitmap !== 'function' || !['image/jpeg', 'image/png'].includes(blob.type)) return blob;
    return await withPreviewAdmission(async () => {
        let bitmap: ImageBitmap | undefined;
        try {
            if (!current()) return blob;
            admitted();
            if ((await classifyFileBlob(blob)).kind !== 'image') return blob;
            if (blob.type === 'image/png' && !(await isStaticPng(blob))) return blob;
            bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
            if (bitmap.width <= maxWidth) return blob;
            const height = Math.max(1, Math.round(bitmap.height * maxWidth / bitmap.width));
            let preview: Blob | null;
            if (typeof OffscreenCanvas !== 'undefined') {
                const canvas = new OffscreenCanvas(maxWidth, height);
                const context = canvas.getContext('2d');
                if (!context) return blob;
                context.drawImage(bitmap, 0, 0, maxWidth, height);
                preview = await canvas.convertToBlob({ type: blob.type, quality: 0.82 });
            } else {
                if (typeof document === 'undefined') return blob;
                const canvas = document.createElement('canvas');
                canvas.width = maxWidth;
                canvas.height = height;
                const context = canvas.getContext('2d');
                if (!context) return blob;
                context.drawImage(bitmap, 0, 0, maxWidth, height);
                preview = await new Promise(resolve => canvas.toBlob(resolve, blob.type, 0.82));
            }
            return preview && preview.size < blob.size && (preview.type === 'image/webp' || preview.type === 'image/jpeg' || preview.type === 'image/png') ? preview : blob;
        } catch {
            return blob;
        } finally {
            bitmap?.close();
        }
    }, signal) ?? blob;
}
