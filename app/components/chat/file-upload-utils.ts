import { reportError, err } from '~/utils/errors';
import { createOrRefFile } from '~/db/files';

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

export function classifyKind(mime: string): 'image' | 'pdf' | null {
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    return null;
}

export function validateFile(
    file: File
):
    | { ok: true; kind: 'image' | 'pdf' }
    | { ok: false; code: 'ERR_FILE_VALIDATION'; message: string } {
    const mime = file.type || '';
    const kind = classifyKind(mime);
    if (!kind)
        return {
            ok: false,
            code: 'ERR_FILE_VALIDATION',
            message: 'Unsupported file type',
        };
    if (file.size > MAX_FILE_BYTES)
        return {
            ok: false,
            code: 'ERR_FILE_VALIDATION',
            message: 'File too large (max 20MB)',
        };
    return { ok: true, kind };
}

export interface AttachmentLike {
    file: File;
    name: string;
    status: 'pending' | 'ready' | 'error';
    mime?: string;
    kind?: string | null;
    hash?: string;
    meta?: any;
    error?: string;
}

export async function persistAttachment(att: AttachmentLike) {
    const persist = async () => {
        const meta = await createOrRefFile(att.file, att.name);
        att.hash = meta.hash;
        att.meta = meta;
        att.status = 'ready';
    };
    try {
        await persist();
    } catch (e: any) {
        att.status = 'error';
        att.error = e?.message || 'failed';
        reportError(e, {
            code: 'ERR_FILE_PERSIST',
            toast: true,
            retry: () => {
                att.status = 'pending';
                persist().catch((err2) => {
                    att.status = 'error';
                    att.error = err2?.message || 'failed';
                });
            },
            tags: { domain: 'files', stage: 'persist', name: att.name },
            retryable: true,
        });
    }
}
