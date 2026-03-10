<template>
    <div class="lock-page min-h-dvh bg-[var(--md-surface)] text-[var(--md-on-surface)] flex flex-col items-center justify-center px-4">
        <div class="w-full max-w-sm space-y-8 text-center">
            <!-- Branding -->
            <div class="space-y-4">
                <div
                    class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[var(--md-primary)] theme-shadow"
                >
                    <UIcon :name="lockIcon" class="w-10 h-10 text-[var(--md-on-primary)]" />
                </div>
                <div>
                    <h1 class="text-3xl font-bold text-[var(--md-on-surface)] tracking-tight">
                        {{ siteName }}
                    </h1>
                    <p class="text-base text-[var(--md-on-surface-variant)] mt-1.5">
                        Sign in to access your workspace
                    </p>
                </div>
            </div>

            <!-- Auth surface -->
            <ClientOnly>
                <!--
                    The auth adapter component is designed for the sidebar (small icon button).
                    We hide it visually and render our own full-width sign-in button
                    that delegates the click to the adapter's internal trigger.
                -->
                <div v-if="authUiComponent" class="space-y-3">
                    <div ref="adapterSlot" class="hidden">
                        <component :is="authUiComponent" />
                    </div>
                    <UButton
                        block
                        size="xl"
                        color="primary"
                        :icon="loginIcon"
                        class="theme-shadow"
                        @click="triggerAdapterSignIn"
                    >
                        Sign in
                    </UButton>
                </div>

                <UAlert
                    v-else
                    color="warning"
                    variant="soft"
                    title="Auth unavailable"
                    description="No sign-in adapter is registered for this deployment."
                />

                <template #fallback>
                    <div class="h-12 rounded-[var(--md-border-radius)] bg-[var(--md-surface-variant)]/40 animate-pulse" />
                </template>
            </ClientOnly>

            <!-- Redirect hint -->
            <p
                v-if="requestedPath"
                class="text-xs text-[var(--md-on-surface-variant)]/60 break-all"
            >
                Redirecting to <span class="font-mono">{{ requestedPath }}</span> after sign-in
            </p>

            <!-- Footer -->
            <div
                v-if="termsUrl || privacyUrl"
                class="text-xs text-[var(--md-on-surface-variant)]/50 space-x-3"
            >
                <a v-if="termsUrl" :href="termsUrl" class="hover:text-[var(--md-primary)] transition-colors">Terms</a>
                <span v-if="termsUrl && privacyUrl">·</span>
                <a v-if="privacyUrl" :href="privacyUrl" class="hover:text-[var(--md-primary)] transition-colors">Privacy</a>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRuntimeConfig } from '#imports';
import { resolveAuthUiAdapter } from '~/core/auth-ui/registry';
import {
    resolvePostAuthRedirectTarget,
    useLockPageRuntimeConfig,
} from '~/core/lock-page/runtime';

const route = useRoute();
const runtimeConfig = useRuntimeConfig();
const lockPageConfig = useLockPageRuntimeConfig();

const lockIcon = useIcon('ui.lock');
const loginIcon = useIcon('ui.login');

const adapterSlot = ref<HTMLElement | null>(null);

const siteName = computed(() => {
    return (
        runtimeConfig.public?.or3?.site?.name ||
        runtimeConfig.public?.branding?.appName ||
        'OR3'
    );
});

const authProviderId = computed(() => lockPageConfig.authProvider);
const authUiComponent = computed(
    () => resolveAuthUiAdapter(authProviderId.value)?.component ?? null
);
const requestedPath = computed(() => {
    const target = resolvePostAuthRedirectTarget(
        route.query.next,
        lockPageConfig.route
    );
    return target === '/' ? null : target;
});
const termsUrl = computed(() => runtimeConfig.public?.legal?.termsUrl || null);
const privacyUrl = computed(() => runtimeConfig.public?.legal?.privacyUrl || null);

/** Click the hidden adapter button to open its native sign-in flow */
function triggerAdapterSignIn(): void {
    const btn = adapterSlot.value?.querySelector('button');
    btn?.click();
}
</script>
