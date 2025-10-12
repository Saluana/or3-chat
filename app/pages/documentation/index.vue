<template>
    <DocumentationShell />
</template>

<script setup lang="ts">
import DocumentationShell from '~/components/DocumentationShell.vue';

// Define page meta to control transitions and keep-alive
definePageMeta({
    pageTransition: false,
    layoutTransition: false,
    keepalive: true,
});
</script>
