<template>
    <div
        class="relative w-full h-screen border border-[var(--md-outline-variant)] overflow-hidden bg-[var(--md-surface)] text-[var(--md-on-surface)] flex overflow-x-hidden"
    >
        <!-- Backdrop on mobile when open -->
        <Transition
            enter-active-class="transition-opacity duration-150"
            leave-active-class="transition-opacity duration-150"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
        >
            <div
                v-if="!isDesktop && open"
                class="absolute inset-0 bg-black/40 z-30 md:hidden"
                @click="close()"
            />
        </Transition>

        <!-- Sidebar -->
        <aside
            :class="[
                'z-40 bg-[var(--md-surface)] text-[var(--md-on-surface)] border-[var(--md-outline-variant)]',
                // width transition on desktop
                'md:transition-[width] md:duration-200 md:ease-out',
                'md:relative md:h-full md:flex-shrink-0 md:border-r',
                side === 'right' ? 'md:border-l md:border-r-0' : '',
                // mobile overlay behavior
                !isDesktop
                    ? [
                          'absolute top-0 bottom-0 w-[80vw] max-w-[90vw] shadow-xl',
                          // animated slide
                          'transition-transform duration-200 ease-out',
                          side === 'right'
                              ? 'right-0 translate-x-full'
                              : 'left-0 -translate-x-full',
                          open ? 'translate-x-0' : '',
                      ]
                    : '',
            ]"
            :style="isDesktop ? { width: computedWidth + 'px' } : undefined"
            @keydown.esc.stop.prevent="close()"
        >
            <div class="h-full flex flex-col">
                <!-- Sidebar header -->
                <div
                    :class="{
                        'px-0 justify-center': collapsed,
                        'px-3 justify-between': !collapsed,
                    }"
                    class="flex items-center py-2 border-b border-[var(--md-outline-variant)]"
                >
                    <div v-show="!collapsed">
                        <slot name="sidebar-header">
                            <div
                                class="text-sm font-medium uppercase tracking-wide"
                            >
                                Sidebar
                            </div>
                        </slot>
                    </div>
                    <slot
                        name="sidebar-toggle"
                        :collapsed="collapsed"
                        :toggle="toggleCollapse"
                    >
                        <UButton
                            size="sm"
                            :square="true"
                            color="neutral"
                            variant="ghost"
                            :class="'retro-btn'"
                            @click="toggleCollapse()"
                            :ui="{ base: 'retro-btn' }"
                            :aria-label="toggleAria"
                            :title="toggleAria"
                        >
                            <UIcon :name="toggleIcon" class="w-5 h-5" />
                        </UButton>
                    </slot>
                </div>

                <!-- Sidebar content -->
                <div v-show="!collapsed" class="flex-1 overflow-auto">
                    <slot name="sidebar">
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

            <!-- Resize handle (desktop only) -->
            <div
                v-if="isDesktop && !collapsed"
                class="hidden md:block absolute top-0 bottom-0 w-3 cursor-col-resize select-none group"
                :class="side === 'right' ? 'left-0' : 'right-0'"
                @pointerdown="onPointerDown"
                role="separator"
                aria-orientation="vertical"
                :aria-valuemin="props.minWidth"
                :aria-valuemax="props.maxWidth"
                :aria-valuenow="computedWidth"
                aria-label="Resize sidebar"
                tabindex="0"
                @keydown="onHandleKeydown"
            >
                <div
                    class="absolute inset-y-0 my-auto h-24 w-1.5 rounded-full bg-[var(--md-outline-variant)]/70 group-hover:bg-[var(--md-primary)]/70 transition-colors"
                    :class="side === 'right' ? 'left-0' : 'right-0'"
                ></div>
            </div>
        </aside>

        <!-- Main content -->
        <div class="relative z-10 flex-1 h-full flex flex-col">
            <!-- Top bar with mobile toggle -->
            <div
                class="flex items-center gap-2 p-2 border-b border-[var(--md-outline-variant)] bg-[var(--md-surface)]"
            >
                <slot name="mobile-toggle" :open="open" :toggle="toggle">
                    <UButton
                        class="retro-btn md:hidden"
                        size="sm"
                        color="primary"
                        :ui="{ base: 'retro-btn' }"
                        @click="toggle()"
                    >
                        {{ open ? 'Close' : 'Menu' }}
                    </UButton>
                </slot>
                <slot name="header">
                    <div class="text-sm opacity-80">Content</div>
                </slot>
            </div>

            <div class="flex-1 overflow-auto">
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

type Side = 'left' | 'right';

const props = defineProps({
    modelValue: { type: Boolean, default: undefined },
    defaultOpen: { type: Boolean, default: true },
    side: { type: String as () => Side, default: 'left' },
    minWidth: { type: Number, default: 200 },
    maxWidth: { type: Number, default: 480 },
    defaultWidth: { type: Number, default: 280 },
    collapsedWidth: { type: Number, default: 56 },
    storageKey: { type: String, default: 'sidebar:width' },
});
const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'resize', width: number): void;
}>();

// open state (controlled or uncontrolled)
const openState = ref<boolean>(props.modelValue ?? props.defaultOpen);
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

// responsive
const isDesktop = ref(false);
let mq: MediaQueryList | undefined;
const updateMq = () => {
    if (typeof window === 'undefined') return;
    mq = window.matchMedia('(min-width: 768px)');
    isDesktop.value = mq.matches;
};

onMounted(() => {
    updateMq();
    mq?.addEventListener('change', () => (isDesktop.value = !!mq?.matches));

    // restore width
    try {
        const saved = localStorage.getItem(props.storageKey);
        if (saved) width.value = clamp(parseInt(saved, 10));
    } catch {}
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

const clamp = (w: number) =>
    Math.min(props.maxWidth, Math.max(props.minWidth, w));

function toggle() {
    open.value = !open.value;
}
function close() {
    open.value = false;
}
function toggleCollapse() {
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
defineExpose({ toggle, close });

const side = computed<Side>(() => (props.side === 'right' ? 'right' : 'left'));
// Icon and aria label for collapse/expand button
const toggleIcon = computed(() => {
    // When collapsed, show the icon that suggests expanding back toward content area
    if (collapsed.value) {
        return side.value === 'right'
            ? 'i-lucide:chevron-left'
            : 'i-lucide:chevron-right';
    }
    // When expanded, show icon pointing into the sidebar to collapse it
    return side.value === 'right'
        ? 'i-lucide:chevron-right'
        : 'i-lucide:chevron-left';
});
const toggleAria = computed(() =>
    collapsed.value ? 'Expand sidebar' : 'Collapse sidebar'
);
</script>

<style scoped>
/* Optional: could add extra visual flair for the resize handle here */
</style>
