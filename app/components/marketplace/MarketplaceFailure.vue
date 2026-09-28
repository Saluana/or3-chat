<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AcquisitionStatusView } from '~~/shared/plugins/acquisition/contracts';
import { acquisitionDiagnosticReport, acquisitionFailureHelp } from '~~/shared/plugins/acquisition/failure-presentation';
import { useDashboardNavigation } from '~/composables/dashboard/useDashboardPlugins';
import { marketplacePluginDeepLink } from '~/composables/marketplace/useMarketplace';

const props = defineProps<{ operation: AcquisitionStatusView }>();
const navigation = useDashboardNavigation();
const help = computed(() => acquisitionFailureHelp(props.operation));
const report = computed(() => acquisitionDiagnosticReport(props.operation));
const copyMessage = ref('');
function repairLink(workspaceId: string, code: string): string {
    const link = marketplacePluginDeepLink('', props.operation.pluginId, props.operation.version, undefined, workspaceId);
    const operation = `&acquisition=${encodeURIComponent(props.operation.operationId)}`;
    return `${link}${operation}${code.startsWith('setup-') ? '&setup=1' : ''}`;
}
async function copyReport() {
    try {
        await navigator.clipboard.writeText(report.value);
        copyMessage.value = 'Diagnostic report copied';
    } catch {
        copyMessage.value = 'Copy was unavailable. Select the report below and copy it manually.';
    }
}
</script>

<template>
    <section class="flex flex-col gap-3 rounded-lg border border-(--ui-border) p-4" aria-label="Installation needs attention" data-testid="marketplace-failure">
        <div role="status" class="space-y-1">
            <h4 class="font-semibold">{{ help.title }}</h4>
            <p>{{ help.message }}</p>
        </div>
        <p class="text-sm">{{ operation.pluginId }} · Version {{ operation.version }} · Workspace {{ operation.workspaceId }}</p>
        <p class="text-sm text-(--ui-text-muted)">Installation does not delete your plugin data. Check Installed for the active version and workspace activation status.</p>
        <div v-if="operation.failure?.workspaceBlocks" class="text-sm">
            <p>{{ operation.failure.workspaceBlocks.total }} workspace(s) need attention before this shared version can be selected.</p>
            <ul class="mt-2 max-h-48 space-y-2 overflow-y-auto">
                <li v-for="block in operation.failure.workspaceBlocks.items" :key="`${block.workspaceId}:${block.code}`" class="flex flex-wrap items-center gap-2 break-all">
                    <span>{{ block.workspaceId }} · {{ block.code }}</span>
                    <UButton size="xs" color="neutral" variant="soft" :to="repairLink(block.workspaceId, block.code)">
                        {{ block.code.startsWith('setup-') ? 'Open workspace setup' : 'Open workspace review' }}
                    </UButton>
                </li>
            </ul>
            <p v-if="operation.failure.workspaceBlocks.total > operation.failure.workspaceBlocks.items.length" class="mt-2 text-xs">
                {{ operation.failure.workspaceBlocks.total - operation.failure.workspaceBlocks.items.length }} more workspace(s) are blocked. Retry after repairing the listed workspaces to refresh the review.
            </p>
        </div>
        <UButton variant="soft" color="neutral" @click="navigation.openPage('marketplace', 'installed')">Manage installed plugins</UButton>
        <details class="space-y-2">
            <summary class="cursor-pointer">Technical details</summary>
            <p class="text-xs">Contains package and workspace identifiers, but no credentials or plugin content. Review before sharing.</p>
            <pre class="overflow-auto whitespace-pre-wrap rounded-md border border-(--ui-border) p-3 text-xs" data-testid="marketplace-diagnostic-report">{{ report }}</pre>
            <UButton variant="soft" color="neutral" data-testid="marketplace-copy-diagnostics" @click="copyReport">Copy diagnostic report</UButton>
            <p role="status">{{ copyMessage }}</p>
        </details>
    </section>
</template>
