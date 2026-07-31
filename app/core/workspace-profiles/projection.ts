import { shallowRef, type ShallowRef } from "vue";
import { useNuxtApp as useNuxtAppBase } from "nuxt/app";
import { STANDARD_OR3_PROFILE } from "./builtins";
import { resolveWorkspaceProfile } from "./resolver";
import type {
  ResolvedWorkspaceProfile,
  WorkspaceProfileInventory,
} from "./types";

export const DEFAULT_WORKSPACE_PROFILE_INVENTORY: WorkspaceProfileInventory =
  Object.freeze({
    navigation: Object.freeze([
      { id: "sidebar-home", label: "Home" },
      { id: "sidebar-chats", label: "Chats" },
      { id: "sidebar-docs", label: "Docs" },
    ]),
    dashboard: Object.freeze([
      { id: "core:settings", label: "Settings" },
      { id: "core:images", label: "Images" },
    ]),
    panes: Object.freeze([
      { id: "chat", label: "Chat" },
      { id: "doc", label: "Document" },
    ]),
    commands: Object.freeze([
      { id: "new-chat" },
      { id: "new-document" },
      { id: "new-project" },
      { id: "new-system-prompt" },
      { id: "open-system-prompts" },
      { id: "open-dashboard" },
      { id: "open-image-library" },
      { id: "open-theme-settings" },
      { id: "open-ai-settings" },
      { id: "toggle-theme" },
    ]),
  });

const initialResolvedWorkspaceProfile = resolveWorkspaceProfile(
  STANDARD_OR3_PROFILE,
  DEFAULT_WORKSPACE_PROFILE_INVENTORY,
  { maxDesktopPanes: 3, mobilePolicy: "single-pane" },
);

const clientRoot = globalThis as typeof globalThis & {
  __or3ResolvedWorkspaceProfile?: ShallowRef<ResolvedWorkspaceProfile>;
};
export type WorkspaceProfileRequestContainer = object;
const requestResolvedWorkspaceProfiles = new WeakMap<
  WorkspaceProfileRequestContainer,
  ShallowRef<ResolvedWorkspaceProfile>
>();

function getClientResolvedWorkspaceProfileRef(): ShallowRef<ResolvedWorkspaceProfile> {
  const existing = clientRoot.__or3ResolvedWorkspaceProfile;
  if (existing) return existing;
  const created: ShallowRef<ResolvedWorkspaceProfile> = shallowRef(
    initialResolvedWorkspaceProfile,
  );
  clientRoot.__or3ResolvedWorkspaceProfile = created;
  return created;
}

function getServerResolvedWorkspaceProfileRef(): ShallowRef<ResolvedWorkspaceProfile> {
  try {
    const nuxtApp = useNuxtAppBase();
    return getOrCreateRequestResolvedWorkspaceProfileRef(nuxtApp);
  } catch {
    // Outside a Nuxt request context (for example, isolated unit imports).
    return getClientResolvedWorkspaceProfileRef();
  }
}

function getOrCreateRequestResolvedWorkspaceProfileRef(
  container: WorkspaceProfileRequestContainer,
): ShallowRef<ResolvedWorkspaceProfile> {
  const existing = requestResolvedWorkspaceProfiles.get(container);
  if (existing) return existing;
  const created = shallowRef(initialResolvedWorkspaceProfile);
  requestResolvedWorkspaceProfiles.set(container, created);
  return created;
}

export function __getRequestResolvedWorkspaceProfileRefForTests(
  container: WorkspaceProfileRequestContainer,
): ShallowRef<ResolvedWorkspaceProfile> {
  return getOrCreateRequestResolvedWorkspaceProfileRef(container);
}

export function setRequestResolvedWorkspaceProfile(
  container: WorkspaceProfileRequestContainer,
  profile: ResolvedWorkspaceProfile,
): void {
  getOrCreateRequestResolvedWorkspaceProfileRef(container).value = profile;
}

function currentResolvedWorkspaceProfileRef(): ShallowRef<ResolvedWorkspaceProfile> {
  return import.meta.server
    ? getServerResolvedWorkspaceProfileRef()
    : getClientResolvedWorkspaceProfileRef();
}

/**
 * A ref-compatible proxy whose server target is request-scoped and whose
 * browser target survives HMR. Reading the underlying shallowRef still
 * participates in Vue dependency tracking.
 */
export const resolvedWorkspaceProfile = {
  __v_isRef: true,
  get value() {
    return currentResolvedWorkspaceProfileRef().value;
  },
  set value(profile: ResolvedWorkspaceProfile) {
    currentResolvedWorkspaceProfileRef().value = profile;
  },
} as unknown as ShallowRef<ResolvedWorkspaceProfile>;

export function setResolvedWorkspaceProfile(
  profile: ResolvedWorkspaceProfile,
): void {
  resolvedWorkspaceProfile.value = profile;
}

export function projectProfileItems<T extends { id: string }>(
  surface: "navigation" | "dashboard" | "commands" | "mobile-bottom-navigation",
  items: readonly T[],
): T[] {
  const profile = resolvedWorkspaceProfile.value;
  const ids =
    surface === "navigation"
      ? profile.navigation.items
      : surface === "dashboard"
        ? profile.dashboard.items
        : surface === "commands"
          ? profile.commands.items
          : profile.mobile.bottomNavigation;
  const hidden =
    surface === "navigation"
      ? new Set(profile.navigation.hidden)
      : surface === "dashboard"
        ? new Set(profile.dashboard.hidden)
        : surface === "commands"
          ? new Set(profile.commands.hidden)
          : null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const projected = ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  if (surface === "mobile-bottom-navigation") return projected;
  const projectedIds = new Set(projected.map((item) => item.id));
  for (const item of items) {
    if (!projectedIds.has(item.id) && !hidden?.has(item.id)) {
      projected.push(item);
    }
  }
  return projected;
}

export function workspaceProfileDefaultPage(mobile = false): string {
  return (
    (mobile
      ? resolvedWorkspaceProfile.value.mobile.defaultPageId
      : resolvedWorkspaceProfile.value.navigation.defaultPageId) ??
    "sidebar-home"
  );
}
