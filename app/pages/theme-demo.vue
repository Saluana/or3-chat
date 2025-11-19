<template>
    <div class="container mx-auto p-8">
        <h1 class="text-3xl font-bold mb-8">
            Refined Theme System - Phase 2 Demo
        </h1>

        <div class="space-y-6">
            <!-- Basic Usage -->
            <section class="border border-gray-300 rounded-lg p-6">
                <h2 class="text-xl font-semibold mb-4">
                    1. Basic v-theme Usage
                </h2>
                <p class="mb-4 text-sm text-gray-600">
                    These buttons use v-theme directive without any identifier
                    (global defaults)
                </p>
                <div class="flex gap-4">
                    <UButton v-theme>Default Button</UButton>
                    <UButton v-theme color="primary">Primary Button</UButton>
                    <UButton v-theme variant="outline">Outline Button</UButton>
                </div>
            </section>

            <!-- Context-based Theming -->
            <section class="border border-gray-300 rounded-lg p-6">
                <h2 class="text-xl font-semibold mb-4">
                    2. Context-based Theming
                </h2>
                <p class="mb-4 text-sm text-gray-600">
                    Context is auto-detected from DOM (this section has
                    data-context="chat")
                </p>
                <div data-context="chat" class="space-y-4">
                    <div class="flex gap-4">
                        <UButton v-theme>Chat Button</UButton>
                        <UInput v-theme placeholder="Type a message..." />
                    </div>
                    <p class="text-xs text-gray-500">
                        These components should receive "chat" context-specific
                        styling from the theme
                    </p>
                </div>
            </section>

            <!-- Identifier-based Theming -->
            <section class="border border-gray-300 rounded-lg p-6">
                <h2 class="text-xl font-semibold mb-4">
                    3. Identifier-based Theming
                </h2>
                <p class="mb-4 text-sm text-gray-600">
                    Explicit identifier provides highest specificity
                </p>
                <div class="flex gap-4">
                    <UButton v-theme="'chat.send'">Send Message</UButton>
                    <UButton v-theme="{ identifier: 'chat.send' }"
                        >Send (Object Syntax)</UButton
                    >
                </div>
                <p class="text-xs text-gray-500 mt-2">
                    Identifier: "chat.send" - defined in example-refined theme
                </p>
            </section>

            <!-- Programmatic Usage -->
            <section class="border border-gray-300 rounded-lg p-6">
                <h2 class="text-xl font-semibold mb-4">
                    4. Programmatic Resolution
                </h2>
                <p class="mb-4 text-sm text-gray-600">
                    Using useThemeOverrides composable for reactive props
                </p>
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm mb-2"
                            >Select Context:</label
                        >
                        <select
                            v-model="selectedContext"
                            class="border border-gray-300 rounded px-3 py-2"
                        >
                            <option value="global">Global</option>
                            <option value="chat">Chat</option>
                            <option value="sidebar">Sidebar</option>
                            <option value="dashboard">Dashboard</option>
                        </select>
                    </div>
                    <UButton v-bind="buttonOverrides">
                        Dynamic Context Button ({{ selectedContext }})
                    </UButton>
                    <pre
                        class="bg-gray-100 p-3 rounded text-xs overflow-auto"
                        >{{ JSON.stringify(buttonOverrides, null, 2) }}</pre
                    >
                </div>
            </section>

            <!-- Theme Switching -->
            <section class="border border-gray-300 rounded-lg p-6">
                <h2 class="text-xl font-semibold mb-4">5. Theme Switching</h2>
                <p class="mb-4 text-sm text-gray-600">
                    Active Theme: <strong>{{ activeTheme }}</strong>
                </p>
                <div class="space-y-4">
                    <div class="flex gap-4">
                        <button
                            @click="switchTheme('default')"
                            class="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100"
                        >
                            Default Theme
                        </button>
                        <button
                            @click="switchTheme('nature')"
                            class="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100"
                        >
                            Nature Theme
                        </button>
                    </div>
                    <div class="flex gap-4">
                        <UButton v-theme>Button (auto-updates)</UButton>
                        <UInput v-theme placeholder="Input (auto-updates)" />
                    </div>
                    <p class="text-xs text-gray-500">
                        Note: Components automatically update when theme changes
                        (reactive)
                    </p>
                </div>
            </section>

            <!-- Component Props Override -->
            <section class="border border-gray-300 rounded-lg p-6">
                <h2 class="text-xl font-semibold mb-4">
                    6. Component Props Override Theme
                </h2>
                <p class="mb-4 text-sm text-gray-600">
                    Explicit props always win over theme defaults
                </p>
                <div class="flex gap-4">
                    <UButton v-theme="'chat.send'">Theme Default</UButton>
                    <UButton v-theme="'chat.send'" color="success">
                        Explicit Color Wins
                    </UButton>
                    <UButton v-theme="'chat.send'" size="xl" variant="outline">
                        Multiple Props Win
                    </UButton>
                </div>
            </section>

            <!-- Debug Info -->
            <section class="border border-gray-300 rounded-lg p-6 bg-gray-50">
                <h2 class="text-xl font-semibold mb-4">Debug Information</h2>
                <div class="space-y-2 text-sm">
                    <p><strong>Active Theme:</strong> {{ activeTheme }}</p>
                    <p>
                        <strong>Resolver Available:</strong>
                        {{ hasResolver ? '✅ Yes' : '❌ No' }}
                    </p>
                    <p>
                        <strong>Theme Plugin:</strong>
                        {{ hasThemePlugin ? '✅ Loaded' : '❌ Not Found' }}
                    </p>
                    <p class="text-xs text-gray-500 mt-4">
                        Open browser console to see theme resolution logs (dev
                        mode only)
                    </p>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useNuxtApp } from '#app';
import { useThemeResolver } from '~/composables/useThemeResolver';
import type { ThemePlugin } from '~/plugins/90.theme.client';

// Use theme resolver composable
const { activeTheme, setActiveTheme, resolveOverrides } = useThemeResolver();

// Selected context for demo
const selectedContext = ref<'global' | 'chat' | 'sidebar' | 'dashboard'>(
    'global'
);

// Reactive button overrides based on selected context
const buttonOverrides = computed(() => {
    return resolveOverrides({
        component: 'button',
        context: selectedContext.value,
        isNuxtUI: true,
    });
});

// Theme switching
const switchTheme = async (themeName: string) => {
    try {
        await setActiveTheme(themeName);
        console.log(`[demo] Switched to theme: ${themeName}`);
    } catch (error) {
        console.error('[demo] Failed to switch theme:', error);
    }
};

// Debug info
const nuxtApp = useNuxtApp();
const themePlugin = computed(() => nuxtApp.$theme as ThemePlugin | undefined);
const hasThemePlugin = computed(() => Boolean(themePlugin.value));
const hasResolver = computed(() => {
    const plugin = themePlugin.value;
    if (!plugin) return false;
    return Boolean(plugin.getResolver(activeTheme.value));
});

// Log on mount
onMounted(() => {
    console.log('[demo] Theme Demo Page Mounted');
    console.log('[demo] Active Theme:', activeTheme.value);
    console.log('[demo] Has Resolver:', hasResolver.value);
});
</script>

<style scoped>
/* Add any demo-specific styles here */
</style>
