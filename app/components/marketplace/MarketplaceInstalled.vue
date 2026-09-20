<script setup lang="ts">
/**
 * Dashboard > Marketplace > Installed and Updates.
 *
 * One lifecycle for both views: the installed list enables, disables, opens,
 * configures and removes during the acquisition-created packages, and the update
 * list filters the same entries down to those with a recorded candidate so a
 * release is reviewed, health-checked and activated through the same services.
 */
import { inject, onMounted, ref } from 'vue';
import { useToast } from '#imports';
import { useMarketplaceInstalled } from '~/composables/marketplace/useMarketplace';
import { getPortableClientSource, usePortableActivations } from '~/composables/plugins/portable-client-runtime';
import { openPortablePane } from '~/composables/plugins/portable-pane';


const toast = useToast();
const installed = useMarketplaceInstalled();
const activations = usePortableActivations();
const closeDashboard = inject<() => void>('or3:dashboard:close', () => {});
const busyPluginId = ref<string | null>(null);
onMounted(() => installed.load());

async function openPlugin(pluginId: string): Promise<void> {
    if (!getPortableClientSource(pluginId)) {
        toast.add({ title: 'Plugin interface unavailable', description: 'The plugin runtime is not available in this workspace. Check runtime diagnostics in Admin → Plugins. Configure opens setup only.', color: 'warning' });
        return;
    }
    try {
        await openPortablePane(pluginId);
        closeDashboard();
    } catch (error) {
        toast.add({title: 'Could not open plugin', description: error instanceof Error ? error.message : 'The workspace pane is unavailable.', color: 'warning'});
    }
}

function isEnabled(pluginId: string): boolean {
    return installed.enabled.value.includes(pluginId);
}

function isPortable(pluginId: string): boolean {
    return activations.has(`portable:${pluginId}`) || activations.has(pluginId);
}

function activationFor(pluginId: string) {
    return activations.get(`portable:${pluginId}`) ?? activations.get(pluginId) ?? null;
}

async function toggle(pluginId: string): Promise<void> {
    busyPluginId.value = pluginId;
    try {
        await installed.setEnabled(pluginId, !isEnabled(pluginId));
    } catch (error) {
        toast.add({
            title: 'Could not change the workspace state',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        busyPluginId.value = null;
    }
}

async function uninstall(pluginId: string): Promise<void> {
    busyPluginId.value = pluginId;
    try {
        await installed.uninstall(pluginId);
        toast.add({
            title: 'Plugin removed',
            description: 'Its data is kept unless you delete it explicitly.',
            color: 'success',
        });
    } catch (error) {
        toast.add({
            title: 'Could not remove the plugin',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        busyPluginId.value = null;
    }
}

async function rollback(pluginId: string): Promise<void> {
    busyPluginId.value = pluginId;
    try {
        await installed.rollback(pluginId);
        toast.add({ title: 'Rolled back to the previous version', color: 'success' });
    } catch (error) {
        toast.add({
            title: 'Rollback was refused',
            description: error instanceof Error ? error.message : 'State compatibility may block it.',
            color: 'error',
        });
    } finally {
        busyPluginId.value = null;
    }
}

/** Redacted support report: no settings, secrets, content or signed URLs. */
async function copyDiagnostics(): Promise<void> {
    try {
        const report = (await apiGet<Record<string, unknown>>('/api/plugins/diagnostics')) as Record<
            string,
            unknown
        >;
        const browser = {
            activations: [...activations.entries()].map(([id, activation]) => ({
                pluginId: id,
                status: activation.status,
                blockCode: activation.blockCode ?? null,
                crashed: activation.crashed,
                logCount: activation.logs.length,
                contributionCount: activation.contributions.length,
            })),
        };
        await navigator.clipboard.writeText(
            JSON.stringify({ ...report, browser }, null, 2)
        );
        toast.add({
            title: 'Diagnostics copied',
            description: 'Settings, secrets, message content and signed URLs are not included.',
            color: 'success',
        });
    } catch (error) {
        toast.add({
            title: 'Could not build the report',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    }
}

async function apiGet<T>(url: string): Promise<T> {
    return (await ($fetch as unknown as (input: string) => Promise<unknown>)(url)) as T;
}
</script>

<template>
    <div class="flex flex-col gap-5">
        <div v-if="installed.error.value" class="text-sm text-(--ui-text-muted)" data-testid="marketplace-installed-error">
            {{ installed.error.value }}
        </div>

        <div class="flex justify-end">
            <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-clipboard-list"
                data-testid="marketplace-copy-diagnostics"
                @click="copyDiagnostics"
            >
                Copy diagnostics
            </UButton>
        </div>

        <section class="flex flex-col gap-3" data-testid="marketplace-installed">
            <h3 class="text-base font-medium">Installed</h3>
            <div v-if="installed.loading.value" class="text-sm text-(--ui-text-muted)">Loading…</div>
            <div v-else-if="installed.packages.value.length === 0" class="text-sm text-(--ui-text-muted)">
                No packages are installed yet. Browse the marketplace to add one.
            </div>
            <ul v-else class="flex flex-col gap-3">
                <li
                    v-for="entry in installed.packages.value"
                    :key="entry.pluginId"
                    class="flex flex-col gap-2 rounded-lg border border-(--ui-border) p-3"
                >
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="font-medium">{{ entry.pluginId }}</span>
                        <UBadge color="neutral" variant="subtle">
                            {{ entry.display?.version ?? 'no version selected' }}
                        </UBadge>
                        <UBadge v-if="isEnabled(entry.pluginId)" color="success" variant="subtle">Enabled</UBadge>
                        <UBadge v-else color="neutral" variant="subtle">Disabled</UBadge>
                        <UBadge
                            v-if="activationFor(entry.pluginId)?.status === 'blocked'"
                            color="warning"
                            variant="subtle"
                        >
                            Blocked: {{ activationFor(entry.pluginId)?.blockCode }}
                        </UBadge>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <UButton
                            v-if="entry.display?.canOpen"
                            size="sm"
                            color="primary"
                            variant="soft"
                            icon="i-lucide-play"
                            :disabled="!isEnabled(entry.pluginId)"
                            @click="openPlugin(entry.pluginId)"
                        >
                            Open
                        </UButton>
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="soft"
                            icon="i-lucide-settings"
                            :to="`/plugins/${entry.pluginId}/setup`"
                        >
                            Configure
                        </UButton>
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="soft"
                            :loading="busyPluginId === entry.pluginId"
                            @click="toggle(entry.pluginId)"
                        >
                            {{ isEnabled(entry.pluginId) ? 'Disable' : 'Enable' }}
                        </UButton>
                        <UButton
                            size="sm"
                            color="error"
                            variant="ghost"
                            icon="i-lucide-trash-2"
                            :loading="busyPluginId === entry.pluginId"
                            @click="uninstall(entry.pluginId)"
                        >
                            Uninstall
                        </UButton>
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-undo-2"
                            :loading="busyPluginId === entry.pluginId"
                            @click="rollback(entry.pluginId)"
                        >
                            Roll back
                        </UButton>
                    </div>
                </li>
            </ul>
        </section>

        <p v-if="installed.role.value && installed.role.value !== 'owner'" class="text-xs text-(--ui-text-muted)">
            Advanced package operations and raw uploads remain on the admin plugins page.
        </p>
    </div>
</template>
