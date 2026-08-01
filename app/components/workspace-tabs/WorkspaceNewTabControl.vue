<template>
    <div class="workspace-tab-new-wrap">
        <UTooltip :delay-duration="0" :text="tooltip">
            <button
                v-theme="'shell.tab-new'"
                type="button"
                class="workspace-tab-new"
                aria-label="New tab"
                :title="tooltip"
                aria-haspopup="menu"
                @click="emit('new-tab')"
                @contextmenu.prevent="openMenu"
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
                ref="menuElement"
                class="workspace-tab-context workspace-new-tab-menu"
                :style="menuStyle"
                role="menu"
                aria-label="Create new tab"
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

const tooltip = computed(() =>
    props.canCreateDocument || props.canCreateWorkflow || props.canCreateAgent
        ? 'New tab · right-click for more'
        : 'New tab'
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
    menu.value = { x: event.clientX, y: event.clientY };
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
    if (event.key === 'Escape') menu.value = null;
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
    if (x !== value.x || y !== value.y) menu.value = { x, y };
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
    border-radius: var(--or3-tab-radius, var(--md-border-radius, 0.5rem));
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
    border-radius: var(--md-border-radius, 0.375rem);
    color: inherit;
    text-align: left;
    font-size: 13px;
}
.workspace-tab-context button:hover {
    background: var(--md-surface-hover);
}
.workspace-new-tab-menu-icon {
    width: 14px;
    height: 14px;
    flex: none;
    color: var(--md-on-surface-variant);
}
</style>
