<template>
    <div
        id="page-container"
        class="resizable-sidebar-layout relative w-full h-[100dvh] border border-[var(--md-outline-variant)] overflow-hidden bg-[var(--md-surface)] text-[var(--md-on-surface)] flex overflow-x-hidden"
    >
        <!-- Backdrop on mobile when open -->
        <Transition
            enter-active-class="transition-opacity duration-150"
            leave-active-class="transition-opacity duration-150"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
        >
            <div
                id="mobile-close"
                v-if="!isDesktop && open"
                class="absolute inset-0 bg-black/40 z-30 md:hidden"
                @click="close()"
            />
        </Transition>

        <!-- Sidebar -->
        <aside
            id="sidebar"
            :class="[
                'resizable-sidebar flex z-40 bg-(--md-surface) text-(--md-on-surface) border-(--md-inverse-surface) flex-col',
                // width transition on desktop
                initialized
                    ? 'md:transition-[width] md:duration-200 md:ease-out'
                    : 'hidden',
                'md:relative md:h-full md:shrink-0 md:border-r-2',
                side === 'right' ? 'md:border-l md:border-r-0' : '',
                // mobile overlay behavior
                !isDesktop
                    ? [
                          'absolute inset-0 w-full shadow-xl',
                          // animated slide
                          'transition-transform duration-200 ease-out',
                          side === 'right'
                              ? 'right-0 translate-x-full'
                              : 'left-0 -translate-x-full',
                          open ? 'translate-x-0' : '',
                      ]
                    : '',
            ]"
            :style="
                Object.assign(
                    isDesktop ? { width: computedWidth + 'px' } : {},
                    {
                        '--sidebar-rep-size': props.sidebarPatternSize + 'px',
                        '--sidebar-rep-opacity': String(
                            props.sidebarPatternOpacity
                        ),
                    }
                )
            "
            @keydown.esc.stop.prevent="close()"
        >
            <div
                id="sidebar-container-outer"
                class="resizable-sidebar-container h-full flex flex-col"
            >
                <!-- Sidebar header -->
                <SidebarHeader
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

                <!-- Sidebar content -->
                <div
                    id="sidebar-container-expanded"
                    class="flex-1 overflow-auto overscroll-contain min-w-fit"
                >
                    <div v-show="!collapsed" class="flex-1 h-full">
                        <slot name="sidebar-expanded">
                            <div class="p-3 space-y-2 text-sm opacity-80">
                                <p>Add your nav here…</p>
                                <ul class="space-y-1">
                                    <li
                                        v-for="i in 10"
                                        :key="i"
                                        class="px-2 py-1 rounded hover:bg-[var(--md-secondary-container)] hover:text-[var(--md-on-secondary-container)] cursor-pointer"
                                    >
                                        Item {{ i }}
                                    </li>
                                </ul>
                            </div>
                        </slot>
                    </div>
                    <div
                        id="sidebar-container-collapsed"
                        v-if="collapsed"
                        class="flex-1 h-full"
                    >
                        <slot name="sidebar-collapsed">
                            <div class="p-3 space-y-2 text-sm opacity-80">
                                <p>Add your nav here…</p>
                                <ul class="space-y-1">
                                    <li
                                        v-for="i in 10"
                                        :key="i"
                                        class="px-2 py-1 rounded hover:bg-[var(--md-secondary-container)] hover:text-[var(--md-on-secondary-container)] cursor-pointer"
                                    >
                                        Item {{ i }}
                                    </li>
                                </ul>
                            </div>
                        </slot>
                    </div>
                </div>
            </div>

            <!-- Resize handle (desktop only) -->
            <ResizeHandle
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
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import SidebarHeader from './sidebar/SidebarHeader.vue';
import ResizeHandle from './sidebar/ResizeHandle.vue';

type Side = 'left' | 'right';

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

// open state (controlled or uncontrolled)
// Hydration note:
// We intentionally start CLOSED for both SSR and initial client render to avoid
// class / node mismatches between server HTML (which cannot know viewport width)
// and the hydrated client (which previously opened immediately on desktop).
// After mount we detect desktop and apply defaultOpen. This removes the
// hydration warnings about missing backdrop / translate-x-0 classes.
const openState = ref<boolean>(
    (() => {
        if (props.modelValue !== undefined) return props.modelValue;
        return false; // unified deterministic initial state
    })()
);
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

// width state with persistence
const width = ref<number>(props.defaultWidth);
const computedWidth = computed(() =>
    collapsed.value ? props.collapsedWidth : width.value
);

// Attempt early (pre-mount) restoration to avoid post-mount jank
if (import.meta.client) {
    try {
        const saved = localStorage.getItem(props.storageKey);
        if (saved) width.value = clamp(parseInt(saved, 10));
    } catch {}
}

// responsive
const isDesktop = ref(false);
let mq: MediaQueryList | undefined;
const updateMq = () => {
    if (typeof window === 'undefined') return;
    mq = window.matchMedia('(min-width: 768px)');
    isDesktop.value = mq.matches;
};

// Defer enabling transitions until after first paint so restored width doesn't animate
const initialized = ref(false);

onMounted(() => {
    updateMq();
    mq?.addEventListener('change', () => (isDesktop.value = !!mq?.matches));
    // Apply defaultOpen only AFTER we know if we're on desktop so SSR & first client
    // render remain consistent.
    if (
        props.modelValue === undefined &&
        isDesktop.value &&
        props.defaultOpen &&
        !openState.value
    ) {
        openState.value = true;
    }
    requestAnimationFrame(() => (initialized.value = true));
});

onBeforeUnmount(() => {
    mq?.removeEventListener('change', () => {});
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
let startX = 0;
let startWidth = 0;
function onPointerDown(e: PointerEvent) {
    if (!isDesktop.value || collapsed.value) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    startX = e.clientX;
    startWidth = width.value;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
}
function onPointerMove(e: PointerEvent) {
    const dx = e.clientX - startX;
    const delta = props.side === 'right' ? -dx : dx;
    width.value = clamp(startWidth + delta);
}
function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
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
defineExpose({ toggle, close, openSidebar, expand, isCollapsed: collapsed });

const side = computed<Side>(() => (props.side === 'right' ? 'right' : 'left'));
// Icon and aria label for collapse/expand button
const toggleIcon = computed(() => {
    // When collapsed, show the icon that suggests expanding back toward content area
    if (collapsed.value) {
        return side.value === 'right'
            ? 'pixelarticons:arrow-bar-left'
            : 'pixelarticons:arrow-bar-right';
    }
    // When expanded, show icon pointing into the sidebar to collapse it
    return side.value === 'right'
        ? 'pixelarticons:arrow-bar-right'
        : 'pixelarticons:arrow-bar-left';
});
const toggleAria = computed(() =>
    collapsed.value ? 'Expand sidebar' : 'Collapse sidebar'
);
</script>

<style scoped>
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
    --app-sidebar-bg-size: 240px;
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
    background-image: var(--app-content-bg-1, url('/bg-repeat.webp'));
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
    background-image: var(--app-content-bg-2, url('/bg-repeat-2.webp'));
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
    background-image: url('/gradient-x.webp');
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
    background-image: var(--app-sidebar-bg-1, url('/sidebar-repeater.webp'));
    background-repeat: var(--app-sidebar-bg-repeat, repeat);
    background-position: top left;
    background-size: var(--sidebar-rep-size) var(--sidebar-rep-size);
    opacity: var(--app-sidebar-bg-1-opacity, var(--sidebar-rep-opacity));
    z-index: 0;
    background-color: var(--app-sidebar-bg-color, var(--md-surface-variant));
    background-size: var(--app-sidebar-bg-size, 240px)
        var(--app-sidebar-bg-size, 240px);
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
