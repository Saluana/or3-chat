/**
 * Host-rendered setup panel for one portable plugin.
 *
 * Renders what the package declares (fields, connections, test and first action)
 * with host components; the plugin never renders this page. Saving settings,
 * testing a connection and running the first action all go through host APIs.
 */
<script setup lang="ts">
import { computed, ref } from 'vue';

type SetupFieldPlan = {
    key: string;
    label: string;
    kind: 'text' | 'select' | 'toggle' | 'number';
    order: number;
    required: boolean;
    deferred: boolean;
    choices?: readonly string[];
    defaultValue?: string | number | boolean;
    missing: boolean;
};

type SetupConnectionPlan = {
    id: string;
    label: string;
    provider: string;
    mechanism: 'browser' | 'server';
    required: boolean;
    scopes: readonly string[];
    operationIds: readonly string[];
    externalCost?: string;
    connectionRef?: string;
    satisfied: boolean;
    usable: boolean;
    blockedReason?: string;
};

type SetupPlan = {
    status: 'ready' | 'needs-setup' | 'blocked';
    fields: readonly SetupFieldPlan[];
    connections: readonly SetupConnectionPlan[];
    testAction?: { operationId: string; deadlineMs: number };
    firstAction: { operationId: string; label: string; usesSampleContext: boolean };
    blockers: readonly string[];
};

const props = defineProps<{
    readonly pluginId: string;
    readonly plan: SetupPlan;
    readonly status: { status: string; label: string; nextAction?: string; blocked?: boolean };
    readonly firstAction: {
        operationId: string;
        label: string;
        contextKind: 'selected' | 'sample';
        ready: boolean;
        reason?: string;
    };
    readonly durableConnections: boolean;
}>();

const emit = defineEmits<{
    (event: 'save-settings', values: Record<string, string | number | boolean>): void;
    (event: 'test-connection', connection: SetupConnectionPlan): void;
    (event: 'run-first-action'): void;
}>();

const values = ref<Record<string, string | number | boolean>>({});
for (const field of props.plan.fields) {
    values.value[field.key] = field.defaultValue ?? (field.kind === 'toggle' ? false : '');
}

const requiredFields = computed(() =>
    props.plan.fields.filter((field) => field.required && !field.deferred)
);
const deferredFields = computed(() => props.plan.fields.filter((field) => field.deferred));
const testableConnections = computed(() =>
    props.plan.connections.filter((connection) => connection.required || !connection.satisfied)
);

function save(): void {
    emit('save-settings', { ...values.value });
}
</script>

<template>
    <section class="flex flex-col gap-4" aria-labelledby="plugin-setup-heading">
        <header class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="plugin-setup-heading" class="text-lg font-semibold">Set up this plugin</h2>
            <UBadge
                :color="status.status === 'ready' ? 'success' : status.blocked ? 'error' : 'warning'"
                variant="soft"
            >
                {{ status.label }}
            </UBadge>
        </header>

        <p v-if="status.nextAction" class="text-sm opacity-80">
            Next: {{ status.nextAction }}
        </p>

        <div
            v-if="!durableConnections"
            class="rounded border border-[var(--md-outline-variant)] p-3 text-xs"
            role="note"
        >
            Connections on this deployment are held in memory and will not survive a
            restart. Configure a durable store before relying on them.
        </div>

        <form v-if="requiredFields.length > 0" class="flex flex-col gap-3" @submit.prevent="save">
            <div v-for="field in requiredFields" :key="field.key" class="flex flex-col gap-1">
                <label class="text-xs font-medium" :for="`setup-${field.key}`">
                    {{ field.label }}
                </label>
                <USelectMenu
                    v-if="field.kind === 'select'"
                    :id="`setup-${field.key}`"
                    v-model="values[field.key]"
                    :items="(field.choices ?? []).map((choice) => ({ label: choice, value: choice }))"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    :aria-label="field.label"
                />
                <UCheckbox
                    v-else-if="field.kind === 'toggle'"
                    :id="`setup-${field.key}`"
                    v-model="values[field.key]"
                    :label="field.label"
                />
                <UInput
                    v-else
                    :id="`setup-${field.key}`"
                    v-model="values[field.key]"
                    :type="field.kind === 'number' ? 'number' : 'text'"
                    class="w-full"
                />
            </div>
            <div class="flex">
                <UButton type="submit" size="sm" color="primary" variant="solid">Save</UButton>
            </div>
        </form>

        <div v-if="testableConnections.length > 0" class="flex flex-col gap-2">
            <h3 class="text-sm font-medium">Connections</h3>
            <div
                v-for="connection in testableConnections"
                :key="connection.id"
                class="flex flex-col gap-1 rounded border border-[var(--md-outline-variant)] p-3"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-sm">{{ connection.label }}</span>
                    <UBadge :color="connection.satisfied ? 'success' : 'warning'" variant="soft">
                        {{ connection.satisfied ? 'Connected' : 'Needs setup' }}
                    </UBadge>
                </div>
                <p class="text-xs opacity-70">
                    Requires: {{ connection.scopes.join(', ') || 'no special scopes' }}
                    <template v-if="connection.externalCost">
                        · {{ connection.externalCost }}
                    </template>
                </p>
                <p v-if="connection.blockedReason" class="text-xs">{{ connection.blockedReason }}</p>
                <div v-if="plan.testAction" class="flex">
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="soft"
                        :disabled="!connection.connectionRef"
                        @click="emit('test-connection', connection)"
                    >
                        Test connection
                    </UButton>
                </div>
            </div>
        </div>

        <div class="flex flex-col gap-2">
            <h3 class="text-sm font-medium">First action</h3>
            <div class="flex flex-wrap items-center gap-2">
                <UButton
                    size="sm"
                    color="primary"
                    variant="solid"
                    :disabled="!firstAction.ready"
                    @click="emit('run-first-action')"
                >
                    {{ firstAction.label }}
                </UButton>
                <span class="text-xs opacity-70">
                    {{
                        firstAction.contextKind === 'sample'
                            ? 'Runs on the package sample'
                            : 'Runs on your selection'
                    }}
                </span>
            </div>
            <p v-if="!firstAction.ready && firstAction.reason" class="text-xs opacity-70">
                {{ firstAction.reason }}
            </p>
        </div>

        <details v-if="deferredFields.length > 0" class="text-sm">
            <summary>Optional settings (can be configured later)</summary>
            <ul class="mt-2 list-disc pl-5 text-xs opacity-80">
                <li v-for="field in deferredFields" :key="field.key">{{ field.label }}</li>
            </ul>
        </details>

        <ul v-if="plan.blockers.length > 0" class="text-xs opacity-80">
            <li v-for="blocker in plan.blockers" :key="blocker">{{ blocker }}</li>
        </ul>
    </section>
</template>
