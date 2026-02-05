<script setup lang="ts">
/**
 * Test page for Convex integration
 * Visit: http://localhost:3001/_test-convex
 */
import { useConvexQuery } from 'convex-vue';
import { api } from '~~/convex/_generated/api';

// Test the Convex connection by querying user identity
// useConvexQuery returns { data, isPending, error }
const { data: identity, isPending, error } = useConvexQuery(api.users.me, {});

// Track connection state
const connectionStatus = computed(() => {
    if (error.value) {
        return { status: `error: ${error.value.message}`, color: 'red' };
    }
    if (isPending.value) {
        return { status: 'loading', color: 'yellow' };
    }
    if (identity.value === null) {
        return { status: 'connected (not authenticated)', color: 'blue' };
    }
    return { status: 'connected & authenticated', color: 'green' };
});
</script>

<template>
    <div class="test-convex-page">
        <h1>🔌 Convex Integration Test</h1>

        <div class="status-card" :class="connectionStatus.color">
            <h2>Connection Status</h2>
            <p class="status">{{ connectionStatus.status }}</p>
        </div>

        <div v-if="identity" class="user-card">
            <h2>Authenticated User</h2>
            <div class="user-info">
                <img
                    v-if="identity.pictureUrl"
                    :src="identity.pictureUrl"
                    alt="Profile"
                    class="avatar"
                />
                <div class="details">
                    <p><strong>Name:</strong> {{ identity.name || 'N/A' }}</p>
                    <p><strong>Email:</strong> {{ identity.email || 'N/A' }}</p>
                    <p>
                        <strong>Email Verified:</strong>
                        {{ identity.emailVerified ? '✅ Yes' : '❌ No' }}
                    </p>
                    <p class="token-id">
                        <strong>Token ID:</strong>
                        <code>{{ identity.tokenIdentifier }}</code>
                    </p>
                </div>
            </div>
        </div>

        <div v-else-if="identity === null" class="info-card">
            <h2>Not Authenticated</h2>
            <p>
                Convex is connected but no user is logged in. Sign in with
                Clerk to see your user data here.
            </p>
        </div>

        <div v-else class="loading-card">
            <h2>Loading...</h2>
            <p>Connecting to Convex...</p>
        </div>

        <div class="actions">
            <NuxtLink to="/" class="back-link">← Back to Home</NuxtLink>
        </div>
    </div>
</template>

<style scoped>
.test-convex-page {
    max-width: 600px;
    margin: 2rem auto;
    padding: 2rem;
    font-family: system-ui, sans-serif;
}

h1 {
    margin-bottom: 2rem;
    text-align: center;
}

.status-card,
.user-card,
.info-card,
.loading-card {
    padding: 1.5rem;
    border-radius: 12px;
    margin-bottom: 1.5rem;
}

.status-card {
    text-align: center;
}

.status-card.yellow {
    background: #fef3c7;
    border: 2px solid #f59e0b;
}

.status-card.blue {
    background: #dbeafe;
    border: 2px solid #3b82f6;
}

.status-card.green {
    background: #d1fae5;
    border: 2px solid #10b981;
}

.status-card.red {
    background: #fee2e2;
    border: 2px solid #ef4444;
}

.status {
    font-size: 1.25rem;
    font-weight: 600;
    text-transform: uppercase;
}

.user-card {
    background: #f0fdf4;
    border: 2px solid #22c55e;
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
    object-fit: cover;
}

.details p {
    margin: 0.5rem 0;
}

.token-id code {
    font-size: 0.75rem;
    background: #e5e7eb;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    word-break: break-all;
}

.info-card {
    background: #eff6ff;
    border: 2px solid #3b82f6;
}

.loading-card {
    background: #fefce8;
    border: 2px solid #eab308;
    text-align: center;
}

.actions {
    text-align: center;
    margin-top: 2rem;
}

.back-link {
    color: #3b82f6;
    text-decoration: none;
}

.back-link:hover {
    text-decoration: underline;
}
</style>
