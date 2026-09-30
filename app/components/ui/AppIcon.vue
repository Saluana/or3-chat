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
        <UIcon v-else-if="icon" :name="icon" class="h-full w-full" />
    </span>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
    icon?: string;
    image?: string;
}>();

const imageFailed = ref(false);

watch(
    () => props.image,
    () => {
        imageFailed.value = false;
    }
);
</script>
