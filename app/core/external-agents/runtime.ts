import { shallowRef, type ShallowRef } from "vue";
import type { ExternalAgentController } from "./controller";
import type { ExternalAgentStoreSnapshot } from "./types";

type ExternalAgentRuntimeGlobal = typeof globalThis & {
  __or3ExternalAgentController?: ExternalAgentController;
  __or3ExternalAgentCloudHostRefresh?: () => Promise<void>;
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
    let disposed = false;
    const unsubscribe = controller.subscribe((event) => {
      if (disposed || event.type !== "snapshot") return;
      // The controller publisher already coalesces timeline bursts. Applying
      // its immutable snapshot directly avoids a second animation-frame queue
      // that can hide every intermediate state when an SSE burst is drained
      // before the browser gets a chance to paint.
      snapshot.value = event.snapshot;
    });
    scope.__or3ExternalAgentSnapshotDispose = () => {
      disposed = true;
      unsubscribe();
    };
  }
}

export function getExternalAgentController():
  | ExternalAgentController
  | undefined {
  return (globalThis as ExternalAgentRuntimeGlobal)
    .__or3ExternalAgentController;
}

export function setExternalAgentCloudHostRefresh(
  refresh: (() => Promise<void>) | undefined,
): void {
  const scope = globalThis as ExternalAgentRuntimeGlobal;
  scope.__or3ExternalAgentCloudHostRefresh = refresh;
}

export function getExternalAgentCloudHostRefresh():
  | (() => Promise<void>)
  | undefined {
  return (globalThis as ExternalAgentRuntimeGlobal)
    .__or3ExternalAgentCloudHostRefresh;
}

export function useExternalAgentRuntime(): {
  readonly controller: ExternalAgentController | undefined;
  readonly refreshCloudHosts: (() => Promise<void>) | undefined;
  readonly snapshot: ShallowRef<ExternalAgentStoreSnapshot | null>;
} {
  const scope = globalThis as ExternalAgentRuntimeGlobal;
  const snapshot =
    scope.__or3ExternalAgentSnapshot ??
    (scope.__or3ExternalAgentSnapshot = shallowRef(null));
  return {
    controller: scope.__or3ExternalAgentController,
    refreshCloudHosts: scope.__or3ExternalAgentCloudHostRefresh,
    snapshot,
  };
}

export function resetExternalAgentRuntimeForTests(): void {
  const scope = globalThis as ExternalAgentRuntimeGlobal;
  scope.__or3ExternalAgentSnapshotDispose?.();
  delete scope.__or3ExternalAgentSnapshotDispose;
  delete scope.__or3ExternalAgentController;
  delete scope.__or3ExternalAgentCloudHostRefresh;
  delete scope.__or3ExternalAgentSnapshot;
}
