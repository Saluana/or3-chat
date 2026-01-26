<template>
    <div class="flex h-screen bg-[var(--md-surface)] text-[var(--md-on-surface)]">
        <!-- Sidebar -->
        <aside
            class="w-64 flex-shrink-0 border-r border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
        >
            <div class="p-4 border-b border-[var(--md-outline-variant)]">
                <h1 class="text-lg font-bold">Admin</h1>
                <p class="text-xs opacity-70 mt-1">System Control</p>
            </div>
            
            <nav class="flex-1 overflow-y-auto p-2 space-y-1">
                <NuxtLink
                    v-for="link in navLinks"
                    :key="link.to"
                    :to="link.to"
                    class="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-[var(--md-sys-shape-corner-small,4px)] transition-colors hover:bg-[var(--md-surface-container-highest)]"
                    :class="[
                        isActive(link.to) 
                            ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]' 
                            : 'text-[var(--md-on-surface-variant)]'
                    ]"
                >
                    {{ link.label }}
                </NuxtLink>
            </nav>

            <div class="p-4 border-t border-[var(--md-outline-variant)] text-xs opacity-50">
                OR3 v1.0.0
            </div>
        </aside>

        <!-- Main Content -->
        <main class="flex-1 overflow-y-auto bg-[var(--md-surface)]">
            <div class="max-w-5xl mx-auto p-6 md:p-8">
                <NuxtPage />
            </div>
        </main>
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
    
    // Sort logic or visual separators could be added here
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
