<template>
    <div class="space-y-4">
        <UCard v-if="pageDef">
            <template #header>
                <h2 class="text-lg font-semibold">{{ pageDef.label }}</h2>
            </template>
            <component :is="resolvedComponent" v-if="resolvedComponent" />
            <div v-else class="text-sm opacity-70">Loading...</div>
        </UCard>
        <UCard v-else>
            <template #header>
                <h2 class="text-lg font-semibold">Admin Extension</h2>
            </template>
            <div class="text-sm opacity-70">Extension page not found.</div>
        </UCard>
    </div>
</template>

<script setup lang="ts">
import {
    useAdminPages,
    resolveAdminComponent,
} from '~/composables/admin/useAdminPlugins';

definePageMeta({
    layout: 'admin',
});

const route = useRoute();
const pages = useAdminPages();

const pageDef = computed(() => {
    const slug = route.params.id as string;
    return pages.value.find((page) => page.path === slug || page.id === slug);
});

const resolvedComponent = computed(() => {
    if (!pageDef.value) return null;
    return resolveAdminComponent(pageDef.value);
});
</script>
