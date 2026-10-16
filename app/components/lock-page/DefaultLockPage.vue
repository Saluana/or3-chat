<template>
    <div class="space-y-6">
        <UAlert
            v-if="accessReason === 'session-error'"
            color="error"
            variant="soft"
            title="Session check failed"
            :description="errorDescription"
        />

        <UAlert
            v-if="accessReason === 'forbidden'"
            color="warning"
            variant="soft"
            title="Workspace access unavailable"
            description="You're signed in, but this account doesn't have permission to open a workspace. Switch accounts below or ask your administrator for access."
        />

        <!-- Auth surface -->
        <ClientOnly>
            <div v-if="authUiComponent" class="space-y-3">
                <component :is="authUiComponent" />
                <UButton
                    v-if="showRetry"
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
                    v-if="showRetry"
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
            v-if="requestedPath && accessReason !== 'forbidden'"
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

const refreshIcon = 'i-heroicons-arrow-path';

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
const showRetry = computed(
    () => props.accessReason === 'session-error' || props.accessReason === 'forbidden'
);

function retrySessionCheck(): void {
    if (typeof window !== 'undefined') {
        window.location.reload();
    }
}
</script>
