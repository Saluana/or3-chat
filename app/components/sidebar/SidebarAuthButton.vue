<template>
    <UPopover
        v-if="!isSsrAuthEnabled || allowUserOverride"
        v-model:open="menuOpen"
        :content="{ side: 'right', align: 'end', sideOffset: 8 }"
    >
    <UTooltip
        text="OpenRouter"
        :delay-duration="0"
        :disabled="menuOpen"
        :content="{ side: 'right' }"
    >
        <UButton
            v-bind="buttonProps"
            type="button"
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
                        class="sidebar-rail-caption text-[7px] uppercase tracking-wider whitespace-nowrap"
                    >
                        <template v-if="hydrated">{{ connectionLabel }}</template>
                        <template v-else>Connect</template>
                    </span>
                    <span
                        class="sidebar-connection-status-bar w-[54%] h-[3px] opacity-50"
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
    </UTooltip>
        <template #content>
            <div id="openrouter-status-menu" class="or3-action-menu flex flex-col gap-0.5 p-1.5 w-[260px]">
                <div class="flex items-start gap-3 px-1.5 pt-1.5 pb-2">
                    <span
                        class="mt-1.5 size-2 shrink-0 rounded-full"
                        :class="isConnected || usingInstanceKey ? 'bg-[var(--md-success)]' : 'bg-[var(--md-error)]'"
                        aria-hidden="true"
                    />
                    <div class="min-w-0">
                        <p class="text-[14px] font-medium text-[var(--md-on-surface)]">{{ statusTitle }}</p>
                        <p class="text-[12px] leading-snug text-[var(--md-on-surface-variant)]">{{ statusDetail }}</p>
                    </div>
                </div>
                <div class="h-px mx-1.5 mb-0.5 bg-[var(--md-border-color)]" aria-hidden="true" />
                <button
                    v-for="item in menuItems"
                    :id="`openrouter-menu-${item.id}`"
                    :key="item.id"
                    type="button"
                    class="flex items-center gap-2.5 w-full min-h-[36px] px-2 rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[14px] text-left transition-colors duration-[var(--app-motion-duration-fast,150ms)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] cursor-pointer focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))]"
                    :class="item.danger ? 'text-[var(--md-error)]' : 'text-[var(--md-on-surface)]'"
                    @click="runMenuItem(item)"
                >
                    <UIcon :name="item.icon" class="size-4 shrink-0 opacity-80" />
                    <span class="flex-1">{{ item.label }}</span>
                    <UIcon v-if="item.external" name="i-lucide-arrow-up-right" class="size-3.5 shrink-0 opacity-50" />
                </button>
            </div>
        </template>
    </UPopover>
    <UTooltip
        v-if="isSsrAuthEnabled"
        text="Account"
        :delay-duration="0"
        :content="{ side: 'right' }"
    >
        <div class="sidebar-auth-adapter flex items-center justify-center">
            <component :is="authUiComponent" />
        </div>
    </UTooltip>
    <ConfirmDialog
        v-model="confirmDisconnectOpen"
        title="Disconnect OpenRouter?"
        :message="isSsrAuthEnabled ? 'Your OpenRouter connection will be removed from your account on every device.' : 'Your OpenRouter key will be removed from this browser.'"
        confirm-text="Disconnect"
        danger
        @confirm="disconnectOpenRouter"
    />
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useRuntimeConfig } from '#imports';
import { state } from '~/state/global';
import { useUserApiKey } from '~/core/auth/useUserApiKey';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import SidebarAuthButtonFallback from './SidebarAuthButtonFallback.client.vue';
import { resolveAuthUiAdapter } from '~/core/auth-ui/registry';
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
import ConfirmDialog from '~/components/admin/ConfirmDialog.vue';

// Check if SSR auth is enabled via runtime config
const runtimeConfig = useRuntimeConfig();
const ssrAuthEnabled = runtimeConfig.public?.ssrAuthEnabled === true;
const isSsrAuthEnabled = computed(() => ssrAuthEnabled);
const authProviderId = computed(() =>
    String(runtimeConfig.public?.authProvider ?? 'clerk')
);
const openRouterConfig = computed(
    () => runtimeConfig.public?.openRouter ?? {}
);
const requireUserKey = computed(
    () => openRouterConfig.value.requireUserKey === true
);
const allowUserOverride = computed(
    () => openRouterConfig.value.allowUserOverride !== false || requireUserKey.value
);
const hasInstanceKey = computed(
    () => openRouterConfig.value.hasInstanceKey === true && !requireUserKey.value
);

// Hydration mismatch fix
const hydrated = ref(false);
onMounted(() => {
    hydrated.value = true;
});

// OpenRouter state - needed in both SSR and non-SSR modes for user override
const openrouter = useOpenRouterAuth();
const { connected: isConnected } = useUserApiKey();
const usingInstanceKey = computed(
    () => hasInstanceKey.value && (!allowUserOverride.value || !isConnected.value)
);

const connectionState = computed(() =>
    hydrated.value ? (isConnected.value ? 'connected' : 'disconnected') : 'loading'
);

const connectionLabel = computed(() => {
    if (!hydrated.value) return 'Connect';
    if (usingInstanceKey.value && !isConnected.value) return 'Connect';
    return isConnected.value ? 'Disconnect' : 'Connect';
});

const isManaged = computed(
    () => usingInstanceKey.value && !allowUserOverride.value
);
const authUiComponent = computed(() => {
    const adapter = resolveAuthUiAdapter(authProviderId.value);
    return adapter?.component ?? SidebarAuthButtonFallback;
});

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
        identifier: 'sidebar.bottom-nav.connect',
        state: connectionState.value,
        isNuxtUI: true,
    });
    return {
        block: true,
        ...overrides.value,
    };
});

// The rail icon only opens this menu: leaving the app for OpenRouter's sign-up
// page, or removing a key, must be an explicit, labelled choice.
const menuOpen = ref(false);
const statusTitle = computed(() => {
    if (isConnected.value) return 'Using your OpenRouter key';
    if (usingInstanceKey.value) return 'Using this workspace’s key';
    return 'OpenRouter not connected';
});
const statusDetail = computed(() => {
    if (isConnected.value) return 'Requests are billed to your OpenRouter account.';
    if (isManaged.value) return 'Your administrator manages the OpenRouter connection.';
    if (usingInstanceKey.value) return 'Connect your own key to use your OpenRouter credits and models.';
    return 'Connect an OpenRouter account to start chatting.';
});

interface OpenRouterMenuItem { id: string; label: string; icon: string; external?: boolean; danger?: boolean; run: () => void }
const menuItems = computed<OpenRouterMenuItem[]>(() => {
    const items: OpenRouterMenuItem[] = [];
    if (!isManaged.value && !isConnected.value) {
        items.push({ id: 'connect', label: 'Connect your own key', icon: 'i-lucide-key-round', run: () => openrouter.startLogin() });
    }
    if (isConnected.value) {
        items.push(
            { id: 'activity', label: 'Usage activity', icon: 'i-lucide-activity', external: true, run: () => window.open('https://openrouter.ai/activity', '_blank', 'noopener') },
            { id: 'credits', label: 'Credits', icon: 'i-lucide-wallet', external: true, run: () => window.open('https://openrouter.ai/settings/credits', '_blank', 'noopener') },
            // Removing the key is destructive; it still asks for confirmation.
            { id: 'disconnect', label: 'Disconnect…', icon: 'i-lucide-unplug', danger: true, run: () => { confirmDisconnectOpen.value = true; } },
        );
    }
    return items;
});
function runMenuItem(item: OpenRouterMenuItem) {
    menuOpen.value = false;
    item.run();
}

const confirmDisconnectOpen = ref(false);
function disconnectOpenRouter() {
    state.value.openrouterKey = null;
    openrouter.logoutOpenRouter();
}
</script>
