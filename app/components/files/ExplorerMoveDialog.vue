<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import AppModal from '~/components/ui/AppModal.vue';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
    label: string;
    folders: { id: string; path: string; disabled?: boolean }[];
    busy: boolean;
    error?: string;
    createFolder?: (name: string, parent: string | null) => Promise<string>;
}>();
const emit = defineEmits<{ move: [id: string | null] }>();
const search = ref('');
const destination = ref('');
const folderName = ref('');
const adding = ref(false);
const saving = ref(false);
const localError = ref('');
let opening = 0;
const destinationLabel = computed(() => props.folders.find(folder => folder.id === destination.value)?.path || props.label + ' root');
async function submitFolder() {
    if (!props.createFolder || saving.value || !folderName.value.trim()) return;
    saving.value = true;
    localError.value = '';
    const owner = opening;
    try {
        const created = await props.createFolder(folderName.value, destination.value || null);
        if (owner !== opening) return;
        destination.value = created;
        search.value = '';
        adding.value = false;
        folderName.value = '';
    } catch (cause) {
        if (owner !== opening) return;
        localError.value = cause instanceof Error ? cause.message : 'The folder could not be created.';
    } finally { if (owner === opening) saving.value = false; }
}
const results = computed(() => {
    const query = search.value.trim().toLocaleLowerCase();
    return props.folders.filter(folder => folder.path.toLocaleLowerCase().includes(query));
});
watch(open, value => {
    opening++;
    if (!value) return;
    saving.value = false;
    search.value = '';
    destination.value = '';
    folderName.value = '';
    localError.value = '';
    adding.value = false;
}, { flush: 'sync' });
onBeforeUnmount(() => { opening++; });
</script>

<template>
    <AppModal v-model:open="open" :title="'Move within ' + label">
        <UInput v-model="search" aria-label="Find destination folder" placeholder="Find a folder" class="w-full" size="workspace" />
        <fieldset class="mt-3 max-h-64 overflow-y-auto">
            <legend class="sr-only">Destination</legend>
            <label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-elevated">
                <input v-model="destination" type="radio" value="" class="accent-(--ui-primary)">
                {{ label }} root
            </label>
            <label v-for="folder in results" :key="folder.id" class="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-elevated">
                <input v-model="destination" :disabled="folder.disabled" type="radio" :value="folder.id" class="accent-(--ui-primary)">
                <span class="min-w-0 break-words" :class="{ 'text-muted': folder.disabled }">
                    {{ folder.path }}<span v-if="folder.disabled"> (inside selection)</span>
                </span>
            </label>
        </fieldset>
        <div v-if="createFolder" class="mt-2">
            <form v-if="adding" class="flex flex-wrap items-center gap-2" @submit.prevent="submitFolder">
                <UInput v-model="folderName" aria-label="Folder name" size="workspace" class="flex-1" />
                <UButton type="submit" size="workspace" label="Create folder" :loading="saving" :disabled="!folderName.trim()" />
            </form>
            <UButton v-else color="neutral" variant="ghost" :label="'New folder in ' + destinationLabel" size="workspace"
                :disabled="busy || folders.find(folder => folder.id === destination)?.disabled" @click="adding = true" />
        </div>
        <UAlert v-if="localError || error" role="alert" :description="localError || error" color="error" variant="soft" class="mt-3" />
        <template #footer>
            <UButton label="Cancel" size="workspace" color="neutral" variant="ghost" @click="open = false" />
            <UButton label="Move" size="workspace" :loading="busy" :disabled="adding || saving || !!folders.find(folder => folder.id === destination)?.disabled" @click="emit('move', destination || null)" />
        </template>
    </AppModal>
</template>
