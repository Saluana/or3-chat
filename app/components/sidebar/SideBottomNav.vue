<template>
    <div
        v-bind="rootAttrs"
        :id="
            (typeof attrs.id === 'string' ? attrs.id : null) ??
            'bottom-nav-root'
        "
        class="bottomnav-root absolute bottom-0 w-[63.5px] border-t-[var(--md-border-width)] border-r-[var(--md-border-width)] border-[color:var(--md-border-color)] px-1 flex flex-col items-center justify-between"
    >
        <!-- MY INFO -->
        <UPopover
            :content="{
                side: 'right',
            }"
        >
            <UButton
                v-bind="infoButtonProps"
                type="button"
                aria-label="My Info"
            >
                <template #default>
                    <span class="flex flex-col items-center gap-1 w-full">
                        <UIcon
                            name="pixelarticons:user"
                            class="h-[18px] w-[18px]"
                        />
                        <span class="text-[7px] uppercase tracking-wider"
                            >INFO</span
                        >
                    </span>
                </template>
            </UButton>
            <template #content>
                <div class="flex flex-col items-start w-[140px]">
                    <UButton
                        v-bind="activityButtonProps"
                        @click="navigateToActivity"
                    >
                        <UIcon name="pixelarticons:human-run" class="mr-1.5" />
                        Activity
                    </UButton>
                    <UButton
                        v-bind="creditsButtonProps"
                        @click="navigateToCredits"
                    >
                        <UIcon name="pixelarticons:coin" class="mr-1.5" />
                        Credits
                    </UButton>
                </div>
            </template>
        </UPopover>

        <!-- Connect -->
        <UButton
            v-bind="connectButtonProps"
            type="button"
            @click="onConnectButtonClick"
            :data-connection-state="connectionState"
            :aria-label="
                hydrated
                    ? orIsConnected
                        ? 'Disconnect from OpenRouter'
                        : 'Connect to OpenRouter'
                    : 'Connect to OpenRouter'
            "
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
                    <span class="text-[7px] uppercase tracking-wider">
                        <template v-if="hydrated">
                            {{ orIsConnected ? 'Disconnect' : 'Connect' }}
                        </template>
                        <template v-else>Connect</template>
                    </span>
                    <span
                        class="w-[54%] h-[3px] opacity-50"
                        :class="
                            orIsConnected
                                ? 'bg-[var(--md-success)] opacity-100'
                                : 'bg-[var(--md-error)]'
                        "
                        aria-hidden="true"
                    ></span>
                </span>
            </template>
        </UButton>

        <!-- DASHBOARD -->
        <UButton
            v-bind="dashboardButtonProps"
            @click="emit('toggleDashboard')"
            type="button"
            aria-label="Dashboard"
        >
            <template #default>
                <span class="flex flex-col items-center gap-1 w-full">
                    <UIcon
                        class="w-[18px] h-[18px]"
                        name="pixelarticons:dashboard"
                    />
                    <span class="text-[7px] uppercase tracking-wider"
                        >Dashboard</span
                    >
                </span>
            </template>
        </UButton>
    </div>
    <lazy-modal-model-catalog
        hydrate-on-visible
        v-model:showModal="showSettingsModal"
    />
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, useAttrs } from 'vue';
import { state } from '~/state/global';
import { useThemeOverrides } from '~/composables/useThemeResolver';

defineOptions({ inheritAttrs: false });

const openrouter = useOpenRouterAuth();
const orIsConnected = computed(() => state.value.openrouterKey);
// Hydration mismatch fix: only show dynamic connection state after client mounted
const hydrated = ref(false);
onMounted(() => {
    hydrated.value = true;
});
const showSettingsModal = ref(false);
const attrs = useAttrs();
const rootAttrs = computed(() => {
    return Object.fromEntries(
        Object.entries(attrs).filter(([key]) => key !== 'id')
    ) as Record<string, unknown>;
});

const emit = defineEmits(['toggleDashboard']);

// Theme-integrated button props
const infoButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.info',
        isNuxtUI: true,
    });
    return {
        variant: 'soft' as const,
        color: 'neutral' as const,
        block: true,
        ...(overrides.value as any),
    };
});

const connectionState = computed(() =>
    hydrated.value
        ? orIsConnected.value
            ? 'connected'
            : 'disconnected'
        : 'loading'
);

const connectOverrideParams = computed(() => ({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.bottom-nav.connect',
    state: connectionState.value,
    isNuxtUI: true,
}));

const connectOverrides = useThemeOverrides(connectOverrideParams);

const connectButtonProps = computed(() => {
    return {
        variant: 'soft' as const,
        color: 'neutral' as const,
        block: true,
        ...(connectOverrides.value as any),
    };
});

const dashboardButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.dashboard',
        isNuxtUI: true,
    });
    return {
        variant: 'soft' as const,
        color: 'neutral' as const,
        block: true,
        ...(overrides.value as any),
    };
});

// Popover menu buttons
const activityButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.activity',
        isNuxtUI: true,
    });
    return {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        block: true,
        ...(overrides.value as any),
    };
});

const creditsButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.credits',
        isNuxtUI: true,
    });
    return {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        block: true,
        ...(overrides.value as any),
    };
});

function onConnectButtonClick() {
    if (orIsConnected.value) {
        // Logic to disconnect
        state.value.openrouterKey = null;
        openrouter.logoutOpenRouter();
    } else {
        // Logic to connect
        openrouter.startLogin();
    }
}

function navigateToActivity() {
    window.open('https://openrouter.ai/activity', '_blank');
}

function navigateToCredits() {
    window.open('https://openrouter.ai/settings/credits', '_blank');
}
</script>

<style scoped>
/* Root area background uses configurable bottom nav color */
.bottomnav-root {
    justify-content: flex-start;
    gap: 4px; /* MD3 vertical spacing unit */
    /* Respect device safe areas so the bottom button never collides with OS UI */
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
</style>
