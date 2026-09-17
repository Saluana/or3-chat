<script setup lang="ts">
/**
 * Dashboard > Marketplace > Updates.
 *
 * Updates are recorded candidates on the same package lifecycle the installer
 * uses: each one is health-checked (including the hidden browser canary for
 * contained client packages) and only then promoted by exact digest. A newer
 * authority revision needs fresh workspace consent before the check can pass.
 */
import { computed, onMounted, ref } from 'vue';
import { useToast } from '#imports';
import { useMarketplaceInstalled } from '~/composables/marketplace/useMarketplace';
import { reportCandidateClientCanary } from '~/composables/plugins/portable-canary';

const toast = useToast();
const installed = useMarketplaceInstalled();
const busyPluginId = ref<string | null>(null);
const canaryNote = ref<Record<string, string>>({});

onMounted(() => installed.load());

const candidates = computed(() =>
    installed.packages.value.filter((entry) => Boolean(entry.pointer?.candidate))
);

async function apiPost<T>(
    url: string,
    options: { readonly body?: unknown } = {}
): Promise<T> {
    return (await (
        $fetch as unknown as (input: string, init: Record<string, unknown>) => Promise<unknown>
    )(url, {
        method: 'POST',
        headers: { 'x-or3-admin-intent': 'admin' },
        ...(options.body === undefined ? {} : { body: options.body }),
    })) as T;
}

async function activate(entry: {
    readonly pluginId: string;
    readonly pointer: { readonly candidate?: { readonly packageDigest?: string } } | null;
}): Promise<void> {
    const candidateDigest = entry.pointer?.candidate?.packageDigest;
    if (!candidateDigest) return;
    busyPluginId.value = entry.pluginId;
    canaryNote.value = { ...canaryNote.value, [entry.pluginId]: 'checking' };
    try {
        const runCanary = () =>
            apiPost<{
                ok?: boolean;
                status?: string;
                clientCanary?: {
                    status: string;
                    ticket: Parameters<typeof reportCandidateClientCanary>[0];
                };
            }>(`/api/admin/plugins/packages/${entry.pluginId}/canary`, { body: {} });

        const canary = await runCanary();
        if (canary.clientCanary?.status === 'awaiting-client') {
            const outcome = await reportCandidateClientCanary(canary.clientCanary.ticket);
            canaryNote.value = { ...canaryNote.value, [entry.pluginId]: outcome.status };
            if (outcome.status !== 'passed') {
                toast.add({
                    title: 'This browser could not run the update',
                    description: `${outcome.code ?? 'blocked'} — the update stays pending.`,
                    color: 'warning',
                });
                return;
            }
            const rerun = await runCanary();
            if (!rerun.ok) {
                canaryNote.value = { ...canaryNote.value, [entry.pluginId]: rerun.status ?? 'blocked' };
                toast.add({ title: 'The update did not pass its health check', color: 'error' });
                return;
            }
        } else if (!canary.ok) {
            canaryNote.value = { ...canaryNote.value, [entry.pluginId]: canary.status ?? 'blocked' };
            toast.add({
                title: 'The update did not pass its health check',
                description: 'Check the workspace grant review, then try again.',
                color: 'error',
            });
            return;
        }

        await apiPost(`/api/admin/plugins/packages/${entry.pluginId}/promote`, {
            body: { candidateDigest },
        });
        toast.add({
            title: 'Updated',
            description: 'The reviewed version is now the selected one.',
            color: 'success',
        });
        await installed.load();
    } catch (error) {
        toast.add({
            title: 'The update could not be activated',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        busyPluginId.value = null;
    }
}
</script>

<template>
    <div class="flex flex-col gap-4" data-testid="marketplace-updates">
        <div v-if="installed.loading.value" class="text-sm text-(--ui-text-muted)">Loading…</div>
        <div v-else-if="candidates.length === 0" class="text-sm text-(--ui-text-muted)">
            No updates are waiting. Newer reviewed releases appear here before they activate.
        </div>
        <ul v-else class="flex flex-col gap-3">
            <li
                v-for="entry in candidates"
                :key="entry.pluginId"
                class="flex flex-col gap-2 rounded-lg border border-(--ui-border) p-3"
            >
                <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium">{{ entry.pluginId }}</span>
                    <UBadge color="info" variant="subtle">
                        candidate {{ entry.pointer?.candidate?.version ?? entry.pointer?.candidate?.packageDigest }}
                    </UBadge>
                    <span class="text-xs text-(--ui-text-muted)">
                        current {{ entry.pointer?.selected?.version ?? 'none' }}
                    </span>
                </div>
                <p class="text-xs text-(--ui-text-muted)">
                    The update activates only after a health check of the exact reviewed bytes; expanded
                    authority needs fresh consent first.
                </p>
                <p v-if="canaryNote[entry.pluginId]" class="text-xs text-(--ui-text-muted)">
                    Browser check: {{ canaryNote[entry.pluginId] }}
                </p>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        size="sm"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-check"
                        :loading="busyPluginId === entry.pluginId"
                        @click="activate(entry)"
                    >
                        Check and activate
                    </UButton>
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        :to="`/plugins/${entry.pluginId}/setup`"
                    >
                        Review setup
                    </UButton>
                </div>
            </li>
        </ul>
    </div>
</template>
