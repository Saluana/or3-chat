<script setup lang="ts">
/**
 * Host surface for one contained portable plugin.
 *
 * It renders exactly what the plugin rendered (a validated declarative tree),
 * plus the plugin's status and the host-owned actions. UI events from the tree
 * are forwarded to the plugin as a request; the plugin may render again. A
 * reserved `host.*` action is handled here instead: the click authorizes a
 * write, the target is the document this surface was opened on, and replacing
 * content needs an explicit confirmation of the exact payload the host planned.
 * Nothing here executes plugin code.
 *
 * The activation has a hard containment lifetime, so it is started when this
 * surface opens, and a stopped activation can be restarted without discarding
 * the field values already typed here.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { $fetch, navigateTo, useRoute, useToast } from '#imports';
import {
    ensurePortableClientActivation,
    getPortableClientSource,
    invokePortableUiEvent,
    usePortableActivations,
} from '~/composables/plugins/portable-client-runtime';
import {
    usePortableHostActions,
    type PreparedHostAction,
} from '~/composables/plugins/usePortableHostActions';
import { getDocumentInDb } from '~/db/documents';
import { getWorkspaceDb } from '~/db/client';
import {
    HOST_ACTIONS,
    HOST_ACTION_LABELS,
    MAX_FIRST_ACTION_CONTENT_BYTES,
    isHostAction,
    isKnownHostAction,
    tipTapToText,
} from '~/utils/plugins/portable-host-actions';
import type { PortableUiNode } from '~~/shared/plugins/isolation/ui-primitives';
import type { PortableUiEvent } from '~~/shared/plugins/isolation/ui-primitives';

const props = defineProps<{ readonly pluginId: string }>();

const toast = useToast();
const route = useRoute();
const activations = usePortableActivations();
const hostActions = usePortableHostActions();
const activation = computed(() => activations.get(props.pluginId) ?? null);
const busy = ref(false);
const fieldStore = ref<Record<string, string | boolean>>({});
const treeRef = ref<{ replaceValues: (values: Record<string, string | boolean>) => void } | null>(
    null
);

/** The document this surface was opened on; the only replace target. */
const selectedDocumentId = computed(() => {
    const value = route.query.documentId;
    return typeof value === 'string' && value.length > 0 ? value : null;
});

/**
 * The last rendered tree is kept while the activation is stopped so the host
 * field store (and the user's typing) survives a containment expiry or a
 * restart. New renders replace it.
 */
const nodes = ref<readonly PortableUiNode[]>([]);
watch(
    () => activation.value?.view?.nodes ?? null,
    (next) => {
        if (next && next.length > 0) nodes.value = next;
    },
    { immediate: true }
);

/** A host action awaiting the user's confirmation (destructive writes only). */
const pendingConfirm = ref<PreparedHostAction | null>(null);
const restartBusy = ref(false);

/** The host execution lock: one write or plugin request at a time. */
const locked = computed(
    () => busy.value || pendingConfirm.value !== null || activation.value?.status !== 'active'
);

/** First action offered by the package plan, with its host-resolved context. */
interface FirstActionState {
    readonly ready: boolean;
    readonly label: string;
    readonly contextKind: 'sample' | 'selected';
    readonly reason: string | null;
}
const firstAction = ref<FirstActionState | null>(null);
const firstActionBusy = ref(false);

function describeOutcome(status: string): string {
    if (status === 'created-document') return 'Created a new document from the plugin result.';
    if (status === 'replaced-document') return 'Replaced the selected document with the plugin result.';
    return 'Opened a new chat with the chosen result.';
}

/**
 * Host-owned wording for reserved actions. A plugin label is presentation only;
 * the operation is rendered and reported under the host's canonical name.
 */
function canonicalize(nodesToRender: readonly PortableUiNode[]): readonly PortableUiNode[] {
    return nodesToRender.map((node) => {
        if (node.type === 'button' && isKnownHostAction(node.action)) {
            return { ...node, label: HOST_ACTION_LABELS[node.action] };
        }
        if (node.type === 'form' || node.type === 'stack' || node.type === 'box') {
            return {
                ...node,
                children: canonicalize(node.children as readonly PortableUiNode[]),
            } as PortableUiNode;
        }
        return node;
    });
}
const renderNodes = computed(() => canonicalize(nodes.value));

async function executePrepared(prepared: PreparedHostAction): Promise<void> {
    const result = await hostActions.execute(prepared);
    if (!result.ok) {
        toast.add({ title: 'The result was not written', description: result.message, color: 'warning' });
        return;
    }
    toast.add({ title: describeOutcome(result.outcome.status), color: 'success' });
    // Show the result: the plugin surface is where the action started, not
    // where the written content lives. Navigation is best-effort; the write
    // already succeeded and is reported above.
    try {
        if (result.outcome.threadId) {
            await navigateTo(`/chat/${result.outcome.threadId}`);
        } else if (result.outcome.documentId) {
            await navigateTo(`/docs/${result.outcome.documentId}`);
        }
    } catch {
        /* intentionally empty */
    }
}

/**
 * Prepare the exact payload the user is about to approve. A destructive action
 * opens the confirmation with that frozen plan; everything else executes it
 * immediately.
 */
async function runHostAction(action: string): Promise<void> {
    if (busy.value || pendingConfirm.value) return;
    busy.value = true;
    try {
        const prepared = await hostActions.prepare({
            pluginId: props.pluginId,
            action,
            selectedDocumentId: selectedDocumentId.value,
        });
        if (!prepared.ok) {
            toast.add({
                title: 'The result was not written',
                description: prepared.message,
                color: 'warning',
            });
            return;
        }
        if (prepared.prepared.requiresConfirmation) {
            pendingConfirm.value = prepared.prepared;
            return;
        }
        await executePrepared(prepared.prepared);
    } finally {
        busy.value = false;
    }
}

async function confirmPending(): Promise<void> {
    const prepared = pendingConfirm.value;
    if (!prepared || busy.value) return;
    pendingConfirm.value = null;
    busy.value = true;
    try {
        await executePrepared(prepared);
    } finally {
        busy.value = false;
    }
}

/**
 * Apply a plugin's field-replacement request (loading a preset, clearing the
 * selection, context replacement) through the renderer's host-approved
 * replacement path. Only rendered field ids and bounded values are accepted.
 */
function readFieldReplacement(
    response: unknown
): Record<string, string | boolean> | null {
    if (!response || typeof response !== 'object') return null;
    const envelope = response as { ok?: unknown; result?: unknown };
    if (envelope.ok !== true) return null;
    const result = envelope.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const raw = (result as { fieldValues?: unknown }).fieldValues;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const values: Record<string, string | boolean> = {};
    for (const [id, value] of Object.entries(raw)) {
        if (!id || id.length > 64) continue;
        if (typeof value === 'string') {
            if (new TextEncoder().encode(value).byteLength > 8 * 1024) continue;
            values[id] = value;
            continue;
        }
        if (typeof value === 'boolean') values[id] = value;
    }
    return Object.keys(values).length > 0 ? values : null;
}

function applyFieldReplacement(response: unknown): void {
    const next = readFieldReplacement(response);
    if (next) treeRef.value?.replaceValues(next);
}

/** Load the package plan once so the first action can be offered honestly. */
async function loadFirstAction(): Promise<void> {
    try {
        const query = selectedDocumentId.value
            ? `?documentId=${encodeURIComponent(selectedDocumentId.value)}`
            : '';
        const plan = await $fetch<{
            firstAction?: {
                label?: string;
                ready?: boolean;
                contextKind?: string;
                reason?: string;
            };
        }>(`/api/plugins/${encodeURIComponent(props.pluginId)}/setup-plan${query}`);
        const handoff = plan.firstAction;
        if (!handoff || typeof handoff.label !== 'string') {
            firstAction.value = null;
            return;
        }
        const contextKind = handoff.contextKind === 'selected' ? 'selected' : 'sample';
        firstAction.value = {
            ready: handoff.ready === true,
            label: handoff.label,
            contextKind,
            reason: typeof handoff.reason === 'string' ? handoff.reason : null,
        };
    } catch {
        firstAction.value = null;
    }
}

/**
 * Own the selection handoff: the host asks the server to resolve the authorized,
 * activation-bound selection handle, checks the activation's read authority and
 * size bound, then hands the plugin only the text it is approved to see.
 */
async function runFirstAction(): Promise<void> {
    const action = firstAction.value;
    if (!action?.ready || locked.value) return;
    const current = activation.value;
    if (!current || current.status !== 'active') return;
    firstActionBusy.value = true;
    try {
        let title = action.label;
        let content: string | null = null;
        if (action.contextKind === 'sample') {
            const sample = await $fetch<{ content?: string; label?: string }>(
                `/api/plugins/${encodeURIComponent(props.pluginId)}/sample`
            );
            content = typeof sample.content === 'string' ? sample.content : null;
            if (typeof sample.label === 'string' && sample.label.length > 0) title = sample.label;
        } else {
            if (!current.approvedGrants.includes('documents.read')) {
                toast.add({
                    title: 'No starting content',
                    description: 'This plugin has not been approved to read the selected document.',
                    color: 'warning',
                });
                return;
            }
            const resolved = await $fetch<{
                status: string;
                reason?: string;
                handle?: { handleId: string; kind: string; generation: number; contextId: string };
            }>(`/api/plugins/${encodeURIComponent(props.pluginId)}/first-action`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-or3-plugin-intent': 'plugin' },
                body: {
                    ...(selectedDocumentId.value ? { documentId: selectedDocumentId.value } : {}),
                    generation: current.generation,
                },
            });
            const handle = resolved.handle;
            if (resolved.status !== 'ready' || !handle) {
                toast.add({
                    title: 'The first action could not start',
                    description: resolved.reason ?? 'The host has no authorized selection for this plugin.',
                    color: 'warning',
                });
                return;
            }
            if (handle.kind !== 'document' || handle.generation !== current.generation) {
                toast.add({
                    title: 'The first action could not start',
                    description: 'The selection handle is not valid for this activation.',
                    color: 'error',
                });
                return;
            }
            const db = getWorkspaceDb(current.workspaceId);
            const document = await getDocumentInDb(db, handle.contextId);
            content = document ? tipTapToText(document.content) : null;
            if (document && document.title) title = document.title;
        }
        if (!content) {
            toast.add({
                title: 'No starting content',
                description: 'Select a document or use the package sample to run this action.',
                color: 'warning',
            });
            return;
        }
        if (new TextEncoder().encode(content).byteLength > MAX_FIRST_ACTION_CONTENT_BYTES) {
            toast.add({
                title: 'The selection is too large',
                description: `The selected content exceeds ${MAX_FIRST_ACTION_CONTENT_BYTES} bytes; select a smaller part.`,
                color: 'warning',
            });
            return;
        }
        const response = await invokePortableUiEvent(props.pluginId, {
            action: 'host.first-action.run',
            context: { kind: action.contextKind, title, content },
        });
        applyFieldReplacement(response);
    } catch (error) {
        toast.add({
            title: 'The first action could not start',
            description: error instanceof Error ? error.message : 'The plugin did not accept the action',
            color: 'error',
        });
    } finally {
        firstActionBusy.value = false;
    }
}

/** Restart a stopped activation without discarding the rendered field store. */
async function restartActivation(): Promise<void> {
    if (restartBusy.value) return;
    restartBusy.value = true;
    try {
        await ensurePortableClientActivation(props.pluginId);
        await loadFirstAction();
    } catch (error) {
        toast.add({
            title: 'The plugin could not restart',
            description: error instanceof Error ? error.message : 'The sandbox did not start',
            color: 'error',
        });
    } finally {
        restartBusy.value = false;
    }
}

onMounted(async () => {
    try {
        await ensurePortableClientActivation(props.pluginId);
    } catch (error) {
        if (import.meta.dev) {
            console.warn(`[portable-client-view] failed to start "${props.pluginId}"`, error);
        }
    }
    await loadFirstAction();
});

const contributions = computed(() => activation.value?.contributions ?? []);

const statusLabel = computed(() => {
    const state = activation.value;
    if (!state) return 'Not running';
    if (state.status === 'active') return 'Running';
    if (state.status === 'starting') return 'Starting';
    if (state.status === 'blocked') return 'Blocked';
    return 'Stopped';
});

const canRestart = computed(
    () => activation.value?.status === 'stopped' && getPortableClientSource(props.pluginId) !== null
);

async function forwardUiEvent(payload: PortableUiEvent): Promise<void> {
    if (payload.kind !== 'action') return;
    if (busy.value || pendingConfirm.value) return;
    // Host-reserved actions never reach the plugin as UI events: the host either
    // performs the approved write itself or reports that it cannot.
    if (isHostAction(payload.action)) {
        if (!isKnownHostAction(payload.action)) {
            toast.add({
                title: 'Unsupported host action',
                description: 'The plugin asked for an action this host does not provide.',
                color: 'error',
            });
            return;
        }
        await runHostAction(payload.action);
        return;
    }
    busy.value = true;
    try {
        const response = await invokePortableUiEvent(props.pluginId, {
            action: payload.action,
            ...(payload.formId === undefined ? {} : { formId: payload.formId }),
            values: payload.values,
        });
        applyFieldReplacement(response);
    } catch (error) {
        toast.add({
            title: 'Plugin action failed',
            description:
                error instanceof Error ? error.message : 'The plugin did not accept the action',
            color: 'error',
        });
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <div
            v-if="!activation"
            class="text-sm text-(--ui-text-muted)"
            data-testid="portable-plugin-idle"
        >
            This plugin is not running in the current workspace.
        </div>

        <UAlert
            v-else-if="activation.status === 'blocked'"
            color="warning"
            variant="subtle"
            title="This plugin cannot run here"
            :description="`${activation.blockMessage ?? 'The host blocked this package.'} (${activation.blockCode ?? 'blocked'})`"
            data-testid="portable-plugin-blocked"
        />

        <div v-else-if="activation.status === 'starting'" class="flex items-center gap-2 text-sm">
            <UIcon name="i-lucide-loader-circle" class="animate-spin" />
            <span>Starting {{ activation.version }}…</span>
        </div>

        <template v-else>
            <div class="flex items-center gap-2 text-xs text-(--ui-text-muted)">
                <UBadge color="neutral" variant="subtle">{{ statusLabel }}</UBadge>
                <span>v{{ activation.version }}</span>
                <span v-if="activation.crashed" class="text-red-500">containment violation</span>
            </div>

            <div
                v-if="activation.status === 'stopped'"
                class="rounded-lg border border-(--ui-border) p-3"
                data-testid="portable-plugin-stopped"
            >
                <p class="text-sm">
                    This plugin's contained session ended. Your typed values are kept below.
                </p>
                <UButton
                    v-if="canRestart"
                    class="mt-2"
                    size="sm"
                    :loading="restartBusy"
                    @click="restartActivation"
                >
                    Restart plugin
                </UButton>
                <p v-else class="mt-1 text-xs text-(--ui-text-muted)">
                    Re-enable the plugin in the workspace to start it again.
                </p>
            </div>

            <div
                v-if="firstAction"
                class="flex flex-wrap items-center gap-2 rounded-lg border border-(--ui-border) p-3"
                data-testid="portable-plugin-first-action"
            >
                <UButton
                    v-if="firstAction.ready"
                    size="sm"
                    :loading="firstActionBusy"
                    :disabled="locked"
                    @click="runFirstAction"
                >
                    {{ firstAction.label }}
                </UButton>
                <p class="text-xs text-(--ui-text-muted)">
                    <template v-if="firstAction.ready">
                        Runs on
                        {{ firstAction.contextKind === 'sample' ? 'the package sample' : 'the selected document' }}.
                    </template>
                    <template v-else>
                        {{ firstAction.reason ?? 'Finish setup before running the first action.' }}
                    </template>
                </p>
            </div>

            <div
                v-if="pendingConfirm"
                role="alertdialog"
                aria-modal="true"
                class="rounded-lg border border-(--ui-border) p-3"
                data-testid="portable-host-confirm"
            >
                <p class="text-sm font-medium">
                    {{ HOST_ACTION_LABELS[HOST_ACTIONS.replaceDocument] }}?
                </p>
                <p class="mt-1 text-xs text-(--ui-text-muted)">
                    This overwrites the selected document's current content with the plugin result.
                </p>
                <div class="mt-3 flex gap-2">
                    <UButton size="sm" color="error" :loading="busy" @click="confirmPending">
                        Replace
                    </UButton>
                    <UButton size="sm" variant="ghost" :disabled="busy" @click="pendingConfirm = null">
                        Cancel
                    </UButton>
                </div>
            </div>

            <PortableUiTree
                v-if="renderNodes.length > 0"
                ref="treeRef"
                :nodes="renderNodes"
                :store="fieldStore"
                :disabled="locked"
                :aria-busy="busy"
                data-testid="portable-plugin-view"
                @ui-event="forwardUiEvent"
            />
            <div v-else class="text-sm text-(--ui-text-muted)">
                The plugin has not rendered anything yet.
            </div>

            <section
                v-if="contributions.length > 0"
                class="flex flex-col gap-3"
                data-testid="portable-plugin-contributions"
            >
                <h3 class="text-sm font-medium">Dashboard cards</h3>
                <article
                    v-for="contribution in contributions"
                    :key="contribution.id"
                    class="rounded-lg border border-(--ui-border) p-3"
                    :data-testid="`portable-plugin-contribution-${contribution.id}`"
                >
                    <h4 v-if="contribution.title" class="text-sm font-medium">
                        {{ contribution.title }}
                    </h4>
                    <PortableUiTree
                        :nodes="contribution.nodes"
                        :store="fieldStore"
                        :disabled="locked"
                        @ui-event="forwardUiEvent"
                    />
                </article>
            </section>

            <details
                v-if="activation.logs.length > 0"
                class="rounded-md border border-(--ui-border) p-2 text-xs"
                data-testid="portable-plugin-logs"
            >
                <summary class="cursor-pointer">Plugin activity ({{ activation.logs.length }})</summary>
                <ul class="mt-2 flex flex-col gap-1">
                    <li v-for="(entry, index) in activation.logs" :key="index">
                        <span class="font-medium">{{ entry.level }}</span>
                        {{ entry.message }}
                    </li>
                </ul>
            </details>
        </template>
    </div>
</template>
