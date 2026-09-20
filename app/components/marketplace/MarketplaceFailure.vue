<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AcquisitionStatusView } from '~~/shared/plugins/acquisition/contracts';
import { acquisitionDiagnosticReport, acquisitionFailureHelp } from '~~/shared/plugins/acquisition/failure-presentation';
import { useDashboardNavigation } from '~/composables/dashboard/useDashboardPlugins';

const props = defineProps<{ operation: AcquisitionStatusView }>();
const navigation = useDashboardNavigation();
const help = computed(() => acquisitionFailureHelp(props.operation));
const report = computed(() => acquisitionDiagnosticReport(props.operation));
const copyMessage = ref('');
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
    <section class="flex flex-col gap-2 rounded-lg border border-(--ui-border) p-3" aria-label="Installation needs attention" data-testid="marketplace-failure">
        <div role="status">
            <h4 class="font-semibold">{{ help.title }}</h4>
            <p>{{ help.message }}</p>
        </div>
        <p class="text-sm">{{ operation.pluginId }} · Version {{ operation.version }} · Workspace {{ operation.workspaceId }}</p>
        <p class="text-sm text-(--ui-text-muted)">Installation does not delete your plugin data. Check Installed for the active version and workspace activation status.</p>
        <UButton variant="soft" color="neutral" @click="navigation.openPage('marketplace', 'installed')">Manage installed plugins</UButton>
        <details>
            <summary class="cursor-pointer">Technical details</summary>
            <p class="text-xs">Contains package and workspace identifiers, but no credentials or plugin content. Review before sharing.</p>
            <pre class="overflow-auto whitespace-pre-wrap text-xs" data-testid="marketplace-diagnostic-report">{{ report }}</pre>
            <UButton variant="soft" color="neutral" data-testid="marketplace-copy-diagnostics" @click="copyReport">Copy diagnostic report</UButton>
            <p role="status">{{ copyMessage }}</p>
        </details>
    </section>
</template>
