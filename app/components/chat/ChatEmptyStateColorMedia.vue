<script setup lang="ts">
import { computed } from 'vue';
import { useHead } from '#imports';
import { getEmptyStateArtwork } from '~/utils/chat/empty-state-artwork';
import type { ThemeBackgroundLayer } from '~/theme/_shared/types';
import ChatEmptyStateMedia from './ChatEmptyStateMedia.vue';

defineOptions({ inheritAttrs: false });
type Media = {
    src?: string | null;
    width?: number;
    height?: number;
    alt?: string;
    background?: ThemeBackgroundLayer;
};
const props = defineProps<{
    light?: Media | false;
    dark?: Media | false;
    fallback: Media;
}>();
// Both variants occupy the same box. The pre-paint color-mode class selects
// which one is visible, before Vue can read the browser's saved preference.
// Local blobs and variants with different geometry retain client resolution.
const paired = computed(() => {
    const { light, dark } = props;
    return Boolean(
        light && dark &&
        !light.src?.startsWith('internal-file://') &&
        !dark.src?.startsWith('internal-file://') &&
        Boolean(light.background) === Boolean(dark.background) &&
        light.width === dark.width && light.height === dark.height
    );
});
// Start the visible public image before modulepreloads occupy the connection.
// Match the configured Nuxt color-mode preference without exporting it to SSR.
// The JSON is escaped because source themes may contain arbitrary asset URLs.
if (import.meta.server && paired.value && props.light && props.dark &&
    props.light.src && props.dark.src) {
    const sources = JSON.stringify([props.light.src, props.dark.src].map(src => ({ src, ...getEmptyStateArtwork(src) }))).replaceAll('<', '\\u003c');
    useHead({ script: [{
        key: 'or3-empty-media-' + props.light.src,
        // After the viewport meta (-15), before styles/modulepreloads.
        tagPriority: -5,
        innerHTML: `(()=>{try{
            const sources=${sources};
            const preference=localStorage.getItem('theme')||'system';
            const forced=document.documentElement.getAttribute('data-color-mode-forced');
            const mode=forced||(preference==='system'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):preference);
            const link=document.createElement('link');
            link.rel='preload';link.as='image';link.fetchPriority='high';
            const source=sources[mode==='dark'?1:0];
            if(source.srcset){link.imageSrcset=source.avifSrcset||source.srcset;link.imageSizes=source.sizes;}
            if(source.avifSrcset)link.type='image/avif';
            link.href=source.src;document.head.append(link);
        }catch{}})();`,
    }] });
}
</script>

<template>
    <template v-if="paired">
        <ChatEmptyStateMedia
            v-bind="{ ...$attrs, ...light }"
            class="chat-empty-media-light"
            loading="lazy"
            fetchpriority="high"
        />
        <ChatEmptyStateMedia
            v-bind="{ ...$attrs, ...dark }"
            class="chat-empty-media-dark"
            loading="lazy"
            fetchpriority="high"
        />
    </template>
    <ClientOnly v-else>
        <ChatEmptyStateMedia v-bind="{ ...$attrs, ...fallback }" />
    </ClientOnly>
</template>

<style>
html.dark .chat-empty-media-light,
html:not(.dark) .chat-empty-media-dark {
    display: none !important;
}
</style>
