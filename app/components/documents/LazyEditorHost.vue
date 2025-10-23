<template>
    <div class="flex flex-col h-full w-full min-h-0">
        <Suspense>
            <template #default>
                <DocumentEditorRoot :document-id="documentId" />
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
                        v-if="showError"
                        class="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    >
                        <div
                            class="bg-white dark:bg-neutral-900 rounded-lg p-6 max-w-md text-center"
                        >
                            <p class="text-red-600 dark:text-red-400 mb-4">
                                Failed to load editor. Please try again.
                            </p>
                            <UButton
                                size="md"
                                @click="retryLoad"
                                class="retro-btn"
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
import { ref, watch, onBeforeUnmount } from 'vue';
import DocumentEditorRoot from './DocumentEditorRoot.vue';

const props = defineProps<{ documentId: string }>();
const emit = defineEmits<{ error: [error: Error] }>();

const showError = ref(false);
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let isMounted = true;

// Show error after 5 seconds if editor hasn't loaded
function startErrorTimeout() {
    timeoutId = setTimeout(() => {
        if (isMounted && !showError.value) {
            showError.value = true;
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
    showError.value = false;
    clearErrorTimeout();
    startErrorTimeout();
}

// Start error timeout when mounted
startErrorTimeout();

// Clear on unmount
onBeforeUnmount(() => {
    isMounted = false;
    clearErrorTimeout();
});

// Reset error timeout if documentId changes
watch(
    () => props.documentId,
    () => {
        showError.value = false;
        clearErrorTimeout();
        startErrorTimeout();
    }
);
</script>

<style scoped>
/* Retro button styling inherited from app config */
</style>
