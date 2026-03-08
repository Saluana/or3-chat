<template>
    <PageShell v-if="ready" :initial-thread-id="routeId" validate-initial />
    <div v-else style="display: none" />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
import { getThread } from '~/db/threads';
import { useValidatedEntityPageShell } from '~/composables/useValidatedEntityPageShell';

const { ready, routeId } = useValidatedEntityPageShell({
    loadEntity(routeId) {
        return getThread(routeId);
    },
    redirectTo: '/chat',
});
</script>
