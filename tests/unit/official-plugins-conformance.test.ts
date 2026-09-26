import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { checkV2PackageConformance } from '../../packages/plugin-sdk/src/cli/conformance'
import { packV2Package } from '../../packages/plugin-sdk/src/cli/pack'
import { readPackageZip } from '../../packages/plugin-sdk/src/cli/archive'
import {
    parsePackagePolicy,
    parseSetupDescriptor,
    validatePortableProfile,
} from '../../packages/plugin-sdk/src/profile'
import type { PluginManifestV2 } from '../../packages/plugin-sdk/src/manifest'
import {
    verifyPluginV2Compatibility,
    type PluginV2CompatibilityManifest,
} from '../../shared/plugins/v2-compatibility'
import {
    OR3_PLUGIN_V2_GRANT_REGISTRY,
    OR3_PLUGIN_V2_HOST_CAPABILITIES,
} from '../../server/admin/plugins/v2-host-capabilities'
import { SDK_LOGIC_RPC_METHODS } from '../../shared/plugins/isolation/host-rpc-broker'
import { REMOTE_CAPABILITY_METHODS } from '../../shared/plugins/isolation/capability-bridge'
import { buildSetupPlan } from '../../shared/plugins/setup/plan'
import {
    cleanupRoots,
    fakeRegistryTransport,
    makeKey,
    PORTABLE_PROFILE,
    tempRoot,
    type RegistryArtifactFixture,
} from '../../server/utils/plugins/acquisition/__tests__/fixtures'
import { signReleaseMetadataForTest } from '../../server/utils/plugins/acquisition/release-verify'
import { PluginAcquisitionOperationStore } from '../../server/utils/plugins/acquisition/operation-store'
import { PluginAcquisitionService } from '../../server/utils/plugins/acquisition/acquisition-service'
import { RegistryClient } from '../../server/utils/plugins/acquisition/registry-client'
import type { AcquisitionConfig } from '../../server/utils/plugins/acquisition/config'
import { ORIGIN } from '../../server/utils/plugins/acquisition/__tests__/fixtures'
import { pluginPackageServices, packageGrantCandidate } from '../../server/admin/plugins/package-operation-support'
import { PluginPackageRouteCatalog } from '../../server/admin/plugins/package-route-catalog'
import { setPluginGrantReview } from '../../server/admin/plugins/workspace-plugin-store'
import type { WorkspaceSettingsStore } from '../../server/admin/stores/types'
import { loadPackageDescriptors } from '../../server/utils/plugins/setup/load-descriptors'

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

const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024

afterEach(async () => {
    await cleanupRoots()
})

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
}

function toCompatibilityManifest(manifest: PluginManifestV2): PluginV2CompatibilityManifest {
    const normalizeDependencies = (dependencies: PluginManifestV2['dependencies']['required']) =>
        dependencies.map((dependency) => ({
            id: dependency.id,
            range: dependency.range,
            features: dependency.features ?? [],
        }))
    return {
        id: manifest.id,
        engines: manifest.engines,
        requestedGrants: manifest.requestedGrants,
        features: manifest.features,
        dependencies: {
            required: normalizeDependencies(manifest.dependencies.required),
            optional: normalizeDependencies(manifest.dependencies.optional),
        },
        trust: manifest.trust,
    }
}

function memorySettings(): WorkspaceSettingsStore {
    const values = new Map<string, string>()
    return {
        async get(workspaceId, key) {
            return values.get(`${workspaceId}:${key}`) ?? null
        },
        async set(workspaceId, key, value) {
            values.set(`${workspaceId}:${key}`, value)
        },
    }
}

async function officialArtifactFixture(input: {
    readonly pluginId: string
    readonly sourceDir: string
    readonly version: string
    readonly packageRoot: string
    readonly archiveBytes: Uint8Array
    readonly treeDigest: `sha256-${string}`
    readonly manifestDigest: `sha256-${string}`
}): Promise<RegistryArtifactFixture> {
    const key = await makeKey(`official-${input.pluginId}`)
    const candidate = await packageGrantCandidate({
        packagePath: input.packageRoot,
        packageDigest: input.treeDigest,
    })
    if (!candidate.authoritySha256) throw new Error(`Missing authority for ${input.pluginId}`)
    if (!candidate.authority) throw new Error(`Missing authority descriptor for ${input.pluginId}`)
    const archiveSha256 = `sha256-${createHash('sha256').update(input.archiveBytes).digest('hex')}` as `sha256-${string}`
    const manifest = readJson(`${input.sourceDir}/or3.manifest.json`) as PluginManifestV2
    const document = {
        schemaVersion: 1 as const,
        releaseId: `rel_${input.pluginId.replaceAll('.', '-')}_${input.version}`,
        pluginId: manifest.id,
        publisherNamespace: 'or3',
        version: input.version,
        archiveSha256,
        packageTreeSha256: input.treeDigest,
        manifestSha256: input.manifestDigest,
        authoritySha256: candidate.authoritySha256,
        authority: candidate.authority,
        sourceSha256: `sha256-${'e'.repeat(64)}` as `sha256-${string}`,
        profile: PORTABLE_PROFILE,
        engines: manifest.engines,
        features: [...manifest.features.required],
        requestedGrants: [...manifest.requestedGrants],
        reviewId: 'official-conformance',
        license: 'GPL-3.0-or-later',
        publishedAt: new Date(Date.now() - 60_000).toISOString(),
    }
    const signed = await signReleaseMetadataForTest({
        document,
        keyId: key.key.keyId,
        privateKeyBase64: key.privateKeyBase64,
    })
    return {
        bytes: input.archiveBytes,
        signed,
        treeDigest: input.treeDigest,
        key: key.key,
        privateKeyBase64: key.privateKeyBase64,
        releaseId: document.releaseId,
    }
}

async function acquireOfficialArchive(input: {
    readonly fixture: RegistryArtifactFixture
    readonly pluginId: string
    readonly packageRoot: string
    readonly authoritySha256: `sha256-${string}`
    readonly requestedGrants: readonly string[]
}) {
    const extensionRoot = tempRoot('or3-official-acquisition-')
    const settings = memorySettings()
    const services = pluginPackageServices(settings, extensionRoot)
    const store = new PluginAcquisitionOperationStore(extensionRoot)
    const supportedProfiles = [PORTABLE_PROFILE]
    const registry = new RegistryClient({
        registryOrigin: ORIGIN,
        supportedProfiles,
        trustRoot: {
            releaseKeys: [input.fixture.key],
            supportedProfiles,
            hostOr3Version: '0.3.0',
            hostPluginApiVersion: '2.0.0',
            acceptedAdvisorySequence: 0,
        },
        maxArtifactBytes: MAX_ARTIFACT_BYTES,
        reserveBytes: 0,
        transport: fakeRegistryTransport({ fixture: input.fixture }),
        freeDiskBytes: async () => 1024 ** 3,
    })
    const config: AcquisitionConfig = {
        registryOrigin: ORIGIN,
        installEnabled: true,
        releaseKeys: [input.fixture.key],
        supportedTrustModes: ['isolated-client'],
        supportedProfiles,
        hostOr3Version: '0.3.0',
        hostPluginApiVersion: '2.0.0',
        maxArtifactBytes: MAX_ARTIFACT_BYTES,
        reserveBytes: 0,
    }
    const descriptors = await loadPackageDescriptors({
        extensionsBaseDir: input.packageRoot,
        packagePath: input.packageRoot,
    })
    const reviewCandidate = await packageGrantCandidate({
        packagePath: input.packageRoot,
        packageDigest: input.fixture.treeDigest,
        release: {
            releaseId: input.fixture.releaseId,
            authoritySha256: input.authoritySha256,
            authority: input.fixture.signed.authority,
        },
    })
    await setPluginGrantReview(settings, 'ws-1', input.pluginId, {
        candidate: reviewCandidate,
        approvedGrants: input.requestedGrants,
    })
    const service = new PluginAcquisitionService({
        config,
        store,
        registry,
        services,
        routeCatalog: new PluginPackageRouteCatalog(services.packages, services.pointers),
        listWorkspaceIds: async () => ['ws-1'],
        extensionsRoot: extensionRoot,
        hostCapabilities: OR3_PLUGIN_V2_HOST_CAPABILITIES,
        clientCanary: async () => ({ status: 'passed' as const }),
        setupPlan: async (_pluginId, _workspaceId, packageRoot) => {
            const packageDescriptors = await loadPackageDescriptors({
                extensionsBaseDir: extensionRoot,
                packagePath: packageRoot,
            })
            if (!packageDescriptors.policy || !packageDescriptors.setup) return null
            return buildSetupPlan({
                setup: packageDescriptors.setup,
                policy: packageDescriptors.policy,
                values: {},
                hostConnections: [],
            })
        },
    })
    const started = await service.start({
        pluginId: input.pluginId,
        version: input.fixture.signed.version,
        workspaceId: 'ws-1',
        requesterUserId: 'user-1',
        instanceId: 'instance-1',
    })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('The official package acquisition was refused')
    const operation = await service.advance(started.operation.operationId)
    expect(operation.status).toBe('completed')
    expect(operation.candidateDigest).toBe(input.fixture.treeDigest)
    expect(descriptors.problems).toEqual([])
    return operation
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

            // The archives must also pass the *host's* compatibility boundary,
            // including its real grant vocabulary: a product that requests a
            // grant the host refuses is not installable however conformant it is.
            const compatibility = verifyPluginV2Compatibility({
                manifest: toCompatibilityManifest(manifest),
                host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
                dependencies: [],
            })
            if (compatibility.status !== 'compatible') {
                throw new Error(
                    `Host compatibility blocked ${entry.dir}: ${JSON.stringify(compatibility.reasons)}`
                )
            }

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

    it('packs, verifies and acquires every official archive through the host path', async () => {
        for (const entry of PACKAGES) {
            const sourceRoot = resolve(root, entry.dir)
            const outputRoot = tempRoot('or3-official-pack-')
            const packed = await packV2Package(sourceRoot, {
                outputDirectory: join(outputRoot, 'tree'),
                archivePath: join(outputRoot, 'package.or3pkg'),
            })
            expect(packed.archivePath).toBeTruthy()
            if (!packed.archivePath) throw new Error('The SDK packer did not write an archive')

            const archiveBytes = new Uint8Array(await fs.readFile(packed.archivePath))
            const extracted = await readPackageZip(archiveBytes, {
                extractDirectory: join(outputRoot, 'extracted'),
            })
            expect(extracted.digest).toBe(packed.verification.digest)
            expect(createHash('sha256').update(archiveBytes).digest('hex')).toHaveLength(64)

            const manifest = JSON.parse(
                await fs.readFile(join(outputRoot, 'extracted', 'or3.manifest.json'), 'utf8')
            ) as PluginManifestV2
            const compatibility = verifyPluginV2Compatibility({
                manifest: toCompatibilityManifest(manifest),
                host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
                dependencies: [],
            })
            expect(compatibility.status).toBe('compatible')

            const candidate = await packageGrantCandidate({
                packagePath: packed.packRoot,
                packageDigest: packed.verification.digest,
            })
            expect(candidate.authoritySha256).toBeTruthy()
            if (!candidate.authoritySha256) throw new Error('Missing packed authority digest')

            const fixture = await officialArtifactFixture({
                pluginId: manifest.id,
                sourceDir: entry.dir,
                version: manifest.version,
                packageRoot: packed.packRoot,
                archiveBytes,
                treeDigest: packed.verification.digest,
                manifestDigest: packed.verification.manifestDigest,
            })
            const operation = await acquireOfficialArchive({
                fixture,
                pluginId: manifest.id,
                packageRoot: packed.packRoot,
                authoritySha256: candidate.authoritySha256,
                requestedGrants: manifest.requestedGrants,
            })
            expect(operation.release?.archiveSha256).toBe(fixture.signed.archiveSha256)
        }
    })

    it('keeps qualified RPC registrations tied to real method names', () => {
        const sdkMethods = new Set(Object.keys(SDK_LOGIC_RPC_METHODS))
        const remoteMethods = new Set<string>(Object.values(REMOTE_CAPABILITY_METHODS))
        for (const entry of OR3_PLUGIN_V2_GRANT_REGISTRY) {
            if (entry.status !== 'qualified' || entry.registration.kind !== 'rpc') continue
            expect(entry.registration.methods.length).toBeGreaterThan(0)
            for (const method of entry.registration.methods) {
                expect(sdkMethods.has(method) || remoteMethods.has(method)).toBe(true)
            }
        }
    })
})
