<template>
    <div
        class="or3-palette-results flex-1 min-h-0 overflow-y-auto overscroll-contain py-1"
        @mousemove.capture="emit('pointer-move')"
    >
        <!-- Sources still building -->
        <div
            v-if="pendingSources.length"
            class="px-3 sm:px-4 pt-2 pb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[color:var(--md-on-surface-variant)]"
            aria-hidden="true"
        >
            <UIcon :name="loadingIcon" class="h-3 w-3 animate-spin" />
            <span
                >Indexing {{ pendingSources.join(', ') }}…
            </span>
        </div>

        <!-- Failed sources: compact, retryable, never blocks healthy sources -->
        <div
            v-for="status in failedStatuses"
            :key="`palette-failed-${status.sourceId}`"
            class="mx-3 sm:mx-4 my-1.5 flex items-center gap-2 rounded-[var(--md-border-radius)] border border-[color:var(--md-error)]/35 bg-[color-mix(in_srgb,var(--md-error)_8%,transparent)] px-2.5 py-1.5 text-[12px] text-[color:var(--md-on-surface)]"
        >
            <UIcon
                :name="alertIcon"
                class="h-3.5 w-3.5 shrink-0 text-[color:var(--md-error)]"
            />
            <span class="min-w-0 flex-1 truncate">
                {{ sourceLabel(status.sourceId) }} search is unavailable
            </span>
            <button
                type="button"
                class="shrink-0 rounded-full border border-[color:var(--md-border-color)] px-2 py-0.5 text-[11px] hover:bg-[color:var(--md-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--md-primary)]/40"
                @click="emit('retry', status.sourceId)"
            >
                Retry
            </button>
        </div>

        <ul
            :id="listboxId"
            class="or3-palette-listbox"
            role="listbox"
            aria-label="Search results"
        >
            <template v-for="group in groups" :key="`palette-group-${group.categoryId}`">
                <li
                    :id="`${listboxId}-group-${group.categoryId}`"
                    role="presentation"
                    class="px-3 sm:px-4 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[color:var(--md-on-surface-variant)]/85"
                >
                    {{ group.label }}
                </li>
                <li
                    v-for="result in group.results"
                    :key="result.key"
                    :id="optionId(result.key)"
                    role="option"
                    :aria-selected="result.key === activeKey"
                    :aria-disabled="result.primaryAction.disabled || undefined"
                    class="or3-palette-option mx-1.5 sm:mx-2 flex cursor-pointer items-center gap-2.5 rounded-[var(--md-border-radius)] border-l-2 px-2 py-1.5 transition-colors duration-75"
                    :class="
                        result.key === activeKey
                            ? 'border-l-[color:var(--md-primary)] bg-[color-mix(in_srgb,var(--md-primary)_11%,transparent)]'
                            : 'border-l-transparent hover:bg-[color:var(--md-surface-hover)]'
                    "
                    @mouseenter="emit('hover', result.key)"
                    @mousemove="emit('hover', result.key)"
                    @click="onRowClick(result.key)"
                >
                    <PaletteImageThumb
                        v-if="result.categoryId === 'image'"
                        :hash="result.recordId"
                        :alt="result.title"
                        :fallback-icon="iconForResult(result)"
                        :size-bytes="imageBytes(result)"
                    />
                    <span
                        v-else
                        class="or3-palette-option-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[color:var(--md-surface-variant)]/40 text-[color:var(--md-on-surface-variant)]"
                    >
                        <UIcon :name="iconForResult(result)" class="h-3.5 w-3.5" />
                    </span>

                    <span class="min-w-0 flex-1">
                        <span
                            class="block truncate text-[13.5px] font-medium leading-tight text-[color:var(--md-on-surface)]"
                        >
                            {{ result.title }}
                        </span>
                        <span
                            v-if="rowDetail(result)"
                            class="mt-0.5 block truncate text-[11.5px] leading-tight text-[color:var(--md-on-surface-variant)]"
                        >
                            {{ rowDetail(result) }}
                        </span>
                    </span>

                    <span
                        v-if="result.primaryAction.disabled"
                        class="shrink-0 rounded-full border border-[color:var(--md-border-color)] px-1.5 py-0.5 text-[10px] text-[color:var(--md-on-surface-variant)]"
                        :title="result.primaryAction.disabledReason"
                    >
                        Unavailable
                    </span>
                    <template v-else>
                        <span
                            v-if="timeLabel(result.updatedAt)"
                            class="shrink-0 text-[10.5px] tabular-nums text-[color:var(--md-on-surface-variant)]/80"
                            :class="result.key === activeKey ? 'sm:hidden' : ''"
                        >
                            {{ timeLabel(result.updatedAt) }}
                        </span>
                        <!-- Keyboard hint only where a keyboard exists. -->
                        <span
                            v-if="result.key === activeKey"
                            class="hidden shrink-0 rounded border border-[color:var(--md-border-color)] bg-[color:var(--md-surface)] px-1.5 py-0.5 text-[10px] leading-none text-[color:var(--md-on-surface-variant)] sm:inline-block"
                            aria-hidden="true"
                        >
                            ↵
                        </span>
                    </template>
                </li>
            </template>
        </ul>

        <!-- Skeleton while the first index warms -->
        <div v-if="showSkeleton" class="space-y-1.5 px-2 py-2">
            <div
                v-for="row in 4"
                :key="`palette-skeleton-${row}`"
                class="flex items-center gap-2.5 rounded-[var(--md-border-radius)] px-2 py-1.5"
            >
                <span
                    class="h-7 w-7 shrink-0 animate-pulse rounded-[var(--md-border-radius)] bg-[color:var(--md-surface-variant)]/60"
                />
                <span class="min-w-0 flex-1 space-y-1.5">
                    <span
                        class="block h-2.5 animate-pulse rounded-full bg-[color:var(--md-surface-variant)]/60"
                        :style="{ width: `${68 - row * 6}%` }"
                    />
                    <span
                        class="block h-2 animate-pulse rounded-full bg-[color:var(--md-surface-variant)]/40"
                        :style="{ width: `${46 - row * 4}%` }"
                    />
                </span>
            </div>
        </div>

        <!-- Empty state -->
        <div
            v-else-if="showEmpty"
            class="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center"
        >
            <UIcon
                :name="searchIcon"
                class="h-6 w-6 text-[color:var(--md-on-surface-variant)]/70"
            />
            <p class="text-[13px] font-medium text-[color:var(--md-on-surface)]">
                No results{{ trimmedQuery ? ` for “${trimmedQuery}”` : '' }}
            </p>
            <p class="text-[11.5px] text-[color:var(--md-on-surface-variant)]">
                {{ emptyHint }}
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useIcon } from '~/composables/useIcon';
import type { PaletteResultGroup } from '~/composables/search/useCommandPalette';
import type {
    PaletteResult,
    PaletteSourceStatus,
} from '~/core/search/command-palette/types';
import {
    PALETTE_LISTBOX_ID,
    paletteOptionDomId,
    paletteTimeLabel,
} from './palette-dom';
import PaletteImageThumb from './PaletteImageThumb.vue';
import { usePaletteIcons } from './usePaletteIcons';

const props = defineProps<{
    groups: readonly PaletteResultGroup[];
    statuses: readonly PaletteSourceStatus[];
    sourceLabels: Readonly<Record<string, string>>;
    activeKey: string | null;
    loading: boolean;
    query: string;
    activeCategoryLabel?: string;
}>();

const emit = defineEmits<{
    (e: 'hover', key: string): void;
    (e: 'activate', key: string): void;
    (e: 'pointer-move'): void;
    (e: 'retry', sourceId: string): void;
}>();

const listboxId = PALETTE_LISTBOX_ID;
const loadingIcon = useIcon('ui.loading');
const alertIcon = useIcon('ui.warning');
const searchIcon = useIcon('palette.search');
const { iconForResult } = usePaletteIcons();

const resultCount = computed(() =>
    props.groups.reduce((total, group) => total + group.results.length, 0)
);

const trimmedQuery = computed(() => {
    const colonIndex = props.query.indexOf(':');
    const remainder =
        colonIndex > 0 ? props.query.slice(colonIndex + 1) : props.query;
    return remainder.trim();
});

const failedStatuses = computed(() =>
    props.statuses.filter((status) => status.state === 'error')
);

const pendingSources = computed(() =>
    props.statuses
        .filter((status) => status.state === 'loading')
        .map((status) => sourceLabel(status.sourceId))
);

const showSkeleton = computed(
    () => resultCount.value === 0 && (props.loading || pendingSources.value.length > 0)
);

const showEmpty = computed(
    () => resultCount.value === 0 && !showSkeleton.value
);

const emptyHint = computed(() => {
    if (props.activeCategoryLabel) {
        return `Nothing in ${props.activeCategoryLabel}. Remove the filter to search everything.`;
    }
    return 'Try a shorter term, or use a filter like chat:, doc:, or command:';
});

function sourceLabel(sourceId: string): string {
    return props.sourceLabels[sourceId] ?? sourceId;
}

function onRowClick(key: string): void {
    emit('activate', key);
}

/** Secondary row line: the match snippet, unless it merely repeats the title. */
function rowDetail(result: PaletteResult): string | undefined {
    const snippet = result.snippet?.trim();
    if (snippet && snippet.toLowerCase() !== result.title.trim().toLowerCase()) {
        return snippet;
    }
    return result.subtitle;
}

function imageBytes(result: PaletteResult): number | null {
    const bytes = result.metadata['size_bytes'];
    return typeof bytes === 'number' ? bytes : null;
}

function optionId(key: string): string {
    return paletteOptionDomId(key);
}

function timeLabel(updatedAt?: number): string {
    return paletteTimeLabel(updatedAt);
}
</script>
