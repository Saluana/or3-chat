<template>
    <PageShell default-mode="doc" />
</template>
<script setup lang="ts">
import PageShell from '~/components/PageShell.vue';

definePageMeta({
    lockPageProtected: true,
});
</script>
