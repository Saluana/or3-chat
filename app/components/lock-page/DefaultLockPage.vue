<template>
    <div class="lock-page min-h-dvh bg-(--md-surface) text-(--md-on-surface) flex flex-col items-center justify-center px-4">
        <div class="w-full max-w-sm space-y-8 text-center">
            <!-- Branding -->
            <div class="space-y-4">
                <div
                    class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-(--md-primary) theme-shadow"
                >
                    <UIcon :name="lockIcon" class="w-10 h-10 text-(--md-on-primary)" />
                </div>
                <div>
                    <h1 class="text-3xl font-bold text-(--md-on-surface) tracking-tight">
                        {{ siteName }}
                    </h1>
                    <p class="text-base text-(--md-on-surface-variant) mt-1.5">
                        Sign in to access your workspace
                    </p>
                </div>
            </div>

            <UAlert
                v-if="accessReason === 'session-error'"
                color="error"
                variant="soft"
                title="Session check failed"
                :description="errorDescription"
            />

            <!-- Auth surface -->
            <ClientOnly>
                <div v-if="authUiComponent" class="space-y-3 flex flex-col items-center">
                    <component :is="authUiComponent" />
                    <UButton
                        v-if="accessReason === 'session-error'"
                        size="lg"
                        color="neutral"
                        variant="outline"
                        :icon="refreshIcon"
                        @click="retrySessionCheck"
                    >
                        Retry
                    </UButton>
                </div>

                <div v-else class="space-y-3">
                    <UAlert
                        color="warning"
                        variant="soft"
                        title="Auth unavailable"
                        description="No lock page adapter is registered for this deployment."
                    />
                    <UButton
                        v-if="accessReason === 'session-error'"
                        block
                        size="lg"
                        color="neutral"
                        variant="outline"
                        :icon="refreshIcon"
                        @click="retrySessionCheck"
                    >
                        Retry session check
                    </UButton>
                </div>

                <template #fallback>
                    <div class="h-12 rounded-(--md-border-radius) bg-(--md-surface-variant)/40 animate-pulse" />
                </template>
            </ClientOnly>

            <!-- Redirect hint -->
            <p
                v-if="requestedPath"
                class="text-xs text-(--md-on-surface-variant)/60 break-all"
            >
                Redirecting to <span class="font-mono">{{ requestedPath }}</span> after sign-in
            </p>

            <!-- Footer -->
            <div
                v-if="termsUrl || privacyUrl"
                class="text-xs text-(--md-on-surface-variant)/50 space-x-3"
            >
                <a v-if="termsUrl" :href="termsUrl" class="hover:text-(--md-primary) transition-colors">Terms</a>
                <span v-if="termsUrl && privacyUrl">·</span>
                <a v-if="privacyUrl" :href="privacyUrl" class="hover:text-(--md-primary) transition-colors">Privacy</a>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRuntimeConfig } from '#imports';
import { resolveAuthUiAdapter } from '~/core/auth-ui/registry';
import {
    resolvePostAuthRedirectTarget,
    useLockPageRuntimeConfig,
} from '~/core/lock-page/runtime';

const props = withDefaults(defineProps<{
    accessReason?: string;
    errorMessage?: string;
}>(), {
    accessReason: 'unauthenticated',
    errorMessage: undefined,
});

const route = useRoute();
const runtimeConfig = useRuntimeConfig();
const lockPageConfig = useLockPageRuntimeConfig();

const lockIcon = useIcon('ui.lock');
const refreshIcon = 'i-heroicons-arrow-path';

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
const errorDescription = computed(() => {
    return props.errorMessage || 'The server could not verify your session right now. Try again in a moment.';
});

function retrySessionCheck(): void {
    if (typeof window !== 'undefined') {
        window.location.reload();
    }
}
</script>
