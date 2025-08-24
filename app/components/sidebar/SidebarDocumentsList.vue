<template>
    <div class="mt-4">
        <div class="flex items-center justify-between px-1 mb-1">
            <h4 class="text-xs uppercase tracking-wide opacity-70 select-none">
                Docs
            </h4>
            <UTooltip text="New Document" :delay-duration="0">
                <UButton
                    icon="pixelarticons:note-plus"
                    size="xs"
                    variant="subtle"
                    @click="$emit('new-document')"
                />
            </UTooltip>
        </div>
        <div v-if="loading" class="text-xs opacity-60 px-1 py-2">Loading…</div>
        <div v-else-if="docs.length === 0" class="text-xs opacity-60 px-1 py-2">
            No documents
        </div>
        <div v-else class="space-y-2">
            <RetroGlassBtn
                v-for="d in docs"
                :key="d.id"
                class="w-full flex items-center justify-between text-left"
                :class="{
                    'active-element bg-primary/25': d.id === activeDocument,
                }"
                @click="$emit('select', d.id)"
            >
                <span class="truncate" :title="d.title">{{ d.title }}</span>
                <span class="text-[10px] opacity-50 ml-2">{{
                    formatTime(d.updated_at)
                }}</span>
            </RetroGlassBtn>
        </div>
    </div>
</template>
<script setup lang="ts">
import { useDocumentsList } from '~/composables/useDocumentsList';
import RetroGlassBtn from '~/components/RetroGlassBtn.vue';
const props = defineProps<{ activeDocument?: string }>();
const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'new-document'): void;
}>();
const { docs, loading } = useDocumentsList(200);
function formatTime(ts: number) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
</script>
