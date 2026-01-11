<template>
    <div class="w-full h-full flex items-center justify-center px-4 py-8">
        <div class="w-full max-w-[380px] px-5 py-6 text-center">
            <div
                class="mx-auto w-12 h-12 rounded-full bg-[color:var(--md-primary)]/12 text-[color:var(--md-primary)] flex items-center justify-center"
            >
                <UIcon :name="icon" class="w-6 h-6" />
            </div>
            <h3
                class="mt-4 text-sm font-semibold text-[color:var(--md-on-surface)]"
            >
                {{ title }}
            </h3>
            <p
                v-if="description"
                class="mt-1 text-xs text-[color:var(--md-on-surface-variant)]"
            >
                {{ description }}
            </p>
            <div
                v-if="$slots.actions"
                class="mt-4"
                :class="actionsClass"
            >
                <slot name="actions" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        title: string;
        description?: string;
        icon: string;
        actionsLayout?: 'row' | 'column';
    }>(),
    {
        actionsLayout: 'row',
    }
);

const actionsClass = computed(() =>
    props.actionsLayout === 'column'
        ? 'flex flex-col items-stretch gap-2'
        : 'flex items-center justify-center gap-2 flex-wrap'
);
</script>
