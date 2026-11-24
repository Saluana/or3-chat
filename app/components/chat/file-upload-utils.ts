import { presentError } from '~~/shared/errors';
import { reportError, err } from '~/utils/errors';
import { changeFileRefRows, changeRefCount, createOrRefFileWithStatus, getFileBlob, notifyFileRefChanges, resolveStoredFileKind } from '~/db/files';
import { useHooks } from '~/core/hooks/useHooks';
import { useRuntimeConfig } from '#imports';
import type { FilesAttachInputPayload } from '~/core/hooks/hook-types';
import { captureWorkspaceOperation, workspaceFilesAvailable, type WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { getActiveWorkspaceId, getDb, getWorkspaceGeneration } from '~/db/client';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import { refreshCachedSessionContext } from '~/composables/auth/useSessionContext';
import { getLocalWorkspaceSession } from '~/composables/auth/useLocalWorkspaceSession';
import { getOfflineWorkspace } from '~/composables/auth/offline-workspace';
import { STATIC_FILE_CEILING } from '~~/shared/storage/file-policy';
import { getVerifiedFilePolicy, isCloudFileStorageConfigured, isCloudFileStorageEnabled, loadFilePolicy } from '~/core/storage/file-policy';
import type { FileMeta } from '~/db/schema';
import { parseFileHashes } from '~/db/files-util';
import { getWriteTxTableNames } from '~/db/util';
import { FILE_CATALOG_POST_TYPE, isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import { classifyFileBlob } from '~~/shared/files/file-kind';

const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function getMaxFileBytes(): number {
    // Cloud's current private policy is enforced asynchronously at intake and presign.
    if (isCloudFileStorageEnabled()) return 1024 * 1024 * 1024;
    try {
        const runtimeConfig = useRuntimeConfig();
        const candidate = Number(
            (runtimeConfig.public as { or3?: { limits?: { maxFileSizeBytes?: number } } }).or3
                ?.limits?.maxFileSizeBytes
        );
        if (Number.isFinite(candidate) && candidate > 0) {
            return Math.min(STATIC_FILE_CEILING, Math.floor(candidate));
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

/** The source identity survives navigation to a lazily mounted chat composer. */
export interface StoredAttachmentReference {
    id: string;
    hash?: string;
    workspaceId: string;
    generation: number;
    kind?: 'image' | 'pdf';
}

const preparedStoredAttachment = Symbol('preparedStoredAttachment');

export interface StoredAttachment {
    readonly [preparedStoredAttachment]: true;
    readonly reference: StoredAttachmentReference;
    readonly scope: WorkspaceOperationScope;
    readonly file: File;
    readonly meta: FileMeta;
}

export type StoredAttachmentSource = StoredAttachmentReference | StoredAttachment;

export class StoredAttachmentOfflineError extends Error {
    constructor() {
        super('Original file unavailable offline. Connect and retry.');
    }
}

async function assertStoredAttachment(stored: StoredAttachment): Promise<FileMeta> {
    const { scope, reference } = stored;
    scope.assertCurrent('write');
    if (!workspaceFilesAvailable() || scope.generation !== reference.generation || scope.workspaceId !== reference.workspaceId)
        throw new Error('The originating workspace is no longer available.');
    const post = await scope.db.posts.get(reference.id);
    const meta = await scope.db.file_meta.get(stored.meta.hash);
    scope.assertCurrent('write');
    const kind = meta && resolveStoredFileKind(meta);
    if (!post || post.postType !== FILE_CATALOG_POST_TYPE || !isVisibleWorkspaceItem(post)
        || parseFileHashes(post.file_hashes).join() !== stored.meta.hash
        || (reference.hash && reference.hash !== stored.meta.hash)
        || !meta || meta.deleted || kind !== stored.meta.kind || meta.mime_type !== stored.meta.mime_type
        || meta.size_bytes !== stored.meta.size_bytes || stored.file.size !== meta.size_bytes)
        throw new Error('That saved file is unavailable or has changed.');
    return meta;
}

/** Load the verified original once; later filters may still replace its bytes. */
export async function loadStoredAttachment(input: StoredAttachmentSource, owner: AttachmentIntakeOwner): Promise<StoredAttachment> {
    owner.assertCurrent();
    if (preparedStoredAttachment in input) {
        // Files may already have fetched a Cloud original that does not fit the cache.
        await assertStoredAttachment(input);
        owner.assertCurrent();
        return input;
    }
    const reference = input;
    const scope = captureWorkspaceOperation({ subject: null, workspaceId: reference.workspaceId,
        threadId: 'saved-chat-attachment', messageId: null, requestId: createRuntimeUuid(), callId: reference.id,
        abortSignal: owner.signal });
    if (scope.generation !== reference.generation) throw new Error('The originating workspace is no longer available.');
    const { readWorkspaceItem } = await import('~/utils/chat/workspace-items');
    const source = await readWorkspaceItem(scope, { kind: 'file', id: reference.id });
    const hash = parseFileHashes((source.row as { file_hashes?: string | null }).file_hashes)[0];
    const meta = hash ? await scope.db.file_meta.get(hash) : undefined;
    scope.assertCurrent('write'); owner.assertCurrent();
    const kind = meta && resolveStoredFileKind(meta);
    if (!meta || meta.deleted || (kind !== 'image' && kind !== 'pdf')
        || (reference.hash && reference.hash !== meta.hash) || (reference.kind && reference.kind !== kind))
        throw new Error('This file is not a supported image or PDF.');
    const blob = await getFileBlob(meta.hash, scope.db, {
        localOnly: typeof navigator !== 'undefined' && navigator.onLine === false,
    });
    scope.assertCurrent('write'); owner.assertCurrent();
    if (!blob) throw new StoredAttachmentOfflineError();
    const file = new File([blob], meta.name, { type: meta.mime_type });
    const classification = await classifyFileBlob(file);
    if (classification.kind !== kind) throw new Error('This file is not a supported image or PDF.');
    const stored: StoredAttachment = {
        [preparedStoredAttachment]: true, reference: { ...reference }, scope, file, meta: { ...meta, kind },
    };
    await assertStoredAttachment(stored); owner.assertCurrent();
    return stored;
}

async function retainStoredAttachment(stored: StoredAttachment, assertCurrent: () => void, signal = stored.scope.signal): Promise<FileMeta> {
    const { workspaceId } = stored.scope;
    const offline = getOfflineWorkspace()?.workspaceId === workspaceId;
    const policy = offline && isCloudFileStorageConfigured() ? getVerifiedFilePolicy(workspaceId)
        : isCloudFileStorageEnabled() ? await loadFilePolicy(workspaceId, signal) : undefined;
    const limit = offline ? Math.min(policy?.maxUploadBytes ?? Infinity, getMaxFileBytes())
        : policy?.maxUploadBytes ?? getMaxFileBytes();
    assertCurrent();
    if (stored.file.size > limit) throw new Error('File exceeds the upload size limit.');
    const { db } = stored.scope;
    // Trash and retention share the source-row lock; a delayed filter cannot restore it.
    const changed = await db.transaction('rw', getWriteTxTableNames(db, ['posts', 'file_meta']), async () => {
        assertCurrent();
        await assertStoredAttachment(stored);
        const changed = await changeFileRefRows(stored.meta.hash, 1, db);
        assertCurrent();
        if (!changed) throw new Error('That saved file is unavailable.');
        return changed;
    });
    try {
        await notifyFileRefChanges([changed.notification]);
        assertCurrent();
        return changed.row;
    } catch (error) {
        await changeRefCount(changed.row.hash, -1, db);
        throw error;
    }
}

export async function persistAttachment(att: AttachmentLike, owner?: AttachmentIntakeOwner, stored?: StoredAttachment) {
    let scope: WorkspaceOperationScope | undefined = stored?.scope;
    const catalogEnabled = workspaceFilesAvailable();
    const originDb = getDb();
    const originGeneration = getWorkspaceGeneration();
    const originWorkspace = getActiveWorkspaceId();
    const assertLocalOrigin = () => {
        owner?.assertCurrent();
        scope?.assertCurrent('write');
        if (getDb() !== originDb || getWorkspaceGeneration() !== originGeneration || getActiveWorkspaceId() !== originWorkspace) {
            throw new Error('The originating workspace is no longer available.');
        }
    };
    const persist = async () => {
        assertLocalOrigin();
        if (catalogEnabled && !scope) {
            // A file picker may outlive the access token. Recover the session
            // before capturing authority, without admitting a different owner.
            const session = getLocalWorkspaceSession();
            if (session?.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
                await refreshCachedSessionContext();
                assertLocalOrigin();
                if (getLocalWorkspaceSession()?.user?.id !== session.user?.id)
                    throw new Error('Workspace access changed. Refresh and try again.');
            }
            scope = captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
                threadId: 'chat-upload', messageId: null, requestId: createRuntimeUuid(), callId: createRuntimeUuid(),
                abortSignal: owner?.signal ?? new AbortController().signal });
        }
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
        const unchanged = stored && att.file === stored.file && filtered.file === stored.file;
        // Unchanged originals are checked under the retain transaction's lock.
        if (stored && !unchanged) await assertStoredAttachment(stored);
        const { meta, created } = unchanged ? { meta: await retainStoredAttachment(stored, assertLocalOrigin, owner?.signal), created: false }
            : await createOrRefFileWithStatus(filtered.file, filtered.name, { assertCurrent: assertLocalOrigin });
        try {
            assertLocalOrigin();
            scope?.assertCurrent('write');
            if (meta.kind !== 'image' && meta.kind !== 'pdf') {
                throw err('ERR_FILE_VALIDATION', 'This file is not a supported image or PDF.', {
                    tags: { domain: 'files', stage: 'persist', name: att.name },
                });
            }
            if (catalogEnabled && !unchanged) {
                if (!workspaceFilesAvailable()) throw new Error('Files access changed. Refresh and try again.');
                const { catalogWorkspaceFile } = await import('~/db/workspace-files');
                assertLocalOrigin();
                scope?.assertCurrent('write');
                const catalog = await catalogWorkspaceFile(scope!, meta.hash, { restore: !stored });
                if (stored && !isVisibleWorkspaceItem(catalog.post)) throw new Error('That saved file is unavailable.');
            }
            // Extension notifications can yield or move the source to Trash.
            if (stored) await assertStoredAttachment(stored);
            assertLocalOrigin();
            scope?.assertCurrent('write');
            att.hash = meta.hash;
            att.meta = meta;
            att.name = created ? meta.name : filtered.name;
            att.mime = meta.mime_type;
            att.kind = meta.kind;
            att.error = undefined;
            att.status = 'ready';
        } catch (error) {
            // Failed intake never transfers its temporary reference to the composer.
            await changeRefCount(meta.hash, -1, originDb);
            throw error;
        }
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
