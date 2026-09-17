import { existsSync, readFileSync } from 'node:fs';
import {
    ALLOWED_BARE_IMPORTS,
    PRIVATE_IMPORT_PREFIXES,
} from './conformance-rules';
import {
    PackageTreeValidationError,
    verifyPackageTree,
    type PackageTreeValidationCode,
} from './package-tree';
import type { PluginManifestV2 } from './manifest';
import {
    PACKAGE_POLICY_FILE,
    PACKAGE_SETUP_FILE,
    PORTABLE_PROFILE_ID,
    validatePortableProfile,
    type Or3PackagePolicyV1,
    type Or3SetupDescriptorV1,
    type PortablePackageJson,
    type PortableProfileFinding,
    type PortableProfileFindingCode,
} from './profile';
import { isValidVersionRange, satisfiesVersionRange } from './semver-range';

/**
 * The single V2 conformance decision engine shared by the OR3 host reviewer and
 * the standalone `or3-plugin` CLI.
 *
 * Every input is explicit — the module graph, the parsed `package.json`, the
 * manifest, the SDK version and the portable descriptors — so the two callers
 * cannot drift. The engine performs static analysis only; canonical package
 * verification is composed on top by {@link composeV2Conformance}, which binds
 * the findings to the exact artifact digest that was verified.
 */

export const CONFORMANCE_MANIFEST_FILE = 'or3.manifest.json';
export const CONFORMANCE_PACKAGE_FILE = 'package.json';

export type V2ConformanceIssueCode =
    | 'manifest-invalid'
    | 'sdk-dependency-missing'
    | 'sdk-range-invalid'
    | 'sdk-range-mismatch'
    | 'plugin-api-range-invalid'
    | 'plugin-api-range-mismatch'
    | 'private-host-import'
    | 'unresolved-bare-import'
    | 'nuxt-auto-import'
    | 'client-entry-missing'
    | PortableProfileFindingCode
    | PackageTreeValidationCode;

export interface V2ConformanceIssue {
    readonly code: V2ConformanceIssueCode;
    readonly file: string;
    readonly severity?: 'error' | 'warning' | 'info';
    readonly subject?: string;
    readonly message: string;
}

/** One source file handed to the engine; `path` is package-root relative. */
export interface V2ConformanceModule {
    readonly path: string;
    /**
     * Raw source. Used when `specifiers`/`autoImportUses` are not supplied, so the
     * standalone SDK derives facts lexically. A host with a real parser supplies
     * the derived facts instead and omits the source.
     */
    readonly source?: string;
    /** Import specifiers, when a parser already derived them. */
    readonly specifiers?: readonly string[];
    /** Banned auto-import names this module uses, when a parser derived them. */
    readonly autoImportUses?: readonly string[];
}

export interface V2ConformanceEngineInput {
    /** Parsed `or3.manifest.json`, or the raw value when missing/invalid. */
    readonly manifest: unknown;
    /** Parsed `package.json`, or `null` when it is missing or invalid JSON. */
    readonly packageJson: unknown | null;
    readonly moduleGraph: readonly V2ConformanceModule[];
    /** Nuxt auto-imports that are unavailable to a V2 package. */
    readonly bannedAutoImports: ReadonlySet<string>;
    /** Version of the reviewing `@or3/plugin-sdk`. */
    readonly sdkVersion: string;
    /** Parsed `or3.package-policy.json`, or `null` when absent/unreadable. */
    readonly policy?: unknown | null;
    /** Parsed `or3.setup.json`, or `null` when absent/unreadable. */
    readonly setup?: unknown | null;
    readonly shipsPolicy?: boolean;
    readonly shipsSetup?: boolean;
}

export type V2ConformanceDecision =
    | { readonly status: 'legacy-v1' }
    | {
          readonly status: 'v2';
          readonly issues: readonly V2ConformanceIssue[];
          /** False when the manifest itself is unusable and hashing is moot. */
          readonly verifiable: boolean;
      };

export type V2ConformanceResult =
    | {
          readonly status: 'legacy-v1';
          readonly issues: readonly [];
          readonly digest: null;
          readonly manifestDigest: null;
      }
    | {
          readonly status: 'conformant';
          readonly issues: readonly [];
          readonly digest: string;
          readonly manifestDigest: string;
      }
    | {
          readonly status: 'nonconformant';
          readonly issues: readonly V2ConformanceIssue[];
          readonly digest: string | null;
          readonly manifestDigest: string | null;
      };

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Portable findings reuse the conformance shape; the file is derived from the code. */
export function portableFindingFile(finding: PortableProfileFinding): string {
    switch (finding.code) {
        case 'portable-profile-missing':
        case 'portable-profile-version-unsupported':
            return finding.subject === PACKAGE_SETUP_FILE ? PACKAGE_SETUP_FILE : PACKAGE_POLICY_FILE;
        case 'portable-setup-connection-unknown':
        case 'portable-setup-operation-unknown':
        case 'portable-settings-schema-mismatch':
            return PACKAGE_SETUP_FILE;
        case 'portable-lifecycle-script-unsupported':
        case 'portable-package-dependency-unsupported':
            return CONFORMANCE_PACKAGE_FILE;
        case 'portable-policy-grant-mismatch':
            return PACKAGE_POLICY_FILE;
        default:
            return CONFORMANCE_MANIFEST_FILE;
    }
}

/** Parsed descriptor JSON, or `null` when the file is missing or unreadable. */
export function readPortableJson<T>(path: string): T | null {
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
        return null;
    }
}

export function isBareImport(specifier: string): boolean {
    return !specifier.startsWith('.') && !specifier.startsWith('/') && !/^[a-z]+:/i.test(specifier);
}

/**
 * Replaces comments (and, when `maskStrings` is set, string/template literals)
 * with spaces while preserving line breaks, so offsets and identifier scanning
 * stay stable without a full parser.
 */
export function maskSource(source: string, maskStrings: boolean): string {
    let out = '';
    let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index]!;
        const next = source[index + 1];
        if (state === 'code') {
            if (char === '/' && next === '/') {
                state = 'line';
                out += '  ';
                index += 1;
                continue;
            }
            if (char === '/' && next === '*') {
                state = 'block';
                out += '  ';
                index += 1;
                continue;
            }
            if (maskStrings && (char === "'" || char === '"')) {
                state = char === "'" ? 'single' : 'double';
                out += ' ';
                continue;
            }
            if (maskStrings && char === '`') {
                state = 'template';
                out += ' ';
                continue;
            }
            out += char;
            continue;
        }
        if (state === 'line') {
            out += char === '\n' ? '\n' : ' ';
            if (char === '\n') state = 'code';
            continue;
        }
        if (state === 'block') {
            if (char === '*' && next === '/') {
                out += '  ';
                index += 1;
                state = 'code';
            } else {
                out += char === '\n' ? '\n' : ' ';
            }
            continue;
        }
        if (state === 'single' || state === 'double') {
            if (char === '\\') {
                out += '  ';
                index += 1;
                continue;
            }
            if ((state === 'single' && char === "'") || (state === 'double' && char === '"')) {
                state = 'code';
            }
            out += char === '\n' ? '\n' : ' ';
            continue;
        }
        // template literal
        if (char === '\\') {
            out += '  ';
            index += 1;
            continue;
        }
        if (char === '`') state = 'code';
        out += char === '\n' ? '\n' : ' ';
    }
    return out;
}

interface SourceSegment {
    readonly kind: 'code' | 'string';
    readonly text: string;
}

/**
 * Splits source into code and string-literal segments, dropping comments.
 *
 * A single-pass scanner is required because a regex cannot tell a `//` inside a
 * string (which is data) from a comment, nor an import written inside a string
 * (which is also data) from a real import. String values are preserved so
 * dynamic `import('…')`/`require('…')` specifiers remain visible.
 */
function scanSource(source: string): SourceSegment[] {
    const segments: SourceSegment[] = [];
    let code = '';
    let index = 0;
    const flushCode = (): void => {
        if (code.length > 0) {
            segments.push({ kind: 'code', text: code });
            code = '';
        }
    };
    const readQuoted = (quote: string): string => {
        let value = '';
        index += 1;
        while (index < source.length && source[index] !== quote) {
            if (source[index] === '\\') {
                value += source[index + 1] ?? '';
                index += 2;
                continue;
            }
            if (source[index] === '\n') break;
            value += source[index];
            index += 1;
        }
        index += 1;
        return value;
    };
    while (index < source.length) {
        const char = source[index]!;
        const next = source[index + 1];
        if (char === '/' && next === '/') {
            flushCode();
            while (index < source.length && source[index] !== '\n') index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            flushCode();
            index += 2;
            while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
                index += 1;
            }
            index += 2;
            code += ' ';
            continue;
        }
        if (char === '"' || char === "'") {
            flushCode();
            segments.push({ kind: 'string', text: readQuoted(char) });
            code += ' ';
            continue;
        }
        if (char === '`') {
            flushCode();
            index += 1;
            let literal = '';
            while (index < source.length) {
                const inner = source[index]!;
                if (inner === '\\') {
                    index += 2;
                    continue;
                }
                if (inner === '`') {
                    index += 1;
                    break;
                }
                if (inner === '$' && source[index + 1] === '{') {
                    // Skip the embedded expression; imports inside it are unusual
                    // and the code around it still gets scanned.
                    index += 2;
                    let depth = 1;
                    while (index < source.length && depth > 0) {
                        if (source[index] === '{') depth += 1;
                        else if (source[index] === '}') depth -= 1;
                        index += 1;
                    }
                    continue;
                }
                literal += inner;
                index += 1;
            }
            segments.push({ kind: 'string', text: literal });
            code += ' ';
            continue;
        }
        code += char;
        index += 1;
    }
    flushCode();
    return segments;
}

/**
 * Extracts module specifiers from source text. Handles multiline named imports,
 * `import type`, side-effect imports, `export … from`, dynamic `import()` and
 * `require()`, and cannot be confused by strings or comments.
 */
export function moduleSpecifiers(source: string): string[] {
    const result: string[] = [];
    // 0 = expecting nothing, 1 = expecting the specifier string, 2 = likewise.
    let expectingSpecifier = false;
    for (const segment of scanSource(source)) {
        if (segment.kind === 'string') {
            if (expectingSpecifier) {
                result.push(segment.text);
                expectingSpecifier = false;
            }
            continue;
        }
        const code = segment.text;
        if (/(?<![\w$.])(?:import|require)\s*\(\s*$/.test(code)) expectingSpecifier = true;
        else if (/(?<![\w$.])from\s*$/.test(code)) expectingSpecifier = true;
        else if (/(?<![\w$.])import\s*$/.test(code)) expectingSpecifier = true;
    }
    return [...new Set(result)];
}

function declaredNames(masked: string): Set<string> {
    const result = new Set<string>();
    const addAll = (text: string): void => {
        for (const identifier of text.matchAll(/[A-Za-z_$][\w$]*/g)) result.add(identifier[0]!);
    };
    const patterns = [
        /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\b/g,
        /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*/g,
        /\b(?:function|class)\s+[A-Za-z_$][\w$]*/g,
        // Only real parameter positions, so call arguments are not mistaken for
        // declarations (which would hide genuine auto-import uses).
        /\bfunction\b[^(]*\(([^()]*)\)/g,
        /\bcatch\s*\(([^()]*)\)/g,
        /\b([A-Za-z_$][\w$]*)\s*=>/g,
    ];
    for (const pattern of patterns) {
        for (const match of masked.matchAll(pattern)) addAll(match[0]);
    }
    // Destructured bindings, but only when a binding keyword introduces them.
    for (const match of masked.matchAll(/\b(?:const|let|var|catch)\b[^{};]*\{[^}]*\}/g)) {
        addAll(match[0]);
    }
    return result;
}

function nuxtAutoImportUses(masked: string, banned: ReadonlySet<string>): string[] {
    const declared = declaredNames(masked);
    const found = new Set<string>();
    for (const name of banned) {
        const pattern = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, 'g');
        for (const match of masked.matchAll(pattern)) {
            if (declared.has(name)) continue;
            const end = match.index + name.length;
            const following = masked.slice(end).match(/^\s*(.)/)?.[1];
            if (following === ':') continue;
            found.add(name);
        }
    }
    return [...found];
}

function issue(
    code: V2ConformanceIssueCode,
    file: string,
    message: string,
    subject?: string,
    severity?: V2ConformanceIssue['severity']
): V2ConformanceIssue {
    return Object.freeze({
        code,
        file,
        message,
        ...(subject === undefined ? {} : { subject }),
        ...(severity === undefined ? {} : { severity }),
    });
}

/**
 * Applies the full static/portable rule set. The returned issues are unsorted;
 * {@link composeV2Conformance} sorts and freezes the final list.
 */
export function evaluateV2Conformance(input: V2ConformanceEngineInput): V2ConformanceDecision {
    const manifest = input.manifest;
    if (!isJsonObject(manifest)) {
        return {
            status: 'v2',
            verifiable: false,
            issues: [
                issue(
                    'manifest-invalid',
                    CONFORMANCE_MANIFEST_FILE,
                    'Package manifest is missing or invalid JSON'
                ),
            ],
        };
    }
    if ((manifest.manifestVersion ?? 1) !== 2) {
        return { status: 'legacy-v1' };
    }

    const issues: V2ConformanceIssue[] = [];

    // --- package.json dependency and SDK API compatibility -------------------
    const packageJson = isJsonObject(input.packageJson) ? input.packageJson : null;
    if (packageJson === null) {
        issues.push(
            issue(
                'sdk-dependency-missing',
                CONFORMANCE_PACKAGE_FILE,
                'V2 package must declare an @or3/plugin-sdk dependency',
                '@or3/plugin-sdk'
            )
        );
    } else {
        const dependencies = isJsonObject(packageJson.dependencies) ? packageJson.dependencies : undefined;
        const peerDependencies = isJsonObject(packageJson.peerDependencies)
            ? packageJson.peerDependencies
            : undefined;
        const rawSdkRange =
            (dependencies?.['@or3/plugin-sdk'] as unknown) ??
            (peerDependencies?.['@or3/plugin-sdk'] as unknown);
        if (rawSdkRange === undefined) {
            issues.push(
                issue(
                    'sdk-dependency-missing',
                    CONFORMANCE_PACKAGE_FILE,
                    'V2 package must declare an @or3/plugin-sdk dependency',
                    '@or3/plugin-sdk'
                )
            );
        } else if (typeof rawSdkRange !== 'string' || !isValidVersionRange(rawSdkRange)) {
            issues.push(
                issue(
                    'sdk-range-invalid',
                    CONFORMANCE_PACKAGE_FILE,
                    'The @or3/plugin-sdk dependency range is invalid',
                    String(rawSdkRange)
                )
            );
        } else if (!satisfiesVersionRange(input.sdkVersion, rawSdkRange)) {
            issues.push(
                issue(
                    'sdk-range-mismatch',
                    CONFORMANCE_PACKAGE_FILE,
                    `SDK ${input.sdkVersion} is outside the package dependency range`,
                    rawSdkRange
                )
            );
        }
    }

    const engines = isJsonObject(manifest.engines) ? manifest.engines : undefined;
    const pluginApiRange = engines?.pluginApi;
    if (typeof pluginApiRange !== 'string' || !isValidVersionRange(pluginApiRange)) {
        issues.push(
            issue(
                'plugin-api-range-invalid',
                CONFORMANCE_MANIFEST_FILE,
                'Manifest plugin API engine range is invalid',
                String(pluginApiRange)
            )
        );
    } else if (!satisfiesVersionRange(input.sdkVersion, pluginApiRange)) {
        issues.push(
            issue(
                'plugin-api-range-mismatch',
                CONFORMANCE_MANIFEST_FILE,
                `SDK API ${input.sdkVersion} is outside the manifest range`,
                pluginApiRange
            )
        );
    }

    // --- runtime imports and Nuxt auto-imports -------------------------------
    // The declared client entry must be code that is actually present and
    // scanned; otherwise a package could name an unreviewed file as its entry.
    const runtimeClient = isJsonObject(manifest.runtime) ? manifest.runtime.client : undefined;
    const clientEntry = isJsonObject(runtimeClient) ? runtimeClient.entry : undefined;
    if (typeof clientEntry === 'string') {
        const present = input.moduleGraph.some((module) => module.path === clientEntry);
        if (!present) {
            issues.push(
                issue(
                    'client-entry-missing',
                    clientEntry,
                    `The declared runtime.client.entry "${clientEntry}" is not present (or is not scannable code) in the reviewed package`,
                    clientEntry
                )
            );
        }
    }
    for (const module of input.moduleGraph) {
        const fileName = module.path;
        const specifiers = module.specifiers ?? moduleSpecifiers(module.source ?? '');
        for (const specifier of specifiers) {
            if (
                PRIVATE_IMPORT_PREFIXES.some(
                    (prefix) => specifier === prefix || specifier.startsWith(prefix)
                )
            ) {
                issues.push(
                    issue(
                        'private-host-import',
                        fileName,
                        `V2 packages cannot import OR3 private path ${specifier}`,
                        specifier
                    )
                );
            } else if (isBareImport(specifier) && !ALLOWED_BARE_IMPORTS.has(specifier)) {
                issues.push(
                    issue(
                        'unresolved-bare-import',
                        fileName,
                        `Bare import ${specifier} is not an allowed host external`,
                        specifier
                    )
                );
            }
        }
        const autoImportUses =
            module.autoImportUses ??
            nuxtAutoImportUses(maskSource(module.source ?? '', true), input.bannedAutoImports);
        for (const name of autoImportUses) {
            issues.push(
                issue(
                    'nuxt-auto-import',
                    fileName,
                    `V2 package uses Nuxt auto-import ${name}`,
                    name
                )
            );
        }
    }

    // --- portable profile ----------------------------------------------------
    const features = isJsonObject(manifest.features) ? manifest.features : undefined;
    const requiredFeatures = Array.isArray(features?.required) ? features.required : [];
    const declaresPortable = requiredFeatures.includes(PORTABLE_PROFILE_ID);
    const shipsPortable = input.shipsPolicy === true || input.shipsSetup === true;
    if (declaresPortable || shipsPortable) {
        const findings = validatePortableProfile({
            manifest: manifest as unknown as PluginManifestV2,
            policy: (input.policy ?? null) as Or3PackagePolicyV1 | null,
            setup: (input.setup ?? null) as Or3SetupDescriptorV1 | null,
            packageJson: (packageJson ?? {}) as PortablePackageJson,
        });
        for (const finding of findings) {
            issues.push(
                issue(
                    finding.code,
                    portableFindingFile(finding),
                    finding.message,
                    finding.subject,
                    finding.severity
                )
            );
        }
    }

    return { status: 'v2', verifiable: true, issues };
}

function sortIssues(issues: V2ConformanceIssue[]): V2ConformanceIssue[] {
    return [...issues].sort((left, right) =>
        `${left.file}:${left.code}:${left.subject ?? ''}`.localeCompare(
            `${right.file}:${right.code}:${right.subject ?? ''}`
        )
    );
}

/**
 * Composes a static decision with canonical verification of the exact artifact,
 * binding the findings to the verified digest. A tampered `integrity.package`
 * (or any other canonical tree failure) surfaces with its canonical code and
 * makes the result non-conformant.
 */
export async function composeV2Conformance(
    packageRoot: string,
    decision: V2ConformanceDecision
): Promise<V2ConformanceResult> {
    if (decision.status === 'legacy-v1') {
        return { status: 'legacy-v1', issues: [], digest: null, manifestDigest: null };
    }
    const issues = [...decision.issues];
    let digest: string | null = null;
    let manifestDigest: string | null = null;
    if (decision.verifiable) {
        try {
            const verified = await verifyPackageTree(packageRoot);
            digest = verified.digest;
            manifestDigest = verified.manifestDigest;
        } catch (error) {
            if (!(error instanceof PackageTreeValidationError)) throw error;
            issues.push(
                issue(error.code, error.entryPath ?? CONFORMANCE_MANIFEST_FILE, error.message)
            );
        }
    }
    if (issues.length > 0) {
        return {
            status: 'nonconformant',
            issues: Object.freeze(sortIssues(issues)),
            digest,
            manifestDigest,
        };
    }
    if (digest === null || manifestDigest === null) {
        return {
            status: 'nonconformant',
            issues: Object.freeze([
                issue(
                    'manifest-invalid',
                    CONFORMANCE_MANIFEST_FILE,
                    'Package could not be verified'
                ),
            ]),
            digest: null,
            manifestDigest: null,
        };
    }
    return { status: 'conformant', issues: [], digest, manifestDigest };
}
