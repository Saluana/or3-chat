import type { FileMeta } from '~/db/schema';
import { getFileBlob } from '~/db/files';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { reportError } from '~/utils/errors';
import { useToast } from '#imports';
import { copyImageBlobToClipboard } from './copy-image-to-clipboard';

/** Fences an async image action to the workspace it started in. */
export function captureWorkspaceOwner() {
    const originDb = getDb();
    const generation = getWorkspaceGeneration();
    const isCurrent = () => getDb() === originDb && generation === getWorkspaceGeneration();
    return {
        isCurrent,
        assertCurrent() {
            if (!isCurrent()) {
                throw new Error('The workspace changed. Repeat the action in the intended workspace.');
            }
        },
    };
}

/**
 * Download and clipboard actions for stored image files, shared by the image
 * library and chat images. Call during component setup.
 */
export function useImageFileActions() {
    const toast = useToast();

    async function download(meta: FileMeta) {
        const owner = captureWorkspaceOwner();
        let url: string | undefined;
        try {
            const blob = await getFileBlob(meta.hash);
            owner.assertCurrent();
            if (!blob) throw new Error('blob missing');
            url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = meta.name || 'image';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (error) {
            if (!owner.isCurrent()) return;
            reportError(error, {
                code: 'ERR_DB_READ_FAILED',
                message: `Couldn't download "${meta.name || 'image'}".`,
                tags: { domain: 'images', action: 'download', hash: meta.hash },
            });
        } finally {
            if (url) URL.revokeObjectURL(url);
        }
    }

    async function copy(meta: FileMeta) {
        const owner = captureWorkspaceOwner();
        let blob: Blob;
        try {
            const resolved = await getFileBlob(meta.hash);
            owner.assertCurrent();
            if (!resolved) throw new Error('blob missing');
            blob = resolved;
        } catch (error) {
            if (!owner.isCurrent()) return;
            reportError(error, {
                code: 'ERR_DB_READ_FAILED',
                message: `Couldn't copy "${meta.name || 'image'}".`,
                tags: { domain: 'images', action: 'copy', hash: meta.hash },
            });
            return;
        }

        const mime = meta.mime_type || 'image/png';
        const showCopiedToast = () =>
            toast.add({
                title: 'Image copied',
                description: `${meta.name || 'Image'} is ready to paste.`,
                color: 'success',
            });

        try {
            await copyImageBlobToClipboard(blob, { preferredMimeType: mime, assertCurrent: owner.assertCurrent });
            if (owner.isCurrent()) showCopiedToast();
        } catch (error) {
            if (!owner.isCurrent()) return;
            reportError(error, {
                code: 'ERR_INTERNAL',
                message: `Couldn't copy "${meta.name || 'image'}".`,
                tags: {
                    domain: 'images',
                    action: 'copy',
                    hash: meta.hash,
                    stage: 'clipboard-write',
                },
            });
        }
    }

    return { download, copy };
}
