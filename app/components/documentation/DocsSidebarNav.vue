<template>
    <nav class="docs-nav" aria-label="Documentation">
        <div
            v-for="category in navigation"
            :key="category.label"
            class="docs-nav-category"
        >
            <div class="docs-nav-category-label">
                {{ category.label }}
            </div>
            <div class="docs-nav-category-body">
                <div
                    v-for="group in category.groups"
                    :key="`${category.label}-${group.label}`"
                    class="docs-nav-group"
                >
                    <button
                        v-if="group.items.length > 1"
                        type="button"
                        class="docs-nav-row docs-nav-group-toggle"
                        :aria-expanded="isGroupExpanded(category.label, group.label)"
                        @click="toggleGroup(category.label, group.label)"
                    >
                        <span class="docs-nav-row-label">{{ group.label }}</span>
                        <UIcon
                            :name="chevronIcon"
                            class="docs-nav-chevron"
                            :class="{
                                'docs-nav-chevron-open': isGroupExpanded(
                                    category.label,
                                    group.label
                                ),
                            }"
                            aria-hidden="true"
                        />
                    </button>
                    <Transition name="docs-collapsible">
                        <div
                            v-if="
                                group.items.length <= 1 ||
                                isGroupExpanded(category.label, group.label)
                            "
                            :class="
                                group.items.length > 1
                                    ? 'docs-nav-children'
                                    : undefined
                            "
                        >
                            <ul class="docs-nav-list">
                                <li v-for="item in group.items" :key="item.path">
                                    <NuxtLink
                                        :to="item.path"
                                        class="docs-nav-row docs-nav-link"
                                        :class="{
                                            'docs-nav-link-toplevel':
                                                group.items.length <= 1,
                                        }"
                                        active-class="docs-nav-link-active"
                                        @click="$emit('navigate')"
                                    >
                                        <span class="docs-nav-row-label">{{
                                            item.label
                                        }}</span>
                                    </NuxtLink>
                                </li>
                            </ul>
                        </div>
                    </Transition>
                </div>
            </div>
        </div>
    </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useIcon } from '~/composables/useIcon';
import type { DocsNavCategory } from '~/composables/documents/useDocumentationNavigation';

defineProps<{
    navigation: DocsNavCategory[];
    isGroupExpanded: (category: string, group: string) => boolean;
    toggleGroup: (category: string, group: string) => void;
}>();

defineEmits<{
    navigate: [];
}>();

const chevronIcon = computed(() => useIcon('ui.chevron.right').value);
</script>

<style scoped>
.docs-nav {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
}

.docs-nav-category-label {
    padding: 0 0.625rem;
    margin-bottom: 0.375rem;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 25%);
    user-select: none;
}

.docs-nav-category-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.docs-nav-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 32px;
    padding: 0.25rem 0.625rem;
    border-radius: calc(var(--md-border-radius) * 0.75);
    font-size: 13.5px;
    line-height: 1.35;
    text-align: left;
    color: var(--md-on-surface-variant);
    transition:
        background-color 0.15s ease,
        color 0.15s ease;
}

.docs-nav-row-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.docs-nav-group-toggle {
    font-weight: 550;
    color: var(--md-on-surface);
    cursor: pointer;
}

.docs-nav-link-toplevel {
    font-weight: 550;
    color: var(--md-on-surface);
}

.docs-nav-row:hover {
    background-color: color-mix(in oklab, var(--md-on-surface) 5%, transparent);
    color: var(--md-on-surface);
}

.docs-nav-group-toggle:focus-visible,
.docs-nav-link:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: -2px;
}

.docs-nav-chevron {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.55;
    transition: transform 0.18s ease;
}

.docs-nav-chevron-open {
    transform: rotate(90deg);
}

.docs-nav-children {
    margin-left: 1.05rem;
    padding-left: 0.5rem;
    border-left: 1px solid color-mix(
        in oklab,
        var(--md-border-color),
        transparent 25%
    );
    margin-top: 1px;
    margin-bottom: 2px;
}

.docs-nav-children .docs-nav-link {
    min-height: 30px;
    font-size: 13px;
}

.docs-nav-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.docs-nav-link-active,
.docs-nav-link-active:hover {
    background-color: color-mix(in oklab, var(--md-primary) 10%, transparent);
    color: var(--md-primary);
    font-weight: 600;
}

.docs-collapsible-enter-active,
.docs-collapsible-leave-active {
    transition:
        opacity 0.18s ease,
        transform 0.18s ease;
    overflow: hidden;
}

.docs-collapsible-enter-from,
.docs-collapsible-leave-to {
    opacity: 0;
    transform: translateY(-3px);
}
</style>
