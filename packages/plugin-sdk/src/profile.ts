import { createHash } from 'node:crypto';
import type { PluginManifestV2 } from './manifest';

/**
 * Node-only authoring surface for the versioned OR3 portable client profile.
 *
 * This module must stay free of runtime dependencies (only `node:crypto` plus
 * relative siblings) so authoring tools, the package reviewer and the host can
 * all share one deterministic implementation. It must never be re-exported from
 * `src/index.ts`, because that entry point is bundled into browser and worker
 * plugin code.
 */

export const PORTABLE_PROFILE_VERSION = 1;
export const PORTABLE_PROFILE_ID = 'or3-portable-client-v1';
export const PACKAGE_POLICY_FILE = 'or3.package-policy.json';
export const PACKAGE_SETUP_FILE = 'or3.setup.json';

export type PortableProfileHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type PortableProfileConnectionMechanism = 'browser' | 'server';
export type PortableProfileFieldKind = 'text' | 'select' | 'toggle' | 'number';
export type Or3SetupFieldScope = 'workspace' | 'user';
export type PortableProfileFieldValue = string | number | boolean;
export type Or3ProfileRevision = `sha256-${string}`;

export interface Or3PackageDestination {
    readonly id: string;
    readonly methods: readonly PortableProfileHttpMethod[];
    readonly hosts: readonly string[];
    readonly scopes: readonly string[];
}

export interface Or3PackageConnection {
    readonly id: string;
    readonly label: string;
    readonly provider: string;
    readonly required: boolean;
    readonly mechanism: PortableProfileConnectionMechanism;
    readonly scopes: readonly string[];
    readonly operations: readonly string[];
    readonly externalCost?: string;
}

export interface Or3PackagePolicyV1 {
    readonly policyVersion: 1;
    readonly profile: 'or3-portable-client-v1';
    readonly destinations: readonly Or3PackageDestination[];
    readonly connections: readonly Or3PackageConnection[];
    readonly dataScopes: readonly string[];
    readonly writes: readonly string[];
    readonly requiredFeatures: readonly string[];
}

export interface Or3SetupField {
    readonly key: string;
    readonly label: string;
    readonly kind: PortableProfileFieldKind;
    readonly required: boolean;
    readonly order: number;
    /**
     * Declared storage scope. Only `workspace` is currently honored: `user`
     * is reserved for a future per-member store and is refused during
     * admission until that store exists, so personal values are never silently
     * shared as workspace configuration. Defaults to workspace.
     */
    readonly scope?: Or3SetupFieldScope;
    /** Secret fields are never accepted by setup-values; use context.secrets. */
    readonly secret?: boolean;
    readonly default?: PortableProfileFieldValue;
    readonly choices?: readonly string[];
}

export interface Or3SetupTestAction {
    readonly operationId: string;
    readonly deadlineMs: number;
}

export interface Or3SetupFirstAction {
    readonly operationId: string;
    readonly label: string;
    /**
     * True when the first action may use the package sample as a fallback.
     * Selected context always wins; the sample is only used when the user has
     * not opened the plugin on a document or message.
     */
    readonly usesSampleContext: boolean;
    /**
     * Package-relative path to the sample the host runs the first action on when
     * no selection exists. Optional: a package that declares
     * `usesSampleContext: true` without a sample simply requires a selection
     * instead. Refused when `usesSampleContext` is false, so the host never has
     * to guess a filename.
     */
    readonly samplePath?: string;
}

export interface Or3SetupDescriptorV1 {
    readonly setupVersion: 1;
    readonly settingsSchemaPath: string;
    readonly fields: readonly Or3SetupField[];
    readonly connections: readonly string[];
    readonly testAction?: Or3SetupTestAction;
    readonly firstAction: Or3SetupFirstAction;
}

/** The single authoring input that generates both descriptors. */
export interface Or3PortableProfileConfig {
    readonly profile: typeof PORTABLE_PROFILE_ID;
    readonly destinations: readonly Or3PackageDestination[];
    readonly connections: readonly Or3PackageConnection[];
    readonly dataScopes: readonly string[];
    readonly writes: readonly string[];
    readonly features?: readonly string[];
    readonly settingsSchemaPath: string;
    readonly fields: readonly Or3SetupField[];
    readonly testAction?: Or3SetupTestAction;
    readonly firstAction: Or3SetupFirstAction;
}

export interface Or3PortableProfileFiles {
    readonly 'or3.package-policy.json': string;
    readonly 'or3.setup.json': string;
}

export interface Or3PortableProfile {
    readonly policy: Or3PackagePolicyV1;
    readonly setup: Or3SetupDescriptorV1;
    readonly requiredFeatures: readonly string[];
    readonly revisions: {
        readonly policy: Or3ProfileRevision;
        readonly setup: Or3ProfileRevision;
    };
    readonly files: Or3PortableProfileFiles;
}

export type PortableProfileFindingCode =
    | 'portable-profile-missing'
    | 'portable-profile-invalid'
    | 'portable-manifest-invalid'
    | 'portable-profile-version-unsupported'
    | 'portable-feature-flag-missing'
    | 'portable-trust-unsupported'
    | 'portable-host-isolation-unsupported'
    | 'portable-server-code-unsupported'
    | 'portable-runtime-dependency-unsupported'
    | 'portable-state-migration-unsupported'
    | 'portable-lifecycle-script-unsupported'
    | 'portable-package-dependency-unsupported'
    | 'portable-remote-code-unsupported'
    | 'portable-settings-schema-mismatch'
    | 'portable-policy-grant-mismatch'
    | 'portable-setup-connection-unknown'
    | 'portable-setup-operation-unknown'
    | 'portable-feature-mismatch'
    | 'portable-user-scope-unsupported';

/** Mirrors the conformance finding shape used by the reviewer and CLI. */
export interface PortableProfileFinding {
    readonly severity: 'error' | 'warning' | 'info';
    readonly code: PortableProfileFindingCode;
    readonly subject: string;
    readonly message: string;
}

/** Loose package.json projection; only portable-relevant fields are inspected. */
export interface PortablePackageJson {
    readonly scripts?: Readonly<Record<string, string>>;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
}

export interface PortableProfileValidationInput {
    readonly manifest: PluginManifestV2;
    /** Parsed JSON of `or3.package-policy.json`, or the raw value. Shape is validated here. */
    readonly policy?: unknown;
    /** Parsed JSON of `or3.setup.json`, or the raw value. Shape is validated here. */
    readonly setup?: unknown;
    readonly packageJson?: PortablePackageJson | null;
}

export interface DescriptorShapeProblem {
    /** Dotted path inside the descriptor file, e.g. `.destinations[0].hosts`. */
    readonly path: string;
    readonly message: string;
}

export interface DescriptorShapeResult<T> {
    readonly value: T | null;
    readonly problems: readonly DescriptorShapeProblem[];
}

const PORTABLE_HTTP_METHODS = new Set<PortableProfileHttpMethod>([
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
]);
const PORTABLE_CONNECTION_MECHANISMS = new Set<PortableProfileConnectionMechanism>([
    'browser',
    'server',
]);
const PORTABLE_FIELD_KINDS = new Set<PortableProfileFieldKind>([
    'text',
    'select',
    'toggle',
    'number',
]);
const SETUP_FIELD_SCOPES = new Set<Or3SetupFieldScope>(['workspace', 'user']);

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isFieldValue(value: unknown): value is PortableProfileFieldValue {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Validates the complete shape of a parsed `or3.package-policy.json` and rebuilds
 * it, so a malformed or non-object descriptor can never reach the relationship
 * checks (and can never be silently treated as "present").
 */
export function parsePackagePolicy(input: unknown): DescriptorShapeResult<Or3PackagePolicyV1> {
    const problems: DescriptorShapeProblem[] = [];
    const at = (path: string, message: string): void => {
        problems.push({ path, message });
    };
    if (!isJsonObject(input)) {
        return {
            value: null,
            problems: [
                {
                    path: '',
                    message: `Replace ${PACKAGE_POLICY_FILE} with the JSON object produced by defineOr3PortableProfile().`,
                },
            ],
        };
    }
    if (typeof input.policyVersion !== 'number') {
        at('.policyVersion', 'policyVersion must be a number.');
    }
    if (input.profile !== PORTABLE_PROFILE_ID) {
        at('.profile', `profile must be "${PORTABLE_PROFILE_ID}".`);
    }

    const destinations: Or3PackageDestination[] = [];
    if (!Array.isArray(input.destinations)) {
        at('.destinations', 'destinations must be an array.');
    } else {
        input.destinations.forEach((entry, index) => {
            const path = `.destinations[${index}]`;
            if (!isJsonObject(entry)) {
                at(path, 'Each destination must be an object.');
                return;
            }
            if (typeof entry.id !== 'string') at(`${path}.id`, 'id must be a string.');
            const methods = entry.methods;
            if (
                !Array.isArray(methods) ||
                !methods.every(
                    (method): method is PortableProfileHttpMethod =>
                        typeof method === 'string' &&
                        PORTABLE_HTTP_METHODS.has(method as PortableProfileHttpMethod)
                )
            ) {
                at(
                    `${path}.methods`,
                    `methods must be an array of ${[...PORTABLE_HTTP_METHODS].join(', ')}.`
                );
            }
            if (!isStringArray(entry.hosts)) at(`${path}.hosts`, 'hosts must be an array of strings.');
            if (!isStringArray(entry.scopes)) at(`${path}.scopes`, 'scopes must be an array of strings.');
            if (
                typeof entry.id === 'string' &&
                Array.isArray(methods) &&
                isStringArray(entry.hosts) &&
                isStringArray(entry.scopes)
            ) {
                destinations.push({
                    id: entry.id,
                    methods: methods as PortableProfileHttpMethod[],
                    hosts: entry.hosts,
                    scopes: entry.scopes,
                });
            }
        });
    }

    const connections: Or3PackageConnection[] = [];
    if (!Array.isArray(input.connections)) {
        at('.connections', 'connections must be an array.');
    } else {
        input.connections.forEach((entry, index) => {
            const path = `.connections[${index}]`;
            if (!isJsonObject(entry)) {
                at(path, 'Each connection must be an object.');
                return;
            }
            if (typeof entry.id !== 'string') at(`${path}.id`, 'id must be a string.');
            if (typeof entry.label !== 'string') at(`${path}.label`, 'label must be a string.');
            if (typeof entry.provider !== 'string') at(`${path}.provider`, 'provider must be a string.');
            if (typeof entry.required !== 'boolean') at(`${path}.required`, 'required must be a boolean.');
            if (
                typeof entry.mechanism !== 'string' ||
                !PORTABLE_CONNECTION_MECHANISMS.has(
                    entry.mechanism as PortableProfileConnectionMechanism
                )
            ) {
                at(`${path}.mechanism`, 'mechanism must be "browser" or "server".');
            }
            if (!isStringArray(entry.scopes)) at(`${path}.scopes`, 'scopes must be an array of strings.');
            if (!isStringArray(entry.operations)) {
                at(`${path}.operations`, 'operations must be an array of strings.');
            }
            if (entry.externalCost !== undefined && typeof entry.externalCost !== 'string') {
                at(`${path}.externalCost`, 'externalCost must be a string when present.');
            }
            if (
                typeof entry.id === 'string' &&
                typeof entry.label === 'string' &&
                typeof entry.provider === 'string' &&
                typeof entry.required === 'boolean' &&
                typeof entry.mechanism === 'string' &&
                PORTABLE_CONNECTION_MECHANISMS.has(
                    entry.mechanism as PortableProfileConnectionMechanism
                ) &&
                isStringArray(entry.scopes) &&
                isStringArray(entry.operations)
            ) {
                connections.push({
                    id: entry.id,
                    label: entry.label,
                    provider: entry.provider,
                    required: entry.required,
                    mechanism: entry.mechanism as PortableProfileConnectionMechanism,
                    scopes: entry.scopes,
                    operations: entry.operations,
                    ...(typeof entry.externalCost === 'string'
                        ? { externalCost: entry.externalCost }
                        : {}),
                });
            }
        });
    }

    if (!isStringArray(input.dataScopes)) at('.dataScopes', 'dataScopes must be an array of strings.');
    if (!isStringArray(input.writes)) at('.writes', 'writes must be an array of strings.');
    if (!isStringArray(input.requiredFeatures)) {
        at('.requiredFeatures', 'requiredFeatures must be an array of strings.');
    }

    if (problems.length > 0) return { value: null, problems };
    return {
        value: {
            policyVersion: input.policyVersion as 1,
            profile: input.profile as typeof PORTABLE_PROFILE_ID,
            destinations,
            connections,
            dataScopes: input.dataScopes as string[],
            writes: input.writes as string[],
            requiredFeatures: input.requiredFeatures as string[],
        },
        problems,
    };
}

/**
 * Validates the complete shape of a parsed `or3.setup.json` and rebuilds it, with
 * the same guarantees as `parsePackagePolicy`.
 */
export function parseSetupDescriptor(input: unknown): DescriptorShapeResult<Or3SetupDescriptorV1> {
    const problems: DescriptorShapeProblem[] = [];
    const at = (path: string, message: string): void => {
        problems.push({ path, message });
    };
    if (!isJsonObject(input)) {
        return {
            value: null,
            problems: [
                {
                    path: '',
                    message: `Replace ${PACKAGE_SETUP_FILE} with the JSON object produced by defineOr3PortableProfile().`,
                },
            ],
        };
    }
    if (typeof input.setupVersion !== 'number') {
        at('.setupVersion', 'setupVersion must be a number.');
    }
    if (typeof input.settingsSchemaPath !== 'string') {
        at('.settingsSchemaPath', 'settingsSchemaPath must be a string.');
    }

    const fields: Or3SetupField[] = [];
    if (!Array.isArray(input.fields)) {
        at('.fields', 'fields must be an array.');
    } else {
        input.fields.forEach((entry, index) => {
            const path = `.fields[${index}]`;
            if (!isJsonObject(entry)) {
                at(path, 'Each field must be an object.');
                return;
            }
            if (typeof entry.key !== 'string') at(`${path}.key`, 'key must be a string.');
            if (typeof entry.label !== 'string') at(`${path}.label`, 'label must be a string.');
            if (
                typeof entry.kind !== 'string' ||
                !PORTABLE_FIELD_KINDS.has(entry.kind as PortableProfileFieldKind)
            ) {
                at(`${path}.kind`, 'kind must be "text", "select", "toggle" or "number".');
            }
            if (typeof entry.required !== 'boolean') at(`${path}.required`, 'required must be a boolean.');
            if (typeof entry.order !== 'number') at(`${path}.order`, 'order must be a number.');
            if (
                entry.scope !== undefined &&
                (typeof entry.scope !== 'string' ||
                    !SETUP_FIELD_SCOPES.has(entry.scope as Or3SetupFieldScope))
            ) {
                at(`${path}.scope`, 'scope must be "workspace" or "user" when present.');
            }
            if (entry.secret !== undefined && typeof entry.secret !== 'boolean') {
                at(`${path}.secret`, 'secret must be a boolean when present.');
            }
            if (entry.default !== undefined && !isFieldValue(entry.default)) {
                at(`${path}.default`, 'default must be a string, number or boolean when present.');
            }
            if (entry.choices !== undefined && !isStringArray(entry.choices)) {
                at(`${path}.choices`, 'choices must be an array of strings when present.');
            }
            if (
                typeof entry.key === 'string' &&
                typeof entry.label === 'string' &&
                typeof entry.kind === 'string' &&
                PORTABLE_FIELD_KINDS.has(entry.kind as PortableProfileFieldKind) &&
                typeof entry.required === 'boolean' &&
                typeof entry.order === 'number' &&
                (entry.scope === undefined ||
                    (typeof entry.scope === 'string' &&
                        SETUP_FIELD_SCOPES.has(entry.scope as Or3SetupFieldScope))) &&
                (entry.secret === undefined || typeof entry.secret === 'boolean')
            ) {
                fields.push({
                    key: entry.key,
                    label: entry.label,
                    kind: entry.kind as PortableProfileFieldKind,
                    required: entry.required,
                    order: entry.order,
                    ...(entry.scope === undefined ? {} : { scope: entry.scope as Or3SetupFieldScope }),
                    ...(entry.secret === undefined ? {} : { secret: entry.secret }),
                    ...(isFieldValue(entry.default) ? { default: entry.default } : {}),
                    ...(isStringArray(entry.choices) ? { choices: entry.choices } : {}),
                });
            }
        });
    }

    if (!isStringArray(input.connections)) {
        at('.connections', 'connections must be an array of connection ids.');
    }

    let testAction: Or3SetupTestAction | undefined;
    if (input.testAction !== undefined) {
        if (
            !isJsonObject(input.testAction) ||
            typeof input.testAction.operationId !== 'string' ||
            typeof input.testAction.deadlineMs !== 'number'
        ) {
            at('.testAction', 'testAction must be an object with a string operationId and a number deadlineMs.');
        } else {
            testAction = {
                operationId: input.testAction.operationId,
                deadlineMs: input.testAction.deadlineMs,
            };
        }
    }

    let firstAction: Or3SetupFirstAction | null = null;
    if (
        !isJsonObject(input.firstAction) ||
        typeof input.firstAction.operationId !== 'string' ||
        typeof input.firstAction.label !== 'string' ||
        typeof input.firstAction.usesSampleContext !== 'boolean'
    ) {
        at(
            '.firstAction',
            'firstAction must be an object with string operationId and label plus a boolean usesSampleContext.'
        );
    } else {
        const usesSample = input.firstAction.usesSampleContext;
        const rawSamplePath = input.firstAction.samplePath;
        let samplePath: string | undefined;
        if (rawSamplePath !== undefined) {
            if (typeof rawSamplePath !== 'string' || !isSafeSamplePath(rawSamplePath)) {
                at(
                    '.firstAction.samplePath',
                    'samplePath must be a package-relative path without ".." or a leading slash.'
                );
            } else {
                samplePath = rawSamplePath;
            }
        }
        // A missing samplePath is not an error: the v1 contract allowed
        // `usesSampleContext: true` before samples existed, and such a package
        // is still valid — it simply requires a selection instead of falling
        // back to a sample.
        if (!usesSample && samplePath !== undefined) {
            at('.firstAction.samplePath', 'samplePath is only valid when usesSampleContext is true.');
        }
        firstAction = {
            operationId: input.firstAction.operationId,
            label: input.firstAction.label,
            usesSampleContext: usesSample,
            ...(samplePath === undefined ? {} : { samplePath }),
        };
    }

    if (problems.length > 0 || firstAction === null) return { value: null, problems };
    return {
        value: {
            setupVersion: input.setupVersion as 1,
            settingsSchemaPath: input.settingsSchemaPath as string,
            fields,
            connections: input.connections as string[],
            ...(testAction === undefined ? {} : { testAction }),
            firstAction,
        },
        problems,
    };
}

const POLICY_HASH_DOMAIN = Buffer.from('OR3_PACKAGE_POLICY_V1\0', 'utf8');
const SETUP_HASH_DOMAIN = Buffer.from('OR3_SETUP_DESCRIPTOR_V1\0', 'utf8');
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const;
const ALLOWED_PACKAGE_DEPENDENCIES = new Set(['@or3/plugin-sdk']);
const READ_GRANTS = ['documents.read', 'storage.read', 'settings.read'] as const;
const WRITE_GRANTS = ['documents.write', 'storage.write', 'settings.write'] as const;
const NETWORK_GRANT = 'network.http';

/**
 * A sample path must stay inside the package: relative, forward slashes only,
 * no traversal and no absolute or home-relative forms.
 */
export function isSafeSamplePath(value: string): boolean {
    if (value.length === 0 || value.length > 128) return false;
    if (value.startsWith('/') || value.startsWith('~') || value.startsWith('\\')) return false;
    if (/^[A-Za-z]:/.test(value)) return false;
    if (value.includes('\\')) return false;
    return !value.split('/').some((segment) => segment === '..' || segment === '');
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
    return [...new Set(values)].sort(compareText);
}

/** Order-preserving dedupe: first occurrence wins. */
function uniqueStable(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}

function canonicalValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort(compareText)) {
            sorted[key] = canonicalValue(record[key]);
        }
        return sorted;
    }
    return value;
}

/** 2-space indent, recursively sorted keys, trailing newline (host `writeStableJson` convention). */
function stableJson(value: unknown): string {
    return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function revision(domain: Buffer, canonical: string): Or3ProfileRevision {
    return `sha256-${createHash('sha256').update(domain).update(canonical, 'utf8').digest('hex')}`;
}

function normalizeDestination(destination: Or3PackageDestination): Or3PackageDestination {
    return {
        id: destination.id,
        methods: uniqueSorted(destination.methods),
        hosts: uniqueSorted(destination.hosts),
        scopes: uniqueSorted(destination.scopes),
    };
}

function normalizeDestinations(
    destinations: readonly Or3PackageDestination[]
): Or3PackageDestination[] {
    return destinations
        .map(normalizeDestination)
        .sort((left, right) => compareText(left.id, right.id));
}

function normalizeConnection(connection: Or3PackageConnection): Or3PackageConnection {
    return {
        id: connection.id,
        label: connection.label,
        provider: connection.provider,
        required: connection.required,
        mechanism: connection.mechanism,
        scopes: uniqueSorted(connection.scopes),
        operations: uniqueSorted(connection.operations),
        ...(connection.externalCost === undefined
            ? {}
            : { externalCost: connection.externalCost }),
    };
}

function normalizeConnections(
    connections: readonly Or3PackageConnection[]
): Or3PackageConnection[] {
    return connections
        .map(normalizeConnection)
        .sort((left, right) => compareText(left.id, right.id));
}

function normalizeField(field: Or3SetupField): Or3SetupField {
    return {
        key: field.key,
        label: field.label,
        kind: field.kind,
        required: field.required,
        order: field.order,
        ...(field.scope === undefined ? {} : { scope: field.scope }),
        ...(field.secret === undefined ? {} : { secret: field.secret }),
        ...(field.default === undefined ? {} : { default: field.default }),
        ...(field.choices === undefined ? {} : { choices: uniqueSorted(field.choices) }),
    };
}

function normalizeFields(fields: readonly Or3SetupField[]): Or3SetupField[] {
    return [...fields]
        .map(normalizeField)
        .sort((left, right) => left.order - right.order);
}

/**
 * Derives the policy, setup descriptor, required feature flags, revision hashes
 * and byte-identical descriptor files from one authoring configuration.
 */
export function defineOr3PortableProfile(config: Or3PortableProfileConfig): Or3PortableProfile {
    const features = uniqueSorted(config.features ?? []).filter(
        (feature) => feature !== PORTABLE_PROFILE_ID
    );
    const requiredFeatures = [PORTABLE_PROFILE_ID, ...features];
    const policy: Or3PackagePolicyV1 = {
        policyVersion: PORTABLE_PROFILE_VERSION,
        profile: config.profile,
        destinations: normalizeDestinations(config.destinations),
        connections: normalizeConnections(config.connections),
        dataScopes: uniqueSorted(config.dataScopes),
        writes: uniqueSorted(config.writes),
        requiredFeatures,
    };
    const setup: Or3SetupDescriptorV1 = {
        setupVersion: PORTABLE_PROFILE_VERSION,
        settingsSchemaPath: config.settingsSchemaPath,
        fields: normalizeFields(config.fields),
        connections: config.connections
            .filter((connection) => connection.required)
            .map((connection) => connection.id)
            .sort(compareText),
        ...(config.testAction === undefined
            ? {}
            : {
                  testAction: {
                      operationId: config.testAction.operationId,
                      deadlineMs: config.testAction.deadlineMs,
                  },
              }),
        firstAction: {
            operationId: config.firstAction.operationId,
            label: config.firstAction.label,
            usesSampleContext: config.firstAction.usesSampleContext,
            ...(config.firstAction.samplePath === undefined
                ? {}
                : { samplePath: config.firstAction.samplePath }),
        },
    };
    const policyBytes = stableJson(policy);
    const setupBytes = stableJson(setup);
    return {
        policy,
        setup,
        requiredFeatures,
        revisions: {
            policy: revision(POLICY_HASH_DOMAIN, policyBytes),
            setup: revision(SETUP_HASH_DOMAIN, setupBytes),
        },
        files: {
            'or3.package-policy.json': policyBytes,
            'or3.setup.json': setupBytes,
        },
    };
}

/** Returns a manifest copy whose features and settings schema agree with the profile. */
export function applyPortableProfileToManifest(
    manifest: PluginManifestV2,
    profile: Or3PortableProfile
): PluginManifestV2 {
    const features = manifest.features ?? { required: [], optional: [] };
    const required = uniqueStable([...(features.required ?? []), ...profile.requiredFeatures]);
    return {
        ...manifest,
        features: {
            ...features,
            required,
        },
        settings: {
            ...(manifest.settings ?? { version: 0 }),
            schema: profile.setup.settingsSchemaPath,
        },
    };
}

function isPortableEntryPath(entry: string): boolean {
    if (/^(https?:)?\/\//i.test(entry)) return false;
    if (entry.startsWith('/') || entry.startsWith('\\')) return false;
    if (entry.includes('..')) return false;
    return /\.(mjs|js)$/i.test(entry);
}

/** Canonical portable-profile validator shared by local tools, reviewer and host. */
export function validatePortableProfile(
    input: PortableProfileValidationInput
): readonly PortableProfileFinding[] {
    const findings: PortableProfileFinding[] = [];
    const report = (
        code: PortableProfileFindingCode,
        subject: string,
        message: string
    ): void => {
        findings.push({ severity: 'error', code, subject, message });
    };
    const { manifest, policy, setup, packageJson } = input;

    const policySupplied = policy !== null && policy !== undefined;
    const setupSupplied = setup !== null && setup !== undefined;
    if (!policySupplied) {
        report(
            'portable-profile-missing',
            PACKAGE_POLICY_FILE,
            `Add ${PACKAGE_POLICY_FILE} at the package root, generated from your authoring profile with defineOr3PortableProfile().`
        );
    }
    if (!setupSupplied) {
        report(
            'portable-profile-missing',
            PACKAGE_SETUP_FILE,
            `Add ${PACKAGE_SETUP_FILE} at the package root, generated from your authoring profile with defineOr3PortableProfile().`
        );
    }

    // Descriptors are untrusted input: validate their complete shape before any
    // relationship check, so a malformed file can neither bypass validation nor
    // throw while it is inspected.
    let policyUsable: Or3PackagePolicyV1 | null = null;
    if (policySupplied) {
        const parsed = parsePackagePolicy(policy);
        for (const problem of parsed.problems) {
            report(
                'portable-profile-invalid',
                `${PACKAGE_POLICY_FILE}${problem.path}`,
                problem.message
            );
        }
        if (parsed.value) {
            if (parsed.value.policyVersion !== PORTABLE_PROFILE_VERSION) {
                report(
                    'portable-profile-version-unsupported',
                    PACKAGE_POLICY_FILE,
                    `Set policyVersion to ${PORTABLE_PROFILE_VERSION} in ${PACKAGE_POLICY_FILE}; found ${parsed.value.policyVersion}. Regenerate the file with defineOr3PortableProfile().`
                );
            } else {
                policyUsable = parsed.value;
            }
        }
    }
    let setupUsable: Or3SetupDescriptorV1 | null = null;
    if (setupSupplied) {
        const parsed = parseSetupDescriptor(setup);
        for (const problem of parsed.problems) {
            report(
                'portable-profile-invalid',
                `${PACKAGE_SETUP_FILE}${problem.path}`,
                problem.message
            );
        }
        if (parsed.value) {
            if (parsed.value.setupVersion !== PORTABLE_PROFILE_VERSION) {
                report(
                    'portable-profile-version-unsupported',
                    PACKAGE_SETUP_FILE,
                    `Set setupVersion to ${PORTABLE_PROFILE_VERSION} in ${PACKAGE_SETUP_FILE}; found ${parsed.value.setupVersion}. Regenerate the file with defineOr3PortableProfile().`
                );
            } else {
                setupUsable = parsed.value;
            }
        }
    }

    // The manifest is unvalidated JSON at this boundary, so validate every field
    // this checker consumes before using it, and report instead of throwing or
    // silently substituting defaults.
    const manifestFindings: DescriptorShapeProblem[] = [];
    const manifestAt = (path: string, message: string): void => {
        manifestFindings.push({ path, message });
    };
    const rawManifest = manifest as unknown as Record<string, unknown>;

    let requiredFeatures: readonly string[] = [];
    const rawFeatures = rawManifest.features;
    if (rawFeatures !== undefined) {
        if (!isJsonObject(rawFeatures)) {
            manifestAt('.features', 'features must be an object.');
        } else {
            const required = rawFeatures.required;
            if (required === undefined) {
                // Absent is fine; the feature-flag check below reports it.
            } else if (!isStringArray(required)) {
                manifestAt(
                    '.features.required',
                    'features.required must be an array of strings.'
                );
            } else {
                requiredFeatures = required;
            }
            if (rawFeatures.optional !== undefined && !isStringArray(rawFeatures.optional)) {
                manifestAt(
                    '.features.optional',
                    'features.optional must be an array of strings.'
                );
            }
        }
    }

    const trust = typeof rawManifest.trust === 'string' ? rawManifest.trust : undefined;

    let clientIsolation: unknown;
    let clientEntry: string | undefined;
    let hasServerRuntime = false;
    const rawRuntime = rawManifest.runtime;
    if (rawRuntime !== undefined) {
        if (!isJsonObject(rawRuntime)) {
            manifestAt('.runtime', 'runtime must be an object.');
        } else {
            const client = rawRuntime.client;
            if (client !== undefined) {
                if (!isJsonObject(client)) {
                    manifestAt('.runtime.client', 'runtime.client must be an object.');
                } else {
                    clientIsolation = client.isolation;
                    if (
                        clientIsolation !== undefined &&
                        typeof clientIsolation !== 'string'
                    ) {
                        manifestAt(
                            '.runtime.client.isolation',
                            'runtime.client.isolation must be a string.'
                        );
                    }
                    if (client.entry !== undefined && typeof client.entry !== 'string') {
                        manifestAt(
                            '.runtime.client.entry',
                            'runtime.client.entry must be a string.'
                        );
                    } else if (typeof client.entry === 'string') {
                        clientEntry = client.entry;
                    }
                }
            }
            hasServerRuntime = rawRuntime.server !== undefined;
        }
    }

    const requiredDependencyIds: string[] = [];
    const optionalDependencyIds: string[] = [];
    const rawDependencies = rawManifest.dependencies;
    if (rawDependencies !== undefined) {
        if (!isJsonObject(rawDependencies)) {
            manifestAt('.dependencies', 'dependencies must be an object.');
        } else {
            for (const group of ['required', 'optional'] as const) {
                const target = group === 'required' ? requiredDependencyIds : optionalDependencyIds;
                const value = rawDependencies[group];
                if (value === undefined) continue;
                if (!Array.isArray(value)) {
                    manifestAt(
                        `.dependencies.${group}`,
                        `dependencies.${group} must be an array.`
                    );
                    continue;
                }
                value.forEach((dependency, index) => {
                    if (!isJsonObject(dependency) || typeof dependency.id !== 'string') {
                        manifestAt(
                            `.dependencies.${group}[${index}]`,
                            'Each dependency must be an object with a string id.'
                        );
                        return;
                    }
                    target.push(dependency.id);
                });
            }
        }
    }

    let requestedGrants: readonly string[] = [];
    if (rawManifest.requestedGrants !== undefined) {
        if (!isStringArray(rawManifest.requestedGrants)) {
            manifestAt('.requestedGrants', 'requestedGrants must be an array of strings.');
        } else {
            requestedGrants = rawManifest.requestedGrants;
        }
    }

    let settingsSchema: string | undefined;
    if (rawManifest.settings !== undefined) {
        if (!isJsonObject(rawManifest.settings)) {
            manifestAt('.settings', 'settings must be an object.');
        } else if (
            rawManifest.settings.schema !== undefined &&
            typeof rawManifest.settings.schema !== 'string'
        ) {
            manifestAt('.settings.schema', 'settings.schema must be a string.');
        } else if (typeof rawManifest.settings.schema === 'string') {
            settingsSchema = rawManifest.settings.schema;
        }
    }

    let stateRollback: unknown;
    let stateVersion = 0;
    let readsMinimum = 0;
    let readsMaximum = 0;
    if (rawManifest.stateCompatibility !== undefined) {
        if (!isJsonObject(rawManifest.stateCompatibility)) {
            manifestAt('.stateCompatibility', 'stateCompatibility must be an object.');
        } else {
            const rawState = rawManifest.stateCompatibility;
            stateRollback = rawState.rollback;
            if (typeof rawState.version !== 'number') {
                manifestAt(
                    '.stateCompatibility.version',
                    'stateCompatibility.version must be a number.'
                );
            } else {
                stateVersion = rawState.version;
            }
            if (rawState.reads === undefined) {
                manifestAt(
                    '.stateCompatibility.reads',
                    'stateCompatibility.reads must be an object with numeric minimum and maximum.'
                );
            } else if (!isJsonObject(rawState.reads)) {
                manifestAt('.stateCompatibility.reads', 'stateCompatibility.reads must be an object.');
            } else {
                if (typeof rawState.reads.minimum !== 'number') {
                    manifestAt(
                        '.stateCompatibility.reads.minimum',
                        'stateCompatibility.reads.minimum must be a number.'
                    );
                } else {
                    readsMinimum = rawState.reads.minimum;
                }
                if (typeof rawState.reads.maximum !== 'number') {
                    manifestAt(
                        '.stateCompatibility.reads.maximum',
                        'stateCompatibility.reads.maximum must be a number.'
                    );
                } else {
                    readsMaximum = rawState.reads.maximum;
                }
            }
        }
    }
    for (const problem of manifestFindings) {
        report(
            'portable-manifest-invalid',
            `or3.manifest.json${problem.path}`,
            problem.message
        );
    }

    if (!requiredFeatures.includes(PORTABLE_PROFILE_ID)) {
        report(
            'portable-feature-flag-missing',
            'features.required',
            `Add "${PORTABLE_PROFILE_ID}" to manifest.features.required so hosts that do not implement the portable profile reject the package. applyPortableProfileToManifest() applies this.`
        );
    }

    if (trust !== 'isolated-client') {
        report(
            'portable-trust-unsupported',
            'trust',
            `Set manifest.trust to "isolated-client"; the portable profile forbids ${
                trust === undefined ? 'a missing trust declaration' : `"${trust}"`
            } because it runs plugin code outside the host page.`
        );
    }

    if (clientIsolation === 'host') {
        report(
            'portable-host-isolation-unsupported',
            'runtime.client.isolation',
            'Set manifest.runtime.client.isolation to "worker" or "iframe"; "host" runs plugin code in the OR3 page origin and is not portable.'
        );
    }

    if (hasServerRuntime) {
        report(
            'portable-server-code-unsupported',
            'runtime.server',
            'Remove manifest.runtime.server (entry and routes); the portable profile allows browser-only client code with no native or server code.'
        );
    }

    for (const [group, dependencyIds] of [
        ['required', requiredDependencyIds],
        ['optional', optionalDependencyIds],
    ] as const) {
        for (const dependencyId of dependencyIds) {
            report(
                'portable-runtime-dependency-unsupported',
                dependencyId,
                `Remove plugin dependency "${dependencyId}" from manifest.dependencies.${group}; portable packages cannot depend on other plugins.`
            );
        }
    }

    if (stateRollback !== 'safe') {
        report(
            'portable-state-migration-unsupported',
            'stateCompatibility.rollback',
            `Set stateCompatibility.rollback to "safe"; portable packages cannot declare custom state migrations (found ${
                stateRollback === undefined
                    ? 'no rollback declaration'
                    : `"${String(stateRollback)}"`
            }).`
        );
    }
    if (stateVersion > readsMaximum) {
        report(
            'portable-state-migration-unsupported',
            'stateCompatibility.version',
            `Set stateCompatibility.version to at most reads.maximum (${readsMaximum}); portable packages cannot migrate state forward across versions.`
        );
    }
    if (readsMinimum > readsMaximum) {
        report(
            'portable-state-migration-unsupported',
            'stateCompatibility.reads',
            `Set stateCompatibility.reads.minimum (${readsMinimum}) to no greater than reads.maximum (${readsMaximum}); portable packages cannot perform range migrations.`
        );
    }

    const scripts = packageJson?.scripts ?? {};
    for (const name of LIFECYCLE_SCRIPTS) {
        if (scripts[name] !== undefined) {
            report(
                'portable-lifecycle-script-unsupported',
                name,
                `Remove the "${name}" script from package.json; portable packages are installed without running lifecycle scripts.`
            );
        }
    }

    const dependencies = packageJson?.dependencies ?? {};
    for (const name of Object.keys(dependencies)) {
        if (ALLOWED_PACKAGE_DEPENDENCIES.has(name)) continue;
        report(
            'portable-package-dependency-unsupported',
            name,
            `Remove "${name}" from package.json dependencies; portable packages may only depend on "@or3/plugin-sdk" at runtime. Move bundled build-time deps to devDependencies and "vue" to peerDependencies.`
        );
    }

    if (clientEntry !== undefined && !isPortableEntryPath(clientEntry)) {
        report(
            'portable-remote-code-unsupported',
            clientEntry,
            `Set runtime.client.entry to a relative ".mjs" or ".js" file bundled in the package; "${clientEntry}" is remote or not a portable JavaScript entry.`
        );
    }

    if (setupUsable) {
        if (settingsSchema !== setupUsable.settingsSchemaPath) {
            report(
                'portable-settings-schema-mismatch',
                'settings.schema',
                `Set manifest.settings.schema to "${setupUsable.settingsSchemaPath}" (currently ${
                    settingsSchema === undefined ? 'unset' : `"${settingsSchema}"`
                }) so the manifest and ${PACKAGE_SETUP_FILE} agree. applyPortableProfileToManifest() applies this.`
            );
        }
        // `scope: "user"` is declared but has no per-member store: the save
        // path would silently share the value as workspace configuration.
        // Refuse admission until a user-scoped store with matching read/write
        // authorization exists.
        for (const [index, field] of setupUsable.fields.entries()) {
            if (field.scope === 'user') {
                report(
                    'portable-user-scope-unsupported',
                    `${PACKAGE_SETUP_FILE}.fields[${index}].scope`,
                    `Field "${field.key}" declares scope "user", which has no per-member store yet; remove the scope or set it to "workspace" until user-scoped settings are supported.`
                );
            }
        }
    }

    if (policyUsable && setupUsable) {
        const declaredConnections = new Set(
            policyUsable.connections.map((connection) => connection.id)
        );
        const declaredOperations = new Set<string>();
        for (const connection of policyUsable.connections) {
            for (const operation of connection.operations) declaredOperations.add(operation);
        }
        for (const destination of policyUsable.destinations) {
            declaredOperations.add(destination.id);
        }
        // Read/write declarations are host operations too, so a first or test
        // action may name them directly (e.g. "documents.write").
        for (const scope of policyUsable.dataScopes) declaredOperations.add(scope);
        for (const write of policyUsable.writes) declaredOperations.add(write);
        for (const connectionId of setupUsable.connections ?? []) {
            if (!declaredConnections.has(connectionId)) {
                report(
                    'portable-setup-connection-unknown',
                    connectionId,
                    `Declare connection "${connectionId}" in policy.connections, or remove it from setup.connections.`
                );
            }
        }
        const actionOperations = uniqueStable(
            [setupUsable.testAction?.operationId, setupUsable.firstAction?.operationId].filter(
                (value): value is string => typeof value === 'string'
            )
        );
        for (const operationId of actionOperations) {
            if (!declaredOperations.has(operationId)) {
                report(
                    'portable-setup-operation-unknown',
                    operationId,
                    `Declare operation "${operationId}" in a policy connection's operations, a destination id, dataScopes or writes, or remove it from ${PACKAGE_SETUP_FILE}.`
                );
            }
        }
    }

    if (policyUsable) {
        const granted = new Set<string>(requestedGrants);
        for (const scope of policyUsable.dataScopes) {
            if (!granted.has(scope)) {
                report(
                    'portable-policy-grant-mismatch',
                    scope,
                    `policy.dataScopes lists "${scope}" but manifest.requestedGrants omits it. Add "${scope}" to requestedGrants or remove it from the policy.`
                );
            }
        }
        for (const write of policyUsable.writes) {
            if (!granted.has(write)) {
                report(
                    'portable-policy-grant-mismatch',
                    write,
                    `policy.writes lists "${write}" but manifest.requestedGrants omits it. Add "${write}" to requestedGrants or remove it from the policy.`
                );
            }
        }
        const usesNetwork =
            policyUsable.destinations.length > 0 || policyUsable.connections.length > 0;
        if (usesNetwork && !granted.has(NETWORK_GRANT)) {
            report(
                'portable-policy-grant-mismatch',
                NETWORK_GRANT,
                `policy declares destinations or connections but manifest.requestedGrants omits "${NETWORK_GRANT}". Add "${NETWORK_GRANT}" to requestedGrants or remove the declarations.`
            );
        }
        if (!usesNetwork && granted.has(NETWORK_GRANT)) {
            report(
                'portable-policy-grant-mismatch',
                NETWORK_GRANT,
                `manifest.requestedGrants includes "${NETWORK_GRANT}" but the policy declares no destinations or connections. Add a destination or connection, or remove the grant.`
            );
        }
        for (const grant of READ_GRANTS) {
            if (granted.has(grant) && !policyUsable.dataScopes.includes(grant)) {
                report(
                    'portable-policy-grant-mismatch',
                    grant,
                    `manifest.requestedGrants includes "${grant}" but policy.dataScopes omits it. Add "${grant}" to dataScopes or remove it from the manifest.`
                );
            }
        }
        for (const grant of WRITE_GRANTS) {
            if (granted.has(grant) && !policyUsable.writes.includes(grant)) {
                report(
                    'portable-policy-grant-mismatch',
                    grant,
                    `manifest.requestedGrants includes "${grant}" but policy.writes omits it. Add "${grant}" to writes or remove it from the manifest.`
                );
            }
        }

        const required = new Set(requiredFeatures);
        for (const feature of policyUsable.requiredFeatures ?? []) {
            if (!required.has(feature)) {
                report(
                    'portable-feature-mismatch',
                    feature,
                    `policy.requiredFeatures includes "${feature}" but manifest.features.required omits it. Add it to the manifest; applyPortableProfileToManifest() applies this.`
                );
            }
        }
    }

    return Object.freeze(findings);
}
