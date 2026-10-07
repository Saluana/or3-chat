import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Must stay directly under src/: '../' is the package root from here and from the bundled dist/cli.mjs.
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));

export const PACKAGE_VERSION = '0.1.78';
export const IMAGE_REPOSITORY = 'ghcr.io/saluana/or3-chat';
export const ASSET_ROOT = resolve(fileURLToPath(new URL('../assets/', import.meta.url)));

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

type PackagedOr3CloudMetadata = {
  imageDigest?: unknown;
  operatorImageDigest?: unknown;
  sourceRevision?: unknown;
  stateSchema?: unknown;
  dashboardUpdateMinimumSourceVersion?: unknown;
};
type PackageManifest = { version?: unknown; or3Cloud?: PackagedOr3CloudMetadata };

let manifest: PackageManifest | undefined;

function packageManifest(): PackageManifest {
  if (manifest) return manifest;
  try {
    manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as PackageManifest;
  } catch {
    manifest = {};
  }
  return manifest;
}

/**
 * A release-bound value is honoured only when this package is that exact
 * version; a present-but-malformed value is refused rather than ignored.
 */
function packagedReleaseValue(
  key: 'imageDigest' | 'operatorImageDigest' | 'sourceRevision',
  version: string,
  pattern: RegExp,
  invalidMessage: string,
) {
  const { version: packagedVersion, or3Cloud } = packageManifest();
  const value = or3Cloud?.[key];
  if (packagedVersion !== version || value === undefined) return undefined;
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(invalidMessage);
  return value;
}

export function packagedSourceRevision(version: string) {
  return packagedReleaseValue(
    'sourceRevision',
    version,
    /^[0-9a-f]{40}$/,
    'This @or3/cloud package contains an invalid source revision. Refusing to run an unbound release image.',
  );
}

export function packagedOr3CloudMetadata(): PackagedOr3CloudMetadata {
  return packageManifest().or3Cloud ?? {};
}

/** Bridge version a schema-2 writer requires before migrating a schema-1 deployment. */
export function packagedMinimumSourceVersion(): string | undefined {
  const value = packagedOr3CloudMetadata().dashboardUpdateMinimumSourceVersion;
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : undefined;
}

/** The authenticated packaged digest, optionally pinned by an environment value that must agree with it. */
function expectedDigest(packaged: string | undefined, envName: string, mismatchMessage: string) {
  const supplied = process.env[envName]?.trim();
  if (supplied && !SHA256_DIGEST.test(supplied)) throw new Error(`${envName} must be a complete sha256 digest.`);
  if (packaged && supplied && packaged !== supplied) throw new Error(mismatchMessage);
  return packaged ?? supplied;
}

export function expectedImageDigest(version: string) {
  return expectedDigest(
    packagedReleaseValue(
      'imageDigest',
      version,
      SHA256_DIGEST,
      'This @or3/cloud package contains an invalid release image digest. Refusing to pull an unverified image.',
    ),
    'OR3_EXPECTED_IMAGE_DIGEST',
    'The requested image digest does not match the authenticated @or3/cloud package.',
  );
}

export function expectedOperatorImageDigest(version: string) {
  return expectedDigest(
    packagedReleaseValue(
      'operatorImageDigest',
      version,
      SHA256_DIGEST,
      'This @or3/cloud package contains an invalid dashboard operator image digest. Refusing to enable a mutable privileged runtime.',
    ),
    'OR3_EXPECTED_OPERATOR_IMAGE_DIGEST',
    'The requested dashboard operator digest does not match the authenticated @or3/cloud package.',
  );
}
