import { computed, onBeforeUnmount, reactive, ref, watch, type Ref } from 'vue';
import { parseHashes } from '~/utils/files/attachments';
import { getFileMeta } from '~/db/files';
import {
    useThumbnailUrlCache,
    type ThumbState,
} from '~/composables/core/useThumbnailUrlCache';
import { truncateAttachmentName } from '~/utils/chat/truncateAttachmentName';

type MessageWithAttachments = {
    file_hashes?: unknown;
    _expanded?: boolean;
};

type LocalThumbState = ThumbState | { status: 'loading' };

export function useMessageThumbnails(message: Ref<MessageWithAttachments>) {
    const hashList = computed<string[]>(() => parseHashes(message.value.file_hashes));
    const thumbnails = reactive<Record<string, LocalThumbState>>({});
    const pdfMeta = reactive<Record<string, { name?: string; kind: string }>>({});

    const maxDisplayedThumbs = 4;
    const displayedHashes = computed(() =>
        hashList.value.slice(0, maxDisplayedThumbs)
    );

    function getAttachmentName(hash: string): string {
        const meta = pdfMeta[hash];
        if (meta?.name) {
            return truncateAttachmentName(meta.name, 20);
        }
        return 'Document';
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
        if (pdfMeta[hash]) return;
        if (thumbnails[hash] && thumbnails[hash].status === 'ready') return;

        const cached = thumbUrlCache.get(hash);
        if (cached) {
            thumbnails[hash] = cached;
            return;
        }
        thumbnails[hash] = { status: 'loading' };

        try {
            const state = await thumbUrlCache.ensure(hash, async () => {
                const [blob, meta] = await Promise.all([
                    (await import('~/db/files')).getFileBlob(hash),
                    getFileMeta(hash).catch(() => undefined),
                ]);

                if (meta && meta.kind === 'pdf') {
                    pdfMeta[hash] = { name: meta.name, kind: meta.kind };
                    return null;
                }
                thumbUrlCache.setIntrinsicSize(
                    hash,
                    meta?.width,
                    meta?.height
                );
                if (!blob) return null;
                if (blob.type === 'application/pdf') {
                    pdfMeta[hash] = { name: meta?.name, kind: 'pdf' };
                    return null;
                }
                return blob;
            });

            if (state) {
                thumbnails[hash] = state;
            } else {
                delete thumbnails[hash];
            }
        } catch {
            thumbnails[hash] = { status: 'error' };
        }
    }

    const currentHashes = new Set<string>();
    let isComponentActive = true;

    watch(
        hashList,
        async (list) => {
            const nextSet = new Set(list);
            const newHashes: string[] = [];

            for (const hash of nextSet) {
                if (!currentHashes.has(hash)) {
                    if (!thumbnails[hash]) {
                        const cached = thumbUrlCache.get(hash);
                        if (cached) {
                            thumbnails[hash] = cached;
                        } else {
                            thumbnails[hash] = { status: 'loading' };
                            newHashes.push(hash);
                        }
                    } else if (thumbnails[hash].status === 'loading') {
                        newHashes.push(hash);
                    }
                }
            }

            if (newHashes.length > 0) {
                await Promise.all(newHashes.map((hash) => ensureThumb(hash)));
            }

            for (const hash of nextSet) {
                if (!currentHashes.has(hash)) {
                    const state = thumbUrlCache.get(hash);
                    if (state?.status === 'ready') {
                        if (!isComponentActive) {
                            retainThumb(hash);
                            releaseThumb(hash);
                            return;
                        }
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
        },
        { immediate: true }
    );

    onBeforeUnmount(() => {
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
        expanded,
        toggleExpanded,
    };
}
