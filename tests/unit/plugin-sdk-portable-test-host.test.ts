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
                context.render(definePortableUi({ nodes: [ui.text(tone.ok ? String(tone.value) : 'none')] }))
                context.onRequest('runtime.ui-event', async (params) => {
                    const completion = await host.client.call<{ text: string }>('ai.complete', {
                        model: 'vendor/alpha',
                        prompt: 'hi',
                    })
                    return {
                        action: params.action,
                        tone: tone.ok ? tone.value : null,
                        answer: completion.ok ? completion.result.text : null,
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

        const answer = (await host.invokeRequest('runtime.ui-event', { action: 'go' })) as {
            action: string
            tone: string | null
            answer: string | null
        }
        expect(answer).toEqual({ action: 'go', tone: 'plain', answer: 'Answer' })
        // Settings reads happen through the same mediated channel as capabilities.
        expect(host.calls.map((call) => call.method)).toEqual(['settings.get', 'ai.complete'])
        expect(host.calls[1]).toMatchObject({ method: 'ai.complete', params: { model: 'vendor/alpha', prompt: 'hi' } })
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
        expect(await host.client.call('nope.method')).toMatchObject({ ok: false, code: 'not-found' })
    })
})
