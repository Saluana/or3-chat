<template>
    <UModal
        :open="open"
        title="Paste your OpenRouter API key"
        @update:open="emit('update:open', $event)"
    >
        <template #body>
            <div class="space-y-4">
                <p class="text-sm text-[var(--md-on-surface-variant)]">
                    Your key is stored locally in this browser (IndexedDB) and
                    is only ever sent to OpenRouter. It survives reloads — you
                    only need to do this once.
                </p>
                <UFormField
                    label="API key"
                    name="openrouter-api-key"
                    :error="errorMessage || undefined"
                >
                    <UInput
                        v-model="keyValue"
                        type="password"
                        placeholder="sk-or-..."
                        :icon="iconKey"
                        class="w-full"
                        autofocus
                        @update:model-value="errorMessage = ''"
                        @keyup.enter="onSave"
                    />
                </UFormField>
                <p class="text-xs text-[var(--md-secondary)]">
                    No key yet?
                    <a
                        href="https://openrouter.ai/keys"
                        target="_blank"
                        rel="noopener"
                        class="underline hover:text-[var(--md-primary)]"
                        >Create one free at openrouter.ai/keys</a
                    >
                </p>
            </div>
        </template>
        <template #footer>
            <UButton variant="ghost" class="theme-btn" @click="onCancel">
                Cancel
            </UButton>
            <UButton
                color="primary"
                class="theme-btn"
                :disabled="!keyValue.trim() || isSaving"
                :loading="isSaving"
                @click="onSave"
            >
                Save key
            </UButton>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useToast } from '#imports';
import { useIcon } from '~/composables/useIcon';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';

defineProps<{
    open: boolean;
}>();

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
    (e: 'saved'): void;
}>();

const iconKey = useIcon('ui.lock');

const keyValue = ref('');
const errorMessage = ref('');
const isSaving = ref(false);

function onCancel(): void {
    emit('update:open', false);
}

async function onSave(): Promise<void> {
    if (isSaving.value) return;
    errorMessage.value = '';
    isSaving.value = true;
    try {
        await persistUserApiKey(keyValue.value);
        useToast().add({
            title: 'OpenRouter connected',
            description: 'Your API key was saved. You can start chatting now.',
            color: 'primary',
            duration: 4000,
        });
        keyValue.value = '';
        emit('saved');
        emit('update:open', false);
    } catch (error) {
        errorMessage.value =
            error instanceof Error
                ? error.message
                : 'Could not save that key. Please try again.';
    } finally {
        isSaving.value = false;
    }
}
</script>
