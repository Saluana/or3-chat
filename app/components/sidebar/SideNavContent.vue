<template>
    <div class="flex flex-col h-full relative">
        <div class="px-2 pt-2 flex flex-col space-y-2">
            <div class="flex">
                <UButton
                    @click="onNewChat"
                    class="w-full flex text-[22px] items-center justify-center backdrop-blur-2xl"
                    >New Chat</UButton
                >
                <UTooltip :delay-duration="0" text="Create project">
                    <UButton
                        color="secondary"
                        class="ml-2 flex items-center justify-center backdrop-blur-2xl"
                        icon="pixelarticons:folder-plus"
                        :ui="{
                            leadingIcon: 'w-5 h-5',
                        }"
                        @click="openCreateProject"
                    />
                </UTooltip>
                <UTooltip :delay-duration="0" text="Create document">
                    <UButton
                        class="ml-2 flex items-center justify-center backdrop-blur-2xl"
                        icon="pixelarticons:note-plus"
                        :ui="{
                            base: 'bg-white text-black hover:bg-gray-100 active:bg-gray-200',
                            leadingIcon: 'w-5 h-5',
                        }"
                    />
                </UTooltip>
            </div>
            <div
                class="relative w-full ml-[1px] border-b-3 border-primary/50 pb-3"
            >
                <UInput
                    v-model="threadSearchQuery"
                    icon="pixelarticons:search"
                    size="md"
                    :ui="{
                        leadingIcon: 'h-[20px] w-[20px]',
                    }"
                    variant="outline"
                    placeholder="Search threads..."
                    class="w-full"
                >
                    <template v-if="threadSearchQuery.length > 0" #trailing>
                        <UButton
                            color="neutral"
                            variant="subtle"
                            size="xs"
                            class="flex items-center justify-center p-0"
                            icon="pixelarticons:close-box"
                            aria-label="Clear input"
                            @click="threadSearchQuery = ''"
                        /> </template
                ></UInput>
            </div>
        </div>
        <!-- Scrollable content: projects + (virtualized) threads -->
        <div
            ref="scrollAreaRef"
            class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pt-2 space-y-3 scrollbar-hidden"
            :style="{ paddingBottom: bottomPad + 'px' }"
        >
            <SidebarProjectTree
                :projects="projects"
                v-model:expanded="expandedProjects"
                @chatSelected="(id: string) => emit('chatSelected', id)"
                @addChat="handleAddChatToProject"
                @deleteProject="handleDeleteProject"
                @renameProject="openRenameProject"
                @renameEntry="openRename"
                @removeFromProject="handleRemoveFromProject"
            />
            <div>
                <h4
                    class="text-xs uppercase tracking-wide opacity-70 px-1 select-none"
                >
                    Chats
                </h4>
                <!-- Conditional virtualization: only mount VList when large -->
                <component
                    v-if="useVirtualization && VListComp"
                    :is="VListComp"
                    :data="displayThreads as any[]"
                    :overscan="8"
                    class="mt-2"
                    #default="{ item }"
                >
                    <div class="mb-2" :key="item.id">
                        <RetroGlassBtn
                            :class="{
                                'active-element bg-primary/25':
                                    item.id === props.activeThread,
                            }"
                            class="w-full flex items-center justify-between text-left"
                            @click="() => emit('chatSelected', item.id)"
                        >
                            <div
                                class="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden"
                            >
                                <UIcon
                                    v-if="item.forked"
                                    name="pixelarticons:git-branch"
                                    class="shrink-0"
                                ></UIcon>
                                <span
                                    class="block flex-1 min-w-0 truncate"
                                    :title="item.title || 'New Thread'"
                                >
                                    {{ item.title || 'New Thread' }}
                                </span>
                            </div>
                            <UPopover
                                :content="{
                                    side: 'right',
                                    align: 'start',
                                    sideOffset: 6,
                                }"
                            >
                                <span
                                    class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                                    @click.stop
                                >
                                    <UIcon
                                        name="pixelarticons:more-vertical"
                                        class="w-4 h-4 opacity-70"
                                    />
                                </span>
                                <template #content>
                                    <div class="p-1 w-44 space-y-1">
                                        <UButton
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="i-lucide-pencil"
                                            @click="openRename(item)"
                                            >Rename</UButton
                                        >
                                        <UButton
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="pixelarticons:folder-plus"
                                            @click="openAddToProject(item)"
                                            >Add to project</UButton
                                        >
                                        <UButton
                                            color="error"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="i-lucide-trash-2"
                                            @click="confirmDelete(item)"
                                            >Delete</UButton
                                        >
                                    </div>
                                </template>
                            </UPopover>
                        </RetroGlassBtn>
                    </div>
                </component>
                <!-- Fallback simple list when virtualization not needed -->
                <div v-else class="mt-2">
                    <div
                        v-for="item in displayThreads"
                        :key="item.id"
                        class="mb-2"
                    >
                        <RetroGlassBtn
                            :class="{
                                'active-element bg-primary/25':
                                    item.id === props.activeThread,
                            }"
                            class="w-full flex items-center justify-between text-left"
                            @click="() => emit('chatSelected', item.id)"
                        >
                            <div
                                class="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden"
                            >
                                <UIcon
                                    v-if="item.forked"
                                    name="pixelarticons:git-branch"
                                    class="shrink-0"
                                ></UIcon>
                                <span
                                    class="block flex-1 min-w-0 truncate"
                                    :title="item.title || 'New Thread'"
                                >
                                    {{ item.title || 'New Thread' }}
                                </span>
                            </div>
                            <UPopover
                                :content="{
                                    side: 'right',
                                    align: 'start',
                                    sideOffset: 6,
                                }"
                            >
                                <span
                                    class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                                    @click.stop
                                >
                                    <UIcon
                                        name="pixelarticons:more-vertical"
                                        class="w-4 h-4 opacity-70"
                                    />
                                </span>
                                <template #content>
                                    <div class="p-1 w-44 space-y-1">
                                        <UButton
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="i-lucide-pencil"
                                            @click="openRename(item)"
                                            >Rename</UButton
                                        >
                                        <UButton
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="pixelarticons:folder-plus"
                                            @click="openAddToProject(item)"
                                            >Add to project</UButton
                                        >
                                        <UButton
                                            color="error"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="i-lucide-trash-2"
                                            @click="confirmDelete(item)"
                                            >Delete</UButton
                                        >
                                    </div>
                                </template>
                            </UPopover>
                        </RetroGlassBtn>
                    </div>
                </div>
            </div>
        </div>
        <div ref="bottomNavRef" class="shrink-0">
            <sidebar-side-bottom-nav />
        </div>

        <!-- Rename modal -->
        <UModal
            v-model:open="showRenameModal"
            title="Rename thread"
            :ui="{
                footer: 'justify-end ',
            }"
        >
            <template #header> <h3>Rename thread?</h3> </template>
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameTitle"
                        placeholder="Thread title"
                        icon="pixelarticons:edit"
                        @keyup.enter="saveRename"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showRenameModal = false"
                    >Cancel</UButton
                >
                <UButton color="primary" @click="saveRename">Save</UButton>
            </template>
        </UModal>

        <!-- Rename Project Modal -->
        <UModal
            v-model:open="showRenameProjectModal"
            title="Rename project"
            :ui="{ footer: 'justify-end' }"
        >
            <template #header><h3>Rename project?</h3></template>
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameProjectName"
                        placeholder="Project name"
                        icon="pixelarticons:folder"
                        @keyup.enter="saveRenameProject"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showRenameProjectModal = false"
                    >Cancel</UButton
                >
                <UButton
                    color="primary"
                    :disabled="!renameProjectName.trim()"
                    @click="saveRenameProject"
                    >Save</UButton
                >
            </template>
        </UModal>

        <!-- Delete confirm modal -->
        <UModal
            v-model:open="showDeleteModal"
            title="Delete thread?"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #header> <h3>Delete thread?</h3> </template>
            <template #body>
                <p class="text-sm opacity-70">
                    This will permanently remove the thread and its messages.
                </p>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showDeleteModal = false"
                    >Cancel</UButton
                >
                <UButton color="error" @click="deleteThread">Delete</UButton>
            </template>
        </UModal>

        <!-- Create Project Modal -->
        <UModal
            v-model:open="showCreateProjectModal"
            title="New Project"
            :ui="{ footer: 'justify-end' }"
        >
            <template #header>
                <h3>Create project</h3>
            </template>
            <template #body>
                <div class="space-y-4">
                    <UForm
                        :state="createProjectState"
                        @submit.prevent="submitCreateProject"
                    >
                        <div class="flex flex-col space-y-3">
                            <UFormField
                                label="Title"
                                name="name"
                                :error="createProjectErrors.name"
                            >
                                <UInput
                                    v-model="createProjectState.name"
                                    required
                                    placeholder="Project title"
                                    icon="pixelarticons:folder"
                                    class="w-full"
                                    @keyup.enter="submitCreateProject"
                                />
                            </UFormField>
                            <UFormField label="Description" name="description">
                                <UTextarea
                                    class="w-full border-2 rounded-[6px]"
                                    v-model="createProjectState.description"
                                    :rows="3"
                                    placeholder="Optional description"
                                />
                            </UFormField>
                        </div>
                    </UForm>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="closeCreateProject"
                    >Cancel</UButton
                >
                <UButton
                    :disabled="
                        !createProjectState.name.trim() || creatingProject
                    "
                    color="primary"
                    @click="submitCreateProject"
                >
                    <span v-if="!creatingProject">Create</span>
                    <span v-else class="inline-flex items-center gap-1">
                        <UIcon name="i-lucide-loader" class="animate-spin" />
                        Creating
                    </span>
                </UButton>
            </template>
        </UModal>

        <!-- Add To Project Modal -->
        <UModal
            v-model:open="showAddToProjectModal"
            title="Add to project"
            :ui="{ footer: 'justify-end' }"
        >
            <template #header>
                <h3>Add thread to project</h3>
            </template>
            <template #body>
                <div class="space-y-4">
                    <div class="flex gap-2 text-xs font-mono">
                        <button
                            class="retro-btn px-2 py-1 rounded-[4px] border-2"
                            :class="
                                addMode === 'select'
                                    ? 'bg-primary/30'
                                    : 'opacity-70'
                            "
                            @click="addMode = 'select'"
                        >
                            Select Existing
                        </button>
                        <button
                            class="retro-btn px-2 py-1 rounded-[4px] border-2"
                            :class="
                                addMode === 'create'
                                    ? 'bg-primary/30'
                                    : 'opacity-70'
                            "
                            @click="addMode = 'create'"
                        >
                            Create New
                        </button>
                    </div>
                    <div v-if="addMode === 'select'" class="space-y-3">
                        <UFormField label="Project" name="project">
                            <USelectMenu
                                v-model="selectedProjectId"
                                :items="projectSelectOptions"
                                :value-key="'value'"
                                searchable
                                placeholder="Select project"
                                class="w-full"
                            />
                        </UFormField>
                        <p v-if="addToProjectError" class="text-error text-xs">
                            {{ addToProjectError }}
                        </p>
                    </div>
                    <div v-else class="space-y-3">
                        <UFormField label="Project Title" name="newProjectName">
                            <UInput
                                v-model="newProjectName"
                                placeholder="Project name"
                                icon="pixelarticons:folder"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Description"
                            name="newProjectDescription"
                        >
                            <UTextarea
                                v-model="newProjectDescription"
                                :rows="3"
                                placeholder="Optional description"
                                class="w-full border-2 rounded-[6px]"
                            />
                        </UFormField>
                        <p v-if="addToProjectError" class="text-error text-xs">
                            {{ addToProjectError }}
                        </p>
                    </div>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="closeAddToProject"
                    >Cancel</UButton
                >
                <UButton
                    color="primary"
                    :disabled="
                        addingToProject ||
                        (addMode === 'select'
                            ? !selectedProjectId
                            : !newProjectName.trim())
                    "
                    @click="submitAddToProject"
                >
                    <span v-if="!addingToProject">Add</span>
                    <span v-else class="inline-flex items-center gap-1"
                        ><UIcon
                            name="i-lucide-loader"
                            class="animate-spin"
                        />Adding</span
                    >
                </UButton>
            </template>
        </UModal>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed, nextTick } from 'vue';
import SidebarProjectTree from '~/components/sidebar/SidebarProjectTree.vue';
import { liveQuery } from 'dexie';
import { db, upsert, del as dbDel, create } from '~/db'; // Dexie + barrel helpers
// NOTE: Only load virtua when we actually need virtualization (perf + less layout jank)
import { shallowRef } from 'vue';
const VListComp = shallowRef<any | null>(null);

const props = defineProps<{
    activeThread?: string;
}>();

const items = ref<any[]>([]);
const projects = ref<any[]>([]);
const expandedProjects = ref<string[]>([]);
const scrollAreaRef = ref<HTMLElement | null>(null);
const bottomNavRef = ref<HTMLElement | null>(null);
// Dynamic bottom padding to avoid content hidden under absolute bottom nav
const bottomPad = ref(140); // fallback
import { useThreadSearch } from '~/composables/useThreadSearch';
const { query: threadSearchQuery, results: threadSearchResults } =
    useThreadSearch(items as any);
const displayThreads = computed(() =>
    threadSearchQuery.value.trim() ? threadSearchResults.value : items.value
);
let sub: { unsubscribe: () => void } | null = null;
let subProjects: { unsubscribe: () => void } | null = null;

// Virtualization threshold (tune): above this many threads we mount VList
const VIRTUALIZE_THRESHOLD = 250;
const useVirtualization = computed(
    () => displayThreads.value.length > VIRTUALIZE_THRESHOLD
);

onMounted(async () => {
    const measure = () => {
        const navEl = bottomNavRef.value?.querySelector(
            '.hud'
        ) as HTMLElement | null;
        const h = navEl?.offsetHeight || 0;
        bottomPad.value = h + 12; // small breathing room
    };
    await nextTick();
    measure();
    window.addEventListener('resize', measure);
    (onUnmounted as any)._measureHandler = measure;
    // Threads subscription (sorted by last opened, excluding deleted)
    sub = liveQuery(() =>
        db.threads
            .orderBy('updated_at')
            .reverse()
            .filter((t) => !t.deleted)
            .toArray()
    ).subscribe({
        next: (results) => (items.value = results),
        error: (err) => console.error('liveQuery error', err),
    });
    // Projects subscription (most recently updated first)
    subProjects = liveQuery(() =>
        db.projects
            .orderBy('updated_at')
            .reverse()
            .filter((p: any) => !p.deleted)
            .toArray()
    ).subscribe({
        next: (res) => {
            // Normalize data field (ensure array)
            projects.value = res.map((p: any) => ({
                ...p,
                data: Array.isArray(p.data)
                    ? p.data
                    : typeof p.data === 'string'
                    ? (() => {
                          try {
                              const parsed = JSON.parse(p.data);
                              return Array.isArray(parsed) ? parsed : [];
                          } catch {
                              return [];
                          }
                      })()
                    : [],
            }));
        },
        error: (err) => console.error('projects liveQuery error', err),
    });
    // Lazy import virtua only if needed initially
    if (useVirtualization.value) {
        const mod = await import('virtua/vue');
        VListComp.value = mod.VList;
    }
});

// Watch for crossing threshold (both directions)
watch(useVirtualization, async (val) => {
    if (val && !VListComp.value) {
        const mod = await import('virtua/vue');
        VListComp.value = mod.VList;
    }
});

// Re-measure bottom pad when data that can change nav size or list height updates (debounced by nextTick)
watch([projects, expandedProjects], () => {
    nextTick(() => {
        const navEl = bottomNavRef.value?.querySelector(
            '.hud'
        ) as HTMLElement | null;
        const h = navEl?.offsetHeight || 0;
        bottomPad.value = h + 12;
    });
});

// (Removed verbose debug watcher)

onUnmounted(() => {
    sub?.unsubscribe();
    subProjects?.unsubscribe();
    const mh = (onUnmounted as any)._measureHandler;
    if (mh) window.removeEventListener('resize', mh);
});

const emit = defineEmits(['chatSelected', 'newChat']);

// ----- Actions: menu, rename, delete -----
const showRenameModal = ref(false);
const renameId = ref<string | null>(null);
const renameTitle = ref('');

const showDeleteModal = ref(false);
const deleteId = ref<string | null>(null);

async function openRename(target: any) {
    // Case 1: payload from project tree: { projectId, entryId, kind }
    if (target && typeof target === 'object' && 'entryId' in target) {
        const { entryId, kind } = target as {
            projectId: string;
            entryId: string;
            kind?: string;
        };
        if (kind === 'chat') {
            const t = await db.threads.get(entryId);
            renameId.value = entryId;
            renameTitle.value = t?.title || 'New Thread';
            showRenameModal.value = true;
        } else {
            // Non-chat entries (e.g., docs) could be handled here later
            console.warn('Rename for non-chat entry not implemented');
        }
        return;
    }
    // Case 2: direct thread object from thread list
    if (target && typeof target === 'object' && 'id' in target) {
        renameId.value = (target as any).id;
        renameTitle.value = (target as any).title ?? '';
        showRenameModal.value = true;
    }
}

async function saveRename() {
    if (!renameId.value) return;
    const t = await db.threads.get(renameId.value);
    if (!t) return;
    const now = Math.floor(Date.now() / 1000);
    await upsert.thread({ ...t, title: renameTitle.value, updated_at: now });
    // Sync title inside any project entries containing this thread
    try {
        const allProjects = await db.projects.toArray();
        const updates: any[] = [];
        for (const p of allProjects) {
            if (!p.data) continue;
            const arr = Array.isArray(p.data)
                ? p.data
                : typeof p.data === 'string'
                ? (() => {
                      try {
                          return JSON.parse(p.data);
                      } catch {
                          return [];
                      }
                  })()
                : [];
            let changed = false;
            for (const entry of arr) {
                if (entry.id === t.id && entry.name !== renameTitle.value) {
                    entry.name = renameTitle.value;
                    changed = true;
                }
            }
            if (changed) {
                updates.push({ ...p, data: arr, updated_at: now });
            }
        }
        if (updates.length) {
            await db.projects.bulkPut(updates);
        }
    } catch (e) {
        console.error('project title sync failed', e);
    }
    showRenameModal.value = false;
    renameId.value = null;
    renameTitle.value = '';
}

function confirmDelete(thread: any) {
    deleteId.value = thread.id as string;
    showDeleteModal.value = true;
}

async function deleteThread() {
    if (!deleteId.value) return;
    await dbDel.hard.thread(deleteId.value);
    showDeleteModal.value = false;
    deleteId.value = null;
}

function onNewChat() {
    emit('newChat');
    console.log('New chat requested');
}

// ---- Project Tree Handlers ----
async function handleAddChatToProject(projectId: string) {
    // Create a new chat thread and insert into project data array
    try {
        const now = Math.floor(Date.now() / 1000);
        const threadId = crypto.randomUUID();
        await create.thread({
            id: threadId,
            title: 'New Thread',
            forked: false,
            created_at: now,
            updated_at: now,
            deleted: false,
            clock: 0,
            meta: null,
        } as any);
        const project = await db.projects.get(projectId);
        if (project) {
            const dataArr = Array.isArray(project.data)
                ? project.data
                : typeof project.data === 'string'
                ? (() => {
                      try {
                          const parsed = JSON.parse(project.data);
                          return Array.isArray(parsed) ? parsed : [];
                      } catch {
                          return [];
                      }
                  })()
                : [];
            dataArr.push({ id: threadId, name: 'New Thread', kind: 'chat' });
            await upsert.project({
                ...project,
                data: dataArr,
                updated_at: now,
            });
            if (!expandedProjects.value.includes(projectId))
                expandedProjects.value.push(projectId);
            emit('chatSelected', threadId);
        }
    } catch (e) {
        console.error('add chat to project failed', e);
    }
}

async function handleDeleteProject(projectId: string) {
    try {
        await dbDel.soft.project(projectId); // soft delete for recoverability
    } catch (e) {
        console.error('delete project failed', e);
    }
}

// ---- Project Rename Modal Logic ----
const showRenameProjectModal = ref(false);
const renameProjectId = ref<string | null>(null);
const renameProjectName = ref('');

async function openRenameProject(projectId: string) {
    const project = await db.projects.get(projectId);
    if (!project) return;
    renameProjectId.value = projectId;
    renameProjectName.value = project.name || '';
    showRenameProjectModal.value = true;
}

async function saveRenameProject() {
    if (!renameProjectId.value) return;
    const name = renameProjectName.value.trim();
    if (!name) return;
    const project = await db.projects.get(renameProjectId.value);
    if (!project) return;
    try {
        await upsert.project({
            ...project,
            name,
            updated_at: Math.floor(Date.now() / 1000),
        });
        showRenameProjectModal.value = false;
        renameProjectId.value = null;
        renameProjectName.value = '';
    } catch (e) {
        console.error('rename project failed', e);
    }
}

async function handleRenameEntry(payload: {
    projectId: string;
    entryId: string;
    kind?: string;
}) {
    try {
        const project = await db.projects.get(payload.projectId);
        if (!project) return;
        const dataArr = Array.isArray(project.data)
            ? project.data
            : typeof project.data === 'string'
            ? (() => {
                  try {
                      const parsed = JSON.parse(project.data);
                      return Array.isArray(parsed) ? parsed : [];
                  } catch {
                      return [];
                  }
              })()
            : [];
        const entry = dataArr.find((d: any) => d.id === payload.entryId);
        if (!entry) return;
        const newName = prompt('Rename entry', entry.name || '');
        if (newName == null) return;
        const name = newName.trim();
        if (!name) return;
        entry.name = name;
        await upsert.project({
            ...project,
            data: dataArr,
            updated_at: Math.floor(Date.now() / 1000),
        });
        if (payload.kind === 'chat') {
            // sync thread title too
            const t = await db.threads.get(payload.entryId);
            if (t && t.title !== name) {
                await upsert.thread({
                    ...t,
                    title: name,
                    updated_at: Math.floor(Date.now() / 1000),
                });
            }
        }
    } catch (e) {
        console.error('rename entry failed', e);
    }
}

async function handleRemoveFromProject(payload: {
    projectId: string;
    entryId: string;
    kind?: string;
}) {
    try {
        const project = await db.projects.get(payload.projectId);
        if (!project) return;
        const dataArr = Array.isArray(project.data)
            ? project.data
            : typeof project.data === 'string'
            ? (() => {
                  try {
                      const parsed = JSON.parse(project.data);
                      return Array.isArray(parsed) ? parsed : [];
                  } catch {
                      return [];
                  }
              })()
            : [];
        const idx = dataArr.findIndex((d: any) => d.id === payload.entryId);
        if (idx === -1) return;
        dataArr.splice(idx, 1);
        await upsert.project({
            ...project,
            data: dataArr,
            updated_at: Math.floor(Date.now() / 1000),
        });
    } catch (e) {
        console.error('remove from project failed', e);
    }
}

// ---- Project Creation ----
const showCreateProjectModal = ref(false);
const creatingProject = ref(false);
const createProjectState = ref<{ name: string; description: string }>({
    name: '',
    description: '',
});
const createProjectErrors = ref<{ name?: string }>({});

function openCreateProject() {
    showCreateProjectModal.value = true;
    createProjectState.value = { name: '', description: '' };
    createProjectErrors.value = {};
}
function closeCreateProject() {
    showCreateProjectModal.value = false;
}

async function submitCreateProject() {
    if (creatingProject.value) return;
    const name = createProjectState.value.name.trim();
    if (!name) {
        createProjectErrors.value.name = 'Title required';
        return;
    }
    creatingProject.value = true;
    try {
        const now = Math.floor(Date.now() / 1000);
        // data holds ordered list of entities (chat/doc) we include kind now per request
        const newId = crypto.randomUUID();
        await create.project({
            id: newId,
            name,
            description: createProjectState.value.description?.trim() || null,
            data: [], // store as array; schema allows any
            created_at: now,
            updated_at: now,
            deleted: false,
            clock: 0,
        } as any);
        // Auto expand the new project
        if (!expandedProjects.value.includes(newId))
            expandedProjects.value.push(newId);
        closeCreateProject();
    } catch (e) {
        console.error('Failed to create project', e);
    } finally {
        creatingProject.value = false;
    }
}

// (Project tree logic moved to SidebarProjectTree component)

// ---- Add To Project Flow ----
const showAddToProjectModal = ref(false);
const addToProjectThreadId = ref<string | null>(null);
const addMode = ref<'select' | 'create'>('select');
const selectedProjectId = ref<string | null>(null);
const newProjectName = ref('');
const newProjectDescription = ref('');
const addingToProject = ref(false);
const addToProjectError = ref<string | null>(null);

const projectSelectOptions = computed(() =>
    projects.value.map((p) => ({ label: p.name, value: p.id }))
);

function openAddToProject(thread: any) {
    addToProjectThreadId.value = thread.id;
    addMode.value = 'select';
    selectedProjectId.value = null;
    newProjectName.value = '';
    newProjectDescription.value = '';
    addToProjectError.value = null;
    showAddToProjectModal.value = true;
}
function closeAddToProject() {
    showAddToProjectModal.value = false;
    addToProjectThreadId.value = null;
}

async function submitAddToProject() {
    if (addingToProject.value || !addToProjectThreadId.value) return;
    addToProjectError.value = null;
    addingToProject.value = true;
    try {
        const thread = await db.threads.get(addToProjectThreadId.value);
        if (!thread) throw new Error('Thread not found');
        const entry = {
            id: thread.id,
            name: thread.title || 'New Thread',
            kind: 'chat',
        };
        const now = Math.floor(Date.now() / 1000);
        let projectId: string | null = null;
        if (addMode.value === 'create') {
            const pid = crypto.randomUUID();
            await create.project({
                id: pid,
                name: newProjectName.value.trim(),
                description: newProjectDescription.value.trim() || null,
                data: [entry],
                created_at: now,
                updated_at: now,
                deleted: false,
                clock: 0,
            } as any);
            projectId = pid;
            if (!expandedProjects.value.includes(pid))
                expandedProjects.value.push(pid);
        } else {
            if (!selectedProjectId.value) {
                addToProjectError.value = 'Select a project';
                return;
            }
            projectId = selectedProjectId.value;
            const project = await db.projects.get(projectId);
            if (!project) throw new Error('Project not found');
            const dataArr = Array.isArray(project.data)
                ? project.data
                : typeof project.data === 'string'
                ? (() => {
                      try {
                          const parsed = JSON.parse(project.data);
                          return Array.isArray(parsed) ? parsed : [];
                      } catch {
                          return [];
                      }
                  })()
                : [];
            const existing = dataArr.find((d) => d.id === entry.id);
            if (!existing) {
                dataArr.push(entry);
            } else {
                existing.name = entry.name; // update name if changed
            }
            await upsert.project({
                ...project,
                data: dataArr,
                updated_at: now,
            });
        }
        closeAddToProject();
    } catch (e: any) {
        console.error('add to project failed', e);
        addToProjectError.value = e?.message || 'Failed to add';
    } finally {
        addingToProject.value = false;
    }
}
</script>
