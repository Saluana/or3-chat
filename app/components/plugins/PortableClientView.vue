<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PortableUiTree from './PortableUiTree.vue';
import { openPortablePane } from '~/composables/plugins/portable-pane';
import { $fetch, navigateTo, useRoute, useToast } from '#imports';
import {
    ensurePortableClientActivation,
    getPortableClientSource,
    getPortableClientDraft,
    invokePortableUiEvent,
    schedulePortableClientRecovery,
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

const props = defineProps<{ readonly pluginId: string; readonly surface?: 'sidebar' | 'pane' }>();

/**
 * Recovery of a stopped activation is centralized in the runtime: a rolling
 * attempt budget shared by every surface, an allowlist of transient stop codes,
 * and one restart timer per plugin/workspace. Refusals that only the user can
 * clear (disabled, uninstalled, access, containment) are left to the explicit
 * restart action instead of looking like ordinary transient failures.
 */

const toast = useToast();
const route = useRoute();
const activations = usePortableActivations();
const hostActions = usePortableHostActions();
const activation = computed(() => activations.get(props.pluginId) ?? null);
const busy = ref(false);

/** Draft ownership follows the runtime source rather than the mounted view. */
const emptyDraft = { values: {}, dirty: new Set<string>() };
const fieldDraft = computed(() => {
    const workspaceId = getPortableClientSource(props.pluginId)?.workspaceId ?? activation.value?.workspaceId;
    return workspaceId
        ? getPortableClientDraft(props.pluginId, workspaceId, props.surface ?? 'default')
        : emptyDraft;
});
const fieldStore = computed(() => fieldDraft.value.values);
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
const surfaceNodes = computed(() => {
    const view = activation.value?.view;
    return props.surface === 'sidebar' && view?.navigation?.length
        ? view.navigation
        : view?.nodes ?? [];
});
watch(
    () => {
        const source = getPortableClientSource(props.pluginId);
        return source ? `${source.workspaceId}:${source.descriptor.descriptorKey}` : null;
    },
    async (next, previous) => {
        if (next === previous) return;
        nodes.value = [];
        pendingConfirm.value = null;
        if (next) {
            try {
                await ensurePortableClientActivation(props.pluginId);
                nodes.value = surfaceNodes.value;
            } catch (error) {
                toast.add({
                    title: 'The plugin could not start',
                    description: error instanceof Error ? error.message : 'The sandbox did not start',
                    color: 'error',
                });
            }
        }
    },
    { flush: 'post' }
);
watch(
    () => activation.value?.view ? surfaceNodes.value : null,
    (next) => {
        if (next) nodes.value = next;
    },
    { immediate: true }
);

/** A host action awaiting the user's confirmation (destructive writes only). */
const pendingConfirm = ref<PreparedHostAction | null>(null);
/**
 * The host dialog primitive owns focus containment, Escape dismissal and focus
 * restoration; closing it (including Escape) cancels the pending write. While
 * the confirmed write is running the dialog cannot be dismissed.
 */
const confirmOpen = computed({
    get: () => pendingConfirm.value !== null,
    set: (open: boolean) => {
        if (!open && !busy.value) pendingConfirm.value = null;
    },
});
/** Initial focus lands on the safe action, not on the destructive one. */
const cancelConfirmButton = ref<{ $el?: HTMLElement } | null>(null);

function focusCancelAction(event: Event): void {
    const element = cancelConfirmButton.value?.$el;
    if (!element) return;
    event.preventDefault();
    element.focus();
}
const restartBusy = ref(false);
const recovering = ref(false);
const pluginName = computed(() => getPortableClientSource(props.pluginId)?.descriptor.name ?? 'the app');
const stoppedMessage = computed(() => {
    if (activation.value?.blockCode === 'activation-time-limit') {
        return `Couldn't reconnect to ${pluginName.value}. Your typed values are still here.`;
    }
    return activation.value?.blockMessage ?? `${pluginName.value} stopped unexpectedly. Your typed values are still here.`;
});
const blockedMessage = computed(() => {
    if (['activation-unavailable', 'activation-invalid-response'].includes(activation.value?.blockCode ?? '')) {
        return `Couldn't reconnect to ${pluginName.value}. Please try again.`;
    }
    return activation.value?.blockMessage ?? `${pluginName.value} could not open in this workspace.`;
});

/** The host execution lock: one write or plugin request at a time. */
const locked = computed(
    () => busy.value || firstActionBusy.value || pendingConfirm.value !== null || activation.value?.status !== 'active'
);

/** First action offered by the package plan, with its host-resolved context. */
interface FirstActionState {
    readonly ready: boolean;
    readonly label: string;
    readonly contextKind: 'sample' | 'selected';
    readonly reason: string | null;
    readonly reasonCode?: string;
}
const firstAction = ref<FirstActionState | null>(null);
const firstActionBusy = ref(false);
/**
 * Unmount cancels an in-flight first-action handoff: the async reads above
 * check this after every await, so unmounting never delivers authorized
 * content to a later activation.
 */
let firstActionCancelled = false;

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
    if (locked.value) return;
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
                reasonCode?: string;
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
            reasonCode: handoff.reasonCode,
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
    // Immutable identity that authorized this content read. Every
    // content-producing await re-checks it, and the final handoff re-checks it
    // again inside invokePortableUiEvent; a workspace change or package
    // replacement aborts the handoff instead of delivering old content to the
    // new runtime. The aborted action is never retried automatically.
    const expected = {
        workspaceId: current.workspaceId,
        packageDigest: current.packageDigest,
        generation: current.generation,
    } as const;
    const stillExpected = (): boolean => {
        if (firstActionCancelled) return false;
        const live = activation.value;
        return (
            !!live &&
            live.status === 'active' &&
            live.workspaceId === expected.workspaceId &&
            live.packageDigest === expected.packageDigest &&
            live.generation === expected.generation
        );
    };
    firstActionBusy.value = true;
    try {
        let title = action.label;
        let content: string | null = null;
        if (action.contextKind === 'sample') {
            const sample = await $fetch<{ content?: string; label?: string }>(
                `/api/plugins/${encodeURIComponent(props.pluginId)}/sample`
            );
            if (!stillExpected()) return;
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
            if (!stillExpected()) return;
            const handle = resolved.handle;
            if (resolved.status !== 'ready' || !handle) {
                toast.add({
                    title: 'The first action could not start',
                    description: resolved.reason ?? 'The host has no authorized selection for this plugin.',
                    color: 'warning',
                });
                return;
            }
            if (handle.kind !== 'document' || handle.generation !== expected.generation) {
                toast.add({
                    title: 'The first action could not start',
                    description: 'The selection handle is not valid for this activation.',
                    color: 'error',
                });
                return;
            }
            const db = getWorkspaceDb(expected.workspaceId);
            const document = await getDocumentInDb(db, handle.contextId);
            if (!stillExpected()) return;
            content = document && !document.deleted ? tipTapToText(document.content) : null;
            if (document && document.title) title = document.title;
        }
        if (!stillExpected()) return;
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
        const response = await invokePortableUiEvent(
            props.pluginId,
            {
                action: 'host.first-action.run',
                context: { kind: action.contextKind, title, content },
            },
            expected
        );
        if (!stillExpected()) return;
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

/** Explicitly restart the sandbox, including an active session with no view. */
async function restartActivation(): Promise<void> {
    if (restartBusy.value) return;
    restartBusy.value = true;
    try {
        const source = getPortableClientSource(props.pluginId);
        if (!source) throw new Error('This plugin is not available in the current workspace.');
        const { restartPortableClient } = await import('~/composables/plugins/portable-client-runtime');
        const restarted = await restartPortableClient(props.pluginId);
        if (restarted.status !== 'active') {
            throw new Error(restarted.blockMessage ?? 'The plugin could not start.');
        }
        nodes.value = surfaceNodes.value;
        await loadFirstAction();
    } catch (error) {
        toast.add({
            title: `Couldn't open ${pluginName.value}`,
            description: error instanceof Error ? error.message : 'Please try again.',
            color: 'error',
        });
    } finally {
        restartBusy.value = false;
    }
}

/**
 * Offer a stopped activation to the runtime's centralized recovery: the
 * runtime owns the stop-code allowlist, the rolling attempt budget and the
 * restart timer, so simultaneous surfaces cannot race duplicate restarts and a
 * successful restart cannot reset the budget.
 */
watch(
    () => [activation.value?.status, activation.value?.blockCode] as const,
    ([status]) => {
        recovering.value = status === 'stopped' && schedulePortableClientRecovery(props.pluginId);
    },
    { immediate: true }
);

onBeforeUnmount(() => {
    firstActionCancelled = true;
});

onMounted(async () => {
    // A stopped activation is left to the recovery watcher above: it restarts
    // with a backoff instead of racing a second start on mount.
    if (activation.value === null) {
        try {
            await ensurePortableClientActivation(props.pluginId);
        } catch (error) {
            if (import.meta.dev) {
                console.warn(`[portable-client-view] failed to start "${props.pluginId}"`, error);
            }
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
    () => (activation.value?.status === 'stopped' ||
        ['activation-unavailable', 'activation-invalid-response'].includes(activation.value?.blockCode ?? '')) && getPortableClientSource(props.pluginId) !== null
);

/**
 * Host-owned navigation for the `open-document` primitive: the plugin names a
 * document, and the host verifies the live activation, its read authority and
 * the document's presence in that activation's workspace before navigating.
 * The document is opened by the host; the plugin never navigates itself.
 */
async function openHostDocument(documentId: string): Promise<void> {
    const state = activation.value;
    if (!state || state.status !== 'active') {
        toast.add({
            title: 'The document could not be opened',
            description: 'The plugin is not running.',
            color: 'warning',
        });
        return;
    }
    if (!state.approvedGrants.includes('documents.read')) {
        toast.add({
            title: 'The document could not be opened',
            description: 'This plugin has not been approved to read documents.',
            color: 'warning',
        });
        return;
    }
    if (locked.value) return;
    const expected = { workspaceId: state.workspaceId, generation: state.generation, packageDigest: state.packageDigest };
    busy.value = true;
    try {
        const document = await getDocumentInDb(
            getWorkspaceDb(state.workspaceId),
            documentId
        );
        const live = activation.value;
        if (
            firstActionCancelled ||
            !live ||
            live.status !== 'active' ||
            live.workspaceId !== expected.workspaceId ||
            live.generation !== expected.generation ||
            live.packageDigest !== expected.packageDigest ||
            !live.approvedGrants.includes('documents.read')
        ) {
            return;
        }
        if (!document || document.deleted) {
            toast.add({
                title: 'The document could not be opened',
                description: 'It is not in this workspace.',
                color: 'warning',
            });
            return;
        }
        await navigateTo(`/docs/${encodeURIComponent(documentId)}`);
    } catch (error) {
        toast.add({
            title: 'The document could not be opened',
            description:
                error instanceof Error ? error.message : 'The host could not open the document',
            color: 'error',
        });
    } finally {
        busy.value = false;
    }
}

async function forwardUiEvent(payload: PortableUiEvent): Promise<void> {
    // The retained tree is display-only until the new activation renders its
    // own view. Never send an old control into a replacement session.
    if (!activation.value?.view) return;
    if (payload.kind === 'open-document') {
        await openHostDocument(payload.documentId);
        return;
    }
    if (payload.kind === 'open-pane') {
        // No host registry maps a portable pane id to a navigable surface, so
        // this primitive is refused rather than silently doing nothing. The
        // renderer disables the control; this is the defensive path.
        toast.add({
            title: 'Opening plugin panes is not supported',
            description: 'This host cannot open the pane the plugin asked for.',
            color: 'warning',
        });
        return;
    }
    if (payload.kind !== 'action') return;
    if (locked.value) return;
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
    const current = activation.value;
    if (!current) return;
    const pluginId = props.pluginId;
    const expected = {
        workspaceId: current.workspaceId,
        packageDigest: current.packageDigest,
        generation: current.generation,
    };
    busy.value = true;
    try {
        const response = await invokePortableUiEvent(pluginId, {
            action: payload.action,
            ...(payload.formId === undefined ? {} : { formId: payload.formId }),
            values: payload.values,
        }, expected);
        const live = activation.value;
        if (
            firstActionCancelled || props.pluginId !== pluginId || !live ||
            live.status !== 'active' || live.workspaceId !== expected.workspaceId ||
            live.packageDigest !== expected.packageDigest || live.generation !== expected.generation
        ) return;
        const outcome = response as { ok?: boolean; message?: string; result?: { ok?: boolean; message?: string } };
        if (outcome.ok === false || outcome.result?.ok === false) {
            throw new Error(outcome.message ?? outcome.result?.message ?? 'The plugin could not complete this action.');
        }
        applyFieldReplacement(response);
        if (props.surface === 'sidebar' && payload.action.startsWith('navigation.open:')) {
            await openPortablePane(props.pluginId);
        }
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
    <div class="flex min-h-0 flex-col gap-4" :class="surface === 'pane' ? 'h-full overflow-hidden' : ''">
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
            :title="`Couldn't open ${pluginName}`"
            :description="blockedMessage"
            data-testid="portable-plugin-blocked"
        >
            <template v-if="canRestart" #actions>
                <UButton :loading="restartBusy" @click="restartActivation">Try again</UButton>
            </template>
        </UAlert>

        <div v-else-if="(activation.status === 'starting' || recovering) && renderNodes.length === 0" class="flex items-center gap-2 text-sm">
            <UIcon name="i-lucide-loader-circle" class="animate-spin" />
            <span>Opening {{ pluginName }}…</span>
        </div>

        <template v-else>
            <div v-if="!surface" class="flex items-center gap-2 text-xs text-(--ui-text-muted)">
                <UBadge color="neutral" variant="subtle">{{ statusLabel }}</UBadge>
                <span>v{{ activation.version }}</span>
                <span v-if="activation.crashed" class="text-red-500">containment violation</span>
            </div>

            <div
                v-if="activation.status === 'stopped' && !recovering"
                class="rounded-lg border border-(--ui-border) p-3"
                data-testid="portable-plugin-stopped"
            >
                <p class="text-sm">
                    {{ stoppedMessage }}
                </p>
                <UButton
                    v-if="canRestart"
                    class="mt-2"
                    size="sm"
                    :loading="restartBusy"
                    @click="restartActivation"
                >
                    Try again
                </UButton>
                <p v-else class="mt-1 text-xs text-(--ui-text-muted)">
                    This app is unavailable in the current workspace.
                </p>
            </div>

            <div
                v-if="!surface && firstAction && !(firstAction.reasonCode === 'selection-required' && renderNodes.length > 0)"
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

            <AppModal
                v-model:open="confirmOpen"
                :title="`${HOST_ACTION_LABELS[HOST_ACTIONS.replaceDocument]}?`"
                description="This overwrites the selected document's current content with the plugin result."
                :dismissible="!busy"
                :content="{ onOpenAutoFocus: focusCancelAction }"
            >
                <template #footer>
                    <div class="flex gap-2.5" data-testid="portable-host-confirm">
                        <UButton
                            ref="cancelConfirmButton"
                            size="modal"
                            variant="ghost"
                            :disabled="busy"
                            @click="pendingConfirm = null"
                        >
                            Cancel
                        </UButton>
                        <UButton size="modal" color="error" :loading="busy" @click="confirmPending">
                            Replace
                        </UButton>
                    </div>
                </template>
            </AppModal>

            <div
                v-if="renderNodes.length > 0"
                :class="surface === 'pane' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'flex flex-col gap-2'"
                :aria-busy="busy || activation.status !== 'active' || !activation.view"
                data-testid="portable-plugin-view"
            >
            <PortableUiTree
                ref="treeRef"
                :key="pluginId"
                :nodes="renderNodes"
                :store="fieldStore"
                :retained-dirty-keys="fieldDraft.dirty"
                :disabled="locked || !activation.view"
                @ui-event="forwardUiEvent"
            />
            </div>
            <div v-else class="text-sm text-(--ui-text-muted)">
                <p>The plugin has not rendered anything yet.</p>
                <UButton v-if="activation.status === 'active'" class="mt-2" size="sm"
                    :loading="restartBusy" @click="restartActivation">
                    Restart plugin
                </UButton>
            </div>

            <section
                v-if="!surface && contributions.length > 0"
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
                v-if="!surface && activation.logs.length > 0"
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
