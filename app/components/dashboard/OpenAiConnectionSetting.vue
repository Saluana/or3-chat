<template>
    <section class="section-card space-y-3" aria-labelledby="openai-connection-label">
        <div class="dashboard-setting-heading">
            <span class="dashboard-setting-icon" aria-hidden="true"><UIcon name="i-lucide-key-round" class="h-5 w-5" /></span>
            <div>
                <h2 id="openai-connection-label" class="dashboard-section-title">OpenAI</h2>
                <p class="supporting-text mt-1">
                    Use OpenAI models directly with your own API key. They appear in the model picker as
                    “(OpenAI key)” and are billed to your OpenAI account.
                </p>
            </div>
        </div>
        <p class="supporting-text" role="status">{{ statusText }}</p>
        <form v-if="connection.available" class="flex flex-col gap-2 sm:flex-row" @submit.prevent="save">
            <UInput v-model="key" type="password" autocomplete="off" placeholder="sk-…" aria-label="OpenAI API key"
                class="flex-1" :disabled="busy" />
            <UButton type="submit" label="Save key" :loading="busy" :disabled="!key.trim()" />
            <UButton v-if="connection.connected" type="button" color="neutral" variant="outline" label="Remove key"
                :disabled="busy" @click="remove" />
        </form>
        <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
    </section>
</template>
<script setup lang="ts">
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
        error.value = caught instanceof Error ? caught.message : 'The OpenAI key could not be changed.';
    } finally { busy.value = false; }
}
const save = () => run(async () => { await saveKey(key.value); key.value = ''; });
const remove = () => run(removeKey);
onMounted(() => { refresh().catch((caught: unknown) => { error.value = caught instanceof Error ? caught.message : ''; }); });
</script>
