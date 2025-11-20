// Small helpers around file/mime handling used by useChat

export function dataUrlToBlob(dataUrl: string): Blob | null {
    try {
        const m: RegExpExecArray | null = /^data:([^;]+);base64,(.*)$/i.exec(
            dataUrl
        );
        if (!m) return null;
        const mime: string = m[1] as string;
        const b64: string = m[2] as string;
        
        // For large data URLs, use chunked processing to avoid memory spikes
        const bin = atob(b64);
        const len = bin.length;
        
        // Process in chunks to be more memory-efficient for large files
        const chunkSize = 8192;
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < len; i += chunkSize) {
            const chunkLen = Math.min(chunkSize, len - i);
            const chunk = new Uint8Array(chunkLen);
            for (let j = 0; j < chunkLen; j++) {
                chunk[j] = bin.charCodeAt(i + j);
            }
            chunks.push(chunk);
        }
        
        return new Blob(chunks, { type: mime });
    } catch {
        return null;
    }
}

// Infer MIME from URL or provided type (favor provided)
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
