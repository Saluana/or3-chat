import {
  computed,
  reactive,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from "vue";
import { useNuxtApp as useNuxtAppBase } from "nuxt/app";
import {
  BUILTIN_WORKSPACE_PROFILES,
  DEFAULT_WORKSPACE_PROFILE_INVENTORY,
  STANDARD_OR3_PROFILE_ID,
  getWorkspaceProfile,
  listWorkspaceProfiles,
  registerWorkspaceProfileBatch,
  resolveWorkspaceProfile,
  resolvedWorkspaceProfile,
  setResolvedWorkspaceProfile,
  type RegisteredWorkspaceProfile,
  type ResolvedWorkspaceProfile,
  type WorkspaceProfileInitialPaneRequest,
  type WorkspaceProfileInventory,
  writeWorkspaceProfileSelectionCookie,
} from "~/core/workspace-profiles";
import {
  WORKSPACE_PROFILE_INITIAL_PANES_KEY,
  WORKSPACE_PROFILE_SELECTION_KEY,
  markInitialPanesApplied,
  needsInitialPaneApplication,
  type WorkspaceProfilePreferenceStore,
} from "~/core/workspace-profiles/selection";
import { getKvByName, setKvByName } from "~/db/kv";
import {
  getActiveWorkspaceId,
  getDb,
  subscribeActiveWorkspaceDb,
} from "~/db/client";
import { useSidebarPages } from "~/composables/sidebar/useSidebarPages";
import { useDashboardPlugins } from "~/composables/dashboard/useDashboardPlugins";
import { usePaneApps } from "~/composables/core/usePaneApps";
import { useCommandPaletteRegistry } from "~/core/search/command-palette/registry";
import { useOr3Config } from "~/composables/useOr3Config";

type RuntimeError = { readonly message: string; readonly cause?: unknown };

interface WorkspaceProfileRuntimeState {
  selectedProfileId: Ref<string>;
  initialized: Ref<boolean>;
  pending: Ref<boolean>;
  error: ShallowRef<RuntimeError | null>;
  initialPaneRequest: ShallowRef<WorkspaceProfileInitialPaneRequest | null>;
  requestToken: number;
  loadGeneration: number;
  disposeWorkspaceSubscription: (() => void) | null;
}

function getRuntimeState(): WorkspaceProfileRuntimeState {
  const createState = (
    selectedProfileId = STANDARD_OR3_PROFILE_ID,
    initialized = false,
  ): WorkspaceProfileRuntimeState => ({
    selectedProfileId: ref(selectedProfileId),
    initialized: ref(initialized),
    pending: ref(false),
    error: shallowRef(null),
    initialPaneRequest: shallowRef<WorkspaceProfileInitialPaneRequest | null>(
      null,
    ),
    requestToken: 0,
    loadGeneration: 0,
    disposeWorkspaceSubscription: null,
  });

  if (import.meta.server) {
    try {
      const nuxtApp = useNuxtAppBase() as ReturnType<typeof useNuxtAppBase> & {
        __or3WorkspaceProfileRuntime?: WorkspaceProfileRuntimeState;
      };
      return (
        nuxtApp.__or3WorkspaceProfileRuntime ??
        (nuxtApp.__or3WorkspaceProfileRuntime = createState(
          resolvedWorkspaceProfile.value.id,
          true,
        ))
      );
    } catch {
      return createState(resolvedWorkspaceProfile.value.id, true);
    }
  }

  const root = globalThis as typeof globalThis & {
    __or3WorkspaceProfileRuntime?: WorkspaceProfileRuntimeState;
  };
  return (
    root.__or3WorkspaceProfileRuntime ??
    (root.__or3WorkspaceProfileRuntime = createState())
  );
}

const runtimeVersion = reactive({ value: 0 });

function profilePreferenceStore(): WorkspaceProfilePreferenceStore {
  const database = getDb();
  return {
    async get(name) {
      return (await getKvByName(name, database))?.value;
    },
    async set(name, value) {
      await setKvByName(name, value, database);
    },
  };
}

function uniqueInventory(
  core: readonly { id: string; label?: string }[],
  contributions: readonly { id: string; label?: string }[],
): { id: string; label?: string }[] {
  const byId = new Map(core.map((item) => [item.id, { ...item }]));
  for (const item of contributions) {
    if (!byId.has(item.id)) byId.set(item.id, { ...item });
  }
  return [...byId.values()];
}

export function useWorkspaceProfiles() {
  const state = getRuntimeState();
  const { listSidebarPages } = useSidebarPages();
  const dashboardPlugins = useDashboardPlugins();
  const { listPaneApps } = usePaneApps();
  const palette = useCommandPaletteRegistry();
  const or3Config = useOr3Config();

  const inventory = computed<WorkspaceProfileInventory>(() => ({
    navigation: uniqueInventory(
      DEFAULT_WORKSPACE_PROFILE_INVENTORY.navigation,
      listSidebarPages.value.map((page) => ({
        id: page.id,
        label: page.label,
      })),
    ),
    dashboard: uniqueInventory(
      DEFAULT_WORKSPACE_PROFILE_INVENTORY.dashboard,
      dashboardPlugins.value.map((plugin) => ({
        id: plugin.id,
        label: plugin.label,
      })),
    ),
    panes: uniqueInventory(
      DEFAULT_WORKSPACE_PROFILE_INVENTORY.panes,
      listPaneApps.value.map((pane) => ({
        id: pane.id,
        label: pane.label,
      })),
    ),
    commands: uniqueInventory(
      DEFAULT_WORKSPACE_PROFILE_INVENTORY.commands,
      palette.commands.value.map((command) => ({
        id: command.id,
        label: command.label,
      })),
    ),
  }));

  const profiles: ComputedRef<RegisteredWorkspaceProfile[]> = computed(() => {
    void runtimeVersion.value;
    return listWorkspaceProfiles();
  });
  const selectedProfile = computed(
    () =>
      getWorkspaceProfile(state.selectedProfileId.value) ??
      getWorkspaceProfile(STANDARD_OR3_PROFILE_ID),
  );

  function resolveActiveProfile(): void {
    const registration = getWorkspaceProfile(state.selectedProfileId.value);
    if (shouldPreserveHydratedWorkspaceProfile(
      state.selectedProfileId.value,
      registration,
      resolvedWorkspaceProfile.value,
    )) {
      return;
    }
    const resolved = registration
      ? resolveWorkspaceProfile(registration.profile, inventory.value, {
          maxDesktopPanes: Math.max(1, Math.floor(or3Config.ui.maxPanes)),
          mobilePolicy: "single-pane",
        })
      : resolveWorkspaceProfile(
          undefined,
          inventory.value,
          {
            maxDesktopPanes: Math.max(1, Math.floor(or3Config.ui.maxPanes)),
            mobilePolicy: "single-pane",
          },
          { missingProfileId: state.selectedProfileId.value },
        );
    setResolvedWorkspaceProfile(resolved);
  }

  if (import.meta.client) {
    watch(
      [
        () => state.selectedProfileId.value,
        () => inventory.value.navigation.map((item) => item.id).join("|"),
        () => inventory.value.dashboard.map((item) => item.id).join("|"),
        () => inventory.value.panes.map((item) => item.id).join("|"),
        () => inventory.value.commands.map((item) => item.id).join("|"),
        () => profiles.value.map((item) => item.profile.id).join("|"),
      ],
      resolveActiveProfile,
      { immediate: true },
    );
  }

  return {
    profiles,
    selectedProfileId: state.selectedProfileId,
    selectedProfile,
    resolvedProfile: resolvedWorkspaceProfile,
    initialized: state.initialized,
    pending: state.pending,
    error: state.error,
    initialPaneRequest: state.initialPaneRequest,
    inventory,
    applyProfile,
    resetToStandard,
    acknowledgeInitialPanes,
    reloadWorkspaceProfile,
  };
}

export function shouldPreserveHydratedWorkspaceProfile(
  selectedProfileId: string,
  registration: RegisteredWorkspaceProfile | undefined,
  current: ResolvedWorkspaceProfile,
): boolean {
  return (
    !registration &&
    current.id === selectedProfileId &&
    !current.usedFallback
  );
}

export async function applyProfile(profileId: string): Promise<void> {
  const state = getRuntimeState();
  if (!getWorkspaceProfile(profileId)) {
    throw new Error(`Workspace profile "${profileId}" is unavailable`);
  }
  const workspaceId = getActiveWorkspaceId();
  const store = profilePreferenceStore();
  await store.set(WORKSPACE_PROFILE_SELECTION_KEY, profileId);
  if (getActiveWorkspaceId() !== workspaceId) return;
  state.selectedProfileId.value = profileId;
  state.error.value = null;
  writeWorkspaceProfileSelectionCookie(workspaceId, profileId);
}

export async function resetToStandard(options?: {
  resetLayout?: boolean;
}): Promise<void> {
  const state = getRuntimeState();
  const workspaceId = getActiveWorkspaceId();
  const store = profilePreferenceStore();
  await store.set(WORKSPACE_PROFILE_SELECTION_KEY, STANDARD_OR3_PROFILE_ID);
  if (getActiveWorkspaceId() !== workspaceId) return;
  state.selectedProfileId.value = STANDARD_OR3_PROFILE_ID;
  state.error.value = null;
  writeWorkspaceProfileSelectionCookie(workspaceId, STANDARD_OR3_PROFILE_ID);

  if (options?.resetLayout) {
    const profile = getWorkspaceProfile(STANDARD_OR3_PROFILE_ID)?.profile;
    if (profile) {
      state.initialPaneRequest.value = {
        token: ++state.requestToken,
        workspaceId,
        profileId: profile.id,
        panes: profile.workspace?.initialPanes ?? [],
        replaceExisting: true,
        reason: "reset-layout",
      };
    }
  }
}

export async function acknowledgeInitialPanes(token: number): Promise<void> {
  const state = getRuntimeState();
  const request = state.initialPaneRequest.value;
  if (
    request?.token !== token ||
    request.workspaceId !== getActiveWorkspaceId()
  ) {
    return;
  }
  await markInitialPanesApplied(profilePreferenceStore());
  if (state.initialPaneRequest.value?.token === token) {
    state.initialPaneRequest.value = null;
  }
}

export async function reloadWorkspaceProfile(): Promise<void> {
  const state = getRuntimeState();
  const generation = ++state.loadGeneration;
  const workspaceId = getActiveWorkspaceId();
  state.pending.value = true;
  state.error.value = null;
  state.initialPaneRequest.value = null;
  const store = profilePreferenceStore();
  try {
    const selected =
      (await store.get(WORKSPACE_PROFILE_SELECTION_KEY)) ||
      STANDARD_OR3_PROFILE_ID;
    const initialMarker = await store.get(WORKSPACE_PROFILE_INITIAL_PANES_KEY);
    if (
      generation !== state.loadGeneration ||
      workspaceId !== getActiveWorkspaceId()
    ) {
      return;
    }
    state.selectedProfileId.value = selected;
    state.initialized.value = true;
    writeWorkspaceProfileSelectionCookie(workspaceId, selected);

    if (needsInitialPaneApplication(initialMarker)) {
      const registration =
        getWorkspaceProfile(selected) ??
        getWorkspaceProfile(STANDARD_OR3_PROFILE_ID);
      if (registration) {
        state.initialPaneRequest.value = {
          token: ++state.requestToken,
          workspaceId,
          profileId: registration.profile.id,
          panes: registration.profile.workspace?.initialPanes ?? [],
          replaceExisting: false,
          reason: "new-workspace",
        };
      }
    }
  } catch (cause) {
    if (
      generation !== state.loadGeneration ||
      workspaceId !== getActiveWorkspaceId()
    ) {
      return;
    }
    state.error.value = {
      message: "Unable to load the workspace profile preference",
      cause,
    };
    state.selectedProfileId.value = STANDARD_OR3_PROFILE_ID;
    state.initialized.value = true;
  } finally {
    if (generation === state.loadGeneration) state.pending.value = false;
  }
}

export function initializeWorkspaceProfilesRuntime(): () => void {
  const state = getRuntimeState();
  state.disposeWorkspaceSubscription?.();
  state.disposeWorkspaceSubscription = subscribeActiveWorkspaceDb(() => {
    void reloadWorkspaceProfile();
  });
  void getActiveWorkspaceId();
  void reloadWorkspaceProfile();
  return () => {
    state.disposeWorkspaceSubscription?.();
    state.disposeWorkspaceSubscription = null;
  };
}

export function registerBuiltinWorkspaceProfiles() {
  return registerWorkspaceProfileBatch(BUILTIN_WORKSPACE_PROFILES, {
    source: { kind: "core", id: "or3" },
  });
}

export function seedWorkspaceProfileRuntime(profileId: string): void {
  const state = getRuntimeState();
  state.selectedProfileId.value = profileId;
}

export function __resetWorkspaceProfileRuntimeForTests(): void {
  const state = getRuntimeState();
  state.selectedProfileId.value = STANDARD_OR3_PROFILE_ID;
  state.initialized.value = false;
  state.pending.value = false;
  state.error.value = null;
  state.initialPaneRequest.value = null;
  state.requestToken = 0;
  state.loadGeneration = 0;
}
