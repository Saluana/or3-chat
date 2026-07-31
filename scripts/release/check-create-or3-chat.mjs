#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const requireLocks = process.argv.includes('--require-locks');
const verifyRegistry = process.argv.includes('--registry');
const rootManifest = JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8')
);
const creatorManifest = JSON.parse(
    await readFile(
        resolve(root, 'packages/create-or3-chat/package.json'),
        'utf8'
    )
);
const templateManifest = JSON.parse(
    await readFile(
        resolve(root, 'packages/create-or3-chat/dist/template/package.json'),
        'utf8'
    )
);
const qualifiedFirstPartyVersions = JSON.parse(
    await readFile(
        resolve(
            root,
            'packages/create-or3-chat/first-party-versions.json'
        ),
        'utf8'
    )
);

if (
    rootManifest.version !== creatorManifest.version ||
    rootManifest.version !== templateManifest.version
) {
    throw new Error(
        `Release versions differ: OR3=${rootManifest.version}, creator=${creatorManifest.version}, template=${templateManifest.version}.`
    );
}

const releaseTag = process.env.GITHUB_REF_NAME;
if (
    releaseTag?.startsWith('v') &&
    releaseTag !== `v${rootManifest.version}`
) {
    throw new Error(
        `Release tag ${releaseTag} does not match package version v${rootManifest.version}.`
    );
}

const registryDependencies = Object.entries(qualifiedFirstPartyVersions);
for (const [name, version] of registryDependencies) {
    if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(String(version))) {
        throw new Error(
            `First-party dependency ${name} must use an exact published version, got ${version}.`
        );
    }
    if (
        name in templateManifest.dependencies &&
        templateManifest.dependencies[name] !== version
    ) {
        throw new Error(
            `Template dependency ${name} is ${templateManifest.dependencies[name]}, expected ${version}.`
        );
    }
}

for (const [section, entries] of Object.entries({
    dependencies: templateManifest.dependencies ?? {},
    devDependencies: templateManifest.devDependencies ?? {},
    optionalDependencies: templateManifest.optionalDependencies ?? {},
    peerDependencies: templateManifest.peerDependencies ?? {},
})) {
    for (const [name, version] of Object.entries(entries)) {
        if (typeof version !== 'string') {
            throw new Error(
                `${section} entry ${name} has a non-string version.`
            );
        }
        if (
            version.startsWith('file:') &&
            !(
                section === 'dependencies' &&
                name === '@or3/plugin-sdk' &&
                version === 'file:./packages/plugin-sdk'
            )
        ) {
            throw new Error(
                `${section} entry ${name} points outside the generated project: ${version}`
            );
        }
    }
}

if (requireLocks) {
    await access(
        resolve(root, 'packages/create-or3-chat/dist/template/package-lock.json')
    );
    await access(resolve(root, 'packages/create-or3-chat/dist/template/bun.lock'));
}

function npmView(name, version) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('npm', ['view', `${name}@${version}`, 'version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });
        child.once('error', rejectPromise);
        child.once('exit', (code) => {
            if (code === 0 && stdout.trim() === version) {
                resolvePromise();
            } else {
                rejectPromise(
                    new Error(
                        `Missing registry dependency ${name}@${version}: ${stderr.trim() || stdout.trim()}`
                    )
                );
            }
        });
    });
}

if (verifyRegistry) {
    for (const [name, version] of registryDependencies) {
        await npmView(name, version);
    }
}

console.log(
    `create-or3-chat ${creatorManifest.version} is version-aligned with ${registryDependencies.length} exact first-party registry dependencies.`
);
