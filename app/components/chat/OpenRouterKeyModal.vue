<template>
    <AppModal
        :open="open"
        title="Paste your OpenRouter API key"
        @update:open="emit('update:open', $event)"
    >
        <template #default>
            <div class="space-y-4">
                <p class="text-sm text-[var(--md-on-surface-variant)]">
                    {{ cloud ? 'Your key is stored securely on the server for your account and works across devices.' : 'Your key is stored in this browser (IndexedDB) and sent to OpenRouter when used.' }}
                </p>
                <UFormField
                    label="API key"
                    name="openrouter-api-key"
                    :error="errorMessage || undefined"
                >
                    <UInput
                        v-model="keyValue"
                        variant="modal"
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
            <UButton variant="ghost" size="modal" @click="onCancel">
                Cancel
            </UButton>
            <UButton
                color="primary"
                size="modal"
                :disabled="!keyValue.trim() || isSaving"
                :loading="isSaving"
                @click="onSave"
            >
                Save key
            </UButton>
        </template>
    </AppModal>
</template>

<script setup lang="ts">
import { presentError } from '~~/shared/errors';
import AppModal from '~/components/ui/AppModal.vue';
import { ref, watch } from 'vue';
import { useToast, useRuntimeConfig } from '#imports';
import { useIcon } from '~/composables/useIcon';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';
import { useSessionContext } from '~/composables/auth/useSessionContext';

const cloud = useRuntimeConfig().public.ssrAuthEnabled === true;
const session = cloud ? useSessionContext({ autoLoad: false }) : null;
const toast = useToast();
const props = defineProps<{
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

watch([() => props.open, () => {
    const account = session?.data.value?.session;
    return JSON.stringify([account?.provider, account?.user?.id]);
}], () => {
    keyValue.value = '';
    errorMessage.value = '';
}, { flush: 'sync' });

function onCancel(): void {
    keyValue.value = '';
    emit('update:open', false);
}

async function onSave(): Promise<void> {
    if (isSaving.value || !keyValue.value.trim()) return;
    errorMessage.value = '';
    isSaving.value = true;
    try {
        await persistUserApiKey(keyValue.value);
        toast.add({
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
            presentError(error, { code: 'ERR_DB_WRITE_FAILED', fallbackMessage: 'Your API key could not be saved. Please try again.' }).message;
    } finally {
        isSaving.value = false;
    }
}
</script>
