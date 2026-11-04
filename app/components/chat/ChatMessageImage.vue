<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useAttrs, type Ref } from 'vue';
import type { FileMeta } from '~/db/schema';
import { getFileMeta } from '~/db/files';
import { reportError } from '~/utils/errors';
import { useImageFileActions } from '~/pages/images/image-file-actions';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '#imports';

// Markdown `img` renderer for chat messages. Stored images arrive as
// `![file-hash:<hash>](placeholder)` and ChatMessage hydrates their src.
defineOptions({ inheritAttrs: false });

const ImageViewer = defineAsyncComponent(() => import('~/pages/images/ImageViewer.vue'));

const attrs = useAttrs();
const iconCopy = useIcon('image.copy');
const iconDownload = useIcon('image.download');
const { download, copy } = useImageFileActions();

const hash = computed(() => {
    const alt = attrs.alt;
    return typeof alt === 'string' && alt.startsWith('file-hash:')
        ? alt.slice('file-hash:'.length)
        : null;
});
const viewerMeta = ref<FileMeta | null>(null);
const viewerOpen = ref(false);

async function withMeta(action: (meta: FileMeta) => unknown) {
    if (!hash.value) return;
    const meta = await getFileMeta(hash.value);
    if (meta) return action(meta);
    reportError(new Error('file meta missing'), {
        code: 'ERR_DB_READ_FAILED',
        message: "Couldn't find this image.",
        tags: { domain: 'images', action: 'chat-image', hash: hash.value },
    });
}

function openViewer() {
    void withMeta((meta) => {
        viewerMeta.value = meta;
        viewerOpen.value = true;
    });
}

function actionButtonProps(identifier: string, icon: Readonly<Ref<string>>) {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'chat',
        identifier,
        isNuxtUI: true,
    });
    return computed(() => ({
        size: 'sm' as const,
        variant: 'solid' as const,
        color: 'neutral' as const,
        square: true as const,
        class: 'flex items-center justify-center',
        icon: icon.value,
        ...overrides.value,
    }));
}

const copyButtonProps = actionButtonProps('chat.image.copy', iconCopy);
const downloadButtonProps = actionButtonProps('chat.image.download', iconDownload);
</script>

<template>
    <img v-if="!hash" v-bind="attrs" />
    <span v-else class="group relative inline-block max-w-full align-top">
        <button
            type="button"
            class="block max-w-full cursor-zoom-in focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-(--md-primary)"
            aria-label="Open image preview"
            @click="openViewer"
        >
            <img v-bind="attrs" class="m-0!" />
        </button>
        <span
            class="pointer-events-none absolute top-2 right-2 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
        >
            <UButton
                v-bind="copyButtonProps"
                class="pointer-events-auto"
                aria-label="Copy image"
                @click.stop="withMeta(copy)"
            />
            <UButton
                v-bind="downloadButtonProps"
                class="pointer-events-auto"
                aria-label="Download image"
                @click.stop="withMeta(download)"
            />
        </span>
        <ImageViewer
            v-if="viewerMeta"
            v-model="viewerOpen"
            :meta="viewerMeta"
            hide-delete
            @download="download"
            @copy="copy"
        />
    </span>
</template>
