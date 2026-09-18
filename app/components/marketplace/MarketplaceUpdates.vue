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
import {
    useMarketplaceInstall,
    useMarketplaceInstalled,
} from '~/composables/marketplace/useMarketplace';
import { reportCandidateClientCanary } from '~/composables/plugins/portable-canary';

const toast = useToast();
const installed = useMarketplaceInstalled();
const install = useMarketplaceInstall();
const busyPluginId = ref<string | null>(null);
const canaryNote = ref<Record<string, string>>({});

onMounted(() => installed.load());

const candidates = computed(() =>
    installed.packages.value.filter((entry) => Boolean(entry.pointer?.candidate))
);

function reportOutcome(
    pluginId: string,
    status: string | undefined,
    message: string | undefined
): void {
    if (status === 'completed') {
        canaryNote.value = { ...canaryNote.value, [pluginId]: 'activated' };
        toast.add({
            title: 'Updated',
            description: 'The reviewed version is now the selected one.',
            color: 'success',
        });
        return;
    }
    canaryNote.value = { ...canaryNote.value, [pluginId]: status ?? 'pending' };
    toast.add({
        title: status === 'paused' ? 'Setup required' : 'The update is still pending',
        description: message ?? 'Resume the install when the blocker is cleared.',
        color: 'warning',
    });
}

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
    readonly display?: {
        readonly candidateDigest: string | null;
        readonly candidateVersion: string | null;
    };
    readonly pointer: {
        readonly candidate?: { readonly packageDigest?: string } | null;
    } | null;
}): Promise<void> {
    const candidateDigest = entry.display?.candidateDigest ?? entry.pointer?.candidate?.packageDigest;
    if (!candidateDigest) return;
    const candidateVersion = entry.display?.candidateVersion ?? '';
    busyPluginId.value = entry.pluginId;
    canaryNote.value = { ...canaryNote.value, [entry.pluginId]: 'checking' };
    try {
        // A candidate the acquisition pipeline staged belongs to that operation:
        // resume it, so preflight, setup readiness and the browser canary all
        // still apply. Promoting it here would be a side door around them.
        const resumable = await install.restore(entry.pluginId, {
            version: candidateVersion,
            ...(installed.workspaceId.value === null
                ? {}
                : { workspaceId: installed.workspaceId.value }),
        });
        // Only resume the operation that staged *this* candidate; an unrelated
        // unfinished install must not be adopted to activate a different version.
        if (resumable && resumable.version === candidateVersion && resumable.status !== 'completed') {
            canaryNote.value = { ...canaryNote.value, [entry.pluginId]: 'resuming install' };
            const finished = await install.adopt(entry.pluginId, resumable.operationId);
            reportOutcome(entry.pluginId, finished?.status, finished?.failure?.message);
            await installed.load();
            return;
        }
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

        try {
            await apiPost(`/api/admin/plugins/packages/${entry.pluginId}/promote`, {
                body: { candidateDigest },
            });
            installed.reconcile('manifest-revision-change');
        } catch (promotionError) {
            // The promotion boundary refuses a candidate that an install
            // operation owns; resume that operation instead of reporting failure.
            const data = (promotionError as { data?: { code?: string; operationId?: string } }).data;
            if (data?.code === 'acquisition-required' && data.operationId) {
                canaryNote.value = {
                    ...canaryNote.value,
                    [entry.pluginId]: 'resuming install',
                };
                const finished = await install.adopt(entry.pluginId, data.operationId);
                reportOutcome(entry.pluginId, finished?.status, finished?.failure?.message);
                await installed.load();
                return;
            }
            throw promotionError;
        }
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
                        candidate {{ entry.display?.candidateVersion ?? entry.display?.candidateDigest }}
                    </UBadge>
                    <span class="text-xs text-(--ui-text-muted)">
                        current {{ entry.display?.version ?? 'none' }}
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
