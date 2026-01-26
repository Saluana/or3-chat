<template>
    <div class="min-h-screen bg-[var(--md-surface)] text-[var(--md-on-surface)]">
        <div class="max-w-6xl mx-auto px-6 py-6">
            <header class="mb-6 space-y-3">
                <div>
                    <h1 class="text-xl font-semibold">Admin Dashboard</h1>
                    <p class="text-sm opacity-70">
                        SSR-only control plane for this deployment.
                    </p>
                </div>
                <nav class="flex flex-wrap items-center gap-2">
                    <UButton
                        v-for="link in navLinks"
                        :key="link.to"
              
                        :variant="isActive(link.to) ? 'solid' : 'soft'"
                        :color="isActive(link.to) ? 'primary' : 'neutral'"
                        :to="link.to"
                    >
                        {{ link.label }}
                    </UButton>
                </nav>
            </header>
            <main>
                <NuxtPage />
            </main>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useAdminPages } from '~/composables/admin/useAdminPlugins';

const route = useRoute();
const adminPages = useAdminPages();

const navLinks = computed(() => {
    const base = [
        { label: 'Overview', to: '/admin' },
        { label: 'Workspace', to: '/admin/workspace' },
        { label: 'Plugins', to: '/admin/plugins' },
        { label: 'Themes', to: '/admin/themes' },
        { label: 'System', to: '/admin/system' },
    ];
    const pluginLinks = adminPages.value.map((page) => ({
        label: page.label,
        to: `/admin/extensions/${page.path ?? page.id}`,
    }));
    return [...base, ...pluginLinks];
});

function isActive(path: string) {
    if (path === '/admin') {
        return route.path === '/admin';
    }
    return route.path.startsWith(path);
}
</script>
