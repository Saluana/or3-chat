import { computed, onBeforeUnmount, reactive, ref, watch, type Ref } from 'vue';
import { resizePreview } from '~/utils/files/resizePreview';
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
    // Streaming replaces the message projection on each displayed text frame.
    // Preserve equal normalized lists so text changes do not restart loads.
    // Read the hashes on every projection: the producer may have appended to
    // its raw array without changing that array's identity.
    const hashList = computed<string[]>((previous) => {
        const next = parseHashes(message.value.file_hashes);
        return previous?.length === next.length &&
            next.every((hash, index) => hash === previous[index])
            ? previous
            : next;
    });
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
    const cacheKey = (hash: string) => message.value.role === 'assistant' ? hash : `attachment-thumb:${hash}`;

    const expanded = ref<boolean>(message.value._expanded === true);
    watch(expanded, (v) => {
        message.value._expanded = v;
    });

    function toggleExpanded() {
        if (!hashList.value.length) return;
        expanded.value = !expanded.value;
    }

    async function ensureThumb(hash: string, owner: symbol, key: string) {
        const generation = getWorkspaceGeneration();
        const current = () => isComponentActive && generation === getWorkspaceGeneration() && currentHashes.get(hash)?.owner === owner;
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

        const cached = thumbUrlCache.get(key);
        if (cached) {
            thumbnails[hash] = cached;
            return;
        }
        thumbnails[hash] = { status: 'loading' };

        thumbUrlCache.setIntrinsicSize(key, meta.width, meta.height);
        try {
            const state = await thumbUrlCache.ensure(key, async (current, signal) => {
                if (generation !== getWorkspaceGeneration()) return null;
                const blob = await getFileBlob(hash);
                if (generation !== getWorkspaceGeneration()) return null;
                if (!blob) return null;
                return key === hash ? blob : resizePreview(blob, 160, current, undefined, signal);
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

    const currentHashes = new Map<string, { owner: symbol; key: string }>();
    let isComponentActive = true;

    function syncHashes(list: string[]) {
        const nextSet = new Set(list);
        for (const hash of currentHashes.keys()) {
            const existing = currentHashes.get(hash)!;
            if (nextSet.has(hash) && existing.key === cacheKey(hash)) continue;
            currentHashes.delete(hash);
            thumbUrlCache.release(existing.key);
            delete thumbnails[hash];
            delete pdfMeta[hash];
            delete imageNames[hash];
        }
        for (const hash of nextSet) {
            if (currentHashes.has(hash)) continue;
            const owner = Symbol(hash);
            const key = cacheKey(hash);
            currentHashes.set(hash, { owner, key });
            // Own the URL while loading, not only after its decode completes.
            thumbUrlCache.retain(key);
            thumbnails[hash] = { status: 'loading' };
            void ensureThumb(hash, owner, key);
        }
    }
    // Assistant inline images all use this cache. User attachment rows own
    // only four previews; the expanded gallery loads the remaining files.
    watch([thumbnailHashes, () => message.value.role], ([hashes]) => syncHashes(hashes), { immediate: true });

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
        for (const { key } of currentHashes.values()) thumbUrlCache.release(key);
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
