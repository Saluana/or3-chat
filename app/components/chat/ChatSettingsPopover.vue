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
            <!-- The model selector moves into settings when the composer is narrow. -->
            <section
                v-if="containerWidth && containerWidth < 400"
                class="chat-settings-model-section"
                aria-labelledby="chat-settings-model-label"
            >
                <label
                    id="chat-settings-model-label"
                    class="chat-settings-section-label"
                >
                    Model
                </label>
                <LazyChatModelSelect
                    hydrate-on-interaction="focus"
                    v-model:model="selectedModel"
                    :loading="loading"
                    class="chat-settings-model-select w-full!"
                />
            </section>

            <div class="chat-settings-section">
                <div
                    class="chat-settings-row chat-settings-popover-switch chat-settings-switch"
                >
                    <span class="chat-settings-icon" aria-hidden="true">
                        <UIcon :name="iconWebSearch" class="size-4" />
                    </span>
                    <label
                        for="chat-web-search"
                        class="chat-settings-row-copy"
                    >
                        <span class="chat-settings-row-title">
                            Enable web search
                        </span>
                        <span
                            id="chat-web-search-description"
                            class="chat-settings-row-description"
                        >
                            Search the web for up-to-date information.
                        </span>
                    </label>
                    <USwitch
                        id="chat-web-search"
                        v-bind="webSearchSwitchProps"
                        v-model="webSearchEnabled"
                        aria-label="Enable web search"
                        aria-describedby="chat-web-search-description"
                        class="chat-settings-control"
                    />
                </div>

                <div
                    v-if="thinkingSupported"
                    class="chat-settings-row chat-settings-switch"
                >
                    <span class="chat-settings-icon" aria-hidden="true">
                        <UIcon :name="iconReasoning" class="size-4" />
                    </span>
                    <label
                        for="chat-thinking"
                        class="chat-settings-row-copy"
                    >
                        <span class="chat-settings-row-title">
                            Enable thinking
                        </span>
                        <span
                            id="chat-thinking-description"
                            class="chat-settings-row-description"
                        >
                            Let supported models reason before answering.
                        </span>
                    </label>
                    <USwitch
                        id="chat-thinking"
                        v-bind="thinkingSwitchProps"
                        v-model="thinkingEnabled"
                        aria-label="Enable thinking"
                        aria-describedby="chat-thinking-description"
                        class="chat-settings-control"
                    />
                </div>

                <div
                    v-if="
                        thinkingSupported &&
                        thinkingEnabled &&
                        reasoningEffortOptions.length > 0
                    "
                    class="chat-settings-reasoning-effort"
                >
                    <label
                        for="chat-reasoning-effort"
                        class="chat-settings-row-copy"
                    >
                        <span class="chat-settings-row-title">
                            Reasoning level
                        </span>
                        <span class="chat-settings-row-description">
                            Choose how much effort the model should use.
                        </span>
                    </label>
                    <USelect
                        id="chat-reasoning-effort"
                        v-model="reasoningEffort"
                        :items="reasoningEffortItems"
                        size="sm"
                        class="min-w-32"
                        :disabled="loading || streaming"
                    />
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
                        class="size-4 shrink-0"
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
                        class="size-4 shrink-0"
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

const props = defineProps<{
    containerWidth?: number;
    loading?: boolean;
    streaming?: boolean;
    thinkingSupported?: boolean;
    reasoningEfforts?: string[];
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
const webSearchEnabled = defineModel<boolean>('webSearchEnabled');
const thinkingEnabled = defineModel<boolean>('thinkingEnabled');
const reasoningEffort = defineModel<string | undefined>('reasoningEffort');

const iconWebSearch = useIcon('chat.web_search');
const iconReasoning = useIcon('chat.reasoning');
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

// Web search switch
const webSearchSwitchProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'switch',
        context: 'settings',
        identifier: 'settings.web-search',
        isNuxtUI: true,
    });
    return {
        color: 'primary' as const,
        size: 'sm' as const,
        ...overrides.value,
    };
});

// Thinking switch
const thinkingSwitchProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'switch',
        context: 'settings',
        identifier: 'settings.thinking',
        isNuxtUI: true,
    });
    return {
        color: 'primary' as const,
        size: 'sm' as const,
        disabled:
            props.thinkingSupported === false || props.loading || props.streaming,
        ...overrides.value,
    };
});

const reasoningEffortOptions = computed(() =>
    Array.isArray(props.reasoningEfforts) ? props.reasoningEfforts : []
);

const reasoningEffortItems = computed(() =>
    reasoningEffortOptions.value.map((value) => ({
        label: value,
        value,
    }))
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

.chat-settings-model-section,
.chat-settings-section,
.chat-settings-tools,
.chat-settings-navigation {
    overflow: hidden;
    border: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 45%, transparent);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    background: var(--md-surface);
}

.chat-settings-model-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
}

.chat-settings-section-label {
    color: var(--md-on-surface);
    font-size: 0.75rem;
    font-weight: 650;
    line-height: 1.2;
}

.chat-settings-model-select {
    min-width: 0;
}

.chat-settings-model-select :deep(button) {
    width: 100%;
    max-width: none;
    color: var(--md-on-surface);
    background: var(--md-surface);
    border: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 55%, transparent);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}

.chat-settings-model-select :deep(button:hover) {
    background: var(--md-surface-hover);
    border-color: color-mix(
        in srgb,
        var(--md-primary) 40%,
        var(--md-border-color)
    );
}

.chat-settings-model-select :deep(button:focus-visible) {
    border-color: var(--md-primary);
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

.chat-settings-row + .chat-settings-row,
.chat-settings-reasoning-effort {
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

.chat-settings-reasoning-effort {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem;
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
    transition: background-color 150ms ease;
}

.chat-settings-tool-category:hover {
    background: var(--md-surface-hover);
}

.chat-settings-tool-category:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: -2px;
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
    min-height: 3.5rem;
    padding: 0.625rem 0.75rem;
    color: var(--md-on-surface);
    border: 0;
    border-radius: 0;
}

.chat-settings-nav-button + .chat-settings-nav-button {
    border-top: var(--chat-settings-divider-width) solid
        color-mix(in srgb, var(--md-border-color) 35%, transparent);
}

.chat-settings-nav-button:hover {
    background: var(--md-surface-hover);
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
}
</style>
