<template>
    <div v-if="projects.length" class="space-y-1">
        <h4 class="text-xs uppercase tracking-wide opacity-70 px-1 select-none">
            Projects
        </h4>
        <UTree
            v-model:expanded="internalExpanded"
            :items="treeItems"
            color="neutral"
            size="sm"
            :ui="ui"
        >
            <template #item-trailing="{ item, level }">
                <UPopover
                    :content="{
                        side: 'right',
                        align: 'start',
                        sideOffset: 6,
                    }"
                >
                    <span
                        class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                        @click.stop
                    >
                        <UIcon
                            name="pixelarticons:more-vertical"
                            class="w-4 h-4 opacity-70"
                        />
                    </span>
                    <template #content>
                        <div class="p-1 w-44 space-y-1">
                            <UButton
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="i-lucide-pencil"
                                >Rename</UButton
                            >
                            <UButton
                                color="error"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="i-lucide-trash-2"
                                >Delete</UButton
                            >
                        </div>
                    </template>
                </UPopover>
            </template>
        </UTree>
    </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from 'vue';

interface ProjectEntry {
    id: string;
    name?: string;
    kind?: string;
}
interface ProjectRow {
    id: string;
    name: string;
    data?: any;
}

const props = defineProps<{
    projects: ProjectRow[];
    expanded?: string[];
}>();

const emit = defineEmits<{
    (e: 'update:expanded', value: string[]): void;
    (e: 'chatSelected', id: string): void;
    (e: 'addChat', projectId: string): void;
}>();

// Local mirror for v-model:expanded
const internalExpanded = ref<string[]>(
    props.expanded ? [...props.expanded] : []
);
watch(
    () => props.expanded,
    (val) => {
        if (val && val !== internalExpanded.value)
            internalExpanded.value = [...val];
    }
);
watch(internalExpanded, (val) => emit('update:expanded', val));

function normalizeProjectData(p: any): ProjectEntry[] {
    const raw = p?.data;
    if (Array.isArray(raw)) return raw as ProjectEntry[];
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed as ProjectEntry[];
        } catch {
            /* ignore */
        }
    }
    return [];
}

const treeItems = computed<any[]>(() =>
    props.projects.map((p) => {
        const children = normalizeProjectData(p).map((entry) => {
            const kind = entry.kind || 'chat';
            return {
                label: entry.name || '(untitled)',
                value: entry.id,
                icon:
                    kind === 'doc'
                        ? 'pixelarticons:note-text'
                        : 'pixelarticons:chat',
                onSelect: (e: Event) => {
                    if (kind === 'chat') emit('chatSelected', entry.id);
                },
            };
        });
        return {
            label: p.name,
            value: p.id,
            defaultExpanded: false,
            children,
            onSelect: (e: Event) => e.preventDefault(),
        };
    })
);

const ui = {
    root: 'max-h-52 overflow-auto pr-1 scrollbar-hidden',
    link: 'group/addchat text-[13px] rounded-[4px] py-1',
};
</script>

<style scoped></style>
