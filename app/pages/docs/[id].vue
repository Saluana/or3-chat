<template>
    <PageShell v-if="ready" :initial-document-id="routeId" validate-initial />
    <div v-else style="display: none" />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
import { getDb } from '~/db/client';
import { getDocument } from '~/db/documents';

const route = useRoute();
const routeId = computed(() => (route.params.id as string) || '');
const ready = ref(false);

onMounted(async () => {
    try {
        if (!getDb().isOpen()) await getDb().open();
        const d = await getDocument(routeId.value);
        const exists = !!(d && !d.deleted);
        if (!exists) await navigateTo('/chat', { replace: true });
        else ready.value = true;
    } catch {
        await navigateTo('/chat', { replace: true });
    }
});
</script>
