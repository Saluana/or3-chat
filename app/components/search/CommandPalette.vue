<template>
    <UModal
        v-bind="modalProps"
        :open="isOpen"
        title="Command palette"
        description="Search chats, documents, projects, images, and commands"
        @update:open="onUpdateOpen"
    >
        <template #content>
            <div
                class="or3-palette flex h-full min-h-0 flex-col bg-[color:var(--md-surface)] text-[color:var(--md-on-surface)]"
                :class="shellClass"
                data-context="global"
                data-test="command-palette"
            >
                <!-- Query row -->
                <div
                    class="or3-palette-query shrink-0 flex items-center gap-2.5 border-b border-[color:var(--md-border-color)] px-3 py-3 sm:px-4"
                >
                    <!-- Touch layouts have no Escape key, so dismissal lives here. -->
                    <button
                        type="button"
                        class="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--md-border-radius)] text-[color:var(--md-on-surface-variant)] transition-colors active:bg-[color:var(--md-surface-active)] sm:hidden"
                        aria-label="Close search"
                        data-test="command-palette-close"
                        @click="close()"
                    >
                        <UIcon :name="backIcon" class="h-5 w-5" />
                    </button>
                    <UIcon
                        :name="searchIcon"
                        class="hidden h-4 w-4 shrink-0 text-[color:var(--md-on-surface-variant)] sm:block"
                        aria-hidden="true"
                    />
                    <input
                        :id="inputId"
                        ref="inputRef"
                        :value="query"
                        type="text"
                        role="combobox"
                        aria-expanded="true"
                        aria-autocomplete="list"
                        :aria-controls="listboxId"
                        :aria-activedescendant="activeDescendant"
                        aria-label="Search chats, documents, projects, images, and commands"
                        autocomplete="off"
                        spellcheck="false"
                        :placeholder="placeholder"
                        class="or3-palette-input min-w-0 flex-1 bg-transparent text-[16px] leading-6 sm:text-[15px] text-[color:var(--md-on-surface)] outline-none placeholder:text-[color:var(--md-on-surface-variant)]/70"
                        data-test="command-palette-input"
                        @input="onInput"
                        @keydown="onKeydown"
                        @focus="closeActionTray"
                    />
                    <UIcon
                        v-if="loading"
                        :name="loadingIcon"
                        class="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--md-on-surface-variant)]"
                        aria-hidden="true"
                    />
                    <button
                        v-if="query"
                        type="button"
                        class="shrink-0 rounded-full p-1 text-[color:var(--md-on-surface-variant)] transition-colors duration-[var(--app-motion-duration-fast,150ms)] ease-[var(--app-motion-easing-standard,ease)] hover:bg-[color:var(--md-surface-hover)] hover:text-[color:var(--md-on-surface)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
                        aria-label="Clear search"
                        @click="clearQuery"
                    >
                        <UIcon :name="closeIcon" class="h-3.5 w-3.5" />
                    </button>
                    <span
                        v-else
                        class="hidden shrink-0 select-none rounded border border-[color:var(--md-border-color)] bg-[color:var(--md-surface-variant)]/40 px-1.5 py-0.5 text-[10px] leading-none text-[color:var(--md-on-surface-variant)] sm:inline-block"
                        aria-hidden="true"
                    >
                        {{ shortcutLabel }}
                    </span>
                </div>

                <CommandPaletteFilters
                    :categories="categories"
                    :active-category-id="activeCategoryId"
                    @select="setCategoryFilter"
                />

                <!-- Results + preview -->
                <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
                    <CommandPaletteResultList
                        :groups="groups"
                        :statuses="statuses"
                        :source-labels="sourceLabels"
                        :active-key="activeKey"
                        :loading="loading"
                        :query="query"
                        :active-category-label="activeCategoryLabel"
                        @hover="hoverActive"
                        @activate="activateByPointer"
                        @pointer-move="releaseHoverLock"
                        @retry="retrySource"
                    />

                    <div
                        class="or3-palette-aside flex min-h-0 shrink-0 flex-col border-t border-[color:var(--md-border-color)] lg:w-[330px] lg:border-l lg:border-t-0"
                        :class="
                            activeResult
                                ? 'max-h-[40dvh] lg:max-h-none'
                                : 'hidden lg:flex'
                        "
                    >
                        <CommandPalettePreview
                            class="min-h-0 flex-1"
                            :result="activeResult"
                            :preview="preview"
                            :preview-loading="previewLoading"
                            :categories="categories"
                        />
                        <CommandPaletteActionTray
                            v-if="activeResult"
                            ref="actionTrayRef"
                            :primary-action="activeResult.primaryAction"
                            :secondary-actions="secondaryActions"
                            :tray-open="actionTrayOpen"
                            @run="onRunAction"
                        />
                    </div>
                </div>

                <p
                    v-if="errorMessage"
                    class="shrink-0 border-t border-[color:var(--md-error)]/35 bg-[color-mix(in_srgb,var(--md-error)_9%,transparent)] px-3 py-1.5 text-[11.5px] text-[color:var(--md-on-surface)] sm:px-4"
                >
                    {{ errorMessage }}
                </p>

                <!-- Footer hints -->
                <div
                    class="or3-palette-footer hidden shrink-0 items-center gap-3 overflow-x-auto sm:flex border-t border-[color:var(--md-border-color)] bg-[color:var(--md-surface-variant)]/20 px-3 py-2 text-[10.5px] text-[color:var(--md-on-surface-variant)] sm:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                    <span
                        v-for="hint in footerHints"
                        :key="hint.label"
                        class="flex shrink-0 items-center gap-1"
                    >
                        <kbd
                            class="rounded border border-[color:var(--md-border-color)] bg-[color:var(--md-surface)] px-1 py-0.5 font-sans text-[10px] leading-none"
                            >{{ hint.keys }}</kbd
                        >
                        {{ hint.label }}
                    </span>
                    <span class="ml-auto shrink-0 tabular-nums">
                        {{ resultSummary }}
                    </span>
                </div>

                <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {{ announcement }}
                </p>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { buildThemeOverrideProps } from '~/composables/ui/themeOverrideProps';
import { useCommandPalette } from '~/composables/search/useCommandPalette';
import { useCommandPaletteShortcut } from '~/composables/search/useCommandPaletteShortcut';
import { useIcon } from '~/composables/useIcon';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { PaletteAction } from '~/core/search/command-palette/types';
import CommandPaletteActionTray from './CommandPaletteActionTray.vue';
import CommandPaletteFilters from './CommandPaletteFilters.vue';
import CommandPalettePreview from './CommandPalettePreview.vue';
import CommandPaletteResultList from './CommandPaletteResultList.vue';
import {
    PALETTE_INPUT_ID,
    PALETTE_LISTBOX_ID,
    paletteOptionDomId,
} from './palette-dom';

const {
    isOpen,
    query,
    loading,
    groups,
    flatResults,
    activeKey,
    activeResult,
    activeCategoryId,
    statuses,
    sourceLabels,
    categories,
    preview,
    previewLoading,
    actionTrayOpen,
    secondaryActions,
    announcement,
    errorMessage,
    focusToken,
    close,
    activateByPointer,
    hoverActive,
    releaseHoverLock,
    moveActive,
    runPrimary,
    runAction,
    openActionTray,
    closeActionTray,
    setCategoryFilter,
    retrySource,
} = useCommandPalette();

useCommandPaletteShortcut();

const inputRef = ref<HTMLInputElement | null>(null);
const actionTrayRef = ref<InstanceType<typeof CommandPaletteActionTray> | null>(
    null
);

const inputId = PALETTE_INPUT_ID;
const listboxId = PALETTE_LISTBOX_ID;
const searchIcon = useIcon('palette.search');
const loadingIcon = useIcon('ui.loading');
const closeIcon = useIcon('ui.close');
const backIcon = useIcon('ui.arrow.left');

const modalOverrides = useThemeOverrides({
    component: 'modal',
    context: 'modal',
    identifier: 'modal.command-palette',
    isNuxtUI: true,
});

const shellOverrides = useThemeOverrides({
    component: 'command-palette',
    context: 'global',
    identifier: 'command-palette.shell',
    isNuxtUI: true,
});

const modalProps = computed(() =>
    buildThemeOverrideProps(modalOverrides.value, {
        baseClass: [
            'or3-command-palette-modal p-0 overflow-hidden divide-y-0',
            'w-dvw h-dvh max-w-none max-h-none top-0 left-0 translate-x-0 translate-y-0 rounded-none',
            'sm:w-[min(980px,94dvw)] sm:h-[min(680px,86dvh)] sm:max-h-[86dvh]',
            'sm:top-[max(4dvh,1.5rem)] sm:left-1/2 sm:-translate-x-1/2 sm:rounded-[var(--md-border-radius)]',
        ].join(' '),
    })
);

const shellClass = computed(() => {
    const value = shellOverrides.value as { class?: string } | null;
    return value?.class ?? '';
});

const activeDescendant = computed(() =>
    activeKey.value ? paletteOptionDomId(activeKey.value) : undefined
);

const activeCategoryLabel = computed(() => {
    if (!activeCategoryId.value) return undefined;
    return categories.value.find(
        (category) => category.id === activeCategoryId.value
    )?.label;
});

const placeholder = computed(() =>
    activeCategoryLabel.value
        ? `Search ${activeCategoryLabel.value.toLowerCase()}…`
        : 'Search or type a command…'
);

const isApplePlatform = computed(() => {
    if (!import.meta.client) return true;
    const ua = `${navigator.platform || ''} ${navigator.userAgent || ''}`;
    return /Mac|iPhone|iPad|iPod/i.test(ua);
});

const shortcutLabel = computed(() =>
    isApplePlatform.value ? '⌘K' : 'Ctrl+K'
);

const footerHints = computed(() => [
    { keys: '↑↓', label: 'Navigate' },
    { keys: '↵', label: 'Open' },
    { keys: 'Tab', label: 'Actions' },
    { keys: 'esc', label: 'Close' },
]);

const resultSummary = computed(() => {
    const count = flatResults.value.length;
    if (loading.value && count === 0) return 'Searching…';
    return `${count} result${count === 1 ? '' : 's'}`;
});

function onUpdateOpen(next: boolean): void {
    if (!next) close();
}

function onInput(event: Event): void {
    query.value = (event.target as HTMLInputElement).value;
}

function clearQuery(): void {
    query.value = '';
    focusInput();
}

function focusInput(select = false): void {
    const input = inputRef.value;
    if (!input) return;
    input.focus();
    if (select) input.select();
}

async function enterActionTray(): Promise<void> {
    if (!openActionTray()) return;
    await nextTick();
    if (!actionTrayRef.value?.focusFirstAction()) closeActionTray();
}

function onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            moveActive(1);
            return;
        case 'ArrowUp':
            event.preventDefault();
            moveActive(-1);
            return;
        case 'Enter':
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) {
                void enterActionTray();
                return;
            }
            void runPrimary();
            return;
        case 'Tab':
            if (event.shiftKey) return;
            event.preventDefault();
            void enterActionTray();
            return;
        case 'Escape':
            event.preventDefault();
            close();
            return;
        default:
            return;
    }
}

function onRunAction(action: PaletteAction): void {
    void runAction(
        action,
        activeResult.value?.sourceId,
        activeResult.value?.pluginGeneration
    );
}

// Focus the query on open and on every repeated shortcut press.
watch(focusToken, async () => {
    if (!isOpen.value) return;
    await nextTick();
    focusInput(true);
});

watch(isOpen, async (open) => {
    if (!open) return;
    await nextTick();
    focusInput(true);
});

// When the tray closes (or the active result changes) focus must not be
// stranded on a button that is about to be replaced.
watch(actionTrayOpen, (open) => {
    if (open || !isOpen.value || !import.meta.client) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.or3-palette-actions')) {
        focusInput();
    }
});

// Keep the active option inside the scroll viewport without moving focus.
watch(activeKey, async (key) => {
    if (!key || !import.meta.client) return;
    await nextTick();
    document
        .getElementById(paletteOptionDomId(key))
        ?.scrollIntoView({ block: 'nearest' });
});
</script>
