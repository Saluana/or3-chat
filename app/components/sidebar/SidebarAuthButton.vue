<template>
    <UPopover
        v-if="!isSsrAuthEnabled || allowUserOverride"
        v-model:open="menuOpen"
        :content="{ side: 'right', align: 'end', sideOffset: 8 }"
    >
    <UTooltip
        text="Connections"
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
                    <span class="relative inline-flex">
                        <UIcon name="i-lucide-plug" class="w-5 h-5" />
                        <span
                            v-if="hydrated && needsConnection"
                            class="absolute -top-0.5 -right-1 size-2 rounded-full bg-[var(--md-error)] ring-2 ring-[var(--md-surface)]"
                            aria-hidden="true"
                        />
                    </span>
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
            <div id="connections-menu" class="connections-panel w-[300px] p-1.5">
                <p class="px-2 pt-1.5 pb-1 text-[12px] font-medium text-[var(--md-on-surface-variant)]">Connections</p>

                <!-- OpenRouter -->
                <section class="connection-row" aria-label="OpenRouter">
                    <span class="connection-logo" aria-hidden="true"><UIcon name="i-simple-icons-openrouter" class="size-4" /></span>
                    <div class="min-w-0 flex-1">
                        <p class="connection-name">OpenRouter</p>
                        <p class="connection-status">
                            <span class="connection-dot" :class="openRouterActive ? 'bg-[var(--md-success)]' : 'bg-[var(--md-outline)]'" aria-hidden="true" />
                            {{ openRouterStatus }}
                        </p>
                    </div>
                    <button
                        v-if="!isManaged && !isConnected"
                        id="openrouter-menu-connect"
                        type="button"
                        class="connection-action"
                        :class="{ 'connection-action--primary': !openRouterActive }"
                        aria-label="Connect with OpenRouter"
                        @click="connectOpenRouter"
                    >Connect</button>
                    <button
                        v-else-if="isConnected"
                        id="openrouter-menu-disconnect"
                        type="button"
                        class="connection-action"
                        aria-label="Disconnect OpenRouter"
                        @click="askDisconnect"
                    >Disconnect</button>
                </section>
                <div v-if="isConnected" class="flex gap-1 pl-[46px] pr-2 pb-1.5">
                    <a class="connection-link" href="https://openrouter.ai/activity" target="_blank" rel="noopener">Usage <UIcon name="i-lucide-arrow-up-right" class="size-3" /></a>
                    <a class="connection-link" href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener">Credits <UIcon name="i-lucide-arrow-up-right" class="size-3" /></a>
                </div>

                <!-- OpenAI -->
                <section class="connection-row" aria-label="OpenAI">
                    <span class="connection-logo" aria-hidden="true"><UIcon name="i-simple-icons-openai" class="size-4" /></span>
                    <div class="min-w-0 flex-1">
                        <p class="connection-name">OpenAI</p>
                        <p class="connection-status">
                            <span class="connection-dot" :class="openAi.connected || openAi.instance ? 'bg-[var(--md-success)]' : 'bg-[var(--md-outline)]'" aria-hidden="true" />
                            {{ openAiStatus }}
                        </p>
                    </div>
                    <button
                        v-if="openAi.available && !openAi.connected && !openAiFormOpen"
                        id="openai-menu-connect"
                        type="button"
                        class="connection-action"
                        aria-label="Connect with an OpenAI API key"
                        @click="openAiFormOpen = true"
                    >Add key</button>
                    <button
                        v-else-if="openAi.connected"
                        id="openai-menu-remove"
                        type="button"
                        class="connection-action"
                        aria-label="Remove OpenAI API key"
                        :disabled="openAiBusy"
                        @click="removeOpenAi"
                    >Remove</button>
                </section>
                <form v-if="openAiFormOpen && !openAi.connected" class="flex gap-1.5 pl-[46px] pr-2 pb-2" @submit.prevent="saveOpenAi">
                    <UInput
                        v-model="openAiKeyInput"
                        type="password"
                        size="sm"
                        autocomplete="off"
                        autofocus
                        placeholder="sk-…"
                        aria-label="OpenAI API key"
                        class="flex-1 min-w-0"
                        :disabled="openAiBusy"
                    />
                    <UButton type="submit" size="sm" label="Save" :loading="openAiBusy" :disabled="!openAiKeyInput.trim()" />
                </form>
                <p v-if="openAiError" class="pl-[46px] pr-2 pb-2 text-[12px] leading-snug text-[var(--md-error)]" role="alert">{{ openAiError }}</p>

                <p class="mx-2 mt-1 pt-2 pb-1 border-t border-[var(--md-border-color)] text-[11px] leading-snug text-[var(--md-on-surface-variant)]">
                    Your own keys are billed to your accounts and add their models to the picker.
                </p>
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
import { computed, onMounted, ref, watch } from 'vue';
import { useRuntimeConfig } from '#imports';
import { state } from '~/state/global';
import { useUserApiKey } from '~/core/auth/useUserApiKey';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import SidebarAuthButtonFallback from './SidebarAuthButtonFallback.client.vue';
import { resolveAuthUiAdapter } from '~/core/auth-ui/registry';
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
import ConfirmDialog from '~/components/admin/ConfirmDialog.vue';
import { useOpenAiKey } from '~/core/auth/useOpenAiKey';
import { useModelStore } from '~/composables/chat/useModelStore';
import { presentError } from '~~/shared/errors';

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
const openRouterActive = computed(() => isConnected.value || usingInstanceKey.value);
const needsConnection = computed(() => !openRouterActive.value && !openAi.connected && !openAi.instance);
const openRouterStatus = computed(() => {
    if (isConnected.value) return 'Your key';
    if (isManaged.value) return 'Managed by your administrator';
    if (usingInstanceKey.value) return 'Workspace key';
    return 'Not connected';
});
function connectOpenRouter() {
    menuOpen.value = false;
    openrouter.startLogin();
}
function askDisconnect() {
    menuOpen.value = false;
    confirmDisconnectOpen.value = true;
}

// OpenAI: a personal API key, saved from here without a trip through Settings.
const { connection: openAi, refresh: refreshOpenAi, save: saveOpenAiKey, remove: removeOpenAiKey } = useOpenAiKey();
const { refreshModels } = useModelStore();
const openAiFormOpen = ref(false);
const openAiKeyInput = ref('');
const openAiBusy = ref(false);
const openAiError = ref('');
const openAiStatus = computed(() => {
    if (openAi.connected) return 'Your API key';
    if (openAi.instance) return 'Workspace key';
    if (!openAi.available) return 'Personal keys are unavailable here';
    return 'Not connected';
});
async function changeOpenAi(action: () => Promise<void>) {
    openAiBusy.value = true;
    openAiError.value = '';
    try {
        await action();
        // The picker gains or loses the OpenAI models.
        await refreshModels().catch(() => undefined);
    } catch (caught) {
        openAiError.value = presentError(caught, { fallbackMessage: 'The OpenAI key could not be changed.' }).message;
    } finally {
        openAiBusy.value = false;
    }
}
const saveOpenAi = () => changeOpenAi(async () => {
    await saveOpenAiKey(openAiKeyInput.value);
    openAiKeyInput.value = '';
    openAiFormOpen.value = false;
});
const removeOpenAi = () => changeOpenAi(removeOpenAiKey);
watch(menuOpen, (open) => {
    if (!open) {
        // A half-typed key must not linger in a closed menu.
        openAiKeyInput.value = '';
        openAiFormOpen.value = false;
        openAiError.value = '';
        return;
    }
    refreshOpenAi().catch(() => undefined);
});

const confirmDisconnectOpen = ref(false);
function disconnectOpenRouter() {
    state.value.openrouterKey = null;
    openrouter.logoutOpenRouter();
}
</script>

<style scoped>
.connection-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
}
.connection-logo {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    background: var(--md-surface-variant);
    color: var(--md-on-surface);
}
.connection-name {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.3;
    color: var(--md-on-surface);
}
.connection-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--md-on-surface-variant);
}
.connection-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 999px;
}
.connection-action {
    flex-shrink: 0;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    font-size: 13px;
    font-weight: 500;
    color: var(--md-on-surface);
    cursor: pointer;
    transition: background-color var(--app-motion-duration-fast, 150ms) ease;
}
.connection-action:hover { background: var(--md-surface-hover); }
.connection-action:disabled { opacity: 0.5; cursor: default; }
.connection-action--primary {
    border-color: transparent;
    background: var(--md-inverse-surface);
    color: var(--md-inverse-on-surface);
}
.connection-action--primary:hover { background: var(--md-inverse-surface); opacity: 0.88; }
.connection-action:focus-visible,
.connection-link:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid var(--md-focus-ring, var(--md-primary));
    outline-offset: 2px;
}
.connection-link {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    font-size: 12px;
    color: var(--md-on-surface-variant);
}
.connection-link:hover { background: var(--md-surface-hover); color: var(--md-on-surface); }
</style>
