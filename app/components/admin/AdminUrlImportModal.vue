<template>
    <UModal v-model:open="open">
        <template #content>
            <div class="p-6 space-y-4">
                <h3 class="text-lg font-semibold">Import {{ label }} from URL</h3>
                <p class="text-sm opacity-70">
                    Paste a direct link to a .zip archive. GitHub archive URLs work — e.g.:
                    <code class="text-xs break-all">https://github.com/user/repo/archive/refs/heads/main.zip</code>
                </p>
                <UInput
                    v-model="url"
                    placeholder="https://github.com/user/repo/archive/refs/heads/main.zip"
                    icon="i-heroicons-link"
                    size="md"
                    autofocus
                    :disabled="loading"
                />
                <div class="flex items-center justify-end gap-2 pt-2">
                    <UButton variant="ghost" size="sm" :disabled="loading" @click="open = false">
                        Cancel
                    </UButton>
                    <UButton
                        size="sm"
                        color="primary"
                        :loading="loading"
                        :disabled="!url.trim() || loading"
                        @click="submit"
                    >
                        Install
                    </UButton>
                </div>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
const open = defineModel<boolean>({ required: true });

const props = defineProps<{
    /** Human-readable kind label, e.g. "Plugin" or "Theme". */
    label: string;
    /** Whether an install is currently in progress. */
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: 'install', url: string): void;
}>();

const url = ref('');

function submit() {
    if (!url.value.trim()) return;
    emit('install', url.value.trim());
}

// Reset input when modal closes
watch(open, (isOpen) => {
    if (!isOpen) {
        url.value = '';
    }
});
</script>
