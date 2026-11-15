<template>
    <PageShell
        :initial-thread-id="isDocs ? undefined : routeId"
        :initial-document-id="isDocs ? routeId : undefined"
        :default-mode="isDocs ? 'doc' : 'chat'"
        :validate-initial="Boolean(routeId)"
    />
    <PluginDevelopmentController v-if="pluginDevelopment && !isDocs" />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
import { computed, defineAsyncComponent } from 'vue';
import { useHead, useRoute, useRuntimeConfig } from '#imports';
import { BOOT_SESSION_SCRIPT } from '~/utils/boot-session';

const PluginDevelopmentController = defineAsyncComponent(() =>
    import('~/components/plugins/PluginDevelopmentController.vue')
);

// The workspace routes share a page key, keeping one shell mounted as their
// distinct route records change. These props only seed its first render.
definePageMeta({
    key: 'workspace',
    lockPageProtected: true,
});

const route = useRoute();
const isDocs = computed(() => route.path === '/docs' || route.path.startsWith('/docs/'));
const routeId = computed(() => (typeof route.params.id === 'string' ? route.params.id : '') || undefined);
const runtimeConfig = useRuntimeConfig();
const pluginDevelopment = runtimeConfig.public.pluginDevelopment === true;

// Start the session check from the HTML; every boot request waits on it.
if (import.meta.server && runtimeConfig.public.ssrAuthEnabled === true) {
    useHead({ script: [{ key: 'or3-boot-session', innerHTML: BOOT_SESSION_SCRIPT, tagPriority: 'critical' }] });
}
</script>
