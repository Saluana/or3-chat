import { createOrRefFile, getFileBlob, changeRefCount } from '~/db/files';
import {
    importWorkspaceFile,
    catalogWorkspaceFile,
} from '~/db/workspace-files';
import {
    saveProjectSource,
    readProjectWorkspace,
    type ProjectRecord,
} from '~/db/project-workspace';
import { newId, nowSec } from '~/db/util';
import { workspaceRevision } from '~/utils/chat/workspace-items';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import type {
    ProjectSource,
    SourceRevision,
} from '~~/shared/projects/workspace';
import { parseFileHashes } from '~/db/files-util';
import { isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import { isSupportedRasterMimeType } from '~~/shared/files/file-kind';

type Extraction =
    | {
          ok: true;
          text: string;
          partial: boolean;
          locations: SourceRevision['locations'];
      }
    | { ok: false; error: string };
async function extract(
    blob: Blob,
    name: string,
    signal: AbortSignal,
): Promise<Extraction> {
    signal.throwIfAborted();
    if (blob.size > 20 * 1024 * 1024)
        return {
            ok: false,
            error: 'Extractable uploads are limited to 20 MiB.',
        };
    const bytes = await blob.arrayBuffer();
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL(
                '../../workers/project-extraction.worker.ts',
                import.meta.url,
            ),
            { type: 'module' },
        );
        const finish = () => {
            clearTimeout(timeout);
            signal.removeEventListener('abort', abort);
            worker.terminate();
        };
        const abort = () => {
            finish();
            reject(new DOMException('Extraction cancelled', 'AbortError'));
        };
        const timeout = setTimeout(() => {
            finish();
            resolve({
                ok: false,
                error: 'Extraction exceeded 30 seconds. Retry or use a smaller document.',
            });
        }, 30000);
        signal.addEventListener('abort', abort, { once: true });
        worker.onmessage = (event: MessageEvent<Extraction>) => {
            // PDF.js also emits its worker protocol's readiness message on this port.
            // Only our extraction result can complete the intake operation.
            if (typeof event.data?.ok !== 'boolean') return;
            finish();
            resolve(event.data);
        };
        worker.onerror = () => {
            finish();
            resolve({
                ok: false,
                error: 'The extraction worker failed. Retry this file.',
            });
        };
        worker.postMessage({ bytes, name }, [bytes]);
    });
}

export async function addProjectUpload(
    scope: WorkspaceOperationScope,
    projectId: string,
    file: File,
    replace?: ProjectRecord<ProjectSource>,
): Promise<ProjectRecord<ProjectSource>> {
    scope.assertCurrent('write');
    const imported = await importWorkspaceFile(scope, file, file.name);
    scope.assertCurrent('write');
    const hash = parseFileHashes(imported.post.file_hashes)[0]!;
    const existing = (
        await readProjectWorkspace(scope.db, projectId)
    ).sources.find((source) => source.value.item_id === imported.post.id);
    if (!replace && existing) return existing;
    const revision: SourceRevision = {
        id: newId(),
        item_id: imported.post.id,
        original_hash: hash,
        created_at: nowSec(),
        status: isSupportedRasterMimeType(file.type) ? 'ready' : 'processing',
        coverage: 'none',
        locations: [],
    };
    let saved = await saveProjectSource(
        scope,
        projectId,
        {
            version: 1,
            item_id:
                revision.status === 'ready'
                    ? imported.post.id
                    : (replace?.value.item_id ?? imported.post.id),
            kind: 'file',
            title: replace?.value.title ?? imported.post.title,
            mode: replace?.value.mode ?? 'relevant',
            current_revision_id:
                revision.status === 'ready'
                    ? revision.id
                    : (replace?.value.current_revision_id ?? revision.id),
            revisions: [...(replace?.value.revisions ?? []), revision],
        },
        replace?.row.id,
        replace?.row.clock ?? null,
    );
    if (revision.status === 'ready') return saved;
    return processProjectSource(scope, projectId, saved, revision.id);
}

export async function processProjectSource(
    scope: WorkspaceOperationScope,
    projectId: string,
    source: ProjectRecord<ProjectSource>,
    revisionId = source.value.current_revision_id,
): Promise<ProjectRecord<ProjectSource>> {
    let current = source.value.revisions.find((r) => r.id === revisionId)!;
    if (!current.original_hash)
        throw new Error('Source original is unavailable.');
    const originalHash = current.original_hash;
    scope.assertCurrent('write');
    // A fresh clock fences older worker completions and refreshes the bounded
    // Processing lease on retries, including retained historical revisions.
    current = { ...current, status: 'processing', processing_started_at: nowSec() };
    source = await saveProjectSource(scope, projectId, { ...source.value,
        revisions: source.value.revisions.map(revision => revision.id === revisionId ? current : revision),
    }, source.row.id, source.row.clock);
    const meta = await scope.db.file_meta.get(originalHash);
    const blob = await getFileBlob(originalHash, scope.db);
    scope.assertCurrent('write');
    let result: Extraction =
        !meta || !blob
            ? {
                  ok: false,
                  error: 'Original unavailable offline. Connect and retry.',
              }
            : await extract(blob, meta.name, scope.signal);
    scope.assertCurrent('write');
    let textHash: string | undefined;
    try {
        if (result.ok) {
            const textFile = await createOrRefFile(
                new Blob([result.text], { type: 'text/plain' }),
                `${source.value.title}.extracted.txt`,
                { assertCurrent: () => scope.assertCurrent('write') },
            );
            textHash = textFile.hash;
        }
        const next: SourceRevision = result.ok
            ? {
                  ...current,
                  processing_started_at: undefined,
                  text_hash: textHash,
                  status: result.partial ? 'partial' : 'ready',
                  error: undefined,
                  coverage: result.partial ? 'prefix' : 'full',
                  locations: result.locations,
              }
            : {
                  ...current,
                  processing_started_at: undefined,
                  status: 'failed',
                  coverage: 'none',
                  error: result.error.slice(0, 500),
              };
        const saved = await saveProjectSource(
            scope,
            projectId,
            {
                ...source.value,
                ...(result.ok &&
                (current.id === source.value.current_revision_id ||
                    current.id === source.value.revisions.at(-1)?.id)
                    ? {
                          current_revision_id: current.id,
                          item_id: current.item_id ?? source.value.item_id,
                      }
                    : {}),
                revisions: source.value.revisions.map((r) =>
                    r.id === current.id ? next : r,
                ),
            },
            source.row.id,
            source.row.clock,
        );
        if (result.ok) {
            const catalog = await scope.db.posts.get(
                current.item_id ?? source.value.item_id,
            );
            if (catalog && !catalog.deleted)
                try {
                    await catalogWorkspaceFile(scope, originalHash, {
                        expected: catalog,
                        text: {
                            text: result.text.slice(0, 16000),
                            coverage:
                                result.text.length > 16000 || result.partial
                                    ? 'prefix'
                                    : 'full',
                            indexed_bytes: new TextEncoder().encode(
                                result.text.slice(0, 16000),
                            ).byteLength,
                        },
                    });
                } catch (error) {
                    console.warn(
                        '[projects] Extraction saved; catalog indexing failed',
                        error,
                    );
                }
        }
        return saved;
    } finally {
        if (textHash) await changeRefCount(textHash, -1, scope.db);
    }
}

export async function addProjectDocument(
    scope: WorkspaceOperationScope,
    projectId: string,
    documentId: string,
) {
    const post = await scope.db.posts.get(documentId);
    scope.assertCurrent('write');
    if (!post || post.postType !== 'doc' || !isVisibleWorkspaceItem(post))
        throw new Error('This document is unavailable.');
    const existing = (
        await readProjectWorkspace(scope.db, projectId)
    ).sources.find((source) => source.value.item_id === documentId);
    if (existing) return existing;
    const revision = await workspaceRevision(post);
    return saveProjectSource(scope, projectId, {
        item_id: documentId,
        kind: 'document',
        title: post.title,
        mode: 'relevant',
        current_revision_id: revision,
        revisions: [
            {
                id: revision,
                status: 'ready',
                coverage: 'full',
                created_at: nowSec(),
            },
        ],
    });
}

export async function addExistingProjectFile(
    scope: WorkspaceOperationScope,
    projectId: string,
    itemId: string,
) {
    const item = await scope.db.posts.get(itemId);
    if (!item || item.postType !== 'or3:file' || !isVisibleWorkspaceItem(item))
        throw new Error('Saved file unavailable.');
    const hash = parseFileHashes(item.file_hashes)[0];
    if (!hash) throw new Error('Original unavailable.');
    const meta = await scope.db.file_meta.get(hash);
    const blob = await getFileBlob(hash, scope.db);
    scope.assertCurrent('write');
    if (!meta || meta.deleted || !blob)
        throw new Error('Original unavailable offline.');
    return addProjectUpload(
        scope,
        projectId,
        new File([blob], meta.name, { type: meta.mime_type }),
    );
}
