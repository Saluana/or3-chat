<template>
    <section class="space-y-4 rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-6" aria-label="Chat limits">
        <div>
            <h2 class="text-lg font-medium">Chat limits</h2>
            <p class="text-sm opacity-70">Bound tool rounds and generated images per response. Workspace limits can be lower than the instance limits.</p>
        </div>
        <template v-if="settings">
            <form v-if="settings.canEditInstance" class="space-y-3" @submit.prevent="save('instance')">
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField label="Instance tool iterations"><UInput v-model.number="instance.toolIterations" aria-label="Instance tool iterations" type="number" min="1" max="100" step="1" required :disabled="saving" /></UFormField>
                    <UFormField label="Instance generated images"><UInput v-model.number="instance.generatedImages" aria-label="Instance generated images" type="number" min="0" max="24" step="1" required :disabled="saving" /></UFormField>
                </div>
                <UButton type="submit" :loading="saving" :disabled="saving">Save instance chat limits</UButton>
            </form>
            <form class="space-y-3" @submit.prevent="save('workspace')">
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField label="Workspace tool iterations"><UInput v-model.number="workspace.toolIterations" aria-label="Workspace tool iterations" type="number" min="1" :max="settings.instance.toolIterations" step="1" required :disabled="saving" /></UFormField>
                    <UFormField label="Workspace generated images"><UInput v-model.number="workspace.generatedImages" aria-label="Workspace generated images" type="number" min="0" :max="settings.instance.generatedImages" step="1" required :disabled="saving" /></UFormField>
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton type="submit" :loading="saving" :disabled="saving">Save workspace chat limits</UButton>
                    <UButton type="button" color="neutral" variant="soft" :disabled="saving || !settings.workspace" @click="reset">Use instance limits</UButton>
                </div>
            </form>
            <p class="text-xs opacity-70">Set generated images to 0 to stop saving generated images. Changes apply to new responses.</p>
        </template>
        <p v-else-if="!error" role="status">Loading chat limits…</p>
        <p v-if="error" role="alert" class="text-[var(--md-error)]">{{ error }}</p>
        <p v-if="saved" role="status">{{ saved }}</p>
    </section>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { ChatLimitsSchema, type ChatLimits } from '~~/shared/chat/chat-limits';

const props = defineProps<{ workspaceId?: string }>();
type Settings = { workspaceId: string; instance: ChatLimits; workspace: ChatLimits | null; effective: ChatLimits; canEditInstance: boolean; revision?: string };
const settings = ref<Settings | null>(null);
const instance = reactive<ChatLimits>({ toolIterations: 10, generatedImages: 6 });
const workspace = reactive<ChatLimits>({ toolIterations: 10, generatedImages: 6 });
const saving = ref(false);
const error = ref('');
const saved = ref('');
async function load(id = props.workspaceId) {
    const result = await $fetch<Settings>('/api/admin/chat-limits', { query: { workspaceId: id } });
    if (props.workspaceId !== id) return;
    settings.value = result;
    Object.assign(instance, result.instance);
    Object.assign(workspace, result.effective);
}
watch(() => props.workspaceId, async id => {
    settings.value = null; error.value = ''; saved.value = '';
    try { await load(id); } catch { if (props.workspaceId === id) error.value = 'Unable to load chat limits. Refresh to retry.'; }
}, { immediate: true });
async function write(scope: 'instance' | 'workspace', limits: ChatLimits | null) {
    if (!settings.value || saving.value) return;
    const id = props.workspaceId;
    const target = settings.value.workspaceId;
    saving.value = true; saved.value = ''; error.value = '';
    try {
        await $fetch('/api/admin/chat-limits', { method: 'POST', headers: ADMIN_HEADERS,
            body: { scope, workspaceId: target, limits: limits && ChatLimitsSchema.parse(limits), ...(scope === 'instance' ? { revision: settings.value.revision } : {}) } });
        await load(id);
        if (props.workspaceId === id) saved.value = scope === 'instance' ? 'Instance chat limits saved.' : 'Workspace chat limits saved.';
    } catch { if (props.workspaceId === id) error.value = 'Could not save chat limits. Check the values and refresh if settings changed elsewhere.'; }
    finally { saving.value = false; }
}
function save(scope: 'instance' | 'workspace') { return write(scope, { ...(scope === 'instance' ? instance : workspace) }); }
function reset() { return write('workspace', null); }
</script>
