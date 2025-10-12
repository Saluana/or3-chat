// dual-llm-relay.client.ts
// Example plugin: if two chat panes are open, bounce messages between them automatically.
// Flow:
// 1. User sends a message in pane A (normal UI path fires ui.pane.msg:action:sent).
// 2. We forward that text to pane B via __or3PanePluginApi.sendMessage (source 'relay').
// 3. When pane B's assistant reply is finalized (ui.pane.msg:action:received) we forward
//    its content back to pane A, and so on, until a safety hop limit is reached.
// Safeguards:
// - Requires exactly 2 panes in chat mode with threads.
// - Per-thread hop counters to prevent infinite loops.
// - Skips forwarding if message was injected by this relay (source tagging).
// - Debounce rapid duplicate forwards (simple last-message-id memory).
import { useNuxtApp } from '#app';
import type { PanePluginApi } from '../pane-plugin-api.client';
import type {
    UiPaneMsgSentPayload,
    UiPaneMsgReceivedPayload,
} from '~/core/hooks/hook-types';
import { getMessage } from '~/db/messages';

const MAX_HOPS = 3; // prevent runaway ping-pong
const RELAY_SOURCE = 'relay';

function getApi(): PanePluginApi | undefined {
    return globalThis.__or3PanePluginApi;
}

// Module-level flag instead of mutating global object.
let relayInitialized = false;

// Ensure TypeScript knows about the global (should already be in types, but this is a narrow safety net for isolated module context)
declare global {
    // eslint-disable-next-line no-var
    var __or3PanePluginApi: PanePluginApi | undefined;
}

export default defineNuxtPlugin(() => {
    if (import.meta.dev) console.debug('[dual-llm-relay] plugin loaded');
    const nuxt = useNuxtApp();

    function initIfReady(): boolean {
        const hooks = nuxt.$hooks;
        const api = getApi();
        if (!hooks || !api) return false;
        console.log('DUAL LLM RELAY INIT', { hooks, api });
        if (relayInitialized) return true;
        relayInitialized = true;
        if (import.meta.dev) console.debug('[dual-llm-relay] init actions');

        hooks.addAction(
            'ui.pane.msg:action:sent',
            (_payload: UiPaneMsgSentPayload) => {
                //console.log('[dual-llm-relay] sent', _payload);
            }
        );

        // Track per-thread hop counts to avoid infinite loops
        const hopCounts = new Map<string, number>();

        hooks.addAction(
            'ui.pane.msg:action:received',
            async (payload: UiPaneMsgReceivedPayload) => {
                // We only forward assistant messages produced in a pane's thread.
                const panesRes = api.getPanes();
                if (!panesRes.ok) return;
                const paneList = panesRes.panes;
                if (paneList.length !== 2) return; // require exactly 2 panes for deterministic relay

                // Derive index from descriptor list (meta.paneIndex not currently provided by core)
                const fromIndex = paneList.findIndex(
                    (p) => p.paneId === payload.pane.id
                );
                if (fromIndex === -1) return;
                const targetPaneDesc = paneList[fromIndex === 0 ? 1 : 0];
                if (!targetPaneDesc) return;

                // Prevent relaying our own injected messages (source flag present only on sent hook currently). If future meta.source appears, respect it.
                if (payload.meta?.source === RELAY_SOURCE) return;

                const key =
                    (payload.message.threadId || payload.pane.threadId || '') +
                    '->' +
                    (targetPaneDesc.threadId || targetPaneDesc.paneId);
                const hops = hopCounts.get(key) || 0;
                if (hops >= MAX_HOPS) {
                    if (import.meta.dev)
                        console.debug(
                            '[dual-llm-relay] hop limit reached',
                            key,
                            hops
                        );
                    return;
                }

                // Fetch message content (meta.id corresponds to assistant message id)
                let text = '';
                try {
                    const msg: any = await getMessage(payload.message.id);
                    text = msg?.data?.content || '';
                } catch {}
                if (!text.trim()) return;

                hopCounts.set(key, hops + 1);
                api.sendMessage({
                    paneId: targetPaneDesc.paneId,
                    text,
                    source: RELAY_SOURCE,
                    createIfMissing: true,
                });
            }
        );
        return true;
    }

    if (!initIfReady()) {
        if (import.meta.dev)
            console.debug('[dual-llm-relay] waiting for hooks/api');
        const interval = setInterval(() => {
            if (initIfReady()) clearInterval(interval);
        }, 100);
        if (import.meta.hot) {
            import.meta.hot.dispose(() => clearInterval(interval));
        }
    }
});
