<template>
    <div class="space-y-8">
        <header>
            <div class="flex items-center gap-3">
                <div
                    class="flex h-10 w-10 items-center justify-center rounded-[var(--md-border-radius-small,var(--md-sys-shape-corner-medium,12px))] bg-[var(--md-primary)]/10 text-[var(--md-primary)]"
                >
                    <UIcon :name="icon" class="h-5 w-5" />
                </div>
                <div>
                    <h2 class="text-2xl font-semibold">{{ title }}</h2>
                    <p class="mt-1 text-sm opacity-70">{{ description }}</p>
                </div>
            </div>
        </header>

        <div
            v-if="variant === 'advanced'"
            class="flex gap-3 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-sys-color-warning,#f59e0b)]/50 bg-[var(--md-sys-color-warning-container,#fef3c7)] p-4 text-[var(--md-sys-color-on-warning-container,#92400e)]"
        >
            <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 h-5 w-5 shrink-0" />
            <div>
                <div class="text-sm font-semibold">For experienced administrators</div>
                <p class="mt-1 text-xs leading-relaxed opacity-80">
                    These settings control deployment infrastructure, security, providers, and
                    runtime behavior. Incorrect values can prevent OR3 from starting.
                </p>
            </div>
        </div>

        <ClientOnly>
            <div v-if="pending" class="space-y-4 animate-pulse">
                <div class="h-24 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] bg-[var(--md-surface-container-highest)]" />
                <div class="h-64 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] bg-[var(--md-surface-container-highest)]" />
            </div>

            <template v-else>
                <div
                    v-if="restartRequired"
                    class="flex flex-col gap-3 rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] p-4 text-[var(--md-sys-color-on-warning-container,#92400e)] sm:flex-row sm:items-center sm:justify-between"
                >
                    <div class="flex items-start gap-3">
                        <UIcon name="i-heroicons-arrow-path" class="mt-0.5 h-5 w-5 shrink-0" />
                        <div>
                            <div class="text-sm font-semibold">Restart required</div>
                            <p class="mt-0.5 text-xs opacity-80">
                                Your changes are saved and will take effect after the server restarts.
                            </p>
                        </div>
                    </div>
                    <UButton to="/admin/system" size="sm" color="warning" variant="soft">
                        Go to Operations
                    </UButton>
                </div>

                <div v-if="variant === 'advanced'" class="space-y-2">
                    <label for="advanced-settings-search" class="text-sm font-medium">
                        Find a setting
                    </label>
                    <UInput
                        id="advanced-settings-search"
                        v-model="searchQuery"
                        icon="i-heroicons-magnifying-glass"
                        placeholder="Search by name, description, or environment variable"
                        class="w-full"
                    />
                </div>

                <div v-if="visibleGroups.length" class="space-y-5">
                    <component
                        :is="variant === 'advanced' ? 'details' : 'section'"
                        v-for="group in visibleGroups"
                        :key="group"
                        :open="variant === 'advanced' && searchQuery.length > 0 ? true : undefined"
                        class="group overflow-hidden rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
                    >
                        <component
                            :is="variant === 'advanced' ? 'summary' : 'div'"
                            class="flex items-center justify-between gap-3 px-5 py-4"
                            :class="variant === 'advanced' ? 'cursor-pointer select-none hover:bg-[var(--md-primary)]/5' : ''"
                        >
                            <div class="flex items-center gap-3">
                                <span class="h-5 w-1 rounded-full" :class="getGroupColor(group)" />
                                <div>
                                    <h3 class="font-semibold">{{ group }}</h3>
                                    <p class="mt-0.5 text-xs opacity-60">
                                        {{ getGroupDescription(group) }}
                                    </p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <UBadge color="neutral" variant="subtle" size="xs">
                                    {{ getEntriesForGroup(group).length }}
                                </UBadge>
                                <UIcon
                                    v-if="variant === 'advanced'"
                                    name="i-heroicons-chevron-down"
                                    class="h-4 w-4 transition-transform group-open:rotate-180"
                                />
                            </div>
                        </component>

                        <div class="divide-y-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] divide-[var(--md-outline-variant)] border-t-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] border-[var(--md-outline-variant)]">
                            <div
                                v-for="entry in getEntriesForGroup(group)"
                                :key="entry.key"
                                class="px-5 py-4"
                                :class="variant === 'features' ? 'sm:flex sm:items-center sm:justify-between sm:gap-6' : ''"
                            >
                                <div :class="variant === 'features' ? 'min-w-0 flex-1' : 'mb-2'">
                                    <div class="text-sm font-medium">{{ entry.label }}</div>
                                    <p class="mt-0.5 text-xs leading-relaxed opacity-60">
                                        {{ entry.description }}
                                    </p>
                                    <code
                                        v-if="variant === 'advanced'"
                                        class="mt-1.5 inline-block font-mono text-[11px] opacity-40"
                                    >
                                        {{ entry.key }}
                                    </code>
                                </div>

                                <USwitch
                                    v-if="variant === 'features' && entry.valueType === 'boolean' && !entry.masked"
                                    :model-value="entry.value === 'true'"
                                    :disabled="!isOwner"
                                    :aria-label="entry.label"
                                    class="mt-3 sm:mt-0"
                                    @update:model-value="entry.value = $event ? 'true' : 'false'"
                                />
                                <USelectMenu
                                    v-else-if="entry.valueType === 'boolean' && !entry.masked"
                                    :model-value="entry.value ?? undefined"
                                    :items="booleanItems"
                                    value-key="value"
                                    size="sm"
                                    :disabled="!isOwner"
                                    class="w-full"
                                    @update:model-value="entry.value = $event ?? null"
                                />
                                <UInput
                                    v-else
                                    :model-value="entry.value ?? undefined"
                                    :type="entry.valueType === 'number' ? 'number' : 'text'"
                                    :placeholder="entry.masked ? 'Leave unchanged' : ''"
                                    size="sm"
                                    :disabled="!isOwner"
                                    class="w-full"
                                    @update:model-value="entry.value = $event ?? null"
                                >
                                    <template v-if="entry.masked" #trailing>
                                        <UBadge size="xs" color="neutral" variant="subtle">MASKED</UBadge>
                                    </template>
                                </UInput>
                            </div>
                        </div>
                    </component>
                </div>

                <div
                    v-else
                    class="rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] border-[length:var(--md-border-width)] border-dashed border-[var(--md-outline-variant)] p-8 text-center"
                >
                    <UIcon name="i-heroicons-magnifying-glass" class="mx-auto h-6 w-6 opacity-40" />
                    <p class="mt-2 text-sm font-medium">No settings found</p>
                    <p class="mt-1 text-xs opacity-60">Try a different search term.</p>
                </div>

                <div class="sticky bottom-0 z-10 -mx-4 border-t-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] border-[var(--md-outline-variant)] bg-[var(--md-surface)]/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:flex sm:items-center sm:justify-between sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
                    <p class="mb-3 text-xs opacity-60 sm:mb-0">
                        <template v-if="changedCount">
                            {{ changedCount }} unsaved {{ changedCount === 1 ? 'change' : 'changes' }}
                        </template>
                        <template v-else>Everything is up to date.</template>
                    </p>
                    <UButton
                        :disabled="!isOwner || isSaving || changedCount === 0"
                        :loading="isSaving"
                        color="primary"
                        variant="solid"
                        icon="i-heroicons-check"
                        class="w-full justify-center sm:w-auto"
                        @click="saveConfig"
                    >
                        Save changes
                    </UButton>
                </div>
            </template>

            <template #fallback>
                <div class="h-64 animate-pulse rounded-[var(--md-border-radius,var(--md-sys-shape-corner-medium,12px))] bg-[var(--md-surface-container-highest)]" />
            </template>
        </ClientOnly>
    </div>
</template>

<script setup lang="ts">
import type { ConfigGroup, EnrichedConfigEntry } from '~/composables/admin/useAdminTypes';
import { useAdminSystemConfigEnriched, useAdminSystemStatus } from '~/composables/admin/useAdminData';
import { parseErrorMessage } from '~/utils/admin/parse-error';

type EditorVariant = 'standard' | 'features' | 'advanced';
type EnrichedConfigEntryUi = Omit<EnrichedConfigEntry, 'value'> & {
    value: string | null;
};

const props = withDefaults(
    defineProps<{
        title: string;
        description: string;
        icon: string;
        groups: ConfigGroup[];
        variant?: EditorVariant;
    }>(),
    {
        variant: 'standard',
    }
);

const toast = useToast();
const { data: statusData } = useAdminSystemStatus();
const { data: configData, status: configFetchStatus } = useAdminSystemConfigEnriched();

const entries = ref<EnrichedConfigEntryUi[]>([]);
const originalValues = ref<Record<string, string | null | undefined>>({});
const restartRequired = ref(false);
const isSaving = ref(false);
const searchQuery = ref('');

const isOwner = computed(() => statusData.value?.session?.role === 'owner');
const pending = computed(() => configFetchStatus.value === 'pending' && !configData.value);

const booleanItems: Array<{ label: string; value: string }> = [
    { label: 'Enabled', value: 'true' },
    { label: 'Disabled', value: 'false' },
];

const GROUP_COLORS: Record<ConfigGroup, string> = {
    Auth: 'bg-[var(--md-sys-color-primary)]',
    Sync: 'bg-[var(--md-sys-color-secondary)]',
    Storage: 'bg-[var(--md-sys-color-tertiary)]',
    'UI & Branding': 'bg-[var(--md-sys-color-primary)]',
    Features: 'bg-[var(--md-sys-color-secondary)]',
    'Limits & Security': 'bg-[var(--md-sys-color-error)]',
    'Background Processing': 'bg-[var(--md-sys-color-tertiary)]',
    Admin: 'bg-[var(--md-outline)]',
    'External Services': 'bg-[var(--md-sys-color-primary)]',
};

const GROUP_DESCRIPTIONS: Record<ConfigGroup, string> = {
    Auth: 'Authentication providers, credentials, and session behavior',
    Sync: 'Database provider and synchronization internals',
    Storage: 'File providers, quotas, retention, and upload limits',
    'UI & Branding': 'Identity, appearance defaults, layout, and legal links',
    Features: 'Choose which product capabilities are available',
    'Limits & Security': 'Network trust, rate limits, and usage controls',
    'Background Processing': 'Job providers, concurrency, and timeouts',
    Admin: 'Admin routing, lifecycle controls, and extension safety',
    'External Services': 'OpenRouter and other service connections',
};

watch(
    () => configData.value?.entries,
    (next) => {
        if (!next) return;
        const selected = next
            .filter((entry) => props.groups.includes(entry.group))
            .map((entry) => ({
                ...entry,
                value: normalizeUiValue(entry),
            }))
            .sort((a, b) => {
                const groupOrder =
                    props.groups.indexOf(a.group) - props.groups.indexOf(b.group);
                return groupOrder || a.order - b.order;
            });

        entries.value = selected;
        originalValues.value = Object.fromEntries(
            selected.map((entry) => [entry.key, entry.value])
        );
    },
    { immediate: true }
);

const filteredEntries = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) return entries.value;
    return entries.value.filter((entry) =>
        [entry.label, entry.description, entry.key, entry.group]
            .some((value) => value.toLowerCase().includes(query))
    );
});

const visibleGroups = computed(() =>
    props.groups.filter((group) =>
        filteredEntries.value.some((entry) => entry.group === group)
    )
);

const changedEntries = computed(() =>
    entries.value
        .map((entry) => {
            const previous = normalizeForSave(
                originalValues.value[entry.key],
                entry.masked
            );
            const next = normalizeForSave(entry.value, entry.masked);
            return previous === next ? null : { key: entry.key, value: next };
        })
        .filter(Boolean) as Array<{ key: string; value: string | null }>
);

const changedCount = computed(() => changedEntries.value.length);

function normalizeUiValue(entry: EnrichedConfigEntry): string | null {
    if (entry.masked || entry.valueType === 'boolean') return entry.value ?? null;
    return entry.value ?? '';
}

function normalizeForSave(
    value: string | null | undefined,
    masked: boolean
): string | null {
    if (masked && value === '******') return '******';
    if (value === null || value === undefined || value === '') return null;
    return value;
}

function getEntriesForGroup(group: ConfigGroup): EnrichedConfigEntryUi[] {
    return filteredEntries.value.filter((entry) => entry.group === group);
}

function getGroupColor(group: ConfigGroup): string {
    return GROUP_COLORS[group];
}

function getGroupDescription(group: ConfigGroup): string {
    return GROUP_DESCRIPTIONS[group];
}

async function saveConfig() {
    if (!changedEntries.value.length || isSaving.value) return;
    isSaving.value = true;
    try {
        const response = await $fetch<{ ok: boolean; restartRequired?: boolean }>(
            '/api/admin/system/config/write',
            {
                method: 'POST',
                body: { entries: changedEntries.value },
                headers: { 'x-or3-admin-intent': 'admin' },
            }
        );

        restartRequired.value = response.restartRequired === true;
        originalValues.value = Object.fromEntries(
            entries.value.map((entry) => [entry.key, entry.value])
        );
        toast.add({
            title: 'Changes saved',
            description: response.restartRequired
                ? 'Restart OR3 when you are ready to apply them.'
                : 'Your settings are now up to date.',
            color: 'success',
        });
    } catch (error: unknown) {
        toast.add({
            title: 'Unable to save changes',
            description: parseErrorMessage(error, 'Failed to save configuration'),
            color: 'error',
        });
    } finally {
        isSaving.value = false;
    }
}
</script>
