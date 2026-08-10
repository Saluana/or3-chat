<template>
    <div class="workspace-tab-new-wrap">
        <UTooltip :delay-duration="0" :text="tooltip">
            <button
                ref="trigger"
                v-theme="'shell.tab-new'"
                type="button"
                class="workspace-tab-new"
                aria-label="New chat"
                :title="tooltip"
                aria-haspopup="menu"
                :aria-expanded="Boolean(menu)"
                :aria-controls="menu ? 'workspace-new-tab-menu' : undefined"
                @click="onNewTab"
                @contextmenu.prevent="openMenu"
                @keydown="onTriggerKeydown"
            >
                <UIcon :name="plusIcon" />
            </button>
        </UTooltip>
        <!--
          Teleport out of .workspace-chrome: blank theme applies backdrop-filter
          there, which makes position:fixed use the chrome as containing block.
          Viewport clientX/clientY then overshoot by ~sidebar width.
        -->
        <Teleport to="body">
            <div
                v-if="menu"
                id="workspace-new-tab-menu"
                ref="menuElement"
                class="workspace-tab-context workspace-new-tab-menu"
                :style="menuStyle"
                role="menu"
                aria-label="Create new tab"
                @keydown="onMenuKeydown"
            >
                <button
                    v-for="item in items"
                    :key="item.id"
                    role="menuitem"
                    type="button"
                    @click="pick(item.id)"
                >
                    <UIcon v-if="item.icon" :name="item.icon" class="workspace-new-tab-menu-icon" />
                    <span>{{ item.label }}</span>
                </button>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useIcon } from '~/composables/useIcon';

export type WorkspaceNewTabCreateKind =
    | 'chat'
    | 'document'
    | 'workflow'
    | 'agent';

const props = withDefaults(
    defineProps<{
        canCreateDocument?: boolean;
        canCreateWorkflow?: boolean;
        canCreateAgent?: boolean;
    }>(),
    {
        canCreateDocument: false,
        canCreateWorkflow: false,
        canCreateAgent: false,
    }
);

const emit = defineEmits<{
    'new-tab': [];
    create: [kind: WorkspaceNewTabCreateKind];
}>();

const plusIcon = useIcon('shell.tab.new');
const menu = ref<{ x: number; y: number } | null>(null);
const menuElement = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

const tooltip = computed(() =>
    props.canCreateDocument || props.canCreateWorkflow || props.canCreateAgent
        ? 'New chat · right-click or press ↓ for more'
        : 'New chat'
);

const items = computed(() => {
    const next: Array<{
        id: WorkspaceNewTabCreateKind;
        label: string;
        icon?: string;
    }> = [
        { id: 'chat', label: 'New chat', icon: 'i-lucide-message-square' },
    ];
    if (props.canCreateDocument) {
        next.push({
            id: 'document',
            label: 'New document',
            icon: 'i-lucide-file-plus',
        });
    }
    if (props.canCreateWorkflow) {
        next.push({
            id: 'workflow',
            label: 'New workflow',
            icon: 'i-lucide-git-branch',
        });
    }
    if (props.canCreateAgent) {
        next.push({
            id: 'agent',
            label: 'New agent session',
            icon: 'i-lucide-bot',
        });
    }
    return next;
});

const menuStyle = computed(() => {
    if (!menu.value) return {};
    return {
        left: `${menu.value.x}px`,
        top: `${menu.value.y}px`,
    };
});

function openMenu(event: MouseEvent): void {
    const rect = trigger.value?.getBoundingClientRect();
    const isKeyboardInvocation = event.clientX === 0 && event.clientY === 0;
    menu.value = {
        x: isKeyboardInvocation ? (rect?.left ?? 0) : event.clientX,
        y: isKeyboardInvocation ? (rect?.bottom ?? 0) : event.clientY,
    };
}

function openMenuFromTrigger(): void {
    const rect = trigger.value?.getBoundingClientRect();
    menu.value = {
        x: rect?.left ?? 0,
        y: rect?.bottom ?? 0,
    };
}

function onNewTab(): void {
    menu.value = null;
    emit('new-tab');
}

function onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openMenuFromTrigger();
}

function pick(kind: WorkspaceNewTabCreateKind): void {
    menu.value = null;
    if (kind === 'chat') {
        emit('new-tab');
        return;
    }
    emit('create', kind);
}

function dismissOnOutsidePointer(event: PointerEvent): void {
    if (!menu.value) return;
    const target = event.target;
    if (target instanceof Node && menuElement.value?.contains(target)) return;
    menu.value = null;
}

function dismissOnEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !menu.value) return;
    event.preventDefault();
    menu.value = null;
    trigger.value?.focus();
}

function menuItems(): HTMLButtonElement[] {
    return Array.from(
        menuElement.value?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]'
        ) ?? []
    );
}

function onMenuKeydown(event: KeyboardEvent): void {
    const items = menuItems();
    if (!items.length) return;
    const currentIndex = items.indexOf(
        document.activeElement as HTMLButtonElement
    );
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1 + items.length) % items.length;
    }
    if (event.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + items.length) % items.length;
    }
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
}

if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', dismissOnOutsidePointer, true);
    window.addEventListener('keydown', dismissOnEscape, true);
}
onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', dismissOnOutsidePointer, true);
        window.removeEventListener('keydown', dismissOnEscape, true);
    }
});

watch(menu, async (value) => {
    if (!value) return;
    await nextTick();
    const el = menuElement.value;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = value.x;
    let y = value.y;
    if (x + rect.width > window.innerWidth - pad) {
        x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
        y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x !== value.x || y !== value.y) {
        menu.value = { x, y };
        return;
    }
    menuItems()[0]?.focus();
});
</script>

<style scoped>
.workspace-tab-new-wrap {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
}
.workspace-tab-new {
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
    border-radius: var(--or3-tab-radius, var(--md-border-radius-small, var(--md-border-radius, 0.5rem)));
    background: var(--or3-tab-bg, transparent);
    color: var(--md-on-surface);
    box-shadow: var(--or3-tab-shadow, none);
}
.workspace-tab-new:hover {
    background: var(--or3-tab-bg-hover, var(--md-surface-hover));
    box-shadow: var(--or3-tab-shadow-hover, var(--or3-tab-shadow, none));
}
.workspace-tab-context {
    position: fixed;
    z-index: 100;
    display: grid;
    min-width: 176px;
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
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 28px;
    padding: 0 8px;
    border-radius: var(--md-border-radius-small, var(--md-border-radius, 0.375rem));
    color: inherit;
    text-align: left;
    font-size: 13px;
}
.workspace-tab-context button:hover {
    background: var(--md-surface-hover);
}
.workspace-tab-context button:focus-visible {
    outline: var(--md-border-width, 2px) solid var(--md-primary);
    outline-offset: -2px;
    background: var(--md-surface-hover);
}
.workspace-new-tab-menu-icon {
    width: 14px;
    height: 14px;
    flex: none;
    color: var(--md-on-surface-variant);
}
</style>
