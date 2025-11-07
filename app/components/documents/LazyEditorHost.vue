<template>
    <div class="flex flex-col h-full w-full min-h-0">
        <Suspense @resolve="handleEditorResolved">
            <template #default>
                <DocumentEditorRoot
                    :key="renderKey"
                    :document-id="documentId"
                />
            </template>
            <template #fallback>
                <div
                    class="flex flex-col h-full w-full bg-white/10 dark:bg-black/10 backdrop-blur-sm"
                >
                    <!-- Skeleton Header -->
                    <div
                        class="flex items-center justify-between sm:justify-center px-3 pt-2 pb-2 gap-2"
                    >
                        <div
                            class="flex-1 max-w-[60%] h-8 bg-neutral-300/30 dark:bg-neutral-700/30 rounded animate-pulse"
                        ></div>
                        <div
                            class="w-16 h-6 bg-neutral-300/30 dark:bg-neutral-700/30 rounded animate-pulse"
                        ></div>
                    </div>

                    <!-- Skeleton Toolbar -->
                    <div
                        class="flex gap-2 px-3 py-2 border-b border-neutral-200/20 dark:border-neutral-800/20"
                    >
                        <div
                            v-for="i in 8"
                            :key="i"
                            class="w-8 h-8 bg-neutral-300/30 dark:bg-neutral-700/30 rounded-sm animate-pulse"
                        ></div>
                    </div>

                    <!-- Skeleton Content -->
                    <div class="flex-1 overflow-hidden px-8 py-4">
                        <div class="space-y-3 max-w-[820px] mx-auto">
                            <div
                                v-for="i in 5"
                                :key="`line-${i}`"
                                class="h-4 bg-neutral-300/30 dark:bg-neutral-700/30 rounded"
                                :style="{
                                    width: `${85 + Math.random() * 15}%`,
                                }"
                            ></div>
                        </div>
                    </div>

                    <!-- Error & Retry (shown after timeout) -->
                    <div
                        v-if="showErrorMessage"
                        class="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    >
                        <div
                            class="bg-white dark:bg-neutral-900 rounded-lg p-6 max-w-md text-center"
                        >
                            <p class="text-red-600 dark:text-red-400 mb-4">
                                Failed to load editor. Please try again.
                            </p>
                            <UButton
                                v-bind="retryButtonProps"
                                @click="retryLoad"
                            >
                                Retry
                            </UButton>
                        </div>
                    </div>
                </div>
            </template>
        </Suspense>
    </div>
</template>

<script setup lang="ts">
import {
    ref,
    watch,
    onMounted,
    onBeforeUnmount,
    onErrorCaptured,
    computed,
} from 'vue';
import DocumentEditorRoot from './DocumentEditorRoot.vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = defineProps<{ documentId: string }>();
const emit = defineEmits<{ error: [error: Error] }>();

const showErrorMessage = ref(false);
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let isMounted = true;
const renderKey = ref(0);

// Theme integration for retry button
const retryButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'document',
        identifier: 'document.retry',
        isNuxtUI: true,
    });
    return {
        size: 'md' as const,
        ...(overrides.value as any),
    };
});

// Show error after 5 seconds if editor hasn't loaded
function startErrorTimeout() {
    clearErrorTimeout();
    timeoutId = setTimeout(() => {
        if (isMounted && !showErrorMessage.value) {
            showErrorMessage.value = true;
        }
    }, 5000);
}

function clearErrorTimeout() {
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
}

function retryLoad() {
    showErrorMessage.value = false;
    clearErrorTimeout();
    startErrorTimeout();
    renderKey.value += 1;
}

function handleEditorResolved() {
    clearErrorTimeout();
    showErrorMessage.value = false;
}

// Start error timeout when mounted
onMounted(() => {
    isMounted = true;
    startErrorTimeout();
});

// Clear on unmount
onBeforeUnmount(() => {
    isMounted = false;
    clearErrorTimeout();
});

// Reset error timeout if documentId changes
watch(
    () => props.documentId,
    () => {
        showErrorMessage.value = false;
        clearErrorTimeout();
        startErrorTimeout();
        renderKey.value += 1;
    }
);

onErrorCaptured((err) => {
    clearErrorTimeout();
    showErrorMessage.value = true;
    const error = err instanceof Error ? err : new Error(String(err));
    emit('error', error);
    return false;
});
</script>

<style scoped>
/* Retro button styling inherited from app config */
</style>
