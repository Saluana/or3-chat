/**
 * Reads a package's generated portable descriptors from an installed extension.
 *
 * Paths are confined to the extensions directory, files are size-bounded, and a
 * malformed descriptor is reported as unavailable rather than guessed at.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
    parsePackagePolicy,
    parseSetupDescriptor,
    type Or3PackagePolicyV1,
    type Or3SetupDescriptorV1,
} from '@or3/plugin-sdk/profile';
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
