<template>
    <div
        ref="containerRef"
        class="or3-palette-actions shrink-0 border-t border-[color:var(--md-border-color)] px-3 py-2.5"
        :class="
            trayOpen
                ? 'bg-[color-mix(in_srgb,var(--md-primary)_6%,transparent)]'
                : ''
        "
        role="group"
        :aria-label="trayOpen ? 'Result actions (active)' : 'Result actions'"
        @keydown="onKeydown"
    >
        <div class="mb-1.5 flex items-center justify-between gap-2">
            <span
                class="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[color:var(--md-on-surface-variant)]/85"
            >
                Quick actions
            </span>
            <span
                v-if="trayOpen"
                class="hidden text-[10px] text-[color:var(--md-on-surface-variant)] sm:inline"
            >
                Tab to cycle
            </span>
        </div>

        <UButton
            v-if="primaryAction"
            v-bind="primaryButtonProps"
            :disabled="primaryAction.disabled"
            :title="primaryAction.disabledReason"
            @click="emit('run', primaryAction)"
        >
            <UIcon
                v-if="primaryAction.icon"
                :name="primaryAction.icon"
                class="h-3.5 w-3.5 shrink-0"
            />
            <span class="min-w-0 flex-1 truncate text-left">{{
                primaryAction.label
            }}</span>
            <span
                class="hidden shrink-0 rounded border border-current/25 px-1 text-[10px] leading-none opacity-80 sm:inline-block"
                aria-hidden="true"
                >↵</span
            >
        </UButton>

        <div
            v-if="secondaryActions.length"
            ref="secondaryRef"
            class="mt-1.5 space-y-1"
        >
            <UButton
                v-for="action in secondaryActions"
                :key="action.id"
                v-bind="secondaryButtonProps"
                :disabled="action.disabled"
                :title="action.disabledReason"
                @click="emit('run', action)"
            >
                <UIcon
                    v-if="action.icon"
                    :name="action.icon"
                    class="h-3.5 w-3.5 shrink-0"
                />
                <span class="min-w-0 flex-1 truncate text-left">{{
                    action.label
                }}</span>
                <span
                    v-if="action.disabled && action.disabledReason"
                    class="shrink-0 text-[10px] text-[color:var(--md-on-surface-variant)]"
                >
                    {{ action.disabledReason }}
                </span>
                <span
                    v-else-if="action.shortcut"
                    class="hidden shrink-0 rounded border border-[color:var(--md-border-color)] px-1 text-[10px] leading-none text-[color:var(--md-on-surface-variant)] sm:inline-block"
                    aria-hidden="true"
                >
                    {{ action.shortcut }}
                </span>
            </UButton>
        </div>

        <p
            v-else-if="primaryAction"
            class="mt-1.5 text-[10.5px] text-[color:var(--md-on-surface-variant)]/80"
        >
            No additional actions for this result.
        </p>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { buildThemeOverrideProps } from '~/composables/ui/themeOverrideProps';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { PaletteAction } from '~/core/search/command-palette/types';

const props = defineProps<{
    primaryAction: PaletteAction | null;
    secondaryActions: readonly PaletteAction[];
    trayOpen: boolean;
}>();

const emit = defineEmits<{
    (e: 'run', action: PaletteAction): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
const secondaryRef = ref<HTMLElement | null>(null);

const primaryOverrides = useThemeOverrides({
    component: 'button',
    context: 'global',
    identifier: 'command-palette.primary-action',
    isNuxtUI: true,
});

const secondaryOverrides = useThemeOverrides({
    component: 'button',
    context: 'global',
    identifier: 'command-palette.secondary-action',
    isNuxtUI: true,
});

const primaryButtonProps = computed(() =>
    buildThemeOverrideProps(primaryOverrides.value, {
        baseClass: 'w-full justify-start gap-2',
        baseUi: { base: 'w-full flex items-center gap-2 text-[12.5px]' },
    })
);

const secondaryButtonProps = computed(() =>
    buildThemeOverrideProps(secondaryOverrides.value, {
        baseClass: 'w-full justify-start gap-2',
        baseUi: { base: 'w-full flex items-center gap-2 text-[12.5px]' },
    })
);

function focusableButtons(): HTMLElement[] {
    const root = containerRef.value;
    if (!root) return [];
    return Array.from(
        root.querySelectorAll<HTMLElement>('button:not([disabled])')
    );
}

/**
 * Focus the first enabled secondary action (Enter already runs the primary),
 * falling back to the primary button. Returns false when nothing is focusable.
 */
function focusFirstAction(): boolean {
    const secondary = secondaryRef.value?.querySelector<HTMLElement>(
        'button:not([disabled])'
    );
    const target = secondary ?? focusableButtons()[0];
    if (!target) return false;
    target.focus();
    return true;
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !props.trayOpen) return;
    const buttons = focusableButtons();
    if (buttons.length < 1) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    const delta = event.shiftKey ? -1 : 1;
    const nextIndex =
        current < 0
            ? delta > 0
                ? 0
                : buttons.length - 1
            : (current + delta + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
}

defineExpose({ focusFirstAction });
</script>
