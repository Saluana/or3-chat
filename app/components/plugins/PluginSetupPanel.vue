/**
 * Host-rendered setup panel for one portable plugin.
 *
 * Renders what the package declares (fields, connection slots, test and first
 * action) with host components; the plugin never renders this page. The panel is
 * presentational: saving settings, connecting a credential, testing a connection
 * and running the first action are all host API calls made by the page.
 *
 * The form hydrates from the validated saved settings, tracks which fields the
 * user actually edited, and saves only those as a patch, so a refresh can never
 * replace stored values with defaults the user never touched.
 */
<script setup lang="ts">
import { computed, ref, watch } from 'vue';

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
    unsupported: boolean;
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
    /** False when the host has no encryption key; connecting cannot work. */
    readonly credentialsAvailable: boolean;
    /** Validated saved settings; the only hydration source. */
    readonly settings: {
        values: Readonly<Record<string, string | number | boolean>>;
        errors: readonly { key: string; message: string }[];
    };
    readonly saveState: 'idle' | 'saving' | 'saved' | 'error';
    readonly fieldErrors?: Readonly<Record<string, string>>;
    /** How many credentials this plugin currently has stored. */
    readonly storedConnections: number;
}>();

const emit = defineEmits<{
    (
        event: 'save-settings',
        patch: Record<string, string | number | boolean | null>
    ): void;
    (event: 'test-connection', connection: SetupConnectionPlan): void;
    (event: 'connect-connection', input: { slotId: string; credential: string }): void;
    (event: 'run-first-action'): void;
}>();

/** Field controls hold primitives; `null` (clear) only ever appears in a patch. */
const values = ref<Record<string, string | number | boolean>>({});
const dirty = ref<Set<string>>(new Set());
const credentialDrafts = ref<Record<string, string>>({});

function defaultValueFor(field: SetupFieldPlan): string | number | boolean {
    if (field.kind === 'toggle') return field.defaultValue === true;
    return field.defaultValue ?? '';
}

/**
 * Hydrate from the server's validated settings. Fields the user has edited keep
 * their local value, so a background refresh cannot erase typing.
 */
function hydrate(settings: { values: Readonly<Record<string, string | number | boolean>> }): void {
    const next: Record<string, string | number | boolean> = {};
    for (const field of props.plan.fields) {
        if (dirty.value.has(field.key) && field.key in values.value) {
            next[field.key] = values.value[field.key]!;
            continue;
        }
        const stored = settings.values[field.key];
        next[field.key] = stored ?? defaultValueFor(field);
    }
    values.value = next;
}

watch(() => props.settings.values, hydrate, { immediate: true, deep: true });

// A successful save confirms the exact revision that was written, so edits made
// after the request started stay dirty.
watch(
    () => props.saveState,
    (state) => {
        if (state === 'saved') dirty.value = new Set();
    }
);

const requiredFields = computed(() => props.plan.fields.filter((field) => field.required));
const deferredFields = computed(() => props.plan.fields.filter((field) => !field.required));

function onEdit(field: SetupFieldPlan, value: unknown): void {
    if (field.kind === 'toggle') values.value[field.key] = value === true;
    else if (field.kind === 'number') values.value[field.key] = value as number;
    else values.value[field.key] = String(value ?? '');
    const next = new Set(dirty.value);
    next.add(field.key);
    dirty.value = next;
}

function errorFor(field: SetupFieldPlan): string | undefined {
    return (
        props.fieldErrors?.[field.key] ??
        props.settings.errors.find((error) => error.key === field.key)?.message
    );
}

/** Only edited fields are sent; clearing an optional field sends an explicit null. */
function save(): void {
    const patch: Record<string, string | number | boolean | null> = {};
    for (const field of props.plan.fields) {
        if (!dirty.value.has(field.key)) continue;
        const value = values.value[field.key];
        patch[field.key] =
            value === '' && !field.required ? null : (value ?? defaultValueFor(field));
    }
    emit('save-settings', patch);
}

function connect(connection: SetupConnectionPlan): void {
    const credential = credentialDrafts.value[connection.id] ?? '';
    if (!credential) return;
    emit('connect-connection', { slotId: connection.id, credential });
}

function canConnect(connection: SetupConnectionPlan): boolean {
    return props.credentialsAvailable && connection.usable && !connection.unsupported;
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

        <p v-if="status.nextAction" class="text-sm opacity-80">Next: {{ status.nextAction }}</p>

        <div
            v-if="!durableConnections"
            class="rounded border border-[var(--md-outline-variant)] p-3 text-xs"
            role="note"
        >
            Connections on this deployment are held in memory and will not survive a
            restart. Configure a durable store before relying on them.
        </div>

        <div
            v-if="!credentialsAvailable"
            class="rounded border border-[var(--md-outline-variant)] p-3 text-xs"
            role="alert"
        >
            This deployment has no credential encryption key configured, so connections
            cannot be stored. An administrator must set
            <code>OR3_PLUGIN_CONNECTION_SECRET</code> (or
            <code>NUXT_ADMIN_PLUGIN_CONNECTION_SECRET</code>) and restart the instance.
        </div>

        <form
            v-if="plan.fields.length > 0"
            class="flex flex-col gap-3"
            @submit.prevent="save"
        >
            <div v-for="field in requiredFields" :key="field.key" class="flex flex-col gap-1">
                <label class="text-xs font-medium" :for="`setup-${field.key}`">
                    {{ field.label }}
                </label>
                <USelectMenu
                    v-if="field.kind === 'select'"
                    :id="`setup-${field.key}`"
                    :model-value="values[field.key] as string"
                    :items="(field.choices ?? []).map((choice) => ({ label: choice, value: choice }))"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    :aria-label="field.label"
                    @update:model-value="(value) => onEdit(field, value)"
                />
                <UCheckbox
                    v-else-if="field.kind === 'toggle'"
                    :id="`setup-${field.key}`"
                    :model-value="Boolean(values[field.key])"
                    :label="field.label"
                    @update:model-value="(value) => onEdit(field, value)"
                />
                <UInput
                    v-else
                    :id="`setup-${field.key}`"
                    :model-value="values[field.key] as string | number"
                    :type="field.kind === 'number' ? 'number' : 'text'"
                    class="w-full"
                    @update:model-value="(value) => onEdit(field, value)"
                />
                <p v-if="errorFor(field)" class="text-xs text-[var(--ui-error)]" role="alert">
                    {{ errorFor(field) }}
                </p>
            </div>

            <details v-if="deferredFields.length > 0" class="text-sm">
                <summary>Optional settings</summary>
                <p class="mt-1 text-xs opacity-70">
                    Not required to use the plugin; saving them is optional.
                </p>
                <div class="mt-2 flex flex-col gap-3">
                    <div
                        v-for="field in deferredFields"
                        :key="field.key"
                        class="flex flex-col gap-1"
                    >
                        <label class="text-xs font-medium" :for="`setup-${field.key}`">
                            {{ field.label }}
                        </label>
                        <USelectMenu
                            v-if="field.kind === 'select'"
                            :id="`setup-${field.key}`"
                            :model-value="values[field.key] as string"
                            :items="
                                (field.choices ?? []).map((choice) => ({
                                    label: choice,
                                    value: choice,
                                }))
                            "
                            value-key="value"
                            label-key="label"
                            class="w-full"
                            :aria-label="field.label"
                            @update:model-value="(value) => onEdit(field, value)"
                        />
                        <UCheckbox
                            v-else-if="field.kind === 'toggle'"
                            :id="`setup-${field.key}`"
                            :model-value="Boolean(values[field.key])"
                            :label="field.label"
                            @update:model-value="(value) => onEdit(field, value)"
                        />
                        <UInput
                            v-else
                            :id="`setup-${field.key}`"
                            :model-value="values[field.key] as string | number"
                            :type="field.kind === 'number' ? 'number' : 'text'"
                            class="w-full"
                            @update:model-value="(value) => onEdit(field, value)"
                        />
                        <p
                            v-if="errorFor(field)"
                            class="text-xs text-[var(--ui-error)]"
                            role="alert"
                        >
                            {{ errorFor(field) }}
                        </p>
                    </div>
                </div>
            </details>

            <div class="flex items-center gap-2">
                <UButton
                    type="submit"
                    size="sm"
                    color="primary"
                    variant="solid"
                    :loading="saveState === 'saving'"
                    :disabled="dirty.size === 0"
                >
                    Save settings
                </UButton>
                <span v-if="saveState === 'saved'" class="text-xs opacity-70" role="status">
                    Settings saved.
                </span>
                <span
                    v-else-if="saveState === 'error'"
                    class="text-xs text-[var(--ui-error)]"
                    role="alert"
                >
                    Settings could not be saved.
                </span>
            </div>
        </form>

        <div v-if="plan.connections.length > 0" class="flex flex-col gap-2">
            <h3 class="text-sm font-medium">Connections</h3>
            <div
                v-for="connection in plan.connections"
                :key="connection.id"
                class="flex flex-col gap-2 rounded border border-[var(--md-outline-variant)] p-3"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-sm">{{ connection.label }}</span>
                    <UBadge
                        :color="
                            connection.satisfied
                                ? 'success'
                                : connection.unsupported
                                  ? 'error'
                                  : 'warning'
                        "
                        variant="soft"
                    >
                        {{
                            connection.satisfied
                                ? 'Connected'
                                : connection.unsupported
                                  ? 'Unsupported'
                                  : 'Needs setup'
                        }}
                    </UBadge>
                </div>
                <p class="text-xs opacity-70">
                    Requires: {{ connection.scopes.join(', ') || 'no special scopes' }}
                    <template v-if="connection.externalCost">
                        · {{ connection.externalCost }}
                    </template>
                </p>
                <p v-if="connection.blockedReason" class="text-xs">
                    {{ connection.blockedReason }}
                </p>

                <div v-if="canConnect(connection)" class="flex flex-wrap items-end gap-2">
                    <div class="flex min-w-[16rem] flex-1 flex-col gap-1">
                        <label
                            class="text-xs font-medium"
                            :for="`connect-${connection.id}`"
                        >
                            {{
                                connection.connectionRef
                                    ? 'Replace credential'
                                    : `${connection.provider} credential`
                            }}
                        </label>
                        <UInput
                            :id="`connect-${connection.id}`"
                            v-model="credentialDrafts[connection.id]"
                            type="password"
                            autocomplete="off"
                            class="w-full"
                            :aria-label="`${connection.provider} credential`"
                        />
                    </div>
                    <UButton
                        size="sm"
                        color="primary"
                        variant="soft"
                        :disabled="!(credentialDrafts[connection.id] ?? '').length"
                        @click="connect(connection)"
                    >
                        {{ connection.connectionRef ? 'Replace' : 'Connect' }}
                    </UButton>
                </div>

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

        <ul v-if="plan.blockers.length > 0" class="text-xs opacity-80">
            <li v-for="blocker in plan.blockers" :key="blocker">{{ blocker }}</li>
        </ul>

        <p v-if="storedConnections > 0" class="text-xs opacity-60">
            {{ storedConnections }} stored credential{{ storedConnections === 1 ? '' : 's' }} for
            this plugin.
        </p>
    </section>
</template>
