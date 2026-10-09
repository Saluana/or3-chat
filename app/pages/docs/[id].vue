<template>
    <PageShell :initial-document-id="routeId" validate-initial />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
import { computed } from 'vue';
import { useRoute } from '#imports';

definePageMeta({
    lockPageProtected: true,
});

const route = useRoute();
const routeId = computed(() => (route.params.id as string) || '');
</script>
