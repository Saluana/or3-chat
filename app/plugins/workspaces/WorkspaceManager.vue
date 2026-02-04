<template>
    <div class="p-6 space-y-6">
        <header class="space-y-1">
            <h2 class="text-lg font-semibold">Workspaces</h2>
            <p class="text-sm opacity-70">
                Select the active workspace or update its details.
            </p>
        </header>

        <section class="section-card space-y-4">
            <div class="flex items-center justify-between gap-3">
                <h3 class="text-sm font-semibold">Create workspace</h3>
                <UButton
                    size="sm"
                    variant="outline"
                    class="whitespace-nowrap shrink-0"
                    :loading="creating"
                    :disabled="!createName.trim()"
                    @click="createWorkspace"
                >
                    Create
                </UButton>
            </div>
            <div class="flex flex-col gap-3">
                <UInput
                    v-model="createName"
                    placeholder="Workspace name"
                    aria-label="Workspace name"
                    class="w-full"
                />
                <UTextarea
                    v-model="createDescription"
                    placeholder="Workspace description (optional)"
                    aria-label="Workspace description"
                    :rows="2"
                    autoresize
                    class="w-full"
                />
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-semibold">On sign out</label>
                    <USelectMenu
                        v-model="createLogoutPolicy"
                        :items="logoutPolicyItems"
                        :value-key="'value'"
                        :label-key="'label'"
                        size="sm"
                        class="w-full"
                        v-bind="logoutPolicySelectProps"
                    />
                    <p class="text-[11px] opacity-70">
                        Choose whether this workspace stays on this device after you sign out.
                    </p>
                </div>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3 text-xs opacity-70">
                <span>
                    Legacy data: {{ legacyStats.threads }} threads,
                    {{ legacyStats.messages }} messages,
                    {{ legacyStats.projects }} projects
                </span>
                <UButton
                    size="sm"
                    variant="outline"
                    class="whitespace-nowrap shrink-0"
                    :loading="importing"
                    :disabled="!legacyHasData"
                    @click="importLocalData"
                >
                    Import local data
                </UButton>
            </div>
        </section>

        <section class="section-card space-y-4">
            <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold">Your workspaces</h3>
                <span v-if="isPending" class="text-xs opacity-60">Loading...</span>
            </div>

            <div v-if="displayWorkspaces.length === 0" class="text-sm opacity-70">
                No workspaces yet. Create one to get started.
            </div>

            <div class="space-y-3" v-else>
                <div
                    v-for="workspace in displayWorkspaces"
                    :key="workspace.id"
                    class="rounded-md border border-[var(--md-outline-variant)] p-4 space-y-3"
                >
                    <div class="flex flex-wrap items-start justify-between gap-4">
                        <div class="space-y-1">
                            <div class="flex items-center gap-2">
                                <h4 class="text-sm font-semibold">
                                    {{ workspace.name }}
                                </h4>
                                <span
                                    v-if="workspace.isActive"
                                    class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--md-surface-container-high)]"
                                >
                                    Active
                                </span>
                            </div>
                            <p class="text-xs opacity-70">
                                {{ workspace.description || 'No description yet.' }}
                            </p>
                            <p class="text-[11px] opacity-60">
                                Role: {{ workspace.role }}
                            </p>
                            <p class="text-[11px] opacity-60">
                                On sign out:
                                <span class="font-medium">
                                    {{ formatLogoutPolicy(workspacePolicies[workspace.id]) }}
                                </span>
                            </p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <UButton
                                size="sm"
                                class="whitespace-nowrap shrink-0"
                                :variant="workspace.isActive ? 'solid' : 'outline'"
                                :disabled="workspace.isActive || selecting"
                                @click="selectWorkspace(workspace)"
                            >
                                {{ workspace.isActive ? 'Active' : 'Select' }}
                            </UButton>
                            <UButton
                                size="sm"
                                class="whitespace-nowrap shrink-0"
                                variant="outline"
                                :disabled="editingWorkspaceId === workspace.id"
                                @click="startEdit(workspace)"
                            >
                                Edit
                            </UButton>
                            <UButton
                                size="sm"
                                class="whitespace-nowrap shrink-0"
                                variant="outline"
                                color="error"
                                :disabled="deletingWorkspaceId === workspace.id"
                                @click="deleteWorkspace(workspace)"
                            >
                                Delete
                            </UButton>
                        </div>
                    </div>

                    <div v-if="editingWorkspaceId === workspace.id" class="flex flex-col gap-3">
                        <UInput v-model="editName" placeholder="Workspace name" class="w-full" />
                        <UTextarea
                            v-model="editDescription"
                            placeholder="Workspace description (optional)"
                            :rows="2"
                            autoresize
                            class="w-full"
                        />
                        <div class="flex flex-col gap-1">
                            <label class="text-xs font-semibold">On sign out</label>
                            <USelectMenu
                                v-model="editLogoutPolicy"
                                :items="logoutPolicyItems"
                                :value-key="'value'"
                                :label-key="'label'"
                                size="sm"
                                class="w-full"
                                v-bind="logoutPolicySelectProps"
                            />
                            <p class="text-[11px] opacity-70">
                                Keep or clear this workspace on this device after you sign out.
                            </p>
                        </div>
                        <div class="flex gap-2">
                            <UButton
                                size="sm"
                                class="whitespace-nowrap shrink-0"
                                :loading="saving"
                                :disabled="!editName.trim()"
                                @click="saveEdit(workspace)"
                            >
                                Save
                            </UButton>
                            <UButton
                                size="sm"
                                class="whitespace-nowrap shrink-0"
                                variant="outline"
                                @click="cancelEdit"
                            >
                                Cancel
                            </UButton>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
    getActiveWorkspaceId,
    getDefaultDb,
    getWorkspaceDb,
} from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useWorkspaceApi } from '~/composables/workspace/useWorkspaceApi';
import type { WorkspaceSummary } from '~/core/workspaces/types';

const toast = useToast();
const baseDb = getDefaultDb();
const cacheKey = 'workspace.manager.cache';
const logoutPolicyPrefix = 'workspace.logout.policy.';

async function fetchWorkspaces() {
    isPending.value = true;
    try {
        workspaces.value = await workspaceApi.list();
    } catch (error) {
        console.error('[workspace-manager] Failed to load workspaces:', error);
        toast.add({
            title: 'Failed to load workspaces',
            color: 'error',
        });
    } finally {
        isPending.value = false;
    }
}

const createName = ref('');
const createDescription = ref('');
const creating = ref(false);
const selecting = ref(false);
const saving = ref(false);
const deletingWorkspaceId = ref<Id<'workspaces'> | null>(null);
type LogoutPolicy = 'keep' | 'clear';
const createLogoutPolicy = ref<LogoutPolicy>('keep');
const editLogoutPolicy = ref<LogoutPolicy>('keep');
const workspacePolicies = ref<Record<string, LogoutPolicy>>({});
const logoutPolicyItems: Array<{ label: string; value: LogoutPolicy }> = [
    { label: 'Keep on this device', value: 'keep' },
    { label: 'Clear from this device', value: 'clear' },
];

const logoutPolicySelectProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'selectmenu',
        context: 'dashboard',
        identifier: 'dashboard.workspace.logout-policy',
        isNuxtUI: true,
    });
    const overrideValue: Record<string, unknown> = overrides.value || {};
    const mergedClass = ['w-full', overrideValue.class || '']
        .filter(Boolean)
        .join(' ');
    return {
        ...overrideValue,
        class: mergedClass,
    };
});

const workspaceApi = useWorkspaceApi();
const workspaces = ref<WorkspaceSummary[]>([]);
const isPending = ref(false);
const cachedWorkspaces = ref<WorkspaceSummary[]>([]);
const cachedActiveId = ref<string | null>(null);
const legacyStats = ref({ threads: 0, messages: 0, projects: 0 });
const importing = ref(false);

const sessionContext = useSessionContext();
const activeWorkspaceId = computed(
    () => sessionContext.data.value?.session?.workspace?.id ?? null
);

async function refreshSessionUntilWorkspace(workspaceId: string): Promise<boolean> {
    // Keep this tight: we just need to beat eventual consistency + any client caches.
    // The server endpoint is now `no-store`, but retries handle backend propagation.
    const delaysMs = [0, 100, 200, 400, 800];
    for (const delay of delaysMs) {
        if (delay) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        await sessionContext.refresh();
        const current = sessionContext.data.value?.session?.workspace?.id ?? null;
        if (current === workspaceId) return true;
    }
    return false;
}

const legacyHasData = computed(
    () =>
        legacyStats.value.threads > 0 ||
        legacyStats.value.messages > 0 ||
        legacyStats.value.projects > 0
);

const displayWorkspaces = computed(() => {
    const source =
        workspaces.value && workspaces.value.length > 0
            ? workspaces.value
            : cachedWorkspaces.value;
    return source.map((workspace) => ({
        ...workspace,
        isActive: workspace.id === activeWorkspaceId.value,
    }));
});

async function loadCache() {
    const cached = await getKvByName(cacheKey, baseDb);
    if (!cached?.value) return;
    try {
        const parsed = JSON.parse(cached.value) as {
            workspaces?: WorkspaceSummary[];
            activeId?: string | null;
        };
        cachedActiveId.value = parsed.activeId ?? null;
        cachedWorkspaces.value = (parsed.workspaces ?? []).map((workspace) => ({
            ...workspace,
            isActive: workspace.id === cachedActiveId.value,
        }));
    } catch {
        cachedWorkspaces.value = [];
        cachedActiveId.value = null;
    }
}

async function saveCache(list: WorkspaceSummary[]) {
    const activeId = list.find((ws) => ws.isActive)?.id ?? cachedActiveId.value;
    cachedActiveId.value = activeId ?? null;
    await setKvByName(
        cacheKey,
        JSON.stringify({ workspaces: list, activeId: cachedActiveId.value }),
        baseDb
    );
}

async function loadLegacyStats() {
    try {
        legacyStats.value = {
            threads: await baseDb.threads.count(),
            messages: await baseDb.messages.count(),
            projects: await baseDb.projects.count(),
        };
    } catch {
        legacyStats.value = { threads: 0, messages: 0, projects: 0 };
    }
}

async function importLocalData() {
    const activeWorkspaceId = getActiveWorkspaceId() ?? cachedActiveId.value;
    if (!activeWorkspaceId) {
        toast.add({
            title: 'Select a workspace',
            description: 'Choose a workspace before importing local data.',
            color: 'error',
        });
        return;
    }

    const confirmed = window.confirm(
        'Import data from the local workspace into the active workspace?'
    );
    if (!confirmed) return;

    importing.value = true;
    try {
        const targetDb = getWorkspaceDb(activeWorkspaceId);
        
        // Define tables with their types
        const tableDefinitions = {
            projects: targetDb.projects,
            threads: targetDb.threads,
            messages: targetDb.messages,
            kv: targetDb.kv,
            attachments: targetDb.attachments,
            file_meta: targetDb.file_meta,
            file_blobs: targetDb.file_blobs,
            posts: targetDb.posts,
        } as const;

        // Wrap entire import in a single transaction for atomicity
        await targetDb.transaction(
            'rw',
            Object.values(tableDefinitions),
            async () => {
                
                async function copyTable<T>(
                    tableName: string,
                    sourceTable: { toArray: () => Promise<T[]> },
                    targetTable: { bulkPut: (items: readonly T[]) => Promise<any> }
                ) {
                    const sourceRows = await sourceTable.toArray();
                    if (sourceRows.length === 0) return;
                    await targetTable.bulkPut(sourceRows);
                    console.log(`[import] Copied ${sourceRows.length} rows from ${tableName}`);
                }

                await copyTable('projects', baseDb.projects, targetDb.projects);
                await copyTable('threads', baseDb.threads, targetDb.threads);
                await copyTable('messages', baseDb.messages, targetDb.messages);
                await copyTable('kv', baseDb.kv, targetDb.kv);
                await copyTable('attachments', baseDb.attachments, targetDb.attachments);
                await copyTable('file_meta', baseDb.file_meta, targetDb.file_meta);
                await copyTable('file_blobs', baseDb.file_blobs, targetDb.file_blobs);
                await copyTable('posts', baseDb.posts, targetDb.posts);
            }
        );

        await loadLegacyStats();
        toast.add({
            title: 'Import complete',
            description: 'Local data copied into the active workspace.',
        });
    } catch (error) {
        toast.add({
            title: 'Import failed',
            description: error instanceof Error ? error.message : String(error),
            color: 'error',
        });
    } finally {
        importing.value = false;
    }
}

watch(
    workspaces,
    async (list) => {
        if (!list) return;
        cachedWorkspaces.value = list as WorkspaceSummary[];
        await saveCache(cachedWorkspaces.value);
        await loadWorkspacePolicies(cachedWorkspaces.value);
    },
    { immediate: true }
);

onMounted(async () => {
    await loadCache();
    await loadLegacyStats();
    if (cachedWorkspaces.value.length > 0) {
        await loadWorkspacePolicies(cachedWorkspaces.value);
    }
    await fetchWorkspaces();
});

watch(
    () => sessionContext.data.value?.session?.workspace?.id,
    async () => {
        await fetchWorkspaces();
    }
);

const editingWorkspaceId = ref<string | null>(null);
const editName = ref('');
const editDescription = ref('');

function startEdit(workspace: WorkspaceSummary) {
    editingWorkspaceId.value = workspace.id;
    editName.value = workspace.name;
    editDescription.value = workspace.description ?? '';
    editLogoutPolicy.value = workspacePolicies.value[workspace.id] ?? 'keep';
}

function cancelEdit() {
    editingWorkspaceId.value = null;
    editName.value = '';
    editDescription.value = '';
}

function formatLogoutPolicy(policy: LogoutPolicy | undefined) {
    return policy === 'clear' ? 'Clear from this device' : 'Keep on this device';
}

async function loadWorkspacePolicies(list: WorkspaceSummary[]) {
    const entries = await Promise.all(
        list.map(async (workspace) => {
            const res = await getKvByName(`${logoutPolicyPrefix}${workspace.id}`, baseDb);
            const value = res?.value === 'clear' ? 'clear' : 'keep';
            return [workspace.id, value] as const;
        })
    );
    workspacePolicies.value = Object.fromEntries(entries);
}

async function saveWorkspacePolicy(workspaceId: string, policy: LogoutPolicy) {
    await setKvByName(`${logoutPolicyPrefix}${workspaceId}`, policy, baseDb);
    workspacePolicies.value = { ...workspacePolicies.value, [workspaceId]: policy };
}

async function createWorkspace() {
    if (!createName.value.trim()) return;
    creating.value = true;
    try {
        const { id: workspaceId } = await workspaceApi.create({
            name: createName.value.trim(),
            description: createDescription.value.trim() || undefined,
        });
        await saveWorkspacePolicy(workspaceId, createLogoutPolicy.value);
        await workspaceApi.setActive({ id: workspaceId });

        // Ensure the next reload resolves into the newly active workspace.
        await refreshSessionUntilWorkspace(workspaceId);

        // Update cache before reload so UI shows correctly immediately after
        cachedActiveId.value = workspaceId;
        await saveCache([
            ...cachedWorkspaces.value.map((ws) => ({ ...ws, isActive: false })),
            {
                id: workspaceId,
                name: createName.value.trim(),
                description: createDescription.value.trim() || null,
                role: 'owner',
                isActive: true,
            },
        ]);
        toast.add({ title: 'Workspace created', description: 'Switching to new workspace...' });
        // Full reload ensures clean Dexie DB binding and sync engine restart
        reloadNuxtApp({ ttl: 500 });
    } catch (error) {
        toast.add({
            title: 'Failed to create workspace',
            description: error instanceof Error ? error.message : String(error),
            color: 'error',
        });
    } finally {
        creating.value = false;
    }
}

async function selectWorkspace(workspace: WorkspaceSummary) {
    if (workspace.isActive) return;
    selecting.value = true;
    try {
        await workspaceApi.setActive({ id: workspace.id });

        // Ensure the next reload resolves into the selected workspace.
        await refreshSessionUntilWorkspace(workspace.id);

        // Update cache before reload
        cachedActiveId.value = workspace.id;
        cachedWorkspaces.value = cachedWorkspaces.value.map((item) => ({
            ...item,
            isActive: item.id === workspace.id,
        }));
        await saveCache(cachedWorkspaces.value);
        toast.add({ title: 'Workspace updated', description: 'Switching workspace...' });
        // Full reload ensures clean Dexie DB binding and sync engine restart
        reloadNuxtApp({ ttl: 500 });
    } catch (error) {
        toast.add({
            title: 'Failed to switch workspace',
            description: error instanceof Error ? error.message : String(error),
            color: 'error',
        });
    } finally {
        selecting.value = false;
    }
}

async function saveEdit(workspace: WorkspaceSummary) {
    if (!editName.value.trim()) return;
    saving.value = true;
    try {
        await workspaceApi.update({
            id: workspace.id,
            name: editName.value.trim(),
            description: editDescription.value.trim() || undefined,
        });
        await saveWorkspacePolicy(workspace.id, editLogoutPolicy.value);
        editingWorkspaceId.value = null;
        toast.add({ title: 'Workspace updated', description: 'Changes saved.' });
    } catch (error) {
        toast.add({
            title: 'Failed to update workspace',
            description: error instanceof Error ? error.message : String(error),
            color: 'error',
        });
    } finally {
        saving.value = false;
    }
}

async function deleteWorkspace(workspace: WorkspaceSummary) {
    if (deletingWorkspaceId.value) return;
    const confirmed = window.confirm(
        `Delete "${workspace.name}"? This removes synced data for the workspace.`
    );
    if (!confirmed) return;

    deletingWorkspaceId.value = workspace.id;
    try {
        await workspaceApi.remove({ id: workspace.id });
        await refreshNuxtData('auth-session');
        cachedWorkspaces.value = cachedWorkspaces.value.filter(
            (item) => item.id !== workspace.id
        );
        await saveCache(cachedWorkspaces.value);
        toast.add({ title: 'Workspace deleted', description: 'Workspace removed.' });
    } catch (error) {
        toast.add({
            title: 'Failed to delete workspace',
            description: error instanceof Error ? error.message : String(error),
            color: 'error',
        });
    } finally {
        deletingWorkspaceId.value = null;
    }
}
</script>
