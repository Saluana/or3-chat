<template>
    <div
        :class="[
            'chat-settings-popover flex w-[360px] max-w-[calc(100vw-1.5rem)] flex-col',
            containerProps?.class || '',
        ]"
        :data-theme-target="containerProps?.['data-theme-target']"
        :data-theme-matches="containerProps?.['data-theme-matches']"
    >
        <header class="chat-settings-header">
            <div class="min-w-0">
                <h2 class="chat-settings-title">Chat settings</h2>
                <p class="chat-settings-subtitle">
                    Customize how your chats work.
                </p>
            </div>
            <UButton
                v-bind="closeButtonProps"
                class="chat-settings-close"
                type="button"
                aria-label="Close chat settings"
                @click="emit('close')"
            >
                <UIcon :name="iconClose" class="size-4" />
            </UButton>
        </header>

        <div class="chat-settings-body">
            <!-- Current model: shown when the composer is too narrow for its
                 own picker. Opens the favorites dropdown directly. -->
            <USelectMenu
                v-if="containerWidth && containerWidth < 400"
                v-model="selectedModel"
                :items="modelItems"
                value-key="value"
                :search-input="modelSearchInput"
                :disabled="loading"
                aria-label="Current model"
                class="chat-settings-model-trigger ring-0!"
                :ui="selectMenuUi"
            >
                <template #default="{ open }">
                    <ModelCatalogProviderLogo
                        :slug="selectedProviderSlug"
                        :size="32"
                        :tile="true"
                    />
                    <span class="chat-settings-row-copy min-w-0">
                        <span class="chat-settings-row-title truncate">
                            {{ selectedModel || 'Select a model' }}
                        </span>
                        <span class="chat-settings-row-description truncate">
                            Current model for this chat
                        </span>
                    </span>
                    <UIcon
                        :name="iconChevronDown"
                        class="chat-settings-option-chevron size-4 shrink-0"
                        :class="{ 'is-open': open }"
                        aria-hidden="true"
                    />
                </template>
                <template #item-leading="{ item }">
                    <ModelCatalogProviderLogo :slug="item.slug" :size="20" />
                </template>
                <template #empty>
                    <UButton
                        variant="ghost"
                        size="sm"
                        block
                        class="chat-settings-popover-button"
                        @click="emit('open-model-catalog')"
                    >
                        Browse model catalog
                    </UButton>
                </template>
            </USelectMenu>

            <p class="chat-settings-heading" aria-hidden="true">Options</p>

            <div class="chat-settings-options">
                <div class="chat-settings-row-item">
                    <USelectMenu
                        v-model="modelVariant"
                        :items="variantItems"
                        value-key="value"
                        :search-input="false"
                        :disabled="loading || streaming"
                        aria-label="Model variant"
                        class="chat-settings-row-trigger ring-0! border-0 bg-transparent"
                        :ui="selectMenuUi"
                    >
                        <template #default="{ open }">
                            <span class="chat-settings-icon" aria-hidden="true">
                                <UIcon
                                    :name="iconVariantSettings"
                                    class="size-4"
                                />
                            </span>
                            <span class="chat-settings-row-title">
                                Model variant
                            </span>
                            <span class="chat-settings-option-value">
                                {{ activeVariantLabel }}
                            </span>
                            <UIcon
                                :name="iconChevronDown"
                                class="chat-settings-option-chevron size-4 shrink-0"
                                :class="{ 'is-open': open }"
                                aria-hidden="true"
                            />
                        </template>
                    </USelectMenu>
                </div>

                <div v-if="thinkingSupported" class="chat-settings-row-item">
                    <USelectMenu
                        v-model="thinkingSelection"
                        :items="thinkingItems"
                        value-key="value"
                        :search-input="false"
                        :disabled="loading || streaming"
                        aria-label="Thinking level"
                        class="chat-settings-row-trigger ring-0! border-0 bg-transparent"
                        :ui="selectMenuUi"
                    >
                        <template #default="{ open }">
                            <span class="chat-settings-icon" aria-hidden="true">
                                <UIcon :name="iconReasoning" class="size-4" />
                            </span>
                            <span class="chat-settings-row-title">
                                Thinking
                            </span>
                            <span class="chat-settings-option-value">
                                {{ thinkingValueLabel }}
                            </span>
                            <UIcon
                                :name="iconChevronDown"
                                class="chat-settings-option-chevron size-4 shrink-0"
                                :class="{ 'is-open': open }"
                                aria-hidden="true"
                            />
                        </template>
                    </USelectMenu>
                </div>
            </div>

            <!-- Tool Toggles Section -->
            <section
                v-if="registeredTools.length > 0"
                class="chat-settings-tools"
                aria-labelledby="chat-settings-tools-label"
            >
                <div class="chat-settings-section-heading">
                    <span
                        id="chat-settings-tools-label"
                        class="chat-settings-section-label"
                    >
                        Tools
                    </span>
                    <span class="chat-settings-section-count">
                        {{ registeredTools.length }}
                    </span>
                </div>
                <div class="max-h-[min(42vh,320px)] overflow-y-auto">
                    <div
                        v-for="group in groupedToolCategories"
                        :key="group.category"
                        class="chat-settings-tool-group"
                    >
                        <button
                            type="button"
                            class="chat-settings-tool-category"
                            :aria-expanded="
                                !isCategoryCollapsed(group.category)
                            "
                            :aria-controls="`tool-category-${group.category}`"
                            @click="toggleCategory(group.category)"
                        >
                            <span class="min-w-0">
                                <span class="chat-settings-row-title truncate">
                                    {{ getCategoryLabel(group.category) }}
                                </span>
                                <span
                                    v-if="
                                        getCategorySubtitle(group.category)
                                    "
                                    class="chat-settings-row-description truncate"
                                >
                                    {{
                                        getCategorySubtitle(group.category)
                                    }}
                                </span>
                            </span>
                            <span
                                class="flex shrink-0 items-center gap-2 self-center"
                            >
                                <span class="chat-settings-section-count">
                                    {{ group.tools.length }}
                                </span>
                                <UIcon
                                    :name="
                                        isCategoryCollapsed(group.category)
                                            ? iconChevronRight
                                            : iconChevronDown
                                    "
                                    class="size-4 shrink-0"
                                />
                            </span>
                        </button>

                        <div
                            v-show="!isCategoryCollapsed(group.category)"
                            :id="`tool-category-${group.category}`"
                            class="chat-settings-tool-list"
                        >
                            <div
                                v-for="tool in group.tools"
                                :key="tool.name"
                                class="chat-settings-popover-tool chat-settings-tool-row"
                            >
                                <span
                                    class="chat-settings-icon"
                                    aria-hidden="true"
                                >
                                    <UIcon
                                        :name="
                                            tool.definition.ui?.icon ||
                                            iconToolWrench
                                        "
                                        class="size-4"
                                    />
                                </span>
                                <label
                                    :for="`chat-tool-${tool.name}`"
                                    class="chat-settings-row-copy"
                                >
                                    <span class="chat-settings-row-title">
                                        {{
                                            tool.definition.ui?.label ||
                                            tool.definition.function.name
                                        }}
                                    </span>
                                    <span
                                        v-if="
                                            tool.definition.ui
                                                ?.descriptionHint ||
                                            tool.definition.function
                                                .description
                                        "
                                        :id="`tool-desc-${tool.name}`"
                                        class="chat-settings-popover-tool-description chat-settings-row-description"
                                    >
                                        {{
                                            tool.definition.ui
                                                ?.descriptionHint ||
                                            tool.definition.function
                                                .description
                                        }}
                                    </span>
                                </label>
                                <USwitch
                                    :id="`chat-tool-${tool.name}`"
                                    v-bind="
                                        getToolSwitchProps(tool.name)
                                    "
                                    class="chat-settings-control"
                                    :model-value="tool.enabledValue"
                                    :aria-label="`Enable ${
                                        tool.definition.ui?.label ||
                                        tool.definition.function.name
                                    }`"
                                    :aria-describedby="
                                        tool.definition.ui
                                            ?.descriptionHint ||
                                        tool.definition.function.description
                                            ? `tool-desc-${tool.name}`
                                            : undefined
                                    "
                                    :disabled="loading || streaming"
                                    @update:model-value="
                                        (val: boolean) => {
                                            toolRegistry.setEnabled(
                                                tool.name,
                                                val
                                            );
                                        }
                                    "
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <p class="chat-settings-heading" aria-hidden="true">More</p>

            <nav class="chat-settings-navigation" aria-label="More settings">
                <UButton
                    v-bind="systemPromptsButtonProps"
                    class="chat-settings-popover-button chat-settings-nav-button"
                    @click="emit('open-system-prompts')"
                >
                    <span class="chat-settings-icon" aria-hidden="true">
                        <UIcon :name="iconSystemPrompt" class="size-4" />
                    </span>
                    <span class="chat-settings-row-copy">
                        <span class="chat-settings-row-title">
                            System prompts
                        </span>
                        <span class="chat-settings-row-description">
                            Customize behavior and tone.
                        </span>
                    </span>
                    <UIcon
                        :name="iconChevronRight"
                        class="size-4 shrink-0 text-[var(--md-on-surface-variant)]"
                        aria-hidden="true"
                    />
                </UButton>
                <UButton
                    v-bind="modelCatalogButtonProps"
                    class="chat-settings-popover-button chat-settings-nav-button"
                    @click="emit('open-model-catalog')"
                >
                    <span class="chat-settings-icon" aria-hidden="true">
                        <UIcon :name="iconModelCatalog" class="size-4" />
                    </span>
                    <span class="chat-settings-row-copy">
                        <span class="chat-settings-row-title">
                            Model catalog
                        </span>
                        <span class="chat-settings-row-description">
                            Browse and compare available models.
                        </span>
                    </span>
                    <UIcon
                        :name="iconChevronRight"
                        class="size-4 shrink-0 text-[var(--md-on-surface-variant)]"
                        aria-hidden="true"
                    />
                </UButton>
            </nav>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useIcon } from '~/composables/useIcon';
import { useToolRegistry } from '~/utils/chat/tools-public';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { OpenRouterModelVariant } from '~~/shared/openrouter/model-variants';
import { MODEL_VARIANT_OPTIONS } from '~~/shared/openrouter/model-variants';
import { getProviderSlug } from '~/utils/modelCatalog';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useModelVariantItems } from '~/composables/chat/useModelVariantItems';
import { isMobile } from '~/state/global';
import ModelCatalogProviderLogo from '~/components/modal/model-catalog/ModelCatalogProviderLogo.vue';
import {
    applyThinkingSelection,
    getReasoningEffortDescription,
    OPENROUTER_REASONING_EFFORTS,
    resolveThinkingSelection,
    THINKING_BASIC,
    THINKING_DISABLED,
    type OpenRouterReasoningEffort,
} from '~~/shared/openrouter/reasoning';

const props = defineProps<{
    containerWidth?: number;
    loading?: boolean;
    streaming?: boolean;
    thinkingSupported?: boolean;
    reasoningEfforts?: string[];
    /** Model's default effort, so the picker matches the request. */
    reasoningDefaultEffort?: string;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'open-system-prompts'): void;
    (e: 'open-model-catalog'): void;
}>();

// Tool Registry
const toolRegistry = useToolRegistry();
const registeredTools = computed(() =>
    toolRegistry.listTools.value.map((tool) => ({
        definition: tool.definition,
        enabledValue: tool.enabled.value,
        name: tool.definition.function.name,
    }))
);

const groupedToolCategories = computed(() => {
    const groups = new Map<
        string,
        Array<
            (typeof registeredTools.value)[number]
        >
    >();

    for (const tool of registeredTools.value) {
        const category = tool.definition.ui?.category || 'Other';
        const list = groups.get(category);
        if (list) list.push(tool);
        else groups.set(category, [tool]);
    }

    return Array.from(groups.entries()).map(([category, tools]) => ({
        category,
        tools,
    }));
});

const collapsedCategories = ref(new Set<string>());
const categoryInitDone = ref(false);
const previousCategories = ref(new Set<string>());

watch(
    groupedToolCategories,
    (groups) => {
        const valid = new Set(groups.map((group) => group.category));

        // First render: collapse all categories by default.
        if (!categoryInitDone.value) {
            collapsedCategories.value = new Set(valid);
            previousCategories.value = new Set(valid);
            categoryInitDone.value = true;
            return;
        }

        // Keep previous collapse state for existing categories.
        const next = new Set<string>();
        for (const category of collapsedCategories.value) {
            if (valid.has(category)) {
                next.add(category);
            }
        }

        // New categories appear collapsed by default.
        for (const category of valid) {
            if (!previousCategories.value.has(category)) {
                next.add(category);
            }
        }

        collapsedCategories.value = next;
        previousCategories.value = new Set(valid);
    },
    { immediate: true }
);

function isCategoryCollapsed(category: string) {
    return collapsedCategories.value.has(category);
}

function toggleCategory(category: string) {
    const next = new Set(collapsedCategories.value);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    collapsedCategories.value = next;
}

function getCategoryLabel(category: string) {
    if (category === 'Tasks') return 'Task list tools';
    return `${category} tools`;
}

function getCategorySubtitle(category: string) {
    if (category === 'Tasks') {
        return 'Create, update, delete, and organize task lists/items';
    }
    return '';
}

// These will be provided by the parent component via v-model
const selectedModel = defineModel<string>('model');
const modelVariant = defineModel<OpenRouterModelVariant>('modelVariant');
const thinkingEnabled = defineModel<boolean>('thinkingEnabled');
const reasoningEffort = defineModel<string | undefined>('reasoningEffort');

// Dropdown menus read as raised panels: a light themed border instead of the
// default accent ring, matching the settings cards.
const selectMenuUi = {
    trailing: 'hidden',
    content:
        'ring-0! border-[length:var(--md-border-width)] border-[color:color-mix(in_srgb,var(--md-border-color)_45%,transparent)]',
} as const;

const iconReasoning = useIcon('chat.reasoning');
const iconVariantSettings = useIcon('chat.model.settings');
const searchIcon = useIcon('ui.search');
const iconToolWrench = useIcon('chat.tool.wrench');
const iconClose = useIcon('ui.close');
const iconChevronRight = useIcon('ui.chevron.right');
const iconChevronDown = useIcon('ui.chevron.down');
const iconSystemPrompt = useIcon('chat.system_prompt');
const iconModelCatalog = useIcon('chat.model.catalog');

// Theme overrides - Container
const containerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'settings',
        identifier: 'settings.popover-container',
        isNuxtUI: false,
    });
    return overrides.value;
});

const closeButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'settings',
        identifier: 'settings.close',
        isNuxtUI: true,
    });
    return {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        size: 'sm' as const,
        square: true,
        ...overrides.value,
    };
});

// Favorites model dropdown (narrow composers). Rows open the menu directly.
const { favoriteModels } = useModelStore();

function providerSlugFor(modelId: string): string {
    // Some upstream canonical slugs carry a leading `~`, which is not part
    // of the provider prefix.
    return getProviderSlug({ id: modelId.replace(/^~+/, '') });
}

const modelItems = computed(() =>
    (favoriteModels.value ?? [])
        .map((model) => {
            const value = model.canonical_slug ?? model.id;
            if (!value) return null;
            return { label: value, value, slug: providerSlugFor(value) };
        })
        .filter(
            (
                item
            ): item is {
                label: string;
                value: string;
                slug: string;
            } => Boolean(item)
        )
);

const selectedProviderSlug = computed(() =>
    providerSlugFor(selectedModel.value ?? '')
);

// Favorite picker: searchable when there are many favorites, matching the
// composer's model picker (no mobile autofocus so the keyboard stays shut).
const modelSearchInput = computed(() => ({
    icon: searchIcon.value,
    autofocus: !isMobile.value,
}));

// Model variant dropdown (options + descriptions from the shared helper).
const variantItems = useModelVariantItems();

const activeVariantLabel = computed(
    () =>
        MODEL_VARIANT_OPTIONS.find(
            (option) => option.value === modelVariant.value
        )?.label ?? 'Off'
);

// Thinking level select: one dropdown for Disabled / Enabled / effort.
// The underlying data model (thinkingEnabled + reasoningEffort) is unchanged,
// so drafts, send payloads, and useAi keep working as before.
const defaultEffort = computed(
    () => props.reasoningDefaultEffort as OpenRouterReasoningEffort | undefined
);

const thinkingSelection = computed<string>({
    get: () =>
        resolveThinkingSelection({
            thinkingEnabled: thinkingEnabled.value ?? false,
            reasoningEffort: reasoningEffort.value,
            efforts: reasoningEffortOptions.value,
            defaultEffort: defaultEffort.value,
        }),
    set: (value) => {
        const next = applyThinkingSelection(
            value,
            reasoningEffortOptions.value
        );
        thinkingEnabled.value = next.thinkingEnabled;
        reasoningEffort.value = next.reasoningEffort;
    },
});

function capitalizeEffort(effort: string): string {
    return effort.charAt(0).toUpperCase() + effort.slice(1);
}

const thinkingItems = computed(() => [
    {
        label: 'Disabled',
        value: THINKING_DISABLED,
        // Not every model allows reasoning to be turned off; the send path
        // simply omits reasoning config rather than forcing it off.
        description: 'Answer without reasoning where supported.',
    },
    ...(reasoningEffortOptions.value.length > 0
        ? [...reasoningEffortOptions.value]
              .sort(
                  (a, b) =>
                      OPENROUTER_REASONING_EFFORTS.indexOf(
                          a as OpenRouterReasoningEffort
                      ) -
                      OPENROUTER_REASONING_EFFORTS.indexOf(
                          b as OpenRouterReasoningEffort
                      )
              )
              .map((effort) => ({
                  label: capitalizeEffort(effort),
                  value: effort,
                  description: getReasoningEffortDescription(effort),
              }))
        : [
              {
                  label: 'Enabled',
                  value: THINKING_BASIC,
                  description: 'Let the model reason before answering.',
              },
          ]),
]);

const thinkingValueLabel = computed(
    () =>
        thinkingItems.value.find(
            (item) => item.value === thinkingSelection.value
        )?.label ?? 'Disabled'
);

const reasoningEffortOptions = computed(() =>
    Array.isArray(props.reasoningEfforts) ? props.reasoningEfforts : []
);

// Tool switch (dynamic per tool)
const getToolSwitchProps = (toolName: string) => {
    const overrides = useThemeOverrides({
        component: 'switch',
        context: 'settings',
        identifier: `settings.tool-${toolName}`,
        isNuxtUI: true,
    });
    return {
        color: 'primary' as const,
        size: 'sm' as const,
        ...overrides.value,
    };
};

// System prompts button
const systemPromptsButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'settings',
        identifier: 'settings.system-prompts',
        isNuxtUI: true,
    });
    const overrideValue: Record<string, unknown> = overrides.value || {};
    const baseClass = 'w-full';
    const mergedClass = [
        baseClass,
        typeof overrideValue.class === 'string' ? overrideValue.class : '',
    ]
        .filter(Boolean)
        .join(' ');
    return {
        variant: 'ghost' as const,
        size: 'sm' as const,
        block: true,
        ...overrideValue,
        class: mergedClass,
    };
});

// Model catalog button
const modelCatalogButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'settings',
        identifier: 'settings.model-catalog',
        isNuxtUI: true,
    });
    const overrideValue: Record<string, unknown> = overrides.value || {};
    const baseClass = 'w-full';
    const mergedClass = [
        baseClass,
        typeof overrideValue.class === 'string' ? overrideValue.class : '',
    ]
        .filter(Boolean)
        .join(' ');
    return {
        variant: 'ghost' as const,
        size: 'sm' as const,
        block: true,
        ...overrideValue,
        class: mergedClass,
    };
});
</script>

<style scoped>
.chat-settings-popover {
    --chat-settings-divider-width: var(--md-border-width-subtle, var(--md-border-width));

    overflow: hidden;
    color: var(--md-on-surface);
    background: var(--md-surface);
    border-radius: var(--md-border-radius-large, var(--md-border-radius));
}

.chat-settings-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1rem 0.875rem;
    border-bottom: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 40%, transparent);
}

.chat-settings-title {
    font-size: 1rem;
    font-weight: 650;
    line-height: 1.35;
    letter-spacing: -0.012em;
}

.chat-settings-subtitle {
    margin-top: 0.125rem;
    color: var(--md-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.4;
}

.chat-settings-close {
    flex: none;
    margin: -0.25rem -0.25rem 0 0;
}

.chat-settings-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
}

.chat-settings-tools {
    overflow: hidden;
    border: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 45%, transparent);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    background: var(--md-surface);
}

.chat-settings-heading {
    margin: 0.25rem 0 0;
    padding: 0 0.25rem;
    color: var(--md-on-surface-variant);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    line-height: 1.2;
}

/*
 * Rows are USelectMenu triggers, so their base button lives inside a child
 * component: layout is applied with :deep(). All rows share one geometry so
 * the Options and More sections line up exactly.
 */
:deep(.chat-settings-model-trigger),
:deep(.chat-settings-row-trigger) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 3.5rem;
    padding: 0.625rem 0.75rem;
    color: var(--md-on-surface);
    text-align: left;
    background: transparent;
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    cursor: pointer;
}

:deep(.chat-settings-model-trigger) {
    grid-template-columns: auto minmax(0, 1fr) auto;
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-border-color);
}

:deep(.chat-settings-model-trigger:hover),
:deep(.chat-settings-row-trigger:hover) {
    background: var(--md-surface-hover);
}

:deep(.chat-settings-model-trigger:focus-visible),
:deep(.chat-settings-row-trigger:focus-visible) {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: -2px;
}

.chat-settings-options {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

/*
 * Row dividers are drawn with a pseudo-element instead of `border-top`:
 * a border on a rounded row curves down at the ends, while the pseudo
 * element keeps the line perfectly straight.
 */
.chat-settings-row-item + .chat-settings-row-item,
.chat-settings-nav-button + .chat-settings-nav-button {
    position: relative;
}

.chat-settings-row-item + .chat-settings-row-item::before,
.chat-settings-nav-button + .chat-settings-nav-button::before {
    content: '';
    position: absolute;
    inset-inline: 0;
    top: 0;
    /* Rows are positioned (relative) buttons; without a stacking context of
       its own the divider would be painted under an opaque hover background. */
    z-index: 1;
    border-top: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 35%, transparent);
    pointer-events: none;
}

.chat-settings-option-value {
    color: var(--md-on-surface-variant);
    font-size: 0.8125rem;
    line-height: 1.3;
    white-space: nowrap;
}

.chat-settings-option-chevron {
    color: var(--md-on-surface-variant);
    transition: transform var(--app-motion-duration-fast, 150ms)
        var(--app-motion-easing-standard, ease);
}

.chat-settings-option-chevron.is-open {
    transform: rotate(180deg);
}

.chat-settings-section-label {
    color: var(--md-on-surface);
    font-size: 0.75rem;
    font-weight: 650;
    line-height: 1.2;
}

.chat-settings-row,
.chat-settings-tool-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    min-height: 3.5rem;
    padding: 0.625rem 0.75rem;
}

.chat-settings-row + .chat-settings-row {
    border-top: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 35%, transparent);
}

.chat-settings-icon {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--md-primary);
    background: color-mix(
        in srgb,
        var(--md-primary) 8%,
        var(--md-surface)
    );
    border: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-primary) 18%, transparent);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}

.chat-settings-row-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.125rem;
    text-align: left;
}

.chat-settings-row-title {
    display: block;
    color: var(--md-on-surface);
    font-size: 0.8125rem;
    font-weight: 550;
    line-height: 1.3;
}

.chat-settings-row-description {
    display: block;
    color: var(--md-on-surface-variant);
    font-size: 0.6875rem;
    font-weight: 400;
    line-height: 1.35;
}

.chat-settings-control {
    flex: none;
}

.chat-settings-section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 0.75rem;
    background: var(--md-surface-container-lowest);
    border-bottom: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 35%, transparent);
}

.chat-settings-section-count {
    min-width: 1.25rem;
    color: var(--md-on-surface-variant);
    font-size: 0.625rem;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-align: right;
}

.chat-settings-tool-group + .chat-settings-tool-group {
    border-top: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 35%, transparent);
}

.chat-settings-tool-category {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2.75rem;
    padding: 0.625rem 0.75rem;
    color: var(--md-on-surface);
    text-align: left;
    transition: background-color var(--app-motion-duration-fast, 150ms)
        var(--app-motion-easing-standard, ease);
}

.chat-settings-tool-category:hover {
    background: var(--md-surface-hover);
}

.chat-settings-tool-category:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: calc(-1 * var(--app-focus-ring-width, 2px));
}

.chat-settings-tool-list {
    background: var(--md-surface-container-lowest);
    border-top: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 30%, transparent);
}

.chat-settings-tool-row + .chat-settings-tool-row {
    border-top: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 25%, transparent);
}

.chat-settings-navigation {
    display: flex;
    flex-direction: column;
}

.chat-settings-nav-button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 3.5rem;
    padding: 0.625rem 0.75rem;
    color: var(--md-on-surface);
    border: 0;
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}

.chat-settings-nav-button:hover {
    background: var(--md-surface-hover);
}

/*
 * UButton wraps slotted content in its label span, which would lay the
 * icon/copy/chevron out with flex instead of the grid below. Collapsing
 * the wrapper keeps nav rows on the exact same grid as the option rows.
 */
.chat-settings-nav-button > [data-slot='label'] {
    display: contents;
}

@media (max-width: 640px) {
    .chat-settings-popover {
        width: min(360px, calc(100vw - 1rem));
    }

    .chat-settings-header {
        padding: 0.875rem;
    }

    .chat-settings-body {
        gap: 0.625rem;
        padding: 0.625rem;
    }
}

@media (prefers-reduced-motion: reduce) {
    .chat-settings-tool-category {
        transition-duration: 1ms;
    }

    .chat-settings-option-chevron {
        transition: none;
    }
}
</style>
