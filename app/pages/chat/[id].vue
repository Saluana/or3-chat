<template>
    <PageShell :initial-thread-id="routeId" validate-initial />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
const route = useRoute();
const routeId = computed(() => (route.params.id as string) || '');
if (import.meta.dev) {
    console.log('[chat/[id].vue] mounted with routeId:', routeId.value);
}
</script>
