import { describe, expect, it } from 'vitest'
import {
    HOST_CAPABILITY_METHODS,
    completeWithHostModel,
    listHostModels,
    type HostCall,
} from '../../packages/plugin-sdk/src/host-capabilities'

/**
 * Phase 9 (R8.AC5, R20.AC1): the SDK's typed view of the host AI surface. The
 * host owns the provider credential, the allowlist and the prices; the plugin
 * receives a disclosure and a governed completion, and every refusal keeps its
 * meaning instead of becoming a silent empty result.
 */
describe('plugin SDK host capabilities', () => {
    function fakeCall(
        responses: Record<string, { ok: true; result: unknown } | { ok: false; code: string; message: string }>,
    ): { call: HostCall; methods: string[] } {
        const methods: string[] = []
        const call: HostCall = async (method) => {
            methods.push(method)
            return (responses[method] ?? { ok: false, code: 'unavailable', message: 'no route' }) as never
        }
        return { call, methods }
    }

    it('returns the approved catalog with its disclosed prices and limits', async () => {
        const { call, methods } = fakeCall({
            [HOST_CAPABILITY_METHODS.models]: {
                ok: true,
                result: {
                    configured: true,
                    models: [
                        { id: 'vendor/alpha', label: 'alpha', priced: true, promptPerMillion: 3, completionPerMillion: 15 },
                        { id: 'vendor/beta', label: 'beta', priced: false, promptPerMillion: null, completionPerMillion: null },
                    ],
                    limits: { maxOutputTokens: 2048, spendLimitUsd: 0.5, maxConcurrentCalls: 4, deadlineMs: 30_000 },
                },
            },
        })
        const result = await listHostModels(call)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value.configured).toBe(true)
        expect(result.value.models).toHaveLength(2)
        expect(result.value.models[1]).toMatchObject({ id: 'vendor/beta', priced: false })
        expect(result.value.limits).toMatchObject({ maxOutputTokens: 2048, spendLimitUsd: 0.5 })
        expect(methods).toEqual([HOST_CAPABILITY_METHODS.models])
    })

    it('reports an unconfigured host instead of inventing models', async () => {
        const { call } = fakeCall({
            [HOST_CAPABILITY_METHODS.models]: {
                ok: true,
                result: { configured: false, models: [], limits: {} },
            },
        })
        const result = await listHostModels(call)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value.configured).toBe(false)
        expect(result.value.models).toEqual([])
    })

    it('completes on a host model and preserves attribution usage', async () => {
        const { call, methods } = fakeCall({
            [HOST_CAPABILITY_METHODS.complete]: {
                ok: true,
                result: {
                    text: 'Hello',
                    model: 'vendor/alpha',
                    usage: { promptTokens: 10, completionTokens: 5, spendUsd: 0.00012 },
                },
            },
        })
        const result = await completeWithHostModel(call, { model: 'vendor/alpha', prompt: 'Hi' })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value.usage.spendUsd).toBeCloseTo(0.00012)
        expect(methods).toEqual([HOST_CAPABILITY_METHODS.complete])
    })

    it('keeps refusal codes meaningful', async () => {
        const { call } = fakeCall({
            [HOST_CAPABILITY_METHODS.complete]: { ok: false, code: 'budget-exceeded', message: 'no budget' },
        })
        const refused = await completeWithHostModel(call, { model: 'vendor/alpha', prompt: 'Hi' })
        expect(refused.ok).toBe(false)
        if (refused.ok) return
        expect(refused.error.code).toBe('quota-exceeded')
        expect(refused.error.message).toBe('no budget')
    })

    it('maps every structured host refusal to its own SDK error, never all to permission-denied', async () => {
        const cases: ReadonlyArray<[string, string, boolean]> = [
            ['permission-denied', 'permission-denied', false],
            ['policy-denied', 'permission-denied', false],
            ['invalid-input', 'invalid-input', false],
            ['not-found', 'not-found', false],
            ['conflict', 'conflict', false],
            ['internal', 'internal', false],
            ['deadline-exceeded', 'timeout', true],
            ['cancelled', 'aborted', false],
            ['network-failure', 'network-error', true],
            ['unavailable', 'host-unavailable', true],
        ]
        for (const [hostCode, sdkCode, retryable] of cases) {
            const { call } = fakeCall({
                [HOST_CAPABILITY_METHODS.complete]: { ok: false, code: hostCode, message: hostCode },
            })
            const refused = await completeWithHostModel(call, { model: 'vendor/alpha', prompt: 'Hi' })
            expect(refused.ok).toBe(false)
            if (refused.ok) continue
            expect(refused.error, hostCode).toMatchObject({ code: sdkCode, retryable })
        }
    })

    it('maps an unrecognized host code to internal rather than a permission problem', async () => {
        const { call } = fakeCall({
            [HOST_CAPABILITY_METHODS.models]: { ok: false, code: 'who-knows', message: 'odd' },
        })
        const result = await listHostModels(call)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.code).toBe('internal')
    })

    it('refuses an unusable completion rather than reporting success', async () => {
        const { call } = fakeCall({
            [HOST_CAPABILITY_METHODS.complete]: { ok: true, result: { text: 'Hello' } },
        })
        const result = await completeWithHostModel(call, { model: 'vendor/alpha', prompt: 'Hi' })
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.code).toBe('internal')
    })
})
