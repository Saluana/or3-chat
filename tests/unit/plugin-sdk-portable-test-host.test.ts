import { describe, expect, it } from 'vitest'
import { createPortablePlugin } from '../../packages/plugin-sdk/src/portable-runtime'
import { createPortableTestHost } from '../../packages/plugin-sdk/src/testing'
import { defineOr3Plugin } from '../../packages/plugin-sdk/src/contracts'
import { definePortableUi, ui } from '../../packages/plugin-sdk/src/ui'
import type { PluginManifestV2 } from '../../packages/plugin-sdk/src/manifest'

/**
 * Phase 9 (SDK/Profile): package tests run the real portable plugin path with a
 * host stand-in, so a product's rendering, capability calls and host requests
 * are exercised exactly as the sandbox would run them.
 */
const manifest: PluginManifestV2 = {
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.test-portable',
    name: 'Portable test package',
    version: '1.0.0',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' } },
    requestedGrants: ['network.http', 'settings.read', 'settings.write'],
    features: { required: ['or3-portable-client-v1'], optional: [] },
    dependencies: { required: [], optional: [] },
    trust: 'isolated-client',
    settings: { version: 1 },
    stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
}

describe('portable test host', () => {
    it('runs a portable package to activation and answers host requests', async () => {
        const host = createPortableTestHost({
            approvedGrants: ['network.http', 'settings.read', 'settings.write'],
            responses: {
                'ai.models': {
                    configured: true,
                    models: [{ id: 'vendor/alpha', label: 'alpha', priced: false }],
                    limits: { maxOutputTokens: 128, spendLimitUsd: 1, maxConcurrentCalls: 1, deadlineMs: 5_000 },
                },
                'ai.complete': {
                    text: 'Answer',
                    model: 'vendor/alpha',
                    usage: { promptTokens: 1, completionTokens: 2, spendUsd: 0.001 },
                },
            },
            initialSettings: { tone: 'plain' },
        })
        const definition = defineOr3Plugin({
            manifest,
            async setup(context) {
                context.features.require('or3-portable-client-v1')
                const tone = await context.settings.get<string>('tone')
                const models = await context.ai.models()
                const completion = await context.ai.complete({ model: 'vendor/alpha', prompt: 'hi' })
                context.render(definePortableUi({ nodes: [ui.text(tone.ok ? String(tone.value) : 'none')] }))
                context.onRequest('runtime.ui-event', async (params) => {
                    return {
                        action: params.action,
                        tone: tone.ok ? tone.value : null,
                        configured: models.ok ? models.value.configured : false,
                        answer: completion.ok ? completion.value.text : null,
                    }
                })
            },
        })
        const handle = createPortablePlugin(definition, { client: host.client, bootstrap: host.bootstrap })
        await handle.ready

        expect(host.renders).toHaveLength(1)
        expect(host.renders[0]?.nodes[0]).toMatchObject({ type: 'text', text: 'plain' })
        expect(host.events.some((event) => event.name === 'runtime.bootstrap.ready')).toBe(true)
        expect(host.hasRequestHandler('runtime.ui-event')).toBe(true)

        const answer = await host.invokeRequest('runtime.ui-event', { action: 'go' })
        expect(answer).toEqual({
            ok: true,
            result: { action: 'go', tone: 'plain', configured: true, answer: 'Answer' },
        })
        // Settings reads happen through the same mediated channel as capabilities.
        expect(host.calls.map((call) => call.method)).toEqual(['settings.get', 'ai.models', 'ai.complete'])
        expect(host.calls[2]).toMatchObject({ method: 'ai.complete', params: { model: 'vendor/alpha', prompt: 'hi' } })
    })

    it('records capability calls and reports an unconfigured response as a refusal', async () => {
        const host = createPortableTestHost({
            approvedGrants: ['network.http'],
            responses: { 'ai.models': { configured: true, models: [], limits: {} } },
        })
        const definition = defineOr3Plugin({ manifest, async setup() {} })
        createPortablePlugin(definition, { client: host.client, bootstrap: host.bootstrap })
        await Promise.resolve()

        expect(await host.client.call('ai.models')).toMatchObject({ ok: true })
        expect(host.calls[0]).toMatchObject({ method: 'ai.models' })
        expect(await host.client.call('nope.method')).toMatchObject({ ok: false, code: 'unknown-method' })
    })

    it('supports create-if-absent CAS and deterministic cursor ordering', async () => {
        const host = createPortableTestHost({
            approvedGrants: ['storage.read', 'storage.write'],
            initialStorage: { 'a-10': 10, 'a-2': 2, 'a-A': 1 },
        })

        expect(await host.client.call('storage.set', {
            key: 'new',
            value: 'created',
            ifRevision: null,
        })).toMatchObject({ ok: true })
        expect(await host.client.call('storage.set', {
            key: 'new',
            value: 'overwrite',
            ifRevision: null,
        })).toMatchObject({ ok: false, code: 'conflict' })

        const first = await host.client.call<{ entries: readonly { key: string }[]; nextCursor?: string }>(
            'storage.listPage',
            { prefix: 'a-', limit: 1 }
        )
        expect(first).toMatchObject({ ok: true, result: { entries: [{ key: 'a-10' }], nextCursor: 'cursor:a-10' } })
        const nextCursor = first.ok ? first.result.nextCursor : undefined
        expect(await host.client.call('storage.listPage', {
            prefix: 'a-',
            limit: 10,
            cursor: nextCursor,
        })).toMatchObject({ ok: true, result: { entries: [{ key: 'a-2' }, { key: 'a-A' }] } })
    })
})


describe('portable method dispatch parity', () => {
    it('does not run suffix lookalikes without a registered method', async () => {
        const host = createPortableTestHost({ initialStorage: { private: 'secret' } });
        for (const method of ['storage.extra.get', 'storage.extra.set', 'settings.extra.delete']) {
            expect(await host.client.call(method, { key: 'private', value: 'overwrite' }))
                .toMatchObject({ ok: false, code: 'unknown-method' });
        }
        expect(host.storage.get('private')).toBe('secret');
    });

    it('uses JSON wire values and returns the current revision on conflicts', async () => {
        const host = createPortableTestHost({ approvedGrants: ['storage.read', 'storage.write'] });
        await host.client.call('storage.set', { key: 'value', value: { ignored: undefined, number: NaN } });
        expect(await host.client.call('storage.get', { key: 'value' }))
            .toMatchObject({ ok: true, result: { value: { number: null } } });
        expect(host.storage.get('value')).toEqual({ number: null });
        expect(await host.client.call('storage.set', { key: 'value', value: 1, ifRevision: 0 }))
            .toMatchObject({ ok: false, code: 'conflict', details: { currentRevision: 1 } });
    });
});
