<template>
    <section class="dashboard-list-group" aria-labelledby="openai-connection-label">
        <label id="openai-connection-label" class="dashboard-list-heading" for="dashboard-openai-key">API key</label>
        <form v-if="connection.available" class="flex flex-col gap-2 sm:flex-row" @submit.prevent="save">
            <UInput id="dashboard-openai-key" v-model="key" type="password" autocomplete="off" placeholder="sk-…"
                aria-label="OpenAI API key" class="flex-1" :disabled="busy" />
            <UButton type="submit" label="Save key" :loading="busy" :disabled="!key.trim()" />
            <UButton v-if="connection.connected" type="button" color="neutral" variant="outline" label="Remove key"
                :disabled="busy" @click="remove" />
        </form>
        <p class="dashboard-list-footnote" role="status">{{ statusText }}</p>
        <p class="dashboard-list-footnote">
            Use OpenAI models directly with your own API key. They appear in the model picker as
            “(OpenAI key)” and are billed to your OpenAI account.
        </p>
        <p v-if="error" class="dashboard-list-footnote text-error" role="alert">{{ error }}</p>
    </section>
</template>
<script setup lang="ts">
import { presentError } from '~~/shared/errors';
import { computed, onMounted, ref } from 'vue';
import { useOpenAiKey } from '~/core/auth/useOpenAiKey';
import { useModelStore } from '~/composables/chat/useModelStore';

const { connection, refresh, save: saveKey, remove: removeKey } = useOpenAiKey();
const { refreshModels } = useModelStore();
const key = ref('');
const busy = ref(false);
const error = ref('');
const statusText = computed(() => connection.connected ? 'Your OpenAI key is saved.'
    : connection.instance ? 'Using this server’s OpenAI key. Save your own key to use it instead.'
    : connection.available ? 'No OpenAI key saved.' : 'Personal keys are unavailable on this server.');

async function run(action: () => Promise<void>) {
    busy.value = true;
    error.value = '';
    try {
        await action();
        // The picker gains or loses the OpenAI models.
        await refreshModels().catch(() => undefined);
    } catch (caught) {
        error.value = presentError(caught, { fallbackMessage: 'The OpenAI key could not be changed.' }).message;
    } finally { busy.value = false; }
}
const save = () => run(async () => { await saveKey(key.value); key.value = ''; });
const remove = () => run(removeKey);
onMounted(() => { refresh().catch((caught: unknown) => { error.value = presentError(caught, { fallbackMessage: 'Could not check your OpenAI connection. Please try again.' }).message; }); });
</script>
