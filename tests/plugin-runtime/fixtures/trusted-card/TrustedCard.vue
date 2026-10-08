<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import type { ToolCardContext } from '@or3/plugin-sdk/cards';
import type { PluginTrustedUiKitV1 } from '@or3/plugin-sdk';
const props = defineProps<{ card: ToolCardContext; kit: PluginTrustedUiKitV1 }>();
const result = props.card.result as { place?: string } | null;
onBeforeUnmount(() =>
    window.dispatchEvent(new CustomEvent('or3:trusted-card-cleanup'))
);
</script>
<template>
    <section>
        <p>{{ result?.place }}</p>
        <component
            :is="kit.components.UButton"
            label="Trusted kit answer"
            @click="card.send('Trusted kit answer')"
        />
    </section>
</template>
