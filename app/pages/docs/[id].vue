<template>
    <PageShell v-if="ready" :initial-document-id="routeId" validate-initial />
    <div v-else style="display: none" />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
import { db } from '~/db/client';
import { getDocument } from '~/db/documents';

const route = useRoute();
const routeId = computed(() => (route.params.id as string) || '');
const ready = ref(false);

onMounted(async () => {
    try {
        if (!db.isOpen()) await db.open();
        const d = await getDocument(routeId.value);
        const exists = !!(d && !(d as any).deleted);
        if (!exists) await navigateTo('/chat', { replace: true });
        else ready.value = true;
    } catch {
        await navigateTo('/chat', { replace: true });
    }
});

if (import.meta.dev) {
    console.log('[docs/[id].vue] mounted with routeId:', routeId.value);
}
</script>
