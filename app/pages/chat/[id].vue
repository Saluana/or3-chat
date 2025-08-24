<template>
    <ChatPageShell :initial-thread-id="routeId" validate-initial />
</template>
<script setup lang="ts">
import ChatPageShell from '~/components/chat/ChatPageShell.vue';
const route = useRoute();
const routeId = (route.params.id as string) || '';
</script>
