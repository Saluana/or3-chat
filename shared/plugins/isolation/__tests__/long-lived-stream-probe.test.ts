import { describe, expect, it } from 'vitest';
import {
    ContainmentBudgetLedger,
    resolveContainmentBudgets,
} from '../budgets';

/**
 * Qualification probe for the future network.stream profile. This intentionally
 * records today's limits before a stream adapter is implemented: transport
 * lifetime may become rolling, while callback execution, output, calls and AI
 * spend stay bounded and revocation remains terminal.
 */
describe('long-lived stream budget probe', () => {
    it('shows the activation wall is the limit that blocks an all-day stream', () => {
        let now = 0;
        const ledger = new ContainmentBudgetLedger(
            resolveContainmentBudgets({
                maxActivationMs: 120_000,
                maxCallsPerActivation: 4,
                maxTotalOutputBytes: 256,
                maxAiSpendUsd: 0.5,
            }),
            { now: () => now }
        );

        expect(ledger.checkActivation()).toMatchObject({ ok: true });
        now = 120_001;
        expect(ledger.checkActivation()).toMatchObject({
            ok: false,
            kind: 'activation-ms',
            terminate: true,
        });
        expect(ledger.chargeOutput('small')).toMatchObject({ ok: true });
        expect(ledger.chargeAiUsage({ spendUsd: 0.25, outputTokens: 10 })).toMatchObject({ ok: true });
        expect(ledger.chargeAiUsage({ spendUsd: 0.3, outputTokens: 10 })).toMatchObject({
            ok: false,
            kind: 'ai-spend',
            terminate: true,
        });
    });

    it('keeps callback/concurrency and cumulative output limits bounded', () => {
        const ledger = new ContainmentBudgetLedger(
            resolveContainmentBudgets({
                maxConcurrentCalls: 1,
                maxTotalOutputBytes: 32,
            })
        );
        expect(ledger.admitCall()).toMatchObject({ ok: true });
        expect(ledger.admitCall()).toMatchObject({
            ok: false,
            kind: 'concurrency',
            terminate: false,
        });
        expect(ledger.chargeOutput('x'.repeat(24))).toMatchObject({ ok: true });
        expect(ledger.chargeOutput('y'.repeat(24))).toMatchObject({
            ok: false,
            kind: 'total-output-bytes',
            terminate: true,
        });
        ledger.releaseCall();
    });
});
