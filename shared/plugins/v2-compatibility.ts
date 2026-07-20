import { satisfies, valid, validRange } from 'semver';

export type PluginV2TrustMode = 'trusted-host' | 'isolated-client' | 'isolated-server';

export interface PluginV2DependencyRequirement {
    readonly id: string;
    readonly range: string;
    readonly features: readonly string[];
}

export interface PluginV2CompatibilityManifest {
    readonly id: string;
    readonly engines: {
        readonly or3: string;
        readonly pluginApi: string;
    };
    readonly requestedGrants: readonly string[];
    readonly features: {
        readonly required: readonly string[];
        readonly optional: readonly string[];
    };
    readonly dependencies: {
        readonly required: readonly PluginV2DependencyRequirement[];
        readonly optional: readonly PluginV2DependencyRequirement[];
    };
    readonly trust: PluginV2TrustMode;
}

export interface AvailablePluginV2Dependency {
    readonly id: string;
    readonly version: string;
    readonly features: readonly string[];
}

export interface PluginV2HostCapabilities {
    readonly or3Version: string;
    readonly pluginApiVersion: string;
    readonly supportedTrustModes: readonly PluginV2TrustMode[];
    readonly supportedGrants: readonly string[];
    readonly supportedFeatures: readonly string[];
}

export type PluginV2BlockCode =
    | 'invalid-host-version'
    | 'invalid-manifest-range'
    | 'host-engine-mismatch'
    | 'plugin-api-engine-mismatch'
    | 'unsupported-trust-mode'
    | 'unsupported-grant'
    | 'unsupported-required-feature'
    | 'missing-required-dependency'
    | 'invalid-dependency-range'
    | 'dependency-version-mismatch'
    | 'dependency-feature-mismatch';

export interface PluginV2BlockReason {
    readonly code: PluginV2BlockCode;
    readonly subject: string;
    readonly expected?: string;
    readonly actual?: string;
    readonly message: string;
}

export type OptionalDependencyUnavailableReason =
    | 'missing'
    | 'invalid-range'
    | 'version-mismatch'
    | 'feature-mismatch';

export interface OptionalDependencyUnavailable {
    readonly id: string;
    readonly reason: OptionalDependencyUnavailableReason;
    readonly expected?: string;
    readonly actual?: string;
}

export interface PluginV2FeatureNegotiation {
    readonly required: readonly string[];
    readonly optionalAvailable: readonly string[];
    readonly optionalUnavailable: readonly string[];
    readonly requiredDependencies: readonly string[];
    readonly optionalDependenciesAvailable: readonly string[];
    readonly optionalDependenciesUnavailable: readonly OptionalDependencyUnavailable[];
}

export type PluginV2CompatibilityResult =
    | {
          readonly status: 'compatible';
          readonly negotiation: PluginV2FeatureNegotiation;
      }
    | {
          readonly status: 'blocked';
          readonly reasons: readonly PluginV2BlockReason[];
          readonly negotiation: PluginV2FeatureNegotiation;
      };

export interface VerifyPluginV2CompatibilityInput {
    readonly manifest: PluginV2CompatibilityManifest;
    readonly host: PluginV2HostCapabilities;
    readonly dependencies: readonly AvailablePluginV2Dependency[];
}

function immutable<T extends object>(value: T): Readonly<T> {
    return Object.freeze(value);
}

function createNegotiation(
    manifest: PluginV2CompatibilityManifest,
    supportedFeatures: ReadonlySet<string>,
    requiredDependencies: string[],
    optionalDependenciesAvailable: string[],
    optionalDependenciesUnavailable: OptionalDependencyUnavailable[]
): PluginV2FeatureNegotiation {
    return immutable({
        required: Object.freeze([...manifest.features.required]),
        optionalAvailable: Object.freeze(
            manifest.features.optional.filter((feature) => supportedFeatures.has(feature))
        ),
        optionalUnavailable: Object.freeze(
            manifest.features.optional.filter((feature) => !supportedFeatures.has(feature))
        ),
        requiredDependencies: Object.freeze(requiredDependencies),
        optionalDependenciesAvailable: Object.freeze(optionalDependenciesAvailable),
        optionalDependenciesUnavailable: Object.freeze(
            optionalDependenciesUnavailable.map((entry) => immutable({ ...entry }))
        ),
    });
}

/**
 * Pure pre-import compatibility and feature-negotiation boundary for V2 packages.
 * Every plugin-controlled mismatch is returned as data; this function never imports code.
 */
export function verifyPluginV2Compatibility(
    input: VerifyPluginV2CompatibilityInput
): PluginV2CompatibilityResult {
    const { manifest, host } = input;
    const reasons: PluginV2BlockReason[] = [];
    const supportedTrustModes = new Set(host.supportedTrustModes);
    const supportedGrants = new Set(host.supportedGrants);
    const supportedFeatures = new Set(host.supportedFeatures);
    const dependencies = new Map(
        input.dependencies.map((dependency) => [dependency.id, dependency])
    );
    const requiredDependencies: string[] = [];
    const optionalDependenciesAvailable: string[] = [];
    const optionalDependenciesUnavailable: OptionalDependencyUnavailable[] = [];
    const block = (reason: PluginV2BlockReason) => reasons.push(immutable(reason));

    if (!valid(host.or3Version)) {
        block({
            code: 'invalid-host-version',
            subject: 'engines.or3',
            actual: host.or3Version,
            message: 'The host OR3 version is not valid semantic version data',
        });
    } else if (!validRange(manifest.engines.or3)) {
        block({
            code: 'invalid-manifest-range',
            subject: 'engines.or3',
            actual: manifest.engines.or3,
            message: 'The plugin OR3 engine range is invalid',
        });
    } else if (!satisfies(host.or3Version, manifest.engines.or3)) {
        block({
            code: 'host-engine-mismatch',
            subject: 'engines.or3',
            expected: manifest.engines.or3,
            actual: host.or3Version,
            message: 'The current OR3 host version is outside the plugin engine range',
        });
    }

    if (!valid(host.pluginApiVersion)) {
        block({
            code: 'invalid-host-version',
            subject: 'engines.pluginApi',
            actual: host.pluginApiVersion,
            message: 'The host plugin API version is not valid semantic version data',
        });
    } else if (!validRange(manifest.engines.pluginApi)) {
        block({
            code: 'invalid-manifest-range',
            subject: 'engines.pluginApi',
            actual: manifest.engines.pluginApi,
            message: 'The plugin API engine range is invalid',
        });
    } else if (!satisfies(host.pluginApiVersion, manifest.engines.pluginApi)) {
        block({
            code: 'plugin-api-engine-mismatch',
            subject: 'engines.pluginApi',
            expected: manifest.engines.pluginApi,
            actual: host.pluginApiVersion,
            message: 'The host plugin API version is outside the plugin engine range',
        });
    }

    if (!supportedTrustModes.has(manifest.trust)) {
        block({
            code: 'unsupported-trust-mode',
            subject: 'trust',
            expected: manifest.trust,
            message: `The host does not support plugin trust mode ${manifest.trust}`,
        });
    }
    for (const grant of manifest.requestedGrants) {
        if (!supportedGrants.has(grant)) {
            block({
                code: 'unsupported-grant',
                subject: `requestedGrants.${grant}`,
                expected: grant,
                message: `The host does not support requested grant ${grant}`,
            });
        }
    }
    for (const feature of manifest.features.required) {
        if (!supportedFeatures.has(feature)) {
            block({
                code: 'unsupported-required-feature',
                subject: `features.required.${feature}`,
                expected: feature,
                message: `The host does not support required feature ${feature}`,
            });
        }
    }

    const inspectDependency = (
        requirement: PluginV2DependencyRequirement,
        optional: boolean
    ): void => {
        const available = dependencies.get(requirement.id);
        if (!available) {
            if (optional) {
                optionalDependenciesUnavailable.push({ id: requirement.id, reason: 'missing' });
            } else {
                block({
                    code: 'missing-required-dependency',
                    subject: `dependencies.required.${requirement.id}`,
                    expected: requirement.range,
                    message: `Required dependency ${requirement.id} is not available`,
                });
            }
            return;
        }
        if (!validRange(requirement.range)) {
            if (optional) {
                optionalDependenciesUnavailable.push({
                    id: requirement.id,
                    reason: 'invalid-range',
                    expected: requirement.range,
                });
            } else {
                block({
                    code: 'invalid-dependency-range',
                    subject: `dependencies.required.${requirement.id}`,
                    expected: requirement.range,
                    message: `Required dependency ${requirement.id} has an invalid range`,
                });
            }
            return;
        }
        if (!valid(available.version) || !satisfies(available.version, requirement.range)) {
            if (optional) {
                optionalDependenciesUnavailable.push({
                    id: requirement.id,
                    reason: 'version-mismatch',
                    expected: requirement.range,
                    actual: available.version,
                });
            } else {
                block({
                    code: 'dependency-version-mismatch',
                    subject: `dependencies.required.${requirement.id}`,
                    expected: requirement.range,
                    actual: available.version,
                    message: `Required dependency ${requirement.id} has an incompatible version`,
                });
            }
            return;
        }
        const availableFeatures = new Set(available.features);
        const missingFeatures = requirement.features.filter(
            (feature) => !availableFeatures.has(feature)
        );
        if (missingFeatures.length > 0) {
            if (optional) {
                optionalDependenciesUnavailable.push({
                    id: requirement.id,
                    reason: 'feature-mismatch',
                    expected: missingFeatures.join(','),
                });
            } else {
                for (const feature of missingFeatures) {
                    block({
                        code: 'dependency-feature-mismatch',
                        subject: `dependencies.required.${requirement.id}.features.${feature}`,
                        expected: feature,
                        message:
                            `Required dependency ${requirement.id} does not provide ` +
                            `feature ${feature}`,
                    });
                }
            }
            return;
        }
        if (optional) optionalDependenciesAvailable.push(requirement.id);
        else requiredDependencies.push(requirement.id);
    };

    for (const dependency of manifest.dependencies.required) {
        inspectDependency(dependency, false);
    }
    for (const dependency of manifest.dependencies.optional) {
        inspectDependency(dependency, true);
    }

    const negotiation = createNegotiation(
        manifest,
        supportedFeatures,
        requiredDependencies,
        optionalDependenciesAvailable,
        optionalDependenciesUnavailable
    );
    if (reasons.length > 0) {
        return immutable({ status: 'blocked', reasons: Object.freeze(reasons), negotiation });
    }
    return immutable({ status: 'compatible', negotiation });
}

export type PluginV2PreImportResult<T> =
    | {
          readonly status: 'loaded';
          readonly value: T;
          readonly negotiation: PluginV2FeatureNegotiation;
      }
    | Extract<PluginV2CompatibilityResult, { status: 'blocked' }>;

/** Guarantees the importer is never invoked for an incompatible V2 package. */
export async function loadCompatiblePluginV2<T>(
    input: VerifyPluginV2CompatibilityInput,
    importer: () => Promise<T>
): Promise<PluginV2PreImportResult<T>> {
    const verification = verifyPluginV2Compatibility(input);
    if (verification.status === 'blocked') return verification;
    const value = await importer();
    return immutable({ status: 'loaded', value, negotiation: verification.negotiation });
}
