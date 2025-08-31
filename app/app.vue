<template>
    <UApp>
        <NuxtPage />
    </UApp>
</template>
<script setup lang="ts">
// Apply initial theme class to <html> so CSS variables cascade app-wide
useHead({
    htmlAttrs: {
        class: 'light',
    },
    title: 'or3 chat',
    link: [{ rel: 'icon', type: 'image/webp', href: '/butthole-logo.webp' }],
});

import { onMounted } from 'vue';
import { useNuxtApp } from '#app';

// Fire app.init:action:after once after the root app mounts (client-only)
const nuxtApp = useNuxtApp();

onMounted(() => {
    const g: any = globalThis as any;
    if (g.__OR3_APP_INIT_FIRED__) return;
    g.__OR3_APP_INIT_FIRED__ = true;
    const hooks: any = nuxtApp.$hooks;
    if (hooks && typeof hooks.doAction === 'function') {
        hooks.doAction('app.init:action:after', nuxtApp);
    }
});
</script>
