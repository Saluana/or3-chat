import type {
  ExternalAgentStoreEvent,
  ExternalAgentStoreSnapshot,
} from "./types";

type StoreListener = (event: ExternalAgentStoreEvent) => void;

/**
 * Publishes immutable controller snapshots without coupling observers to
 * mutable controller state. Timeline bursts are coalesced to one browser
 * frame while specific timeline events remain immediate.
 */
export class ExternalAgentSnapshotPublisher {
  readonly #listeners = new Set<StoreListener>();
  readonly #createSnapshot: () => ExternalAgentStoreSnapshot;
  #snapshotCache: ExternalAgentStoreSnapshot | null = null;
  #snapshotFrame: number | null = null;
  #snapshotMicrotaskQueued = false;
  #disposed = false;

  constructor(createSnapshot: () => ExternalAgentStoreSnapshot) {
    this.#createSnapshot = createSnapshot;
  }

  get snapshot(): ExternalAgentStoreSnapshot {
    return (this.#snapshotCache ??= this.#createSnapshot());
  }

  subscribe(listener: StoreListener): () => void {
    this.#listeners.add(listener);
    listener({ type: "snapshot", snapshot: this.snapshot });
    return () => this.#listeners.delete(listener);
  }

  publish(
    event?: Exclude<ExternalAgentStoreEvent, { type: "snapshot" }>,
  ): void {
    if (this.#disposed) return;
    this.#snapshotCache = null;
    if (event) {
      this.#notify(event);
      if (event.type === "timeline") {
        this.#queueSnapshot();
        return;
      }
    }
    this.#flushSnapshot();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (
      this.#snapshotFrame !== null &&
      typeof globalThis.cancelAnimationFrame === "function"
    ) {
      globalThis.cancelAnimationFrame(this.#snapshotFrame);
    }
    this.#snapshotFrame = null;
    this.#snapshotMicrotaskQueued = false;
    this.#snapshotCache = null;
    this.#listeners.clear();
  }

  #notify(event: ExternalAgentStoreEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // Observer failures never corrupt canonical controller state.
      }
    }
  }

  #queueSnapshot(): void {
    if (this.#snapshotFrame !== null || this.#snapshotMicrotaskQueued) return;
    if (typeof globalThis.requestAnimationFrame === "function") {
      this.#snapshotFrame = globalThis.requestAnimationFrame(() => {
        this.#snapshotFrame = null;
        this.#flushSnapshot();
      });
      return;
    }
    this.#snapshotMicrotaskQueued = true;
    queueMicrotask(() => {
      if (!this.#snapshotMicrotaskQueued) return;
      this.#snapshotMicrotaskQueued = false;
      this.#flushSnapshot();
    });
  }

  #flushSnapshot(): void {
    if (this.#disposed) return;
    if (
      this.#snapshotFrame !== null &&
      typeof globalThis.cancelAnimationFrame === "function"
    ) {
      globalThis.cancelAnimationFrame(this.#snapshotFrame);
    }
    this.#snapshotFrame = null;
    this.#snapshotMicrotaskQueued = false;
    this.#notify({ type: "snapshot", snapshot: this.snapshot });
  }
}
