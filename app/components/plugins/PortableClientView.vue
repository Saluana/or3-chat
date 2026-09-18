<script setup lang="ts">
/**
 * Host surface for one contained portable plugin.
 *
 * It renders exactly what the plugin rendered (a validated declarative tree),
 * plus the plugin's status and the host-owned actions. UI events from the tree
 * are forwarded to the plugin as a request; the plugin may render again. A
 * reserved `host.*` action is handled here instead: the click authorizes a
 * write, the target is the document this surface was opened on, and replacing
 * content needs an explicit confirmation. Nothing here executes plugin code.
 */
import { computed, onMounted, ref } from 'vue';
import { $fetch, navigateTo, useRoute, useToast } from '#imports';
import {
    invokePortableUiEvent,
    usePortableActivations,
} from '~/composables/plugins/portable-client-runtime';
import { usePortableHostActions } from '~/composables/plugins/usePortableHostActions';
import { getDocument } from '~/db/documents';
import {
    HOST_ACTIONS,
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

/** The document this surface was opened on; the only replace target. */
const selectedDocumentId = computed(() => {
    const value = route.query.documentId;
    return typeof value === 'string' && value.length > 0 ? value : null;
});

/** A host action awaiting the user's confirmation (destructive writes only). */
const pendingConfirm = ref<{ readonly action: string; readonly label: string } | null>(null);

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

async function runHostAction(action: string): Promise<void> {
    busy.value = true;
    try {
        const result = await hostActions.run({
            pluginId: props.pluginId,
            action,
            selectedDocumentId: selectedDocumentId.value,
        });
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
    } finally {
        busy.value = false;
    }
}

function confirmPending(): void {
    const pending = pendingConfirm.value;
    pendingConfirm.value = null;
    if (pending) void runHostAction(pending.action);
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

async function runFirstAction(): Promise<void> {
    const action = firstAction.value;
    if (!action?.ready) return;
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
        } else if (selectedDocumentId.value) {
            const document = await getDocument(selectedDocumentId.value);
            content = document ? tipTapToText(document.content) : null;
        }
        if (!content) {
            toast.add({
                title: 'No starting content',
                description: 'Select a document or use the package sample to run this action.',
                color: 'warning',
            });
            return;
        }
        await invokePortableUiEvent(props.pluginId, {
            action: 'host.first-action.run',
            context: { kind: action.contextKind, title, content },
        });
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

onMounted(() => {
    void loadFirstAction();
});

const nodes = computed<readonly PortableUiNode[]>(
    () => activation.value?.view?.nodes ?? []
);

/**
 * Dashboard contributions registered by this activation. They are rendered here
 * so a plugin's registered cards are visible (and disappear again when the
 * plugin withdraws them), instead of being recorded and never shown.
 */
const contributions = computed(() => activation.value?.contributions ?? []);

const statusLabel = computed(() => {
    const state = activation.value;
    if (!state) return 'Not running';
    if (state.status === 'active') return 'Running';
    if (state.status === 'starting') return 'Starting';
    if (state.status === 'blocked') return 'Blocked';
    return 'Stopped';
});

async function forwardUiEvent(payload: PortableUiEvent): Promise<void> {
    if (payload.kind !== 'action') return;
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
        if (payload.action === HOST_ACTIONS.replaceDocument) {
            pendingConfirm.value = { action: payload.action, label: 'Replace selected document' };
            return;
        }
        await runHostAction(payload.action);
        return;
    }
    busy.value = true;
    try {
        await invokePortableUiEvent(props.pluginId, {
            action: payload.action,
            ...(payload.formId === undefined ? {} : { formId: payload.formId }),
            values: payload.values,
        });
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
                v-if="firstAction"
                class="flex flex-wrap items-center gap-2 rounded-lg border border-(--ui-border) p-3"
                data-testid="portable-plugin-first-action"
            >
                <UButton
                    v-if="firstAction.ready"
                    size="sm"
                    :loading="firstActionBusy"
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
                <p class="text-sm font-medium">{{ pendingConfirm.label }}?</p>
                <p class="mt-1 text-xs text-(--ui-text-muted)">
                    This overwrites the selected document's current content with the plugin result.
                </p>
                <div class="mt-3 flex gap-2">
                    <UButton size="sm" color="error" :loading="busy" @click="confirmPending">
                        Replace
                    </UButton>
                    <UButton size="sm" variant="ghost" @click="pendingConfirm = null">Cancel</UButton>
                </div>
            </div>

            <PortableUiTree
                v-if="nodes.length > 0"
                :nodes="nodes"
                :store="fieldStore"
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
