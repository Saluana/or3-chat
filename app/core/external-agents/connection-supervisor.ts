import type {
  ExternalAgentClient,
  ExternalAgentSession,
  ExternalRemoteEvent,
} from "./types";
import { shouldPauseStream, streamPayload } from "./event-store";

const STREAM_DISCONNECT_RECONCILE_INITIAL_MS = 1_000;
const STREAM_DISCONNECT_RECONCILE_MAX_MS = 30_000;
const STREAM_EVENTS_PER_RENDER_YIELD = 8;

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
    let eventsSinceRenderYield = 0;
    const reconcileDisconnectedStream = async () => {
      let delayMs = 0;
      while (streamIsCurrent()) {
        if (
          delayMs > 0 &&
          !(await waitForAbortableDelay(delayMs, controller.signal))
        )
          return;
        if (!streamIsCurrent()) return;
        try {
          await input.refresh();
          if (ownsActionError) {
            input.session.actionError = undefined;
            ownsActionError = false;
          }
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
          input.session.streamState = "idle";
          input.publishSession();
          void input.persist().catch(() => undefined);
          finish();
          return;
        }
        input.session.streamState = "disconnected";
        input.publishSession();
        delayMs =
          delayMs === 0
            ? STREAM_DISCONNECT_RECONCILE_INITIAL_MS
            : Math.min(delayMs * 2, STREAM_DISCONNECT_RECONCILE_MAX_MS);
      }
    };

    void (async () => {
      try {
        for await (const streamEvent of input.client.streamTurn(
          input.session.remoteSessionId,
          input.turnId,
          { afterSeq: input.afterSeq, signal: controller.signal },
        )) {
          if (!streamIsCurrent()) return;
          input.session.streamState = "connected";
          const remote = streamPayload(streamEvent);
          if (remote) input.ingest(remote);
          if (
            shouldPauseStream(input.session.status) ||
            streamEvent.event === "done"
          )
            break;
          if (
            remote &&
            ++eventsSinceRenderYield >= STREAM_EVENTS_PER_RENDER_YIELD
          ) {
            eventsSinceRenderYield = 0;
            // A fetch body may expose a large buffered SSE burst at once.
            // Yielding to a task periodically prevents the async iterator's
            // microtask chain from starving Vue and the browser paint loop.
            if (!(await waitForAbortableDelay(0, controller.signal))) return;
          }
        }
        if (!controller.signal.aborted) await reconcileDisconnectedStream();
      } catch (error) {
        if (
          controller.signal.aborted ||
          !input.isCurrent() ||
          input.isStaleError(error)
        )
          return;
        input.session.streamState = "disconnected";
        input.publishSession();
        await reconcileDisconnectedStream();
      } finally {
        if (
          controller.signal.aborted ||
          shouldPauseStream(input.session.status)
        )
          finish();
      }
    })();
  }
}
