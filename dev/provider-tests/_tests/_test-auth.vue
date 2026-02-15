<script setup lang="ts">
/**
 * Interactive Auth Test Page
 * Visit: http://localhost:3001/_tests/_test-auth
 *
 * Tests Clerk authentication and session context:
 * - Sign in/out flow
 * - Session resolution
 * - Workspace membership
 * - Role-based permissions
 */

// Disable SSR to avoid hydration mismatches with client-only features
definePageMeta({ ssr: false });

import { useConvexQuery, useConvexMutation } from 'convex-vue';
import { api } from '~~/convex/_generated/api';

// ----- Clerk Auth State -----
const clerkLoaded = ref(false);
const isSignedIn = ref(false);
const clerkUser = ref<{
    id: string;
    email: string | null;
    fullName: string | null;
    imageUrl: string | null;
} | null>(null);

// Try to access Clerk composables
onMounted(() => {
    try {
        // Check if Clerk is available
        const clerk = (window as unknown as { Clerk?: { user?: unknown } }).Clerk;
        if (clerk) {
            clerkLoaded.value = true;
            isSignedIn.value = !!clerk.user;
        }
    } catch {
        console.log('Clerk not available');
    }
});

// ----- Convex User Identity -----
const { data: identity, isPending: identityPending, error: identityError } = useConvexQuery(api.users.me, {});

// ----- Permission Tests -----
const testPermissions = ref<{ permission: string; result: boolean | null }[]>([
    { permission: 'workspace.read', result: null },
    { permission: 'workspace.write', result: null },
    { permission: 'workspace.admin', result: null },
    { permission: 'member.invite', result: null },
]);

// Simulated permission check (in real app this uses can())
function checkPermissions() {
    const role = identity.value ? 'editor' : null;
    const rolePermissions: Record<string, string[]> = {
        owner: ['workspace.read', 'workspace.write', 'workspace.admin', 'member.invite'],
        editor: ['workspace.read', 'workspace.write'],
        viewer: ['workspace.read'],
    };

    testPermissions.value = testPermissions.value.map((p) => ({
        ...p,
        result: role ? rolePermissions[role]?.includes(p.permission) ?? false : false,
    }));
}

// ----- Status Indicators -----
const authStatus = computed(() => {
    if (identityError.value) return { status: 'Error', color: 'red', icon: '❌' };
    if (identityPending.value) return { status: 'Loading...', color: 'yellow', icon: '⏳' };
    if (identity.value) return { status: 'Authenticated', color: 'green', icon: '✅' };
    return { status: 'Not Authenticated', color: 'blue', icon: '🔒' };
});

// ----- Session API Test -----
const sessionApiResult = ref<unknown>(null);
const sessionApiLoading = ref(false);
const sessionApiError = ref<string | null>(null);

async function testSessionApi() {
    sessionApiLoading.value = true;
    sessionApiError.value = null;
    try {
        const response = await $fetch('/api/auth/session');
        sessionApiResult.value = response;
    } catch (e) {
        sessionApiError.value = e instanceof Error ? e.message : String(e);
    } finally {
        sessionApiLoading.value = false;
    }
}
</script>

<template>
    <div class="test-wrapper">
        <div class="test-page">
            <h1>🔐 Auth Integration Test</h1>
            <p class="subtitle">Interactive test page for Clerk + Convex authentication</p>

        <!-- Status Card -->
        <div class="card" :class="`status-${authStatus.color}`">
            <h2>{{ authStatus.icon }} Auth Status: {{ authStatus.status }}</h2>
        </div>

        <!-- Convex Identity -->
        <div class="card">
            <h2>📋 Convex User Identity</h2>
            <div v-if="identityPending" class="loading">Loading from Convex...</div>
            <div v-else-if="identityError" class="error">Error: {{ identityError.message }}</div>
            <div v-else-if="identity" class="user-info">
                <img v-if="identity.pictureUrl" :src="identity.pictureUrl" class="avatar" alt="Avatar" />
                <div class="details">
                    <p><strong>Name:</strong> {{ identity.name || 'N/A' }}</p>
                    <p><strong>Email:</strong> {{ identity.email || 'N/A' }}</p>
                    <p>
                        <strong>Email Verified:</strong>
                        {{ identity.emailVerified ? '✅ Yes' : '❌ No' }}
                    </p>
                    <p class="mono"><strong>Token ID:</strong> {{ identity.tokenIdentifier }}</p>
                </div>
            </div>
            <div v-else class="info">Not authenticated - Sign in with Clerk to see user data</div>
        </div>

        <!-- Permission Tests -->
        <div class="card">
            <h2>🛡️ Permission Tests</h2>
            <p class="help">Simulates <code>can(session, permission)</code> checks</p>
            <button class="btn" @click="checkPermissions" :disabled="!identity">Run Permission Checks</button>
            <table v-if="testPermissions.some((p) => p.result !== null)" class="results-table">
                <thead>
                    <tr>
                        <th>Permission</th>
                        <th>Result</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="p in testPermissions" :key="p.permission">
                        <td><code>{{ p.permission }}</code></td>
                        <td :class="p.result ? 'pass' : 'fail'">{{ p.result ? '✅ Allowed' : '❌ Denied' }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Session API Test -->
        <div class="card">
            <h2>🌐 Session API Test</h2>
            <p class="help">Tests <code>GET /api/auth/session</code> endpoint</p>
            <button class="btn" @click="testSessionApi" :disabled="sessionApiLoading">
                {{ sessionApiLoading ? 'Loading...' : 'Test Session API' }}
            </button>
            <div v-if="sessionApiError" class="error">{{ sessionApiError }}</div>
            <pre v-if="sessionApiResult" class="code-block">{{ JSON.stringify(sessionApiResult, null, 2) }}</pre>
        </div>

        <!-- Navigation -->
        <div class="nav-links">
            <NuxtLink to="/" class="link">← Home</NuxtLink>
            <NuxtLink to="/_tests/_test-convex" class="link">Convex Test →</NuxtLink>
            <NuxtLink to="/_tests/_test-sync" class="link">Sync Test →</NuxtLink>
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
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui, sans-serif;
}

h1 {
    margin-bottom: 0.5rem;
}

.subtitle {
    color: #666;
    margin-bottom: 2rem;
}

.card {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
}

.card h2 {
    margin-top: 0;
    margin-bottom: 1rem;
    font-size: 1.25rem;
}

.status-green {
    background: #d1fae5;
    border-color: #10b981;
}
.status-yellow {
    background: #fef3c7;
    border-color: #f59e0b;
}
.status-red {
    background: #fee2e2;
    border-color: #ef4444;
}
.status-blue {
    background: #dbeafe;
    border-color: #3b82f6;
}

.user-info {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
}

.avatar {
    width: 64px;
    height: 64px;
    border-radius: 50%;
}

.details p {
    margin: 0.5rem 0;
}

.mono {
    font-family: monospace;
    font-size: 0.8rem;
    word-break: break-all;
}

.btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    margin-bottom: 1rem;
}

.btn:hover {
    background: #2563eb;
}

.btn:disabled {
    background: #9ca3af;
    cursor: not-allowed;
}

.help {
    color: #666;
    font-size: 0.875rem;
    margin-bottom: 1rem;
}

.results-table {
    width: 100%;
    border-collapse: collapse;
}

.results-table th,
.results-table td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid #e5e7eb;
}

.pass {
    color: #10b981;
}
.fail {
    color: #ef4444;
}

.loading {
    color: #f59e0b;
}
.error {
    color: #ef4444;
    padding: 0.5rem;
    background: #fee2e2;
    border-radius: 4px;
}
.info {
    color: #3b82f6;
}

.code-block {
    background: #1f2937;
    color: #10b981;
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.8rem;
}

.nav-links {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 2rem;
}

.link {
    color: #3b82f6;
    text-decoration: none;
}

.link:hover {
    text-decoration: underline;
}

code {
    background: #e5e7eb;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.875rem;
}
</style>
