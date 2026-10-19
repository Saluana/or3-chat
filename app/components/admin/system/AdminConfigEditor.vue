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

            <UAlert v-else-if="configError" color="error" title="Could not load settings" description="Try again to load the current settings.">
                <template #actions><UButton color="neutral" variant="soft" @click="refreshConfig()">Try again</UButton></template>
            </UAlert>
            <template v-else>
                <UAlert v-if="variant !== 'advanced' && hasEditableEntries" color="neutral" variant="soft" title="No restart needed." description="Save to apply these settings to newly loaded pages. Refresh other open tabs to see the changes." />
                <UAlert v-if="!isOwner && hasEditableEntries" color="neutral" title="Only the site owner can save these settings." />
                <UAlert v-if="saveError" role="alert" color="error" title="Changes were not saved" :description="saveError">
                    <template v-if="saveConflict" #actions>
                        <UButton color="neutral" variant="soft" :disabled="isSaving" @click="reloadSavedSettings">Reload saved settings</UButton>
                    </template>
                </UAlert>
                <UAlert v-if="savedMessage" role="status" color="success" title="Changes saved" :description="savedMessage">
                    <template v-if="variant !== 'advanced'" #actions><UButton color="neutral" variant="soft" @click="reloadNuxtApp({ force: true })">Reload this page</UButton></template>
                </UAlert>
                <section v-if="variant !== 'advanced' && entries.length && !hasEditableEntries" class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-4 space-y-2">
                    <h3 class="font-medium">Managed outside the dashboard</h3>
                    <p class="text-sm opacity-70">You can review these settings here. To change them, the person who maintains your OR3 installation needs to update the site configuration and rebuild the app. Restarting alone will not apply the changes.</p>
                    <UButton to="/documentation/cloud/configure" color="neutral" variant="link" class="px-0">How to change site settings</UButton>
                </section>
                <p v-else-if="variant === 'advanced'" class="text-sm opacity-70">Infrastructure settings marked View only cannot be saved here. Use UI & Branding, Features, or Registration to edit those settings.</p>
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
                                    <div class="flex flex-wrap items-center gap-2 text-sm font-medium">{{ entry.label }} <UBadge v-if="variant === 'advanced'" size="xs" color="neutral" variant="subtle">{{ applicationLabels[entry.application] }}</UBadge></div>
                                    <p :id="`help-${entry.key}`" class="mt-1 text-sm leading-relaxed opacity-70">
                                        {{ entry.description }}
                                    </p>
                                    <p v-if="dependencyMessage(entry.key)" class="mt-1 text-xs text-[var(--md-sys-color-on-surface-variant)]">{{ dependencyMessage(entry.key) }}</p>
                                    <code
                                        v-if="variant === 'advanced'"
                                        class="mt-1.5 inline-block font-mono text-[11px] opacity-40"
                                    >
                                        {{ entry.key }}
                                    </code>
                                </div>

                                <UBadge v-if="variant === 'features' && entry.valueType === 'boolean' && !entry.editable" :color="entry.value === 'true' ? 'success' : 'neutral'" variant="subtle" class="mt-3 shrink-0 sm:mt-0">
                                    {{ entry.value === null ? 'Not configured' : entry.value === 'true' ? 'Enabled' : 'Disabled' }}
                                </UBadge>
                                <USwitch
                                    v-else-if="variant === 'features' && entry.valueType === 'boolean' && !entry.masked"
                                    :model-value="entry.value === 'true'"
                                    :disabled="isSaving || !isOwner || !entry.editable"
                                    :aria-label="entry.label"
                                    :aria-describedby="`help-${entry.key}`"
                                    class="mt-3 sm:mt-0"
                                    @update:model-value="entry.value = $event ? 'true' : 'false'"
                                />
                                <USelectMenu
                                    v-else-if="entry.key === 'OR3_DEFAULT_THEME' || entry.key === 'OR3_DISABLED_THEMES'"
                                    :model-value="entry.key === 'OR3_DISABLED_THEMES' ? (entry.value?.split(',').filter(Boolean) ?? []) : entry.value ?? undefined"
                                    :multiple="entry.key === 'OR3_DISABLED_THEMES'"
                                    :items="configData?.themes ?? []"
                                    value-key="value"
                                    :placeholder="entry.key === 'OR3_DISABLED_THEMES' ? 'No hidden themes' : 'Choose a theme'"
                                    :disabled="isSaving || !isOwner || !entry.editable"
                                    :aria-label="entry.label"
                                    :aria-describedby="`help-${entry.key}`"
                                    class="w-full sm:max-w-xl"
                                    @update:model-value="entry.value = Array.isArray($event) ? $event.join(',') : $event ?? null"
                                />
                                <USelectMenu
                                    v-else-if="entry.valueType === 'boolean' && !entry.masked"
                                    :model-value="entry.value ?? undefined"
                                    :items="booleanItems"
                                    value-key="value"
                                    size="sm"
                                    :disabled="isSaving || !isOwner || !entry.editable"
                                    :aria-label="entry.label"
                                    :aria-describedby="`help-${entry.key}`"
                                    class="w-full"
                                    @update:model-value="entry.value = $event == null ? null : String($event)"
                                />
                                <UInput
                                    v-else
                                    :model-value="entry.value ?? undefined"
                                    :type="entry.valueType === 'number' ? 'number' : 'text'"
                                    :min="entry.valueType === 'number' ? 1 : undefined"
                                    :max="entry.key === 'OR3_DEFAULT_PANE_COUNT' ? 4 : entry.key === 'OR3_MAX_PANES' ? 8 : undefined"
                                    :step="entry.valueType === 'number' ? 1 : undefined"
                                    :placeholder="entry.masked ? 'Leave unchanged' : ''"
                                    size="sm"
                                    :disabled="isSaving || !isOwner || !entry.editable"
                                    :aria-label="entry.label"
                                    :aria-describedby="`help-${entry.key}`"
                                    class="w-full"
                                    @update:model-value="entry.value = $event == null ? null : String($event)"
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

                <div v-if="hasEditableEntries" class="sticky bottom-0 z-10 -mx-4 border-t-[length:var(--md-border-width-subtle,var(--md-border-width,1px))] border-[var(--md-outline-variant)] bg-[var(--md-surface)]/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:flex sm:items-center sm:justify-between sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
                    <p class="mb-3 text-xs opacity-60 sm:mb-0">
                        <template v-if="changedCount">
                            {{ changedCount }} unsaved {{ changedCount === 1 ? 'change' : 'changes' }}
                        </template>
                        <template v-else>Everything is up to date.</template>
                    </p>
                    <UButton v-if="changedCount" color="neutral" variant="ghost" :disabled="isSaving" @click="discardChanges">
                        Discard changes
                    </UButton>
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
import { reloadNuxtApp } from '#app';
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
const { data: configData, status: configFetchStatus, error: configError, refresh: refreshConfig } = useAdminSystemConfigEnriched();

const entries = ref<EnrichedConfigEntryUi[]>([]);
const originalValues = ref<Record<string, string | null | undefined>>({});
const restartRequired = ref(false);
const saveError = ref('');
const saveConflict = ref(false);
const savedMessage = ref('');
const isSaving = ref(false);
const searchQuery = ref('');
const editingRevision = ref<string | null>(null);
const draftKey = `or3:admin:config-draft:${props.variant}:${props.groups.join(',')}`;
let restoredDraft = false;

const isOwner = computed(() => statusData.value?.session?.role === 'owner');
const pending = computed(() => !configData.value && configFetchStatus.value !== 'error');
const hasEditableEntries = computed(() => entries.value.some(entry => entry.editable));
const applicationLabels = { runtime: 'Applies immediately', restart: 'Restart required', build: 'New build required', unsupported: 'View only' };

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
    'UI & Branding': 'Site name, appearance, layout, and policy links',
    Features: 'Choose what people can use. Turning a tool off keeps existing content.',
    'Limits & Security': 'Network trust, rate limits, and usage controls',
    'Background Processing': 'Job providers, concurrency, and timeouts',
    Admin: 'Admin routing, lifecycle controls, and extension safety',
    'External Services': 'OpenRouter and other service connections',
};

function applyEntries(next: EnrichedConfigEntry[] | undefined, discard = false) {
        if (!next) return;
        if (!discard && entries.value.some(entry => entry.editable && normalizeForSave(entry.value, entry.masked) !== normalizeForSave(originalValues.value[entry.key], entry.masked))) return;
        const selected = next
            .filter((entry) => props.groups.includes(entry.group))
            .map((entry) => ({
                ...entry,
                value: normalizeUiValue(entry),
                editable: entry.editable && !(props.variant === 'advanced' && entry.application === 'runtime'),
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
        editingRevision.value = props.variant === 'advanced' ? configData.value?.savedRevision ?? null : configData.value?.siteRevision ?? null;
        if (!restoredDraft && typeof sessionStorage !== 'undefined') {
            restoredDraft = true;
            try {
                const saved: unknown = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
                if (saved && typeof saved === 'object' && 'expiresAt' in saved && typeof saved.expiresAt === 'number' && saved.expiresAt > Date.now()
                    && 'revision' in saved && typeof saved.revision === 'string' && saved.revision.length <= 128
                    && 'allowRestart' in saved && (saved.allowRestart === null || saved.allowRestart === 'true' || saved.allowRestart === 'false')) {
                    const entry = entries.value.find(entry => entry.key === 'OR3_ADMIN_ALLOW_RESTART' && entry.editable);
                    if (entry) { entry.value = saved.allowRestart; editingRevision.value = saved.revision; }
                }
            } catch { /* Non-secret draft storage is optional. */ }
        }
}
watch(
    () => configData.value?.entries,
    next => applyEntries(next),
    { immediate: true }
);
watch(() => entries.value.map(entry => entry.value), () => {
    savedMessage.value = '';
    saveError.value = '';
    saveConflict.value = false;
    if (!restoredDraft || typeof sessionStorage === 'undefined') return;
    const entry = entries.value.find(entry => entry.key === 'OR3_ADMIN_ALLOW_RESTART' && entry.editable);
    try {
        if (entry && entry.value !== originalValues.value[entry.key] && editingRevision.value) {
            sessionStorage.setItem(draftKey, JSON.stringify({ allowRestart: entry.value, revision: editingRevision.value, expiresAt: Date.now() + 30 * 60_000 }));
        } else sessionStorage.removeItem(draftKey);
    } catch { /* Never persist masked values or credentials. */ }
});
function discardChanges() {
    try { sessionStorage.removeItem(draftKey); } catch { /* Optional browser draft. */ }
    applyEntries(configData.value?.entries, true);
}

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
        .filter(entry => entry.editable)
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

async function reloadSavedSettings() {
    await refreshConfig();
    discardChanges();
    saveError.value = '';
    saveConflict.value = false;
}

function dependencyMessage(key: string): string {
    const off = (setting: string) => entries.value.find(entry => entry.key === setting)?.value === 'false';
    if (key.startsWith('OR3_WORKFLOWS_') && key !== 'OR3_WORKFLOWS_ENABLED' && off('OR3_WORKFLOWS_ENABLED')) return 'Available when Workflows is turned on. Your choice is kept.';
    if (key.startsWith('OR3_MENTIONS_') && key !== 'OR3_MENTIONS_ENABLED' && off('OR3_MENTIONS_ENABLED')) return 'Available when Chat references is turned on. Your choice is kept.';
    if (key === 'OR3_MENTIONS_DOCUMENTS' && off('OR3_DOCUMENTS_ENABLED')) return 'Available when Documents is turned on. Your choice is kept.';
    return '';
}

async function saveConfig() {
    if (!changedEntries.value.length || isSaving.value) return;
    isSaving.value = true;
    saveError.value = '';
    savedMessage.value = '';
    saveConflict.value = false;
    try {
        const response = await $fetch<{ ok: boolean; restartRequired?: boolean; savedRevision: string }>(
            '/api/admin/system/config/write',
            {
                method: 'POST',
                body: { entries: changedEntries.value, expectedRevision: editingRevision.value },
                headers: { 'x-or3-admin-intent': 'admin' },
            }
        );

        restartRequired.value = response.restartRequired === true;
        originalValues.value = Object.fromEntries(
            entries.value.map((entry) => [entry.key, entry.value])
        );
        editingRevision.value = response.savedRevision;
        try { sessionStorage.removeItem(draftKey); } catch { /* Optional browser draft. */ }
        await refreshConfig();
        savedMessage.value = response.restartRequired
            ? 'Restart OR3 when you are ready to apply them.'
            : 'Your settings will appear when pages reload. No restart needed.';
        toast.add({
            title: 'Changes saved',
            description: response.restartRequired
                ? 'Restart OR3 when you are ready to apply them.'
                : 'Reload this page or other open tabs to see your changes.',
            color: 'success',
        });
    } catch (error: unknown) {
        const failure = error as { status?: number; data?: { statusMessage?: string; data?: { code?: string } } };
        const code = failure.data?.data?.code;
        saveConflict.value = code === 'stale_revision';
        saveError.value = code === 'invalid_setting' && failure.data?.statusMessage
            ? failure.data.statusMessage
            : code === 'stale_revision'
                ? 'Someone else saved settings while you were editing. Reload saved settings to review their changes, then try again. Your draft is still here until you reload.'
                : code === 'settings_busy' ? 'Another save is in progress. Try again.'
                : parseErrorMessage(error, 'Please try again. Your changes are still here.');
        toast.add({
            title: 'Unable to save changes',
            description: saveError.value,
            color: 'error',
        });
    } finally {
        isSaving.value = false;
    }
}
</script>
