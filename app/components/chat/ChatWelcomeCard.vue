<template>
    <div
        ref="cardRoot"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
        tabindex="-1"
        class="pointer-events-auto relative w-full max-w-md rounded-[var(--md-border-radius-large,var(--md-border-radius))] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] p-6 shadow-lg outline-none"
        data-welcome-card
        @keydown="onCardKeydown"
    >
        <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            :icon="iconClose"
            aria-label="Dismiss welcome"
            class="absolute top-2 right-2"
            @click="onDismiss"
        />
        <h2
            :id="titleId"
            class="font-heading text-lg text-[var(--md-on-surface)] pr-6"
        >
            Welcome to {{ siteName }}
        </h2>
        <p
            :id="descriptionId"
            class="mt-2 text-sm text-[var(--md-on-surface-variant)]"
        >
            {{ welcomeDescription }}
        </p>
        <UButton
            block
            color="primary"
            class="mt-4"
            :loading="isConnecting"
            @click="onConnect"
        >
            Connect with OpenRouter
        </UButton>
        <div
            class="my-4 flex items-center gap-3 text-xs uppercase tracking-wider text-[var(--md-secondary)]"
            role="separator"
            aria-label="Or paste a key"
        >
            <span class="h-px flex-1 bg-[var(--md-border-color)]" aria-hidden="true" />
            or paste a key
            <span class="h-px flex-1 bg-[var(--md-border-color)]" aria-hidden="true" />
        </div>
        <div class="flex gap-2">
            <UInput
                v-model="pasteValue"
                type="password"
                placeholder="sk-or-..."
                aria-label="OpenRouter API key"
                :aria-invalid="Boolean(pasteError)"
                :aria-describedby="pasteError ? pasteErrorId : undefined"
                class="flex-1"
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
            class="mt-2 text-xs text-[var(--md-error)]"
            role="alert"
        >
            {{ pasteError }}
        </p>
        <p class="mt-4 text-xs text-[var(--md-secondary)]">
            <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener"
                class="underline hover:text-[var(--md-primary)]"
                >Get a free key at openrouter.ai</a
            >
            · Your key never leaves this browser.
        </p>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRuntimeConfig, useToast } from '#imports';
import { useIcon } from '~/composables/useIcon';
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';

const emit = defineEmits<{
    (e: 'dismiss'): void;
}>();

const iconClose = useIcon('ui.close');

const runtimeConfig = useRuntimeConfig();
const siteName = computed(
    () => runtimeConfig.public?.branding?.appName ?? 'OR3'
);
const welcomeDescription = computed(() =>
    runtimeConfig.public?.ssrAuthEnabled === true
        ? `${siteName.value} is connected to this self-hosted workspace. To start chatting, connect your OpenRouter account — it takes about 10 seconds.`
        : `${siteName.value} is local-first: your conversations stay on this device. To start chatting, connect your OpenRouter account — it takes about 10 seconds.`
);

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

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = import.meta.client
        ? (document.activeElement as HTMLElement | null)
        : null;

    if (event.shiftKey) {
        if (!active || active === first || !cardRoot.value?.contains(active)) {
            event.preventDefault();
            last.focus();
        }
        return;
    }

    if (!active || active === last || !cardRoot.value?.contains(active)) {
        event.preventDefault();
        first.focus();
    }
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
            error instanceof Error
                ? error.message
                : 'Could not save that key. Please try again.';
    } finally {
        isSavingPaste.value = false;
    }
}

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
