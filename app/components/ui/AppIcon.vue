<template>
    <span class="app-icon inline-flex shrink-0 items-center justify-center overflow-hidden">
        <img
            v-if="image && !imageFailed"
            :src="image"
            alt=""
            class="h-full w-full object-contain"
            loading="lazy"
            decoding="async"
            draggable="false"
            @error="imageFailed = true"
        />
        <UIcon v-else-if="resolvedIcon" :name="resolvedIcon" class="h-full w-full" />
    </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useIcon } from '~/composables/useIcon';
import type { IconToken } from '~/config/icon-tokens';

const props = defineProps<{
    icon?: string;
    iconToken?: IconToken;
    image?: string;
}>();

const imageFailed = ref(false);
const themedIcon = useIcon(() => props.iconToken ?? 'ui.unknown');
const resolvedIcon = computed(() => props.iconToken ? themedIcon.value : props.icon);

watch(
    () => props.image,
    () => {
        imageFailed.value = false;
    }
);
</script>
