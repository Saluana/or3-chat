<template>
    <div class="or3-palette-preview flex min-h-0 flex-col">
        <div
            class="shrink-0 flex items-center justify-between gap-2 px-3 pt-3 pb-1.5"
        >
            <span
                class="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[color:var(--md-on-surface-variant)]/85"
            >
                {{ headerLabel }}
            </span>
            <span
                v-if="previewLoading"
                class="inline-flex items-center gap-1 text-[10.5px] text-[color:var(--md-on-surface-variant)]"
            >
                <UIcon :name="loadingIcon" class="h-3 w-3 animate-spin" />
                Loading
            </span>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div
                v-if="!result"
                class="flex h-full flex-col items-center justify-center gap-1.5 py-8 text-center"
            >
                <UIcon
                    :name="searchIcon"
                    class="h-5 w-5 text-[color:var(--md-on-surface-variant)]/60"
                />
                <p class="text-[11.5px] text-[color:var(--md-on-surface-variant)]">
                    Select a result to preview it
                </p>
            </div>

            <template v-else>
                <div
                    v-if="preview?.imageObjectUrl"
                    class="mb-2.5 overflow-hidden rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[color:var(--md-surface-variant)]/30"
                >
                    <img
                        :src="preview.imageObjectUrl"
                        :alt="result.title"
                        class="mx-auto max-h-[190px] w-full object-contain"
                    />
                </div>

                <div class="flex items-start gap-2">
                    <span
                        class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[color:var(--md-surface-variant)]/40 text-[color:var(--md-on-surface-variant)]"
                    >
                        <UIcon :name="iconForResult(result)" class="h-3.5 w-3.5" />
                    </span>
                    <div class="min-w-0 flex-1">
                        <h3
                            class="text-[13.5px] font-semibold leading-snug text-[color:var(--md-on-surface)]"
                        >
                            {{ result.title }}
                        </h3>
                        <p
                            class="mt-0.5 text-[11px] text-[color:var(--md-on-surface-variant)]"
                        >
                            {{ categoryLabel }}
                            <template v-if="timeLabel">
                                · {{ timeLabel }}
                            </template>
                        </p>
                    </div>
                </div>

                <p
                    v-if="preview?.unavailable"
                    class="mt-2.5 rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[color:var(--md-surface-variant)]/25 px-2.5 py-2 text-[11.5px] text-[color:var(--md-on-surface-variant)]"
                >
                    Preview unavailable. This result can still be opened.
                </p>

                <blockquote
                    v-else-if="bodyText"
                    class="mt-2.5 rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[color:var(--md-surface-variant)]/25 px-2.5 py-2 text-[12px] leading-relaxed text-[color:var(--md-on-surface)]/90"
                >
                    <span class="line-clamp-[9] whitespace-pre-line">{{
                        bodyText
                    }}</span>
                </blockquote>

                <dl v-if="metadataRows.length" class="mt-2.5 space-y-1">
                    <div
                        v-for="row in metadataRows"
                        :key="row.key"
                        class="flex items-baseline justify-between gap-2 text-[11.5px]"
                    >
                        <dt
                            class="shrink-0 text-[color:var(--md-on-surface-variant)]"
                        >
                            {{ row.label }}
                        </dt>
                        <dd
                            class="min-w-0 truncate text-right text-[color:var(--md-on-surface)]"
                        >
                            {{ row.value }}
                        </dd>
                    </div>
                </dl>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useIcon } from '~/composables/useIcon';
import type {
    PaletteCategory,
    PalettePreview,
    PaletteResult,
} from '~/core/search/command-palette/types';
import { paletteMetaRows, paletteTimeLabel } from './palette-dom';
import { usePaletteIcons } from './usePaletteIcons';

const props = defineProps<{
    result: PaletteResult | null;
    preview: PalettePreview | null;
    previewLoading: boolean;
    categories: readonly PaletteCategory[];
}>();

const loadingIcon = useIcon('ui.loading');
const searchIcon = useIcon('palette.search');
const { iconForResult } = usePaletteIcons();

const categoryLabel = computed(() => {
    if (!props.result) return '';
    const category = props.categories.find(
        (entry) => entry.id === props.result?.categoryId
    );
    return category?.label ?? props.result.categoryId;
});

const headerLabel = 'Preview';

const timeLabel = computed(() => paletteTimeLabel(props.result?.updatedAt));

const bodyText = computed(() => {
    const title = props.result?.title.trim().toLowerCase();
    // Subtitles are deliberately absent: they already appear in the row and in
    // the metadata list, so repeating them as body copy is noise.
    const candidates = [
        props.preview?.snippet,
        props.result?.snippet,
        props.preview?.description,
    ];
    // A snippet that just repeats the title (filename matches, say) adds nothing.
    for (const candidate of candidates) {
        const text = candidate?.trim();
        if (text && text.toLowerCase() !== title) return text;
    }
    return '';
});

const metadataRows = computed(() =>
    paletteMetaRows(props.preview?.metadata ?? props.result?.metadata ?? {})
);
</script>
