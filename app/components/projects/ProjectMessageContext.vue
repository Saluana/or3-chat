<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import {
    getDb,
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import { captureProjectOperation } from '~/utils/projects/context';
import { resolveChatProject, saveProjectMemory } from '~/db/project-workspace';
import { addProjectUpload } from '~/utils/projects/source-intake';
import { getFileBlob } from '~/db/files';
const props = defineProps<{
    threadId?: string;
    messageId?: string;
    text?: string;
    hashes?: string[];
}>();
const remember = ref(false);
const memory = ref('');
const kind = ref<'fact' | 'decision'>('fact');
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
const projectId = ref<string | null>(null);
const canRemember = computed(() =>
    Boolean(projectId.value && props.messageId && props.text),
);
let ownerSubscription: Subscription | undefined;
let ownerRevision = 0;
function bindOwner() {
    ownerSubscription?.unsubscribe();
    projectId.value = null;
    remember.value = false;
    memoryTarget = undefined;
    saved.value = false;
    error.value = '';
    const revision = ++ownerRevision;
    const db = getDb();
    const generation = getWorkspaceGeneration();
    const threadId = props.threadId;
    if (!threadId) return;
    ownerSubscription = liveQuery(() =>
        resolveChatProject(db, threadId).catch(() => null),
    ).subscribe((owner) => {
        if (
            revision === ownerRevision &&
            db === getDb() &&
            generation === getWorkspaceGeneration()
        )
            projectId.value = owner;
    });
}
watch(() => props.threadId, bindOwner, { immediate: true });
const stopWorkspace = subscribeActiveWorkspaceDb(bindOwner);
onBeforeUnmount(() => {
    ownerRevision++;
    ownerSubscription?.unsubscribe();
    stopWorkspace();
});
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
        memoryTarget = { scope, projectId, threadId, messageId };
        memory.value = text.slice(0, 4000);
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
        await saveProjectMemory(target.scope, target.projectId, {
            text: memory.value,
            kind: kind.value,
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
async function promote() {
    busy.value = true;
    error.value = '';
    try {
        const scope = captureProjectOperation();
        const projectId = await owningProject(scope, props.threadId);
        const hashes = [...(props.hashes ?? [])];
        for (const hash of hashes) {
            const blob = await getFileBlob(hash, scope.db);
            const meta = await scope.db.file_meta.get(hash);
            scope.assertCurrent();
            if (!blob || !meta) throw new Error('Attachment unavailable.');
            await addProjectUpload(
                scope,
                projectId,
                new File([blob], meta.name, { type: meta.mime_type }),
            );
        }
        saved.value = true;
    } catch (cause) {
        error.value =
            cause instanceof Error ? cause.message : 'Could not add knowledge.';
    } finally {
        busy.value = false;
    }
}
</script>
<template>
    <div
        v-if="(projectId && hashes?.length) || remember || saved || error"
        class="mt-2 text-xs space-y-2"
    >
        <div
            v-if="projectId && threadId && messageId && hashes?.length"
            class="flex gap-2"
        >
            <UButton
                v-if="hashes?.length"
                size="xs"
                color="neutral"
                variant="ghost"
                label="Add attachments to project knowledge"
                :disabled="busy"
                @click="promote"
            />
        </div>
        <UModal
            v-model:open="remember"
            title="Save project memory"
            description="Review the text before saving it to this chat’s project."
        >
            <template #body>
                <form class="space-y-2" @submit.prevent="save">
                    <label
                        >Review memory<textarea
                            v-model="memory"
                            maxlength="4000"
                            required
                            class="block w-full rounded border border-current/20 p-2 bg-transparent"
                            rows="4"
                        /></label
                    ><select v-model="kind" aria-label="Save as">
                        <option value="fact">Fact</option>
                        <option value="decision">Decision</option></select
                    ><UButton
                        type="submit"
                        label="Save memory"
                        :disabled="busy"
                    /><UButton
                        label="Cancel"
                        color="neutral"
                        variant="ghost"
                        @click="remember = false"
                    />
                    <p v-if="error" role="alert" class="text-red-500">
                        {{ error }}
                    </p>
                </form>
            </template>
        </UModal>
        <p v-if="saved" role="status">Saved to project.</p>
        <p v-if="error && !remember" role="alert" class="text-red-500">
            {{ error }}
        </p>
    </div>
</template>
