// Dev example plugin demonstrating pane lifecycle & chat/document hook usage.
// Safe to remove in production; only logs + optional toast notifications.

export default defineNuxtPlugin(() => {
    try {
        const nuxtApp = useNuxtApp();
        const hooks: any = (nuxtApp as any).$hooks;
        if (!hooks) {
            console.warn('[pane-hooks-test] $hooks engine unavailable');
            return;
        }

        console.info('[pane-hooks-test] registering pane hooks test listeners');

        const disposers: (() => void)[] = [];

        function on(
            name: string,
            fn: (...a: any[]) => any,
            kind: 'action' | 'filter' = 'action'
        ) {
            try {
                if (kind === 'filter') hooks.addFilter(name, fn);
                else hooks.addAction(name, fn);
                disposers.push(() => {
                    try {
                        if (kind === 'filter') hooks.removeFilter(name, fn);
                        else hooks.removeAction(name, fn);
                    } catch {}
                });
            } catch (e) {
                console.warn(
                    `[pane-hooks-test] failed to register ${kind} ${name}`,
                    e
                );
            }
        }

        // --- Actions ---
        on('ui.pane.blur:action', (payload: any) => {
            const { pane, previousIndex } = payload || {};
            console.debug('[pane-hooks-test] blur', {
                ts: Date.now(),
                index: previousIndex,
                id: pane?.id,
                mode: pane?.mode,
                thread: pane?.threadId,
            });
        });
        on('ui.pane.switch:action', (payload: any) => {
            const { pane, index, previousIndex } = payload || {};
            console.debug('[pane-hooks-test] switch', {
                ts: Date.now(),
                index,
                previousIndex,
                threadId: pane?.threadId,
                doc: pane?.documentId,
                msgs: Array.isArray(pane?.messages)
                    ? pane.messages.length
                    : undefined,
            });
        });
        on('ui.pane.active:action', (payload: any) => {
            const { pane, index, previousIndex } = payload || {};
            console.debug('[pane-hooks-test] active', {
                ts: Date.now(),
                index,
                prevIndex: previousIndex,
                mode: pane?.mode,
                thread: pane?.threadId,
            });
        });

        on('ui.pane.thread:action:changed', (payload: any) => {
            const { oldThreadId, newThreadId, messageCount } = payload || {};
            console.info('[pane-hooks-test] thread changed', {
                oldId: oldThreadId,
                newId: newThreadId,
                messages: messageCount,
            });
            try {
                useToast()?.add?.({
                    title: 'Pane Thread Changed',
                    description: `${oldThreadId || '∅'} → ${
                        newThreadId || '∅'
                    } (msgs: ${messageCount ?? 'n/a'})`,
                    duration: 2500,
                });
            } catch {}
        });

        on('ui.pane.doc:action:changed', (payload: any) => {
            const { oldDocumentId, newDocumentId } = payload || {};
            console.info('[pane-hooks-test] document changed', {
                oldId: oldDocumentId,
                newId: newDocumentId,
            });
        });
        on('ui.pane.doc:action:saved', (payload: any) => {
            const { newDocumentId, meta } = payload || {};
            console.info('[pane-hooks-test] document saved', {
                docId: newDocumentId,
                meta,
            });
        });

        function paneSnapshot(p: any) {
            return p
                ? {
                      id: p.id,
                      mode: p.mode,
                      threadId: p.threadId,
                      msgs: Array.isArray(p.messages)
                          ? p.messages.length
                          : undefined,
                  }
                : null;
        }
        on('ui.pane.msg:action:sent', (payload: any) => {
            console.debug('[pane-hooks-test] msg sent', {
                ts: Date.now(),
                pane: paneSnapshot(payload?.pane),
                message: payload?.message,
                meta: payload?.meta,
                paneIndex: payload?.paneIndex,
            });
        });
        on('ui.pane.msg:action:received', (payload: any) => {
            console.debug('[pane-hooks-test] msg received', {
                ts: Date.now(),
                pane: paneSnapshot(payload?.pane),
                message: payload?.message,
                meta: payload?.meta,
                paneIndex: payload?.paneIndex,
            });
        });

        // Cleanup on hot reload / unmount
        try {
            (nuxtApp.hook as any)('app:beforeUnmount', () => {
                for (const d of disposers) d();
                console.info('[pane-hooks-test] removed listeners');
            });
        } catch {}
    } catch (e) {
        console.error('[pane-hooks-test] initialization failed', e);
    }
});
