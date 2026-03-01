<template>
    <nav class="flex-1 overflow-y-auto p-2 space-y-1" aria-label="Admin pages">
        <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            :aria-current="isActive(link.to) ? 'page' : undefined"
            class="flex items-center gap-3 px-3 text-sm font-medium rounded-[var(--md-sys-shape-corner-small,4px)] transition-all duration-200 hover:bg-[var(--md-primary)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--md-primary)] focus:ring-offset-2 focus:ring-offset-[var(--md-surface-container)] group relative"
            :class="[
                isActive(link.to)
                    ? 'bg-[var(--md-primary)]/15 text-[var(--md-primary)] shadow-sm'
                    : 'text-[var(--md-on-surface-variant)]',
                isDesktop && collapsed ? 'justify-center py-2' : isDesktop ? 'py-2' : 'py-3'
            ]"
            @click="$emit('navigate')"
        >
            <UIcon
                v-if="link.icon"
                :name="link.icon"
                class="w-5 h-5 flex-shrink-0"
                :class="isActive(link.to) ? 'text-[var(--md-primary)]' : 'opacity-70 group-hover:opacity-100'"
            />

            <span v-if="!(isDesktop && collapsed)" class="flex-1" :class="isDesktop ? 'truncate' : ''">
                {{ link.label }}
            </span>

            <UIcon
                v-if="isMobile && isActive(link.to)"
                :name="activeIndicatorIcon"
                class="w-4 h-4 opacity-60"
            />

            <div
                v-if="isDesktop && collapsed"
                class="absolute left-full ml-2 px-2 py-1 bg-[var(--md-surface-container-highest)] text-[var(--md-on-surface)] text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity duration-150"
            >
                {{ link.label }}
            </div>
        </NuxtLink>
    </nav>
</template>

<script setup lang="ts">
interface NavLink {
    label: string;
    to: string;
    icon: string;
}

const props = withDefaults(
    defineProps<{
        links: NavLink[];
        activePath: string;
        collapsed?: boolean;
        density?: 'mobile' | 'desktop';
    }>(),
    {
        collapsed: false,
        density: 'desktop',
    }
);

defineEmits<{
    navigate: [];
}>();

const activeIndicatorIcon = useIcon('ui.check');

const isMobile = computed(() => props.density === 'mobile');
const isDesktop = computed(() => props.density === 'desktop');

function isActive(path: string) {
    if (path === '/admin') {
        return props.activePath === '/admin';
    }
    return props.activePath.startsWith(path);
}
</script>

<style scoped>
nav::-webkit-scrollbar {
    width: 4px;
}

nav::-webkit-scrollbar-track {
    background: transparent;
}

nav::-webkit-scrollbar-thumb {
    background: var(--md-outline-variant);
    border-radius: 2px;
}

nav::-webkit-scrollbar-thumb:hover {
    background: var(--md-outline);
}
</style>
