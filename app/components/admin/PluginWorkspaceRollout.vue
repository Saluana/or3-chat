<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from '#imports';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import { requestWorkspacePluginReconcile } from '~/composables/plugins/bundled-v1-manager-runtime';

const props = defineProps<{ pluginId: string; version: string | null }>();
type Workspace = { id: string; name: string; ownerEmail?: string };
type Outcome = { state: string; code?: string; message?: string; reason?: string };
type Operation = {
    id: string; revision: number; pluginId: string; status: 'preview' | 'running' | 'completed' | 'cancelled' | 'blocked';
    packageDigest: string; enabled: boolean; selection: string; includeFutureWorkspaces: boolean;
    futureDefaultApplied: boolean; total: number; filteredTotal: number; alreadyEnabled: number; toChange: number; previouslyDisabled: number;
    previewBlocked: number; permissionReviewsNeeded: number;
    counts: Record<string, number>; page: number; items: { workspaceId: string; outcome: Outcome }[];
};
type Release = { version: string; packageDigest: string; trust: string; requestedGrants: string[]; authority: {
    destinations?: { host: string; methods: string[]; pathPrefixes: string[]; connection?: string }[];
    dataScopes?: string[]; connectionScopes?: string[]; writes?: string[]; setupHooks?: string[];
    features?: string[]; dependencies?: string[]; engines?: string[];
} | null };

const route = useRoute();
const router = useRouter();
const scope = ref<'selected' | 'all-existing' | 'new-only'>('selected');
const enabled = ref(true);
const includeFuture = ref(false);
const search = ref('');
const workspacePage = ref(1);
const workspaceTotal = ref(0);
const workspaces = ref<Workspace[]>([]);
const selectedIds = ref<Set<string>>(new Set());
const operation = ref<Operation | null>(null);
const problemOnly = ref(false);
const release = ref<Release | null>(null);
const busy = ref(false);
const running = ref(false);
const error = ref<string | null>(null);
const awaitingRevision = ref<number | null>(null);
let mounted = true;
let activeBatch: Promise<boolean> | null = null;

async function loadWorkspaces() {
    try {
        const result = await $fetch<{ items: Workspace[]; total: number }>('/api/admin/plugins/rollouts/workspaces', {
            query: { search: search.value.trim(), page: workspacePage.value },
        });
        workspaces.value = result.items;
        workspaceTotal.value = result.total;
    } catch (caught) { error.value = parseErrorMessage(caught, 'Could not list workspaces'); }
}
function changeWorkspacePage(delta: number) { workspacePage.value += delta; void loadWorkspaces(); }
function searchWorkspaces() { workspacePage.value = 1; void loadWorkspaces(); }
function selectWorkspace(id: string, selected: boolean) {
    const next = new Set(selectedIds.value);
    if (selected) next.add(id); else next.delete(id);
    selectedIds.value = next;
}
async function loadOperation(id: string, page = 1) {
    const response = await $fetch<{ operation: Operation; release: Release | null; mutation?: { processing: boolean; failure: string | null } | null }>(`/api/admin/plugins/rollouts/${encodeURIComponent(id)}`, { query: { page, filter: problemOnly.value ? 'problems' : 'all' } });
    if (response.operation.pluginId !== props.pluginId) throw new Error('This rollout belongs to another plugin.');
    operation.value = response.operation;
    if (response.release) release.value = response.release;
    if (response.mutation?.failure) error.value = response.mutation.failure;
    return response.mutation;
}
async function refreshProgress() {
    if (!operation.value) return;
    try {
        const mutation = await loadOperation(operation.value.id, operation.value.page);
        if (awaitingRevision.value === operation.value.revision && mutation?.processing) {
            error.value = 'The provider is still applying the last request. Refresh progress again before continuing.';
        } else {
            awaitingRevision.value = null;
            error.value = mutation?.failure ?? null;
        }
    } catch (caught) { error.value = parseErrorMessage(caught, 'Could not refresh rollout progress'); }
}
async function resetOperation() {
    running.value = false;
    await activeBatch?.catch(() => undefined);
    operation.value = null;
    awaitingRevision.value = null;
    problemOnly.value = false;
    release.value = null;
    const query = { ...route.query };
    delete query.rollout;
    await router.replace({ query });
}
async function saveOperationLink(id: string) {
    await router.replace({ query: { ...route.query, plugin: props.pluginId, rollout: id } });
}
async function preview() {
    if (busy.value) return;
    error.value = null;
    if (scope.value === 'selected' && selectedIds.value.size === 0) {
        error.value = 'Select at least one workspace, or choose All existing or New workspaces only.';
        return;
    }
    busy.value = true;
    try {
        const response = await $fetch<{ preview: Operation; release: Release }>('/api/admin/plugins/rollouts', {
            method: 'POST', headers: ADMIN_HEADERS,
            body: { pluginId: props.pluginId,
                selection: scope.value === 'selected' ? { kind: 'selected', workspaceIds: [...selectedIds.value] } : { kind: scope.value },
                enabled: enabled.value,
                includeFutureWorkspaces: scope.value === 'new-only' || includeFuture.value },
        });
        operation.value = response.preview;
        release.value = response.release;
        await saveOperationLink(response.preview.id);
    } catch (caught) { error.value = parseErrorMessage(caught, 'Could not preview this rollout'); }
    finally { busy.value = false; }
}
async function mutate(action: 'start' | 'continue' | 'retry' | 'cancel') {
    if (!operation.value) return false;
    const requestedRevision = operation.value.revision;
    const response = await $fetch<{ operation: Operation; processing?: boolean }>(`/api/admin/plugins/rollouts/${encodeURIComponent(operation.value.id)}/${action}`, {
        method: 'POST', headers: ADMIN_HEADERS,
        body: { expectedRevision: operation.value.revision },
    });
    operation.value = response.operation;
    awaitingRevision.value = response.processing ? requestedRevision : null;
    if (problemOnly.value) await loadOperation(response.operation.id);
    if (action === 'continue') requestWorkspacePluginReconcile('local-admin-change');
    return response.processing === true;
}
function showProblems(only: boolean) {
    if (!operation.value) return;
    problemOnly.value = only;
    void loadOperation(operation.value.id, 1).catch((caught) => { error.value = parseErrorMessage(caught, 'Could not list rollout results'); });
}
async function runBatches() {
    if (!operation.value || running.value) return;
    running.value = true;
    try {
        while (mounted && running.value && operation.value?.status === 'running') {
            activeBatch = mutate('continue');
            const processing = await activeBatch;
            activeBatch = null;
            if (processing) {
                error.value = 'The provider is still applying this batch. Refresh progress before continuing or cancelling; completed work remains saved.';
                break;
            }
        }
    } catch (caught) { error.value = parseErrorMessage(caught, 'Rollout paused. Continue after checking the status.'); }
    finally { activeBatch = null; running.value = false; }
}
async function start() {
    if (!operation.value || busy.value) return;
    busy.value = true;
    error.value = null;
    try {
        if (await mutate('start')) error.value = 'The provider is still starting this rollout. Refresh progress before continuing.';
    }
    catch (caught) { error.value = parseErrorMessage(caught, 'The review changed. Preview again.'); }
    finally { busy.value = false; }
    if (!error.value && operation.value?.status === 'running') void runBatches();
}
async function retry() {
    if (!operation.value || busy.value) return;
    busy.value = true;
    try {
        if (await mutate('retry')) error.value = 'The provider is still preparing this retry. Refresh progress before continuing.';
    }
    catch (caught) { error.value = parseErrorMessage(caught, 'Could not retry failed workspaces'); }
    finally { busy.value = false; }
    if (!error.value && operation.value?.status === 'running') void runBatches();
}
async function cancel() {
    running.value = false;
    await activeBatch?.catch(() => undefined);
    if (awaitingRevision.value !== null) {
        error.value = 'The provider is still applying the current batch. Refresh progress before cancelling the remaining workspaces.';
        return;
    }
    if (!operation.value || busy.value) return;
    busy.value = true;
    try {
        if (await mutate('cancel')) error.value = 'Cancellation is waiting for the current provider write. Refresh progress to confirm which workspaces completed.';
    }
    catch (caught) { error.value = parseErrorMessage(caught, 'Could not cancel rollout'); }
    finally { busy.value = false; }
}
onMounted(() => {
    void loadWorkspaces();
    const id = route.query.rollout;
    if (typeof id === 'string') void loadOperation(id).catch((caught) => { error.value = parseErrorMessage(caught, 'Could not restore rollout'); });
});
onUnmounted(() => { mounted = false; running.value = false; });
</script>

<template>
    <section class="mt-3 min-w-0 space-y-3 rounded border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-3" aria-label="Workspace plugin rollout">
        <h4 class="font-medium">Enable or disable workspaces</h4>
        <p class="text-sm opacity-70">The selected version is shared by every workspace. This action changes workspace availability and reviewed access.</p>
        <div v-if="!operation" class="space-y-3">
            <div class="flex flex-wrap gap-3 text-sm">
                <label><input v-model="scope" type="radio" value="selected" /> Selected workspaces</label>
                <label><input v-model="scope" type="radio" value="all-existing" /> All existing workspaces</label>
                <label><input v-model="scope" type="radio" value="new-only" /> New workspaces only</label>
            </div>
            <div v-if="scope === 'selected'" class="rounded border border-[var(--md-outline-variant)] p-2">
                <div class="flex flex-wrap gap-2">
                    <UInput v-model="search" class="min-w-0 flex-1" placeholder="Search workspaces" aria-label="Search workspaces" @keyup.enter="searchWorkspaces" />
                    <UButton size="xs" @click="searchWorkspaces">Search</UButton>
                </div>
                <p class="mt-1 text-xs opacity-70">{{ selectedIds.size }} selected</p>
                <ul class="mt-2 max-h-52 space-y-1 overflow-y-auto">
                    <li v-for="workspace in workspaces" :key="workspace.id">
                        <label class="flex min-w-0 items-start gap-2 text-sm">
                            <input type="checkbox" :checked="selectedIds.has(workspace.id)" @change="selectWorkspace(workspace.id, ($event.target as HTMLInputElement).checked)" />
                            <span class="min-w-0 break-words">{{ workspace.name }} <span class="text-xs opacity-65">{{ workspace.ownerEmail || workspace.id }}</span></span>
                        </label>
                    </li>
                </ul>
                <div class="mt-2 flex items-center gap-2 text-xs">
                    <UButton size="xs" color="neutral" variant="soft" :disabled="workspacePage <= 1" @click="changeWorkspacePage(-1)">Previous</UButton>
                    <span>Page {{ workspacePage }} of {{ Math.max(1, Math.ceil(workspaceTotal / 25)) }}</span>
                    <UButton size="xs" color="neutral" variant="soft" :disabled="workspacePage >= Math.ceil(workspaceTotal / 25)" @click="changeWorkspacePage(1)">Next</UButton>
                </div>
            </div>
            <label class="flex items-center gap-2 text-sm"><input v-model="enabled" type="checkbox" /> Enable plugin in chosen workspaces</label>
            <label v-if="scope !== 'new-only'" class="flex items-center gap-2 text-sm"><input v-model="includeFuture" type="checkbox" /> Also make this the default for new workspaces</label>
            <UButton size="sm" :loading="busy" @click="preview">Preview impact</UButton>
        </div>
        <div v-else class="space-y-2 text-sm">
            <div class="font-medium">{{ operation.status === 'preview' ? 'Review rollout' : 'Rollout progress' }} · {{ version ?? 'selected version' }}</div>
            <p>{{ operation.total }} existing workspaces targeted · {{ operation.alreadyEnabled }} already enabled · {{ operation.toChange }} will change · {{ operation.previouslyDisabled }} previously disabled · {{ operation.previewBlocked }} need setup · {{ operation.permissionReviewsNeeded }} need permission records.</p>
            <p>Future workspace default: {{ operation.includeFutureWorkspaces ? operation.futureDefaultApplied ? 'saved' : 'will change when applied' : 'unchanged' }}.</p>
            <div v-if="release && operation.status === 'preview'" class="rounded bg-[var(--md-surface-container-low)] p-2">
                <p>Release {{ release.version }} · Trust: {{ release.trust }}.</p>
                <p>Permissions: {{ release.requestedGrants.join(', ') || 'none' }}.</p>
                <p>Network destinations: {{ release.authority?.destinations?.length ?? 0 }}.</p>
                <ul v-if="release.authority?.destinations?.length" class="ml-4 list-disc space-y-1 break-words">
                    <li v-for="(destination, index) in release.authority.destinations" :key="index">{{ destination.host }} · {{ destination.methods.join(', ') || 'any method' }} · {{ destination.pathPrefixes.join(', ') || 'all paths' }}<span v-if="destination.connection"> · connection {{ destination.connection }}</span></li>
                </ul>
                <p>Data scopes: {{ release.authority?.dataScopes?.join(', ') || 'none' }}.</p>
                <p>Connection scopes: {{ release.authority?.connectionScopes?.join(', ') || 'none' }}.</p>
                <p>Writes: {{ release.authority?.writes?.join(', ') || 'none' }}.</p>
                <p>Setup hooks: {{ release.authority?.setupHooks?.join(', ') || 'none' }}.</p>
                <p>Features: {{ release.authority?.features?.join(', ') || 'none' }} · Engines: {{ release.authority?.engines?.join(', ') || 'none' }} · Dependencies: {{ release.authority?.dependencies?.join(', ') || 'none' }}.</p>
                <p v-if="operation.permissionReviewsNeeded">{{ operation.permissionReviewsNeeded }} workspace(s) have older or missing permission reviews. Each workspace is rechecked before enablement.</p>
                <details class="mt-1 text-xs"><summary>Technical identity</summary><p class="break-all">{{ release.packageDigest }}</p></details>
            </div>
            <p v-if="operation.status === 'preview'" class="text-xs opacity-70">Applying records this permission review only for the chosen workspaces. Workspaces needing setup stay disabled.</p>
            <p v-if="operation.status !== 'preview'">Applied {{ (operation.counts.applied || 0) + (operation.counts['already-applied'] || 0) }} · Pending {{ operation.counts.pending || 0 }} · Blocked {{ operation.counts.blocked || 0 }} · Failed {{ operation.counts.failed || 0 }} · Skipped {{ operation.counts.skipped || 0 }}.</p>
            <p v-if="operation.status === 'cancelled' && operation.futureDefaultApplied" class="text-xs">Cancellation kept the future default already saved. Change it with a new rollout.</p>
            <div v-if="operation.status !== 'preview' && (operation.counts.blocked || operation.counts.failed)" class="flex gap-2">
                <UButton size="xs" color="neutral" :variant="problemOnly ? 'soft' : 'ghost'" @click="showProblems(true)">Show blocked and failed ({{ (operation.counts.blocked || 0) + (operation.counts.failed || 0) }})</UButton>
                <UButton v-if="problemOnly" size="xs" color="neutral" variant="ghost" @click="showProblems(false)">Show all results</UButton>
            </div>
            <ul v-if="operation.status !== 'preview'" class="max-h-48 space-y-1 overflow-y-auto text-xs">
                <li v-for="target in operation.items.filter((item) => item.outcome.state === 'blocked' || item.outcome.state === 'failed')" :key="target.workspaceId" class="break-words">
                    <UButton size="xs" color="neutral" variant="link" :to="`/admin/workspaces/${encodeURIComponent(target.workspaceId)}`">{{ target.workspaceId }}</UButton>: {{ target.outcome.message || target.outcome.code }}
                </li>
            </ul>
            <div v-if="operation.filteredTotal > 25" class="flex items-center gap-2 text-xs">
                <UButton size="xs" color="neutral" variant="soft" :disabled="operation.page <= 1" @click="loadOperation(operation.id, operation.page - 1)">Previous results</UButton>
                <span>Page {{ operation.page }} of {{ Math.ceil(operation.filteredTotal / 25) }}</span>
                <UButton size="xs" color="neutral" variant="soft" :disabled="operation.page >= Math.ceil(operation.filteredTotal / 25)" @click="loadOperation(operation.id, operation.page + 1)">Next results</UButton>
            </div>
            <div class="flex flex-wrap gap-2">
                <UButton size="sm" color="neutral" variant="soft" @click="refreshProgress">Refresh progress</UButton>
                <UButton v-if="operation.status === 'preview'" size="sm" :disabled="!release || awaitingRevision !== null" :loading="busy" @click="start">Apply reviewed rollout</UButton>
                <UButton v-if="operation.status === 'running' && !running" size="sm" :disabled="awaitingRevision !== null" :loading="busy" @click="runBatches">Continue</UButton>
                <UButton v-if="(operation.counts.blocked || operation.counts.failed) && operation.status !== 'running'" size="sm" color="neutral" variant="soft" :disabled="awaitingRevision !== null" :loading="busy" @click="retry">Retry unresolved</UButton>
                <UButton v-if="operation.status === 'preview' || operation.status === 'running'" size="sm" color="neutral" variant="soft" :disabled="awaitingRevision !== null" :loading="busy" @click="cancel">Cancel remaining</UButton>
                <UButton size="sm" color="neutral" variant="ghost" @click="resetOperation">New rollout</UButton>
            </div>
        </div>
        <p v-if="error" role="alert" class="text-sm text-[var(--md-sys-color-error,#b91c1c)] break-words">{{ error }}</p>
    </section>
</template>
