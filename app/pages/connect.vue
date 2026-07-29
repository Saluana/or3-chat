<template>
    <main
        class="min-h-screen bg-[var(--md-surface)] text-[var(--md-on-surface)] px-4! py-10! sm:py-16!"
    >
        <div class="mx-auto w-full max-w-lg">
            <NuxtLink to="/" class="mb-10! inline-flex items-center gap-2 text-sm text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]">
                <UIcon :name="backIcon" class="size-4" />
                Back to OR3
            </NuxtLink>

            <section class="rounded-[28px] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-6! shadow-[var(--md-elevation-2)] sm:p-9!">
                <div class="mb-7! flex size-14 items-center justify-center rounded-2xl bg-[var(--md-primary-container)]">
                    <UIcon :name="computerIcon" class="size-7 text-[var(--md-on-primary-container)]" />
                </div>

                <template v-if="state === 'connected'">
                    <h1 class="text-2xl font-semibold">Computer connected</h1>
                    <p class="mt-3! text-[var(--md-on-surface-variant)]">
                        {{ request?.computer.name }} is ready in OR3. You can close this window.
                    </p>
                    <UButton to="/" block size="xl" class="mt-8!">
                        Open OR3
                    </UButton>
                </template>

                <template v-else-if="state === 'denied'">
                    <h1 class="text-2xl font-semibold">Connection cancelled</h1>
                    <p class="mt-3! text-[var(--md-on-surface-variant)]">
                        Nothing was changed on this computer.
                    </p>
                </template>

                <template v-else>
                    <h1 class="text-2xl font-semibold">Connect a computer</h1>
                    <p class="mt-2! leading-6 text-[var(--md-on-surface-variant)]">
                        Confirm that the code below matches the one in your terminal.
                    </p>

                    <form class="mt-7! space-y-5!" @submit.prevent="loadRequest">
                        <div>
                            <label for="connect-code" class="mb-2! block text-sm font-medium">
                                Connection code
                            </label>
                            <UInput
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
                    />
                </template>
            </section>

            <p class="mt-5! text-center text-xs leading-5 text-[var(--md-on-surface-variant)]">
                The computer stays local-first. Remote access can be revoked from either device at any time.
            </p>
        </div>
    </main>
</template>

<script setup lang="ts">
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

const route = useRoute();
const backIcon = useIcon('ui.arrow.left');
const computerIcon = useIcon('sidebar.activity');
const code = ref(typeof route.query.code === 'string' ? route.query.code : '');
const computerName = ref('');
const request = ref<ConnectRequest | null>(null);
const state = ref<'code' | 'confirm' | 'connected' | 'denied'>('code');
const busy = ref(false);
const error = ref('');

onMounted(() => {
    if (code.value) void loadRequest();
});

async function loadRequest() {
    if (!code.value.trim()) return;
    busy.value = true;
    error.value = '';
    try {
        request.value = await $fetch<ConnectRequest>('/api/connect/device/request', {
            query: { code: code.value },
            credentials: 'include',
            cache: 'no-store',
        });
        code.value = request.value.code;
        computerName.value = request.value.computer.name;
        state.value = 'confirm';
    } catch (cause) {
        error.value = safeError(cause, 'That code is invalid or expired.');
    } finally {
        busy.value = false;
    }
}

async function approve() {
    if (!request.value) return;
    busy.value = true;
    error.value = '';
    try {
        await $fetch('/api/connect/device/approve', {
            method: 'POST',
            body: {
                code: request.value.code,
                name: computerName.value,
            },
            credentials: 'include',
        });
        state.value = 'connected';
    } catch (cause) {
        error.value = safeError(
            cause,
            'This computer could not be connected. Please try again.'
        );
    } finally {
        busy.value = false;
    }
}

async function deny() {
    if (!request.value) return;
    busy.value = true;
    error.value = '';
    try {
        await $fetch('/api/connect/device/deny', {
            method: 'POST',
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
