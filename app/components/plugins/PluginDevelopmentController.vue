<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { useDevelopmentCanary } from '~/composables/admin/useDevelopmentCanary';
import { requestWorkspacePluginReconcile } from '~/composables/plugins/bundled-v1-manager-runtime';
import { openPortablePane } from '~/composables/plugins/portable-pane';
import {
    ensurePortableClientActivation, getPortableActivation, getPortableClientSource,
} from '~/composables/plugins/portable-client-runtime';

interface Candidate {
    runId: string;
    generation: number;
    pluginId: string;
    packageDigest: string;
    receiptDigest: string;
}
interface Status {
    runId: string;
    state: 'starting' | 'building' | 'ready' | 'error';
    generation: number;
    candidate: Candidate | null;
    lastGood: Candidate | null;
    selectedDigest: string | null;
    message?: string;
}
interface Review {
    key: string;
    workspaceId: string;
    reviewerId: string | null;
    requestedGrants: readonly string[];
    authoritySha256: string;
    packageDigest: string;
}

const session = useSessionContext();
const canary = useDevelopmentCanary();
const phase = ref('starting');
const detail = ref('Waiting for the plugin development host…');
const paneOpenError = ref<string | null>(null);
const dismissed = ref(false);
const sessionLoaded = ref(false);
const review = ref<Review | null>(null);
const approved = ref(false);
const attentionKey = ref<string | null>(null);
const cleanupBlocked = ref<Candidate | null>(null);
const runningDigest = ref<string | null>(null);
const connected = ref(true);
const needsSignIn = ref(false);
const controller = ref(true);
const workspaceId = computed(() => session.data.value?.session?.workspace?.id ?? null);
const reviewerId = computed(() => session.data.value?.session?.user?.id ?? null);
const showPanel = computed(() => Boolean((review.value && !approved.value) || paneOpenError.value ||
    phase.value === 'needs attention' || phase.value === 'disconnected' ||
    (sessionLoaded.value && !workspaceId.value)));
let stopped = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let openingPane = false;
let paneOpened = false;

async function showPluginInChat(pluginId: string): Promise<void> {
    if (paneOpened || openingPane) return;
    openingPane = true;
    try {
        // The controller mounts alongside PageShell, whose workspace navigation
        // becomes available just after its own mounted hook runs.
        for (let attempt = 0; attempt < 30 && !stopped; attempt++) {
            try {
                await openPortablePane(pluginId);
                paneOpened = true;
                paneOpenError.value = null;
                return;
            } catch {
                await new Promise((done) => setTimeout(done, 100));
            }
        }
        if (!stopped) paneOpenError.value = 'The plugin is running, but its Chat pane could not be opened. Select it from the sidebar.';
    } finally {
        openingPane = false;
    }
}

const candidateKey = (candidate: Candidate): string => `${candidate.runId}:${candidate.generation}:${candidate.packageDigest}`;
const request = async <T,>(url: string, init: Record<string, unknown> = {}): Promise<T> =>
    (await ($fetch as unknown as (input: string, options: Record<string, unknown>) => Promise<unknown>)(url, {
        credentials: 'include', cache: 'no-store', ...init,
    })) as T;

async function latest(): Promise<Status> {
    return request<Status>('/api/admin/plugins/development/watch');
}

async function assertLatest(candidate: Candidate, targetWorkspace: string): Promise<void> {
    const now = await latest();
    if (!now.candidate || candidateKey(now.candidate) !== candidateKey(candidate) ||
        workspaceId.value !== targetWorkspace) throw new Error('A newer edit or workspace change is ready.');
}

async function admit(candidate: Candidate, targetWorkspace: string, approval: Review | null): Promise<{
    ok: boolean; stage?: string; codes?: readonly string[];
    requestedGrants?: readonly string[]; authoritySha256?: string; packageDigest?: string;
}> {
    const base = `/api/admin/plugins/development/watch/${encodeURIComponent(candidate.runId)}/${candidate.generation}`;
    const names = ['package.zip', 'source.zip', 'receipt.json'] as const;
    const artifacts = await Promise.all(names.map((name) => request<Blob>(`${base}/${name}`, { responseType: 'blob' })));
    await assertLatest(candidate, targetWorkspace);
    const form = new FormData();
    names.forEach((name, index) => form.append(name.split('.')[0]!, artifacts[index]!, name));
    form.append('workspaceId', targetWorkspace);
    if (approval) {
        form.append('approvedGrants', JSON.stringify(approval.requestedGrants));
        form.append('expectedPackageDigest', approval.packageDigest);
        form.append('expectedAuthoritySha256', approval.authoritySha256);
    }
    return request('/api/admin/plugins/development/admit', {
        method: 'POST', headers: { ...ADMIN_HEADERS }, body: form,
    });
}

async function observe(candidate: Candidate): Promise<boolean> {
    requestWorkspacePluginReconcile('manifest-revision-change');
    for (let attempt = 0; attempt < 30 && !stopped; attempt++) {
        const source = getPortableClientSource(candidate.pluginId);
        if (source?.descriptor.artifact.packageDigest === candidate.packageDigest) {
            const activation = await ensurePortableClientActivation(candidate.pluginId);
            if (activation?.status === 'active' && activation.packageDigest === candidate.packageDigest) {
                runningDigest.value = candidate.packageDigest;
                phase.value = 'running';
                detail.value = 'Your saved plugin is running.';
                void showPluginInChat(candidate.pluginId);
                return true;
            }
            if (activation?.status === 'blocked') {
                phase.value = 'needs attention';
                detail.value = activation.blockMessage ?? activation.blockCode ?? 'The plugin could not start.';
                return false;
            }
        }
        await new Promise((done) => setTimeout(done, 100));
    }
    phase.value = 'needs attention';
    detail.value = 'The package was selected, but its worker did not become active. Check plugin diagnostics.';
    return false;
}

async function finishSelected(candidate: Candidate, key: string): Promise<void> {
    if (!await observe(candidate)) {
        attentionKey.value = key;
        return;
    }
    try {
        await request('/api/admin/plugins/development/cleanup', {
            method: 'POST', headers: { ...ADMIN_HEADERS },
            body: { pluginId: candidate.pluginId, selectedDigest: candidate.packageDigest },
        });
        cleanupBlocked.value = null;
        if (attentionKey.value === key) attentionKey.value = null;
    } catch (error) {
        cleanupBlocked.value = candidate;
        attentionKey.value = key;
        phase.value = 'needs attention';
        detail.value = `The plugin is running, but old package cleanup failed: ${error instanceof Error ? error.message : String(error)}. Retry to clean up.`;
    }
}

async function apply(candidate: Candidate, targetWorkspace: string): Promise<void> {
    const key = candidateKey(candidate);
    try {
        await assertLatest(candidate, targetWorkspace);
        const current = await latest();
        if (current.selectedDigest === candidate.packageDigest) {
            await finishSelected(candidate, key);
            return;
        }
        phase.value = 'checking';
        detail.value = 'Checking the saved plugin in the local host…';
        const reviewForBytes = approved.value && review.value?.key === key &&
            review.value.workspaceId === targetWorkspace && review.value.reviewerId === reviewerId.value
            ? review.value : null;
        const admission = await admit(candidate, targetWorkspace, reviewForBytes);
        if (!admission.ok) {
            if (admission.stage === 'grants' && admission.requestedGrants && admission.authoritySha256 && admission.packageDigest) {
                review.value = {
                    key, workspaceId: targetWorkspace, reviewerId: reviewerId.value,
                    requestedGrants: admission.requestedGrants,
                    authoritySha256: admission.authoritySha256, packageDigest: admission.packageDigest,
                };
                dismissed.value = false;
                approved.value = false;
                phase.value = 'needs attention';
                detail.value = 'Review the permissions requested by this edit.';
            } else {
                phase.value = 'needs attention';
                detail.value = `Admission blocked at ${admission.stage ?? 'review'}: ${(admission.codes ?? []).join(', ') || 'see Admin → Plugins'}.`;
            }
            attentionKey.value = key;
            return;
        }
        review.value = null;
        approved.value = false;
        await assertLatest(candidate, targetWorkspace);
        const passed = await canary.runBrowserCheck(candidate.pluginId, targetWorkspace, true);
        if (!passed) {
            phase.value = 'needs attention';
            detail.value = canary.notes.value[candidate.pluginId] ?? 'Browser check did not pass.';
            attentionKey.value = key;
            return;
        }
        await assertLatest(candidate, targetWorkspace);
        const promoted = await request<{ ok: boolean; status: string }>(
            `/api/admin/plugins/packages/${encodeURIComponent(candidate.pluginId)}/promote`,
            { method: 'POST', headers: { ...ADMIN_HEADERS }, body: { workspaceId: targetWorkspace, candidateDigest: candidate.packageDigest } },
        );
        if (!promoted.ok) throw new Error(`Promotion was ${promoted.status}. Open Admin → Plugins for details.`);
        await finishSelected(candidate, key);
    } catch (error) {
        if (stopped) return;
        const message = error instanceof Error ? error.message : String(error);
        if (/newer edit or workspace change/i.test(message)) return;
        // A timed-out promotion can have committed on the host. Read the
        // pointer before offering a retry that would duplicate the mutation.
        const committed = await latest().then((state) => state.selectedDigest === candidate.packageDigest, () => false);
        if (committed) {
            await finishSelected(candidate, key);
            return;
        }
        if (/401|403|Unauthorized|Forbidden/.test(message)) {
            phase.value = 'needs attention';
            detail.value = 'Your session expired. Sign in again to continue.';
        } else {
            phase.value = 'needs attention';
            detail.value = message;
        }
        attentionKey.value = key;
    }
}

async function poll(): Promise<void> {
    if (stopped) return;
    try {
        const current = await latest();
        connected.value = true;
        needsSignIn.value = false;
        if (review.value && (review.value.workspaceId !== workspaceId.value ||
            review.value.reviewerId !== reviewerId.value)) {
            review.value = null;
            approved.value = false;
            attentionKey.value = null;
        }
        if (cleanupBlocked.value && cleanupBlocked.value.runId !== current.runId) {
            cleanupBlocked.value = null;
            attentionKey.value = null;
        }
        const candidate = current.candidate;
        if (cleanupBlocked.value) {
            // A failed cleanup is retried explicitly before admitting more
            // bytes; the selected package and its preview remain available.
        } else if (!candidate) {
            if (current.lastGood && current.selectedDigest === current.lastGood.packageDigest &&
                runningDigest.value !== current.lastGood.packageDigest && workspaceId.value) {
                await observe(current.lastGood);
            }
            phase.value = current.state === 'error' ? 'needs attention' : current.state;
            detail.value = current.message ?? (current.state === 'building' ? 'Building your plugin…' : 'Waiting for a build…');
        } else if (workspaceId.value && attentionKey.value !== candidateKey(candidate) &&
            (runningDigest.value !== candidate.packageDigest || getPortableActivation(candidate.pluginId)?.status !== 'active')) {
            if (!navigator.locks) {
                phase.value = 'needs attention';
                detail.value = 'This browser does not support the local development controller.';
            } else {
                await navigator.locks.request(`or3-plugin-dev:${candidate.pluginId}`, { ifAvailable: true }, async (lock) => {
                    controller.value = Boolean(lock);
                    if (lock) await apply(candidate, workspaceId.value!);
                });
            }
        } else if (candidate && attentionKey.value !== candidateKey(candidate) &&
            current.selectedDigest === candidate.packageDigest &&
            runningDigest.value === candidate.packageDigest) {
            phase.value = 'running';
            detail.value = 'Your saved plugin is running.';
        }
        if (review.value && (!candidate || review.value.key !== candidateKey(candidate))) {
            review.value = null;
            approved.value = false;
            attentionKey.value = null;
        }
    } catch (error) {
        connected.value = false;
        const message = error instanceof Error ? error.message : 'The local host is unavailable.';
        needsSignIn.value = /401|403|Unauthorized|Forbidden/i.test(message);
        phase.value = needsSignIn.value ? 'needs attention' : 'disconnected';
        detail.value = needsSignIn.value ? 'Your session expired. Sign in again to continue.' : message;
    } finally {
        if (!stopped) timer = setTimeout(() => void poll(), connected.value ? 500 : 2000);
    }
}

function approve(): void {
    if (!review.value || review.value.workspaceId !== workspaceId.value ||
        review.value.reviewerId !== reviewerId.value) return;
    approved.value = true;
    attentionKey.value = null;
    phase.value = 'checking';
    detail.value = 'Applying approved permissions…';
}

function retry(): void {
    if (cleanupBlocked.value) {
        const candidate = cleanupBlocked.value;
        void finishSelected(candidate, candidateKey(candidate));
        return;
    }
    attentionKey.value = null;
}

onMounted(async () => {
    await session.refresh().catch(() => null);
    sessionLoaded.value = true;
    void poll();
});
onBeforeUnmount(() => { stopped = true; if (timer) clearTimeout(timer); });
</script>

<template>
    <div role="status" aria-live="polite" class="sr-only">Plugin development · {{ phase }}. {{ detail }}</div>
    <div v-if="showPanel && !dismissed" class="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-3 shadow-lg" style="height: fit-content; max-height: 60vh">
        <div class="flex items-start justify-between gap-2">
            <strong class="capitalize">Plugin development · {{ phase }}</strong>
            <button type="button" class="text-lg leading-none opacity-70 hover:opacity-100" aria-label="Dismiss plugin development status" @click="dismissed = true">×</button>
        </div>
        <p class="mt-1 text-sm">{{ detail }}</p>
        <p v-if="paneOpenError" class="mt-1 text-sm">{{ paneOpenError }}</p>
        <p v-if="!controller" class="mt-1 text-xs opacity-70">Another tab is updating this plugin.</p>
        <div v-if="review" class="mt-3 border-t border-[var(--md-outline-variant)] pt-3">
            <h2 class="font-medium">Approve plugin permissions</h2>
            <p class="text-xs opacity-70">For this package and workspace only.</p>
            <ul class="my-2 list-disc pl-5 text-sm"><li v-for="grant in review.requestedGrants" :key="grant">{{ grant }}</li></ul>
            <UButton size="sm" @click="approve">Approve these permissions</UButton>
        </div>
        <div v-if="phase === 'needs attention' && !review" class="mt-2 flex gap-2">
            <UButton v-if="needsSignIn" size="sm" to="/admin/login?next=/chat">Sign in again</UButton>
            <template v-else>
                <UButton size="sm" @click="retry">Retry</UButton>
                <UButton size="sm" variant="soft" to="/admin/plugins">Open plugin controls</UButton>
            </template>
        </div>
        <div v-if="!workspaceId" class="mt-2 text-sm">
            Sign in to the local Chat account to create your development workspace.
            <UButton size="sm" to="/admin/login?next=/chat">Sign in</UButton>
        </div>
    </div>
    <button v-else-if="showPanel" type="button" class="fixed bottom-4 right-4 z-50 rounded-full border border-[var(--md-outline-variant)] bg-[var(--md-surface)] px-3 py-2 text-sm shadow-lg" @click="dismissed = false">Plugin needs attention</button>
</template>
