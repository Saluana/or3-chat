<template>
    <PageShell default-mode="chat" />
    <PluginDevelopmentController v-if="pluginDevelopment" />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';
import PluginDevelopmentController from '~/components/plugins/PluginDevelopmentController.vue';

const pluginDevelopment = useRuntimeConfig().public.pluginDevelopment === true;

definePageMeta({
    lockPageProtected: true,
});
</script>
