<template>
    <div
        id="page-container"
        :style="visualViewportStyle"
        :data-keyboard-open="keyboardOpen || undefined"
        class="resizable-sidebar-layout relative w-full h-dvh [container:app-viewport/size] overflow-hidden bg-(--md-surface) text-(--md-on-surface) flex overflow-x-hidden"
    >
        <!-- Backdrop (mobile) -->
        <Transition
            enter-active-class="transition-opacity duration-150"
            leave-active-class="transition-opacity duration-150"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
        >
            <div
                v-show="!isDesktop && open"
                id="mobile-close"
                class="absolute inset-0 bg-black/40 z-[60] md:hidden"
                @click="close()"
            />
        </Transition>

        <!-- Sidebar -->
        <aside
            id="sidebar"
            ref="sidebarElement"
            data-testid="sidebar"
            :inert="hydrated && !isDesktop && !open"
            :role="mobileDrawerOpen ? 'dialog' : undefined"
            :aria-modal="mobileDrawerOpen ? true : undefined"
            aria-label="Navigation"
            :class="[
                // z-[70] on mobile so the drawer sits above workspace chrome (z-50).
                'resizable-sidebar flex z-40 max-md:z-[70] bg-(--md-surface) text-(--md-on-surface) border-(--md-inverse-surface) flex-col overflow-x-hidden',
                'md:relative md:h-full md:shrink-0 md:border-r-[var(--md-border-width)]',
                side === 'right' ? 'md:border-l md:border-r-0' : '',
                // Mobile overlay responsive classes (static for SSR parity)
                'max-md:absolute max-md:inset-0 max-md:w-full max-md:shadow-xl',
                'max-md:transition-transform max-md:duration-200 max-md:ease-out',
                side === 'right' ? 'max-md:right-0' : 'max-md:left-0',
                // The uncontrolled SSR/client state starts closed, so keeping the
                // mobile drawer off-canvas is deterministic before hydration too.
                !open
                    ? side === 'right'
                        ? 'max-md:translate-x-full'
                        : 'max-md:-translate-x-full'
                    : '',
                initialized
                    ? 'md:transition-[width] md:duration-200 md:ease-out'
                    : '',
            ]"
            :style="sidebarStyle"
            @keydown="onSidebarKeydown"
        >
            <div
                id="sidebar-container-outer"
                class="resizable-sidebar-container h-full flex flex-col"
            >
                <SidebarHeader
                    ref="sidebarHeaderRef"
                    :collapsed="collapsed"
                    :toggle-icon="toggleIcon"
                    :toggle-aria="toggleAria"
                    @toggle="toggleCollapse"
                >
                    <template #sidebar-header>
                        <slot name="sidebar-header" />
                    </template>
                    <template #sidebar-toggle="slotProps">
                        <slot name="sidebar-toggle" v-bind="slotProps" />
                    </template>
                </SidebarHeader>

                <div
                    id="sidebar-container-expanded"
                    :class="[
                        'flex-1 min-w-0 min-h-0',
                        collapsed
                            ? 'overflow-hidden'
                            : 'overflow-auto overscroll-contain',
                    ]"
                >
                    <div v-show="!collapsed" class="flex-1 h-full">
                        <slot name="sidebar-expanded">
                            <div class="p-3 space-y-2 text-sm opacity-80">
                                <p>Add your nav here…</p>
                                <ul class="space-y-1">
                                    <li
                                        v-for="i in 10"
                                        :key="i"
                                        class="px-2 py-1 rounded hover:bg-(--md-secondary-container) hover:text-(--md-on-secondary-container) cursor-pointer"
                                    >
                                        Item {{ i }}
                                    </li>
                                </ul>
                            </div>
                        </slot>
                    </div>
                    <div
                        v-if="collapsed"
                        id="sidebar-container-collapsed"
                        class="flex-1 h-full"
                    >
                        <slot name="sidebar-collapsed">
                            <div class="p-3 space-y-2 text-sm opacity-80">
                                <p>Add your nav here…</p>
                                <ul class="space-y-1">
                                    <li
                                        v-for="i in 10"
                                        :key="i"
                                        class="px-2 py-1 rounded hover:bg-(--md-secondary-container) hover:text-(--md-on-secondary-container) cursor-pointer"
                                    >
                                        Item {{ i }}
                                    </li>
                                </ul>
                            </div>
                        </slot>
                    </div>
                </div>
            </div>

            <!-- Resize handle -->
            <ResizeHandle
                v-show="isDesktop && !collapsed"
                :is-desktop="isDesktop"
                :collapsed="collapsed"
                :side="side"
                :min-width="props.minWidth"
                :max-width="props.maxWidth"
                :computed-width="computedWidth"
                @resize-start="onPointerDown"
                @resize-keydown="onHandleKeydown"
            />
        </aside>

        <!-- Main content -->
        <div
            id="main-content"
            ref="mainElement"
            :inert="mobileDrawerOpen"
            class="resizable-main-content relative z-10 flex-1 h-full min-w-0 flex flex-col"
        >
            <div
                id="main-content-container"
                class="flex-1 overflow-hidden content-bg"
                :style="{
                    '--content-bg-size': props.patternSize + 'px',
                    '--content-bg-opacity': String(props.patternOpacity),
                    '--content-overlay-size': props.overlaySize + 'px',
                    '--content-overlay-opacity': String(props.overlayOpacity),
                }"
            >
                <slot>
                    <div class="p-4 space-y-2 text-sm opacity-80">
                        <p>Put your main content here…</p>
                        <p>
                            Resize the sidebar on desktop by dragging the
                            handle. On mobile, use the Menu button to open/close
                            the overlay.
                        </p>
                    </div>
                </slot>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, provide, type CSSProperties } from 'vue';
import { useResizeObserver, useEventListener, useMediaQuery } from '@vueuse/core';
import SidebarHeader from './sidebar/SidebarHeader.vue';
import ResizeHandle from './sidebar/ResizeHandle.vue';
import { useIcon } from '~/composables/useIcon';

type Side = 'left' | 'right';

// Safari's software keyboard changes the visual viewport without resizing dvh.
// Keep the application frame inside the visible area, including Safari's pan.
const visualViewportStyle = ref<CSSProperties>({});
const keyboardOpen = ref(false);
let viewportFrame: number | undefined;
onMounted(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const touchScreen = window.matchMedia('(pointer: coarse)');
    const update = () => {
        viewportFrame = undefined;
        // Browser chrome can shrink this viewport slightly; a software keyboard
        // removes substantially more space. Its top edge needs no home-bar inset.
        // iOS WebKit may shrink innerHeight with the keyboard too, so a focused
        // text field on a touch screen also counts as an open keyboard.
        const active = document.activeElement as HTMLElement | null;
        const editing = touchScreen.matches && !!active &&
            (active.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active.tagName));
        keyboardOpen.value = Math.abs(viewport.scale - 1) <= 0.01 &&
            (editing || window.innerHeight - viewport.height > 120);
        // Let browser pinch zoom pan the normal page instead of reflowing it.
        if (Math.abs(viewport.scale - 1) > 0.01 ||
            (!touchScreen.matches && window.innerWidth >= 768 &&
                Math.abs(viewport.height - window.innerHeight) < 1)) {
            visualViewportStyle.value = {};
            return;
        }
        visualViewportStyle.value = {
            position: 'fixed',
            top: `${viewport.offsetTop}px`,
            insetInline: '0',
            paddingInlineStart: 'env(safe-area-inset-left)',
            paddingInlineEnd: 'env(safe-area-inset-right)',
            height: `${viewport.height}px`,
        };
    };
    const queueUpdate = () => {
        if (viewportFrame === undefined) viewportFrame = requestAnimationFrame(update);
    };
    useEventListener(viewport, ['resize', 'scroll'], queueUpdate, { passive: true });
    useEventListener(window, 'resize', queueUpdate, { passive: true });
    useEventListener(document, ['focusin', 'focusout'], queueUpdate);
    useEventListener(touchScreen, 'change', queueUpdate);
    update();
});
onBeforeUnmount(() => {
    if (viewportFrame !== undefined) cancelAnimationFrame(viewportFrame);
});

const sidebarHeaderRef = ref<ComponentPublicInstance | null>(null);
const topHeaderHeight = ref(48);
provide('topHeaderHeight', topHeaderHeight);

// Observe sidebar header element for height changes using VueUse
const sidebarHeaderElement = computed(
    () => sidebarHeaderRef.value?.$el as HTMLElement | undefined
);
if (import.meta.client) {
    useResizeObserver(sidebarHeaderElement, (entries) => {
        for (const entry of entries) {
            const target = entry.target as HTMLElement;
            topHeaderHeight.value =
                target.offsetHeight || entry.contentRect.height;
        }
    });
}

const props = defineProps({
    modelValue: { type: Boolean, default: undefined },
    defaultOpen: { type: Boolean, default: true },
    side: { type: String as () => Side, default: 'left' },
    minWidth: { type: Number, default: 320 },
    maxWidth: { type: Number, default: 480 },
    defaultWidth: { type: Number, default: 280 },
    collapsedWidth: { type: Number, default: 56 },
    storageKey: { type: String, default: 'sidebar:width' },
    // Visual tuning for content pattern
    patternOpacity: { type: Number, default: 0.05 }, // 0..1
    patternSize: { type: Number, default: 150 }, // px
    // Overlay pattern (renders above the base pattern)
    overlayOpacity: { type: Number, default: 0.05 },
    overlaySize: { type: Number, default: 120 },
    // Sidebar repeating background
    sidebarPatternOpacity: { type: Number, default: 0.09 },
    sidebarPatternSize: { type: Number, default: 240 },
});
const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'resize', width: number): void;
}>();

// helper
const clamp = (w: number) =>
    Math.min(props.maxWidth, Math.max(props.minWidth, w));

// open state: force closed initially for SSR/client parity, then open after mount if rules say so
const openState = ref<boolean>(false);
const open = computed({
    get: () =>
        props.modelValue === undefined ? openState.value : props.modelValue,
    set: (v) => {
        if (props.modelValue === undefined) openState.value = v;
        emit('update:modelValue', v);
    },
});

// collapsed toggle remembers last expanded width
const collapsed = ref(false);
const lastExpandedWidth = ref(props.defaultWidth);

// width state with persistence (clamp to avoid SSR/client mismatch if default < minWidth)
const width = ref<number>(
    Math.min(props.maxWidth, Math.max(props.minWidth, props.defaultWidth))
);
const computedWidth = computed(() =>
    collapsed.value ? props.collapsedWidth : width.value
);

// Emit the same width on server and client; CSS chooses the responsive layout
// before hydration so desktop content already has its reserved space.
const sidebarStyle = computed(() => ({
    '--sidebar-width': `${computedWidth.value}px`,
    '--sidebar-rep-size': `${props.sidebarPatternSize}px`,
    '--sidebar-rep-opacity': String(props.sidebarPatternOpacity),
}));

// Do NOT restore from localStorage before hydration to keep SSR/client markup identical

// responsive: assume mobile on SSR; determine real value on client
// Use useMediaQuery for reactive responsive state
const isDesktop = useMediaQuery('(min-width: 768px)');
// The drawer retains its page after first opening; desktop navigation is eager.
provide('or3:sidebar-visible', computed(() => isDesktop.value || open.value));

// CLS fix: Start with transitions DISABLED to prevent animated width changes during initial render
// After first paint, enable transitions for smooth user interactions
const initialized = ref(false);
const hydrated = ref(false);
const sidebarElement = ref<HTMLElement | null>(null);
const mainElement = ref<HTMLElement | null>(null);
const mobileDrawerOpen = computed(() => hydrated.value && !isDesktop.value && open.value);
let drawerTrigger: HTMLElement | null = null;

function drawerFocusableElements(): HTMLElement[] {
    return Array.from(sidebarElement.value?.querySelectorAll<HTMLElement>(
        'a[href], button, input, textarea, select, [tabindex]'
    ) ?? []).filter((element) =>
        element.tabIndex >= 0 && !element.matches(':disabled') &&
        element.getClientRects().length > 0 && !element.closest('[inert]')
    );
}

function onSidebarKeydown(event: KeyboardEvent): void {
    if (!mobileDrawerOpen.value) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
    } else if (event.key === 'Tab' && !event.defaultPrevented) {
        const focusable = drawerFocusableElements();
        event.preventDefault();
        if (focusable.length) {
            // Safari can omit buttons from its native Tab order. Advance
            // explicitly so every drawer control is reachable in all browsers.
            const current = focusable.findIndex((element) => element === document.activeElement);
            const next = current < 0
                ? event.shiftKey ? focusable.length - 1 : 0
                : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
            focusable[next]?.focus();
        }
    }
}

watch(mobileDrawerOpen, async (isOpen) => {
    if (isOpen) {
        // Safari does not focus a button on pointer activation. Prefer the
        // navigation trigger so dismissal still returns to a usable control.
        drawerTrigger = mainElement.value?.querySelector<HTMLElement>(
            'button[aria-label="Open sidebar"]'
        ) ?? document.activeElement as HTMLElement | null;
    }
    await nextTick();
    if (isOpen && mobileDrawerOpen.value) {
        drawerFocusableElements()[0]?.focus({ preventScroll: true });
    } else if (!isOpen && !mobileDrawerOpen.value) {
        if (drawerTrigger?.isConnected && drawerTrigger.getClientRects().length) {
            drawerTrigger.focus({ preventScroll: true });
        }
        drawerTrigger = null;
    }
});

watch(isDesktop, async (desktop, wasDesktop) => {
    if (desktop || !wasDesktop) return;
    const sidebarHadFocus = sidebarElement.value?.contains(document.activeElement);
    close();
    await nextTick();
    if (sidebarHadFocus) {
        mainElement.value?.querySelector<HTMLElement>('button[aria-label="Open sidebar"]')
            ?.focus({ preventScroll: true });
    }
});

onMounted(() => {
    hydrated.value = true;
    // Open if defaultOpen & desktop
    if (props.defaultOpen && isDesktop.value) {
        openState.value = true;
    }
    // Restore persisted width (after hydration for parity)
    try {
        const saved = localStorage.getItem(props.storageKey);
        const savedWidth = saved ? parseInt(saved, 10) : NaN;
        if (Number.isFinite(savedWidth)) width.value = clamp(savedWidth);
    } catch {}
    // Enable transitions after a delay to allow initial layout to settle
    // Use double rAF to ensure layout is fully painted before transitions activate
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            initialized.value = true;
        });
    });
});

watch(width, (w) => {
    try {
        localStorage.setItem(props.storageKey, String(w));
    } catch {}
    emit('resize', w);
});

function toggle() {
    open.value = !open.value;
}
function close() {
    open.value = false;
}
function toggleCollapse() {
    // On mobile, treat the collapse toggle as a full close of the overlay
    if (!isDesktop.value) {
        open.value = false;
        return;
    }
    if (!collapsed.value) {
        lastExpandedWidth.value = width.value;
        collapsed.value = true;
    } else {
        collapsed.value = false;
        width.value = clamp(lastExpandedWidth.value || props.defaultWidth);
    }
}

// Resize logic (desktop only)
const isDragging = ref(false);
let startX = 0;
let startWidth = 0;
let pendingWidthUpdate: number | null = null;
let widthRafId: number | null = null;

function applyPendingWidth() {
    if (pendingWidthUpdate === null) return;
    width.value = pendingWidthUpdate;
    pendingWidthUpdate = null;
}

function cancelWidthRaf() {
    if (widthRafId === null) return;
    cancelAnimationFrame(widthRafId);
    widthRafId = null;
}

function scheduleWidthUpdate(value: number) {
    pendingWidthUpdate = value;
    if (widthRafId !== null) return;
    widthRafId = requestAnimationFrame(() => {
        widthRafId = null;
        applyPendingWidth();
    });
}

function flushWidthUpdates() {
    cancelWidthRaf();
    applyPendingWidth();
}

function onPointerMove(e: PointerEvent) {
    const dx = e.clientX - startX;
    const delta = props.side === 'right' ? -dx : dx;
    scheduleWidthUpdate(clamp(startWidth + delta));
}

function onPointerUp() {
    isDragging.value = false;
    flushWidthUpdates();
}

// Use VueUse's useEventListener for pointermove/pointerup during drag
// These only activate when isDragging is true
useEventListener(
    () => (isDragging.value ? window : null),
    'pointermove',
    onPointerMove
);
useEventListener(
    () => (isDragging.value ? window : null),
    'pointerup',
    onPointerUp
);

function onPointerDown(e: PointerEvent) {
    if (!isDesktop.value || collapsed.value) return;
    flushWidthUpdates();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    startX = e.clientX;
    startWidth = width.value;
    isDragging.value = true;
}

// Keyboard a11y for the resize handle
function onHandleKeydown(e: KeyboardEvent) {
    if (!isDesktop.value || collapsed.value) return;
    const step = e.shiftKey ? 32 : 16;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        // reverse on right side
        const signed = props.side === 'right' ? -dir : dir;
        width.value = clamp(width.value + signed * step);
    } else if (e.key === 'Home') {
        e.preventDefault();
        width.value = props.minWidth;
    } else if (e.key === 'End') {
        e.preventDefault();
        width.value = props.maxWidth;
    } else if (e.key === 'PageUp') {
        e.preventDefault();
        const big = step * 2;
        const signed = props.side === 'right' ? -1 : 1;
        width.value = clamp(width.value + signed * big);
    } else if (e.key === 'PageDown') {
        e.preventDefault();
        const big = step * 2;
        const signed = props.side === 'right' ? 1 : -1;
        width.value = clamp(width.value - signed * big);
    }
}

// expose minimal API if needed
function openSidebar() {
    open.value = true;
}
function expand() {
    // Ensure sidebar is open (mobile) and uncollapsed (desktop)
    open.value = true;
    if (collapsed.value) {
        collapsed.value = false;
        width.value = clamp(lastExpandedWidth.value || props.defaultWidth);
    }
}
defineExpose({
    toggle,
    close,
    openSidebar,
    expand,
    isCollapsed: collapsed,
    isOpen: open,
});

const side = computed<Side>(() => (props.side === 'right' ? 'right' : 'left'));

// Pre-resolve icons to ensure reactivity tracks the registry updates correctly
const iconToggleLeft = useIcon('shell.sidebar.toggle.left');
const iconToggleRight = useIcon('shell.sidebar.toggle.right');

// Icon and aria label for collapse/expand button
const toggleIcon = computed(() => {
    // When collapsed, show the icon that suggests expanding back toward content area
    if (collapsed.value) {
        return side.value === 'right'
            ? iconToggleLeft.value
            : iconToggleRight.value;
    }
    // When expanded, show icon pointing into the sidebar to collapse it
    return side.value === 'right'
        ? iconToggleRight.value
        : iconToggleLeft.value;
});
const toggleAria = computed(() =>
    collapsed.value ? 'Expand sidebar' : 'Collapse sidebar'
);
</script>

<style scoped>
.resizable-sidebar {
    width: 100%;
    max-width: 100dvw;
}

@media (min-width: 768px) {
    .resizable-sidebar {
        width: var(--sidebar-width);
        max-width: none;
    }
}

/* Expanded landscape Safari chrome and its keyboard can leave a tiny viewport.
   Give that space to text entry; normal navigation returns when it grows. */
@container app-viewport (height < 140px) {
    #page-container :deep(.workspace-chrome),
    #page-container :deep(.workspace-chrome-placeholder),
    #page-container :deep(#top-header) {
        display: none !important;
    }

    #page-container :deep(.pane-container) {
        padding-top: 0 !important;
    }

    #page-container :deep(.chat-input-wrapper),
    #page-container :deep(.chat-inner-input-container) {
        min-height: 0 !important;
        padding-bottom: 0 !important;
    }

    #page-container :deep(.chat-input) {
        margin-bottom: 0 !important;
    }
}

/* Optional: could add extra visual flair for the resize handle here */
.content-bg {
    position: relative;
    /* Base matches sidebar/header */
    background-color: var(
        --app-content-bg-1-color,
        var(--md-surface-container-low)
    );
}
/* Sidebar background size support */
:root {
    /* fallback value if not set */
    --app-sidebar-bg-1-size: 240px;
}
.dark .content-bg {
    background-color: var(
        --app-content-bg-1-color,
        var(--md-surface-container-low)
    );
}

.content-bg::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: var(--app-content-bg-1, none);
    background-repeat: var(
        --app-content-bg-1-repeat,
        var(--app-content-bg-repeat, repeat)
    );
    background-position: top left;
    /* Default variables; can be overridden via inline style */
    --content-bg-size: var(--app-content-bg-1-size, 150px);
    --content-bg-opacity: 0.08; /* legacy component var (fallback) */
    background-size: var(--content-bg-size);
    opacity: var(--app-content-bg-1-opacity, var(--content-bg-opacity));
    z-index: 0;
    /* Keep transparent so base element's background-color always visible/tint */
    background-color: transparent;
}

/* Ensure the real content sits above the pattern */
.content-bg > * {
    position: relative;
    z-index: 1;
}

/* Overlay layer above base pattern but below content */
.content-bg::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: var(--app-content-bg-2, none);
    background-repeat: var(
        --app-content-bg-2-repeat,
        var(--app-content-bg-repeat, repeat)
    );
    background-position: top left;
    --content-overlay-size: var(--app-content-bg-2-size, 380px);
    --content-overlay-opacity: 0.125; /* legacy component var (fallback) */
    background-size: var(--content-overlay-size);
    opacity: var(--app-content-bg-2-opacity, var(--content-overlay-opacity));
    z-index: 0.5;
    background-color: var(--app-content-bg-2-color, transparent);
}

/* Hardcoded header pattern repeating horizontally */
.header-pattern {
    background-color: var(--md-surface-variant);
    background-image: var(--app-header-gradient, none);
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
}

/* Sidebar repeating background layer */
aside::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: var(--app-sidebar-bg-1, none);
    background-repeat: var(--app-sidebar-bg-1-repeat, repeat);
    background-position: top left;
    background-size: var(--sidebar-rep-size) var(--sidebar-rep-size);
    opacity: var(--app-sidebar-bg-1-opacity, var(--sidebar-rep-opacity));
    z-index: 0;
    background-color: var(--app-sidebar-bg-color, var(--md-surface-variant));
    background-size: var(--app-sidebar-bg-1-size, 240px)
        var(--app-sidebar-bg-1-size, 240px);
}

aside {
    background-color: var(
        --app-sidebar-bg-color,
        var(--md-surface-container-lowest)
    );
}
.dark aside {
    background-color: var(
        --app-sidebar-bg-color,
        var(--md-surface-container-low)
    );
}

/* Ensure sidebar children render above the pattern, but keep handle on top */
aside > *:not(.resize-handle-layer) {
    position: relative;
    z-index: 1;
}
</style>
