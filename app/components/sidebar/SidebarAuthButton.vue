<template>
    <!-- SSR Auth Mode: Clerk SignIn/UserButton + Optional OpenRouter -->
    <template v-if="isSsrAuthEnabled">
        <SidebarAuthButtonClerk />
        <!-- Show OpenRouter button when user override is allowed -->
        <UButton
            v-if="allowUserOverride"
            v-bind="buttonProps"
            type="button"
            @click="onOpenRouterClick"
            :data-connection-state="connectionState"
            :aria-label="ariaLabel"
        >
            <template #default>
                <span class="flex flex-col items-center gap-1 w-full">
                    <svg
                        class="w-[18px] h-[18px]"
                        viewBox="0 0 512 512"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="currentColor"
                        stroke="currentColor"
                    >
                        <g>
                            <path
                                d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
                                stroke-width="90"
                            />
                            <path
                                d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z"
                            />
                            <path
                                d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
                                stroke-width="90"
                            />
                            <path
                                d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z"
                            />
                        </g>
                    </svg>
                    <span
                        class="text-[7px] uppercase tracking-wider whitespace-nowrap"
                    >
                        <template v-if="hydrated">{{ connectionLabel }}</template>
                        <template v-else>Connect</template>
                    </span>
                    <span
                        class="w-[54%] h-[3px] opacity-50"
                        :class="
                            isConnected
                                ? 'bg-[var(--md-success)] opacity-100'
                                : 'bg-[var(--md-error)]'
                        "
                        aria-hidden="true"
                    ></span>
                </span>
            </template>
        </UButton>
    </template>

    <!-- Static Build Mode: OpenRouter Auth Only -->
    <template v-else>
        <UButton
            v-bind="buttonProps"
            type="button"
            @click="onOpenRouterClick"
            :data-connection-state="connectionState"
            :aria-label="ariaLabel"
        >
            <template #default>
                <span class="flex flex-col items-center gap-1 w-full">
                    <svg
                        class="w-[18px] h-[18px]"
                        viewBox="0 0 512 512"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="currentColor"
                        stroke="currentColor"
                    >
                        <g>
                            <path
                                d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
                                stroke-width="90"
                            />
                            <path
                                d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z"
                            />
                            <path
                                d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
                                stroke-width="90"
                            />
                            <path
                                d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z"
                            />
                        </g>
                    </svg>
                    <span
                        class="text-[7px] uppercase tracking-wider whitespace-nowrap"
                    >
                        <template v-if="hydrated">{{ connectionLabel }}</template>
                        <template v-else>Connect</template>
                    </span>
                    <span
                        class="w-[54%] h-[3px] opacity-50"
                        :class="
                            isConnected
                                ? 'bg-[var(--md-success)] opacity-100'
                                : 'bg-[var(--md-error)]'
                        "
                        aria-hidden="true"
                    ></span>
                </span>
            </template>
        </UButton>
    </template>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { state } from '~/state/global';
import { useThemeOverrides } from '~/composables/useThemeResolver';

// Check if SSR auth is enabled via runtime config
const runtimeConfig = useRuntimeConfig();
const ssrAuthEnabled = runtimeConfig.public?.ssrAuthEnabled === true;
const isSsrAuthEnabled = computed(() => ssrAuthEnabled);
const openRouterConfig = computed(
    () => runtimeConfig.public?.openRouter ?? {}
);
const allowUserOverride = computed(
    () => openRouterConfig.value.allowUserOverride !== false
);
const hasInstanceKey = computed(
    () => openRouterConfig.value.hasInstanceKey === true
);

// Hydration mismatch fix
const hydrated = ref(false);
onMounted(() => {
    hydrated.value = true;
});

// OpenRouter state - needed in both SSR and non-SSR modes for user override
const openrouter = useOpenRouterAuth();
const isConnected = computed(() => Boolean(state.value.openrouterKey));
const usingInstanceKey = computed(
    () => hasInstanceKey.value && (!allowUserOverride.value || !isConnected.value)
);
const effectiveConnected = computed(
    () => isConnected.value || usingInstanceKey.value
);

const connectionState = computed(() =>
    hydrated.value ? (isConnected.value ? 'connected' : 'disconnected') : 'loading'
);

const connectionLabel = computed(() => {
    if (!hydrated.value) return 'Connect';
    return isConnected.value ? 'Disconnect' : 'Connect';
});

const isManaged = computed(
    () => usingInstanceKey.value && !allowUserOverride.value
);

const ariaLabel = computed(() => {
    if (!hydrated.value) return 'Connect to OpenRouter';
    if (isManaged.value) return 'OpenRouter managed by instance';
    if (isConnected.value) return 'Disconnect from OpenRouter';
    if (usingInstanceKey.value) return 'Using instance OpenRouter key';
    return 'Connect to OpenRouter';
});

// Button props with theme overrides - match other sidebar buttons exactly
const buttonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.auth',
        state: isSsrAuthEnabled.value ? 'ssr' : connectionState.value,
        isNuxtUI: true,
    });
    return {
        variant: 'soft' as const,
        color: 'neutral' as const,
        block: true,
        disabled: isManaged.value,
        ...overrides.value,
    };
});

function onOpenRouterClick() {
    if (isManaged.value) {
        return;
    }
    if (isConnected.value) {
        state.value.openrouterKey = null;
        openrouter.logoutOpenRouter();
    } else {
        openrouter.startLogin();
    }
}
</script>
