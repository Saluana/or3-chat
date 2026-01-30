<template>
    <div class="flex h-screen bg-[var(--md-surface)] text-[var(--md-on-surface)] overflow-hidden">
        <!-- Workspace Selector - controlled via v-model -->
        <WorkspaceSelector
            v-model="showWorkspaceSelector"
            @select="onWorkspaceSelected"
        />

        <!-- Skip Link for Accessibility -->
        <a 
            href="#main-content" 
            class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--md-primary)] focus:text-[var(--md-on-primary)] focus:rounded focus:shadow-lg"
        >
            Skip to main content
        </a>

        <!-- Mobile Header -->
        <header
            class="fixed top-0 left-0 right-0 h-16 bg-[var(--md-surface-container)] border-b-[length:var(--md-border-width)] border-[var(--md-border-color)] flex items-center justify-between px-4 z-40 lg:hidden"
        >
            <div class="flex items-center gap-4">
                <UButton
                    variant="ghost"
                    color="neutral"
                    size="sm"
                    square
                    :icon="menuIcon"
                    @click="toggleMobileMenu"
                    aria-label="Toggle navigation menu"
                    class="theme-btn"
                />
                <div class="flex flex-col">
                    <h1 class="text-lg font-bold tracking-wide" style="font-family: 'Press Start 2P', monospace; font-size: 14px;">Admin</h1>
                    <p class="text-[11px] opacity-60 font-medium tracking-wider">System Control</p>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-[var(--md-sys-color-success,#10b981)]"></div>
                <span class="text-xs text-[var(--md-on-surface-variant)] font-medium">v1.0</span>
                <WorkspaceIndicator v-if="hasWorkspace" @click="openWorkspaceSelector" class="hidden sm:flex" />
            </div>
        </header>

        <!-- Mobile Menu Overlay -->
        <Transition
            enter-active-class="transition-opacity duration-200"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition-opacity duration-200"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
        >
            <div
                v-if="isMobileMenuOpen"
                class="fixed inset-0 bg-black/50 z-40 lg:hidden"
                @click="closeMobileMenu"
                aria-hidden="true"
            />
        </Transition>

        <!-- Mobile Sidebar Drawer -->
        <Transition
            enter-active-class="transition-transform duration-300 ease-out"
            enter-from-class="-translate-x-full"
            enter-to-class="translate-x-0"
            leave-active-class="transition-transform duration-200 ease-in"
            leave-from-class="translate-x-0"
            leave-to-class="-translate-x-full"
        >
            <aside
                v-if="isMobileMenuOpen"
                role="navigation"
                aria-label="Admin navigation"
                class="fixed top-0 left-0 bottom-0 w-72 bg-[var(--md-surface-container)] border-r border-[var(--md-outline-variant)] shadow-[var(--md-elevation-3)] z-50 lg:hidden flex flex-col"
            >
                <!-- Mobile Drawer Header -->
                <div class="p-4 border-b border-[var(--md-outline-variant)] flex items-center justify-between">
                    <div>
                        <h1 class="text-lg font-bold">Admin</h1>
                        <p class="text-xs opacity-70 mt-1">System Control</p>
                    </div>
                    <UButton
                        variant="ghost"
                        color="neutral"
                        size="sm"
                        square
                        :icon="closeIcon"
                        @click="closeMobileMenu"
                        aria-label="Close navigation menu"
                        class="theme-btn"
                    />
                </div>

                <!-- Mobile Navigation Links -->
                <nav class="flex-1 overflow-y-auto p-2 space-y-1" aria-label="Admin pages">
                    <NuxtLink
                        v-for="link in navLinks"
                        :key="link.to"
                        :to="link.to"
                        :aria-current="isActive(link.to) ? 'page' : undefined"
                        class="flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-[var(--md-sys-shape-corner-small,4px)] transition-all duration-200 hover:bg-[var(--md-primary)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--md-primary)] focus:ring-offset-2 focus:ring-offset-[var(--md-surface-container)]"
                        :class="[
                            isActive(link.to)
                                ? 'bg-[var(--md-primary)]/15 text-[var(--md-primary)] shadow-sm'
                                : 'text-[var(--md-on-surface-variant)]'
                        ]"
                        @click="closeMobileMenu"
                    >
                        <UIcon
                            v-if="link.icon"
                            :name="link.icon"
                            class="w-5 h-5 flex-shrink-0"
                            :class="isActive(link.to) ? 'text-[var(--md-primary)]' : 'opacity-70'"
                        />
                        <span class="flex-1">{{ link.label }}</span>
                        <UIcon
                            v-if="isActive(link.to)"
                            :name="activeIndicatorIcon"
                            class="w-4 h-4 opacity-60"
                        />
                    </NuxtLink>
                </nav>

                <!-- Mobile Logout -->
                <div class="p-2 border-t border-[var(--md-outline-variant)]">
                    <button
                        class="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-[var(--md-sys-shape-corner-small,4px)] transition-all duration-200 text-[var(--md-sys-color-error)] hover:bg-[var(--md-sys-color-error)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--md-sys-color-error)] focus:ring-offset-2 focus:ring-offset-[var(--md-surface-container)]"
                        @click="handleLogout"
                    >
                        <UIcon
                            :name="logoutIcon"
                            class="w-5 h-5 flex-shrink-0 opacity-70"
                        />
                        <span class="flex-1 text-left">Logout</span>
                    </button>
                </div>

                <!-- Mobile Drawer Footer -->
                <div class="p-4 border-t border-[var(--md-outline-variant)] text-xs text-[var(--md-on-surface-variant)]" role="contentinfo">
                    <div class="flex items-center justify-between">
                        <span>OR3 v1.0.0</span>
                        <div class="flex items-center gap-2">
                            <div class="w-2 h-2 rounded-full bg-[var(--md-sys-color-success,#10b981)]"></div>
                            <span class="opacity-70">Online</span>
                        </div>
                    </div>
                </div>
            </aside>
        </Transition>

        <!-- Desktop Sidebar -->
        <aside
            role="navigation"
            aria-label="Admin navigation"
            class="hidden lg:flex flex-shrink-0 flex-col border-r border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] shadow-[var(--md-elevation-1)] transition-all duration-300 ease-in-out"
            :class="isDesktopCollapsed ? 'w-20' : 'w-64'"
        >
            <!-- Desktop Sidebar Header -->
            <div class="p-4 border-b border-[var(--md-outline-variant)] flex items-center justify-between" :class="{ 'justify-center': isDesktopCollapsed }">
                <div v-if="!isDesktopCollapsed">
                    <h1 class="text-lg font-bold">Admin</h1>
                    <p class="text-xs opacity-70 mt-1">System Control</p>
                </div>
                <UButton
                    variant="ghost"
                    color="neutral"
                    size="sm"
                    square
                    :icon="isDesktopCollapsed ? expandIcon : collapseIcon"
                    @click="toggleDesktopCollapse"
                    :aria-label="isDesktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
                    class="theme-btn"
                />
            </div>

            <!-- Desktop Navigation Links -->
            <nav class="flex-1 overflow-y-auto p-2 space-y-1" aria-label="Admin pages">
                <NuxtLink
                    v-for="link in navLinks"
                    :key="link.to"
                    :to="link.to"
                    :aria-current="isActive(link.to) ? 'page' : undefined"
                    class="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-[var(--md-sys-shape-corner-small,4px)] transition-all duration-200 hover:bg-[var(--md-primary)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--md-primary)] focus:ring-offset-2 focus:ring-offset-[var(--md-surface-container)] group relative"
                    :class="[
                        isActive(link.to)
                            ? 'bg-[var(--md-primary)]/15 text-[var(--md-primary)] shadow-sm'
                            : 'text-[var(--md-on-surface-variant)]',
                        { 'justify-center': isDesktopCollapsed }
                    ]"
                >
                    <UIcon
                        v-if="link.icon"
                        :name="link.icon"
                        class="w-5 h-5 flex-shrink-0"
                        :class="isActive(link.to) ? 'text-[var(--md-primary)]' : 'opacity-70 group-hover:opacity-100'"
                    />
                    <span v-if="!isDesktopCollapsed" class="flex-1 truncate">{{ link.label }}</span>

                    <!-- Tooltip for collapsed state -->
                    <div
                        v-if="isDesktopCollapsed"
                        class="absolute left-full ml-2 px-2 py-1 bg-[var(--md-surface-container-highest)] text-[var(--md-on-surface)] text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity duration-150"
                    >
                        {{ link.label }}
                    </div>
                </NuxtLink>
            </nav>

            <!-- Desktop Logout -->
            <div class="p-2 border-t border-[var(--md-outline-variant)]">
                <button
                    class="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-[var(--md-sys-shape-corner-small,4px)] transition-all duration-200 text-[var(--md-sys-color-error)] hover:bg-[var(--md-sys-color-error)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--md-sys-color-error)] focus:ring-offset-2 focus:ring-offset-[var(--md-surface-container)] group relative"
                    :class="{ 'justify-center': isDesktopCollapsed }"
                    @click="handleLogout"
                >
                    <UIcon
                        :name="logoutIcon"
                        class="w-5 h-5 flex-shrink-0 opacity-70 group-hover:opacity-100"
                    />
                    <span v-if="!isDesktopCollapsed" class="flex-1 text-left">Logout</span>
                    <!-- Tooltip for collapsed state -->
                    <div
                        v-if="isDesktopCollapsed"
                        class="absolute left-full ml-2 px-2 py-1 bg-[var(--md-surface-container-highest)] text-[var(--md-on-surface)] text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity duration-150"
                    >
                        Logout
                    </div>
                </button>
            </div>

            <!-- Desktop Sidebar Footer -->
            <div class="p-4 border-t border-[var(--md-outline-variant)] text-xs text-[var(--md-on-surface-variant)]" role="contentinfo" :class="{ 'text-center': isDesktopCollapsed }">
                <span v-if="!isDesktopCollapsed">OR3 v1.0.0</span>
                <span v-else>v1.0</span>
            </div>
        </aside>

        <!-- Main Content -->
        <main 
            id="main-content"
            role="main"
            class="flex-1 overflow-y-auto bg-[var(--md-surface)] pt-16 lg:pt-0"
            tabindex="-1"
        >
            <!-- Workspace Indicator Banner -->
            <div
                v-if="hasWorkspace && selectedWorkspace"
                class="sticky top-0 z-10 px-4 sm:px-6 lg:px-8 py-3 bg-[var(--md-surface-container-low)] border-b border-[var(--md-outline-variant)]"
            >
                <div class="max-w-5xl mx-auto flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <UIcon name="i-heroicons-building-office" class="w-5 h-5 text-[var(--md-on-surface-variant)]" />
                        <div>
                            <span class="text-sm text-[var(--md-on-surface-variant)]">Working in:</span>
                            <span class="text-sm font-medium text-[var(--md-on-surface)] ml-1">{{ selectedWorkspace.value?.name }}</span>
                        </div>
                    </div>
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="soft"
                        icon="i-heroicons-arrow-path"
                        @click="openWorkspaceSelector"
                    >
                        Change
                    </UButton>
                </div>
            </div>
            
            <div class="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
                <NuxtPage />
            </div>
        </main>

        <!-- Global Confirm Dialog -->
        <ConfirmDialog
            v-if="confirmOptions"
            v-model="isConfirmOpen"
            :title="confirmOptions.title"
            :message="confirmOptions.message"
            :confirm-text="confirmOptions.confirmText"
            :danger="confirmOptions.danger"
            @confirm="onConfirm"
            @cancel="onCancel"
        />
    </div>
</template>

<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core';
import { useAdminPages } from '~/composables/admin/useAdminPlugins';
import {
    useAdminExtensions,
    useAdminSystemConfigEnriched,
    useAdminSystemStatus,
    useAdminWorkspace,
} from '~/composables/admin/useAdminData';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
import ConfirmDialog from '~/components/admin/ConfirmDialog.vue';
import WorkspaceIndicator from '~/components/admin/WorkspaceIndicator.vue';
import WorkspaceSelector from '~/components/admin/WorkspaceSelector.vue';
import { useAdminWorkspaceContext } from '~/composables/admin/useAdminWorkspaceContext';

const route = useRoute();
const adminPages = useAdminPages();
const { isOpen: isConfirmOpen, options: confirmOptions, onConfirm, onCancel } = useConfirmDialog();

// Mobile menu state
const isMobileMenuOpen = ref(false);

// Desktop collapse state (persisted in localStorage)
const isDesktopCollapsed = useLocalStorage('admin-sidebar-collapsed', false);

// Icons
const menuIcon = useIcon('ui.menu');
const closeIcon = useIcon('ui.close');
const collapseIcon = useIcon('ui.chevron.left');
const expandIcon = useIcon('ui.chevron.right');
const activeIndicatorIcon = useIcon('ui.check');
const logoutIcon = useIcon('ui.logout');

// Nav link icons (Issue 27: Move useIcon calls to top level)
const homeIcon = useIcon('dashboard.home');
const userIcon = useIcon('sidebar.user');
const pluginsIcon = useIcon('dashboard.plugins');
const settingsIcon = useIcon('dashboard.settings');
const systemIcon = useIcon('ui.settings');

const router = useRouter();
const toast = useToast();

const { hasWorkspace, selectedWorkspace, selectWorkspace, clearWorkspace } = useAdminWorkspaceContext();
const showWorkspaceSelector = ref(false);

function openWorkspaceSelector() {
    showWorkspaceSelector.value = !showWorkspaceSelector.value;
}

function onWorkspaceSelected(workspace: any) {
    selectWorkspace(workspace);
}

// Handle logout
async function handleLogout() {
    try {
        // Clear localStorage items
        localStorage.removeItem('admin-sidebar-collapsed');
        
        // Clear workspace context (per requirements: don't persist across sessions)
        clearWorkspace();
        
        // Call server logout
        await $fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'include' });
        
        // Force clear the cookie client-side as well
        document.cookie = 'or3_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        
        toast.add({
            title: 'Logged out',
            description: 'You have been logged out successfully',
            color: 'success',
        });
        
        // Full page reload to clear all state
        window.location.href = '/admin/login';
    } catch (err: any) {
        toast.add({
            title: 'Logout failed',
            description: err?.data?.statusMessage || 'An error occurred',
            color: 'error',
        });
    }
}

// Avoid eager admin API calls in layout to prevent unnecessary errors

interface NavLink {
    label: string;
    to: string;
    icon: string;
}

const navLinks = computed<NavLink[]>(() => {
    const base: NavLink[] = [
        { label: 'Overview', to: '/admin', icon: homeIcon.value },
        { label: 'Workspaces', to: '/admin/workspaces', icon: userIcon.value },
        { label: 'Plugins', to: '/admin/plugins', icon: pluginsIcon.value },
        { label: 'Themes', to: '/admin/themes', icon: settingsIcon.value },
        { label: 'System', to: '/admin/system', icon: systemIcon.value },
    ];
    
    // Sort logic or visual separators could be added here
    const pluginLinks = adminPages.value.map((page) => ({
        label: page.label,
        to: `/admin/extensions/${page.path ?? page.id}`,
        icon: pluginsIcon.value,
    }));
    
    return [...base, ...pluginLinks];
});

function isActive(path: string) {
    if (path === '/admin') {
        return route.path === '/admin';
    }
    return route.path.startsWith(path);
}

// Issue 29: Track whether we modified overflow to avoid conflicts
const didModifyOverflow = ref(false);

// Issue 28: Use watcher instead of direct DOM manipulation
watch(isMobileMenuOpen, (isOpen) => {
    if (import.meta.client) {
        if (isOpen && !didModifyOverflow.value) {
            document.body.style.overflow = 'hidden';
            didModifyOverflow.value = true;
        } else if (!isOpen && didModifyOverflow.value) {
            document.body.style.overflow = '';
            didModifyOverflow.value = false;
        }
    }
});

function toggleMobileMenu() {
    isMobileMenuOpen.value = !isMobileMenuOpen.value;
}

function closeMobileMenu() {
    isMobileMenuOpen.value = false;
}

function toggleDesktopCollapse() {
    isDesktopCollapsed.value = !isDesktopCollapsed.value;
}

// Close mobile menu on route change
watch(() => route.path, () => {
    closeMobileMenu();
});

// Issue 29: Cleanup only if we modified overflow
onUnmounted(() => {
    if (import.meta.client && didModifyOverflow.value) {
        document.body.style.overflow = '';
    }
});
</script>

<style scoped>
/* Smooth transitions for sidebar width changes */
aside {
    will-change: width;
}

/* Custom scrollbar for navigation */
nav::-webkit-scrollbar {
    width: 4px;
}

nav::-webkit-scrollbar-track {
    background: transparent;
}

nav::-webkit-scrollbar-thumb {
    background: var(--md-outline-variant);
    border-radius: 2px;
}

nav::-webkit-scrollbar-thumb:hover {
    background: var(--md-outline);
}

/* Ensure tooltip doesn't get cut off */
.group:hover .absolute {
    display: block;
}
</style>
