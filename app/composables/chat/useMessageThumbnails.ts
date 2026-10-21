import { computed, onBeforeUnmount, reactive, ref, watch, type Ref } from 'vue';
import { parseHashes } from '~/utils/files/attachments';
import { getFileBlob, getFileMeta } from '~/db/files';
import {
    useThumbnailUrlCache,
    type ThumbState,
} from '~/composables/core/useThumbnailUrlCache';
import { truncateAttachmentName } from '~/utils/chat/truncateAttachmentName';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { isSupportedRasterMimeType } from '~~/shared/files/file-kind';

type MessageWithAttachments = {
    role?: string;
    file_hashes?: unknown;
    _expanded?: boolean;
};

type LocalThumbState = ThumbState | { status: 'loading' };

export function useMessageThumbnails(message: Ref<MessageWithAttachments>) {
    const hashList = computed<string[]>(() => parseHashes(message.value.file_hashes));
    const thumbnails = reactive<Record<string, LocalThumbState>>({});
    const pdfMeta = reactive<Record<string, { name?: string; kind: string }>>({});
    const imageNames = reactive<Record<string, string>>({});

    const maxDisplayedThumbs = 4;
    const displayedHashes = computed(() =>
        hashList.value.slice(0, maxDisplayedThumbs)
    );
    const thumbnailHashes = computed(() =>
        message.value.role === 'assistant' ? hashList.value : displayedHashes.value
    );

    function getAttachmentName(hash: string): string {
        const meta = pdfMeta[hash];
        if (meta?.name) {
            return truncateAttachmentName(meta.name, 20);
        }
        return 'Document';
    }

    /** Original file name of an image attachment, if known. */
    function getImageName(hash: string): string | undefined {
        const name = imageNames[hash];
        return name ? truncateAttachmentName(name, 20) : undefined;
    }

    const thumbUrlCache = useThumbnailUrlCache({ graceMs: 30000 });
    const retainThumb = thumbUrlCache.retain;
    const releaseThumb = thumbUrlCache.release;

    const expanded = ref<boolean>(message.value._expanded === true);
    watch(expanded, (v) => {
        message.value._expanded = v;
    });

    function toggleExpanded() {
        if (!hashList.value.length) return;
        expanded.value = !expanded.value;
    }

    async function ensureThumb(hash: string) {
        const generation = getWorkspaceGeneration();
        const current = () => isComponentActive && generation === getWorkspaceGeneration();
        if (pdfMeta[hash]) return;

        const meta = await getFileMeta(hash).catch(() => undefined);
        if (!current()) return;
        if (meta && meta.kind === 'pdf') {
            pdfMeta[hash] = { name: meta.name, kind: meta.kind };
            delete thumbnails[hash];
            return;
        }
        if (
            !meta ||
            meta.kind !== 'image' ||
            !isSupportedRasterMimeType(meta.mime_type)
        ) {
            delete thumbnails[hash];
            return;
        }
        if (meta.name) imageNames[hash] = meta.name;
        if (thumbnails[hash] && thumbnails[hash].status === 'ready') return;

        const cached = thumbUrlCache.get(hash);
        if (cached) {
            thumbnails[hash] = cached;
            return;
        }
        thumbnails[hash] = { status: 'loading' };

        try {
            const state = await thumbUrlCache.ensure(hash, async () => {
                if (generation !== getWorkspaceGeneration()) return null;
                const blob = await getFileBlob(hash);
                if (generation !== getWorkspaceGeneration()) return null;
                thumbUrlCache.setIntrinsicSize(
                    hash,
                    meta.width,
                    meta.height
                );
                if (!blob) return null;
                return blob;
            });

            if (!current()) return;
            if (state) {
                thumbnails[hash] = state;
            } else {
                delete thumbnails[hash];
            }
        } catch {
            if (!current()) return;
            thumbnails[hash] = { status: 'error' };
        }
    }

    const currentHashes = new Set<string>();
    let isComponentActive = true;

    async function syncHashes(list: string[]) {
        const generation = getWorkspaceGeneration();
        const nextSet = new Set(list);
        const newHashes: string[] = [];

        for (const hash of nextSet) {
            if (!currentHashes.has(hash)) {
                if (!thumbnails[hash]) {
                    thumbnails[hash] = { status: 'loading' };
                    newHashes.push(hash);
                } else if (thumbnails[hash].status === 'loading') {
                    newHashes.push(hash);
                }
            }
        }

        if (newHashes.length > 0) {
            await Promise.all(newHashes.map((hash) => ensureThumb(hash)));
        }
        if (!isComponentActive || generation !== getWorkspaceGeneration()) return;

        for (const hash of nextSet) {
            if (!currentHashes.has(hash)) {
                const state = thumbnails[hash];
                if (state?.status === 'ready') {
                    retainThumb(hash);
                    currentHashes.add(hash);
                }
            }
        }

        for (const hash of Array.from(currentHashes)) {
            if (!nextSet.has(hash)) {
                currentHashes.delete(hash);
                releaseThumb(hash);
            }
        }
    }
    // Assistant inline images all use this cache. User attachment rows own
    // only four previews; the expanded gallery loads the remaining files.
    watch(thumbnailHashes, syncHashes, { immediate: true });

    const stopWorkspace = subscribeActiveWorkspaceDb(() => {
        for (const key of Object.keys(thumbnails)) delete thumbnails[key];
        for (const key of Object.keys(pdfMeta)) delete pdfMeta[key];
        for (const key of Object.keys(imageNames)) delete imageNames[key];
        currentHashes.clear();
        void syncHashes(thumbnailHashes.value);
    });

    onBeforeUnmount(() => {
        stopWorkspace();
        isComponentActive = false;
        for (const hash of currentHashes) releaseThumb(hash);
        currentHashes.clear();
    });

    return {
        hashList,
        thumbnails,
        pdfMeta,
        maxDisplayedThumbs,
        displayedHashes,
        getAttachmentName,
        getImageName,
        expanded,
        toggleExpanded,
    };
}
