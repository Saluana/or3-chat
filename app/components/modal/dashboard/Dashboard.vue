<template>
    <UModal
        v-model:open="open"
        :ui="{
            footer: 'justify-end border-t-2',
            body: 'p-0!',
        }"
        title="Dashboard"
        description="Browse all apps, plugins, and settings."
        class="border-2 w-[98dvw] h-[98dvh] sm:min-w-[720px]! sm:min-h-[80dvh] sm:max-h-[80dvh] overflow-hidden"
    >
        <template #body>
            <!-- iOS style springboard grid: fixed icon cell width per breakpoint, centered, nice vertical rhythm -->
            <div
                v-if="activeView === 'dashboard'"
                class="p-4 flex justify-center"
            >
                <div
                    class="grid gap-y-6 gap-x-4 place-items-center grid-cols-4 xs:grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
                >
                    <plugin-icons
                        v-for="item in dashboardItems"
                        :key="item.id"
                        :icon="item.icon"
                        :label="item.label"
                        :size="74"
                        :retro="true"
                        :radius="3"
                        @click="onPluginClick(item)"
                    />
                </div>
            </div>
            <div v-if="activeView === 'page'">
                <div class="flex h-[40px] items-center border-b-2 pr-2">
                    <UButton
                        variant="subtle"
                        color="primary"
                        size="sm"
                        class="ml-2 text-[20px] gap-0.5 hover:bg-[var(--md-primary)]/10!"
                        @click="goBack()"
                    >
                        <UIcon
                            class="h-6 w-6"
                            :name="'pixelarticons:chevron-left'"
                        />
                    </UButton>
                    <div class="ml-2 font-semibold text-sm truncate">
                        {{ headerPluginLabel }}
                        <span v-if="activePageTitle" class="opacity-60"
                            >/ {{ activePageTitle }}</span
                        >
                    </div>
                </div>
                <!-- Landing list if multiple pages and none chosen -->
                <div
                    v-if="!activePageId && landingPages.length > 1"
                    class="p-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                >
                    <button
                        v-for="p in landingPages"
                        :key="p.id"
                        class="group flex flex-col items-start gap-2 p-3 rounded-md border-2 border-[var(--md-outline-variant)] hover:border-[var(--md-primary)] hover:bg-[var(--md-primary)]/5 transition-colors text-left"
                        @click="openPage(activePluginId!, p.id)"
                    >
                        <div class="flex items-center gap-2">
                            <UIcon
                                v-if="p.icon"
                                :name="p.icon"
                                class="w-5 h-5 opacity-80 group-hover:opacity-100"
                            />
                            <span class="font-medium text-sm">{{
                                p.title
                            }}</span>
                        </div>
                        <p
                            v-if="p.description"
                            class="text-xs opacity-70 leading-snug line-clamp-3"
                        >
                            {{ p.description }}
                        </p>
                    </button>
                </div>
                <!-- Single page or chosen page -->
                <div v-else class="p-4">
                    <div v-if="loadingPage" class="text-sm opacity-70">
                        Loading…
                    </div>
                    <component
                        v-else-if="resolvedPageComp"
                        :is="resolvedPageComp"
                    />
                    <div
                        v-else-if="!activePageId && landingPages.length === 1"
                        class="text-xs opacity-60"
                    >
                        Preparing page…
                    </div>
                    <div v-else-if="!landingPages.length" class="text-xs">
                        No pages registered for this plugin.
                    </div>
                </div>
            </div>
        </template>
    </UModal>
</template>
<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import PluginIcons from './PluginIcons.vue';
import {
    useDashboardPlugins,
    useDashboardPluginPages,
    resolveDashboardPluginPageComponent,
    listDashboardPluginPages,
} from '~/composables';

const props = defineProps<{
    showModal: boolean;
}>();

const activeView = ref<'page' | 'dashboard'>('dashboard');
const activePluginId = ref<string | null>(null);
const activePageId = ref<string | null>(null);
const loadingPage = ref(false);
const resolvedPageComp = shallowRef<any>(null);

const emit = defineEmits<{ (e: 'update:showModal', value: boolean): void }>();

// Bridge prop showModal to UModal's v-model:open (which emits update:open) by mapping update to parent event
const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

// Reactive list of registered dashboard plugins (external + future built-ins)
const registered = useDashboardPlugins();

// Core (built-in) items; can be overridden by external plugin with same id
const coreItems = [
    {
        id: 'core:settings',
        icon: 'pixelarticons:sliders',
        label: 'Settings',
        order: 1,
        handler: (item: any) => {
            // Example handler to open settings
            activeView.value = 'page';
        },
    },
    {
        id: 'core:images',
        icon: 'pixelarticons:image',
        label: 'Images',
        order: 10,
    },
    {
        id: 'core:prompts',
        icon: 'pixelarticons:script-text',
        label: 'Prompts',
        order: 20,
    },
    {
        id: 'core:files',
        icon: 'pixelarticons:folder',
        label: 'Files',
        order: 30,
    },
];

// Merge + sort (lower order first). If no registered, show core only.
const dashboardItems = computed(() => {
    const reg = registered.value;
    if (!reg.length)
        return [...coreItems].sort(
            (a, b) => (a.order ?? 200) - (b.order ?? 200)
        );
    const map = new Map<string, any>();
    for (const c of coreItems) map.set(c.id, c);
    for (const r of reg) map.set(r.id, r); // registered can override core by id
    return Array.from(map.values()).sort(
        (a, b) => (a.order ?? 200) - (b.order ?? 200)
    );
});

// Pages for the currently active plugin
const activePluginPages = useDashboardPluginPages(
    () => activePluginId.value || undefined
);

const landingPages = computed(() => activePluginPages.value);

const headerPluginLabel = computed(() => {
    if (!activePluginId.value) return 'Dashboard';
    const found = dashboardItems.value.find(
        (p: any) => p.id === activePluginId.value
    );
    return found?.label || activePluginId.value;
});
const activePageTitle = computed(() => {
    if (!activePluginId.value || !activePageId.value) return '';
    const page = listDashboardPluginPages(activePluginId.value).find(
        (p) => p.id === activePageId.value
    );
    return page?.title || activePageId.value;
});

async function openPage(pluginId: string, pageId: string) {
    loadingPage.value = true;
    activePluginId.value = pluginId;
    activePageId.value = pageId;
    activeView.value = 'page';
    try {
        const comp = await resolveDashboardPluginPageComponent(
            pluginId,
            pageId
        );
        resolvedPageComp.value = comp || null;
    } catch (e) {
        console.error('[dashboard] failed to load page', e);
        resolvedPageComp.value = null;
    } finally {
        loadingPage.value = false;
    }
}

function resetToGrid() {
    activeView.value = 'dashboard';
    activePluginId.value = null;
    activePageId.value = null;
    resolvedPageComp.value = null;
}

function goBack() {
    // If we're on the main dashboard already, nothing to do
    if (activeView.value === 'dashboard') return;
    // If inside a plugin context
    if (activeView.value === 'page' && activePluginId.value) {
        // If currently viewing a specific page, step back to landing list (if multi-page)
        if (activePageId.value) {
            const pages = listDashboardPluginPages(activePluginId.value);
            activePageId.value = null;
            resolvedPageComp.value = null;
            // If there is only one (or zero) page, there is no landing list UX -> go all the way back
            if (pages.length <= 1) {
                resetToGrid();
            }
            return;
        }
        // We are already at the landing list (no active page) -> go to dashboard grid
        resetToGrid();
        return;
    }
    // Fallback safety
    resetToGrid();
}

function onPluginClick(item: any) {
    try {
        activePluginId.value = item.id;
        activePageId.value = null;
        const pages = listDashboardPluginPages(item.id);
        if (!pages.length) {
            item.handler?.({ id: item.id });
            return;
        }
        if (pages.length === 1) {
            openPage(item.id, pages[0]!.id);
            return;
        }
        activeView.value = 'page';
    } catch (e) {
        console.error('[dashboard] plugin handler error', e);
    }
}
</script>
