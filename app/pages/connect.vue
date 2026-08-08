<template>
    <main
        class="min-h-screen bg-[var(--md-surface)] text-[var(--md-on-surface)] px-4! py-10! sm:py-16!"
    >
        <div class="mx-auto w-full max-w-lg">
            <NuxtLink to="/" class="mb-10! inline-flex items-center gap-2 text-sm text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]">
                <UIcon :name="backIcon" class="size-4" />
                Back to OR3
            </NuxtLink>

            <section
                v-if="!connectEnabled"
                class="rounded-[28px] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-6! shadow-[var(--md-elevation-2)] sm:p-9!"
            >
                <div class="mb-7! flex size-14 items-center justify-center rounded-2xl bg-[var(--md-primary-container)]">
                    <UIcon :name="computerIcon" class="size-7 text-[var(--md-on-primary-container)]" />
                </div>
                <h1 class="text-2xl font-semibold">Remote Connect unavailable</h1>
                <p class="mt-3! leading-6 text-[var(--md-on-surface-variant)]">
                    This Cloud instance does not offer remote Connect. An
                    administrator must configure and prove the managed flow
                    before it can be enabled. Use a local Intern host through
                    Agents → Connection settings instead.
                </p>
                <UButton to="/" block size="xl" class="mt-8!">
                    Back to OR3
                </UButton>
            </section>

            <section
                v-else
                class="rounded-[28px] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-6! shadow-[var(--md-elevation-2)] sm:p-9!"
                :aria-busy="busy || monitoring"
            >
                <p class="sr-only" aria-live="polite" aria-atomic="true">
                    {{ screenReaderStatus }}
                </p>
                <div class="mb-7! flex size-14 items-center justify-center rounded-2xl bg-[var(--md-primary-container)]">
                    <UIcon :name="computerIcon" class="size-7 text-[var(--md-on-primary-container)]" />
                </div>

                <template v-if="state === 'online'">
                    <h1 ref="stateHeading" tabindex="-1" class="text-2xl font-semibold outline-none">Computer online</h1>
                    <p class="mt-3! text-[var(--md-on-surface-variant)]">
                        {{ request?.computer.name }} is online and ready to use in OR3.
                    </p>
                    <UButton
                        to="/"
                        block
                        size="xl"
                        class="mt-8!"
                        @click="refreshCloudComputers"
                    >
                        Open OR3
                    </UButton>
                </template>

                <template v-else-if="state === 'approved' || state === 'installing'">
                    <h1 ref="stateHeading" tabindex="-1" class="text-2xl font-semibold outline-none">
                        {{
                            state === 'approved'
                                ? 'Approved — finish on your computer'
                                : 'Finishing setup'
                        }}
                    </h1>
                    <p class="mt-3! leading-6 text-[var(--md-on-surface-variant)]">
                        <template v-if="state === 'approved'">
                            Return to the terminal that started OR3 Connect. If it asks,
                            approve the administrator prompt so it can install the
                            background service.
                        </template>
                        <template v-else>
                            Your computer received its credential and is starting the
                            OR3 service and secure tunnel.
                        </template>
                    </p>
                    <div class="mt-7! space-y-3! rounded-2xl bg-[var(--md-surface-container)] p-5!">
                        <div class="flex items-center gap-3">
                            <UIcon name="i-lucide-circle-check" class="size-5 text-[var(--md-primary)]" />
                            <span class="text-sm font-medium">Connection approved</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <UIcon
                                :name="
                                    state === 'installing'
                                        ? 'i-lucide-circle-check'
                                        : 'i-lucide-loader-circle'
                                "
                                class="size-5"
                                :class="
                                    state === 'approved'
                                        ? 'animate-spin text-[var(--md-on-surface-variant)]'
                                        : 'text-[var(--md-primary)]'
                                "
                            />
                            <span class="text-sm font-medium">Credential received by computer</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <UIcon
                                name="i-lucide-loader-circle"
                                class="size-5 animate-spin text-[var(--md-on-surface-variant)]"
                            />
                            <span class="text-sm font-medium">Waiting for the protected online check</span>
                        </div>
                    </div>
                    <p class="mt-5! text-center text-sm text-[var(--md-on-surface-variant)]">
                        This page updates automatically. Keep the terminal open.
                    </p>
                </template>

                <template v-else-if="state === 'timed_out'">
                    <h1 ref="stateHeading" tabindex="-1" class="text-2xl font-semibold outline-none">Still waiting for your computer</h1>
                    <p class="mt-3! leading-6 text-[var(--md-on-surface-variant)]">
                        Approval succeeded, but OR3 could not confirm the protected
                        service and an available agent before the setup window ended.
                    </p>
                    <div class="mt-6! rounded-2xl bg-[var(--md-surface-container)] p-5!">
                        <p class="text-sm font-medium">Check the terminal first.</p>
                        <p class="mt-2! text-sm leading-5 text-[var(--md-on-surface-variant)]">
                            Finish any administrator prompt. If setup stopped, run
                            <code class="font-mono">or3-intern connect status</code>,
                            then
                            <code class="font-mono">or3-intern connect doctor</code>
                            for clear repair guidance.
                        </p>
                    </div>
                    <UButton
                        block
                        size="xl"
                        class="mt-7!"
                        :loading="monitoring"
                        @click="monitorComputer"
                    >
                        Check again
                    </UButton>
                </template>

                <template v-else-if="state === 'expired'">
                    <h1 ref="stateHeading" tabindex="-1" class="text-2xl font-semibold outline-none">
                        This connection code expired
                    </h1>
                    <p class="mt-3! leading-6 text-[var(--md-on-surface-variant)]">
                        Nothing was connected. Generate a fresh code on the computer,
                        then enter it here.
                    </p>
                    <div class="mt-6! rounded-2xl bg-[var(--md-surface-container)] p-5!">
                        <p class="text-sm font-medium">Run this command again:</p>
                        <code class="mt-2! block select-all font-mono text-sm">
                            {{ CONNECT_COMMAND }}
                        </code>
                    </div>
                    <UButton
                        block
                        size="xl"
                        class="mt-7!"
                        @click="resetForNewCode"
                    >
                        Enter a new code
                    </UButton>
                </template>

                <template v-else-if="state === 'denied'">
                    <h1 ref="stateHeading" tabindex="-1" class="text-2xl font-semibold outline-none">Connection cancelled</h1>
                    <p class="mt-3! text-[var(--md-on-surface-variant)]">
                        Nothing was changed on this computer.
                    </p>
                </template>

                <template v-else>
                    <h1 ref="stateHeading" tabindex="-1" class="text-2xl font-semibold outline-none">Connect a computer</h1>
                    <p class="mt-2! leading-6 text-[var(--md-on-surface-variant)]">
                        Confirm that the code below matches the one in your terminal.
                    </p>

                    <form class="mt-7! space-y-5!" @submit.prevent="loadRequest">
                        <div>
                            <label for="connect-code" class="mb-2! block text-sm font-medium">
                                Connection code
                            </label>
                            <UInput
                                ref="codeInput"
                                id="connect-code"
                                v-model="code"
                                autocomplete="one-time-code"
                                autofocus
                                size="xl"
                                placeholder="BRIGHT-MOON-TREE-042"
                                class="w-full font-mono tracking-wide"
                                :disabled="busy || state === 'confirm'"
                            />
                        </div>
                        <UButton
                            v-if="state !== 'confirm'"
                            type="submit"
                            block
                            size="xl"
                            :loading="busy"
                            :disabled="!code.trim()"
                        >
                            Continue
                        </UButton>
                    </form>

                    <div
                        v-if="state === 'confirm' && request"
                        class="mt-7! rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] p-5!"
                    >
                        <div class="flex items-start gap-4">
                            <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--md-surface-container-high)]">
                                <UIcon :name="computerIcon" class="size-5" />
                            </div>
                            <div class="min-w-0">
                                <p class="truncate font-medium">{{ request.computer.name }}</p>
                                <p class="mt-1! text-sm capitalize text-[var(--md-on-surface-variant)]">
                                    {{ request.computer.platform }} · {{ request.computer.architecture }}
                                </p>
                            </div>
                        </div>
                        <div class="mt-5! rounded-xl bg-[var(--md-surface-container-high)] px-4! py-3! text-center font-mono text-lg font-semibold tracking-wider">
                            {{ request.code }}
                        </div>
                        <p
                            class="mt-3! text-center text-sm font-medium"
                            :class="
                                remainingSeconds <= 60
                                    ? 'text-[var(--md-error)]'
                                    : 'text-[var(--md-on-surface-variant)]'
                            "
                        >
                            Code expires in {{ expiryCountdown }}
                        </p>
                        <div class="mt-5!">
                            <label for="computer-name" class="mb-2! block text-sm font-medium">
                                Computer name
                            </label>
                            <UInput
                                id="computer-name"
                                v-model="computerName"
                                size="lg"
                                class="w-full"
                                maxlength="80"
                            />
                        </div>
                        <p class="mt-4! text-sm leading-5 text-[var(--md-on-surface-variant)]">
                            Only approve a code you started yourself. This gives your OR3 account remote access to agents on this computer.
                        </p>
                        <div class="mt-6! grid grid-cols-2 gap-3!">
                            <UButton
                                color="neutral"
                                variant="soft"
                                size="lg"
                                block
                                :disabled="busy"
                                @click="deny"
                            >
                                Cancel
                            </UButton>
                            <UButton
                                size="lg"
                                block
                                :loading="busy"
                                @click="approve"
                            >
                                Connect
                            </UButton>
                        </div>
                    </div>

                    <UAlert
                        v-if="error"
                        class="mt-5!"
                        color="error"
                        variant="soft"
                        :title="error"
                        role="alert"
                    />
                </template>
            </section>

            <p class="mt-5! text-center text-xs leading-5 text-[var(--md-on-surface-variant)]">
                {{
                    connectEnabled
                        ? 'The computer stays local-first. Remote access can be revoked from either device at any time.'
                        : 'Local Intern hosts stay on the computer until you explicitly add one in Connection settings.'
                }}
            </p>
        </div>
    </main>
</template>

<script setup lang="ts">
import { getExternalAgentCloudHostRefresh } from '~/core/external-agents/runtime';
import {
    waitForConnectOnline,
    type ConnectSetupStatus,
} from '~/utils/connect-online';
import {
    connectRequestRemainingSeconds,
    formatConnectRequestCountdown,
    isExpiredConnectRequestError,
} from '~/utils/connect-approval';

const CONNECT_COMMAND = 'npx @or3/connect';

definePageMeta({
    layout: false,
    lockPageProtected: true,
});

type ConnectRequest = {
    code: string;
    computer: {
        name: string;
        platform: string;
        architecture: string;
    };
    expiresAt: number;
};

type ConnectApprovalResponse = {
    connected: true;
    environment: {
        id: string;
        name: string;
    };
};

const route = useRoute();
const backIcon = useIcon('ui.arrow.left');
const computerIcon = useIcon('sidebar.activity');
const runtimeConfig = useRuntimeConfig();
const connectEnabled = computed(
    () => runtimeConfig.public?.connect?.enabled === true
);
const code = ref(typeof route.query.code === 'string' ? route.query.code : '');
const computerName = ref('');
const request = ref<ConnectRequest | null>(null);
const environmentId = ref('');
const state = ref<
    | 'code'
    | 'confirm'
    | 'approved'
    | 'installing'
    | 'online'
    | 'timed_out'
    | 'expired'
    | 'denied'
>('code');
const busy = ref(false);
const monitoring = ref(false);
const error = ref('');
const now = ref(Date.now());
const stateHeading = ref<HTMLElement | null>(null);
const codeInput = ref<
    { $el?: HTMLElement; focus?: () => void } | HTMLElement | null
>(null);
let monitorController: AbortController | null = null;
let expiryTimer: ReturnType<typeof setInterval> | null = null;

const remainingSeconds = computed(() =>
    connectRequestRemainingSeconds(request.value?.expiresAt, now.value)
);
const expiryCountdown = computed(() =>
    formatConnectRequestCountdown(remainingSeconds.value)
);
const screenReaderStatus = computed(() => {
    if (busy.value) return 'Checking the connection request.';
    if (monitoring.value) return 'Waiting for the computer to come online.';
    switch (state.value) {
        case 'confirm':
            return 'Connection request found. Confirm the computer and code.';
        case 'approved':
            return 'Connection approved. Finish setup on the computer.';
        case 'installing':
            return 'The computer received its credential and is installing.';
        case 'online':
            return 'Computer online and ready.';
        case 'timed_out':
            return 'The computer has not come online yet.';
        case 'expired':
            return 'The connection code expired. Generate and enter a new code.';
        case 'denied':
            return 'Connection cancelled.';
        default:
            return error.value || 'Enter the connection code from your computer.';
    }
});

onMounted(() => {
    if (!connectEnabled.value) return;
    expiryTimer = setInterval(() => {
        now.value = Date.now();
        if (
            request.value &&
            remainingSeconds.value === 0 &&
            state.value === 'confirm'
        ) {
            expireRequest();
        }
    }, 1_000);
    if (code.value) void loadRequest();
});

onBeforeUnmount(() => {
    monitorController?.abort();
    if (expiryTimer) clearInterval(expiryTimer);
});

watch(state, async (next) => {
    await nextTick();
    if (next === 'code') {
        focusCodeInput();
    } else {
        stateHeading.value?.focus();
    }
});

async function loadRequest() {
    if (!code.value.trim()) return;
    busy.value = true;
    error.value = '';
    try {
        const loaded = await $fetch<ConnectRequest>('/api/connect/device/request', {
            query: { code: code.value },
            credentials: 'include',
            cache: 'no-store',
        });
        request.value = loaded;
        now.value = Date.now();
        if (connectRequestRemainingSeconds(loaded.expiresAt, now.value) === 0) {
            expireRequest();
            return;
        }
        code.value = loaded.code;
        computerName.value = loaded.computer.name;
        state.value = 'confirm';
    } catch (cause) {
        if (isExpiredConnectRequestError(cause)) {
            expireRequest();
        } else {
            error.value = safeError(cause, 'That code is invalid or expired.');
            await nextTick();
            focusCodeInput();
        }
    } finally {
        busy.value = false;
    }
}

async function approve() {
    if (!request.value) return;
    if (connectRequestRemainingSeconds(request.value.expiresAt) === 0) {
        expireRequest();
        return;
    }
    const approvingRequest = request.value;
    busy.value = true;
    error.value = '';
    try {
        const approved = await $fetch<ConnectApprovalResponse>(
            '/api/connect/device/approve',
            {
                method: 'POST',
                headers: connectMutationHeaders('approve'),
                body: {
                    code: request.value.code,
                    name: computerName.value,
                },
                credentials: 'include',
            }
        );
        if (state.value === 'expired' || request.value !== approvingRequest) {
            return;
        }
        environmentId.value = approved.environment.id;
        state.value = 'approved';
        void refreshCloudComputers();
        void monitorComputer();
    } catch (cause) {
        if (
            state.value === 'expired' ||
            isExpiredConnectRequestError(cause) ||
            connectRequestRemainingSeconds(approvingRequest.expiresAt) === 0
        ) {
            expireRequest();
        } else {
            error.value = safeError(
                cause,
                'This computer could not be connected. Please try again.'
            );
        }
    } finally {
        busy.value = false;
    }
}

function expireRequest() {
    monitorController?.abort();
    monitorController = null;
    monitoring.value = false;
    error.value = '';
    state.value = 'expired';
}

async function resetForNewCode() {
    request.value = null;
    environmentId.value = '';
    computerName.value = '';
    code.value = '';
    error.value = '';
    now.value = Date.now();
    state.value = 'code';
    await nextTick();
    focusCodeInput();
}

function focusCodeInput() {
    const target = codeInput.value;
    if (!target) return;
    if (target instanceof HTMLElement) {
        const input = target.matches('input')
            ? target
            : target.querySelector('input');
        input?.focus();
        return;
    }
    if (typeof target.focus === 'function') {
        target.focus();
        return;
    }
    target.$el?.querySelector('input')?.focus();
}

async function deny() {
    if (!request.value) return;
    busy.value = true;
    error.value = '';
    try {
        await $fetch('/api/connect/device/deny', {
            method: 'POST',
            headers: connectMutationHeaders('deny'),
            body: { code: request.value.code },
            credentials: 'include',
        });
        state.value = 'denied';
    } catch (cause) {
        error.value = safeError(cause, 'Could not cancel this request.');
    } finally {
        busy.value = false;
    }
}

async function monitorComputer() {
    if (!request.value || !environmentId.value || monitoring.value) return;
    monitorController?.abort();
    const controller = new AbortController();
    monitorController = controller;
    monitoring.value = true;
    if (state.value === 'timed_out') state.value = 'approved';
    try {
        const result = await waitForConnectOnline({
            signal: controller.signal,
            probe: () =>
                $fetch<ConnectSetupStatus>('/api/connect/device/status', {
                    query: {
                        code: request.value?.code,
                        environmentId: environmentId.value,
                    },
                    credentials: 'include',
                    cache: 'no-store',
                    signal: controller.signal,
                }),
            onStage(stage) {
                if (monitorController === controller) state.value = stage;
            },
        });
        if (monitorController !== controller) return;
        if (result === 'timed_out') {
            state.value = 'timed_out';
        } else if (result === 'online') {
            state.value = 'online';
            await refreshCloudComputers();
        }
    } finally {
        if (monitorController === controller) {
            monitorController = null;
            monitoring.value = false;
        }
    }
}

async function refreshCloudComputers() {
    const refresh = getExternalAgentCloudHostRefresh();
    if (!refresh) return;
    await refresh().catch(() => undefined);
}

function safeError(cause: unknown, fallback: string): string {
    if (
        typeof cause === 'object' &&
        cause !== null &&
        'data' in cause &&
        typeof cause.data === 'object' &&
        cause.data !== null &&
        'statusMessage' in cause.data &&
        typeof cause.data.statusMessage === 'string'
    ) {
        return cause.data.statusMessage;
    }
    return fallback;
}
</script>
