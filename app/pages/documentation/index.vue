<template>
    <DocumentationPageShell />
</template>

<script setup lang="ts">
import DocumentationPageShell from '~/components/documentation/DocumentationPageShell.vue';

definePageMeta({
    pageTransition: false,
    layoutTransition: false,
    keepalive: true,
});
</script>
