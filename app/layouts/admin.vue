<template>
    <NuxtErrorBoundary @error="handleError">
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
                <span class="text-xs text-[var(--md-on-surface-variant)] font-medium">v{{ appVersion }}</span>
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
                <AdminNavLinks
                    :links="navLinks"
                    :active-path="route.path"
                    density="mobile"
                    @navigate="closeMobileMenu"
                />

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
                        <span>OR3 v{{ appVersion }}</span>
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
            <AdminNavLinks
                :links="navLinks"
                :active-path="route.path"
                density="desktop"
                :collapsed="isDesktopCollapsed"
            />

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
                <span v-if="!isDesktopCollapsed">OR3 v{{ appVersion }}</span>
                <span v-else>v{{ appVersion }}</span>
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
                        <UIcon :name="workspaceIcon" class="w-5 h-5 text-[var(--md-on-surface-variant)]" />
                        <div>
                            <span class="text-sm text-[var(--md-on-surface-variant)]">Working in:</span>
                            <span class="text-sm font-medium text-[var(--md-on-surface)] ml-1">{{ selectedWorkspace?.name }}</span>
                        </div>
                    </div>
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="soft"
                        :icon="refreshIcon"
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
            :important-note="confirmOptions.importantNote"
            :note-tone="confirmOptions.noteTone"
            :confirm-text="confirmOptions.confirmText"
            :danger="confirmOptions.danger"
            @confirm="onConfirm"
            @cancel="onCancel"
        />
    </div>

    <template #error="{ error, clearError }">
        <div class="flex items-center justify-center h-screen bg-[var(--md-surface)]">
            <div class="text-center max-w-md mx-auto p-8">
                <div class="mb-6">
                    <UIcon :name="warningIcon" class="w-16 h-16 mx-auto text-[var(--md-sys-color-error)]" />
                </div>
                <h1 class="text-2xl font-bold mb-4 text-[var(--md-on-surface)]">Something went wrong</h1>
                <p class="text-[var(--md-on-surface-variant)] mb-6">{{ error?.message || 'An unexpected error occurred' }}</p>
                <UButton @click="clearError" color="primary" size="lg">
                    Try again
                </UButton>
            </div>
        </div>
    </template>
</NuxtErrorBoundary>
</template>

<script setup lang="ts">
import { useAdminPages } from '~/composables/admin/useAdminPlugins';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
import { useAdminSession } from '~/composables/admin/useAdminData';
import AdminNavLinks from '~/components/admin/AdminNavLinks.vue';
import ConfirmDialog from '~/components/admin/ConfirmDialog.vue';
import WorkspaceIndicator from '~/components/admin/WorkspaceIndicator.vue';
import WorkspaceSelector from '~/components/admin/WorkspaceSelector.vue';
import { useAdminWorkspaceContext } from '~/composables/admin/useAdminWorkspaceContext';

const runtimeConfig = useRuntimeConfig();
const appVersion =
    (runtimeConfig.public as { appVersion?: string }).appVersion || '0.1.0';

const route = useRoute();
const adminPages = useAdminPages();
const { data: adminSession } = useAdminSession();
const { getMessage } = useApiError();
const { isOpen: isConfirmOpen, options: confirmOptions, onConfirm, onCancel } = useConfirmDialog();

// Mobile menu state
const isMobileMenuOpen = ref(false);

// Desktop collapse state.
// Keep SSR and initial client render deterministic, then hydrate from localStorage.
const isDesktopCollapsed = useState<boolean>('admin-sidebar-collapsed', () => false);
const isDesktopCollapseHydrated = ref(false);

onMounted(() => {
    try {
        const raw = localStorage.getItem('admin-sidebar-collapsed');
        if (raw === 'true' || raw === 'false') {
            isDesktopCollapsed.value = raw === 'true';
        }
    } catch {
        // ignore storage errors
    } finally {
        isDesktopCollapseHydrated.value = true;
    }
});

watch(isDesktopCollapsed, (collapsed) => {
    if (!isDesktopCollapseHydrated.value) return;
    try {
        localStorage.setItem('admin-sidebar-collapsed', String(collapsed));
    } catch {
        // ignore storage errors
    }
});

// Icons
const menuIcon = useIcon('ui.menu');
const closeIcon = useIcon('ui.close');
const collapseIcon = useIcon('ui.chevron.left');
const expandIcon = useIcon('ui.chevron.right');
const logoutIcon = useIcon('ui.logout');

// Nav link icons (Issue 27: Move useIcon calls to top level)
const homeIcon = useIcon('dashboard.home');
const workspacesIcon = useIcon('admin.workspaces');
const workspaceIcon = useIcon('admin.workspace');
const pluginsIcon = useIcon('dashboard.plugins');
const settingsIcon = useIcon('dashboard.settings');
const systemIcon = useIcon('ui.settings');
const refreshIcon = useIcon('ui.refresh');
const warningIcon = useIcon('ui.warning');

const toast = useToast();

const { hasWorkspace, selectedWorkspace, selectWorkspace, clearWorkspace } = useAdminWorkspaceContext();
const showWorkspaceSelector = ref(false);

interface AdminWorkspaceSelection {
    id: string;
    name: string;
    memberCount: number;
    ownerEmail?: string;
}

function openWorkspaceSelector() {
    showWorkspaceSelector.value = !showWorkspaceSelector.value;
}

function onWorkspaceSelected(workspace: AdminWorkspaceSelection) {
    selectWorkspace(workspace);
}

// Handle errors
function handleError(error: Error) {
    console.error('Admin layout error:', error);
    toast.add({
        title: 'Error',
        description: error?.message || 'An unexpected error occurred',
        color: 'error',
    });
}

// Handle logout
async function handleLogout() {
    try {
        // Clear localStorage items
        localStorage.removeItem('admin-sidebar-collapsed');
        
        // Clear workspace context (per requirements: don't persist across sessions)
        clearWorkspace();
        
        // Call server logout (this will clear httpOnly cookie server-side)
        await $fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'include' });
        
        toast.add({
            title: 'Logged out',
            description: 'You have been logged out successfully',
            color: 'success',
        });
        
        // Full page reload to clear all state
        window.location.href = '/admin/login';
    } catch (err: unknown) {
        toast.add({
            title: 'Logout failed',
            description: getMessage(err, 'An error occurred'),
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

const isSuperAdmin = computed(
    () => adminSession.value?.kind === 'super_admin'
);

const navLinks = computed<NavLink[]>(() => {
    const base: NavLink[] = [
        { label: 'Overview', to: '/admin', icon: homeIcon.value },
        { label: 'Plugins', to: '/admin/plugins', icon: pluginsIcon.value },
        { label: 'Themes', to: '/admin/themes', icon: settingsIcon.value },
        { label: 'System', to: '/admin/system', icon: systemIcon.value },
    ];

    if (isSuperAdmin.value) {
        base.splice(1, 0, {
            label: 'Workspaces',
            to: '/admin/workspaces',
            icon: workspacesIcon.value,
        });
        base.splice(2, 0, {
            label: 'Webhooks',
            to: '/admin/webhooks',
            icon: pluginsIcon.value,
        });
    }
    
    // Sort logic or visual separators could be added here
    const pluginLinks = adminPages.value.map((page) => ({
        label: page.label,
        to: `/admin/extensions/${page.path ?? page.id}`,
        icon: pluginsIcon.value,
    }));
    
    return [...base, ...pluginLinks];
});

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
