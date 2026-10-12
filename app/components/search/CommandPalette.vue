<template>
    <UModal
        v-bind="modalProps"
        :open="isOpen"
        :content="dialogContent"
        title="Command palette"
        description="Search chats, documents, projects, images, and commands"
        @update:open="onUpdateOpen"
    >
        <template #content>
            <div
                class="or3-palette flex h-full min-h-0 flex-col bg-[color:var(--md-surface)] text-[color:var(--md-on-surface)]"
                :class="[shellClass, { 'or3-palette-short': shortViewport, 'or3-palette-very-short': tinyViewport }]"
                data-context="global"
                data-test="command-palette"
            >
                <!-- Query row -->
                <div
                    class="or3-palette-query shrink-0 flex items-center gap-2.5 border-b border-[color:var(--md-border-color)] px-3 py-3 sm:px-4"
                >
                    <div class="or3-palette-query-field">
                        <UIcon
                            :name="searchIcon"
                            class="or3-palette-query-icon h-4 w-4 shrink-0 text-[color:var(--md-on-surface-variant)]"
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
                            enterkeyhint="search"
                            :placeholder="placeholder"
                            class="or3-palette-input min-w-0 flex-1 bg-transparent text-[16px] leading-6 sm:text-[15px] text-[color:var(--md-on-surface)] outline-none placeholder:text-[color:var(--md-on-surface-variant)]/70"
                            data-test="command-palette-input"
                            @input="onInput"
                            @keydown="onKeydown"
                            @focus="closeActionTray"
                        />
                        <UButton
                            color="neutral"
                            variant="ghost"
                            class="or3-palette-query-actions hidden h-11! min-h-11! shrink-0"
                            :disabled="!activeResult"
                            :aria-label="actionTrayOpen ? 'Return to search results' : 'Show result actions'"
                            :aria-expanded="actionTrayOpen"
                            @click="toggleResultActions"
                        >{{ actionTrayOpen ? 'Results' : 'Actions' }}</UButton>
                        <UIcon
                            v-if="loading"
                            :name="loadingIcon"
                            class="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--md-on-surface-variant)]"
                            aria-hidden="true"
                        />
                        <button
                            v-if="query"
                            type="button"
                            class="or3-palette-clear shrink-0 rounded-full p-1 text-[color:var(--md-on-surface-variant)] transition-colors duration-[var(--app-motion-duration-fast,150ms)] ease-[var(--app-motion-easing-standard,ease)] hover:bg-[color:var(--md-surface-hover)] hover:text-[color:var(--md-on-surface)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
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
                    <button
                        type="button"
                        class="or3-palette-cancel flex h-11 shrink-0 items-center justify-center px-1 text-[15px] text-[color:var(--md-on-surface)] sm:hidden"
                        aria-label="Close search"
                        data-test="command-palette-close"
                        @click="close()"
                    >Cancel</button>
                </div>

                <CommandPaletteFilters
                    :categories="categories"
                    :active-category-id="activeCategoryId"
                    @select="setCategoryFilter"
                />

                <!-- Results + preview -->
                <div class="or3-palette-results-layout flex min-h-0 flex-1 flex-col lg:flex-row">
                    <CommandPaletteResultList
                        :groups="groups"
                        :statuses="statuses"
                        :source-labels="sourceLabels"
                        :active-key="activeKey"
                        :loading="loading"
                        :query="query"
                        :active-category-label="activeCategoryLabel"
                        @hover="onHover"
                        @activate="onActivateResult"
                        @pointer-move="releaseHoverLock"
                        @retry="retrySource"
                    />

                    <div
                        v-if="!mobileViewport"
                        class="or3-palette-aside flex min-h-0 shrink-0 flex-col border-t border-[color:var(--md-border-color)] lg:w-[330px] lg:border-l lg:border-t-0"
                        :data-expanded="actionTrayOpen || undefined"
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
                            @expand="enterActionTray"
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
            <USlideover
                v-if="mobileViewport"
                v-model:open="mobilePreviewOpen"
                side="bottom"
                title="Result preview"
                description="Preview the selected search result and choose an action"
                :content="mobilePreviewContent"
                :ui="{ overlay: 'z-[60] bg-black/40', content: 'or3-palette-mobile-preview z-[61] h-[min(76dvh,640px)] max-h-[calc(100dvh-2rem)] rounded-t-[var(--md-border-radius-large,24px)] overflow-hidden' }"
                @after:leave="resetPreviewDrag"
            >
                <template #content>
                    <div class="flex h-full min-h-0 flex-col bg-[color:var(--md-surface)] text-[color:var(--md-on-surface)]" :class="shellClass">
                        <div
                            class="or3-palette-preview-handle relative flex h-12 shrink-0 items-start justify-center pt-3"
                            v-bind="previewHandleProps"
                        >
                            <span class="h-1 w-10 rounded-full bg-[color:var(--md-on-surface-variant)]/30" aria-hidden="true" />
                            <button
                                type="button"
                                class="absolute right-2 top-1 flex h-11 w-11 items-center justify-center rounded-[var(--md-border-radius)] hover:bg-[color:var(--md-surface-hover)]"
                                aria-label="Close preview"
                                @click="mobilePreviewOpen = false"
                            ><UIcon :name="closeIcon" class="h-5 w-5" /></button>
                        </div>
                        <CommandPalettePreview
                            class="min-h-0 flex-1"
                            :result="activeResult"
                            :preview="preview"
                            :preview-loading="previewLoading"
                            :categories="categories"
                        />
                        <p v-if="errorMessage" role="alert" class="shrink-0 px-4 py-2 text-sm text-[color:var(--md-error)]">{{ errorMessage }}</p>
                        <CommandPaletteActionTray
                            v-if="activeResult"
                            ref="mobileActionTrayRef"
                            class="or3-palette-mobile-actions"
                            :primary-action="activeResult.primaryAction"
                            :secondary-actions="mobileSecondaryActions"
                            :tray-open="actionTrayOpen"
                            @run="onRunAction"
                            @expand="enterActionTray"
                        />
                    </div>
                </template>
            </USlideover>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useEventListener, useMediaQuery } from '@vueuse/core';
import { useBottomSheetDrag } from '~/composables/ui/useBottomSheetDrag';
import { useDialogFocus } from '~/composables/ui/useDialogFocus';
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
const mobileActionTrayRef = ref<InstanceType<typeof CommandPaletteActionTray> | null>(null);
const mobileViewport = useMediaQuery('(max-width: 639px)');
const mobilePreviewOpen = ref(false);
const mobileSecondaryActions = computed(() => secondaryActions.value.filter(action =>
    !(action.disabled && 'destination' in action.target && action.target.destination === 'new-pane')
));
const {
    offset: previewDragY,
    isDragging: previewDragging,
    handleProps: previewHandleProps,
    reset: resetPreviewDrag,
} = useBottomSheetDrag(mobilePreviewOpen, () => {
    mobilePreviewOpen.value = false;
}, () => {
    stopScrollMomentum();
    touchScrollGesture = undefined;
});
const mobilePreviewContent = computed(() => ({
    onCloseAutoFocus: restoreResultFocus,
    style: { translate: `0 ${previewDragY.value}px` },
    'data-dragging': previewDragging.value || undefined,
}));

// overflow:hidden alone does not lock the root viewport on iOS when its
// keyboard is open. Keep the page fixed for the lifetime of the mobile palette.
let restoreBackground: (() => void) | undefined;
watch([isOpen, mobileViewport], ([open, mobile]) => {
    restoreBackground?.();
    restoreBackground = undefined;
    if (!import.meta.client || !open || !mobile) return;
    const body = document.body;
    const x = window.scrollX;
    const y = window.scrollY;
    const properties = ['position', 'top', 'left', 'width'] as const;
    const previous = properties.map(property => ({
        property,
        value: body.style.getPropertyValue(property),
        priority: body.style.getPropertyPriority(property),
    }));
    body.style.setProperty('position', 'fixed');
    body.style.setProperty('top', `${-y}px`);
    body.style.setProperty('left', `${-x}px`);
    body.style.setProperty('width', '100%');
    restoreBackground = () => {
        for (const { property, value, priority } of previous) {
            if (value) body.style.setProperty(property, value, priority);
            else body.style.removeProperty(property);
        }
        window.scrollTo(x, y);
    };
}, { immediate: true, flush: 'sync' });
onScopeDispose(() => restoreBackground?.());

type TouchScrollGesture = {
    target: HTMLElement;
    root: HTMLElement;
    x: number;
    y: number;
    axis?: 'x' | 'y';
    scroller?: HTMLElement;
    velocity: number;
    lastMoveAt: number;
    lastMotionAt: number;
};
let touchScrollGesture: TouchScrollGesture | undefined;
let momentumFrame: number | undefined;
function stopScrollMomentum(): void {
    if (momentumFrame !== undefined) cancelAnimationFrame(momentumFrame);
    momentumFrame = undefined;
}
function continueScrollMomentum(gesture: TouchScrollGesture): void {
    const scroller = gesture.scroller;
    if (!scroller || !gesture.axis || Math.abs(gesture.velocity) < 0.08 || performance.now() - gesture.lastMotionAt > 80) return;
    const position = gesture.axis === 'y' ? 'scrollTop' : 'scrollLeft';
    let velocity = gesture.velocity;
    let previousFrameAt = performance.now();
    const step = (now: number) => {
        momentumFrame = undefined;
        if (!isOpen.value || !mobileViewport.value || !scroller.isConnected) return;
        const elapsed = Math.max(0, Math.min(32, now - previousFrameAt));
        previousFrameAt = now;
        scroller[position] += velocity * elapsed;
        // Frame-rate independent decay: ease out a flick instead of stopping
        // abruptly on release, and stop at the container's own scroll boundary.
        velocity *= Math.exp(-elapsed / 325);
        const maximum = gesture.axis === 'y' ? scroller.scrollHeight - scroller.clientHeight :
            scroller.scrollWidth - scroller.clientWidth;
        const atBoundary = velocity < 0 ? scroller[position] <= 0 : scroller[position] >= maximum;
        // A zero-length first frame or rounded subpixel movement is not a
        // scroll boundary; keep coasting until the speed decays or we hit one.
        if (Math.abs(velocity) > 0.02 && !atBoundary) {
            momentumFrame = requestAnimationFrame(step);
        }
    };
    momentumFrame = requestAnimationFrame(step);
}
watch([isOpen, mobileViewport, mobilePreviewOpen, query, activeKey], () => {
    stopScrollMomentum();
    touchScrollGesture = undefined;
}, { flush: 'sync' });
onScopeDispose(stopScrollMomentum);
const touchDocument = () => import.meta.client ? document : undefined;
useEventListener(touchDocument, 'touchstart', (event: TouchEvent) => {
    stopScrollMomentum();
    touchScrollGesture = undefined;
    if (!isOpen.value || !mobileViewport.value || event.touches.length !== 1) return;
    const target = event.target instanceof HTMLElement ? event.target :
        event.target instanceof Element ? event.target.parentElement : null;
    // The handle owns its pointer gesture. The scroll guard must not cancel
    // it or route the drag into a scroll container behind the sheet.
    if (target?.closest('.or3-palette-preview-handle')) return;
    const root = target?.closest<HTMLElement>('.or3-command-palette-modal, .or3-palette-mobile-preview');
    const touch = event.touches[0];
    if (target && root && touch) touchScrollGesture = {
        target, root, x: touch.clientX, y: touch.clientY,
        velocity: 0, lastMoveAt: performance.now(), lastMotionAt: performance.now(),
    };
}, { capture: true, passive: true });
useEventListener(touchDocument, 'touchmove', (event: TouchEvent) => {
    if (!isOpen.value || !mobileViewport.value || event.touches.length !== 1 || !event.cancelable) return;
    // Preserve pinch zoom and another dialog opened by a palette action.
    if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.01) return;
    const gesture = touchScrollGesture;
    if (!gesture) {
        if (!(event.target instanceof Element && event.target.closest('[role="dialog"]'))) event.preventDefault();
        return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    const dx = gesture.x - touch.clientX;
    const dy = gesture.y - touch.clientY;
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
    gesture.axis ??= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    const vertical = gesture.axis === 'y';
    const delta = vertical ? dy : dx;
    let scroller: HTMLElement | undefined;
    for (let node: HTMLElement | null = gesture.target; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const overflow = vertical ? style.overflowY : style.overflowX;
        if (/auto|scroll/.test(overflow) && (vertical ? node.scrollHeight > node.clientHeight : node.scrollWidth > node.clientWidth)) {
            scroller = node;
            break;
        }
        if (node === gesture.root) break;
    }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const keyboard = (gesture.root.contains(document.activeElement) &&
        document.activeElement?.matches('input, textarea, [contenteditable="true"]')) ||
        (window.visualViewport?.height ?? innerHeight) < innerHeight - 120;
    const now = performance.now();
    gesture.scroller = undefined;
    if (ios && keyboard) {
        // Safari can route a native swipe to the root despite the touched
        // overflow container. Consume that default and scroll only our target.
        event.preventDefault();
        if (scroller) {
            const position = vertical ? 'scrollTop' : 'scrollLeft';
            scroller[position] += delta;
            if (delta !== 0) {
                const elapsed = Math.max(8, now - gesture.lastMoveAt);
                // Use finger displacement, including subpixel samples, rather
                // than the rounded scroll offset. Smooth by elapsed time so
                // event frequency doesn't dictate the release speed.
                const velocity = Math.max(-3.5, Math.min(3.5, delta / elapsed));
                const weight = 1 - Math.exp(-elapsed / 50);
                gesture.velocity = Math.sign(velocity) !== Math.sign(gesture.velocity)
                    ? velocity : velocity * weight + gesture.velocity * (1 - weight);
                gesture.lastMotionAt = now;
            }
            gesture.scroller = scroller;
        }
    } else {
        const position = scroller ? (vertical ? scroller.scrollTop : scroller.scrollLeft) : 0;
        const maximum = scroller ? (vertical ? scroller.scrollHeight - scroller.clientHeight :
            scroller.scrollWidth - scroller.clientWidth) : 0;
        if (!scroller || (delta < 0 && position <= 0) || (delta > 0 && position >= maximum)) event.preventDefault();
    }
    gesture.x = touch.clientX;
    gesture.y = touch.clientY;
    gesture.lastMoveAt = now;
}, { capture: true, passive: false });
useEventListener(touchDocument, ['touchend', 'touchcancel'], (event: TouchEvent) => {
    const gesture = touchScrollGesture;
    touchScrollGesture = undefined;
    if (event.type === 'touchcancel') stopScrollMomentum();
    else if (gesture && event.touches.length === 0) continueScrollMomentum(gesture);
}, { capture: true, passive: true });

const inputId = PALETTE_INPUT_ID;
const listboxId = PALETTE_LISTBOX_ID;
const searchIcon = useIcon('palette.search');
const loadingIcon = useIcon('ui.loading');
const closeIcon = useIcon('ui.close');

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

const dialogContent = useDialogFocus(undefined, () => 'palette');
const shortLayoutViewport = useMediaQuery('(max-height: 500px)');
const shortViewport = computed(() => shortLayoutViewport.value || dialogContent.value?.['data-compact-viewport'] !== undefined);
const tinyLayoutViewport = useMediaQuery('(max-height: 240px)');
const tinyViewport = computed(() => tinyLayoutViewport.value || dialogContent.value?.['data-compact-viewport'] === 'tiny');

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

function toggleResultActions(): void {
    if (actionTrayOpen.value) {
        closeActionTray();
        focusInput();
    } else {
        void enterActionTray(true);
    }
}

async function enterActionTray(includePrimary = false): Promise<void> {
    if (!openActionTray(includePrimary)) return;
    if (mobileViewport.value) {
        inputRef.value?.blur();
        mobilePreviewOpen.value = true;
    }
    await nextTick();
    const tray = mobileViewport.value ? mobileActionTrayRef.value : actionTrayRef.value;
    if (!tray?.focusFirstAction()) closeActionTray();
}

function onHover(key: string): void {
    if (!mobileViewport.value) hoverActive(key);
}

async function onActivateResult(key: string): Promise<void> {
    if (!mobileViewport.value) {
        await activateByPointer(key);
        return;
    }
    const result = flatResults.value.find(entry => entry.key === key);
    if (!result) return;
    if (['command', 'tab', 'setting', 'dashboard'].includes(result.categoryId)) {
        await runAction(result.primaryAction, result.sourceId, result.pluginGeneration);
        return;
    }
    await activateByPointer(key, true);
    inputRef.value?.blur();
    mobilePreviewOpen.value = true;
}

function restoreResultFocus(event: Event): void {
    event.preventDefault();
    requestAnimationFrame(() => {
        if (!isOpen.value || mobilePreviewOpen.value || document.activeElement === inputRef.value) return;
        if (activeKey.value) {
            document.getElementById(paletteOptionDomId(activeKey.value))?.focus({ preventScroll: true });
        }
    });
}

watch([isOpen, mobileViewport, query], () => { mobilePreviewOpen.value = false; });

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
            if (mobileViewport.value && activeKey.value) void onActivateResult(activeKey.value);
            else void runPrimary();
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
    mobilePreviewOpen.value = false;
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
watch(activeKey, async (key, previous) => {
    if (key !== previous) mobilePreviewOpen.value = false;
    if (!key || !import.meta.client) return;
    await nextTick();
    document
        .getElementById(paletteOptionDomId(key))
        ?.scrollIntoView({ block: 'nearest' });
});
</script>

<style>
.or3-palette-query-field { display: contents; }
.or3-palette-mobile-preview { transition: translate 220ms cubic-bezier(0.22, 1, 0.36, 1); }
.or3-palette-mobile-preview[data-dragging] { transition: none; }
.or3-palette-preview-handle { touch-action: none; cursor: grab; }
.or3-palette-preview-handle:active { cursor: grabbing; }
@media (prefers-reduced-motion: reduce) {
    .or3-palette-mobile-preview { transition: none; }
}
.or3-palette-mobile-preview .or3-palette-preview > div { padding-inline: 16px; }
.or3-palette-mobile-preview .or3-palette-preview h3 { font-size: 18px; }
.or3-palette-mobile-preview .or3-palette-preview p,
.or3-palette-mobile-preview .or3-palette-preview dl { font-size: 14px; }
.or3-palette-mobile-preview .or3-palette-preview blockquote { font-size: 15px; padding: 12px; }
.or3-palette-mobile-preview .or3-palette-preview blockquote span { display: block; -webkit-line-clamp: unset; }
.or3-palette-mobile-preview .or3-palette-preview img { max-height: 280px; }
.or3-palette-mobile-preview .or3-palette-preview > div:last-child { overscroll-behavior: contain; }
.or3-palette-mobile-actions {
    padding: 12px 16px max(16px, env(safe-area-inset-bottom));
    max-height: 40%;
    overflow-y: auto;
    overscroll-behavior: contain;
}
.or3-palette-mobile-actions .or3-palette-action-heading,
.or3-palette-mobile-actions .or3-palette-action-empty { display: none; }
.or3-palette-mobile-actions button { min-height: 44px; font-size: 15px !important; }
.or3-palette-mobile-actions .or3-palette-secondary button { flex-wrap: wrap; }
.or3-palette-mobile-actions .or3-palette-secondary button > span { white-space: normal; }
.or3-palette-mobile-actions .or3-palette-secondary button > span:last-child { font-size: 12px; }
.or3-palette-short .or3-palette-preview,
.or3-palette-short .or3-palette-footer,
.or3-palette-short .or3-palette-action-empty,
.or3-palette-short .or3-palette-actions:not([data-expanded]) .or3-palette-action-heading,
.or3-palette-short .or3-palette-actions:not([data-expanded]) .or3-palette-secondary {
    display: none;
}
.or3-palette-short .or3-palette-expand { display: flex; }
.or3-palette-short .or3-palette-query { padding-block: 8px; }
.or3-palette-short .or3-palette-filters { padding-block: 4px; }
.or3-palette-short .or3-palette-actions { padding-block: 8px; }
.or3-palette-short .or3-palette-aside {
    max-height: max(60px, 50%);
    overflow-y: auto;
    overscroll-behavior: contain;
}
.or3-palette-short [data-test='command-palette-close'] { display: flex; }
.or3-palette-short .or3-palette-query-icon { display: none; }
.or3-palette-short .or3-palette-input { font-size: 16px; }
.or3-palette-very-short .or3-palette-query-actions { display: flex; }
.or3-palette-very-short .or3-palette-aside:not([data-expanded]) { display: none; }
.or3-palette-very-short .or3-palette-aside[data-expanded] { max-height: 100%; }
.or3-palette-very-short .or3-palette-listbox > [role='presentation'] { padding-top: 4px; }
@media (max-width: 639px) {
    .or3-palette-query { padding: 10px 16px; gap: 8px; }
    .or3-palette-query-field {
        display: flex;
        flex: 1;
        min-width: 0;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding-left: 12px;
        border: 1px solid var(--md-border-color);
        border-radius: var(--md-border-radius);
        background: var(--md-surface-variant);
    }
    .or3-palette-query-field:focus-within { outline: 2px solid var(--md-focus-ring, var(--md-primary)); outline-offset: 1px; }
    .or3-palette-query-icon { display: block; }
    .or3-palette-clear { display: flex; width: 44px; height: 44px; align-items: center; justify-content: center; }
    .or3-palette-query-actions { display: none; }
    .or3-palette-filters { padding: 4px 16px; gap: 6px; }
    .or3-palette-chip { height: 44px; padding-inline: 12px; font-size: 13px; }
    .or3-palette-chip[aria-pressed='true'] { background: var(--md-primary); color: var(--md-on-primary); }
    .or3-palette-results { padding-bottom: env(safe-area-inset-bottom); }
    .or3-palette-listbox > [role='presentation'] { padding: 16px 16px 6px; font-size: 11px; }
    .or3-palette-option { min-height: 64px; margin-inline: 8px; padding: 10px 8px; gap: 12px; }
    .or3-palette-option-icon { width: 32px; height: 32px; }
    .or3-palette-option-icon > * { width: 18px; height: 18px; }
    .or3-palette-option-title { font-size: 15px; line-height: 1.4; white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .or3-palette-option-detail { font-size: 13px; line-height: 1.4; }
}
</style>
