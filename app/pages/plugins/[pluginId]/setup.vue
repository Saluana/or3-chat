<script setup lang="ts">
/**
 * User-facing setup page for an installed portable plugin.
 *
 * Everything on this page is host-generated from the package descriptors and the
 * workspace's stored connections: the plugin supplies data, the host renders and
 * mediates every action. Readiness, settings hydration and the first-action
 * handoff all come from the same server state the setup plan is built from.
 */
import PluginSetupPanel from '~/components/plugins/PluginSetupPanel.vue';
import type { SetupPlan } from '~~/shared/plugins/setup/plan';

type SetupPlanResponse = {
    plan: SetupPlan | null;
    status: { status: string; label: string; nextAction?: string; blocked?: boolean };
    firstAction: {
        operationId: string;
        label: string;
        contextKind: 'selected' | 'sample';
        ready: boolean;
        reason?: string;
        reasonCode?: 'setup-incomplete' | 'selection-required';
    };
    problems: readonly string[];
    destinations: readonly {
        id: string;
        hosts: readonly string[];
        methods: readonly string[];
        scopes: readonly string[];
    }[];
    durableConnections: boolean;
    credentialsAvailable: boolean;
    settings: {
        values: Record<string, string | number | boolean>;
        errors: readonly { key: string; message: string }[];
    };
    packageDigest: string | null;
    operationId: string | null;
    setupRevision: number;
};

const route = useRoute();
const pluginId = computed(() => String(route.params.pluginId ?? ''));

/**
 * A context selected in the host UI is carried here as query parameters: the
 * setup route has no selection of its own, and the server decides what a
 * selection means.
 */
const selectedContext = computed(() => {
    const documentId = typeof route.query.documentId === 'string' ? route.query.documentId : '';
    const messageId = typeof route.query.messageId === 'string' ? route.query.messageId : '';
    return { documentId, messageId };
});

const { data, error, refresh } = await useFetch<SetupPlanResponse>(
    () => `/api/plugins/${encodeURIComponent(pluginId.value)}/setup-plan`,
    { key: () => `plugin-setup-${pluginId.value}` }
);

const currentSetupRevision = computed(() => data.value?.setupRevision ?? 0);

const busy = ref(false);
const message = ref<string | null>(null);
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const fieldErrors = ref<Record<string, string>>({});
const storedConnections = ref(0);

function mutationHeaders(): Record<string, string> {
    // The host mutation guard requires an explicit intent header.
    return { 'x-or3-plugin-intent': 'plugin' };
}

function captureFieldErrors(payload: unknown): void {
    const errors =
        (payload as { data?: { fieldErrors?: { key: string; message: string }[] } })?.data
            ?.fieldErrors ?? [];
    fieldErrors.value = Object.fromEntries(
        errors.map((error) => [error.key, error.message])
    );
}

async function refreshConnections(): Promise<void> {
    try {
        const result = await $fetch<{ connections: readonly unknown[] }>(
            '/api/plugins/connections'
        );
        storedConnections.value = result.connections.length;
    } catch {
        storedConnections.value = 0;
    }
}

async function saveSettings(
    patch: Record<string, string | number | boolean | null>
): Promise<void> {
    saveState.value = 'saving';
    fieldErrors.value = {};
    try {
        await $fetch(`/api/plugins/${encodeURIComponent(pluginId.value)}/setup-values`, {
            method: 'POST',
            headers: mutationHeaders(),
            body: {
                values: patch,
                operationId: data.value?.operationId ?? null,
                expectedPackageDigest: data.value?.packageDigest ?? null,
                expectedRevision: currentSetupRevision.value,
            },
        });
        saveState.value = 'saved';
        message.value = 'Settings saved.';
        await refresh();
    } catch (caught) {
        saveState.value = 'error';
        captureFieldErrors(caught);
        message.value = 'Settings could not be saved.';
    }
}

async function testConnection(connection: { id: string; connectionRef?: string }): Promise<void> {
    if (!connection.connectionRef) return;
    busy.value = true;
    try {
        // The operation and URL are resolved by the server from the release's
        // approved operations; the caller only names the stored reference.
        const result = await $fetch<{ status?: string; code?: string; message?: string }>(
            '/api/plugins/connections/test',
            {
                method: 'POST',
                headers: mutationHeaders(),
                body: {
                    ref: connection.connectionRef,
                    pluginId: pluginId.value,
                    operationId: data.value?.operationId ?? null,
                    expectedPackageDigest: data.value?.packageDigest ?? null,
                },
            }
        );
        message.value =
            result.status === 'ok'
                ? 'Connection works.'
                : `Connection test failed (${result.code ?? 'unknown'}).`;
        await refresh();
    } catch (caught) {
        const statusMessage = (caught as { statusMessage?: string })?.statusMessage;
        message.value = statusMessage
            ? `Connection test could not run: ${statusMessage}`
            : 'Connection test could not run.';
    } finally {
        busy.value = false;
    }
}

async function connectConnection(input: { slotId: string; credential: string }): Promise<void> {
    busy.value = true;
    try {
        await $fetch('/api/plugins/connections', {
            method: 'POST',
            headers: mutationHeaders(),
            body: {
                pluginId: pluginId.value,
                // The slot names the requirement; provider and scopes come from
                // the package policy on the server. A pending candidate is
                // bound server-side to the operation that owns it.
                slotId: input.slotId,
                credential: input.credential,
                operationId: data.value?.operationId ?? null,
                expectedPackageDigest: data.value?.packageDigest ?? null,
            },
        });
        message.value = 'Credential stored. Test it to finish setup.';
        await refresh();
        await refreshConnections();
    } catch (caught) {
        const statusMessage = (caught as { statusMessage?: string })?.statusMessage;
        message.value = statusMessage
            ? `Credential was not stored: ${statusMessage}`
            : 'Credential was not stored.';
    } finally {
        busy.value = false;
    }
}

async function runFirstAction(): Promise<void> {
    busy.value = true;
    try {
        const result = await $fetch<{
            status: string;
            handoff?: { label: string; contextKind: string };
            reason?: string;
        }>(`/api/plugins/${encodeURIComponent(pluginId.value)}/first-action`, {
            method: 'POST',
            headers: mutationHeaders(),
            body: {
                ...(selectedContext.value.documentId
                    ? { documentId: selectedContext.value.documentId }
                    : {}),
                ...(selectedContext.value.messageId
                    ? { messageId: selectedContext.value.messageId }
                    : {}),
            },
        });
        if (result.status === 'ready') {
            message.value = `${result.handoff?.label ?? 'First action'} is ready on the ${
                result.handoff?.contextKind === 'sample' ? 'package sample' : 'selection'
            }.`;
            return;
        }
        if (result.status === 'pending-activation') {
            message.value =
                result.reason ?? 'Open the plugin first, then run its first action.';
            return;
        }
        message.value =
            result.status === 'needs-selection'
                ? 'Select a document or message in OR3, then open this plugin from there.'
                : 'Finish setup before running the first action.';
    } catch (caught) {
        const statusMessage = (caught as { statusMessage?: string })?.statusMessage;
        message.value = statusMessage ?? 'The first action could not be started.';
    } finally {
        busy.value = false;
    }
}

onMounted(async () => {
    await refreshConnections();
});
</script>

<template>
    <div class="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <div>
            <h1 class="text-xl font-semibold">{{ pluginId }}</h1>
            <p class="text-sm opacity-70">
                Setup is generated by OR3 from what the plugin declares.
            </p>
        </div>

        <div
            v-if="error"
            class="rounded border border-[var(--md-outline-variant)] p-3 text-sm"
            role="alert"
        >
            This plugin's setup information is unavailable.
        </div>

        <PluginSetupPanel
            v-else-if="data?.plan"
            :plugin-id="pluginId"
            :plan="data.plan"
            :status="data.status"
            :first-action="data.firstAction"
            :durable-connections="data.durableConnections"
            :credentials-available="data.credentialsAvailable"
            :settings="data.settings"
            :save-state="saveState"
            :field-errors="fieldErrors"
            :stored-connections="storedConnections"
            @save-settings="saveSettings"
            @test-connection="testConnection"
            @connect-connection="connectConnection"
            @run-first-action="runFirstAction"
        />

        <p v-else class="text-sm">
            No setup is available for this plugin on this deployment.
        </p>

        <div v-if="data && !data.firstAction.ready && data.firstAction.reasonCode === 'selection-required'" class="text-xs opacity-70" role="note">
            This plugin runs on a selected document or message. Open it from a selection
            (the host carries the selection into this page) and try again.
        </div>

        <ul v-if="data?.problems?.length" class="text-xs opacity-70">
            <li v-for="problem in data.problems" :key="problem">{{ problem }}</li>
        </ul>

        <p v-if="busy" class="text-xs opacity-70" role="status">Working…</p>
        <p v-if="message" class="text-xs" role="status">{{ message }}</p>
    </div>
</template>
