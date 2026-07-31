import { reactive } from "vue";
import {
  createRegistrationHandle,
  type RegistrationHandle,
} from "~~/shared/plugins/registration-handle";
import { parseWorkspaceProfile, type WorkspaceProfileV1 } from "./schema";
import type {
  RegisteredWorkspaceProfile,
  WorkspaceProfileSource,
} from "./types";

type OwnedProfile = RegisteredWorkspaceProfile & { readonly owner: symbol };

interface WorkspaceProfileRegistryState {
  readonly entries: Map<string, OwnedProfile>;
}

function getRegistryState(): WorkspaceProfileRegistryState {
  const root = globalThis as typeof globalThis & {
    __or3WorkspaceProfileRegistry?: WorkspaceProfileRegistryState;
  };
  return (
    root.__or3WorkspaceProfileRegistry ??
    (root.__or3WorkspaceProfileRegistry = { entries: new Map() })
  );
}

const version = reactive({ value: 0 });
const listeners = new Set<() => void>();

function notify(): void {
  version.value += 1;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Registry observers cannot break profile ownership.
    }
  }
}

export function subscribeWorkspaceProfileRegistry(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerWorkspaceProfile(
  input: unknown,
  options: { source: WorkspaceProfileSource },
): RegistrationHandle {
  const profile = parseWorkspaceProfile(input);
  const state = getRegistryState();
  if (state.entries.has(profile.id)) {
    throw new Error(`Workspace profile id "${profile.id}" is already owned`);
  }

  const owner = Symbol(`workspace-profile:${profile.id}`);
  const frozen = Object.freeze({
    profile: deepFreeze(structuredClone(profile)),
    source: Object.freeze({ ...options.source }),
    owner,
  }) as OwnedProfile;
  state.entries.set(profile.id, frozen);
  notify();

  return createRegistrationHandle({
    id: profile.id,
    owner,
    isCurrent: () => state.entries.get(profile.id)?.owner === owner,
    remove: () => {
      if (state.entries.get(profile.id)?.owner !== owner) return;
      state.entries.delete(profile.id);
      notify();
    },
  });
}

export function getWorkspaceProfile(
  id: string,
): RegisteredWorkspaceProfile | undefined {
  void version.value;
  const entry = getRegistryState().entries.get(id);
  if (!entry) return undefined;
  return { profile: entry.profile, source: entry.source };
}

export function unregisterWorkspaceProfile(id: string): boolean {
  const removed = getRegistryState().entries.delete(id);
  if (removed) notify();
  return removed;
}

export function listWorkspaceProfiles(): RegisteredWorkspaceProfile[] {
  void version.value;
  return [...getRegistryState().entries.values()]
    .map(({ profile, source }) => ({ profile, source }))
    .sort(
      (left, right) =>
        Number(left.source.kind !== "core") -
          Number(right.source.kind !== "core") ||
        left.profile.label.localeCompare(right.profile.label) ||
        left.profile.id.localeCompare(right.profile.id),
    );
}

export function registerWorkspaceProfileBatch(
  profiles: readonly WorkspaceProfileV1[],
  options: { source: WorkspaceProfileSource },
): RegistrationHandle[] {
  const handles: RegistrationHandle[] = [];
  try {
    for (const profile of profiles) {
      handles.push(registerWorkspaceProfile(profile, options));
    }
    return handles;
  } catch (error) {
    for (const handle of handles.reverse()) handle.dispose();
    throw error;
  }
}

export function __resetWorkspaceProfileRegistryForTests(): void {
  getRegistryState().entries.clear();
  listeners.clear();
  notify();
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
