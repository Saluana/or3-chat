#!/usr/bin/env node
// Qualify the selected profile's registry-clean dependency lock against its
// projected manifest before Docker installs it without re-resolving the tree.
//
// Run from the repository root: node scripts/release/check-lock-drift.mjs

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dockerProfile, inactiveDockerProviders, prepareDockerManifest } from '../docker/prepare-manifest.mjs';

const root = process.cwd();
const manifestPath = resolve(root, 'package.json');
const profile = dockerProfile();
const lockName = profile === 'basic-sqlite-fs' ? 'package-lock.json' : 'package-lock.clerk-sqlite-s3.json';
const lockPath = resolve(root, lockName);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const lock = JSON.parse(await readFile(lockPath, 'utf8'));

const pruned = prepareDockerManifest(manifest, profile);
const rootPackage = lock.packages?.[''];
const failures = [];

if (lock.version !== manifest.version) {
  failures.push(`${lockName} version is ${lock.version ?? 'missing'}, expected ${manifest.version}.`);
}
if (!rootPackage) {
  failures.push(`${lockName} has no root package entry (lock.packages[""]).`);
} else {
  if (rootPackage.version !== manifest.version) {
    failures.push(`${lockName} root version is ${rootPackage.version ?? 'missing'}, expected ${manifest.version}.`);
  }
  const expectedDeps = pruned.dependencies ?? {};
  const expectedDevDeps = pruned.devDependencies ?? {};
  const actualDeps = rootPackage.dependencies ?? {};
  const actualDevDeps = rootPackage.devDependencies ?? {};

  for (const [name, version] of Object.entries(expectedDeps)) {
    if (actualDeps[name] !== version) {
      failures.push(`lock root dependency ${name} is ${actualDeps[name] ?? 'missing'}, expected ${version}.`);
    }
  }
  for (const name of Object.keys(actualDeps)) {
    if (!(name in expectedDeps)) {
      failures.push(`lock root dependency ${name} is not in the pruned manifest.`);
    }
  }
  for (const [name, version] of Object.entries(expectedDevDeps)) {
    if (actualDevDeps[name] !== version) {
      failures.push(`lock root devDependency ${name} is ${actualDevDeps[name] ?? 'missing'}, expected ${version}.`);
    }
  }
  for (const name of Object.keys(actualDevDeps)) {
    if (!(name in expectedDevDeps)) {
      failures.push(`lock root devDependency ${name} is not in the pruned manifest.`);
    }
  }
}

for (const [name, entry] of Object.entries(lock.packages ?? {})) {
  const version = typeof entry === 'string' ? entry : entry?.version;
  if (typeof entry?.resolved === 'string' && !entry.resolved.startsWith('https://') &&
      !(name === 'node_modules/@or3/plugin-sdk' && entry.resolved === 'packages/plugin-sdk' && entry.link === true)) {
    failures.push(`lock entry ${name} uses a local link ${entry.resolved}; the production lock must be registry-clean.`);
  }
  if (typeof version === 'string' && version.startsWith('file:../')) {
    failures.push(`lock entry ${name} uses a local link ${version}; the fixed-profile lock must be registry-clean.`);
  }
  if (typeof version === 'string' && version.startsWith('file:') && !(name === 'node_modules/@or3/plugin-sdk' && version === 'file:./packages/plugin-sdk')) {
    failures.push(`lock entry ${name} uses an unexpected file link ${version}; only @or3/plugin-sdk may be file:./packages/plugin-sdk.`);
  }
}

for (const name of [...inactiveDockerProviders(profile), 'convex']) {
  // npm lock packages are keyed by install path, including nested dependencies.
  for (const packagePath of Object.keys(lock.packages ?? {})) {
    if (packagePath === `node_modules/${name}` || packagePath.endsWith(`/node_modules/${name}`)) {
      failures.push(`lock contains inactive fixed-profile dependency ${packagePath}; it must not enter the production graph.`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Lock drift detected: ${lockName} does not match the ${profile} manifest.`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('Regenerate the lock from the pruned manifest (see scripts/docker/prepare-manifest.mjs) and commit it.');
  process.exit(1);
}

console.log(`Lock drift check passed: ${lockName} matches the ${profile} manifest and is registry-clean.`);
