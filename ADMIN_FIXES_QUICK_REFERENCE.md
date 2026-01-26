# Admin Dashboard Fixes - Quick Reference

**Use this guide for rapid implementation of audit recommendations.**

---

## 🔥 Critical Fix #1: Combined API Endpoints (Performance)

### Create: `server/api/admin/themes-page.get.ts`
```typescript
import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../admin/api';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { readConfigEntries } from '../../admin/config/config-manager';

export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event);
    
    const [extensions, config] = await Promise.all([
        listInstalledExtensions(),
        readConfigEntries(['OR3_DEFAULT_THEME'])
    ]);
    
    return {
        themes: extensions.filter(i => i.kind === 'theme'),
        role: session.role,
        defaultTheme: config.find(e => e.key === 'OR3_DEFAULT_THEME')?.value ?? ''
    };
});
```

### Update: `app/pages/admin/themes.vue`
```diff
-const { data, status: extStatus, refresh: refreshExtensions } = await useLazyFetch<{ items: ExtensionItem[] }>('/api/admin/extensions');
-const { data: workspaceData, status: workspaceStatus, refresh: refreshWorkspace } = await useLazyFetch<{ role: string }>('/api/admin/workspace');
-const { data: configData, status: configStatus, refresh: refreshConfig } = await useLazyFetch<{ entries: Array<{ key: string; value: string | null }> }>(
-    '/api/admin/system/config'
-);
+const { data, status, refresh } = await useLazyFetch<{
+    themes: ExtensionItem[];
+    role: string;
+    defaultTheme: string;
+}>('/api/admin/themes-page');

-const pending = computed(() => extStatus.value === 'pending' || workspaceStatus.value === 'pending' || configStatus.value === 'pending');
+const pending = computed(() => status.value === 'pending');

-const themes = computed(() => (data.value?.items ?? []).filter((i) => i.kind === 'theme'));
-const role = computed(() => workspaceData.value?.role);
+const themes = computed(() => data.value?.themes ?? []);
+const role = computed(() => data.value?.role);
 const isOwner = computed(() => role.value === 'owner');
-const defaultTheme = computed(() => {
-    const entry = configData.value?.entries?.find((e) => e.key === 'OR3_DEFAULT_THEME');
-    return entry?.value ?? '';
-});
+const defaultTheme = computed(() => data.value?.defaultTheme ?? '');
-
-async function refresh() {
-    await Promise.all([refreshExtensions(), refreshWorkspace(), refreshConfig()]);
-}
```

### Create: `server/api/admin/plugins-page.get.ts`
```typescript
import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../admin/api';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { getEnabledPlugins } from '../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';

export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event);
    
    if (!session.workspace?.id) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace not resolved',
        });
    }
    
    const settingsStore = getWorkspaceSettingsStore(event);
    
    const [extensions, enabledPlugins] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(settingsStore, session.workspace.id)
    ]);
    
    return {
        plugins: extensions.filter(i => i.kind === 'plugin'),
        role: session.role,
        enabledPlugins
    };
});
```

### Update: `app/pages/admin/plugins.vue`
```diff
-const { data, status, refresh: refreshNuxtData } = await useLazyFetch<{ items: ExtensionItem[] }>(
-    '/api/admin/extensions'
-);
-const { data: workspaceData, refresh: refreshWorkspace } = await useLazyFetch<{
-    workspace: { id: string; name: string };
-    role: string;
-    members: Array<{ userId: string; email?: string; role: string }>;
-    enabledPlugins: string[];
-    guestAccessEnabled: boolean;
-}>('/api/admin/workspace');
+const { data, status, refresh } = await useLazyFetch<{
+    plugins: ExtensionItem[];
+    role: string;
+    enabledPlugins: string[];
+}>('/api/admin/plugins-page');

 const pending = computed(() => status.value === 'pending');
-const plugins = computed(() => (data.value?.items ?? []).filter((i) => i.kind === 'plugin'));
+const plugins = computed(() => data.value?.plugins ?? []);
 const enabledSet = ref<Set<string>>(new Set());
-const role = computed(() => workspaceData.value?.role);
+const role = computed(() => data.value?.role);
 const isOwner = computed(() => role.value === 'owner');

-watch(() => workspaceData.value, (val) => {
-    if (val?.enabledPlugins) {
-        enabledSet.value = new Set(val.enabledPlugins);
+watch(() => data.value, (val) => {
+    if (val?.enabledPlugins) {
+        enabledSet.value = new Set(val.enabledPlugins);
     }
 }, { immediate: true });
-
-async function refresh() {
-    await Promise.all([refreshNuxtData(), refreshWorkspace()]);
-}
```

---

## 🔥 Critical Fix #2: Replace Native Dialogs

### Create: `app/components/admin/ConfirmDialog.vue`
```vue
<template>
    <UModal v-model="isOpen">
        <UCard>
            <template #header>
                <h3 class="text-lg font-semibold">{{ title }}</h3>
            </template>
            
            <p class="text-sm text-[var(--md-on-surface-variant)]">
                {{ message }}
            </p>
            
            <template #footer>
                <div class="flex gap-2 justify-end">
                    <UButton 
                        color="neutral" 
                        variant="soft" 
                        @click="cancel"
                    >
                        Cancel
                    </UButton>
                    <UButton 
                        :color="danger ? 'error' : 'primary'" 
                        @click="confirm"
                    >
                        {{ confirmText }}
                    </UButton>
                </div>
            </template>
        </UCard>
    </UModal>
</template>

<script setup lang="ts">
const isOpen = defineModel<boolean>({ required: true });

defineProps<{
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
}>();

const emit = defineEmits<{
    confirm: [];
    cancel: [];
}>();

function confirm() {
    emit('confirm');
    isOpen.value = false;
}

function cancel() {
    emit('cancel');
    isOpen.value = false;
}
</script>
```

### Usage Example (in any admin page):
```vue
<template>
    <ConfirmDialog
        v-model="showUninstall"
        title="Confirm Uninstall"
        :message="`Uninstall ${pendingPlugin}? This action cannot be undone.`"
        confirm-text="Uninstall"
        danger
        @confirm="executeUninstall"
    />
    
    <UButton @click="showUninstallDialog('my-plugin')">
        Uninstall
    </UButton>
</template>

<script setup lang="ts">
const showUninstall = ref(false);
const pendingPlugin = ref('');

function showUninstallDialog(pluginId: string) {
    pendingPlugin.value = pluginId;
    showUninstall.value = true;
}

async function executeUninstall() {
    await $fetch('/api/admin/extensions/uninstall', {
        method: 'POST',
        body: { id: pendingPlugin.value, kind: 'plugin' },
        headers: { 'x-or3-admin-intent': 'admin' },
    });
    await refresh();
}
</script>
```

---

## 🎨 Fix #3: Replace Hardcoded Colors

### Global Find & Replace:

```bash
# Status indicators
bg-green-500        → bg-[var(--md-extended-color-success-color)]
bg-gray-400         → bg-[var(--md-outline)]

# Warnings
bg-amber-500/10     → bg-[var(--md-extended-color-warning-color-container)]
border-amber-500/20 → border-[var(--md-extended-color-warning-color)]
text-amber-600      → text-[var(--md-extended-color-warning-on-color-container)]
text-amber-400      → text-[var(--md-extended-color-warning-on-color-container)]

# Info boxes
bg-blue-500/10      → bg-[var(--md-primary-container)]
border-blue-500/20  → border-[var(--md-primary)]
text-blue-600       → text-[var(--md-on-primary-container)]
text-blue-400       → text-[var(--md-on-primary-container)]
```

### system.vue Group Colors:
```typescript
function getGroupColor(group: ConfigGroup): string {
    const colors: Record<ConfigGroup, string> = {
        'Auth': 'bg-[var(--md-primary)]',
        'Sync': 'bg-[var(--md-extended-color-success-color)]',
        'Storage': 'bg-[var(--md-tertiary)]',
        'UI & Branding': 'bg-[var(--md-secondary)]',
        'Features': 'bg-[var(--md-extended-color-warning-color)]',
        'Limits & Security': 'bg-[var(--md-error)]',
        'Background Processing': 'bg-[var(--md-primary-fixed-dim)]',
        'Admin': 'bg-[var(--md-outline)]',
        'External Services': 'bg-[var(--md-tertiary-fixed)]',
    };
    return colors[group] || 'bg-[var(--md-outline)]';
}
```

---

## ♿ Fix #4: Add ARIA Labels

### layouts/admin.vue:
```diff
-<nav class="flex-1 overflow-y-auto p-2 space-y-1">
+<nav class="flex-1 overflow-y-auto p-2 space-y-1" aria-label="Admin navigation">

-<aside class="w-64 flex-shrink-0 border-r border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]">
+<aside 
+    class="w-64 flex-shrink-0 border-r border-[var(--md-outline-variant)] bg-[var(--md-surface-container)]"
+    aria-label="Admin sidebar"
+>

-<main class="flex-1 overflow-y-auto bg-[var(--md-surface)]">
+<main id="main-content" class="flex-1 overflow-y-auto bg-[var(--md-surface)]" role="main">
```

### pages/admin/plugins.vue & themes.vue:
```diff
 <input
     ref="fileInput"
     type="file"
     accept=".zip"
     class="hidden"
     @change="installPlugin"
+    aria-label="Upload plugin zip file"
 />
```

---

## ♿ Fix #5: Add Skip Link

### layouts/admin.vue:
```vue
<template>
    <div class="flex h-screen bg-[var(--md-surface)] text-[var(--md-on-surface)]">
        <!-- Skip Link -->
        <a 
            href="#main-content" 
            class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--md-primary)] focus:text-[var(--md-on-primary)] focus:rounded-[var(--md-sys-shape-corner-small,4px)]"
        >
            Skip to main content
        </a>
        
        <!-- Sidebar -->
        <aside>...</aside>
        
        <!-- Main Content -->
        <main id="main-content" class="flex-1 overflow-y-auto" role="main">
            <div class="max-w-5xl mx-auto p-6 md:p-8">
                <NuxtPage />
            </div>
        </main>
    </div>
</template>
```

---

## 🎨 Fix #6: Fix Contrast Issues

### Global Pattern:
```diff
-<p class="text-sm opacity-70">Description text</p>
+<p class="text-sm text-[var(--md-on-surface-variant)]">Description text</p>

-<div class="text-xs opacity-60">Label</div>
+<div class="text-xs text-[var(--md-on-surface-variant)]">Label</div>

-<span class="opacity-50">Secondary text</span>
+<span class="text-[var(--md-on-surface-variant)]">Secondary text</span>
```

### Apply to all admin pages:
- index.vue line 7
- system.vue line 6
- workspace.vue line 6
- plugins.vue line 6
- themes.vue line 6
- All "UPPERCASE LABEL" elements

---

## 🎨 Fix #7: Add Page Transitions

### Add to all admin pages:
```vue
<template>
    <div class="space-y-6">
        <!-- Header (static) -->
        <div>
            <h2 class="text-2xl font-semibold mb-1">{{ title }}</h2>
            <p class="text-sm text-[var(--md-on-surface-variant)]">{{ subtitle }}</p>
        </div>

        <!-- Content with transition -->
        <Transition name="fade" mode="out-in">
            <div v-if="pending" key="loading" class="space-y-4">
                <!-- Loading skeleton -->
            </div>
            
            <div v-else key="content" class="space-y-6">
                <!-- Actual content -->
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
```

---

## 🎨 Fix #8: Add Elevation to Cards

### Global Pattern:
```diff
-<div class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
+<div class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] bg-[var(--md-surface-container-low)] shadow-sm">
```

### Remove borders, add shadows:
- All card components should use `shadow-sm` (MD3 Level 1)
- Hoverable cards use `hover:shadow-md` (MD3 Level 2)
- Remove `border border-[var(--md-outline-variant)]` (redundant with shadow)

---

## 🛡️ Fix #9: Improve Error Handling

### Create: `app/utils/admin/parse-error.ts`
```typescript
import { z } from 'zod';

const FetchErrorSchema = z.object({
    data: z.object({
        statusMessage: z.string().optional()
    }).optional()
});

const StandardErrorSchema = z.object({
    message: z.string()
});

export function parseErrorMessage(error: unknown, fallback = 'An error occurred'): string {
    const fetchError = FetchErrorSchema.safeParse(error);
    if (fetchError.success && fetchError.data.data?.statusMessage) {
        return fetchError.data.data.statusMessage;
    }
    
    const stdError = StandardErrorSchema.safeParse(error);
    if (stdError.success) {
        return stdError.data.message;
    }
    
    return fallback;
}
```

### Usage:
```typescript
import { parseErrorMessage } from '~/utils/admin/parse-error';

try {
    await $fetch('/api/admin/extensions/install', { ... });
} catch (error: unknown) {
    const message = parseErrorMessage(error, 'Installation failed');
    
    if (message.toLowerCase().includes('already installed')) {
        // Handle specific case
    }
    
    // Show error to user
    errorState.value = message;
}
```

---

## 🧪 Fix #10: Add Tests

### Create: `tests/admin/workspace.spec.ts`
```typescript
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkspacePage from '~/pages/admin/workspace.vue';

// Mock Nuxt composables
vi.mock('#app', () => ({
    useLazyFetch: vi.fn(() => ({
        data: ref({
            workspace: { id: 'test', name: 'Test Workspace' },
            role: 'owner',
            members: [
                { userId: 'user1', email: 'test@example.com', role: 'owner' }
            ],
            guestAccessEnabled: false
        }),
        status: ref('success'),
        refresh: vi.fn()
    })),
    definePageMeta: vi.fn()
}));

describe('Admin Workspace Page', () => {
    it('renders workspace details', () => {
        const wrapper = mount(WorkspacePage, {
            global: {
                stubs: ['UButton', 'UInput', 'USelectMenu', 'UBadge']
            }
        });
        
        expect(wrapper.text()).toContain('Test Workspace');
        expect(wrapper.text()).toContain('owner');
    });
    
    it('validates email format', async () => {
        const wrapper = mount(WorkspacePage);
        
        await wrapper.vm.newMemberId = 'invalid-email';
        await wrapper.vm.addMember();
        
        expect(wrapper.vm.newMemberError).toBe('Invalid email format');
    });
});
```

---

## 📋 Checklist for Each Admin Page

Use this checklist when updating each page:

```markdown
- [ ] Combined API endpoint (if multiple fetches)
- [ ] Replace `confirm()` with `<ConfirmDialog>`
- [ ] Replace `alert()` with toast notification
- [ ] Replace hardcoded colors with MD3 tokens
- [ ] Replace `opacity-*` with MD3 variant colors
- [ ] Add ARIA labels to inputs/nav
- [ ] Add page transition wrapper
- [ ] Add elevation to cards (`shadow-sm`)
- [ ] Add error handling with Zod
- [ ] Add form validation
- [ ] Write Vitest tests
- [ ] Test keyboard navigation
- [ ] Test with screen reader
```

---

## 🚀 Implementation Order

### Day 1: Performance
1. Create `themes-page.get.ts` + update `themes.vue`
2. Create `plugins-page.get.ts` + update `plugins.vue`
3. Test page load times (should see ~50% improvement)

### Day 2: Dialogs & Colors
1. Create `ConfirmDialog.vue` component
2. Replace all `confirm()` calls (10 instances)
3. Replace hardcoded colors (33 instances)
4. Test in light/dark modes

### Day 3: Accessibility
1. Add ARIA labels (nav, inputs, icons)
2. Add skip link
3. Fix contrast (replace `opacity-*`)
4. Test with keyboard + screen reader

### Day 4: Polish
1. Add page transitions
2. Add card elevation
3. Add form validation
4. Test UX flow

### Day 5: Testing
1. Write Vitest tests
2. Run accessibility audit (Lighthouse)
3. Measure performance metrics
4. Final QA pass

---

**End of Quick Reference**
