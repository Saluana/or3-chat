<template>
    <PageShell v-if="ready" :initial-thread-id="routeId" validate-initial />
    <div v-else class="flex min-h-dvh items-center justify-center bg-[var(--md-surface)] text-[var(--md-on-surface-variant)]" role="status">
        Opening chat…
    </div>
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
import { getThread } from '~/db/threads';
import { useValidatedEntityPageShell } from '~/composables/useValidatedEntityPageShell';

definePageMeta({
    lockPageProtected: true,
});

const { ready, routeId } = useValidatedEntityPageShell({
    loadEntity(routeId) {
        return getThread(routeId);
    },
    redirectTo: '/chat',
});
</script>
