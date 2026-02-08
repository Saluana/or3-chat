type ClipboardWriteLike = {
    write(data: unknown[]): Promise<void>;
};

type ClipboardItemCtor = {
    new (items: Record<string, Blob>): unknown;
    supports?: (type: string) => boolean;
};

export type CopyImageBlobToClipboardOptions = {
    preferredMimeType?: string | null;
    clipboard?: ClipboardWriteLike;
    clipboardItemCtor?: ClipboardItemCtor;
    supportsMimeType?: (mimeType: string) => boolean;
    createPngBlob?: (source: Blob) => Promise<Blob>;
};

const MIME_TYPE_ALIASES: Record<string, string> = {
    'image/jpg': 'image/jpeg',
};

function normalizeImageMimeType(mimeType?: string | null): string | null {
    if (!mimeType) return null;
    const normalized = mimeType.trim().toLowerCase();
    if (!normalized.startsWith('image/')) return null;
    return MIME_TYPE_ALIASES[normalized] ?? normalized;
}

function toTypedBlob(source: Blob, mimeType: string): Blob {
    if (source.type === mimeType) return source;
    return new Blob([source], { type: mimeType });
}

function resolveClipboard(): ClipboardWriteLike | null {
    const maybeNavigator = globalThis.navigator as
        | { clipboard?: ClipboardWriteLike }
        | undefined;
    const clipboard = maybeNavigator?.clipboard;
    if (!clipboard || typeof clipboard.write !== 'function') return null;
    return clipboard;
}

function resolveClipboardItemCtor(): ClipboardItemCtor | null {
    const ctor = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    if (typeof ctor !== 'function') return null;
    return ctor as ClipboardItemCtor;
}

function resolveSupportsMimeType(
    ctor: ClipboardItemCtor,
    override?: (mimeType: string) => boolean
): (mimeType: string) => boolean {
    if (override) return override;
    if (typeof ctor.supports === 'function') {
        return (mimeType: string) => ctor.supports?.(mimeType) !== false;
    }
    return () => true;
}

async function writeBlobToClipboard(
    blob: Blob,
    mimeType: string,
    clipboard: ClipboardWriteLike,
    clipboardItemCtor: ClipboardItemCtor
): Promise<void> {
    const item = new clipboardItemCtor({ [mimeType]: toTypedBlob(blob, mimeType) });
    await clipboard.write([item]);
}

async function toPngBlob(source: Blob): Promise<Blob> {
    if (source.type === 'image/png') return source;
    if (typeof createImageBitmap !== 'function') {
        throw new Error('Image conversion is unavailable in this browser.');
    }
    if (typeof document === 'undefined') {
        throw new Error('Image conversion requires a browser document.');
    }

    const bitmap = await createImageBitmap(source);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create 2D canvas context.');
        ctx.drawImage(bitmap, 0, 0);
        const png = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/png')
        );
        if (!png) throw new Error('PNG conversion failed.');
        return png;
    } finally {
        const maybeClosable = bitmap as { close?: () => void };
        maybeClosable.close?.();
    }
}

export async function copyImageBlobToClipboard(
    blob: Blob,
    options: CopyImageBlobToClipboardOptions = {}
): Promise<void> {
    const clipboard = options.clipboard ?? resolveClipboard();
    if (!clipboard) throw new Error('Clipboard image copy is unsupported.');

    const clipboardItemCtor = options.clipboardItemCtor ?? resolveClipboardItemCtor();
    if (!clipboardItemCtor) {
        throw new Error('Clipboard image copy is unavailable in this browser.');
    }

    const supportsMimeType = resolveSupportsMimeType(
        clipboardItemCtor,
        options.supportsMimeType
    );
    const directMimeCandidates = new Set<string>();
    const blobMime = normalizeImageMimeType(blob.type);
    if (blobMime) directMimeCandidates.add(blobMime);
    const preferredMime = normalizeImageMimeType(options.preferredMimeType);
    if (!blobMime && preferredMime) directMimeCandidates.add(preferredMime);
    if (!directMimeCandidates.size) directMimeCandidates.add('image/png');

    let lastError: unknown;

    for (const mimeType of directMimeCandidates) {
        if (!supportsMimeType(mimeType)) continue;
        try {
            await writeBlobToClipboard(blob, mimeType, clipboard, clipboardItemCtor);
            return;
        } catch (error) {
            lastError = error;
        }
    }

    if (!supportsMimeType('image/png')) {
        throw (
            lastError ??
            new Error('Clipboard image copy failed for supported MIME types.')
        );
    }

    try {
        const pngBlob = await (options.createPngBlob ?? toPngBlob)(blob);
        await writeBlobToClipboard(
            pngBlob,
            'image/png',
            clipboard,
            clipboardItemCtor
        );
        return;
    } catch (error) {
        throw error ?? lastError;
    }
}
