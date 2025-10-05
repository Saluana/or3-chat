<template>
    <PageShell :initial-thread-id="routeId" validate-initial />
</template>
<script setup lang="ts">
import PageShell from '@shared/components/PageShell.vue';
const route = useRoute();
const routeId = (route.params.id as string) || '';
</script>
