import { shallowRef, type ShallowRef } from "vue";
import type { ExternalAgentController } from "./controller";
import type { ExternalAgentStoreSnapshot } from "./types";

type ExternalAgentRuntimeGlobal = typeof globalThis & {
  __or3ExternalAgentController?: ExternalAgentController;
  __or3ExternalAgentSnapshot?: ShallowRef<ExternalAgentStoreSnapshot | null>;
  __or3ExternalAgentSnapshotDispose?: () => void;
};

export function setExternalAgentController(
  controller: ExternalAgentController | undefined,
): void {
  const scope = globalThis as ExternalAgentRuntimeGlobal;
  scope.__or3ExternalAgentSnapshotDispose?.();
  scope.__or3ExternalAgentSnapshotDispose = undefined;
  scope.__or3ExternalAgentController = controller;
  const snapshot =
    scope.__or3ExternalAgentSnapshot ??
    (scope.__or3ExternalAgentSnapshot = shallowRef(null));
  snapshot.value = controller?.snapshot ?? null;
  if (controller) {
    scope.__or3ExternalAgentSnapshotDispose = controller.subscribe((event) => {
      if (event.type === "snapshot") snapshot.value = event.snapshot;
    });
  }
}

export function getExternalAgentController():
  | ExternalAgentController
  | undefined {
  return (globalThis as ExternalAgentRuntimeGlobal)
    .__or3ExternalAgentController;
}

export function useExternalAgentRuntime(): {
  readonly controller: ExternalAgentController | undefined;
  readonly snapshot: ShallowRef<ExternalAgentStoreSnapshot | null>;
} {
  const scope = globalThis as ExternalAgentRuntimeGlobal;
  const snapshot =
    scope.__or3ExternalAgentSnapshot ??
    (scope.__or3ExternalAgentSnapshot = shallowRef(null));
  return {
    controller: scope.__or3ExternalAgentController,
    snapshot,
  };
}

export function resetExternalAgentRuntimeForTests(): void {
  const scope = globalThis as ExternalAgentRuntimeGlobal;
  scope.__or3ExternalAgentSnapshotDispose?.();
  delete scope.__or3ExternalAgentSnapshotDispose;
  delete scope.__or3ExternalAgentController;
  delete scope.__or3ExternalAgentSnapshot;
}
