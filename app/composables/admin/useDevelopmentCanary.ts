import { ref } from 'vue';
import { useToast } from '#imports';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';

/**
 * Complete the browser half of a development candidate canary from an admin
 * surface: run the hidden activation of the exact admitted bytes in this
 * browser, report the outcome, and let the host re-run the canary to a pass.
 * Server-only evidence never substitutes for this step.
 */
export function useDevelopmentCanary() {
    const toast = useToast();
    const busyPluginId = ref<string | null>(null);
    const notes = ref<Record<string, string>>({});

    const runBrowserCheck = async (pluginId: string): Promise<boolean> => {        busyPluginId.value = pluginId;
        notes.value = { ...notes.value, [pluginId]: 'Running the hidden browser activation…' };
        try {
            const { reportCandidateClientCanary } = await import(
                '~/composables/plugins/portable-canary'
            );
            for (let attempt = 0; attempt < 3; attempt += 1) {
                const result = (await ($fetch as unknown as (
                    input: string,
                    init: Record<string, unknown>
                ) => Promise<unknown>)(
                    `/api/admin/plugins/packages/${encodeURIComponent(pluginId)}/canary`,
                    { method: 'POST', credentials: 'include', headers: { ...ADMIN_HEADERS }, body: {} }
                )) as {
                    ok?: boolean;
                    status?: string;
                    clientCanary?: { status: string; ticket: Parameters<typeof reportCandidateClientCanary>[0] };
                };
                if (result.ok) {
                    notes.value = { ...notes.value, [pluginId]: 'Canary passed in this browser.' };
                    toast.add({ title: 'Browser check passed', description: 'Promote the candidate when ready.', color: 'success' });
                    return true;
                }
                if (result.clientCanary?.status !== 'awaiting-client') {
                    notes.value = { ...notes.value, [pluginId]: `Canary did not pass: ${result.status ?? 'blocked'}.` };
                    toast.add({ title: 'Browser check did not pass', description: notes.value[pluginId], color: 'error' });
                    return false;
                }
                const outcome = await reportCandidateClientCanary(result.clientCanary.ticket);
                if (outcome.status !== 'passed') {
                    notes.value = { ...notes.value, [pluginId]: `Browser activation ${outcome.status}: ${outcome.code ?? 'blocked'}.` };
                    toast.add({ title: 'Browser check did not pass', description: notes.value[pluginId], color: 'error' });
                    return false;
                }
                notes.value = { ...notes.value, [pluginId]: 'Browser activation passed. Re-checking…' };
            }
            notes.value = { ...notes.value, [pluginId]: 'Canary is still pending after three browser checks.' };
            return false;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'The browser check failed.';
            notes.value = { ...notes.value, [pluginId]: message };
            toast.add({ title: 'Browser check failed', description: message, color: 'error' });
            return false;
        } finally {
            busyPluginId.value = null;
        }
    };

    /** Export the canary-bound developer verification receipt as a JSON download. */
    const exportCanaryReceipt = async (pluginId: string, packageDigest: string): Promise<boolean> => {
        try {
            const result = (await ($fetch as unknown as (input: string, init: Record<string, unknown>) => Promise<unknown>)(
                '/api/admin/plugins/development/verification',
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { ...ADMIN_HEADERS, 'content-type': 'application/json' },
                    body: { pluginId, packageDigest, scope: 'runtime-canary' },
                }
            )) as { receipt: Record<string, unknown> };
            const blob = new Blob([`${JSON.stringify(result.receipt, null, 2)}\n`], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${pluginId}-verification-runtime-canary.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            toast.add({ title: 'Verification receipt exported', description: 'Developer-supplied evidence, bound to the candidate and host.', color: 'success' });
            return true;
        } catch (error) {
            toast.add({ title: 'Verification unavailable', description: error instanceof Error ? error.message : 'Run the candidate canary to a pass first.', color: 'error' });
            return false;
        }
    };

    return { busyPluginId, notes, runBrowserCheck, exportCanaryReceipt };
}
