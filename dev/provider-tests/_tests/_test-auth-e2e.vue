<script setup lang="ts">
import { computed, ref } from 'vue';

interface RequestResult {
    ok: boolean;
    status: number;
    statusText: string;
    url: string;
    redirected: boolean;
    durationMs: number;
    headers: Record<string, string>;
    payload?: unknown;
    error?: string;
}

const baseSession = ref<RequestResult | null>(null);
const adminRedirect = ref<RequestResult | null>(null);
const adminLogin = ref<RequestResult | null>(null);
const adminSession = ref<RequestResult | null>(null);
const adminLogout = ref<RequestResult | null>(null);

const adminUsername = ref('admin');
const adminPassword = ref('password');

const running = ref(false);
const lastRun = ref<string | null>(null);

const summarized = computed(() => {
    const summary = {
        baseSession: baseSession.value?.status ?? '—',
        adminRedirect: adminRedirect.value?.status ?? '—',
        adminLogin: adminLogin.value?.status ?? '—',
        adminSession: adminSession.value?.status ?? '—',
        adminLogout: adminLogout.value?.status ?? '—',
    };
    return summary;
});

function nowStamp() {
    return new Date().toISOString();
}

function formatHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key.toLowerCase()] = value;
    });
    return result;
}

async function runRequest(input: RequestInfo | URL, init?: RequestInit): Promise<RequestResult> {
    const start = performance.now();
    try {
        const response = await fetch(input, init);
        const durationMs = Math.round(performance.now() - start);
        const headers = formatHeaders(response.headers);
        let payload: unknown = undefined;

        const contentType = headers['content-type'] ?? '';
        if (contentType.includes('application/json')) {
            payload = await response.clone().json();
        } else {
            payload = await response.clone().text();
        }

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            url: response.url,
            redirected: response.redirected,
            durationMs,
            headers,
            payload,
        };
    } catch (error) {
        const durationMs = Math.round(performance.now() - start);
        return {
            ok: false,
            status: 0,
            statusText: 'network-error',
            url: String(input),
            redirected: false,
            durationMs,
            headers: {},
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function checkBaseSession() {
    baseSession.value = await runRequest('/api/auth/session');
}

async function checkAdminRedirect() {
    adminRedirect.value = await runRequest('/admin', { redirect: 'manual' });
}

async function loginAdmin() {
    adminLogin.value = await runRequest('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: adminUsername.value,
            password: adminPassword.value,
        }),
    });
    adminSession.value = await runRequest('/api/admin/auth/session');
}

async function logoutAdmin() {
    adminLogout.value = await runRequest('/api/admin/auth/logout', { method: 'POST' });
    adminSession.value = await runRequest('/api/admin/auth/session');
}

async function runAll() {
    running.value = true;
    lastRun.value = nowStamp();
    await checkBaseSession();
    await checkAdminRedirect();
    await loginAdmin();
    running.value = false;
}
</script>

<template>
    <div class="test-wrapper">
        <div class="test-page mx-auto max-w-5xl space-y-6">
            <div class="space-y-1">
                <h1 class="text-2xl font-semibold">🔐 Auth Integration Test</h1>
                <p class="text-sm opacity-70">
                    Client-side probes for session, admin redirects, and admin login flow.
                </p>
            </div>

            <div class="flex flex-wrap items-center gap-3">
                <UButton size="sm" :loading="running" @click="runAll">Run All Checks</UButton>
                <UButton size="sm" variant="soft" @click="checkBaseSession">Check /api/auth/session</UButton>
                <UButton size="sm" variant="soft" @click="checkAdminRedirect">Check /admin redirect</UButton>
                <UButton size="sm" variant="soft" @click="loginAdmin">Login + session</UButton>
                <UButton size="sm" variant="ghost" @click="logoutAdmin">Logout</UButton>
                <span class="text-xs opacity-70" v-if="lastRun">Last run: {{ lastRun }}</span>
            </div>

            <div class="grid gap-6 lg:grid-cols-2">
                <UCard>
                    <template #header>
                        <div class="flex items-center justify-between">
                            <h2 class="text-base font-semibold">Base Session</h2>
                            <span class="text-xs opacity-70">/api/auth/session</span>
                        </div>
                    </template>
                    <div class="space-y-3 text-sm">
                        <div class="grid grid-cols-2 gap-2">
                            <div class="opacity-70">Status</div>
                            <div>{{ baseSession?.status ?? '—' }} {{ baseSession?.statusText ?? '' }}</div>
                            <div class="opacity-70">OK</div>
                            <div>{{ baseSession?.ok ?? '—' }}</div>
                            <div class="opacity-70">Duration</div>
                            <div>{{ baseSession?.durationMs ?? '—' }} ms</div>
                            <div class="opacity-70">Redirected</div>
                            <div>{{ baseSession?.redirected ?? '—' }}</div>
                            <div class="opacity-70">Cache-Control</div>
                            <div class="break-all">{{ baseSession?.headers['cache-control'] ?? '—' }}</div>
                        </div>
                        <div>
                            <div class="text-xs uppercase opacity-60">Payload</div>
                            <pre class="mt-2 max-h-48 overflow-auto rounded border p-2 text-xs">{{ baseSession?.payload ?? baseSession?.error ?? '—' }}</pre>
                        </div>
                    </div>
                </UCard>

                <UCard>
                    <template #header>
                        <div class="flex items-center justify-between">
                            <h2 class="text-base font-semibold">Admin Redirect</h2>
                            <span class="text-xs opacity-70">/admin</span>
                        </div>
                    </template>
                    <div class="space-y-3 text-sm">
                        <div class="grid grid-cols-2 gap-2">
                            <div class="opacity-70">Status</div>
                            <div>{{ adminRedirect?.status ?? '—' }} {{ adminRedirect?.statusText ?? '' }}</div>
                            <div class="opacity-70">Redirected</div>
                            <div>{{ adminRedirect?.redirected ?? '—' }}</div>
                            <div class="opacity-70">URL</div>
                            <div class="break-all">{{ adminRedirect?.url ?? '—' }}</div>
                        </div>
                        <div>
                            <div class="text-xs uppercase opacity-60">Headers</div>
                            <pre class="mt-2 max-h-48 overflow-auto rounded border p-2 text-xs">{{ adminRedirect?.headers ?? '—' }}</pre>
                        </div>
                    </div>
                </UCard>

                <UCard class="lg:col-span-2">
                    <template #header>
                        <div class="flex items-center justify-between">
                            <h2 class="text-base font-semibold">Admin Login</h2>
                            <span class="text-xs opacity-70">/api/admin/auth/login</span>
                        </div>
                    </template>
                    <div class="grid gap-6 lg:grid-cols-[280px,1fr]">
                        <div class="space-y-3">
                            <label class="text-xs uppercase opacity-60">Username</label>
                            <UInput v-model="adminUsername" placeholder="admin" size="sm" />
                            <label class="text-xs uppercase opacity-60">Password</label>
                            <UInput v-model="adminPassword" type="password" placeholder="password" size="sm" />
                            <UButton size="sm" class="w-full" @click="loginAdmin">Login</UButton>
                            <UButton size="sm" variant="ghost" class="w-full" @click="logoutAdmin">Logout</UButton>
                        </div>
                        <div class="grid gap-4 md:grid-cols-2 text-sm">
                            <div>
                                <div class="text-xs uppercase opacity-60">Login Result</div>
                                <pre class="mt-2 max-h-56 overflow-auto rounded border p-2 text-xs">{{ adminLogin?.payload ?? adminLogin?.error ?? '—' }}</pre>
                            </div>
                            <div>
                                <div class="text-xs uppercase opacity-60">Session Result</div>
                                <pre class="mt-2 max-h-56 overflow-auto rounded border p-2 text-xs">{{ adminSession?.payload ?? adminSession?.error ?? '—' }}</pre>
                            </div>
                            <div>
                                <div class="text-xs uppercase opacity-60">Logout Result</div>
                                <pre class="mt-2 max-h-40 overflow-auto rounded border p-2 text-xs">{{ adminLogout?.payload ?? adminLogout?.error ?? '—' }}</pre>
                            </div>
                        </div>
                    </div>
                </UCard>
            </div>

            <div class="grid gap-6 md:grid-cols-2">
                <UCard>
                    <template #header>
                        <div class="flex items-center justify-between">
                            <h2 class="text-base font-semibold">Summary</h2>
                            <span class="text-xs opacity-70">Status snapshot</span>
                        </div>
                    </template>
                    <div class="grid grid-cols-2 gap-2 text-sm">
                        <div class="opacity-70">Base session</div>
                        <div>{{ summarized.baseSession }}</div>
                        <div class="opacity-70">Admin redirect</div>
                        <div>{{ summarized.adminRedirect }}</div>
                        <div class="opacity-70">Admin login</div>
                        <div>{{ summarized.adminLogin }}</div>
                        <div class="opacity-70">Admin session</div>
                        <div>{{ summarized.adminSession }}</div>
                        <div class="opacity-70">Admin logout</div>
                        <div>{{ summarized.adminLogout }}</div>
                    </div>
                </UCard>

                <UCard>
                    <template #header>
                        <div class="flex items-center justify-between">
                            <h2 class="text-base font-semibold">Navigation</h2>
                            <span class="text-xs opacity-70">Test routes</span>
                        </div>
                    </template>
                    <div class="flex flex-col gap-2 text-sm">
                        <NuxtLink to="/" class="underline">← Home</NuxtLink>
                        <NuxtLink to="/_tests/_test-auth" class="underline">Clerk Auth Test</NuxtLink>
                        <NuxtLink to="/_tests/_test-sync" class="underline">Sync Test</NuxtLink>
                        <NuxtLink to="/_tests/_test-storage" class="underline">Storage Test</NuxtLink>
                        <NuxtLink to="/_tests/_test-full-stack" class="underline">Full Stack Test</NuxtLink>
                    </div>
                </UCard>
            </div>
        </div>
    </div>
</template>

<style scoped>
.test-wrapper {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    background: white;
}

.test-page {
    padding: 2rem 1.5rem;
}
</style>
