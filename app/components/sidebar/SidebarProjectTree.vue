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
        />
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

const treeItems = computed(() =>
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
    link: 'text-[13px] rounded-[4px] py-1',
};
</script>

<style scoped></style>
