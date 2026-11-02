<template>
    <div
        ref="root"
        :class="[
            'chat-settings-popover flex w-[360px] max-w-[calc(100vw-1.5rem)] flex-col',
            containerProps?.class || '',
        ]"
        :data-theme-target="containerProps?.['data-theme-target']"
        :data-theme-matches="containerProps?.['data-theme-matches']"
        :style="lockedHeight ? { height: `${lockedHeight}px` } : undefined"
    >
        <header class="chat-settings-header">
            <button
                v-if="toolsView"
                ref="backButton"
                type="button"
                class="chat-settings-back"
                :aria-label="activeGroup ? 'Back to tools' : 'Back to chat settings'"
                @click="backToSettings"
            >
                <UIcon :name="iconChevronLeft" class="size-4" />
            </button>
            <h2 class="chat-settings-title">
                {{
                    activeGroup
                        ? getCategoryLabel(activeGroup.category)
                        : toolsView ? 'Tools' : 'Chat settings'
                }}
            </h2>
            <UButton
                v-bind="closeButtonProps"
                class="chat-settings-close"
                type="button"
                aria-label="Close chat settings"
                @click="emit('close')"
            >
                <UIcon :name="iconClose" class="size-4" />
            </UButton>
            <p v-if="toolsView" class="chat-settings-subtitle">
                {{
                    !toolPreferences.preferences.value.enabled
                        ? 'Tools are off. Your selection is remembered.'
                        : activeGroup ? `${activeGroup.tools.length} tools` : 'Choose a tool category.'
                }}
            </p>
        </header>

        <p v-if="toolPreferences.error.value" role="alert" class="px-4 py-2 text-sm text-error">{{ toolPreferences.error.value }}</p>
        <div
            v-show="!toolsView"
            class="chat-settings-body"
            :class="{ 'chat-settings-view-enter is-back': hasNavigated && !activeGroup }"
        >
            <section class="chat-settings-section">
                <h3 class="chat-settings-heading">Chat</h3>
                <div class="chat-settings-group">
                    <UButton
                        v-if="(isMobile || !containerWidth || containerWidth <= 400) && !modelItems.length"
                        variant="ghost"
                        color="neutral"
                        aria-label="Current model"
                        class="chat-settings-model-trigger ring-0! w-full px-3.5!"
                        :disabled="loading"
                        @click="emit('open-model-catalog')"
                    >
                        <span class="chat-settings-icon" aria-hidden="true">
                            <ModelCatalogProviderLogo :slug="selectedProviderSlug" :size="18" />
                        </span>
                        <span class="chat-settings-row-copy min-w-0 text-left">
                            <span class="chat-settings-row-title truncate">{{ selectedModelLabel }}</span>
                            <span class="chat-settings-row-description truncate">Browse available models</span>
                        </span>
                        <UIcon :name="iconChevronDown" class="chat-settings-option-chevron size-4 shrink-0" aria-hidden="true" />
                    </UButton>
                    <!-- Favorites stay one click away; fresh accounts open the catalog. -->
                    <USelectMenu
                        v-else-if="isMobile || !containerWidth || containerWidth <= 400"
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
                            <span class="chat-settings-icon" aria-hidden="true">
                                <ModelCatalogProviderLogo :slug="selectedProviderSlug" :size="18" />
                            </span>
                            <span class="chat-settings-row-copy min-w-0">
                                <span class="chat-settings-row-title truncate">
                                    {{ selectedModelLabel }}
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

                    <USelectMenu
                        :model-value="promptSelection"
                        :items="promptItems"
                        value-key="value"
                        :search-input="promptSearchInput"
                        :disabled="loading || streaming || promptSaving || promptLoading"
                        aria-label="System prompt for this chat"
                        class="chat-settings-model-trigger ring-0!"
                        :ui="selectMenuUi"
                        @update:model-value="selectPrompt"
                    >
                        <template #default="{ open }">
                            <span class="chat-settings-icon" aria-hidden="true">
                                <UIcon :name="iconSystemPrompt" class="size-4" />
                            </span>
                            <span class="chat-settings-row-copy min-w-0">
                                <span class="chat-settings-row-title truncate">
                                    {{ selectedPromptLabel }}
                                </span>
                                <span class="chat-settings-row-description truncate">
                                    System prompt for this chat
                                </span>
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

                <UButton
                    v-if="threadId && modelInherited === false"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="self-start"
                    :disabled="loading || streaming"
                    :label="projectModelDefault ? 'Use project default' : 'Use default model'"
                    @click="emit('use-default-model')"
                />
                <p v-if="promptError" class="m-0 px-1.5 text-xs text-error" role="alert">
                    {{ promptError }}
                </p>
            </section>

            <section v-if="contextState" class="chat-settings-section">
                <h3 class="chat-settings-heading">Memory</h3>
                <ChatMemorySettings :state="contextState" :thread-id="threadId"
                    :compaction-state="compactionState" :blocked-reason="compactionBlockedReason"
                    @compact="emit('compact')" @cancel="emit('cancel-compaction')"
                    @close="emit('close')" />
            </section>

            <section class="chat-settings-section">
                <h3 class="chat-settings-heading">Preferences</h3>
                <div class="chat-settings-group">
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
                    <div v-if="registeredTools.length" class="chat-settings-row-item chat-settings-tools-row">
                        <button ref="toolsButton" type="button" class="chat-settings-row-trigger" @click="openTools">
                            <span class="chat-settings-icon" aria-hidden="true"><UIcon :name="iconToolWrench" class="size-4" /></span>
                            <span class="chat-settings-row-title">Tools</span>
                            <span class="chat-settings-tool-value" aria-hidden="true" />
                            <UIcon :name="iconChevronRight" class="chat-settings-option-chevron size-4 shrink-0" aria-hidden="true" />
                        </button>
                        <USwitch
                            class="chat-settings-control chat-settings-tools-toggle"
                            color="primary"
                            size="sm"
                            aria-label="Enable tools for this chat"
                            :model-value="toolPreferences.preferences.value.enabled"
                            :disabled="toolControlsDisabled"
                            @update:model-value="toolPreferences.setEnabled"
                        />
                    </div>
                </div>
            </section>

            <nav class="chat-settings-section" aria-label="Library">
                <h3 class="chat-settings-heading" aria-hidden="true">Library</h3>
                <div class="chat-settings-group">
                    <UButton
                        v-bind="systemPromptsButtonProps"
                        class="chat-settings-popover-button chat-settings-nav-button px-3.5!"
                        @click="emit('open-system-prompts')"
                    >
                        <span class="chat-settings-icon" aria-hidden="true">
                            <UIcon :name="iconSystemPrompt" class="size-4" />
                        </span>
                        <span class="chat-settings-row-copy">
                            <span class="chat-settings-row-title">
                                Manage system prompts
                            </span>
                            <span class="chat-settings-row-description">
                                Customize behavior and tone.
                            </span>
                        </span>
                        <UIcon
                            :name="iconChevronRight"
                            class="chat-settings-option-chevron size-4 shrink-0"
                            aria-hidden="true"
                        />
                    </UButton>
                    <UButton
                        v-bind="modelCatalogButtonProps"
                        class="chat-settings-popover-button chat-settings-nav-button px-3.5!"
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
                            class="chat-settings-option-chevron size-4 shrink-0"
                            aria-hidden="true"
                        />
                    </UButton>
                </div>
            </nav>
        </div>
        <div v-if="toolsView && !activeGroup" class="chat-settings-body chat-settings-view-enter" :class="{ 'is-back': hasNavigated }">
            <!-- Tool categories open a dedicated view with one scroll area. -->
            <section
                v-if="registeredTools.length > 0"
                class="chat-settings-section"
                aria-labelledby="chat-settings-tools-label"
            >
                <div class="chat-settings-section-heading">
                    <span id="chat-settings-tools-label" class="chat-settings-heading">Tools</span>
                    <span class="chat-settings-section-count">{{ registeredTools.length }}</span>
                </div>
                <div class="chat-settings-group">
                    <button
                        v-for="group in groupedToolCategories"
                        :key="group.category"
                        type="button"
                        class="chat-settings-tool-category"
                        @click="openToolCategory(group.category, $event)"
                    >
                        <span class="min-w-0">
                            <span class="chat-settings-row-title truncate">
                                {{ getCategoryLabel(group.category) }}
                            </span>
                            <span
                                v-if="getCategorySubtitle(group.category)"
                                class="chat-settings-row-description truncate"
                            >
                                {{ getCategorySubtitle(group.category) }}
                            </span>
                        </span>
                        <span class="flex shrink-0 items-center gap-2 self-center">
                            <span class="chat-settings-section-count">{{ group.tools.length }}</span>
                            <UIcon :name="iconChevronRight" class="chat-settings-option-chevron size-4 shrink-0" />
                        </span>
                    </button>
                </div>
            </section>

        </div>
        <div v-if="activeGroup" class="chat-settings-body chat-settings-view-enter">
            <div class="chat-settings-bulk-row">
                <div class="chat-settings-row-copy">
                    <label for="chat-tools-all" class="chat-settings-row-title">
                        All tools
                    </label>
                    <span
                        id="chat-tools-enabled-count"
                        class="chat-settings-row-description"
                    >
                        {{ enabledGroupToolCount }} of {{ activeGroup.tools.length }} selected
                    </span>
                </div>
                <USwitch
                    id="chat-tools-all"
                    class="chat-settings-control"
                    color="primary"
                    size="sm"
                    :model-value="allGroupToolsEnabled"
                    aria-describedby="chat-tools-enabled-count"
                    :disabled="toolControlsDisabled"
                    @update:model-value="setGroupToolsEnabled"
                />
            </div>
            <div class="chat-settings-group">
                <div
                    v-for="tool in activeGroup.tools"
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
                        :disabled="toolControlsDisabled"
                        @update:model-value="(val: boolean) => toolPreferences.setTools({ [tool.name]: val })"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import ChatMemorySettings from './ChatMemorySettings.vue';
import { computed, nextTick, ref, watch } from 'vue';
import { useIcon } from '~/composables/useIcon';
import { useToolRegistry } from '~/utils/chat/tools-public';
import { useChatToolPreferences } from '~/composables/chat/useChatToolPreferences';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { OpenRouterModelVariant } from '~~/shared/openrouter/model-variants';
import { MODEL_VARIANT_OPTIONS } from '~~/shared/openrouter/model-variants';
import { getProviderSlug } from '~/utils/modelCatalog';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useModelVariantItems } from '~/composables/chat/useModelVariantItems';
import { listPrompts, type PromptRecord } from '~/db/prompts';
import { getThreadSystemPrompt, updateThreadSystemPrompt } from '~/db/threads';
import { useDefaultPrompt } from '~/composables/chat/useDefaultPrompt';
import {
    getPanePendingPrompt,
    setPanePendingPrompt,
} from '~/composables/core/usePanePrompt';
import {
    DEFAULT_PROMPT_SELECTION,
    DISABLED_PROMPT_SELECTION,
} from '~/utils/chat/prompt-utils';
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
    threadId?: string;
    modelInherited?: boolean;
    projectModelDefault?: boolean;
    paneId?: string;
    promptSelectionRevision?: number;
    contextState?: ReturnType<typeof import('~/composables/chat/useContextPreview').useContextPreview>['state']['value'];
    compactionState?: import('~/composables/chat/useThreadCompaction').ThreadCompactionState;
    compactionBlockedReason?: string;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'use-default-model'): void;
    (e: 'compact' | 'cancel-compaction'): void;
    (e: 'open-system-prompts'): void;
    (e: 'open-model-catalog'): void;
    (e: 'pending-prompt-selected', id: string): void;
    (e: 'prompt-selected', id: string): void;
}>();

// Tool Registry
const toolRegistry = useToolRegistry();
const toolPreferences = useChatToolPreferences({ threadId: () => props.threadId, draftId: () => props.paneId });
const toolControlsDisabled = computed(() => props.loading || props.streaming || !toolPreferences.ready.value || toolPreferences.saving.value);
const registeredTools = computed(() =>
    toolRegistry.listTools.value.map((tool) => ({
        definition: tool.definition,
        enabledValue: toolPreferences.preferences.value.tools[tool.definition.function.name] !== false,
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

const root = ref<HTMLElement | null>(null);
const toolsView = ref(false);
// Tool views keep the main view's height so the popover does not jump.
const lockedHeight = ref<number>();
const toolsButton = ref<HTMLButtonElement | null>(null);
const activeCategory = ref<string | null>(null);
const hasNavigated = ref(false);
const activeGroup = computed(() =>
    groupedToolCategories.value.find(
        (group) => group.category === activeCategory.value
    ) ?? null
);
const enabledGroupToolCount = computed(
    () => activeGroup.value?.tools.filter((tool) => tool.enabledValue).length ?? 0
);
const allGroupToolsEnabled = computed(
    () => !!activeGroup.value?.tools.length &&
        enabledGroupToolCount.value === activeGroup.value.tools.length
);

function setGroupToolsEnabled(enabled: boolean) {
    if (toolControlsDisabled.value) return;
    void toolPreferences.setTools(Object.fromEntries((activeGroup.value?.tools ?? []).map((tool) => [tool.name, enabled])));
}

const backButton = ref<HTMLButtonElement | null>(null);
let categoryTrigger: HTMLButtonElement | null = null;

watch(groupedToolCategories, (groups) => {
    if (
        activeCategory.value &&
        !groups.some((group) => group.category === activeCategory.value)
    ) {
        activeCategory.value = null;
    }
});

async function navigateToCategory(category: string | null, showTools = true) {
    if (!showTools) lockedHeight.value = undefined;
    else if (!toolsView.value) lockedHeight.value = root.value?.offsetHeight;
    toolsView.value = showTools;
    activeCategory.value = category;
    hasNavigated.value = true;
    await nextTick();
}

async function openToolCategory(category: string, event: MouseEvent) {
    categoryTrigger = event.currentTarget as HTMLButtonElement;
    await navigateToCategory(category);
    backButton.value?.focus();
}

async function openTools() {
    await navigateToCategory(null);
    backButton.value?.focus();
}

async function backToSettings() {
    const fromCategory = !!activeGroup.value;
    await navigateToCategory(null, fromCategory);
    if (fromCategory) categoryTrigger?.focus();
    else toolsButton.value?.focus();
}

function getCategoryLabel(category: string) {
    if (category === 'Tasks' || category === 'OR3 Tasks') return 'Task list tools';
    return `${category} tools`;
}

function getCategorySubtitle(category: string) {
    if (category === 'Tasks' || category === 'OR3 Tasks') {
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
        'ring-0! border-[length:var(--md-border-width)] border-[color:color-mix(in_srgb,var(--md-border-color)_45%,transparent)] data-[state=open]:animate-[fade-in_170ms_ease-out] data-[state=closed]:animate-[fade-out_120ms_ease-in]',
} as const;

const iconReasoning = useIcon('chat.reasoning');
const iconVariantSettings = useIcon('chat.model.settings');
const searchIcon = useIcon('ui.search');
const iconToolWrench = useIcon('chat.tool.wrench');
const iconClose = useIcon('ui.close');
const iconChevronLeft = useIcon('ui.chevron.left');
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
const { favoriteModels, catalog } = useModelStore();
const selectedModelLabel = computed(() => {
    const model = catalog.value.find(row => row.id === selectedModel.value || row.canonical_slug === selectedModel.value);
    return model?.name || selectedModel.value?.split('/').at(-1) || 'Choose a model';
});

function providerSlugFor(modelId: string): string {
    return getProviderSlug({ id: modelId });
}

const modelItems = computed(() =>
    (favoriteModels.value ?? [])
        .map((model) => {
            const value = model.canonical_slug ?? model.id;
            if (!value) return null;
            return { label: model.name || value, value, slug: providerSlugFor(value) };
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

const { defaultPromptId } = useDefaultPrompt();
const prompts = ref<PromptRecord[]>([]);
const promptSelection = ref(DEFAULT_PROMPT_SELECTION);
const promptLoading = ref(true);
const promptSaving = ref(false);
const promptError = ref('');
let promptLoadGeneration = 0;

const promptItems = computed(() => [
    {
        label: 'Default',
        value: DEFAULT_PROMPT_SELECTION,
        description: 'Use your default system prompt.',
    },
    {
        label: 'Disabled',
        value: DISABLED_PROMPT_SELECTION,
        description: 'Send no system prompt for this chat.',
    },
    ...prompts.value.map((prompt) => ({
        label: prompt.title,
        value: prompt.id,
        description: prompt.favorite ? 'Favorite system prompt' : 'Saved system prompt',
    })),
]);

const selectedPromptLabel = computed(() => {
    if (promptSelection.value === DISABLED_PROMPT_SELECTION) return 'Disabled';
    if (promptSelection.value === DEFAULT_PROMPT_SELECTION) {
        const name = prompts.value.find(
            (prompt) => prompt.id === defaultPromptId.value
        )?.title;
        return name ? `Default · ${name}` : 'Default';
    }
    return prompts.value.find((prompt) => prompt.id === promptSelection.value)
        ?.title ?? 'Unavailable prompt';
});

const promptSearchInput = computed(() => ({
    icon: searchIcon.value,
    autofocus: !isMobile.value,
}));

watch(
    () => [props.threadId, props.paneId, props.promptSelectionRevision],
    async () => {
        const generation = ++promptLoadGeneration;
        promptLoading.value = true;
        promptError.value = '';
        try {
            const [savedPrompts, selection] = await Promise.all([
                listPrompts(),
                props.threadId
                    ? getThreadSystemPrompt(props.threadId)
                    : Promise.resolve(
                          props.paneId
                              ? getPanePendingPrompt(props.paneId)
                              : null
                      ),
            ]);
            if (generation !== promptLoadGeneration) return;
            prompts.value = savedPrompts;
            promptSelection.value = selection || DEFAULT_PROMPT_SELECTION;
        } catch {
            if (generation === promptLoadGeneration)
                promptError.value = 'Could not load system prompts.';
        } finally {
            if (generation === promptLoadGeneration) promptLoading.value = false;
        }
    },
    { immediate: true }
);

async function selectPrompt(value: string) {
    if (promptSaving.value || value === promptSelection.value) return;
    if (!promptItems.value.some((item) => item.value === value)) return;
    promptSaving.value = true;
    promptError.value = '';
    try {
        if (props.threadId) {
            await updateThreadSystemPrompt(props.threadId, value);
        } else if (props.paneId) {
            setPanePendingPrompt(props.paneId, value);
            emit('pending-prompt-selected', value);
        } else {
            throw new Error('No chat is available for this selection.');
        }
        promptSelection.value = value;
        emit('prompt-selected', value);
    } catch {
        promptError.value = 'Could not change the system prompt.';
    } finally {
        promptSaving.value = false;
    }
}

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
    --chat-settings-row-padding: 0.4375rem 0.875rem;

    max-height: min(
        calc(100dvh - 2rem),
        calc(var(--reka-popover-content-available-height, 100dvh) - 0.5rem)
    );
    overflow: hidden;
    color: var(--md-on-surface);
    background: var(--md-surface);
    border-radius: var(--md-border-radius-large, var(--md-border-radius));
}

/*
 * Buttons center on the title line (themes may enlarge them on touch
 * screens); the tool views' subtitle wraps onto its own line below.
 */
.chat-settings-header {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 1rem;
    padding: 0.75rem 1rem 0.5rem;
    border-bottom: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 40%, transparent);
}

.chat-settings-title {
    flex: 1;
    min-width: 0;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.5rem;
    letter-spacing: -0.012em;
}

.chat-settings-subtitle {
    flex-basis: 100%;
    margin-top: 0.125rem;
    /* Aligned with the title: back button (2rem - 0.25rem) + 1rem gap. */
    padding-inline-start: 2.75rem;
    color: var(--md-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.4;
}

.chat-settings-close {
    flex: none;
    margin-inline-end: -0.25rem;
}

.chat-settings-back {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    flex: none;
    align-items: center;
    justify-content: center;
    margin-inline-start: -0.25rem;
    color: var(--md-on-surface);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}

.chat-settings-back:hover {
    background: var(--md-surface-hover);
}

.chat-settings-back:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
}

.chat-settings-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
    overflow-y: auto;
    padding: 0.625rem 0.625rem 0.875rem;
}

.chat-settings-body > * {
    flex-shrink: 0;
}

.chat-settings-view-enter {
    animation: chat-settings-view-enter 170ms cubic-bezier(0.2, 0, 0, 1) both;
}

.chat-settings-view-enter.is-back {
    --chat-settings-view-offset: -8px;
}

@keyframes chat-settings-view-enter {
    from {
        opacity: 0;
        transform: translateX(var(--chat-settings-view-offset, 8px));
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.chat-settings-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
}

.chat-settings-heading {
    margin: 0;
    padding: 0 0.375rem;
    color: var(--md-on-surface-variant);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    line-height: 1rem;
}

.chat-settings-section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-inline-end: 0.875rem;
}

/* A bordered card of rows separated by inset hairlines. */
.chat-settings-group {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}

/*
 * Row dividers are drawn with a pseudo-element instead of `border-top` so
 * they can be inset from both edges like grouped iOS lists.
 */
.chat-settings-group > * + * {
    position: relative;
}

.chat-settings-group > * + *::before {
    content: '';
    position: absolute;
    inset-inline: 0.875rem;
    top: 0;
    /* Keep the hairline above a row's hover fill. */
    z-index: 1;
    border-top: max(1px, var(--chat-settings-divider-width)) solid
        color-mix(in srgb, var(--md-border-color) 60%, transparent);
    pointer-events: none;
}

/*
 * Rows are USelectMenu triggers and UButtons, so their base button lives
 * inside a child component: layout is applied with :deep(). All rows share
 * one geometry so every section lines up exactly.
 */
:deep(.chat-settings-model-trigger),
:deep(.chat-settings-row-trigger),
.chat-settings-nav-button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 0.875rem;
    width: 100%;
    height: auto;
    min-height: 2.75rem;
    padding: var(--chat-settings-row-padding);
    color: var(--md-on-surface);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 0;
    cursor: pointer;
}

:deep(.chat-settings-row-trigger) {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
}

:deep(.chat-settings-model-trigger:hover),
:deep(.chat-settings-row-trigger:hover),
.chat-settings-nav-button:hover {
    background: var(--md-surface-hover);
}

:deep(.chat-settings-model-trigger:focus-visible),
:deep(.chat-settings-row-trigger:focus-visible) {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: -2px;
}

/*
 * UButton wraps slotted content in its label span, which would lay the
 * icon/copy/chevron out with flex instead of the row grid. Collapsing the
 * wrapper keeps button rows on the same grid as the select rows.
 */
:is(.chat-settings-nav-button, .chat-settings-model-trigger) > [data-slot='label'] {
    display: contents;
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

.chat-settings-icon {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--md-on-surface-variant);
    background: var(--md-surface-container-low);
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
    font-weight: 500;
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

.chat-settings-tools-row {
    position: relative;
}

/* Reserve the value column while keeping the switch beside the row button. */
.chat-settings-tool-value {
    width: 2rem;
}

:deep(.chat-settings-tools-toggle) {
    position: absolute;
    inset-inline-end: 2.5rem; /* 14px padding + 16px chevron + 10px gap. */
    top: 50%;
    transform: translateY(-50%);
}

:deep(.chat-settings-tools-toggle [data-slot='base']) {
    position: relative;
}

/* Extend the hit area to at least 44px without enlarging the visible track. */
:deep(.chat-settings-tools-toggle [data-slot='base'])::after {
    content: '';
    position: absolute;
    inset: 50% auto auto 50%;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
}

/*
 * Off switches get a filled track and a hairline edge so they stay visible on
 * the white cards; the padding keeps the thumb where the 2px border put it.
 */
:deep(.chat-settings-control [data-slot='base'][data-state='unchecked']) {
    padding: 1px;
    background: var(--md-surface-container-high);
    border-width: 1px;
    border-color: var(--md-outline-variant);
}

.chat-settings-section-count {
    min-width: 1.25rem;
    color: var(--md-on-surface-variant);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-align: right;
}

.chat-settings-tool-category {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 0.875rem;
    min-height: 2.75rem;
    padding: var(--chat-settings-row-padding);
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

.chat-settings-bulk-row {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 0.875rem;
    min-height: 2.75rem;
    padding: var(--chat-settings-row-padding);
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}

.chat-settings-tool-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.875rem;
    min-height: 2.75rem;
    padding: var(--chat-settings-row-padding);
}

@media (max-width: 640px) {
    .chat-settings-popover {
        width: min(360px, calc(100vw - 1rem));
    }
}

@media (prefers-reduced-motion: reduce) {
    .chat-settings-view-enter {
        animation: none;
    }

    .chat-settings-tool-category {
        transition-duration: 1ms;
    }

    .chat-settings-option-chevron {
        transition: none;
    }
}
</style>
