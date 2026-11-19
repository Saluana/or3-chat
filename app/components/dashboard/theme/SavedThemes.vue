<template>
    <section class="section-card space-y-3" aria-labelledby="saved-themes-heading">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1 basis-60">
                <h2 id="saved-themes-heading" class="dashboard-section-title">Saved themes</h2>
                <p class="supporting-text mt-1">
                    Save your base theme with its light and dark customizations, then switch back in one click.
                </p>
            </div>
            <UButton
                v-if="form?.mode !== 'create'"
                color="neutral"
                variant="outline"
                :icon="plusIcon"
                :disabled="!ready || pending"
                @click="openCreateForm"
            >
                Save current theme
            </UButton>
        </div>

        <form
            v-if="form"
            class="saved-theme-form"
            :aria-label="form.mode === 'create' ? 'Save current theme' : 'Rename saved theme'"
            @submit.prevent="submitForm"
            @keydown.esc.prevent="closeForm"
        >
            <UFormField :label="form.mode === 'create' ? 'Theme name' : 'New name'" :hint="`${name.trim().length}/${SAVED_THEME_NAME_LIMIT}`" class="min-w-0 grow basis-56">
                <UInput
                    ref="nameInput"
                    v-model="name"
                    class="w-full"
                    :maxlength="SAVED_THEME_NAME_LIMIT"
                    :disabled="pending"
                />
            </UFormField>
            <div class="ml-auto flex gap-2">
                <UButton color="neutral" variant="ghost" :disabled="pending" @click="closeForm">Cancel</UButton>
                <UButton type="submit" :loading="pending" :disabled="!canSubmit">
                    {{ submitLabel }}
                </UButton>
            </div>
            <p v-if="nameHint" class="saved-theme-form-hint basis-full">{{ nameHint }}</p>
        </form>

        <ul v-if="presets.length" class="saved-theme-grid" aria-label="Saved themes list">
            <li
                v-for="preset in presets"
                :key="preset.id"
                class="saved-theme-card"
                :class="{ active: preset.id === activeId, unavailable: !hasBaseTheme(preset.baseTheme) }"
            >
                <UButton
                    color="neutral"
                    variant="ghost"
                    class="saved-theme-apply"
                    :aria-label="`Apply ${preset.name}`"
                    :aria-pressed="preset.id === activeId"
                    :disabled="pending || !hasBaseTheme(preset.baseTheme)"
                    @click="apply(preset)"
                >
                    <span class="flex min-w-0 w-full items-center gap-3 text-left">
                        <span class="saved-theme-swatch" aria-hidden="true" :style="{ background: swatchFor(preset).surface }">
                            <UIcon v-if="busyId === preset.id" :name="loadingIcon" class="size-5 animate-spin" />
                            <template v-else>
                                <span
                                    v-for="(color, index) in swatchFor(preset).accents"
                                    :key="index"
                                    class="saved-theme-swatch-dot"
                                    :style="{ background: color }"
                                />
                            </template>
                        </span>
                        <span class="min-w-0 flex-1">
                            <span class="block truncate font-semibold">{{ preset.name }}</span>
                            <span class="saved-theme-meta">
                                {{ hasBaseTheme(preset.baseTheme) ? `Based on ${themeLabel(preset.baseTheme)}` : 'Base theme unavailable' }}
                            </span>
                        </span>
                        <span v-if="preset.id === activeId" class="saved-theme-badge">Active</span>
                    </span>
                </UButton>
                <UDropdownMenu :items="menuItems(preset)" :content="{ align: 'end' }">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        square
                        class="saved-theme-menu"
                        :icon="moreIcon"
                        :aria-label="`More actions for ${preset.name}`"
                        :disabled="pending"
                    />
                </UDropdownMenu>
            </li>
        </ul>
        <div v-else-if="ready && !form" class="saved-theme-empty">
            <UIcon :name="sparklesIcon" class="size-5 shrink-0" aria-hidden="true" />
            <p>No saved themes yet. Save your current look to keep it while you experiment.</p>
        </div>
        <p v-if="error || loadError" role="alert" class="text-error text-sm">{{ error || loadError }}</p>
        <div role="status" class="saved-theme-notice" :class="{ hidden: !notice }">
            <template v-if="notice">
                <UIcon :name="checkIcon" class="size-4 shrink-0 text-success" aria-hidden="true" />
                <span class="min-w-0 flex-1">{{ notice.text }}</span>
                <UButton v-if="notice.undo" size="xs" color="neutral" variant="outline" :disabled="pending" @click="notice.undo">
                    Undo
                </UButton>
            </template>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { useNuxtApp, useRuntimeConfig } from '#imports';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import {
    deleteSavedTheme,
    listSavedThemes,
    matchesSavedTheme,
    saveThemePreset,
    SAVED_THEME_NAME_LIMIT,
    type SavedTheme,
} from '~/core/theme/saved-themes';
import { readThemeSwatch } from '~/core/theme/theme-swatch';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import type { ThemePlugin } from '~/theme/_shared/types';

type Form = { mode: 'create' } | { mode: 'rename'; preset: SavedTheme };

const theme = useNuxtApp().$theme as ThemePlugin | undefined;
const branding = useRuntimeConfig().public.branding as { disabledThemes?: string[] } | undefined;
const { light, dark, activeMode, applyPreset } = useUserThemeOverrides();
const plusIcon = useIcon('ui.plus');
const moreIcon = useIcon('ui.more');
const loadingIcon = useIcon('ui.loading');
const sparklesIcon = useIcon('ui.sparkles');
const editIcon = useIcon('ui.edit');
const refreshIcon = useIcon('ui.refresh');
const trashIcon = useIcon('ui.trash');
const checkIcon = useIcon('ui.check');

const presets = shallowRef<SavedTheme[]>([]);
const form = ref<Form>();
const name = ref('');
const nameInput = ref<{ inputRef?: HTMLInputElement }>();
const pending = ref(false);
const busyId = ref<string>();
const ready = ref(false);
const error = ref('');
const loadError = ref('');
const themeCss = reactive<Record<string, string>>({});
const notice = ref<{ text: string; undo?: () => void }>();
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let subscription: Subscription | undefined;
let unsubscribeWorkspace: (() => void) | undefined;

const current = () => ({
    name: '',
    baseTheme: theme?.activeTheme.value ?? '',
    light: light.value,
    dark: dark.value,
});
const activeId = computed(() => presets.value.find(preset => matchesSavedTheme(preset, current()))?.id);

const trimmedName = computed(() => name.value.trim());
const nameMatch = computed(() => presets.value.find(preset =>
    preset.name.toLocaleLowerCase() === trimmedName.value.toLocaleLowerCase()
    && !(form.value?.mode === 'rename' && form.value.preset.id === preset.id)));
const nameHint = computed(() => {
    if (!nameMatch.value) return '';
    return form.value?.mode === 'create'
        ? `This replaces the saved theme “${nameMatch.value.name}”.`
        : 'Another saved theme already uses this name.';
});
const canSubmit = computed(() => !!trimmedName.value && !pending.value
    && !(form.value?.mode === 'rename' && (nameMatch.value || trimmedName.value === form.value.preset.name)));
const submitLabel = computed(() => form.value?.mode === 'rename' ? 'Rename' : nameMatch.value ? 'Replace' : 'Save');

function hasBaseTheme(baseTheme: string) {
    return theme?.availableThemes?.some(entry => entry.name === baseTheme) === true
        && !branding?.disabledThemes?.includes(baseTheme);
}

function themeLabel(baseTheme: string) {
    const entry = theme?.availableThemes?.find(item => item.name === baseTheme);
    return entry?.displayName || baseTheme.charAt(0).toUpperCase() + baseTheme.slice(1);
}

/** The preset's own colors in the active mode, over its base theme's. */
function swatchFor(preset: SavedTheme) {
    const base = readThemeSwatch(themeCss[preset.baseTheme] ?? '', activeMode.value);
    const colors = preset[activeMode.value].colors;
    if (!colors?.enabled) return base;
    return {
        surface: colors.surface || base.surface,
        accents: (['primary', 'secondary', 'tertiary'] as const).map((key, index) => colors[key] || base.accents[index]).filter(Boolean),
    };
}

function loadThemeCss(items: SavedTheme[]) {
    for (const baseTheme of new Set(items.map(item => item.baseTheme))) {
        if (baseTheme in themeCss || !hasBaseTheme(baseTheme)) continue;
        themeCss[baseTheme] = '';
        void theme?.loadTheme(baseTheme)
            .then((compiled) => { themeCss[baseTheme] = compiled?.cssVariables ?? ''; })
            .catch(() => undefined);
    }
}

function currentWorkspace() {
    const db = getDb();
    const generation = getWorkspaceGeneration();
    return { db, isCurrent: () => db === getDb() && generation === getWorkspaceGeneration() };
}

function watchWorkspacePresets() {
    subscription?.unsubscribe();
    const { db, isCurrent } = currentWorkspace();
    presets.value = [];
    ready.value = false;
    pending.value = false;
    busyId.value = undefined;
    error.value = loadError.value = '';
    showNotice(undefined);
    closeForm();
    subscription = liveQuery(() => listSavedThemes(db)).subscribe({
        next: (items) => {
            if (!isCurrent()) return;
            presets.value = items;
            loadThemeCss(items);
            ready.value = true;
        },
        error: () => {
            if (isCurrent()) loadError.value = 'Could not load saved themes.';
        },
    });
}

onMounted(() => {
    watchWorkspacePresets();
    unsubscribeWorkspace = subscribeActiveWorkspaceDb(watchWorkspacePresets);
});
onUnmounted(() => {
    subscription?.unsubscribe();
    unsubscribeWorkspace?.();
    clearTimeout(noticeTimer);
});

/** Success feedback stays inside the dialog; an undo offer lasts longer than a plain confirmation. */
function showNotice(next: typeof notice.value) {
    clearTimeout(noticeTimer);
    notice.value = next;
    if (next) noticeTimer = setTimeout(() => { notice.value = undefined; }, next.undo ? 10_000 : 4_000);
}

async function openForm(next: Form, initialName: string) {
    form.value = next;
    name.value = initialName;
    error.value = '';
    await nextTick();
    nameInput.value?.inputRef?.focus();
    nameInput.value?.inputRef?.select();
}

function openCreateForm() {
    const base = themeLabel(theme?.activeTheme.value ?? '').replace(/\s+theme$/i, '');
    const taken = new Set(presets.value.map(preset => preset.name.toLocaleLowerCase()));
    let suggestion = `My ${base}`;
    for (let n = 2; taken.has(suggestion.toLocaleLowerCase()); n++) suggestion = `My ${base} ${n}`;
    void openForm({ mode: 'create' }, suggestion);
}

function closeForm() {
    form.value = undefined;
    name.value = '';
}

/** Run one guarded write; errors and success both report inline. */
async function run(id: string | undefined, task: (ws: ReturnType<typeof currentWorkspace>) => Promise<string | void>, failure: string) {
    if (!theme || pending.value) return;
    const ws = currentWorkspace();
    pending.value = true;
    busyId.value = id;
    error.value = '';
    showNotice(undefined);
    try {
        const success = await task(ws);
        if (ws.isCurrent() && success) showNotice({ text: success });
    } catch (cause) {
        if (ws.isCurrent()) {
            error.value = cause instanceof Error && 'rpcCode' in cause && cause.rpcCode === 'conflict'
                ? 'This saved theme changed. Reopen it and try again.'
                : failure;
        }
    } finally {
        if (ws.isCurrent()) {
            pending.value = false;
            busyId.value = undefined;
        }
    }
}

function submitForm() {
    if (!canSubmit.value || !form.value) return;
    const presetName = trimmedName.value;
    const active = form.value;
    if (active.mode === 'rename') {
        const { id, revision, ...preset } = active.preset;
        return run(id, async ({ db, isCurrent }) => {
            await saveThemePreset(db, { ...preset, name: presetName }, { isValid: isCurrent, ifClock: revision }, id);
            if (!isCurrent()) return;
            closeForm();
            return `Renamed to “${presetName}”.`;
        }, 'Could not rename the saved theme.');
    }
    const replacing = nameMatch.value;
    return run(replacing?.id, async ({ db, isCurrent }) => {
        await saveThemePreset(db, { ...current(), name: replacing?.name ?? presetName }, { isValid: isCurrent, ifClock: replacing?.revision ?? null }, replacing?.id);
        if (!isCurrent()) return;
        closeForm();
        return `Saved “${replacing?.name ?? presetName}”.`;
    }, 'Could not save the current theme.');
}

function apply(preset: SavedTheme) {
    if (preset.id === activeId.value) return;
    return run(preset.id, async ({ isCurrent }) => {
        await theme!.setActiveTheme(preset.baseTheme, isCurrent);
        if (!isCurrent()) return;
        if (theme!.activeTheme.value !== preset.baseTheme) throw new Error('Base theme did not load');
        applyPreset(preset.light, preset.dark);
        return `Applied “${preset.name}”.`;
    }, `Could not apply “${preset.name}”.`);
}

function update(preset: SavedTheme) {
    return run(preset.id, async ({ db, isCurrent }) => {
        await saveThemePreset(db, { ...current(), name: preset.name }, { isValid: isCurrent, ifClock: preset.revision }, preset.id);
        if (isCurrent()) return `Updated “${preset.name}” with your current look.`;
    }, `Could not update “${preset.name}”.`);
}

function remove(preset: SavedTheme) {
    const { id, ...value } = preset;
    return run(id, async ({ db, isCurrent }) => {
        await deleteSavedTheme(db, preset, { isValid: isCurrent });
        if (!isCurrent()) return;
        if (form.value?.mode === 'rename' && form.value.preset.id === id) closeForm();
        showNotice({
            text: `Deleted “${preset.name}”.`,
            undo: () => run(id, async () => {
                await saveThemePreset(db, value, { isValid: isCurrent, ifClock: null }, id);
                if (isCurrent()) return `Restored “${preset.name}”.`;
            }, `Could not restore “${preset.name}”.`),
        });
    }, `Could not delete “${preset.name}”.`);
}

function menuItems(preset: SavedTheme) {
    return [
        [
            {
                label: 'Update with current look',
                icon: refreshIcon.value,
                disabled: preset.id === activeId.value,
                onSelect: () => update(preset),
            },
            { label: 'Rename', icon: editIcon.value, onSelect: () => openForm({ mode: 'rename', preset }, preset.name) },
        ],
        [{ label: 'Delete', icon: trashIcon.value, color: 'error' as const, onSelect: () => remove(preset) }],
    ];
}
</script>

<style scoped>
.saved-theme-form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.5rem 0.75rem;
    padding: 0.75rem;
    background: var(--md-surface-container-low, var(--md-surface));
    border: max(var(--md-border-width, 0px), 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
.saved-theme-form-hint {
    color: color-mix(in srgb, var(--md-on-surface) 75%, var(--md-surface));
    font-size: 0.8rem;
}
.saved-theme-grid {
    display: grid;
    gap: 0.75rem;
}
.saved-theme-card {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: center;
    color: var(--md-on-surface);
    background: var(--md-surface);
    border: max(var(--md-border-width, 0px), 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
    transition:
        background-color var(--app-motion-duration-fast, 120ms) var(--app-motion-easing-standard, ease),
        border-color var(--app-motion-duration-fast, 120ms) var(--app-motion-easing-standard, ease);
}
.saved-theme-card:not(.unavailable):hover {
    background: var(--md-surface-hover, var(--md-surface-container-high, var(--md-surface)));
    border-color: var(--md-primary);
}
.saved-theme-card.active {
    border-color: var(--md-primary);
    box-shadow: inset 0 0 0 max(var(--md-border-width, 0px), 1px) var(--md-primary);
}
.saved-theme-card.unavailable {
    opacity: 0.65;
}
.saved-theme-apply {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 4.5rem;
    padding: 0.75rem 0.25rem 0.75rem 0.75rem;
    color: inherit !important;
    background: transparent !important;
    text-transform: none;
}
.saved-theme-apply :deep([data-slot='label']) {
    width: 100%;
    min-width: 0;
    color: inherit !important;
}
.saved-theme-apply:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid var(--md-focus-ring, var(--md-primary));
    outline-offset: calc(-1 * var(--app-focus-ring-width, 2px));
}
.saved-theme-card.active .saved-theme-apply {
    cursor: default;
}
.saved-theme-menu {
    flex: 0 0 auto;
    margin-right: 0.5rem;
}
.saved-theme-swatch {
    display: flex;
    width: 2.75rem;
    height: 2.75rem;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    background: var(--md-surface-container-high, var(--md-surface-variant));
    border: max(var(--md-border-width, 0px), 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
.saved-theme-swatch-dot {
    width: 0.55rem;
    height: 1.4rem;
    border-radius: var(--md-border-radius-small, 0.25rem);
}
.saved-theme-meta {
    display: block;
    margin-top: 0.15rem;
    color: color-mix(in srgb, var(--md-on-surface) 75%, var(--md-surface));
    font-size: 0.75rem;
    font-weight: 400;
}
.saved-theme-badge {
    flex: 0 0 auto;
    padding: 0.2rem 0.4rem;
    color: var(--md-on-primary);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: var(--md-primary);
    border-radius: var(--md-border-radius-small);
}
.saved-theme-notice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
}
.saved-theme-empty {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.9rem 1rem;
    color: color-mix(in srgb, var(--md-on-surface) 80%, var(--md-surface));
    font-size: 0.875rem;
    border: max(var(--md-border-width, 0px), 1px) dashed var(--md-border-color);
    border-radius: var(--md-border-radius);
}
@media (min-width: 640px) {
    .saved-theme-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
