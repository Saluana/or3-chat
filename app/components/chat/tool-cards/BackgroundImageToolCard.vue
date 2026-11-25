<template>
    <div class="background-tool-card" :data-status="card.status">
        <span class="background-tool-thumb" aria-hidden="true">
            <PaletteImageThumb
                v-if="result?.image.kind === 'file'"
                :hash="result.image.hash"
                :alt="result.image.name"
                :fallback-icon="imageIcon"
                class="background-tool-thumb-image"
            />
            <UIcon v-else :name="imageIcon" class="h-4 w-4" />
        </span>
        <span class="background-tool-copy">
            <strong>{{ title }}</strong>
            <small>{{ detail }}</small>
        </span>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ToolCardContext } from '@or3/plugin-sdk/cards';
import PaletteImageThumb from '~/components/search/PaletteImageThumb.vue';
import { useIcon } from '~/composables/useIcon';

interface BackgroundToolResult {
    mode: 'light' | 'dark';
    areas: Array<{ area: string; label: string; opacity: number }>;
    image:
        | { kind: 'file'; hash: string; name: string; inChat: boolean }
        | { kind: 'theme' | 'none' };
    layout: 'fill' | 'single' | 'repeat' | null;
}

const props = defineProps<{ card: ToolCardContext }>();
const imageIcon = useIcon('palette.image');

const LAYOUT_LABELS = { fill: 'Fill area', single: 'Single', repeat: 'Repeat' } as const;

const result = computed(() => {
    const value = props.card.status === 'complete' ? props.card.result : null;
    if (!value || typeof value !== 'object' || !Array.isArray((value as BackgroundToolResult).areas)) return null;
    return value as BackgroundToolResult;
});

const title = computed(() => {
    if (props.card.status === 'error') return 'Background not changed';
    if (!result.value) return 'Setting background…';
    return result.value.areas.map((area) => area.label).join(', ');
});

const detail = computed(() => {
    if (props.card.status === 'error') return props.card.error ?? 'The tool failed.';
    const value = result.value;
    if (!value) return '';
    const mode = `${value.mode} mode`;
    const image = value.image;
    if (image.kind === 'none') return `Image removed · ${mode}`;
    const opacity = `${Math.round((value.areas[0]?.opacity ?? 0) * 100)}%`;
    const layout = value.layout ? LAYOUT_LABELS[value.layout] : '';
    const source = image.kind === 'file'
        ? image.inChat ? 'From this chat' : image.name
        : 'Theme pattern';
    return [source, layout, opacity, mode].filter(Boolean).join(' · ');
});
</script>

<style scoped>
.background-tool-card {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
}
.background-tool-thumb {
    position: relative;
    display: grid;
    width: 3.5rem;
    height: 2.5rem;
    flex: none;
    overflow: hidden;
    place-items: center;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    background: var(--md-surface-variant);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}
.background-tool-thumb-image {
    position: absolute;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
    border: 0 !important;
    border-radius: 0 !important;
}
.background-tool-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    font-size: 0.8125rem;
}
.background-tool-copy strong {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.background-tool-copy small {
    overflow: hidden;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.background-tool-card[data-status='error'] small {
    color: var(--md-error, var(--md-on-surface));
    white-space: normal;
}
</style>
