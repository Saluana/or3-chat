<template>
    <DocumentationShell />
</template>

<script setup lang="ts">
import DocumentationShell from '~/components/DocumentationShell.vue';

definePageMeta({
    pageTransition: false,
    layoutTransition: false,
    keepalive: true,
    key: 'documentation-shell',
});
</script>
