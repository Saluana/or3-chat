import { describe, expect, it, vi } from 'vitest';
import type { PluginGrantReviewSnapshot } from '../../grant-review';
import {
    createRpcRequest,
    parseRpcEnvelope,
    serializeRpcEnvelope,
} from '../rpc-envelope';
import {
    DEFAULT_IFRAME_SANDBOX,
    IFRAME_FORBIDDEN_CAPABILITIES,
    IframeIsolationRuntime,
    validateDeclarativeUiNode,
    type IsolatedIframePort,
} from '../iframe-runtime';
import type { HostRpcHandler } from '../host-rpc-broker';
import { HostSessionAuthority } from '../session-authority';

function grants(
    approved: readonly string[] = ['ui.dashboard.register']
): PluginGrantReviewSnapshot {
    return {
        requestedGrants: [...approved],
        approvedGrants: [...approved],
        revision: 'g1',
        status: 'current',
    };
}

function createFakeIframe(inbox: Array<{ message: unknown; origin: string }>) {
    const contentWindow = {
        postMessage(message: unknown, targetOrigin: string) {
            inbox.push({ message, origin: targetOrigin });
        },
    };
    const attrs = new Map<string, string>();
    let removed = false;
    const port: IsolatedIframePort = {
        contentWindow,
        setAttribute(name, value) {
            attrs.set(name, value);
        },
        remove() {
            removed = true;
        },
        addEventListener() {},
        removeEventListener() {},
    };
    return {
        port,
        attrs,
        removed: () => removed,
        contentWindow,
    };
}

describe('iframe-runtime (8.7-8.9)', () => {
    it('bootstraps a sandboxed iframe with origin policy and CSP, then tears down', async () => {
        const inbox: Array<{ message: unknown; origin: string }> = [];
        const fake = createFakeIframe(inbox);
        const runtime = new IframeIsolationRuntime({
            pluginId: 'iso.iframe',
            workspaceId: 'ws-1',
            generation: 1,
            src: 'https://plugins.local/ui.html',
            origin: 'https://plugins.local',
            grants: grants(),
            createIframe: () => fake.port,
            services: {
                contributeUi: () => ({ accepted: true }),
            },
        });

        await runtime.start();
        expect(runtime.active).toBe(true);
        expect(runtime.sandbox).toBe(DEFAULT_IFRAME_SANDBOX);
        expect(runtime.sandbox.includes('allow-same-origin')).toBe(false);
        expect(fake.attrs.get('sandbox')).toBe(DEFAULT_IFRAME_SANDBOX);
        expect(runtime.csp).toContain("connect-src 'none'");
        expect(runtime.originPolicy).toBe('https://plugins.local');
        expect(inbox[0]?.origin).toBe('https://plugins.local');

        runtime.dispose();
        expect(runtime.active).toBe(false);
        expect(fake.removed()).toBe(true);
    });

    it('accepts schema-limited declarative UI and rejects function/component transfer', async () => {
        expect(
            validateDeclarativeUiNode({
                type: 'stack',
                direction: 'column',
                children: [
                    { type: 'text', text: 'Hello' },
                    {
                        type: 'button',
                        id: 'go',
                        label: 'Go',
                        action: 'open',
                    },
                ],
            }).ok
        ).toBe(true);

        expect(
            validateDeclarativeUiNode({
                type: 'button',
                id: 'x',
                label: 'X',
                action: 'y',
                onClick: () => {},
            }).ok
        ).toBe(false);

        expect(
            validateDeclarativeUiNode({
                type: 'vue-component',
                component: { render: () => null },
            }).ok
        ).toBe(false);

        const inbox: Array<{ message: unknown; origin: string }> = [];
        const fake = createFakeIframe(inbox);
        const contributed: unknown[] = [];
        const runtime = new IframeIsolationRuntime({
            pluginId: 'iso.iframe',
            workspaceId: 'ws-1',
            generation: 1,
            src: 'https://plugins.local/ui.html',
            origin: 'https://plugins.local',
            grants: grants(),
            createIframe: () => fake.port,
            services: {
                contributeUi: (params) => {
                    contributed.push(params.node);
                    return { accepted: true };
                },
                uiEvent: (params) => ({ echoed: params }),
            },
        });
        await runtime.start();

        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'ui-1',
                    method: 'ui.contribute',
                    params: {
                        node: {
                            type: 'button',
                            id: 'b1',
                            label: 'Click',
                            action: 'ping',
                        },
                    },
                })
            )
        );
        await vi.waitFor(() => {
            expect(contributed).toHaveLength(1);
        });

        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'ui-bad',
                    method: 'ui.contribute',
                    params: {
                        node: {
                            type: 'button',
                            id: 'b2',
                            label: 'Bad',
                            action: 'x',
                            component: {},
                        },
                    },
                })
            )
        );
        await vi.waitFor(() => {
            const parsed = inbox
                .map((entry) => parseRpcEnvelope(entry.message))
                .find((p) => p.ok && p.envelope.kind === 'error' && p.envelope.id === 'ui-bad');
            expect(parsed?.ok).toBe(true);
        });

        runtime.dispose();
    });

    it('adversarial: blocks parent access list, bad origin, navigation/network methods, malformed messages, revoked grants', async () => {
        expect(IFRAME_FORBIDDEN_CAPABILITIES).toEqual(
            expect.arrayContaining([
                'window.parent',
                'window.top',
                'fetch',
                'location.assign',
            ])
        );

        const inbox: Array<{ message: unknown; origin: string }> = [];
        const fake = createFakeIframe(inbox);
        const contribute = vi.fn(() => ({ accepted: true }));
        const runtime = new IframeIsolationRuntime({
            pluginId: 'iso.iframe',
            workspaceId: 'ws-1',
            generation: 1,
            src: 'https://plugins.local/ui.html',
            origin: 'https://plugins.local',
            grants: grants(),
            createIframe: () => fake.port,
            services: { contributeUi: contribute },
        });
        await runtime.start();

        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'evil-origin',
                    method: 'ui.contribute',
                    params: {
                        node: { type: 'text', text: 'x' },
                    },
                })
            ),
            'https://evil.test'
        );
        expect(runtime.crashReports.some((r) => r.reason.includes('unexpected origin'))).toBe(
            true
        );
        expect(contribute).not.toHaveBeenCalled();

        runtime.ingestFromIframe('{not-json');
        expect(runtime.crashReports.some((r) => r.reason.includes('Malformed RPC'))).toBe(
            true
        );

        runtime.setGrants(grants([]));
        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'revoked-ui',
                    method: 'ui.contribute',
                    params: {
                        node: { type: 'text', text: 'x' },
                    },
                })
            )
        );
        await vi.waitFor(() => {
            const denied = inbox
                .map((entry) => parseRpcEnvelope(entry.message))
                .some(
                    (p) =>
                        p.ok &&
                        p.envelope.kind === 'error' &&
                        p.envelope.id === 'revoked-ui' &&
                        p.envelope.code === 'grant-denied'
                );
            expect(denied).toBe(true);
        });

        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'nav-1',
                    method: 'navigation.assign',
                    params: { url: 'https://evil.test' },
                })
            )
        );
        await vi.waitFor(() => {
            const unknown = inbox
                .map((entry) => parseRpcEnvelope(entry.message))
                .some(
                    (p) =>
                        p.ok &&
                        p.envelope.kind === 'error' &&
                        p.envelope.id === 'nav-1' &&
                        p.envelope.code === 'unknown-method'
                );
            expect(unknown).toBe(true);
        });

        expect(runtime.active).toBe(true);
        runtime.dispose();
    });

    it('round-trips allowed declarative UI events', async () => {
        const inbox: Array<{ message: unknown; origin: string }> = [];
        const fake = createFakeIframe(inbox);
        const events: unknown[] = [];
        const runtime = new IframeIsolationRuntime({
            pluginId: 'iso.iframe',
            workspaceId: 'ws-1',
            generation: 1,
            src: 'https://plugins.local/ui.html',
            origin: 'https://plugins.local',
            grants: grants(),
            createIframe: () => fake.port,
            services: {
                uiEvent: (params) => {
                    events.push(params);
                    return { ok: true };
                },
            },
        });
        await runtime.start();
        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'evt-1',
                    method: 'ui.event',
                    params: { action: 'ping', detail: { n: 1 } },
                })
            )
        );
        await vi.waitFor(() => {
            expect(events).toEqual([{ action: 'ping', detail: { n: 1 } }]);
        });
        runtime.dispose();
    });

    it('routes palette contributions only through the dedicated granted bridge', async () => {
        const inbox: Array<{ message: unknown; origin: string }> = [];
        const fake = createFakeIframe(inbox);
        const contributeCommandPalette = vi.fn<HostRpcHandler>(() => ({
            accepted: true,
        }));
        const contributeUi = vi.fn(() => ({ accepted: true }));
        const runtime = new IframeIsolationRuntime({
            pluginId: 'iso.iframe',
            workspaceId: 'ws-1',
            generation: 3,
            src: 'https://plugins.local/ui.html',
            origin: 'https://plugins.local',
            grants: grants([
                'ui.dashboard.register',
                'ui.command-palette.register',
            ]),
            createIframe: () => fake.port,
            services: {
                contributeUi,
                contributeCommandPalette,
            },
        });
        await runtime.start();
        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'palette-1',
                    method: 'ui.command-palette.contribute',
                    params: {
                        contribution: {
                            kind: 'ui.command-palette.command',
                            id: 'todo-new',
                            definition: {
                                id: 'todo-new',
                                label: 'New todo',
                            },
                        },
                    },
                })
            )
        );

        await vi.waitFor(() => {
            expect(contributeCommandPalette).toHaveBeenCalledOnce();
        });
        expect(contributeUi).not.toHaveBeenCalled();
        expect(contributeCommandPalette.mock.calls[0]?.[1]).toMatchObject({
            pluginId: 'iso.iframe',
            generation: 3,
        });
        runtime.dispose();
    });
});

describe('iframe-runtime host session binding (4.2)', () => {
    it('sends the host session in the bootstrap payload and requires it back', async () => {
        const inbox: Array<{ message: unknown; origin: string }> = [];
        const fake = createFakeIframe(inbox);
        const handler = vi.fn(async () => ({ ok: true }));
        const authority = new HostSessionAuthority({
            pluginId: 'iso.iframe',
            workspaceId: 'ws_1',
            generation: 3,
            sourceId: 'frame_1',
            generateSessionId: () => 'session-frame-1',
        });

        const runtime = new IframeIsolationRuntime({
            pluginId: 'iso.iframe',
            workspaceId: 'ws_1',
            generation: 3,
            src: '/plugin-frame.html',
            origin: 'https://cloud.example',
            grants: grants(),
            createIframe: () => fake.port,
            sessionAuthority: authority,
            services: { contributeUi: handler },
        });
        await runtime.start();

        const bootstrap = inbox.find(
            ({ message }) => parseRpcEnvelope(message).ok
        );
        const parsedBootstrap = parseRpcEnvelope(bootstrap!.message);
        expect(parsedBootstrap.ok).toBe(true);
        if (parsedBootstrap.ok && parsedBootstrap.envelope.kind === 'event') {
            expect(parsedBootstrap.envelope.payload).toMatchObject({
                session: {
                    sessionId: 'session-frame-1',
                    sourceId: 'frame_1',
                    generation: 3,
                },
            });
        }

        // A request without the host session is denied.
        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'no-session',
                    method: 'ui.contribute',
                    params: { node: { type: 'text', text: 'hi' } },
                })
            )
        );
        await vi.waitFor(() => {
            expect(runtime.crashReports.length).toBe(0);
        });
        expect(handler).not.toHaveBeenCalled();

        // A request echoing the host session from an opaque origin is accepted.
        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'with-session',
                    method: 'ui.contribute',
                    params: { node: { type: 'text', text: 'hi' } },
                    ...authority.echoFields,
                })
            ),
            'null'
        );
        await vi.waitFor(() => {
            expect(handler).toHaveBeenCalledOnce();
        });

        runtime.dispose();
        expect(authority.invalidated).toBe('host dispose');
    });

    it('aborts the running handler when the iframe cancels its own request (finding 7)', async () => {
        const inbox: Array<{ message: unknown; origin: string }> = [];
        const fake = createFakeIframe(inbox);
        let running = false;
        let aborted = false;
        const handler: HostRpcHandler = async (_params, context) => {
            running = true;
            await new Promise<void>((resolve) => {
                context.signal.addEventListener('abort', () => {
                    aborted = true;
                    resolve();
                });
            });
            return { ok: true };
        };
        const authority = new HostSessionAuthority({
            pluginId: 'iso.iframe',
            workspaceId: 'ws_1',
            generation: 1,
            sourceId: 'frame_1',
            generateSessionId: () => 'session-frame-cancel',
        });

        const runtime = new IframeIsolationRuntime({
            pluginId: 'iso.iframe',
            workspaceId: 'ws_1',
            generation: 1,
            src: '/plugin-frame.html',
            origin: 'https://cloud.example',
            grants: grants(),
            createIframe: () => fake.port,
            sessionAuthority: authority,
            services: { contributeUi: handler },
        });
        await runtime.start();

        runtime.ingestFromIframe(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'plugin-call-1',
                    method: 'ui.contribute',
                    params: { node: { type: 'text', text: 'hi' } },
                    ...authority.echoFields,
                })
            )
        );
        await vi.waitFor(() => {
            expect(running).toBe(true);
        });

        // The cancel is routed to the broker that owns this plugin→host request,
        // so the handler's signal is aborted rather than a host call being settled.
        runtime.ingestFromIframe(
            serializeRpcEnvelope({ v: 1, kind: 'cancel', id: 'plugin-call-1' })
        );
        await vi.waitFor(() => {
            expect(aborted).toBe(true);
        });

        runtime.dispose();
    });
});
