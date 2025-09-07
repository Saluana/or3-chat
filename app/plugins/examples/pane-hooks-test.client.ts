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
        on('ui.pane.blur:action', (pane: any, index: number) => {
            console.debug('[pane-hooks-test] blur', {
                ts: Date.now(),
                index,
                id: pane?.id,
                mode: pane?.mode,
                thread: pane?.threadId,
            });
        });
        on('ui.pane.switch:action', (pane: any, index: number) => {
            console.debug('[pane-hooks-test] switch', {
                ts: Date.now(),
                index,
                threadId: pane?.threadId,
                doc: pane?.documentId,
                msgs: Array.isArray(pane?.messages)
                    ? pane.messages.length
                    : undefined,
            });
        });
        on(
            'ui.pane.active:action',
            (pane: any, index: number, prevIndex: number) => {
                console.debug('[pane-hooks-test] active', {
                    ts: Date.now(),
                    index,
                    prevIndex,
                    mode: pane?.mode,
                    thread: pane?.threadId,
                });
            }
        );

        on(
            'ui.pane.thread:action:changed',
            (pane: any, oldId: string, newId: string, count: number) => {
                console.info('[pane-hooks-test] thread changed', {
                    oldId,
                    newId,
                    messages: count,
                });
                try {
                    useToast()?.add?.({
                        title: 'Pane Thread Changed',
                        description: `${oldId || '∅'} → ${
                            newId || '∅'
                        } (msgs: ${count})`,
                        duration: 2500,
                    });
                } catch {}
            }
        );

        on(
            'ui.pane.doc:action:changed',
            (pane: any, oldId: string, newId: string) => {
                console.info('[pane-hooks-test] document changed', {
                    oldId,
                    newId,
                });
            }
        );
        on('ui.pane.doc:action:saved', (pane: any, docId: string) => {
            console.info('[pane-hooks-test] document saved', { docId });
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
        on('ui.pane.msg:action:sent', (pane: any, payload: any) => {
            console.debug('[pane-hooks-test] msg sent', {
                ts: Date.now(),
                pane: paneSnapshot(pane),
                ...payload,
            });
        });
        on('ui.pane.msg:action:received', (pane: any, payload: any) => {
            console.debug('[pane-hooks-test] msg received', {
                ts: Date.now(),
                pane: paneSnapshot(pane),
                ...payload,
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
