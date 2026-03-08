<template>
    <component :is="documentationShellComponent" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNuxtApp } from '#app';
import DocumentationShell from '~/components/DocumentationShell.vue';

const documentationShellComponent = computed(
    () =>
        useNuxtApp().$theme.activeComponents.value['documentation-shell'] ??
        DocumentationShell
);
</script>
