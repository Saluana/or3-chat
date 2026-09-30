import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { CORE_NUXT_AUTO_IMPORTS } from '../conformance-rules';
import {
    composeV2Conformance,
    evaluateV2Conformance,
    moduleSpecifiers,
    readPortableJson,
    type V2ConformanceIssue,
    type V2ConformanceIssueCode,
    type V2ConformanceModule,
    type V2ConformanceResult,
} from '../conformance-engine';
import { PACKAGE_POLICY_FILE, PACKAGE_SETUP_FILE } from '../profile';
import { listArtifactFiles, listPackageFiles, packageRootFromCli, posix } from './shared';

/**
 * Standalone conformance checker used by the `or3-plugin` CLI when no OR3
 * checkout is available.
 *
 * The decision engine itself lives in `../conformance-engine` and is shared with
 * the OR3 host reviewer, so the two cannot drift. This module only supplies the
 * SDK-specific inputs: a lexical module-graph scan that skips the files the
 * packer excludes and the SDK's own dependency/API ranges.
 */

export type { V2ConformanceIssue, V2ConformanceIssueCode, V2ConformanceResult };
export { moduleSpecifiers };

const CODE_FILE = /\.[cm]?[jt]sx?$/;

export interface CheckV2PackageConformanceOptions {
    /** Reserved for host callers that need the same signature as the host checker. */
    readonly repoRoot?: string;
    /**
     * `source` applies the packer's exclusions because the directory will be
     * packaged. `artifact` reviews what is actually present — an extracted
     * archive or a built tree — where filename-based exclusions would skip
     * shipped code (including a declared client entry named like a test file).
     */
    readonly mode?: ConformanceReviewMode;
}

export type ConformanceReviewMode = 'source' | 'artifact';

function readJsonOrNull(path: string): unknown | null {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
        return null;
    }
}

function sdkVersion(): string {
    const packageJson = readJsonOrNull(resolve(packageRootFromCli(), 'package.json'));
    if (packageJson && typeof packageJson === 'object' && !Array.isArray(packageJson)) {
        const version = (packageJson as Record<string, unknown>).version;
        if (typeof version === 'string') return version;
    }
    return '0.0.0';
}

/**
 * Reads the runtime modules to scan. Source review uses the packer's shippable
 * set, so an author may use `@or3/plugin-sdk/testing` in test files and
 * `@or3/plugin-sdk/profile` in authoring files. Artifact review scans every code
 * file present, because excluding by filename would hide shipped code from the
 * gate.
 */
export function collectV2ModuleGraph(
    root: string,
    mode: ConformanceReviewMode = 'source'
): V2ConformanceModule[] {
    let files: string[];
    try {
        files =
            mode === 'artifact'
                ? listArtifactFiles(root)
                : listPackageFiles(root, { shippableOnly: true });
    } catch {
        return [];
    }
    return files
        .filter((file) => CODE_FILE.test(file))
        .map((file) => ({
            path: posix(relative(root, file)),
            source: readFileSync(file, 'utf8'),
        }));
}

export async function checkV2PackageConformance(
    packageRoot: string,
    options: CheckV2PackageConformanceOptions = {}
): Promise<V2ConformanceResult> {
    const root = resolve(packageRoot);
    const policyPath = resolve(root, PACKAGE_POLICY_FILE);
    const setupPath = resolve(root, PACKAGE_SETUP_FILE);
    const decision = evaluateV2Conformance({
        manifest: readJsonOrNull(resolve(root, 'or3.manifest.json')),
        packageJson: readJsonOrNull(resolve(root, 'package.json')),
        moduleGraph: collectV2ModuleGraph(root, options.mode ?? 'source'),
        bannedAutoImports: CORE_NUXT_AUTO_IMPORTS,
        sdkVersion: sdkVersion(),
        policy: readPortableJson(policyPath),
        setup: readPortableJson(setupPath),
        shipsPolicy: existsSync(policyPath),
        shipsSetup: existsSync(setupPath),
    });
    return composeV2Conformance(root, decision);
}
