#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const qualifiedVersions = {
    '@or3/intern-client': '0.1.1',
    'or3-provider-basic-auth': '0.0.7',
    'or3-provider-clerk': '0.0.4',
    'or3-provider-convex': '0.0.4',
    'or3-provider-fs': '0.0.4',
    'or3-provider-s3': '0.0.4',
    'or3-provider-sqlite': '0.0.4',
    'or3-scroll': '0.1.1',
    'or3-workflow-core': '0.1.4',
    'or3-workflow-vue': '0.1.6',
};

export function prepareDockerManifest(input) {
    const manifest = structuredClone(input);
    for (const [name, version] of Object.entries(qualifiedVersions)) {
        if (name in (manifest.dependencies ?? {})) {
            manifest.dependencies[name] = version;
        }
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
