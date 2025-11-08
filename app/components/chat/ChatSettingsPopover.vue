<template>
    <div
        :class="['flex flex-col w-[320px]', containerProps?.class || '']"
        :data-theme-target="containerProps?.['data-theme-target']"
        :data-theme-matches="containerProps?.['data-theme-matches']"
    >
        <!-- Model Selector extracted -->
        <div
            v-if="containerWidth && containerWidth < 400"
            class="flex justify-between w-full items-center py-1 px-2"
        >
            <LazyChatModelSelect
                hydrate-on-interaction="focus"
                v-model:model="selectedModel"
                :loading="loading"
                class="w-full!"
            />
        </div>
        <div
            class="flex justify-between w-full items-center py-1 px-2 border-b"
        >
            <USwitch
                v-bind="webSearchSwitchProps"
                class="w-full"
                v-model="webSearchEnabled"
            ></USwitch>
            <UIcon name="pixelarticons:visible" class="w-4 h-4" />
        </div>
        <div
            class="flex justify-between w-full items-center py-1 px-2 border-b"
        >
            <USwitch v-bind="thinkingSwitchProps" class="w-full"></USwitch>
            <UIcon name="pixelarticons:lightbulb-on" class="w-4 h-4" />
        </div>

        <!-- Tool Toggles Section -->
        <div v-if="registeredTools.length > 0" class="border-b">
            <div
                v-for="tool in registeredTools"
                :key="tool.name"
                class="flex flex-col py-1 px-2"
            >
                <div class="flex justify-between w-full items-center">
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
                        class="w-4 h-4"
                    />
                    <UIcon v-else name="pixelarticons:wrench" class="w-4 h-4" />
                </div>
                <p
                    v-if="
                        tool.definition.ui?.descriptionHint ||
                        tool.definition.function.description
                    "
                    :id="`tool-desc-${tool.name}`"
                    class="text-xs opacity-70 mt-0.5 px-1"
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
            @click="$emit('open-system-prompts')"
        >
            <span class="px-1">System prompts</span>
        </UButton>
        <UButton
            v-bind="modelCatalogButtonProps"
            @click="$emit('open-model-catalog')"
        >
            <span class="px-1">Model Catalog</span>
        </UButton>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useToolRegistry } from '~/utils/chat/tools-public';
import { useThemeOverrides } from '~/composables/useThemeResolver';

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
    return {
        color: 'primary',
        ...(overrides.value as any),
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
        color: 'primary',
        label: 'Enable web search',
        ...(overrides.value as any),
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
        color: 'primary',
        label: 'Enable thinking',
        ...(overrides.value as any),
    };
});

// Tool switch (dynamic per tool)
const getToolSwitchProps = (toolName: string) => {
    const overrides = useThemeOverrides({
        component: 'switch',
        context: 'settings',
        identifier: `settings.tool-${toolName}`,
        isNuxtUI: true,
    });
    return {
        color: 'primary',
        ...(overrides.value as any),
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
    return {
        class: 'flex justify-between w-full items-center py-1 px-2 border-b',
        variant: 'ghost',
        block: true,
        trailing: true,
        trailingIcon: 'pixelarticons:script-text',
        ...(overrides.value as any),
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
    return {
        class: 'flex justify-between w-full items-center py-1 px-2 rounded-[3px]',
        variant: 'ghost',
        block: true,
        trailing: true,
        trailingIcon: 'pixelarticons:android',
        ...(overrides.value as any),
    };
});
</script>
