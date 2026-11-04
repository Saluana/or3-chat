<script setup lang="ts">
import AppIcon from '~/components/ui/AppIcon.vue';
import { useIcon } from '~/composables/useIcon';
import type { IconToken } from '~/config/icon-tokens';

/**
 * One row of a `.dashboard-list` group. A row opens a view (chevron), picks an
 * option (`selected` adds a check and aria-pressed), or is `static` and holds
 * its own control in the `trailing` slot.
 */
const props = withDefaults(defineProps<{
    label: string;
    description?: string;
    value?: string;
    icon?: string;
    iconToken?: IconToken;
    image?: string;
    selected?: boolean;
    static?: boolean;
    danger?: boolean;
}>(), {
    // Absent means "not an option row"; Vue would otherwise cast it to false.
    selected: undefined,
});

const chevronIcon = useIcon('ui.chevron.right');
const checkIcon = useIcon('ui.check');
</script>

<template>
    <component
        :is="props.static ? 'div' : 'button'"
        :type="props.static ? undefined : 'button'"
        class="dashboard-list-row"
        :class="{ 'dashboard-list-row--danger': danger }"
        :aria-pressed="selected === undefined ? undefined : selected"
    >
        <span
            v-if="icon || iconToken || image"
            class="dashboard-list-icon"
            aria-hidden="true"
        >
            <AppIcon
                :icon="icon"
                :icon-token="iconToken"
                :image="image"
                class="size-5"
            />
        </span>
        <span class="dashboard-list-text">
            <span class="dashboard-list-label">{{ label }}</span>
            <span v-if="description" class="dashboard-list-description">
                {{ description }}
            </span>
            <slot />
        </span>
        <span v-if="value" class="dashboard-list-value">{{ value }}</span>
        <slot name="trailing">
            <UIcon
                v-if="selected"
                :name="checkIcon"
                class="dashboard-list-check"
                aria-hidden="true"
            />
            <UIcon
                v-else-if="!props.static && selected === undefined"
                :name="chevronIcon"
                class="dashboard-list-chevron"
                aria-hidden="true"
            />
        </slot>
    </component>
</template>
