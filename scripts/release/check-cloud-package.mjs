#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const rootManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const cloudManifest = JSON.parse(await readFile(resolve(root, 'packages/or3-cloud/package.json'), 'utf8'));
const source = await readFile(resolve(root, 'packages/or3-cloud/src/cli.ts'), 'utf8');
const versionMatch = source.match(/PACKAGE_VERSION\s*=\s*'([^']+)'/);
const verifyRegistry = process.argv.includes('--registry');
const qualifiedVersions = JSON.parse(await readFile(resolve(root, 'packages/create-or3-chat/first-party-versions.json'), 'utf8'));

if (!versionMatch) throw new Error('Cloud CLI source must declare PACKAGE_VERSION.');
if (rootManifest.version !== cloudManifest.version || cloudManifest.version !== versionMatch[1]) {
  throw new Error(`Cloud versions differ: app=${rootManifest.version}, package=${cloudManifest.version}, CLI=${versionMatch[1]}.`);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cloudManifest.version)) {
  throw new Error(`Invalid Cloud package version ${cloudManifest.version}.`);
}

const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith('v') && tag !== `v${cloudManifest.version}`) {
  throw new Error(`Release tag ${tag} does not match Cloud version ${cloudManifest.version}.`);
}

for (const [name, version] of Object.entries(qualifiedVersions)) {
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(String(version))) {
    throw new Error(`First-party dependency ${name} must use an exact published version, got ${version}.`);
  }
}

function npmView(name, version) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npm', ['view', `${name}@${version}`, 'version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0 && stdout.trim() === version) return resolvePromise();
      rejectPromise(new Error(`Missing registry dependency ${name}@${version}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

if (verifyRegistry) {
  for (const [name, version] of Object.entries(qualifiedVersions)) await npmView(name, version);
}

console.log(`OR3 Cloud ${cloudManifest.version} is version-aligned with the application and image tag${verifyRegistry ? ' and exact first-party registry dependencies' : ''}.`);
