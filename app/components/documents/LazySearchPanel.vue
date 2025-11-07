<template>
    <div class="search-panel">
        <slot v-if="error" name="error">
            <div class="p-4 text-center">
                <p class="text-sm text-[var(--md-error)] mb-2">
                    Failed to load search
                </p>
                <UButton v-bind="retryButtonProps" @click="retry">Retry</UButton>
            </div>
        </slot>
        <Suspense v-else>
            <SearchPanelRoot
                v-bind="$attrs"
                :docmap="docmap"
                @search="$emit('search', $event)"
                @navigate="$emit('navigate', $event)"
            />
            <template #fallback>
                <div class="p-4 text-center">
                    <div class="text-sm text-[var(--md-on-surface-variant)]">
                        Loading search...
                    </div>
                </div>
            </template>
        </Suspense>
    </div>
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent, onErrorCaptured, computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

interface Props {
    docmap: any;
}

defineProps<Props>();
defineEmits<{
    search: [query: string];
    navigate: [path: string];
}>();

const error = ref(false);
const retryKey = ref(0);

// Theme integration for retry button
const retryButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'document',
        identifier: 'document.search-retry',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        ...(overrides.value as any),
    };
});

// Lazy load the search panel implementation
const SearchPanelRoot = defineAsyncComponent({
    loader: async () => {
        try {
            error.value = false;
            const module = await import(
                '~/components/documents/SearchPanelRoot.vue'
            );
            return module.default || module;
        } catch (err) {
            console.error('[LazySearchPanel] Failed to load:', err);
            error.value = true;
            throw err;
        }
    },
});

// Capture async errors from Suspense
onErrorCaptured((err) => {
    console.error('[LazySearchPanel] Component error:', err);
    error.value = true;
    return false;
});

function retry() {
    error.value = false;
    retryKey.value++;
}
</script>
