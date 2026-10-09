<script setup lang="ts">
import { computed, ref, watch, useId } from 'vue';
import { useChatProjectOwner } from '~/composables/projects/useChatProjectOwner';
import { captureProjectOperation } from '~/utils/projects/context';
import { resolveChatProject } from '~/db/project-workspace';
import { saveClassifiedProjectMemory } from '~/utils/projects/memory';
import AppModal from '~/components/ui/AppModal.vue';
const props = defineProps<{
    threadId?: string;
    messageId?: string;
    text?: string;
}>();
const remember = ref(false);
const memory = ref('');
const memoryProjectName = ref('');
const memoryFormId = useId();
const error = ref('');
const saved = ref(false);
let memoryTarget:
    | {
          scope: ReturnType<typeof captureProjectOperation>;
          projectId: string;
          threadId: string;
          messageId: string;
      }
    | undefined;
const busy = ref(false);
const projectId = useChatProjectOwner(() => props.threadId);
const canRemember = computed(() =>
    Boolean(projectId.value && props.messageId && props.text),
);
watch(
    [() => props.threadId, projectId],
    () => {
        remember.value = false;
        memoryTarget = undefined;
        saved.value = false;
        error.value = '';
    },
    { immediate: true },
);
defineExpose({ canRemember, startRemember });
async function owningProject(
    scope: ReturnType<typeof captureProjectOperation>,
    threadId?: string,
) {
    scope.assertCurrent();
    const projectId = threadId
        ? await resolveChatProject(scope.db, threadId)
        : null;
    scope.assertCurrent();
    if (!projectId) throw new Error('Add this chat to a project first.');
    return projectId;
}
async function startRemember() {
    error.value = '';
    try {
        const scope = captureProjectOperation();
        const threadId = props.threadId;
        const messageId = props.messageId;
        const text = props.text ?? '';
        if (!threadId || !messageId) throw new Error('Message unavailable.');
        const projectId = await owningProject(scope, threadId);
        const project = await scope.db.projects.get(projectId);
        scope.assertCurrent();
        if (!project || project.deleted)
            throw new Error('Project unavailable.');
        memoryProjectName.value = project.name;
        memoryTarget = { scope, projectId, threadId, messageId };
        memory.value = text.slice(0, 4000);
        saved.value = false;
        remember.value = true;
    } catch (cause) {
        error.value =
            cause instanceof Error ? cause.message : 'Project unavailable.';
    }
}
async function save() {
    busy.value = true;
    error.value = '';
    try {
        const target = memoryTarget;
        if (
            !target ||
            props.threadId !== target.threadId ||
            props.messageId !== target.messageId
        )
            throw new Error('The message changed. Review it again.');
        target.scope.assertCurrent('write');
        if (
            (await owningProject(target.scope, target.threadId)) !==
            target.projectId
        )
            throw new Error(
                'This chat changed projects. Review the memory again.',
            );
        await saveClassifiedProjectMemory(target.scope, target.projectId, {
            text: memory.value,
            source_thread_id: target.threadId,
            source_message_id: target.messageId,
        });
        saved.value = true;
        remember.value = false;
        memoryTarget = undefined;
    } catch (cause) {
        error.value =
            cause instanceof Error ? cause.message : 'Could not save memory.';
    } finally {
        busy.value = false;
    }
}
</script>
<template>
    <div
        v-if="remember || saved || error"
        class="mt-2 text-xs space-y-2"
    >
        <AppModal
            v-model:open="remember"
            title="Save project memory"
            description="Review the text before saving it to this chat’s project."
        >
            <form :id="memoryFormId" class="space-y-5" @submit.prevent="save">
                <p class="text-sm text-[var(--md-on-surface-variant)]">
                    Save to
                    <strong class="font-medium text-[var(--md-on-surface)]">{{
                        memoryProjectName
                    }}</strong>
                </p>
                <UFormField label="Review memory" name="memory">
                    <UTextarea
                        v-model="memory"
                        aria-label="Review memory"
                        variant="modal"
                        maxlength="4000"
                        required
                        class="w-full"
                        :rows="5"
                    />
                </UFormField>
                <p v-if="error" role="alert" class="text-[var(--md-error)]">
                    {{ error }}
                </p>
            </form>
            <template #footer>
                <UButton
                    label="Cancel"
                    color="neutral"
                    variant="ghost"
                    size="modal"
                    :disabled="busy"
                    @click="remember = false"
                />
                <UButton
                    type="submit"
                    :form="memoryFormId"
                    label="Save memory"
                    size="modal"
                    :loading="busy"
                    :disabled="busy || !memory.trim()"
                />
            </template>
        </AppModal>
        <p v-if="saved" role="status">Saved to project.</p>
        <p v-if="error && !remember" role="alert" class="text-red-500">
            {{ error }}
        </p>
    </div>
</template>
