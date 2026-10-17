<template>
    <section class="space-y-6">
        <div>
            <h1 class="text-xl font-semibold">Cloud waitlist</h1>
            <p class="mt-1 text-sm text-(--md-on-surface-variant)">
                Replace the welcome page's email action with a waitlist. Sign-in and invitations keep working.
            </p>
        </div>
        <UAlert v-if="error" color="error" title="Unable to load the waitlist" description="Try again, or sign in as the instance administrator." />
        <UButton v-if="error" color="neutral" variant="outline" @click="refresh()">Retry</UButton>
        <template v-if="data">
            <div class="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-(--md-outline-variant) p-4">
                <USwitch
                    label="Show waitlist on the welcome page"
                    :model-value="data.enabled" :disabled="saving" @update:model-value="save"
                />
                <span class="text-sm text-(--md-on-surface-variant)">{{ data.enabled ? 'Waitlist active' : 'Normal email flow' }}</span>
                <p class="w-full text-sm text-(--md-on-surface-variant)">
                    This controls the welcome page only. Use invite-only registration in your authentication settings to limit who can create an account.
                </p>
            </div>
            <p v-if="saveError" role="alert" class="text-sm text-(--md-error)">{{ saveError }}</p>
            <div class="flex flex-wrap items-center justify-between gap-3">
                <h2 class="font-semibold">{{ data.total.toLocaleString() }} {{ data.total === 1 ? 'email' : 'emails' }}</h2>
                <UButton color="neutral" variant="outline" :loading="status === 'pending'" @click="refresh()">Refresh list</UButton>
            </div>
            <p v-if="!data.total" class="py-6 text-sm text-(--md-on-surface-variant)">No one has joined the waitlist yet.</p>
            <div v-else class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                    <caption class="sr-only">Waitlist emails, newest first</caption>
                    <thead><tr class="border-b border-(--md-outline-variant)"><th scope="col" class="p-3">Email</th><th scope="col" class="p-3">Joined</th></tr></thead>
                    <tbody>
                        <tr v-for="entry in data.entries" :key="entry.email" class="border-b border-(--md-outline-variant)">
                            <td class="break-all p-3">{{ entry.email }}</td>
                            <td class="whitespace-nowrap p-3"><time :datetime="new Date(entry.createdAt).toISOString()">{{ new Date(entry.createdAt).toLocaleString() }}</time></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <nav v-if="data.total > data.pageSize" aria-label="Waitlist pages" class="flex items-center justify-between gap-3">
                <UButton color="neutral" variant="outline" :disabled="page === 1 || status === 'pending'" @click="page--">Previous</UButton>
                <span class="text-sm">Page {{ page }} of {{ Math.ceil(data.total / data.pageSize) }}</span>
                <UButton color="neutral" variant="outline" :disabled="page * data.pageSize >= data.total || status === 'pending'" @click="page++">Next</UButton>
            </nav>
        </template>
        <p v-else-if="!error" role="status" class="text-sm">Loading waitlist…</p>
    </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useFetch } from '#imports';

const page = ref(1);
const saving = ref(false);
const saveError = ref('');
const { data, status, error, refresh } = useFetch<{
    enabled: boolean; entries: { email: string; createdAt: number }[];
    total: number; page: number; pageSize: number;
}>('/api/admin/cloud-waitlist', {
    server: false, credentials: 'include', cache: 'no-store', query: { page },
});

async function save(enabled: boolean) {
    if (saving.value) return;
    saving.value = true;
    saveError.value = '';
    try {
        const result = await $fetch<{ enabled: boolean }>('/api/admin/cloud-waitlist', {
            method: 'PATCH', credentials: 'include', headers: { 'x-or3-admin-intent': 'admin' }, body: { enabled },
        });
        if (data.value) data.value.enabled = result.enabled;
    } catch { saveError.value = "The setting couldn't be saved. Please try again."; }
    finally { saving.value = false; }
}
</script>
