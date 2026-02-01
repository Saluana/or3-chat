<template>
    <ClientOnly>
        <div class="flex items-center justify-center min-h-[50vh]">
            <div class="text-center">
                <UIcon name="i-heroicons-arrow-path" class="w-12 h-12 mx-auto mb-4 animate-spin opacity-50" />
                <p class="text-lg opacity-70">Redirecting to new admin dashboard...</p>
            </div>
        </div>
    </ClientOnly>
</template>

<script setup lang="ts">
/**
 * @deprecated This page has been replaced by /admin/workspaces
 * This file redirects to the new admin dashboard.
 */
definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const router = useRouter();

onMounted(() => {
    // Redirect to the new workspaces list page
    router.replace('/admin/workspaces');
});
</script>
