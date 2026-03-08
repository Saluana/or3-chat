<template>
    <PageShell v-if="ready" :initial-document-id="routeId" validate-initial />
    <div v-else style="display: none" />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
import { getDocument } from '~/db/documents';
import { useValidatedEntityPageShell } from '~/composables/useValidatedEntityPageShell';

const { ready, routeId } = useValidatedEntityPageShell({
    loadEntity(routeId) {
        return getDocument(routeId);
    },
    redirectTo: '/docs',
});
</script>
