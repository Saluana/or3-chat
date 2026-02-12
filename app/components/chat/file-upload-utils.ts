import { reportError, err } from '~/utils/errors';
import { createOrRefFile } from '~/db/files';
import { useHooks } from '~/core/hooks/useHooks';
import type { FilesAttachInputPayload } from '~/core/hooks/hook-types';

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB (default, can be overridden via runtime config)

// Default allowed MIME types (can be overridden via runtime config)
const DEFAULT_ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/bmp',
    'image/tiff',
    'image/x-icon',
    'application/pdf'
];

/**
 * Get the maximum file size in bytes from runtime config
 */
export function getMaxFileSizeBytes(): number {
    try {
        const config = useRuntimeConfig();
        return config.public?.maxFileSizeBytes || MAX_FILE_BYTES;
    } catch {
        // Runtime config not available (e.g., in tests)
        return MAX_FILE_BYTES;
    }
}

/**
 * Get allowed MIME types from runtime config
 */
export function getAllowedMimeTypes(): string[] {
    try {
        const config = useRuntimeConfig();
        const mimeString = config.public?.allowedMimeTypes || '';
        if (mimeString) {
            return mimeString.split(',').map(m => m.trim()).filter(Boolean);
        }
    } catch {
        // Runtime config not available (e.g., in tests or server-side)
    }
    return DEFAULT_ALLOWED_MIME_TYPES;
}

export function classifyKind(mime: string): 'image' | 'pdf' | null {
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    return null;
}

/**
 * Check if a MIME type is allowed based on runtime config
 */
export function isMimeTypeAllowed(mime: string): boolean {
    const allowed = getAllowedMimeTypes();
    return allowed.includes(mime);
}

export function validateFile(
    file: File
):
    | { ok: true; kind: 'image' | 'pdf' }
    | { ok: false; code: 'ERR_FILE_VALIDATION'; message: string } {
    const mime = file.type || '';
    
    // Check if MIME type is in the allowlist
    if (!isMimeTypeAllowed(mime)) {
        return {
            ok: false,
            code: 'ERR_FILE_VALIDATION',
            message: 'Unsupported file type',
        };
    }
    
    const kind = classifyKind(mime);
    if (!kind)
        return {
            ok: false,
            code: 'ERR_FILE_VALIDATION',
            message: 'Unsupported file type',
        };
    
    const maxSize = getMaxFileSizeBytes();
    if (file.size > maxSize) {
        const maxMB = Math.round(maxSize / (1024 * 1024));
        return {
            ok: false,
            code: 'ERR_FILE_VALIDATION',
            message: `File too large (max ${maxMB}MB)`,
        };
    }
    return { ok: true, kind };
}

export interface AttachmentLike {
    file: File;
    name: string;
    status: 'pending' | 'ready' | 'error';
    mime?: string;
    kind?: string | null;
    hash?: string;
    meta?: {
        hash: string;
        name?: string;
        mime_type?: string;
        size?: number;
    } | null;
    error?: string;
}

export async function persistAttachment(att: AttachmentLike) {
    const persist = async () => {
        // Apply files.attach:filter:input hook before creating/referencing file
        const hooks = useHooks();
        const payload: FilesAttachInputPayload = {
            file: att.file,
            name: att.name,
            mime: att.mime || att.file.type || '',
            size: att.file.size,
            kind: (att.kind === 'pdf' ? 'pdf' : 'image') as 'image' | 'pdf',
        };

        const filtered = await hooks.applyFilters(
            'files.attach:filter:input',
            payload
        );

        // If filter returns false, reject the attachment
        if (filtered === false) {
            throw err(
                'ERR_FILE_VALIDATION',
                'File attachment was rejected by filter',
                {
                    tags: { domain: 'files', stage: 'filter', name: att.name },
                }
            );
        }

        // Use filtered values (in case hook transformed them)
        const meta = await createOrRefFile(filtered.file, filtered.name);
        att.hash = meta.hash;
        att.meta = meta;
        att.status = 'ready';
    };
    try {
        await persist();
    } catch (e: unknown) {
        att.status = 'error';
        att.error = e instanceof Error ? e.message : 'failed';
        reportError(e, {
            code: 'ERR_FILE_PERSIST',
            toast: true,
            retry: () => {
                att.status = 'pending';
                persist().catch((err2) => {
                    att.status = 'error';
                    att.error = err2 instanceof Error ? err2.message : 'failed';
                });
            },
            tags: { domain: 'files', stage: 'persist', name: att.name },
            retryable: true,
        });
    }
}
