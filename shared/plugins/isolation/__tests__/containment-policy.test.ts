import { describe, expect, it } from 'vitest';
import {
    assertNoContainmentRelaxation,
    CONTAINMENT_PROBE_CHANNELS,
    evaluateContainmentAttempt,
    PORTABLE_FRAME_CSP,
    PORTABLE_FRAME_SANDBOX,
    PORTABLE_IFRAME_CONTAINMENT,
    PORTABLE_WORKER_CSP,
    PORTABLE_WORKER_CONTAINMENT,
    type ContainmentChannel,
    type ContainmentPolicy,
} from '../containment-policy';
import {
    ContainmentBudgetLedger,
    DEFAULT_CONTAINMENT_BUDGETS,
    describeBudgetTermination,
    resolveContainmentBudgets,
    validateUiTreeBudgets,
} from '../budgets';
import {
    HostSessionAuthority,
} from '../session-authority';

describe('containment policy (4.3)', () => {
    it('denies or mediates every ambient channel without allowing one outright', () => {
        for (const policy of [PORTABLE_WORKER_CONTAINMENT, PORTABLE_IFRAME_CONTAINMENT]) {
            expect(policy.channels.length).toBeGreaterThan(20);
            for (const decision of policy.channels) {
                expect(['denied', 'mediated']).toContain(decision.disposition);
            }
        }
    });

    it('never weakens the sandbox CSP or sandbox attribute', () => {
        expect(assertNoContainmentRelaxation(PORTABLE_IFRAME_CONTAINMENT)).toEqual({
            ok: true,
        });
        expect(PORTABLE_FRAME_SANDBOX).not.toContain('allow-same-origin');
        expect(PORTABLE_FRAME_CSP).not.toContain('unsafe');
        // The opaque origin is the storage boundary, so the CSP must carry the
        // sandbox directive and must not permit remote or data: scripts.
        expect(PORTABLE_FRAME_CSP).toContain('sandbox allow-scripts');
        expect(PORTABLE_FRAME_CSP).toContain("connect-src 'none'");
        expect(PORTABLE_FRAME_CSP).toContain('blob:');
        expect(PORTABLE_FRAME_CSP).toContain("'sha256-");
    });

    it('detects each deliberate relaxation of the policy', () => {
        const relaxations: Array<[Partial<ContainmentPolicy>, string]> = [
            [{ sandbox: 'allow-scripts allow-same-origin' }, 'sandbox-allows-same-origin'],
            [
                {
                    csp: PORTABLE_WORKER_CSP.replace(
                        /script-src '[^']+' blob:/,
                        "script-src 'unsafe-eval' blob:"
                    ),
                },
                'csp-unsafe-eval',
            ],
            [
                {
                    csp: PORTABLE_WORKER_CSP.replace(
                        /script-src '[^']+' blob:/,
                        "script-src 'sha256-abc' 'unsafe-inline' blob:"
                    ),
                },
                'csp-unsafe-inline',
            ],
            [
                { csp: PORTABLE_WORKER_CSP.replace("connect-src 'none'", 'connect-src *') },
                'csp-connect-src-open',
            ],
            [
                {
                    csp: PORTABLE_WORKER_CSP.replace(
                        'worker-src blob:',
                        'worker-src https://cdn.example'
                    ),
                },
                'csp-worker-src-open',
            ],
            [
                {
                    csp: PORTABLE_WORKER_CSP.replace(
                        /script-src '[^']+' blob:/,
                        'script-src https://cdn.example'
                    ),
                },
                'csp-remote-script',
            ],
            [
                {
                    csp: PORTABLE_WORKER_CSP.replace(
                        /script-src '[^']+' blob:/,
                        'script-src data:'
                    ),
                },
                'csp-remote-script',
            ],
            [
                {
                    csp: PORTABLE_WORKER_CSP.replace(
                        /script-src '[^']+' blob:/,
                        'script-src blob:'
                    ),
                },
                'csp-remote-script',
            ],
            [
                { csp: PORTABLE_WORKER_CSP.replace('sandbox allow-scripts', '') },
                'csp-sandbox-missing',
            ],
            [{ csp: 'script-src *' }, 'csp-missing-default-none'],
        ];

        for (const [patch, expectedCode] of relaxations) {
            const candidate = {
                ...PORTABLE_WORKER_CONTAINMENT,
                ...patch,
                channels: patch.channels ?? PORTABLE_WORKER_CONTAINMENT.channels,
            } as ContainmentPolicy;
            const result = assertNoContainmentRelaxation(candidate);
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.violations.map((entry) => entry.code)).toContain(expectedCode);
        }
    });

    it('reports a structured denial for every adversarial channel (RT04, RT05)', () => {
        const attempted: ContainmentChannel[] = [
            'dom.parent',
            'dom.frameElement',
            'dom.hostDocument',
            'storage.cookies',
            'storage.localStorage',
            'storage.sessionStorage',
            'network.xmlHttpRequest',
            'network.webSocket',
            'network.eventSource',
            'network.sendBeacon',
            'imports.importScripts',
            'imports.dynamicRemote',
            'imports.hostInternal',
            'workers.nested',
            'workers.shared',
            'workers.service',
            'navigation.frame',
            'navigation.windowOpen',
            'navigation.location',
            'ambient.clipboard',
            'ambient.geolocation',
            'ambient.notifications',
            'code.eval',
        ];
        for (const channel of attempted) {
            const outcome = evaluateContainmentAttempt(PORTABLE_WORKER_CONTAINMENT, channel);
            expect(outcome.status).toBe('denied');
            if (outcome.status === 'denied') {
                expect(outcome.code).toBe('containment-denied');
                expect(outcome.message).toContain(channel);
            }
        }
    });

    it('routes the two mediated capabilities through named host methods', () => {
        const fetchAttempt = evaluateContainmentAttempt(
            PORTABLE_WORKER_CONTAINMENT,
            'network.fetch'
        );
        expect(fetchAttempt).toMatchObject({
            status: 'mediated',
            mediatedBy: 'http.request',
        });
        const storageAttempt = evaluateContainmentAttempt(
            PORTABLE_WORKER_CONTAINMENT,
            'storage.indexedDB'
        );
        expect(storageAttempt).toMatchObject({ status: 'mediated' });
    });

    it('keeps an opaque-origin frame from being trusted by origin alone', () => {
        const authority = new HostSessionAuthority({
            pluginId: 'iso.frame',
            workspaceId: 'ws_1',
            generation: 1,
            sourceId: 'frame-src-1',
            generateSessionId: () => 'fixed-session',
        });
        // origin=null with a forged session is denied ...
        expect(
            authority.verifyInbound({
                sessionId: 'fixed-session-other',
                sourceId: 'frame-src-1',
                generation: 1,
                origin: null,
            })
        ).toMatchObject({ status: 'denied' });
        // ... and with the real host session it is accepted.
        expect(
            authority.verifyInbound({ ...authority.echoFields, origin: null })
        ).toMatchObject({ status: 'authorized' });
    });

    it('documents the deprecated worker-only transport honestly', () => {
        // A worker created directly by the host page shares the host origin and
        // can reach IndexedDB; measurement in Chromium confirmed this, which is
        // why the opaque-origin frame is the shipped transport.
        expect(PORTABLE_WORKER_CONTAINMENT.transport).toBe('worker');
        expect(PORTABLE_IFRAME_CONTAINMENT.transport).toBe('iframe');
        expect(PORTABLE_IFRAME_CONTAINMENT.sandbox).toBe('allow-scripts');
    });

    it('lists the channels the real-browser probe must exercise', () => {
        expect(CONTAINMENT_PROBE_CHANNELS).toContain('dom.hostDocument');
        expect(CONTAINMENT_PROBE_CHANNELS).toContain('network.webSocket');
        expect(CONTAINMENT_PROBE_CHANNELS).toContain('workers.nested');
        expect(CONTAINMENT_PROBE_CHANNELS).toContain('imports.importScripts');
    });
});

describe('containment budgets (4.4)', () => {
    it('records the budgets once and rejects nonsensical overrides', () => {
        expect(DEFAULT_CONTAINMENT_BUDGETS.maxMessageBytes).toBe(256 * 1024);
        expect(resolveContainmentBudgets({ maxCallsPerActivation: 5 }).maxCallsPerActivation).toBe(5);
        expect(() => resolveContainmentBudgets({ maxOutputBytes: 0 })).toThrow();
        expect(() =>
            resolveContainmentBudgets({ maxActivationMs: Number.NaN })
        ).toThrow();
    });

    it('rejects oversized messages, results and cumulative output', () => {
        const budgets = resolveContainmentBudgets({
            maxMessageBytes: 64,
            maxOutputBytes: 64,
            maxTotalOutputBytes: 100,
        });
        const ledger = new ContainmentBudgetLedger(budgets);

        expect(ledger.chargeMessage('small')).toMatchObject({ ok: true });
        expect(ledger.chargeMessage('x'.repeat(65))).toMatchObject({
            ok: false,
            code: 'budget-exceeded',
            kind: 'message-bytes',
            terminate: true,
        });

        expect(ledger.chargeOutput({ value: 'ok' })).toMatchObject({ ok: true });
        expect(ledger.chargeOutput({ value: 'y'.repeat(200) })).toMatchObject({
            ok: false,
            kind: 'output-bytes',
        });
        // A result inside the per-result cap still trips the cumulative cap.
        const cumulative = new ContainmentBudgetLedger(
            resolveContainmentBudgets({
                maxOutputBytes: 100,
                maxTotalOutputBytes: 120,
            })
        );
        expect(cumulative.chargeOutput({ value: 'a'.repeat(80) })).toMatchObject({
            ok: true,
        });
        expect(cumulative.chargeOutput({ value: 'b'.repeat(80) })).toMatchObject({
            ok: false,
            kind: 'total-output-bytes',
        });
    });

    it('bounds call count, concurrency and activation age (RT10)', () => {
        let clock = 0;
        const budgets = resolveContainmentBudgets({
            maxCallsPerActivation: 3,
            maxConcurrentCalls: 2,
            maxActivationMs: 100,
        });
        const ledger = new ContainmentBudgetLedger(budgets, { now: () => clock });

        expect(ledger.admitCall()).toMatchObject({ ok: true });
        expect(ledger.admitCall()).toMatchObject({ ok: true });
        // Third concurrent call is refused without terminating (backpressure).
        expect(ledger.admitCall()).toMatchObject({
            ok: false,
            kind: 'concurrency',
            terminate: false,
        });
        ledger.releaseCall();
        ledger.releaseCall();
        expect(ledger.admitCall()).toMatchObject({ ok: true });
        expect(ledger.admitCall()).toMatchObject({
            ok: false,
            kind: 'calls',
            terminate: true,
        });

        const expired = new ContainmentBudgetLedger(budgets, { now: () => clock });
        clock = 101;
        expect(expired.admitCall()).toMatchObject({
            ok: false,
            kind: 'activation-ms',
            terminate: true,
        });
    });

    it('caps plugin-attributed AI spend and output tokens', () => {
        const ledger = new ContainmentBudgetLedger(
            resolveContainmentBudgets({
                maxAiSpendUsd: 0.5,
                maxAiOutputTokens: 100,
            })
        );
        expect(
            ledger.chargeAiUsage({ spendUsd: 0.25, outputTokens: 50 })
        ).toMatchObject({ ok: true });
        expect(
            ledger.chargeAiUsage({ spendUsd: 0.4, outputTokens: 50 })
        ).toMatchObject({ ok: false, kind: 'ai-spend', terminate: true });

        const tokens = new ContainmentBudgetLedger();
        expect(
            tokens.chargeAiUsage({ spendUsd: 0, outputTokens: 10_000 })
        ).toMatchObject({ ok: false, kind: 'ai-output-tokens' });
    });

    it('bounds UI tree depth, node count and text size', () => {
        const budgets = resolveContainmentBudgets({
            maxUiTreeDepth: 3,
            maxUiTreeNodes: 6,
            maxUiTextBytes: 32,
        });

        let deep: Record<string, unknown> = { type: 'text', text: 'leaf' };
        for (let index = 0; index < 4; index += 1) {
            deep = { type: 'box', children: [deep] };
        }
        expect(validateUiTreeBudgets(deep, budgets)).toMatchObject({
            ok: false,
            kind: 'ui-tree-depth',
        });

        const wide = {
            type: 'stack',
            direction: 'column',
            children: Array.from({ length: 8 }, () => ({ type: 'text', text: 'x' })),
        };
        expect(validateUiTreeBudgets(wide, budgets)).toMatchObject({
            ok: false,
            kind: 'ui-tree-nodes',
        });

        const verbose = { type: 'text', text: 'z'.repeat(40) };
        expect(validateUiTreeBudgets(verbose, budgets)).toMatchObject({
            ok: false,
            kind: 'ui-text-bytes',
        });

        expect(
            validateUiTreeBudgets(
                { type: 'box', children: [{ type: 'text', text: 'ok' }] },
                budgets
            )
        ).toMatchObject({ ok: true, nodes: 2, depth: 2 });
    });

    it('explains whether a breach terminates or merely refuses work', () => {
        const ledger = new ContainmentBudgetLedger(
            resolveContainmentBudgets({ maxConcurrentCalls: 1 })
        );
        ledger.admitCall();
        const refusal = ledger.admitCall();
        expect(refusal.ok).toBe(false);
        if (refusal.ok) return;
        expect(describeBudgetTermination(refusal)).toContain('stays running');

        const hard = new ContainmentBudgetLedger(
            resolveContainmentBudgets({ maxMessageBytes: 4 })
        );
        const fatal = hard.chargeMessage('too long');
        expect(fatal.ok).toBe(false);
        if (fatal.ok) return;
        expect(describeBudgetTermination(fatal)).toContain('was stopped');
        expect(hard.exceeded).toBe('message-bytes');
    });
});

describe('UI tree content budgets (review 13)', () => {
    it('counts cell, label and field content, not just node.text', () => {
        // Table cells are the largest content a renderer shows: one "node with no
        // text" previously. Size the rows from the recorded ceiling so this keeps
        // testing the counting rule rather than a frozen byte budget.
        const budgets = resolveContainmentBudgets();
        const cell = 'x'.repeat(512);
        const rows = Math.ceil(budgets.maxUiTextBytes / cell.length) + 4;
        const table = {
            type: 'table',
            columns: [
                { key: 'a', label: 'A' },
                { key: 'b', label: 'B' },
            ],
            rows: Array.from({ length: rows }, () => ({ a: cell, b: cell })),
        };
        const breached = validateUiTreeBudgets(table, budgets);
        expect(breached).toMatchObject({ ok: false, kind: 'ui-text-bytes' });
    });

    it('counts items so a huge data set cannot hide behind few nodes', () => {
        const budgets = resolveContainmentBudgets({ maxUiTreeItems: 32 });
        const list = {
            type: 'list',
            items: Array.from({ length: 40 }, (_, index) => ({ label: `item ${index}` })),
        };
        expect(validateUiTreeBudgets(list, budgets)).toMatchObject({
            ok: false,
            kind: 'ui-tree-items',
        });
    });

    it('counts markdown, options, placeholders and field values', () => {
        const budgets = resolveContainmentBudgets({ maxUiTextBytes: 40 });
        const options = {
            type: 'field.select',
            id: 'choice',
            label: 'Choice',
            value: 'a',
            options: [
                { label: 'x'.repeat(32), value: 'a' },
                { label: 'y'.repeat(32), value: 'b' },
            ],
        };
        expect(validateUiTreeBudgets(options, budgets)).toMatchObject({
            ok: false,
            kind: 'ui-text-bytes',
        });
    });

    it('still accepts a small tree and reports items', () => {
        const result = validateUiTreeBudgets({
            type: 'box',
            children: [{ type: 'text', text: 'hello' }],
        });
        expect(result).toMatchObject({ ok: true, nodes: 2, depth: 2, textBytes: 5 });
    });
});
