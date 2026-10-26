<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ThemeBackgroundLayer } from '~/theme/_shared/types';
import { createThemeBackgroundTokenResolver } from '~/core/theme/backgrounds';
import { getEmptyStateArtwork } from '~/utils/chat/empty-state-artwork';
defineOptions({ inheritAttrs: false });
const props = defineProps<{
    src?: string | null;
    width?: number;
    height?: number;
    alt?: string;
    background?: ThemeBackgroundLayer;
    loading?: 'lazy' | 'eager';
    fetchpriority?: 'high' | 'low' | 'auto';
}>();
const mounted = ref(false);
const url = ref<string | null>(null);
const failed = ref(false);
const responsiveFailed = ref(false);
const resolveToken = createThemeBackgroundTokenResolver();
let revision = 0;
onMounted(() => {
    mounted.value = true;
});
watch(
    [() => props.src, mounted],
    async ([src, ready]) => {
        const current = ++revision;
        failed.value = false;
        responsiveFailed.value = false;
        url.value = null;
        if (!src) return;
        if (!src.startsWith('internal-file://')) {
            url.value = src;
            return;
        }
        if (!ready) return;
        const resolved = await resolveToken(src);
        if (current === revision) url.value = resolved;
    },
    { immediate: true, flush: 'sync' },
);
const artwork = computed(() => responsiveFailed.value ? null : getEmptyStateArtwork(url.value));
function onImageError() {
    // Responsive copies are cached on demand. An offline/failed variant must
    // still use the original (also available in the existing PWA precache).
    if (artwork.value) responsiveFailed.value = true;
    else failed.value = true;
}
const backgroundStyle = computed(() => ({
    '--chat-empty-wide-image': !failed.value ? artwork.value?.background?.wide : undefined,
    '--chat-empty-mobile-image': !failed.value ? artwork.value?.background?.mobile : undefined,
    backgroundColor: props.background?.color,
    backgroundImage:
        !failed.value && url.value
            ? 'url(' + JSON.stringify(url.value) + ')'
            : undefined,
    backgroundSize: props.background?.fit ?? props.background?.size ?? 'cover',
    backgroundRepeat: props.background?.repeat ?? 'no-repeat',
    backgroundPosition: 'center',
    opacity: props.background?.opacity ?? 1,
}));
</script>

<template>
    <div
        v-if="background"
        v-bind="$attrs"
        :style="backgroundStyle"
        :class="{ 'chat-empty-background-responsive': !failed && artwork?.background }"
        aria-hidden="true"
    >
        <picture v-if="url && !failed" :key="url + String(responsiveFailed)">
            <source v-if="artwork?.avifSrcset" type="image/avif"
                :srcset="artwork.avifSrcset" :sizes="artwork.sizes" />
            <img
                :src="url"
                :srcset="artwork?.srcset"
                :sizes="artwork?.sizes"
                :loading="loading"
                :fetchpriority="fetchpriority"
                class="chat-empty-background-image"
                alt=""
                @error="onImageError"
            />
        </picture>
    </div>
    <img
        v-else-if="url && !failed"
        v-bind="$attrs"
        :key="url + String(responsiveFailed)"
        :src="url"
        :srcset="artwork?.srcset"
        :sizes="artwork?.sizes"
        :loading="loading"
        :fetchpriority="fetchpriority"
        :width="width"
        :height="height"
        :alt="alt ?? ''"
        :aria-hidden="!alt ? true : undefined"
        decoding="async"
        draggable="false"
        @error="onImageError"
    />
</template>

<style scoped>
@supports (background-image: image-set(url("") type("image/webp"))) {
    .chat-empty-background-responsive {
        background-image: var(--chat-empty-wide-image) !important;
    }
    @media (max-width: 767px) {
        .chat-empty-background-responsive {
            background-image: var(--chat-empty-mobile-image) !important;
        }
    }
}
.chat-empty-background-image {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
}
</style>
