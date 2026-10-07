<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getDb } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';
const db = getDb();
const key = ref('');
const saving = ref(false);
const status = ref('');
onMounted(async () => {
    key.value = (await getKvByName('example:map:google-embed-key', db))?.value ?? '';
});
async function save() {
    saving.value = true;
    try {
        await setKvByName('example:map:google-embed-key', key.value.trim(), db);
        status.value = 'Saved. Reopen a map card to apply.';
    } catch {
        status.value = 'Could not save the key.';
    } finally {
        saving.value = false;
    }
}
</script>
<template>
    <UCard>
        <p class="mb-3">
            Maps use OpenStreetMap by default. Save an optional Google Maps Embed API
            key here.
        </p>
        <form class="flex flex-col gap-3" @submit.prevent="save">
            <label for="map-embed-key">Google Maps Embed API key</label>
            <UInput
                id="map-embed-key"
                v-model="key"
                type="password"
                autocomplete="off"
            />
            <UButton type="submit" :loading="saving">Save map settings</UButton>
            <p role="status">{{ status }}</p>
        </form>
    </UCard>
</template>
