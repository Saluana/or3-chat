<template>
    <div
        class="pane-unknown flex-1 flex flex-col items-center justify-center p-8 text-center"
        :data-pane-mode="mode"
    >
        <div class="max-w-md space-y-4">
            <div class="text-6xl opacity-50">
                <UIcon :name="iconUnknown" class="w-16 h-16 mx-auto" />
            </div>
            <h2 class="text-xl font-bold text-[var(--md-on-surface)]">
                App unavailable
            </h2>
            <p class="text-sm opacity-70 text-[var(--md-on-surface-variant)]">
                This app is still loading or is not enabled in this workspace.
                If it stays unavailable, check Marketplace → Installed.
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useIcon } from '~/composables/useIcon';

defineProps<{
    mode: string;
}>();

const iconUnknown = useIcon('ui.unknown');
</script>
