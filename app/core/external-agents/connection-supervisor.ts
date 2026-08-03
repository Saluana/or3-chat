import type {
  ExternalAgentClient,
  ExternalAgentSession,
  ExternalRemoteEvent,
} from "./types";
import { shouldPauseStream, streamPayload } from "./event-store";

const STREAM_DISCONNECT_RECONCILE_INITIAL_MS = 1_000;
const STREAM_DISCONNECT_RECONCILE_MAX_MS = 30_000;
const STREAM_EVENTS_PER_PAINT_YIELD = 4;

function waitForAbortableDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface StartTurnStreamInput {
  readonly client: ExternalAgentClient;
  readonly session: ExternalAgentSession;
  readonly turnId: string;
  readonly afterSeq: number;
  readonly isCurrent: () => boolean;
  readonly refresh: () => Promise<void>;
  readonly ingest: (event: ExternalRemoteEvent) => void;
  readonly publishSession: () => void;
  readonly persist: () => Promise<void>;
  readonly isStaleError: (error: unknown) => boolean;
  readonly presentError: (error: unknown) => string;
}

/**
 * Owns host and turn AbortControllers plus SSE disconnect reconciliation.
 * Generation and workspace-lease validity remain coordinator-owned callbacks.
 */
export class ExternalAgentConnectionSupervisor {
  readonly #streams = new Map<string, AbortController>();
  #hostController: AbortController | null = null;

  get hostSignal(): AbortSignal | undefined {
    return this.#hostController?.signal;
  }

  beginHostRequest(): AbortController {
    this.abortAll();
    const controller = new AbortController();
    this.#hostController = controller;
    return controller;
  }

  abortAll(): void {
    this.#hostController?.abort();
    this.#hostController = null;
    for (const controller of this.#streams.values()) controller.abort();
    this.#streams.clear();
  }

  startTurnStream(input: StartTurnStreamInput): void {
    const key = `${input.session.hostId}:${input.session.remoteSessionId}`;
    this.#streams.get(key)?.abort();
    const controller = new AbortController();
    this.#streams.set(key, controller);
    const streamIsCurrent = () =>
      !controller.signal.aborted && input.isCurrent();
    const finish = () => {
      controller.abort();
      if (this.#streams.get(key) === controller) this.#streams.delete(key);
    };

    input.session.streamState = "connecting";
    input.publishSession();

    let ownsActionError = false;

    void (async () => {
      let delayMs = 0;
      let afterSeq = input.afterSeq;
      try {
        while (streamIsCurrent()) {
          if (
            delayMs > 0 &&
            !(await waitForAbortableDelay(delayMs, controller.signal))
          )
            return;
          if (!streamIsCurrent()) return;

          input.session.streamState = "connecting";
          input.publishSession();
          let eventsSincePaintYield = 0;
          try {
            for await (const streamEvent of input.client.streamTurn(
              input.session.remoteSessionId,
              input.turnId,
              { afterSeq, signal: controller.signal },
            )) {
              if (!streamIsCurrent()) return;
              input.session.streamState = "connected";
              if (ownsActionError) {
                input.session.actionError = undefined;
                ownsActionError = false;
              }
              const remote = streamPayload(streamEvent);
              if (remote) {
                afterSeq = Math.max(afterSeq, remote.seq);
                input.ingest(remote);
              }
              if (
                shouldPauseStream(input.session.status) ||
                streamEvent.event === "done"
              )
                break;
              if (
                remote &&
                ++eventsSincePaintYield >= STREAM_EVENTS_PER_PAINT_YIELD
              ) {
                eventsSincePaintYield = 0;
                // Browsers may expose many buffered SSE frames in one read.
                // Break the resulting microtask chain so Vue can render live
                // text and tool events before the terminal frame is consumed.
                if (!(await waitForAbortableDelay(0, controller.signal)))
                  return;
              }
            }
          } catch (error) {
            const staleError = input.isStaleError(error);
            if (
              controller.signal.aborted ||
              !input.isCurrent() ||
              staleError
            ) {
              if (staleError) finish();
              return;
            }
            input.session.actionError = input.presentError(error);
            ownsActionError = true;
          }

          if (controller.signal.aborted || !input.isCurrent()) return;
          if (shouldPauseStream(input.session.status)) {
            if (ownsActionError) {
              input.session.actionError = undefined;
              ownsActionError = false;
            }
            input.session.streamState = "idle";
            input.publishSession();
            await input.persist().catch(() => undefined);
            finish();
            return;
          }

          input.session.streamState = "disconnected";
          input.publishSession();
          try {
            await input.refresh();
          } catch (error) {
            if (controller.signal.aborted) return;
            if (input.isStaleError(error)) {
              finish();
              return;
            }
            input.session.actionError = input.presentError(error);
            ownsActionError = true;
            input.publishSession();
          }
          if (shouldPauseStream(input.session.status)) {
            if (ownsActionError) {
              input.session.actionError = undefined;
              ownsActionError = false;
            }
            input.session.streamState = "idle";
            input.publishSession();
            await input.persist().catch(() => undefined);
            finish();
            return;
          }

          delayMs =
            delayMs === 0
              ? STREAM_DISCONNECT_RECONCILE_INITIAL_MS
              : Math.min(delayMs * 2, STREAM_DISCONNECT_RECONCILE_MAX_MS);
        }
      } finally {
        if (controller.signal.aborted || !input.isCurrent()) finish();
      }
    })();
  }
}
