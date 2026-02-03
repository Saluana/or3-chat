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
            <UIcon :name="useIcon('ui.view').value" class="w-5 h-5" />
        </div>
        <div
            class="chat-settings-switch flex justify-between w-full items-center py-1 px-3 border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)]"
        >
            <USwitch v-bind="thinkingSwitchProps" class="w-full"></USwitch>
            <UIcon :name="useIcon('chat.reasoning').value" class="w-5 h-5" />
        </div>

        <!-- Tool Toggles Section -->
        <div
            v-if="registeredTools.length > 0"
            class="chat-settings-popover-tools border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)]"
        >
            <div
                v-for="tool in registeredTools"
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
                            toolRegistry.setEnabled(tool.name, val);
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
                        :name="useIcon('chat.tool.wrench').value"
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
import { computed } from 'vue';
import { useToolRegistry } from '~/utils/chat/tools-public';
import { useThemeOverrides, mergeThemeProps } from '~/composables/useThemeResolver';

const props = defineProps<{
    containerWidth?: number;
    loading?: boolean;
    streaming?: boolean;
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

// These will be provided by the parent component via v-model
const selectedModel = defineModel<string>('model');
const webSearchEnabled = defineModel<boolean>('webSearchEnabled');

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
    return mergeThemeProps({
        color: 'primary' as const,
    }, overrides.value);
});

// Web search switch
const webSearchSwitchProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'switch',
        context: 'settings',
        identifier: 'settings.web-search',
        isNuxtUI: true,
    });
    return mergeThemeProps({
        color: 'primary' as const,
        size: 'sm' as const,
        label: 'Enable web search',
    }, overrides.value);
});

// Thinking switch
const thinkingSwitchProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'switch',
        context: 'settings',
        identifier: 'settings.thinking',
        isNuxtUI: true,
    });
    return mergeThemeProps({
        color: 'primary' as const,
        size: 'sm' as const,
        label: 'Enable thinking',
    }, overrides.value);
});

// Tool switch (dynamic per tool)
const getToolSwitchProps = (toolName: string) => {
    const overrides = useThemeOverrides({
        component: 'switch',
        context: 'settings',
        identifier: `settings.tool-${toolName}`,
        isNuxtUI: true,
    });
    return mergeThemeProps({
        color: 'primary' as const,
        size: 'sm' as const,
    }, overrides.value);
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
        trailingIcon: useIcon('chat.system_prompt').value,
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
        trailingIcon: useIcon('chat.model.catalog').value,
        ...overrideValue,
        class: mergedClass,
    };
});
</script>
