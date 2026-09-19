/**
 * Reads a package's generated portable descriptors from an installed extension.
 *
 * Paths are confined to the extensions directory, files are size-bounded, and a
 * malformed descriptor is reported as unavailable rather than guessed at.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
    defineOr3PortableProfile,
    parsePackagePolicy,
    parseSetupDescriptor,
    type Or3PackagePolicyV1,
    type Or3SetupDescriptorV1,
} from '@or3/plugin-sdk/profile';
import type { EffectiveAuthority } from '~~/shared/plugins/authority/effective-authority';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';
import type { ConnectionDispatchPolicy } from '~~/shared/plugins/connections/contracts';

const MAX_DESCRIPTOR_BYTES = 256 * 1024;
export const SETUP_DESCRIPTOR_FILE = 'or3.setup.json';
export const POLICY_DESCRIPTOR_FILE = 'or3.package-policy.json';

export interface LoadedPackageDescriptors {
    readonly setup: Or3SetupDescriptorV1 | null;
    readonly policy: Or3PackagePolicyV1 | null;
    readonly problems: readonly string[];
}

function assertInside(baseDir: string, target: string): string {
    const base = resolve(baseDir);
    const resolved = resolve(target);
    if (resolved !== base && !resolved.startsWith(`${base}${sep}`)) {
        throw new Error('Descriptor path escapes the extensions directory');
    }
    return resolved;
}

async function readJsonFile(path: string): Promise<unknown | null> {
    try {
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_DESCRIPTOR_BYTES) return null;
        return JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch {
        return null;
    }
}

/**
 * Load both descriptors for an installed package directory.
 * `problems` explains anything missing or malformed; callers must not treat a
 * package with problems as having a usable setup flow.
 */
export async function loadPackageDescriptors(input: {
    readonly extensionsBaseDir: string;
    readonly packagePath: string;
}): Promise<LoadedPackageDescriptors> {
    const problems: string[] = [];
    const base = assertInside(input.extensionsBaseDir, input.packagePath);

    const setupRaw = await readJsonFile(join(base, SETUP_DESCRIPTOR_FILE));
    const policyRaw = await readJsonFile(join(base, POLICY_DESCRIPTOR_FILE));

    let setup: Or3SetupDescriptorV1 | null = null;
    if (setupRaw === null) {
        problems.push(`${SETUP_DESCRIPTOR_FILE} is missing or unreadable`);
    } else {
        const parsed = parseSetupDescriptor(setupRaw);
        if (parsed.value !== null && parsed.problems.length === 0) {
            setup = parsed.value;
        } else {
            problems.push(
                `${SETUP_DESCRIPTOR_FILE} is invalid: ${parsed.problems
                    .map((problem) => problem.path)
                    .join(', ')}`
            );
        }
    }

    let policy: Or3PackagePolicyV1 | null = null;
    if (policyRaw === null) {
        problems.push(`${POLICY_DESCRIPTOR_FILE} is missing or unreadable`);
    } else {
        const parsed = parsePackagePolicy(policyRaw);
        if (parsed.value !== null && parsed.problems.length === 0) {
            policy = parsed.value;
        } else {
            problems.push(
                `${POLICY_DESCRIPTOR_FILE} is invalid: ${parsed.problems
                    .map((problem) => problem.path)
                    .join(', ')}`
            );
        }
    }

    return { setup, policy, problems };
}

/**
 * Project a validated package policy onto the release's approved connection
 * authority. This is what generic connection dispatch intersects with, so a
 * provider supporting an operation is not the same as the release approving it.
 */
export function toConnectionDispatchPolicy(
    policy: Or3PackagePolicyV1 | null
): ConnectionDispatchPolicy | null {
    if (!policy) return null;
    return {
        connections: policy.connections.map((connection) => ({
            id: connection.id,
            provider: connection.provider,
            scopes: [...connection.scopes],
            operations: [...connection.operations],
            ...(connection.externalCost === undefined
                ? {}
                : { externalCost: connection.externalCost }),
        })),
        destinations: policy.destinations.map((destination) => ({
            id: destination.id,
            hosts: [...destination.hosts],
            methods: [...destination.methods],
            scopes: [...destination.scopes],
        })),
    };
}

/** The manifest fields that change what a release may do at runtime. */
export interface PackageAuthorityManifest {
    readonly trust: string;
    readonly engines: { readonly or3: string; readonly pluginApi?: string };
    readonly requestedGrants: readonly string[];
    readonly features?: {
        readonly required: readonly string[];
        readonly optional: readonly string[];
    };
    readonly dependencies?: {
        readonly required: readonly PackageDependencyDeclaration[];
        readonly optional: readonly PackageDependencyDeclaration[];
    };
}

export interface PackageDependencyDeclaration {
    readonly id: string;
    readonly range: string;
    readonly features?: readonly string[];
}

function uniqueSorted(values: readonly string[]): string[] {
    return Array.from(new Set(values)).sort();
}

/**
 * The exact policy revision the registry signs as a release's authority digest.
 * Computed with the SDK's own profile rules so approval, acquisition and the
 * signed metadata all agree on one value.
 */
export function packageAuthorityDigest(
    policy: Or3PackagePolicyV1 | null,
    setup: Or3SetupDescriptorV1 | null
): Sha256 | null {
    if (!policy || !setup) return null;
    try {
        const profile = defineOr3PortableProfile({
            profile: policy.profile,
            destinations: policy.destinations,
            connections: policy.connections,
            dataScopes: policy.dataScopes,
            writes: policy.writes,
            features: policy.requiredFeatures,
            settingsSchemaPath: setup.settingsSchemaPath,
            fields: setup.fields,
            ...(setup.testAction === undefined ? {} : { testAction: setup.testAction }),
            firstAction: setup.firstAction,
        });
        return profile.revisions.policy;
    } catch {
        return null;
    }
}

function dependencyEntries(
    dependencies: PackageAuthorityManifest['dependencies']
): string[] {
    if (!dependencies) return [];
    const entries: string[] = [];
    for (const group of ['required', 'optional'] as const) {
        for (const dependency of dependencies[group]) {
            const features = uniqueSorted(dependency.features ?? []).join('+');
            entries.push(
                `${group}:${dependency.id}@${dependency.range}${features.length > 0 ? `#${features}` : ''}`
            );
        }
    }
    return entries;
}

/**
 * The complete authority a release declares, derived from its validated
 * descriptors and manifest. Consent records bind to this, so an update that
 * adds a host, method, path, scope, write, hook, feature, engine or dependency
 * is an expansion even when every grant string stays the same.
 */
export function toEffectiveAuthority(input: {
    readonly manifest: PackageAuthorityManifest;
    readonly policy: Or3PackagePolicyV1;
    readonly setup: Or3SetupDescriptorV1;
}): EffectiveAuthority {
    const { manifest, policy, setup } = input;
    const destinations = policy.destinations.flatMap((destination) =>
        destination.hosts.map((host) => ({
            host,
            methods: [...destination.methods],
            pathPrefixes: [...destination.scopes],
            connection: destination.id,
        }))
    );
    const connectionScopes = policy.connections.flatMap((connection) => [
        ...connection.scopes.map((scope) => `${connection.id}:${scope}`),
        ...connection.operations.map((operation) => `${connection.id}:op:${operation}`),
    ]);
    const setupHooks = [
        ...(setup.testAction ? [setup.testAction.operationId] : []),
        setup.firstAction.operationId,
    ];
    const engines = [
        `or3:${manifest.engines.or3}`,
        ...(manifest.engines.pluginApi === undefined
            ? []
            : [`pluginApi:${manifest.engines.pluginApi}`]),
    ];
    return {
        trust: manifest.trust,
        grants: uniqueSorted(manifest.requestedGrants),
        features: uniqueSorted([
            ...(manifest.features?.required ?? []),
            ...policy.requiredFeatures,
        ]),
        engines,
        destinations,
        connectionScopes: uniqueSorted(connectionScopes),
        dataScopes: uniqueSorted(policy.dataScopes),
        writes: uniqueSorted(policy.writes),
        setupHooks,
        dependencies: dependencyEntries(manifest.dependencies),
    };
}
