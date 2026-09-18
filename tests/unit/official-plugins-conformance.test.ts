import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { checkV2PackageConformance } from '../../packages/plugin-sdk/src/cli/conformance'
import {
    parsePackagePolicy,
    parseSetupDescriptor,
    validatePortableProfile,
} from '../../packages/plugin-sdk/src/profile'
import type { PluginManifestV2 } from '../../packages/plugin-sdk/src/manifest'

/**
 * Phase 9 (task 9.7): the three official packages stay conformant and keep
 * their declared first actions, so the recorded evidence cannot silently drift.
 */
const PACKAGES = [
    { dir: 'official-plugins/or3-model-compare', sample: 'fixtures/sample-prompt.md' },
    { dir: 'official-plugins/or3-prompt-workbench', sample: 'fixtures/sample-selection.txt' },
    { dir: 'official-plugins/or3-document-utilities', sample: null },
] as const

const root = resolve(import.meta.dirname, '../..')

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
}

describe('official plugin packages', () => {
    for (const entry of PACKAGES) {
        it(`${entry.dir} is conformant with a coherent setup descriptor`, async () => {
            const manifest = readJson(`${entry.dir}/or3.manifest.json`) as PluginManifestV2
            const policy = parsePackagePolicy(readJson(`${entry.dir}/or3.package-policy.json`))
            const setup = parseSetupDescriptor(readJson(`${entry.dir}/or3.setup.json`))
            expect(policy.problems).toEqual([])
            expect(setup.problems).toEqual([])

            const profile = validatePortableProfile({ manifest, policy: policy.value, setup: setup.value })
            expect(profile.filter((problem) => problem.severity === 'error')).toEqual([])

            const conformance = await checkV2PackageConformance(resolve(root, entry.dir))
            // The CLI verdict is the same one task 9.7 records: conformant, not
            // merely free of errors in the findings list.
            expect(conformance.status).toBe('conformant')
            expect(conformance.issues).toEqual([])

            const firstAction = setup.value?.firstAction
            expect(firstAction?.operationId).toBeTruthy()
            if (entry.sample) {
                // A sample first action must name a file that exists in the package.
                expect(firstAction?.usesSampleContext).toBe(true)
                expect(firstAction?.samplePath).toBe(entry.sample)
                const sample = readFileSync(resolve(root, entry.dir, entry.sample), 'utf8')
                expect(sample.trim().length).toBeGreaterThan(40)
            } else {
                expect(firstAction?.usesSampleContext).toBe(false)
                expect(firstAction?.samplePath).toBeUndefined()
            }
        })
    }

    it('keeps the committed descriptors byte-identical to the authoring config', () => {
        for (const entry of PACKAGES) {
            // Running the documented guard is the strongest check: it fails with
            // the exact file that drifted instead of re-deriving it here.
            const output = execFileSync('bun', ['.authoring/generate.mjs', '--check'], {
                cwd: resolve(root, entry.dir),
                encoding: 'utf8',
            })
            expect(output).toContain('match the authoring config')
        }
    })

    it('keeps every required generated descriptor committed', () => {
        for (const entry of PACKAGES) {
            const manifest = readJson(`${entry.dir}/or3.manifest.json`) as { features: { required: string[] } }
            expect(manifest.features.required).toContain('or3-portable-client-v1')
            expect(readFileSync(resolve(root, `${entry.dir}/LICENSE`), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE')
            expect(readFileSync(resolve(root, `${entry.dir}/THIRD_PARTY_NOTICES`), 'utf8')).toContain('GPL-3.0')
        }
    })
})
