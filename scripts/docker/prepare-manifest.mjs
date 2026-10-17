#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync as readFileSyncCallback } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const versionFile = process.env.OR3_FIRST_PARTY_VERSIONS_FILE ?? resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../packages/create-or3-chat/first-party-versions.json',
);
if (!existsSync(versionFile)) {
    throw new Error(`First-party version contract is missing at ${versionFile}.`);
}
const qualifiedVersions = JSON.parse(readFileSyncCallback(versionFile, 'utf8'));

// The managed image ships only the fixed profile: Basic Auth + SQLite +
// filesystem. Clerk, Convex, and S3 stacks are contributor/operator paths and
// must not enter the registry-clean production graph (Convex also carries the
// inactive ws advisory).
const INACTIVE_FIXED_PROFILE_PROVIDERS = [
    'or3-provider-clerk',
    'or3-provider-convex',
    'or3-provider-s3',
];
const INACTIVE_FIXED_PROFILE_DEV_DEPENDENCIES = ['convex'];

export function prepareDockerManifest(input) {
    const manifest = structuredClone(input);
    for (const [name, version] of Object.entries(qualifiedVersions)) {
        if (name in (manifest.dependencies ?? {})) {
            manifest.dependencies[name] = version;
        }
    }

    for (const name of INACTIVE_FIXED_PROFILE_PROVIDERS) {
        delete manifest.dependencies?.[name];
    }
    for (const name of INACTIVE_FIXED_PROFILE_DEV_DEPENDENCIES) {
        delete manifest.devDependencies?.[name];
    }

    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        if (
            typeof version === 'string' &&
            version.startsWith('file:') &&
            !(name === '@or3/plugin-sdk' && version === 'file:./packages/plugin-sdk')
        ) {
            throw new Error(
                `Docker dependency ${name} is not registry-clean: ${version}`
            );
        }
    }

    return manifest;
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (directPath === resolve(fileURLToPath(import.meta.url))) {
    const manifestPath = resolve(process.argv[2] ?? 'package.json');
    const manifest = prepareDockerManifest(
        JSON.parse(await readFile(manifestPath, 'utf8'))
    );
    await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8'
    );
}
