<script setup lang="ts">
import PluginSetupPage from '~/components/plugins/PluginSetupPage.vue';

const route = useRoute();
const pluginId = computed(() => String(route.params.pluginId ?? ''));
</script>

<template>
    <PluginSetupPage :plugin-id="pluginId" />
</template>
