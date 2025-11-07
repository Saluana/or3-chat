<template>
    <div class="flex flex-col w-[320px]">
        <!-- Model Selector extracted -->
        <div
            class="flex justify-between w-full items-center py-1 px-2"
        >
            <LazyChatModelSelect
                hydrate-on-interaction="focus"
                v-if="
                    containerWidth &&
                    containerWidth < 400
                "
                v-model:model="selectedModel"
                :loading="loading"
                class="w-full!"
            />
        </div>
        <div
            class="flex justify-between w-full items-center py-1 px-2 border-b"
        >
            <USwitch
                color="primary"
                label="Enable web search"
                class="w-full"
                v-model="webSearchEnabled"
            ></USwitch>
            <UIcon
                name="pixelarticons:visible"
                class="w-4 h-4"
            />
        </div>
        <div
            class="flex justify-between w-full items-center py-1 px-2 border-b"
        >
            <USwitch
                color="primary"
                label="Enable thinking"
                class="w-full"
            ></USwitch>
            <UIcon
                name="pixelarticons:lightbulb-on"
                class="w-4 h-4"
            />
        </div>

        <!-- Tool Toggles Section -->
        <div
            v-if="registeredTools.length > 0"
            class="border-b"
        >
            <div
                v-for="tool in registeredTools"
                :key="tool.name"
                class="flex flex-col py-1 px-2"
            >
                <div
                    class="flex justify-between w-full items-center"
                >
                    <USwitch
                        color="primary"
                        :label="
                            tool.definition.ui
                                ?.label ||
                            tool.definition.function
                                .name
                        "
                        class="w-full"
                        :model-value="
                            tool.enabledValue
                        "
                        @update:model-value="(val: boolean) => {
                            toolRegistry.setEnabled(tool.name, val);
                        }"
                        :disabled="
                            loading ||
                            streaming
                        "
                        :aria-describedby="`tool-desc-${tool.name}`"
                    ></USwitch>
                    <UIcon
                        v-if="
                            tool.definition.ui?.icon
                        "
                        :name="
                            tool.definition.ui.icon
                        "
                        class="w-4 h-4"
                    />
                    <UIcon
                        v-else
                        name="pixelarticons:wrench"
                        class="w-4 h-4"
                    />
                </div>
                <p
                    v-if="
                        tool.definition.ui
                            ?.descriptionHint ||
                        tool.definition.function
                            .description
                    "
                    :id="`tool-desc-${tool.name}`"
                    class="text-xs opacity-70 mt-0.5 px-1"
                >
                    {{
                        tool.definition.ui
                            ?.descriptionHint ||
                        tool.definition.function
                            .description
                    }}
                </p>
            </div>
        </div>

        <button
            class="flex justify-between w-full items-center py-1 px-2 hover:bg-primary/10 border-b cursor-pointer"
            @click="$emit('open-system-prompts')"
        >
            <span class="px-1">System prompts</span>
            <UIcon
                name="pixelarticons:script-text"
                class="w-4 h-4"
            />
        </button>
        <button
            @click="$emit('open-model-catalog')"
            class="flex justify-between w-full items-center py-1 px-2 hover:bg-primary/10 rounded-[3px] cursor-pointer"
        >
            <span class="px-1">Model Catalog</span>
            <UIcon
                name="pixelarticons:android"
                class="w-4 h-4"
            />
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useToolRegistry } from '~/utils/chat/tools-public';

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
</script>
