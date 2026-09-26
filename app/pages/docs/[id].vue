<template>
    <PageShell v-if="ready" :initial-document-id="routeId" validate-initial />
    <div v-else class="flex min-h-dvh items-center justify-center bg-[var(--md-surface)] text-[var(--md-on-surface-variant)]" role="status">
        Opening document…
    </div>
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
import { getDocument } from '~/db/documents';
import { useValidatedEntityPageShell } from '~/composables/useValidatedEntityPageShell';

definePageMeta({
    lockPageProtected: true,
});

const { ready, routeId } = useValidatedEntityPageShell({
    loadEntity(routeId) {
        return getDocument(routeId);
    },
    redirectTo: '/docs',
});
</script>
