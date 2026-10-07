import { inject, provide, type InjectionKey, type Ref } from "vue";
import { pluginError, pluginOk, type PluginResult } from "@or3/plugin-sdk";
import { getDb, getWorkspaceGeneration, type Or3DB } from "~/db/client";
import { patchMessageDataEntry } from "~/db/messages";
import {
  jsonCardValue,
  assertCardStateLimits,
  type CardOrigin,
} from "~~/shared/chat/tool-card-data";
export interface CardChatScope {
  db: Or3DB;
  generation: number;
  threadId: string | null;
}
export function captureCardChatScope(threadId: string | null): CardChatScope {
  return { db: getDb(), generation: getWorkspaceGeneration(), threadId };
}
export interface ToolCardChatBridge {
  readonly threadId: Readonly<Ref<string | null>>;
  readonly busy: Readonly<Ref<boolean>>;
  send(
    text: string,
    origin: CardOrigin,
    scope: CardChatScope,
  ): Promise<PluginResult<void>>;
  writeState(
    messageId: string,
    callId: string,
    value: unknown,
    scope: CardChatScope,
  ): Promise<PluginResult<void>>;
  flush(messageId?: string, callId?: string): Promise<void>;
  canSend(key: string): boolean;
  reserveSend(key: string): boolean;
}
const bridgeKey: InjectionKey<ToolCardChatBridge> = Symbol(
  "tool-card-chat-bridge",
);
export function provideToolCardChatBridge(bridge: ToolCardChatBridge) {
  provide(bridgeKey, bridge);
}
export function useToolCardChatBridge() {
  return inject(bridgeKey, null);
}
export function createToolCardChatBridge(
  input: Pick<ToolCardChatBridge, "threadId" | "busy"> & {
    send(text: string, origin: CardOrigin): Promise<PluginResult<void>>;
  },
) {
  interface PendingWrite {
    messageId: string;
    callId: string;
    value: unknown;
    scope: CardChatScope;
    timer: ReturnType<typeof setTimeout>;
    resolve(result: PluginResult<void>): void;
    promise: Promise<PluginResult<void>>;
  }
  const pending = new Map<string, PendingWrite>();
  const inFlight = new Map<
    string,
    { entry: PendingWrite; promise: Promise<void> }
  >();
  const sends = new Map<string, number>();
  const workspaceCurrent = (scope: CardChatScope) =>
    scope.db === getDb() && scope.generation === getWorkspaceGeneration();
  const current = (scope: CardChatScope) =>
    workspaceCurrent(scope) && scope.threadId === input.threadId.value;
  const stale = () =>
    pluginError("stale-context", "The card conversation changed");
  async function persistEntry(entry: PendingWrite) {
    let result: PluginResult<void>;
    try {
      if (!workspaceCurrent(entry.scope)) result = stale();
      else {
        await patchMessageDataEntry(
          entry.scope.db,
          entry.messageId,
          "tool_cards",
          entry.callId,
          {
            v: 1,
            state: entry.value,
            updated_at: Math.floor(Date.now() / 1000),
          },
          (row) =>
            workspaceCurrent(entry.scope) &&
            row?.thread_id === entry.scope.threadId &&
            row.role === "assistant",
        );
        result = pluginOk(undefined);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      result = pluginError(
        code === "quota-exceeded" ||
          code === "invalid-input" ||
          code === "not-found" ||
          code === "stale-context"
          ? code
          : "internal",
        "Card state could not be saved",
      );
    }
    entry.resolve(result);
  }
  function flushEntry(key: string): Promise<void> {
    const active = inFlight.get(key);
    if (active)
      return active.promise.then(() =>
        pending.has(key) ? flushEntry(key) : undefined,
      );
    const entry = pending.get(key);
    if (!entry) return Promise.resolve();
    const promise = (async () => {
      // Only one prepared write per call may reach the database. While it
      // awaits hooks, keep just the latest pending value and its waiters.
      let next: PendingWrite | undefined = entry;
      while (next) {
        pending.delete(key);
        clearTimeout(next.timer);
        await persistEntry(next);
        next = pending.get(key);
      }
    })().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, { entry, promise });
    return promise;
  }
  const bridge: ToolCardChatBridge = {
    threadId: input.threadId,
    busy: input.busy,
    canSend(key) {
      return Date.now() - (sends.get(key) ?? -Infinity) >= 3000;
    },
    reserveSend(key) {
      const now = Date.now();
      if (now - (sends.get(key) ?? -Infinity) < 3000) return false;
      sends.delete(key);
      sends.set(key, now);
      if (sends.size > 1024) sends.delete(sends.keys().next().value!);
      return true;
    },
    async send(text, origin, scope) {
      if (!current(scope)) return stale();
      if (input.busy.value)
        return pluginError("conflict", "Chat is busy", {
          retryable: true,
          details: { reason: "chat-busy" },
        });
      return input.send(text, origin);
    },
    async writeState(messageId, callId, value, scope) {
      if (!current(scope)) return stale();
      if (!callId)
        return pluginError(
          "invalid-input",
          "The tool call has no persistent ID",
        );
      let copy: unknown;
      try {
        copy = jsonCardValue(value);
        assertCardStateLimits({
          [callId]: {
            v: 1,
            state: copy,
            updated_at: Math.floor(Date.now() / 1000),
          },
        });
      } catch (error) {
        return pluginError(
          error instanceof Error && error.message === "quota-exceeded"
            ? "quota-exceeded"
            : "invalid-input",
          "Card state must be JSON within 16 KiB",
        );
      }
      const key = JSON.stringify([
        scope.db.name,
        scope.generation,
        scope.threadId,
        messageId,
        callId,
      ]);
      const previous = pending.get(key);
      if (previous) clearTimeout(previous.timer);
      let resolve!: (result: PluginResult<void>) => void;
      const promise =
        previous?.promise ??
        new Promise<PluginResult<void>>((settle) => {
          resolve = settle;
        });
      pending.set(key, {
        messageId,
        callId,
        value: copy,
        scope,
        resolve: previous?.resolve ?? resolve,
        promise,
        timer: setTimeout(() => {
          void flushEntry(key);
        }, 300),
      });
      return promise;
    },
    async flush(messageId, callId) {
      await Promise.all(
        [
          ...new Map([
            ...pending,
            ...[...inFlight].map(
              ([key, active]) => [key, active.entry] as const,
            ),
          ]),
        ]
          .filter(
            ([, entry]) =>
              (!messageId || messageId === entry.messageId) &&
              (!callId || callId === entry.callId),
          )
          .map(([key]) => flushEntry(key)),
      );
    },
  };
  return bridge;
}
