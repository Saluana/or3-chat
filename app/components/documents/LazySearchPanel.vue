<template>
    <div class="search-panel">
        <slot v-if="error" name="error">
            <div class="p-4 text-center">
                <p class="text-sm text-[var(--md-error)] mb-2">
                    Failed to load search
                </p>
                <UButton size="sm" @click="retry">Retry</UButton>
            </div>
        </slot>
        <slot v-else-if="!loaded" name="loading">
            <div class="p-4 text-center">
                <div class="text-sm text-[var(--md-on-surface-variant)]">
                    Loading search...
                </div>
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
                        Initializing...
                    </div>
                </div>
            </template>
        </Suspense>
    </div>
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue';
import { useLazyBoundaries } from '~/composables/core/useLazyBoundaries';

interface Props {
    docmap: any;
}

defineProps<Props>();
defineEmits<{
    search: [query: string];
    navigate: [path: string];
}>();

const lazyBoundaries = useLazyBoundaries();
const loaded = ref(false);
const error = ref(false);

// Lazy load the search panel implementation
const SearchPanelRoot = defineAsyncComponent(async () => {
    try {
        error.value = false;
        const module = await lazyBoundaries.load({
            key: 'docs-search-panel',
            loader: () => import('./SearchPanelRoot.vue'),
        });
        loaded.value = true;
        return module;
    } catch (err) {
        console.error('[LazySearchPanel] Failed to load:', err);
        error.value = true;
        throw err;
    }
});

function retry() {
    error.value = false;
    loaded.value = false;
    lazyBoundaries.reset('docs-search-panel');
    // Force re-evaluation
    SearchPanelRoot.value;
}
</script>
