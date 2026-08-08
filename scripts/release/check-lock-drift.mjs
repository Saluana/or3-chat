#!/usr/bin/env node
// Qualification gate for the fixed-profile registry-clean lock.
//
// The committed package-lock.json is the FIXED-PROFILE lock: it is generated
// from the pruned manifest (see scripts/docker/prepare-manifest.mjs), which
// pins first-party versions and removes the inactive provider stacks
// (or3-provider-clerk/convex/s3 and the `convex` dev dependency). It therefore
// intentionally differs from the contributor package.json, which still lists
// every provider for local development. This script verifies the committed
// lock still matches the pruned manifest so the Docker build can install with
// `npm ci` instead of re-resolving the tree (no floating resolution).
//
// Run from the repository root: node scripts/release/check-lock-drift.mjs

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareDockerManifest } from '../docker/prepare-manifest.mjs';

const root = process.cwd();
const manifestPath = resolve(root, 'package.json');
const lockPath = resolve(root, 'package-lock.json');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const lock = JSON.parse(await readFile(lockPath, 'utf8'));

const pruned = prepareDockerManifest(manifest);
const rootPackage = lock.packages?.[''];
const failures = [];

if (!rootPackage) {
  failures.push('package-lock.json has no root package entry (lock.packages[""]).');
} else {
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
  if (typeof version === 'string' && version.startsWith('file:../')) {
    failures.push(`lock entry ${name} uses a local link ${version}; the fixed-profile lock must be registry-clean.`);
  }
  if (typeof version === 'string' && version.startsWith('file:') && !(name === 'node_modules/@or3/plugin-sdk' && version === 'file:./packages/plugin-sdk')) {
    failures.push(`lock entry ${name} uses an unexpected file link ${version}; only @or3/plugin-sdk may be file:./packages/plugin-sdk.`);
  }
}

for (const name of ['or3-provider-clerk', 'or3-provider-convex', 'or3-provider-s3', 'convex']) {
  if (name in (lock.packages ?? {})) {
    failures.push(`lock contains inactive fixed-profile dependency ${name}; it must not enter the production graph.`);
  }
}

if (failures.length > 0) {
  console.error('Lock drift detected: the committed package-lock.json does not match the fixed-profile manifest.');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('Regenerate the lock from the pruned manifest (see scripts/docker/prepare-manifest.mjs) and commit it.');
  process.exit(1);
}

console.log('Lock drift check passed: package-lock.json matches the fixed-profile manifest and is registry-clean.');
