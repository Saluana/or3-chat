<template>
    <div v-if="actions.length > 0">
        <h3 class="text-lg font-semibold mb-3">Provider Actions</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
                v-for="action in actions"
                :key="action.kind + ':' + action.id"
                :id="isStorageUsage(action) ? 'storage-usage' : undefined"
                class="scroll-mt-4 p-4 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)]"
            >
                <div class="flex justify-between items-start mb-2">
                    <div class="text-xs font-bold uppercase opacity-50 tracking-wider">{{ action.kind }}</div>
                    <div class="text-xs opacity-50">{{ action.provider }}</div>
                </div>

                <div class="font-medium text-base mb-1">{{ action.label }}</div>
                <div v-if="action.description" class="text-sm opacity-70 mb-4 h-10 line-clamp-2">
                    {{ action.description }}
                </div>
                <UButton
                    size="xs"
                    block
                    :color="action.danger ? 'warning' : 'primary'"
                    :variant="action.danger ? 'soft' : 'solid'"
                    :disabled="!isOwner || !!runningActionId"
                    :loading="runningActionId === action.kind + ':' + action.id"
                    @click="emit('run', action)"
                >
                    {{ isStorageUsage(action) ? 'View storage usage' : 'Run Action' }}
                </UButton>
            </div>
        </div>
        <section v-if="result" id="provider-action-result" role="status" tabindex="-1" class="mt-4 scroll-mt-4 space-y-2 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] p-4">
            <h4 class="font-medium">{{ result.label }} result</h4>
            <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{{ JSON.stringify(result.value, null, 2) }}</pre>
        </section>
    </div>
</template>

<script setup lang="ts">
interface Action {
    id: string;
    label: string;
    kind: 'auth' | 'sync' | 'storage';
    provider: string;
    danger?: boolean;
    description?: string;
}

defineProps<{
    actions: Action[];
    isOwner: boolean;
    runningActionId?: string | null;
    result?: { label: string; value: unknown } | null;
}>();

const emit = defineEmits<{
    run: [action: Action];
}>();

const isStorageUsage = (action: Action) => action.kind === 'storage' && action.id === 'storage.usage';
</script>
