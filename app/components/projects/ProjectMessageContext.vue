<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import {
    getDb,
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import {
    ProjectContextReceiptSchema,
    ProjectContextIterationSchema,
} from '~~/shared/projects/workspace';
import { captureProjectOperation } from '~/utils/projects/context';
import { resolveChatProject, saveProjectMemory } from '~/db/project-workspace';
import { addProjectUpload } from '~/utils/projects/source-intake';
import { getFileBlob } from '~/db/files';
const props = defineProps<{
    receipt?: unknown;
    iterations?: unknown;
    threadId?: string;
    messageId?: string;
    text?: string;
    hashes?: string[];
}>();
const receipt = computed(() => {
    const parsed = ProjectContextReceiptSchema.safeParse(props.receipt);
    return parsed.success ? parsed.data : null;
});
const iterations = computed(() =>
    Array.isArray(props.iterations)
        ? props.iterations.flatMap((value) => {
              const parsed = ProjectContextIterationSchema.safeParse(value);
              return parsed.success ? [parsed.data] : [];
          })
        : [],
);
const selectedIteration = ref(-1);
const inspectedSources = computed(() => {
    if (!receipt.value || selectedIteration.value < 0)
        return receipt.value?.sources ?? [];
    const states = new Map<string, { revision: string; state: string }>();
    for (const iteration of iterations.value.slice(
        0,
        selectedIteration.value + 1,
    ))
        for (const source of iteration.source_changes)
            states.set(source.id, source);
    return receipt.value.sources.map((source) => ({
        ...source,
        ...states.get(source.id),
        state:
            states.get(source.id)?.state ??
            (source.id.startsWith('tool-') ? 'Not yet retrieved' : 'available'),
    }));
});
const inspectedChats = computed(() => {
    if (!receipt.value || selectedIteration.value < 0)
        return receipt.value?.chats ?? [];
    const states = new Map<string, string>();
    for (const iteration of iterations.value.slice(
        0,
        selectedIteration.value + 1,
    ))
        for (const chat of iteration.chat_changes)
            states.set(chat.id, chat.state);
    return (receipt.value.chats ?? []).map((chat) => ({
        ...chat,
        state: states.get(chat.message_id) ?? 'Not yet retrieved',
    }));
});
const open = ref(false);
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
        v-if="
            receipt ||
            (projectId && hashes?.length) ||
            remember ||
            saved ||
            error
        "
        class="mt-2 text-xs space-y-2"
    >
        <button
            v-if="receipt"
            class="opacity-70 underline underline-offset-4"
            :aria-expanded="open"
            @click="open = !open"
        >
            Context ·
            {{ receipt.sources.filter((s) => s.state === 'included').length }}
            sources ·
            {{ receipt.memories.filter((m) => m.kind === 'decision').length }}
            saved decisions
        </button>
        <details
            v-if="open && receipt"
            open
            class="rounded border border-current/15 p-3 text-sm"
        >
            <summary>{{ receipt.project_name }} · Context used</summary>
            <label v-if="iterations.length > 1" class="block mt-2"
                >Provider request<select
                    v-model="selectedIteration"
                    class="block rounded border border-current/20 p-2 bg-transparent"
                >
                    <option :value="-1">Latest request</option>
                    <option
                        v-for="(_, index) in iterations"
                        :key="index"
                        :value="index"
                    >
                        Request {{ index + 1 }}
                    </option>
                </select></label
            >
            <h3 class="mt-2 font-semibold">Instructions included</h3>
            <pre class="whitespace-pre-wrap">{{
                receipt.instructions || 'None'
            }}</pre>
            <h3 class="mt-2 font-semibold">Project brief</h3>
            <p class="whitespace-pre-wrap">{{ receipt.brief || 'None' }}</p>
            <h3 class="mt-2 font-semibold">Memories included</h3>
            <p
                v-for="item in receipt.memories"
                :key="item.id"
                class="whitespace-pre-wrap"
            >
                {{ item.kind }}: {{ item.text }}
            </p>
            <h3 class="mt-2 font-semibold">Previous chats</h3>
            <p v-for="chat in inspectedChats" :key="chat.message_id">
                {{ chat.state }} · {{ chat.thread_id }} · {{ chat.text }}
            </p>
            <p class="opacity-60">
                Text previews show the latest request. Request history records
                source IDs, revisions, and inclusion states; inclusion does not
                prove the model relied on a source.
            </p>
            <h3 class="mt-2 font-semibold">Sources</h3>
            <div
                v-for="source in inspectedSources"
                :key="source.id"
                class="mt-2"
            >
                <p>
                    {{ source.title }} · {{ source.state
                    }}{{ source.image ? ' · Image' : '' }} · {{ source.reason }}
                </p>
                <p class="opacity-60">Revision {{ source.revision }}</p>
                <pre
                    v-if="source.excerpt"
                    class="whitespace-pre-wrap max-h-40 overflow-auto"
                    >{{ source.excerpt }}</pre
                >
            </div>
        </details>
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
