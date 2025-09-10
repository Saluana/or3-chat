<template>
    <UApp>
        <!-- Register the PWA web manifest on all pages -->
        <VitePwaManifest />
        <NuxtPage />
    </UApp>
</template>
<script setup lang="ts">
// Apply initial theme class to <html> so CSS variables cascade app-wide
const nuxtApp = useNuxtApp();
const isDark = computed(() =>
    (
        (nuxtApp as any).$theme?.current?.value ||
        (nuxtApp as any).$theme?.get?.() ||
        'light'
    ).startsWith('dark')
);
const themeColor = computed(() => (isDark.value ? '#1A1F24' : '#F1F4FB'));
const statusBarStyle = computed(() =>
    isDark.value ? 'black-translucent' : 'default'
);

useHead({
    htmlAttrs: {
        class: 'light',
    },
    title: 'or3 chat',
    link: [
        { rel: 'icon', type: 'image/webp', href: '/butthole-logo.webp' },
        // Provide an Apple touch icon to avoid 404s in Safari/iOS
        { rel: 'apple-touch-icon', href: '/logos/logo-192.png' },
    ],
    meta: [
        // Dynamic browser/UI theme color (Chrome, Android, iOS 15+ Safari)
        { name: 'theme-color', content: themeColor },
        // Enable iOS PWA full-screen and control status bar style
        { name: 'mobile-web-app-capable', content: 'yes' },
        {
            name: 'apple-mobile-web-app-status-bar-style',
            content: statusBarStyle,
        },
        // Ensure content can extend under the notch when using black-translucent
        {
            name: 'viewport',
            content: 'width=device-width, initial-scale=1, viewport-fit=cover',
        },
    ],
});

// Fire app.init:action:after once after the root app mounts (client-only)
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
