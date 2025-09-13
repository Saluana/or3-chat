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
                <div class="flex h-[40px] items-center border-b-2">
                    <UButton
                        variant="subtle"
                        color="primary"
                        size="sm"
                        class="ml-2 text-[20px] gap-0.5 hover:bg-[var(--md-primary)]/10!"
                        @click="activeView = 'dashboard'"
                        ><UIcon
                            class="h-6 w-6"
                            :name="'pixelarticons:chevron-left'"
                    /></UButton>
                </div>
            </div>
        </template>
    </UModal>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import PluginIcons from './PluginIcons.vue';
import { useDashboardPlugins } from '~/composables';

const props = defineProps<{
    showModal: boolean;
}>();

const activeView = ref<'page' | 'dashboard'>('dashboard');

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

function onPluginClick(item: any) {
    try {
        item.handler?.({ id: item.id });
    } catch (e) {
        console.error('[dashboard] plugin handler error', e);
    }
}
</script>
