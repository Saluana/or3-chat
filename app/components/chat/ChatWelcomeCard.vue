<template>
    <div
        ref="cardRoot"
        :style="visibleCardStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
        tabindex="-1"
        class="welcome-card pointer-events-auto relative flex min-h-0 max-h-[calc(100dvh-32px)] w-[calc(100dvw-32px)] flex-col overflow-hidden outline-none"
        data-welcome-card
        @keydown="onCardKeydown"
    >
        <UButton
            variant="subtle"
            color="neutral"
            size="xs"
            :icon="iconClose"
            aria-label="Dismiss welcome"
            class="welcome-card-dismiss"
            @click="onDismiss"
        />
        <div class="welcome-card-body relative min-h-0 overflow-y-auto overscroll-contain">
            <div class="welcome-card-intro">
                <img src="/logos/icon-logo.png" alt="" aria-hidden="true" class="welcome-card-brand-logo" />
                <h2 :id="titleId" class="welcome-card-title wrap-anywhere">
                    Welcome to {{ siteName }}
                </h2>
                <p :id="descriptionId" class="welcome-card-copy">
                    {{ welcomeDescription }}
                </p>
            </div>
            <div class="welcome-card-provider">
                <div class="welcome-card-provider-logo" aria-hidden="true">
                    <UIcon name="simple-icons:openrouter" class="h-10 w-10" />
                </div>
                <div class="min-w-0 flex-1">
                    <h3 class="welcome-card-provider-title">OpenRouter</h3>
                    <p class="welcome-card-provider-copy">
                        Access thousands of AI models with one account.
                    </p>
                </div>
            </div>
            <UButton
                block
                color="primary"
                variant="solid"
                size="lg"
                class="welcome-card-connect"
                :loading="isConnecting"
                @click="onConnect"
            >
                Connect with OpenRouter
                <span class="welcome-card-connect-arrow" aria-hidden="true">→</span>
            </UButton>
            <div class="welcome-card-separator" aria-hidden="true"><span>or</span></div>
            <UButton
                block
                color="neutral"
                variant="subtle"
                size="sm"
                class="welcome-card-key-toggle welcome-card-disclosure"
                :aria-expanded="showExistingKey"
                aria-controls="chat-welcome-existing-key"
                @click="showExistingKey = !showExistingKey"
            >
                Use an existing API key
            </UButton>
            <div v-if="showExistingKey" id="chat-welcome-existing-key" class="mt-3">
                <div class="flex gap-2">
                    <UInput
                        v-model="pasteValue"
                        type="password"
                        placeholder="sk-or-..."
                        aria-label="OpenRouter API key"
                        :aria-invalid="Boolean(pasteError)"
                        :aria-describedby="pasteError ? pasteErrorId : undefined"
                        class="flex-1 min-w-0"
                        @update:model-value="pasteError = ''"
                        @keyup.enter="onSavePaste"
                    />
                    <UButton
                        color="primary"
                        variant="soft"
                        :disabled="!pasteValue.trim() || isSavingPaste"
                        :loading="isSavingPaste"
                        @click="onSavePaste"
                    >
                        Save
                    </UButton>
                </div>
                <p
                    v-if="pasteError"
                    :id="pasteErrorId"
                    class="mt-2 text-sm leading-relaxed text-[var(--md-error)]"
                    role="alert"
                >
                    {{ pasteError }}
                </p>
            </div>
            <div class="welcome-card-support">
                <UIcon :name="iconLock" class="h-4 w-4 shrink-0" aria-hidden="true" />
                <UButton
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    class="welcome-card-learn-more welcome-card-disclosure"
                    aria-label="How your API key is handled"
                    :aria-expanded="showKeyDetails"
                    aria-controls="chat-welcome-key-details"
                    @click="showKeyDetails = !showKeyDetails"
                >
                    How your API key is handled
                </UButton>
            </div>
            <div v-if="showKeyDetails" id="chat-welcome-key-details" class="welcome-card-key-details">
                <p>
                    Your key is saved in this browser and sent with AI requests to OpenRouter, directly or through this {{ siteName }} server.
                </p>
                <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener"
                    class="welcome-card-manage-keys mt-2 inline-block underline underline-offset-4 hover:no-underline"
                    >Manage keys at OpenRouter</a
                >
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { presentError } from '~~/shared/errors';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRuntimeConfig, useToast } from '#imports';
import { useIcon } from '~/composables/useIcon';
import { useDialogViewport } from '~/composables/ui/useDialogViewport';
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';

const emit = defineEmits<{
    (e: 'dismiss'): void;
}>();

const iconClose = useIcon('ui.close');
const iconLock = useIcon('ui.lock');
const visibleFrame = useDialogViewport(() => 'center');
const visibleCardStyle = computed(() => visibleFrame.value.style
    ? { ...visibleFrame.value.style, position: 'fixed' as const, translate: '0 -50%' }
    : undefined);

const runtimeConfig = useRuntimeConfig();
const siteName = computed(
    () => runtimeConfig.public?.branding?.appName ?? 'OR3'
);
const welcomeDescription = 'Connect OpenRouter to start chatting.';

const titleId = 'chat-welcome-title';
const descriptionId = 'chat-welcome-description';
const pasteErrorId = 'chat-welcome-paste-error';

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const cardRoot = ref<HTMLElement | null>(null);
const previouslyFocusedEl = ref<HTMLElement | null>(null);

const { startLogin, isLoggingIn } = useOpenRouterAuth();
const isConnecting = computed(() => isLoggingIn.value);

const pasteValue = ref('');
const pasteError = ref('');
const isSavingPaste = ref(false);
const showExistingKey = ref(false);
const showKeyDetails = ref(false);

function getFocusableElements(): HTMLElement[] {
    if (!cardRoot.value) return [];
    return Array.from(
        cardRoot.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
}

function focusPrimaryCta(): void {
    const focusable = getFocusableElements();
    // Prefer the primary connect button (first non-dismiss control).
    const primary =
        focusable.find(
            (el) =>
                el.getAttribute('aria-label') !== 'Dismiss welcome' &&
                el.tagName === 'BUTTON'
        ) ?? focusable[0];
    (primary ?? cardRoot.value)?.focus();
}

function onCardKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) {
        event.preventDefault();
        cardRoot.value?.focus();
        return;
    }

    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const current = index < 0 && event.shiftKey ? 0 : index;
    const next = (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus();
    focusable[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function onConnect(): void {
    void startLogin();
}

function onDismiss(): void {
    emit('dismiss');
}

async function onSavePaste(): Promise<void> {
    if (isSavingPaste.value) return;
    pasteError.value = '';
    isSavingPaste.value = true;
    try {
        await persistUserApiKey(pasteValue.value);
        useToast().add({
            title: 'OpenRouter connected',
            description: 'Your API key was saved. You can start chatting now.',
            color: 'primary',
            duration: 4000,
        });
        pasteValue.value = '';
    } catch (error) {
        pasteError.value =
            presentError(error, { code: 'ERR_DB_WRITE_FAILED', fallbackMessage: 'Your API key could not be saved. Please try again.' }).message;
        await nextTick();
        cardRoot.value?.querySelector<HTMLElement>('[role="alert"]')?.scrollIntoView?.({ block: 'nearest' });
        cardRoot.value?.querySelector<HTMLInputElement>('input')?.focus();
    } finally {
        isSavingPaste.value = false;
    }
}

watch(visibleCardStyle, async () => {
    await nextTick();
    const active = document.activeElement;
    if (active instanceof HTMLElement && cardRoot.value?.contains(active)) {
        active.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
});

onMounted(() => {
    if (!import.meta.client) return;
    previouslyFocusedEl.value = document.activeElement as HTMLElement | null;
    nextTick(() => {
        focusPrimaryCta();
    });
});

onBeforeUnmount(() => {
    previouslyFocusedEl.value?.focus?.();
    previouslyFocusedEl.value = null;
});
</script>

<style scoped>
.welcome-card {
    --welcome-link: var(--md-primary);
    --welcome-border: var(--md-border-color);
    --welcome-space: var(--app-space-section, 16px);
    --welcome-gap: var(--app-space-control, 8px);
    --welcome-font-size: var(--app-font-size-root, 16px);
    max-width: 640px;
    border: var(--md-border-width) solid var(--welcome-border);
    border-radius: var(--md-border-radius-large, var(--md-border-radius));
    color: var(--md-on-surface);
    background: var(--md-surface);
    box-shadow: var(--app-elevation-high, none);
    font-family: var(--app-font-sans-current, var(--font-sans));
    font-weight: var(--app-font-weight-root, 400);
}

.welcome-card-dismiss {
    position: absolute;
    z-index: 2;
    top: calc(var(--welcome-space) * 1.25);
    right: calc(var(--welcome-space) * 1.25);
    width: var(--app-control-height-small, 32px);
    height: var(--app-control-height-small, 32px);
    color: var(--md-on-surface-variant);
}

.welcome-card-body {
    padding: calc(var(--welcome-space) * 4.75) calc(var(--welcome-space) * 3) calc(var(--welcome-space) * 1.75);
}

.welcome-card-intro {
    padding-inline: calc(var(--welcome-space) * 1.75);
    text-align: center;
}

.welcome-card-brand-logo {
    display: block;
    width: calc(var(--welcome-space) * 5);
    height: calc(var(--welcome-space) * 5);
    margin-inline: auto;
    object-fit: contain;
}

.welcome-card-title {
    margin-top: var(--welcome-space);
    font-family: var(--app-font-heading-current, var(--font-heading)) !important;
    font-size: calc(var(--welcome-font-size) * 1.5);
    font-weight: var(--font-weight-semibold, 600);
    line-height: 1.5;
}

.welcome-card-copy {
    margin-top: calc(var(--welcome-space) * 1.125);
    color: var(--md-on-surface-variant);
    font-size: calc(var(--welcome-font-size) * 1.25);
    line-height: 1.5;
}

.welcome-card-provider {
    display: flex;
    align-items: center;
    gap: calc(var(--welcome-gap) * 3);
    margin-top: calc(var(--welcome-space) * 1.75);
    padding: calc(var(--welcome-space) * 1.5);
    border: var(--md-border-width-subtle, var(--md-border-width)) solid var(--welcome-border);
    border-radius: var(--md-border-radius);
    background: var(--welcome-provider-surface, var(--md-surface-variant));
}

:global(html[data-theme="blank"]:not(.dark)) .welcome-card {
    --welcome-provider-surface: var(--md-surface-active);
}

:global(html[data-theme="blank"]) .welcome-card {
    /* Blank intentionally removes subtle borders; this separator still needs a visible rule. */
    --welcome-separator-width: var(--md-border-width);
}

.welcome-card-provider-logo {
    display: flex;
    width: calc(var(--welcome-space) * 4.75);
    height: calc(var(--welcome-space) * 4.75);
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    align-self: flex-start;
    border: var(--md-border-width-subtle, var(--md-border-width)) solid var(--welcome-border);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    background: var(--md-surface);
    box-shadow: var(--app-elevation-low, none);
}

.welcome-card-provider-title {
    font-family: var(--app-font-sans-current, var(--font-sans)) !important;
    font-size: calc(var(--welcome-font-size) * 1.25);
    font-weight: 600;
    line-height: 1.3;
}

.welcome-card-provider-copy {
    margin-top: calc(var(--welcome-space) * 0.875);
    color: var(--md-on-surface-variant);
    font-size: var(--welcome-font-size);
    line-height: 1.45;
}

.welcome-card-connect {
    gap: calc(var(--welcome-gap) * 1.5);
    margin-top: calc(var(--welcome-space) * 1.375);
    font-family: inherit;
}

.welcome-card-connect-arrow {
    font-size: calc(var(--welcome-font-size) * 1.5);
    line-height: 1;
}

.welcome-card-separator {
    display: flex;
    align-items: center;
    gap: calc(var(--welcome-gap) * 2.5);
    margin-top: calc(var(--welcome-space) * 1.625);
    color: var(--md-on-surface-variant);
    font-size: calc(var(--welcome-font-size) * 0.8125);
    line-height: 1.5;
}

.welcome-card-separator::before,
.welcome-card-separator::after {
    content: '';
    height: var(--welcome-separator-width, var(--md-border-width-subtle, var(--md-border-width)));
    flex: 1;
    background: var(--welcome-border);
}

.welcome-card-key-toggle {
    justify-content: center;
    height: var(--app-control-height-medium, 40px) !important;
    margin-top: var(--welcome-gap);
    color: var(--md-on-surface-variant);
    font-family: inherit;
    font-size: var(--welcome-font-size) !important;
}

.welcome-card-key-toggle:hover {
    color: var(--md-on-surface);
}

.welcome-card-support {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: calc(var(--welcome-gap) * 0.5) var(--welcome-gap);
    margin-top: calc(var(--welcome-space) * 0.875);
    padding-top: calc(var(--welcome-space) * 1.125);
    border-top: var(--md-border-width-subtle, var(--md-border-width)) solid var(--welcome-border);
    color: var(--md-on-surface-variant);
    font-size: var(--welcome-font-size);
    line-height: 1.5;
}

.welcome-card-learn-more {
    height: auto !important;
    min-height: var(--app-control-height-small, 32px);
    padding: 0 !important;
    color: var(--welcome-link);
    font-family: inherit;
    font-size: inherit !important;
    text-decoration: underline;
    text-underline-offset: 3px;
}

.welcome-card-key-details {
    margin-top: calc(var(--welcome-gap) * 1.5);
    color: var(--md-on-surface-variant);
    font-size: var(--welcome-font-size);
    line-height: 1.5;
}

.welcome-card-manage-keys {
    color: var(--welcome-link);
}

.welcome-card-dismiss:focus-visible,
.welcome-card-disclosure:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid var(--md-focus-ring, var(--md-primary));
    outline-offset: var(--app-focus-ring-offset, 2px);
}

@media (max-width: 639px) {
    .welcome-card-body { padding: calc(var(--welcome-space) * 3.5) calc(var(--welcome-space) * 1.5) calc(var(--welcome-space) * 1.5); }
    .welcome-card-intro { padding-inline: 0; }
    .welcome-card-provider { gap: calc(var(--welcome-gap) * 2); padding: calc(var(--welcome-space) * 1.125); }
    .welcome-card-provider-logo { width: calc(var(--welcome-space) * 3.25); height: calc(var(--welcome-space) * 3.25); }
    .welcome-card-provider-logo :deep(.iconify) { width: calc(var(--welcome-space) * 1.75); height: calc(var(--welcome-space) * 1.75); }
    .welcome-card-connect { font-size: var(--welcome-font-size) !important; }
}

@media (max-width: 767px), (pointer: coarse) {
    .welcome-card button { min-height: 44px !important; }
    .welcome-card-dismiss { width: 44px !important; padding: 0 !important; }
    .welcome-card-support {
        /* Keep the small disclosure's touch target without widening the footer. */
        padding-top: calc(var(--welcome-gap) * 1.5);
    }
}
</style>
