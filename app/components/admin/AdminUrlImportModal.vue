<template>
    <AppModal v-model:open="open" :title="`Import ${label} from a link`">
        <template #default>
            <div class="space-y-4">
                <p class="text-sm opacity-70">
                    Paste the download link for a .zip file from a publisher you trust.
                </p>
                <div
                    v-if="codeTrustWarning"
                    class="p-3 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)]"
                >
                    <div class="text-sm font-semibold">Only install from sources you trust</div>
                    <div class="text-sm opacity-80 mt-1">
                        This file may contain code that runs as part of OR3, with access to your server and its data.
                    </div>
                </div>
                <UInput
                    v-model="url"
                    placeholder="https://github.com/user/repo/archive/refs/heads/main.zip"
                    icon="i-heroicons-link"
                    size="md"
                    variant="modal"
                    autofocus
                    :disabled="loading"
                    :aria-label="`${label} download link`"
                    :aria-invalid="Boolean(error)"
                    :aria-describedby="error ? errorId : undefined"
                    class="w-full"
                    @update:model-value="error = ''"
                    @keydown.enter.prevent="submit"
                />
                <p v-if="error" :id="errorId" role="alert" class="text-sm text-[var(--md-error)]">{{ error }}</p>
            </div>
        </template>
        <template #footer>
            <UButton variant="ghost" size="modal" :disabled="loading" @click="open = false">
                Cancel
            </UButton>
            <UButton
                size="modal"
                color="primary"
                :loading="loading"
                :disabled="!url.trim() || loading"
                @click="submit"
            >
                Install
            </UButton>
        </template>
    </AppModal>
</template>

<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
const open = defineModel<boolean>({ required: true });

const props = defineProps<{
    /** Human-readable kind label, e.g. "Plugin" or "Theme". */
    label: string;
    /** Whether an install is currently in progress. */
    loading: boolean;
    /** Show the trusted-code warning for source installs. */
    codeTrustWarning?: boolean;
}>();

const emit = defineEmits<{
    (e: 'install', url: string): void;
}>();

const url = ref('');
const error = ref('');
const errorId = useId();

function submit() {
    if (!url.value.trim() || props.loading) return;
    try {
        const parsed = new URL(url.value.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
    } catch {
        error.value = 'Enter a complete http:// or https:// link to a .zip download.';
        return;
    }
    emit('install', url.value.trim());
}

// Reset input when modal closes
watch(open, (isOpen) => {
    if (!isOpen) {
        url.value = '';
        error.value = '';
    }
});
</script>
