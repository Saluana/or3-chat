<template>
    <div
        :class="[
            'workspace-tab-bar-shell',
            { 'workspace-tab-bar-shell--mobile': mobile },
        ]"
    >
        <div
            v-theme="'shell.tab-overflow'"
            v-bind="barProps"
            ref="strip"
            :class="['workspace-tab-bar', barProps?.class ?? '']"
            role="tablist"
            aria-label="Open workspace tabs"
            @keydown="onKeydown"
        >
            <div
                v-for="(tab, index) in tabs"
                :key="tab.id"
                :ref="(element) => setTabElement(tab.id, element)"
                class="workspace-tab-wrap"
                :class="{
                    'is-active': tab.id === activeTabId,
                    'is-visible': visibleTabIds.has(tab.id),
                    'is-dragging': dragState.phase === 'dragging' && dragState.tabId === tab.id,
                    'is-drop-target': dragState.phase === 'dragging' && dragState.targetId === tab.id,
                }"
                :style="dragPreviewStyle(tab.id, index)"
                :data-tab-id="tab.id"
                @pointerdown="onPointerDown($event, tab.id)"
                @pointermove="onPointerMove($event)"
                @pointerup="onPointerUp($event)"
                @pointercancel="cancelDrag($event)"
            >
                <button
                    v-theme="tab.id === activeTabId ? 'shell.tab-active' : 'shell.tab'"
                    :id="`workspace-tab-${tab.id}`"
                    type="button"
                    role="tab"
                    :aria-selected="tab.id === activeTabId"
                    :aria-controls="`workspace-pane-${tab.id}`"
                    :aria-describedby="visibleDescriptionId(tab)"
                    :tabindex="tab.id === activeTabId ? 0 : -1"
                    class="workspace-tab"
                    :title="workspaceTabTitle(tab)"
                    @click="onTabClick($event, tab.id)"
                    @auxclick="onAuxClick($event, tab.id)"
                    @contextmenu.prevent="openContextMenu($event, tab.id)"
                >
                    <UIcon :name="resourceIcon(tab)" class="workspace-tab-icon" />
                    <span class="workspace-tab-title">{{ workspaceTabTitle(tab) }}</span>
                    <span
                        v-if="statusFor(tab.id) !== 'idle'"
                        class="workspace-tab-status"
                        :class="`is-${statusFor(tab.id)}`"
                        aria-hidden="true"
                    />
                    <span class="sr-only">{{ statusDescription(tab.id) }}</span>
                </button>
                <span
                    v-if="tab.id !== activeTabId && visibleTabIds.has(tab.id)"
                    :id="visibleDescriptionId(tab)"
                    class="sr-only"
                >
                    Open in another split
                </span>
                <button
                    v-theme="'shell.tab-close'"
                    type="button"
                    data-tab-close
                    class="workspace-tab-close"
                    :aria-label="`Close ${workspaceTabTitle(tab)}`"
                    :title="`Close ${workspaceTabTitle(tab)}`"
                    @click.stop="requestClose(tab.id)"
                    @pointerdown.stop
                >
                    <UIcon name="i-lucide-x" />
                </button>
            </div>
        </div>
        <WorkspaceNewTabControl
            :can-create-document="canCreateDocument"
            :can-create-workflow="canCreateWorkflow"
            :can-create-agent="canCreateAgent"
            @new-tab="emit('new-tab')"
            @create="emit('create-tab', $event)"
        />
        <div
            v-if="contextMenu"
            ref="contextMenuElement"
            class="workspace-tab-context"
            :style="contextMenuStyle"
            role="menu"
        >
            <button role="menuitem" type="button" @click="runContext('close')">Close tab</button>
            <button role="menuitem" type="button" @click="runContext('close-other')">Close other tabs</button>
            <button role="menuitem" type="button" @click="runContext('close-right')">Close tabs to the right</button>
            <button role="menuitem" type="button" :disabled="!canReopenClosed" @click="runContext('reopen')">Reopen closed tab</button>
            <button role="menuitem" type="button" :disabled="!canOpenSplit" @click="runContext('split')">Open in split</button>
            <button
                v-if="copyableTabIds.has(contextMenu.tabId)"
                role="menuitem"
                type="button"
                @click="runContext('copy-link')"
            >Copy resource link</button>
            <button role="menuitem" type="button" @click="runContext('left')">Move left</button>
            <button role="menuitem" type="button" @click="runContext('right')">Move right</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue';
import type { WorkspaceTab, WorkspaceTabStatus } from '~/core/workspace-tabs/types';
import {
    workspaceTabFallbackIcon,
    workspaceTabStatusDescription,
    workspaceTabTitle,
} from '~/core/workspace-tabs/display';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import WorkspaceNewTabControl, {
    type WorkspaceNewTabCreateKind,
} from './WorkspaceNewTabControl.vue';

const props = withDefaults(
    defineProps<{
        tabs: readonly WorkspaceTab[];
        activeTabId: string;
        visibleTabIds: ReadonlySet<string>;
        statusByTabId?: ReadonlyMap<string, WorkspaceTabStatus>;
        iconByTabId?: ReadonlyMap<string, string | undefined>;
        mobile?: boolean;
        canOpenSplit?: boolean;
        canReopenClosed?: boolean;
        copyableTabIds?: ReadonlySet<string>;
        canCreateDocument?: boolean;
        canCreateWorkflow?: boolean;
        canCreateAgent?: boolean;
    }>(),
    {
        mobile: false,
        statusByTabId: undefined,
        iconByTabId: undefined,
        canOpenSplit: true,
        canReopenClosed: false,
        copyableTabIds: () => new Set<string>(),
        canCreateDocument: false,
        canCreateWorkflow: false,
        canCreateAgent: false,
    }
);

const emit = defineEmits<{
    activate: [tabId: string, reason: 'pointer' | 'keyboard'];
    close: [tabId: string];
    'new-tab': [];
    'create-tab': [kind: WorkspaceNewTabCreateKind];
    reorder: [tabId: string, destinationIndex: number];
    'open-in-split': [tabId: string];
    'close-other': [tabId: string];
    'close-right': [tabId: string];
    'reopen-closed': [];
    'copy-link': [tabId: string];
}>();

const strip = ref<HTMLElement | null>(null);
const tabElements = new Map<string, HTMLElement>();
type TabRect = { id: string; left: number; right: number; width: number };
type DragGeometry = {
    stripLeft: number;
    tabs: TabRect[];
    activeWidth: number;
    gap: number;
};
type DragState =
    | { phase: 'idle' }
    | {
          phase: 'pending';
          pointerId: number;
          tabId: string;
          startClientX: number;
          startClientY: number;
          startIndex: number;
          owner: HTMLElement;
          geometry: DragGeometry;
      }
    | {
          phase: 'dragging';
          pointerId: number;
          tabId: string;
          startClientX: number;
          startIndex: number;
          destinationIndex: number;
          pointerClientX: number;
          targetId: string | null;
          owner: HTMLElement;
          geometry: DragGeometry;
      };

const dragState = ref<DragState>({ phase: 'idle' });
let autoScrollFrame: number | null = null;
const suppressActivation = ref<string | null>(null);
const contextMenu = ref<{ tabId: string; x: number; y: number } | null>(null);
const contextMenuElement = ref<HTMLElement | null>(null);
const pendingCloseFocus = ref<{ tabId: string; index: number } | null>(null);
const contextMenuStyle = computed(() =>
    contextMenu.value
        ? { left: `${contextMenu.value.x}px`, top: `${contextMenu.value.y}px` }
        : undefined
);
const barProps = useThemeOverrides({
    component: 'div',
    context: 'shell',
    identifier: 'shell.tab-overflow',
    isNuxtUI: false,
});

function setTabElement(
    id: string,
    element: Element | ComponentPublicInstance | null
): void {
    const root =
        element instanceof HTMLElement
            ? element
            : (element as ComponentPublicInstance | null)?.$el;
    if (root instanceof HTMLElement) tabElements.set(id, root);
    else tabElements.delete(id);
}

function resourceIcon(tab: WorkspaceTab): string {
    return props.iconByTabId?.get(tab.id) || workspaceTabFallbackIcon(tab);
}

function statusFor(tabId: string): WorkspaceTabStatus {
    return props.statusByTabId?.get(tabId) ?? 'idle';
}

function statusDescription(tabId: string): string {
    return workspaceTabStatusDescription(statusFor(tabId));
}

function visibleDescriptionId(tab: WorkspaceTab): string | undefined {
    return tab.id !== props.activeTabId && props.visibleTabIds.has(tab.id)
        ? `workspace-tab-visible-${tab.id}`
        : undefined;
}

function focusTab(tabId: string): void {
    nextTick(() => tabElements.get(tabId)?.querySelector<HTMLElement>('[role="tab"]')?.focus());
}

function onKeydown(event: KeyboardEvent): void {
    const from = props.tabs.findIndex((tab) => tab.id === props.activeTabId);
    if (from < 0) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, from - 1);
    if (event.key === 'ArrowRight') nextIndex = Math.min(props.tabs.length - 1, from + 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = props.tabs.length - 1;
    if (event.key === 'Delete') {
        event.preventDefault();
        const tab = props.tabs[from];
        if (tab) requestClose(tab.id);
        return;
    }
    if (event.key === 'Escape') {
        contextMenu.value = null;
        cancelDrag();
        return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const tab = props.tabs[from];
        const element = tab ? tabElements.get(tab.id) : undefined;
        const rect = element?.getBoundingClientRect();
        if (tab && rect) {
            contextMenu.value = { tabId: tab.id, x: rect.left, y: rect.bottom };
        }
        return;
    }
    if (nextIndex === null || nextIndex === from) return;
    event.preventDefault();
    const tab = props.tabs[nextIndex];
    if (!tab) return;
    emit('activate', tab.id, 'keyboard');
    focusTab(tab.id);
}

function onAuxClick(event: MouseEvent, tabId: string): void {
    if (event.button !== 1 || props.mobile) return;
    event.preventDefault();
    requestClose(tabId);
}

function requestClose(tabId: string): void {
    const index = props.tabs.findIndex((tab) => tab.id === tabId);
    if (index >= 0) pendingCloseFocus.value = { tabId, index };
    emit('close', tabId);
}

function onTabClick(event: MouseEvent, tabId: string): void {
    if (suppressActivation.value !== tabId) {
        emit('activate', tabId, 'pointer');
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressActivation.value = null;
}

function onPointerDown(event: PointerEvent, tabId: string): void {
    if (
        props.mobile ||
        event.pointerType === 'touch' ||
        event.button !== 0 ||
        event.isPrimary === false ||
        !(event.currentTarget instanceof HTMLElement) ||
        (event.target instanceof Element && event.target.closest('[data-tab-close]'))
    ) {
        return;
    }
    const stripElement = strip.value;
    const startIndex = props.tabs.findIndex((tab) => tab.id === tabId);
    if (!stripElement || startIndex < 0) return;
    const geometry = measureDragGeometry(stripElement, tabId);
    if (!geometry) return;
    dragState.value = {
        phase: 'pending',
        pointerId: event.pointerId,
        tabId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startIndex,
        owner: event.currentTarget,
        geometry,
    };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
    contextMenu.value = null;
}

function onPointerMove(event: PointerEvent): void {
    onWindowPointerMove(event);
}

function onPointerUp(event: PointerEvent): void {
    onWindowPointerUp(event);
}

function onWindowPointerMove(event: PointerEvent): void {
    const current = dragState.value;
    if (current.phase === 'idle' || current.pointerId !== event.pointerId) return;
    if (current.phase === 'pending') {
        if (
            Math.hypot(
                event.clientX - current.startClientX,
                event.clientY - current.startClientY
            ) < 7
        ) {
            return;
        }
        current.owner.setPointerCapture?.(event.pointerId);
        dragState.value = {
            ...current,
            phase: 'dragging',
            destinationIndex: current.startIndex,
            pointerClientX: event.clientX,
            targetId: null,
        };
        startAutoScroll();
    }
    if (dragState.value.phase !== 'dragging') return;
    event.preventDefault();
    dragState.value = {
        ...dragState.value,
        pointerClientX: event.clientX,
        ...destinationAt(event.clientX, dragState.value),
    };
}

function onWindowPointerUp(event: PointerEvent): void {
    const current = dragState.value;
    if (current.phase === 'idle' || current.pointerId !== event.pointerId) return;
    if (current.phase === 'dragging') {
        emit('reorder', current.tabId, current.destinationIndex);
        suppressActivation.value = current.tabId;
        window.setTimeout(() => {
            if (suppressActivation.value === current.tabId) suppressActivation.value = null;
        }, 0);
    }
    finishDrag(event.pointerId);
}

function onWindowPointerCancel(event: PointerEvent): void {
    if (
        dragState.value.phase !== 'idle' &&
        dragState.value.pointerId === event.pointerId
    ) {
        finishDrag(event.pointerId);
    }
}

function cancelDrag(event?: PointerEvent): void {
    if (dragState.value.phase === 'idle') return;
    if (event && dragState.value.pointerId !== event.pointerId) return;
    finishDrag(dragState.value.pointerId);
}

function finishDrag(pointerId?: number): void {
    const current = dragState.value;
    if (current.phase !== 'idle' && pointerId === current.pointerId) {
        current.owner.releasePointerCapture?.(pointerId);
    }
    dragState.value = { phase: 'idle' };
    if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('pointercancel', onWindowPointerCancel);
}

function measureDragGeometry(
    stripElement: HTMLElement,
    activeTabId: string
): DragGeometry | null {
    const stripRect = stripElement.getBoundingClientRect();
    const tabs = props.tabs.flatMap((tab) => {
        const rect = tabElements.get(tab.id)?.getBoundingClientRect();
        if (!rect) return [];
        return [{
            id: tab.id,
            left: rect.left - stripRect.left + stripElement.scrollLeft,
            right: rect.right - stripRect.left + stripElement.scrollLeft,
            width: rect.width,
        }];
    });
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (!active) return null;
    const gap = Number.parseFloat(getComputedStyle(stripElement).gap) || 0;
    return { stripLeft: stripRect.left, tabs, activeWidth: active.width, gap };
}

function destinationAt(
    clientX: number,
    state: Extract<DragState, { phase: 'dragging' }>
): Pick<Extract<DragState, { phase: 'dragging' }>, 'destinationIndex' | 'targetId'> {
    const stripElement = strip.value;
    if (!stripElement) {
        return { destinationIndex: state.startIndex, targetId: null };
    }
    const contentX =
        clientX - stripElement.getBoundingClientRect().left + stripElement.scrollLeft;
    let nearest:
        | { id: string; edge: 'left' | 'right'; distance: number }
        | undefined;
    for (const tab of state.geometry.tabs) {
        if (tab.id === state.tabId) continue;
        const leftDistance = Math.abs(contentX - tab.left);
        const rightDistance = Math.abs(contentX - tab.right);
        const edge = leftDistance <= rightDistance ? 'left' : 'right';
        const distance = Math.min(leftDistance, rightDistance);
        if (!nearest || distance < nearest.distance) {
            nearest = { id: tab.id, edge, distance };
        }
    }
    if (!nearest) return { destinationIndex: state.startIndex, targetId: null };
    const targetIndex = props.tabs.findIndex((tab) => tab.id === nearest.id);
    const movingForward = state.startIndex < targetIndex;
    const destinationIndex = Math.max(
        0,
        Math.min(
            props.tabs.length - 1,
            movingForward
                ? nearest.edge === 'right'
                    ? targetIndex
                    : targetIndex - 1
                : nearest.edge === 'right'
                  ? targetIndex + 1
                  : targetIndex
        )
    );
    return { destinationIndex, targetId: nearest.id };
}

function dragPreviewStyle(tabId: string, index: number): Record<string, string> | undefined {
    const state = dragState.value;
    if (state.phase !== 'dragging') return undefined;
    const slot = state.geometry.activeWidth + state.geometry.gap;
    let translateX = 0;
    if (tabId === state.tabId) {
        translateX = state.pointerClientX - state.startClientX;
        return {
            width: `${state.geometry.activeWidth}px`,
            transform: `translate3d(${translateX}px, 0, 0)`,
            zIndex: '3',
        };
    }
    if (state.startIndex < state.destinationIndex) {
        if (index > state.startIndex && index <= state.destinationIndex) {
            translateX = -slot;
        }
    } else if (state.startIndex > state.destinationIndex) {
        if (index >= state.destinationIndex && index < state.startIndex) {
            translateX = slot;
        }
    }
    const width = state.geometry.tabs.find((tab) => tab.id === tabId)?.width;
    return {
        ...(width ? { width: `${width}px` } : {}),
        transform: `translate3d(${translateX}px, 0, 0)`,
    };
}

function startAutoScroll(): void {
    if (autoScrollFrame !== null) return;
    const frame = () => {
        const state = dragState.value;
        const stripElement = strip.value;
        if (state.phase !== 'dragging' || !stripElement) {
            autoScrollFrame = null;
            return;
        }
        const rect = stripElement.getBoundingClientRect();
        const edge = 40;
        const leftDepth = rect.left + edge - state.pointerClientX;
        const rightDepth = state.pointerClientX - (rect.right - edge);
        const velocity =
            leftDepth > 0
                ? -18 * Math.min(1, leftDepth / edge) ** 2
                : rightDepth > 0
                  ? 18 * Math.min(1, rightDepth / edge) ** 2
                  : 0;
        if (velocity) {
            const before = stripElement.scrollLeft;
            stripElement.scrollLeft += velocity;
            if (stripElement.scrollLeft !== before) {
                dragState.value = {
                    ...state,
                    ...destinationAt(state.pointerClientX, state),
                };
            }
        }
        autoScrollFrame = requestAnimationFrame(frame);
    };
    autoScrollFrame = requestAnimationFrame(frame);
}

function onWindowBlur(): void {
    cancelDrag();
}

function dismissContextMenuOnOutsidePointer(event: PointerEvent): void {
    if (!contextMenu.value) return;
    const target = event.target;
    if (target instanceof Node && contextMenuElement.value?.contains(target)) return;
    contextMenu.value = null;
}

if (typeof window !== 'undefined') window.addEventListener('blur', onWindowBlur);
if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', dismissContextMenuOnOutsidePointer, true);
}
onBeforeUnmount(() => {
    finishDrag();
    if (typeof window !== 'undefined') {
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('pointerdown', dismissContextMenuOnOutsidePointer, true);
    }
});

function openContextMenu(event: MouseEvent, tabId: string): void {
    contextMenu.value = { tabId, x: event.clientX, y: event.clientY };
}

function runContext(
    action:
        | 'close'
        | 'close-other'
        | 'close-right'
        | 'reopen'
        | 'split'
        | 'copy-link'
        | 'left'
        | 'right'
): void {
    const menu = contextMenu.value;
    contextMenu.value = null;
    if (!menu) return;
    if (action === 'close') requestClose(menu.tabId);
    if (action === 'close-other') emit('close-other', menu.tabId);
    if (action === 'close-right') emit('close-right', menu.tabId);
    if (action === 'reopen' && props.canReopenClosed) emit('reopen-closed');
    if (action === 'split' && props.canOpenSplit) emit('open-in-split', menu.tabId);
    if (action === 'copy-link') emit('copy-link', menu.tabId);
    const index = props.tabs.findIndex((tab) => tab.id === menu.tabId);
    if (action === 'left' && index > 0) emit('reorder', menu.tabId, index - 1);
    if (action === 'right' && index >= 0 && index < props.tabs.length - 1) {
        emit('reorder', menu.tabId, index + 1);
    }
}

watch(
    () => props.activeTabId,
    (tabId) => {
        nextTick(() => {
            const element = tabElements.get(tabId);
            if (typeof element?.scrollIntoView !== 'function') return;
            element?.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
                behavior:
                    typeof window !== 'undefined' &&
                    typeof window.matchMedia === 'function' &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'auto'
                        : 'smooth',
            });
        });
    },
    { immediate: true }
);

watch(
    () => props.tabs.map((tab) => tab.id),
    () => {
        const pending = pendingCloseFocus.value;
        if (!pending || props.tabs.some((tab) => tab.id === pending.tabId)) return;
        pendingCloseFocus.value = null;
        const replacement = props.tabs[Math.min(pending.index, props.tabs.length - 1)];
        if (replacement) focusTab(replacement.id);
    }
);
</script>

<style scoped>
.workspace-tab-bar-shell {
    --or3-tab-radius: var(--md-border-radius, 0.5rem);
    --or3-tab-close-radius: var(--md-border-radius, 0.375rem);
    --or3-chrome-item-gap: var(--or3-chrome-gap, 6px);
    --or3-tab-overflow-pad: var(--or3-chrome-overflow-pad, 2px);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--or3-chrome-item-gap);
    min-width: 0;
    flex: 1;
    min-height: calc(32px + (2 * var(--or3-tab-overflow-pad)));
    overflow: visible;
}
.workspace-tab-bar-shell::before {
    content: '';
    pointer-events: none;
    position: absolute;
    z-index: 3;
    top: 0;
    bottom: 0;
    left: 0;
    width: 18px;
    background: linear-gradient(
        90deg,
        var(--or3-workspace-chrome-bg, var(--md-surface)),
        transparent
    );
}
.workspace-tab-bar {
    display: flex;
    align-items: center;
    gap: var(--or3-chrome-item-gap);
    min-width: 0;
    /* Grow only when tabs need the room; otherwise keep + beside the last tab. */
    flex: 0 1 auto;
    max-width: calc(100% - 40px);
    /* Horizontal scroll clips the other axis — keep shadow/border inside via pad. */
    overflow-x: auto;
    overflow-y: hidden;
    padding: var(--or3-tab-overflow-pad) 4px var(--or3-tab-overflow-pad) 8px;
    scrollbar-width: none;
    touch-action: pan-x;
}
.workspace-tab-bar::-webkit-scrollbar { display: none; }
.workspace-tab-wrap {
    position: relative;
    flex: 0 1 clamp(96px, 15vw, 220px);
    min-width: 96px;
    max-width: 220px;
    height: 32px;
    margin-inline-end: 0;
    transition: transform 0.14s ease;
}
.workspace-tab {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 32px;
    padding: 0 30px 0 10px;
    border: var(--md-border-width, 1px) solid
        var(--or3-tab-border, var(--md-border-color));
    border-radius: var(--or3-tab-radius);
    background: var(--or3-tab-bg, var(--md-surface));
    color: var(--or3-tab-text, var(--md-on-surface));
    box-shadow: var(--or3-tab-shadow, none);
    text-align: left;
    transition:
        background-color 0.15s ease,
        border-color 0.15s ease,
        opacity 0.15s ease;
}
.workspace-tab:hover {
    background: var(--or3-tab-bg-hover, var(--md-surface-hover));
    box-shadow: var(
        --or3-tab-shadow-hover,
        var(--or3-tab-shadow, none)
    );
}
.workspace-tab-wrap.is-active .workspace-tab {
    border-color: var(--or3-tab-border-active, var(--md-primary));
    background: var(
        --or3-tab-bg-active,
        color-mix(in srgb, var(--md-primary) 9%, var(--md-surface))
    );
    box-shadow: var(--or3-tab-shadow-active, var(--or3-tab-shadow, none));
    font-weight: 600;
}
.workspace-tab-wrap.is-active .workspace-tab:hover {
    box-shadow: var(--or3-tab-shadow-active, var(--or3-tab-shadow, none));
}
.workspace-tab-wrap.is-visible:not(.is-active) .workspace-tab {
    box-shadow:
        var(--or3-tab-shadow, none),
        inset 0 -2px 0 color-mix(in srgb, var(--md-primary) 58%, transparent);
}
.workspace-tab:focus-visible,
.workspace-tab-close:focus-visible,
:deep(.workspace-tab-new:focus-visible) {
    outline: var(--md-border-width, 2px) solid var(--md-primary);
    outline-offset: 2px;
}
.workspace-tab-icon {
    flex: none;
    width: 15px;
    height: 15px;
    color: var(--md-primary);
}
.workspace-tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    font-size: 13px;
    line-height: 1;
}
.workspace-tab-status {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--or3-tab-attention, var(--md-primary));
    flex: none;
}
.workspace-tab-status.is-streaming,
.workspace-tab-status.is-loading,
.workspace-tab-status.is-saving {
    animation: workspace-tab-pulse 1s ease-in-out infinite alternate;
}
.workspace-tab-status.is-error {
    background: var(--md-error, #ba1a1a);
}
.workspace-tab-close {
    position: absolute;
    z-index: 1;
    right: 3px;
    top: 4px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--or3-tab-close-radius);
    color: var(--md-on-surface-variant);
    opacity: 0.68;
}
.workspace-tab-close:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--md-on-surface) 9%, transparent);
}
.workspace-tab-close :deep(svg),
:deep(.workspace-tab-new svg) {
    width: 15px;
    height: 15px;
}
.workspace-tab-wrap.is-dragging {
    opacity: 0.82;
    user-select: none;
    cursor: grabbing;
    transition: none;
}
.workspace-tab-wrap.is-drop-target::before {
    content: '';
    position: absolute;
    z-index: 2;
    top: 5px;
    bottom: 5px;
    left: -4px;
    width: var(--md-border-width, 2px);
    border-radius: var(--md-border-radius, 2px);
    background: var(--md-primary);
}
:deep(.workspace-tab-new-wrap) {
    flex: none;
    display: inline-flex;
    align-items: center;
    padding-block: var(--or3-tab-overflow-pad);
}
:deep(.workspace-tab-new) {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    margin: 0;
    padding: 0;
    border: var(--md-border-width, 1px) solid
        var(--or3-tab-border, var(--md-border-color));
    border-radius: var(--or3-tab-radius);
    background: var(--or3-tab-bg, transparent);
    color: var(--md-on-surface);
    box-shadow: var(--or3-tab-shadow, none);
}
:deep(.workspace-tab-new:hover) {
    background: var(--or3-tab-bg-hover, var(--md-surface-hover));
    box-shadow: var(
        --or3-tab-shadow-hover,
        var(--or3-tab-shadow, none)
    );
}
.workspace-tab-bar-shell--mobile {
    gap: 2px;
    height: 100%;
    overflow: visible;
}
.workspace-tab-bar-shell--mobile::before {
    display: none;
}
.workspace-tab-bar-shell--mobile .workspace-tab-bar {
    height: 100%;
    padding: 0 4px 0 8px;
    gap: 8px;
    overflow-y: visible;
}
.workspace-tab-bar-shell--mobile .workspace-tab-wrap {
    flex: 1 1 auto;
    min-width: min(148px, 62vw);
    max-width: min(72vw, 280px);
    height: 30px;
    overflow: visible;
}
.workspace-tab-bar-shell--mobile .workspace-tab {
    position: relative;
    height: 30px;
    gap: 8px;
    padding: 0 32px 0 12px;
}
.workspace-tab-bar-shell--mobile .workspace-tab-title {
    font-size: 13.5px;
    letter-spacing: -0.01em;
}
.workspace-tab-bar-shell--mobile .workspace-tab-close {
    right: 4px;
    top: 4px;
    width: 22px;
    height: 22px;
    opacity: 0.55;
}
.workspace-tab-bar-shell--mobile .workspace-tab-close:hover,
.workspace-tab-bar-shell--mobile .workspace-tab-close:focus-visible {
    opacity: 1;
}
.workspace-tab-bar-shell--mobile .workspace-tab-close :deep(svg) {
    width: 14px;
    height: 14px;
}
.workspace-tab-bar-shell--mobile :deep(.workspace-tab-new) {
    position: relative;
    width: 28px;
    height: 28px;
    margin-right: 6px;
}
.workspace-tab-bar-shell--mobile :deep(.workspace-tab-new svg) {
    width: 15px;
    height: 15px;
}
.workspace-tab-context {
    position: fixed;
    z-index: 100;
    display: grid;
    min-width: 160px;
    padding: 4px;
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius, 0.5rem);
    background: var(--md-surface);
    color: var(--md-on-surface);
    box-shadow: var(
        --or3-tab-menu-shadow,
        0 8px 24px color-mix(in srgb, var(--md-on-surface) 18%, transparent)
    );
}
.workspace-tab-context button {
    min-height: 28px;
    padding: 0 8px;
    border-radius: var(--md-border-radius, 0.375rem);
    color: inherit;
    text-align: left;
    font-size: 13px;
}
.workspace-tab-context button:hover {
    background: var(--md-surface-hover);
}
.workspace-tab-context button:disabled {
    opacity: 0.45;
}
@keyframes workspace-tab-pulse {
    to {
        opacity: 0.35;
    }
}
@media (prefers-reduced-motion: reduce) {
    .workspace-tab,
    .workspace-tab-wrap,
    .workspace-tab-status {
        transition: none;
        animation: none;
    }
}
@media (forced-colors: active) {
    .workspace-tab-wrap.is-active .workspace-tab {
        outline: 2px solid Highlight;
        outline-offset: -2px;
    }
    .workspace-tab-wrap.is-visible:not(.is-active) .workspace-tab {
        text-decoration: underline;
    }
}
</style>
