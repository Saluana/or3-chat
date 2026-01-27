<template>
    <div class="flex h-screen bg-[var(--md-surface)] text-[var(--md-on-surface)]">
        <!-- Skip Link for Accessibility -->
        <a 
            href="#main-content" 
            class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--md-primary)] focus:text-[var(--md-on-primary)] focus:rounded focus:shadow-lg"
        >
            Skip to main content
        </a>

        <!-- Sidebar -->
        <aside
            role="navigation"
            aria-label="Admin navigation"
            class="w-64 flex-shrink-0 border-r border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] shadow-[var(--md-elevation-1)]"
        >
            <div class="p-4 border-b border-[var(--md-outline-variant)]">
                <h1 class="text-lg font-bold">Admin</h1>
                <p class="text-xs opacity-70 mt-1">System Control</p>
            </div>
            
            <nav class="flex-1 overflow-y-auto p-2 space-y-1" aria-label="Admin pages">
                <NuxtLink
                    v-for="link in navLinks"
                    :key="link.to"
                    :to="link.to"
                    :aria-current="isActive(link.to) ? 'page' : undefined"
                    class="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-[var(--md-sys-shape-corner-small,4px)] transition-colors hover:bg-[var(--md-surface-container-highest)] focus:outline-none focus:ring-2 focus:ring-[var(--md-primary)] focus:ring-offset-2 focus:ring-offset-[var(--md-surface-container)]"
                    :class="[
                        isActive(link.to) 
                            ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]' 
                            : 'text-[var(--md-on-surface-variant)]'
                    ]"
                >
                    {{ link.label }}
                </NuxtLink>
            </nav>

            <div class="p-4 border-t border-[var(--md-outline-variant)] text-xs text-[var(--md-on-surface-variant)]" role="contentinfo">
                OR3 v1.0.0
            </div>
        </aside>

        <!-- Main Content -->
        <main 
            id="main-content"
            role="main"
            class="flex-1 overflow-y-auto bg-[var(--md-surface)]"
            tabindex="-1"
        >
            <div class="max-w-5xl mx-auto p-6 md:p-8">
                <NuxtPage />
            </div>
        </main>
    </div>
</template>

<script setup lang="ts">
import { useAdminPages } from '~/composables/admin/useAdminPlugins';
import {
    useAdminExtensions,
    useAdminSystemConfigEnriched,
    useAdminSystemStatus,
    useAdminWorkspace,
} from '~/composables/admin/useAdminData';

const route = useRoute();
const adminPages = useAdminPages();

// Warm common admin data on client to make page switches feel instant.
if (import.meta.client) {
    useAdminSystemStatus();
    useAdminWorkspace();
    useAdminExtensions();
    useAdminSystemConfigEnriched();
}

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
