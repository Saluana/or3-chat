import {
    decideTrustedHostUi,
    type HostEsmFacadeBlockCode,
    type HostEsmFacadeEvidence,
    type TrustedHostUiDecision,
} from './host-esm-facade';
import {
    MODULE_V2_REQUIRED_LOGIC_EXTERNALS,
    MODULE_V2_REQUIRED_UI_EXTERNALS,
    type ModuleV2HostAbiExternal,
} from './host-abi';
import { evaluateTrustImport } from './isolation/trust-policy';
import type { PackageV2PluginDescriptor, Sha256 } from './runtime-descriptor';

export type ModuleV2LoaderBlockCode =
    | 'missing-client-entry'
    | 'isolated-trust-not-supported'
    | 'host-external-missing'
    | 'invalid-asset-url'
    | 'loader-disabled';

export type ModuleV2CancelReason = 'generation-stale' | 'aborted';

export type ModuleV2LoadOutcome =
    | {
          readonly status: 'loaded';
          readonly module: unknown;
          readonly url: string;
          readonly generation: number;
          readonly packageDigest: Sha256;
      }
    | {
          readonly status: 'cancelled';
          readonly reason: ModuleV2CancelReason;
          readonly generation: number;
          readonly packageDigest: Sha256;
      };

export type ModuleV2LoaderResolution =
    | {
          readonly status: 'ready';
          readonly url: string;
          readonly packageDigest: Sha256;
          readonly clientEntry: string;
          readonly requiresTrustedHostUi: boolean;
          load(): Promise<ModuleV2LoadOutcome>;
      }
    | {
          readonly status: 'blocked';
          readonly code: ModuleV2LoaderBlockCode;
          readonly message: string;
          readonly missingExternals?: readonly ModuleV2HostAbiExternal[];
      }
    | {
          readonly status: 'rebuild-required';
          readonly code: 'trusted-host-ui-abi-unproven';
          readonly message: string;
          readonly blockCodes: readonly HostEsmFacadeBlockCode[];
          readonly postBuildAlternative: 'isolated-client-or-declarative-ui';
      };

export interface ModuleV2AssetUrlInput {
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly entryPath: string;
}

export interface ModuleV2LoaderOptions {
    /** Build a same-origin digest-addressed module URL for the package entry. */
    readonly assetUrl: (input: ModuleV2AssetUrlInput) => string;
    /**
     * Host-owned ABI modules. The loader never bundles a second Vue/SDK copy;
     * missing required externals block resolution.
     */
    readonly hostExternals: Readonly<Partial<Record<ModuleV2HostAbiExternal, unknown>>>;
    /** Injectable dynamic import (defaults to native `import()`). */
    readonly importModule?: (url: string) => Promise<unknown>;
    /** Production ABI kill-gate decision; defaults to fully unproven. */
    readonly trustedHostUi?: TrustedHostUiDecision;
    /** Optional evidence used when `trustedHostUi` is omitted. */
    readonly trustedHostUiEvidence?: HostEsmFacadeEvidence;
    /** Startup-only gate. When false, every resolve is blocked. */
    readonly enabled?: boolean;
}

export interface ModuleV2ResolveInput {
    readonly descriptor: PackageV2PluginDescriptor;
    readonly generation: number;
    readonly signal: AbortSignal;
    /** Returns true only while this generation remains the manager's current one. */
    readonly isGenerationCurrent: () => boolean;
    /**
     * True when the package needs trusted-host Vue UI. Defaults to whether the
     * descriptor declares a client entry under trusted-host trust.
     */
    readonly requiresTrustedHostUi?: boolean;
}

function defaultUnprovenUiDecision(): TrustedHostUiDecision {
    return decideTrustedHostUi({
        generatedFacade: false,
        importMap: false,
        vueSingletonIdentity: false,
        sdkSingletonIdentity: false,
        vueReactivity: false,
        vueComponentRendering: false,
        cspCompatible: false,
    });
}

function normalizeEntryPath(entryPath: string): string | null {
    if (
        entryPath.length === 0 ||
        entryPath.includes('\\') ||
        entryPath.includes('\0') ||
        entryPath.startsWith('/') ||
        entryPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
        return null;
    }
    return entryPath;
}

function missingExternals(
    required: readonly ModuleV2HostAbiExternal[],
    hostExternals: Readonly<Partial<Record<ModuleV2HostAbiExternal, unknown>>>
): ModuleV2HostAbiExternal[] {
    return required.filter((specifier) => hostExternals[specifier] === undefined);
}

/**
 * Loads verified digest-addressed V2 browser modules with host ABI externals
 * and generation cancellation. A stale import never reports a publishable load.
 */
export class ModuleV2Loader {
    readonly #assetUrl: ModuleV2LoaderOptions['assetUrl'];
    readonly #hostExternals: ModuleV2LoaderOptions['hostExternals'];
    readonly #importModule: (url: string) => Promise<unknown>;
    readonly #trustedHostUi: TrustedHostUiDecision;
    readonly #enabled: boolean;

    constructor(options: ModuleV2LoaderOptions) {
        this.#assetUrl = options.assetUrl;
        this.#hostExternals = options.hostExternals;
        this.#importModule =
            options.importModule ??
            ((url: string) => import(/* @vite-ignore */ url) as Promise<unknown>);
        this.#trustedHostUi =
            options.trustedHostUi ??
            (options.trustedHostUiEvidence
                ? decideTrustedHostUi(options.trustedHostUiEvidence)
                : defaultUnprovenUiDecision());
        this.#enabled = options.enabled !== false;
    }

    /** Exposes the host ABI module registered for a bare import, if any. */
    resolveHostExternal(specifier: ModuleV2HostAbiExternal): unknown | undefined {
        return this.#hostExternals[specifier];
    }

    resolve(input: ModuleV2ResolveInput): ModuleV2LoaderResolution {
        if (!this.#enabled) {
            return {
                status: 'blocked',
                code: 'loader-disabled',
                message: 'ModuleV2Loader is disabled for this process',
            };
        }

        const { descriptor } = input;
        if (descriptor.artifact.kind !== 'package-v2') {
            return {
                status: 'blocked',
                code: 'missing-client-entry',
                message: 'ModuleV2Loader only loads package-v2 artifacts',
            };
        }
        // ModuleV2Loader executes trusted-host modules only. Isolated
        // descriptors are blocked before import via the shared trust policy
        // (never silently downgraded to in-process trusted-host).
        const trustDecision = evaluateTrustImport({
            pluginIsolationEnabled: false,
            trust: descriptor.trust,
            ...(descriptor.trust !== 'trusted-host'
                ? { proposedFallbackTrust: 'trusted-host' as const }
                : {}),
        });
        if (!trustDecision.allowed || descriptor.trust !== 'trusted-host') {
            return {
                status: 'blocked',
                code: 'isolated-trust-not-supported',
                message:
                    !trustDecision.allowed
                        ? trustDecision.message
                        : `Trust mode ${descriptor.trust} cannot load through ModuleV2Loader; ` +
                          'use an isolation runtime or block before import',
            };
        }

        const clientEntry = descriptor.artifact.clientEntry;
        if (!clientEntry) {
            return {
                status: 'blocked',
                code: 'missing-client-entry',
                message: 'Package descriptor does not declare a client entry',
            };
        }
        const normalizedEntry = normalizeEntryPath(clientEntry);
        if (!normalizedEntry) {
            return {
                status: 'blocked',
                code: 'invalid-asset-url',
                message: 'Client entry path escapes the package root',
            };
        }

        // UI is opt-in. Logic packages load post-build; trusted-host Vue UI stays
        // behind the host ESM facade kill gate (see host-esm-facade-spike.md).
        const requiresTrustedHostUi = input.requiresTrustedHostUi === true;
        if (requiresTrustedHostUi && this.#trustedHostUi.status !== 'supported') {
            return {
                status: 'rebuild-required',
                code: 'trusted-host-ui-abi-unproven',
                message:
                    'Trusted-host ModuleV2Loader UI remains rebuild-required until the host ESM facade proofs pass',
                blockCodes: this.#trustedHostUi.blockCodes,
                postBuildAlternative: 'isolated-client-or-declarative-ui',
            };
        }

        const required = requiresTrustedHostUi
            ? MODULE_V2_REQUIRED_UI_EXTERNALS
            : MODULE_V2_REQUIRED_LOGIC_EXTERNALS;
        const missing = missingExternals(required, this.#hostExternals);
        if (missing.length > 0) {
            return {
                status: 'blocked',
                code: 'host-external-missing',
                message: `Required host ABI externals are unavailable: ${missing.join(', ')}`,
                missingExternals: Object.freeze(missing),
            };
        }

        let url: string;
        try {
            url = this.#assetUrl({
                pluginId: descriptor.id,
                packageDigest: descriptor.artifact.packageDigest,
                entryPath: normalizedEntry,
            });
        } catch (error) {
            return {
                status: 'blocked',
                code: 'invalid-asset-url',
                message: error instanceof Error ? error.message : 'Failed to build package asset URL',
            };
        }
        if (
            typeof url !== 'string' ||
            url.length === 0 ||
            !(
                url.startsWith('/') ||
                url.startsWith('http://') ||
                url.startsWith('https://') ||
                url.startsWith('blob:')
            )
        ) {
            return {
                status: 'blocked',
                code: 'invalid-asset-url',
                message: 'Package asset URL must be a same-origin absolute or http(s) path',
            };
        }

        const generation = input.generation;
        const packageDigest = descriptor.artifact.packageDigest;
        const signal = input.signal;
        const isGenerationCurrent = input.isGenerationCurrent;
        const importModule = this.#importModule;

        return {
            status: 'ready',
            url,
            packageDigest,
            clientEntry: normalizedEntry,
            requiresTrustedHostUi,
            load: async (): Promise<ModuleV2LoadOutcome> => {
                if (signal.aborted || !isGenerationCurrent()) {
                    return {
                        status: 'cancelled',
                        reason: signal.aborted ? 'aborted' : 'generation-stale',
                        generation,
                        packageDigest,
                    };
                }
                const module = await importModule(url);
                if (signal.aborted || !isGenerationCurrent()) {
                    return {
                        status: 'cancelled',
                        reason: signal.aborted ? 'aborted' : 'generation-stale',
                        generation,
                        packageDigest,
                    };
                }
                return {
                    status: 'loaded',
                    module,
                    url,
                    generation,
                    packageDigest,
                };
            },
        };
    }
}

/** Canonical digest-addressed client module route used by ModuleV2Loader. */
export function buildPluginPackageAssetUrl(input: ModuleV2AssetUrlInput): string {
    const entry = normalizeEntryPath(input.entryPath);
    if (!entry) {
        throw new Error('Invalid package asset entry path');
    }
    const segments = entry.split('/').map((segment) => encodeURIComponent(segment));
    return `/api/plugins/packages/${encodeURIComponent(input.pluginId)}/${encodeURIComponent(input.packageDigest)}/${segments.join('/')}`;
}
