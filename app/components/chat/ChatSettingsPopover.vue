<template>
    <div
        :class="[
            'chat-settings-popover flex flex-col w-[320px]',
            containerProps?.class || '',
        ]"
        :data-theme-target="containerProps?.['data-theme-target']"
        :data-theme-matches="containerProps?.['data-theme-matches']"
    >
        <!-- Model Selector extracted -->
        <div
            v-if="containerWidth && containerWidth < 400"
            class="chat-settings-popover-model-selector flex justify-between w-full items-center py-1 px-2"
        >
            <LazyChatModelSelect
                hydrate-on-interaction="focus"
                v-model:model="selectedModel"
                :loading="loading"
                class="w-full!"
            />
        </div>
        <div
            class="chat-settings-popover-switch chat-settings-switch flex justify-between w-full items-center py-1 px-3 border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)]"
        >
            <USwitch
                v-bind="webSearchSwitchProps"
                class="w-full"
                v-model="webSearchEnabled"
            ></USwitch>
            <UIcon :name="iconView" class="w-5 h-5" />
        </div>
        <div
            v-if="thinkingSupported"
            class="chat-settings-switch flex justify-between w-full items-center py-1 px-3 border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)]"
        >
            <USwitch v-bind="thinkingSwitchProps" class="w-full" v-model="thinkingEnabled"></USwitch>
            <UIcon :name="iconReasoning" class="w-5 h-5" />
        </div>
        <div
            v-if="thinkingSupported && thinkingEnabled && reasoningEffortOptions.length > 0"
            class="chat-settings-reasoning-effort flex justify-between w-full items-center gap-3 py-1.5 px-3 border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)]"
        >
            <label
                for="chat-reasoning-effort"
                class="text-sm font-medium shrink-0"
            >
                Reasoning level
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

        <!-- Tool Toggles Section -->
        <div
            v-if="registeredTools.length > 0"
            class="chat-settings-popover-tools border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)]"
        >
            <div class="max-h-[min(60vh,420px)] overflow-y-auto">
                <div
                    v-for="group in groupedToolCategories"
                    :key="group.category"
                    class="border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)] last:border-b-0"
                >
                    <button
                        type="button"
                        class="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-[var(--md-surface-hover)] transition-colors"
                        :aria-expanded="!isCategoryCollapsed(group.category)"
                        :aria-controls="`tool-category-${group.category}`"
                        @click="toggleCategory(group.category)"
                    >
                        <div class="min-w-0 pr-2">
                            <div class="min-w-0">
                                <div class="text-sm font-medium truncate">
                                    {{ getCategoryLabel(group.category) }}
                                </div>
                                <p
                                    v-if="getCategorySubtitle(group.category)"
                                    class="text-[10px] opacity-65 truncate"
                                >
                                    {{ getCategorySubtitle(group.category) }}
                                </p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0 self-center">
                            <span
                                class="text-[10px] leading-none opacity-60 min-w-[1.25rem] text-right"
                                >{{ group.tools.length }}</span
                            >
                            <UIcon
                                :name="
                                    isCategoryCollapsed(group.category)
                                        ? iconChevronRight
                                        : iconChevronDown
                                "
                                class="w-4 h-4 shrink-0"
                            />
                        </div>
                    </button>

                    <div
                        v-show="!isCategoryCollapsed(group.category)"
                        :id="`tool-category-${group.category}`"
                    >
                        <div
                            v-for="tool in group.tools"
                            :key="tool.name"
                            class="chat-settings-popover-tool flex flex-col py-1 px-3"
                        >
                            <div
                                class="chat-settings-popover-tool-switch chat-settings-switch flex justify-between w-full items-center"
                            >
                                <USwitch
                                    v-bind="getToolSwitchProps(tool.name)"
                                    :label="
                                        tool.definition.ui?.label ||
                                        tool.definition.function.name
                                    "
                                    class="w-full"
                                    :model-value="tool.enabledValue"
                                    @update:model-value="(val: boolean) => {
                                        toolRegistry.setEnabled(
                                            tool.name,
                                            val
                                        );
                                    }"
                                    :disabled="loading || streaming"
                                    :aria-describedby="`tool-desc-${tool.name}`"
                                ></USwitch>
                                <UIcon
                                    v-if="tool.definition.ui?.icon"
                                    :name="tool.definition.ui.icon"
                                    class="w-5 h-5"
                                />
                                <UIcon
                                    v-else
                                    :name="iconToolWrench"
                                    class="w-5 h-5"
                                />
                            </div>
                            <p
                                v-if="
                                    tool.definition.ui?.descriptionHint ||
                                    tool.definition.function.description
                                "
                                :id="`tool-desc-${tool.name}`"
                                class="chat-settings-popover-tool-description text-xs opacity-70 mt-0.5 px-1"
                            >
                                {{
                                    tool.definition.ui?.descriptionHint ||
                                    tool.definition.function.description
                                }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <UButton
            v-bind="systemPromptsButtonProps"
            class="chat-settings-popover-button"
            @click="$emit('open-system-prompts')"
        >
            System prompts
        </UButton>
        <UButton
            v-bind="modelCatalogButtonProps"
            class="chat-settings-popover-button"
            @click="$emit('open-model-catalog')"
        >
            Model Catalog
        </UButton>
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

const iconView = useIcon('ui.view');
const iconReasoning = useIcon('chat.reasoning');
const iconToolWrench = useIcon('chat.tool.wrench');
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

// Theme overrides - Switches (general group)
const switchProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'switch',
        context: 'settings',
        identifier: 'settings.switch',
        isNuxtUI: true,
    });
    return {
        color: 'primary' as const,
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
        label: 'Enable web search',
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
        label: 'Enable thinking',
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
    const baseClass =
        'flex justify-between w-full items-center py-1 px-2 font-medium';
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
        trailing: true,
        trailingIcon: iconSystemPrompt.value,
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
    const baseClass =
        'flex justify-between w-full items-center py-1 px-2 font-medium';
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
        trailing: true,
        trailingIcon: iconModelCatalog.value,
        ...overrideValue,
        class: mergedClass,
    };
});
</script>
