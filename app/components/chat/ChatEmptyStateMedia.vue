<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ThemeBackgroundLayer } from '~/theme/_shared/types';
import { createThemeBackgroundTokenResolver } from '~/core/theme/backgrounds';
defineOptions({ inheritAttrs: false });
const props = defineProps<{
    src?: string | null;
    width?: number;
    height?: number;
    alt?: string;
    background?: ThemeBackgroundLayer;
}>();
const mounted = ref(false);
const url = ref<string | null>(null);
const failed = ref(false);
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
const backgroundStyle = computed(() => ({
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
        aria-hidden="true"
    >
        <img
            v-if="url && !failed"
            :key="url"
            :src="url"
            class="chat-empty-background-image"
            alt=""
            @error="failed = true"
        />
    </div>
    <img
        v-else-if="url && !failed"
        v-bind="$attrs"
        :key="url"
        :src="url"
        :width="width"
        :height="height"
        :alt="alt ?? ''"
        :aria-hidden="!alt ? true : undefined"
        decoding="async"
        draggable="false"
        @error="failed = true"
    />
</template>

<style scoped>
.chat-empty-background-image {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
}
</style>
