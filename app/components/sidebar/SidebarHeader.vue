<template>
    <div
        :class="{
            'px-0 justify-center': collapsed,
            'px-3 justify-between': !collapsed,
        }"
        class="flex items-center header-pattern py-2 border-b-2 border-[var(--md-inverse-surface)] bg-[var(--md-surface-variant)] dark:bg-[var(--md-surface-container-high)]"
    >
        <div v-show="!collapsed">
            <slot name="sidebar-header">
                <div class="flex items-center space-x-2">
                    <h1 class="text-[14px] font-medium uppercase tracking-wide">
                        or3-chat
                    </h1>
                </div>
            </slot>
        </div>

        <slot name="sidebar-toggle" :collapsed="collapsed" :toggle="onToggle">
            <UButton
                size="xs"
                :square="true"
                color="neutral"
                variant="ghost"
                :class="'retro-btn'"
                @click="onToggle"
                :ui="{ base: 'retro-btn' }"
                :aria-label="toggleAria"
                :title="toggleAria"
            >
                <UIcon :name="toggleIcon" class="w-5 h-5" />
            </UButton>
        </slot>
    </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
    collapsed: { type: Boolean, required: true },
    toggleIcon: { type: String, required: true },
    toggleAria: { type: String, required: true },
});
const emit = defineEmits(['toggle']);

function onToggle() {
    emit('toggle');
}
</script>

<style scoped>
/* Gradient already supplied by global pattern image; we just ensure better dark base */
.header-pattern {
    background-image: url('/gradient-x.webp');
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
}
.dark .header-pattern {
    /* Elevated surface tone for dark mode header to distinguish from main background */
    background-color: var(--md-surface-container-high) !important;
}

/* Logo rendering tweaks */
.logo {
    width: 20px; /* lock display size */
    height: 20px;
    aspect-ratio: 1 / 1;
    display: block;
    /* Remove any default smoothing hinting if you later swap to pixel-art variant */
    /* image-rendering: pixelated; */
}

/* When you add smaller dedicated raster exports (e.g. logo-20.png, logo-40.png, logo-60.png),
   switch to a DPR-based srcset for sharper sampling:
   src="/logo-20.png"
   srcset="/logo-20.png 1x, /logo-40.png 2x, /logo-60.png 3x" */
</style>
