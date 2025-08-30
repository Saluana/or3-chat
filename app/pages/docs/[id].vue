<template>
    <PageShell :initial-document-id="routeId" validate-initial />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
const route = useRoute();
const routeId = (route.params.id as string) || '';
</script>
