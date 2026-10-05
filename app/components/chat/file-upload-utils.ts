import { presentError } from '~~/shared/errors';
import { reportError, err } from '~/utils/errors';
import { createOrRefFile } from '~/db/files';
import { useHooks } from '~/core/hooks/useHooks';
import { useRuntimeConfig } from '#imports';
import type { FilesAttachInputPayload } from '~/core/hooks/hook-types';
import { captureWorkspaceOperation, workspaceFilesAvailable, type WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { getActiveWorkspaceId, getDb, getWorkspaceGeneration } from '~/db/client';
import { createRuntimeUuid } from '~~/shared/runtime-id';

const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function getMaxFileBytes(): number {
    try {
        const runtimeConfig = useRuntimeConfig();
        const candidate = Number(
            (runtimeConfig.public as { or3?: { limits?: { maxFileSizeBytes?: number } } }).or3
                ?.limits?.maxFileSizeBytes
        );
        if (Number.isFinite(candidate) && candidate > 0) {
            return Math.floor(candidate);
        }
    } catch {
        // Fall through to default when runtime config is not available.
    }
    return DEFAULT_MAX_FILE_SIZE_BYTES;
}

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
    const limit = getMaxFileBytes();
    if (file.size > limit)
        return {
            ok: false,
            code: 'ERR_FILE_VALIDATION',
            message: `File too large (max ${Math.round(limit / 1024 / 1024)}MB)`,
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
    meta?: {
        hash: string;
        name?: string;
        mime_type?: string;
        size?: number;
    } | null;
    error?: string;
}

export interface AttachmentIntakeOwner {
    signal: AbortSignal;
    assertCurrent(): void;
}

export async function persistAttachment(att: AttachmentLike, owner?: AttachmentIntakeOwner) {
    let scope: WorkspaceOperationScope | undefined;
    const catalogEnabled = workspaceFilesAvailable();
    const originDb = getDb();
    const originGeneration = getWorkspaceGeneration();
    const originWorkspace = getActiveWorkspaceId();
    const assertLocalOrigin = () => {
        owner?.assertCurrent();
        if (getDb() !== originDb || getWorkspaceGeneration() !== originGeneration || getActiveWorkspaceId() !== originWorkspace) {
            throw new Error('The originating workspace is no longer available.');
        }
    };
    const persist = async () => {
        assertLocalOrigin();
        if (catalogEnabled) scope ??= captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
            threadId: 'chat-upload', messageId: null, requestId: createRuntimeUuid(), callId: createRuntimeUuid(),
            abortSignal: owner?.signal ?? new AbortController().signal });
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
        assertLocalOrigin();
        scope?.assertCurrent('write');

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
        const meta = await createOrRefFile(filtered.file, filtered.name, { assertCurrent: assertLocalOrigin });
        assertLocalOrigin();
        scope?.assertCurrent('write');
        if (catalogEnabled) {
            if (!workspaceFilesAvailable()) throw new Error('Files access changed. Refresh and try again.');
            const { catalogWorkspaceFile } = await import('~/db/workspace-files');
            assertLocalOrigin();
        scope?.assertCurrent('write');
            await catalogWorkspaceFile(scope!, meta.hash, { restore: true });
        }
        att.hash = meta.hash;
        att.meta = meta;
        att.status = 'ready';
    };
    try {
        await persist();
    } catch (e: unknown) {
        att.status = 'error';
        if (owner?.signal.aborted) return;
        att.error = presentError(e, { code: 'ERR_FILE_PERSIST' }).message;
        reportError(e, {
            code: 'ERR_FILE_PERSIST',
            toast: true,
            retry: () => {
                att.status = 'pending';
                persist().catch((err2) => {
                    att.status = 'error';
                    att.error = presentError(err2, { code: 'ERR_FILE_PERSIST' }).message;
                });
            },
            tags: { domain: 'files', stage: 'persist', name: att.name },
            retryable: true,
        });
    }
}
