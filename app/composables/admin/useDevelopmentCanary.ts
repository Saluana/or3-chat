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

    const runBrowserCheck = async (pluginId: string): Promise<boolean> => {
        busyPluginId.value = pluginId;
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

    return { busyPluginId, notes, runBrowserCheck };
}
