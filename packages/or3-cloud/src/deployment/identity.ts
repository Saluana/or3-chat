import { basename, resolve } from 'node:path';
import { IMAGE_REPOSITORY } from '../package-info';
import type { ManagedState } from './contracts';

export const DEPLOYMENT_ENV_KEYS = [
  'OR3_COMPOSE_PROJECT',
  'OR3_VOLUME_NAME',
  'OR3_CADDY_DATA_VOLUME',
  'OR3_CADDY_CONFIG_VOLUME',
  'OR3_PORT',
  'OR3_PUBLIC_DOMAIN',
] as const;
const DEPLOYMENT_ID_ENV_KEY = 'OR3_DEPLOYMENT_ID';

export function isVersion(value: string) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

/** Compares two release versions by major.minor.patch (prerelease ignored). */
export function compareReleaseVersions(left: string, right: string) {
  const leftParts = left.split('-', 1)[0].split('.').map(Number);
  const rightParts = right.split('-', 1)[0].split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

export function imageFor(version: string) {
  if (!isVersion(version)) throw new Error(`Invalid release version "${version}".`);
  const testImage = process.env.OR3_CLOUD_TEST_IMAGE?.trim();
  if (testImage) return testImage;
  return `${IMAGE_REPOSITORY}:${version}`;
}

export function operatorImageFor(version: string) {
  return process.env.OR3_CLOUD_TEST_OPERATOR_IMAGE?.trim() || `${IMAGE_REPOSITORY}:${version}-operator`;
}

export function sanitizeName(value: string, fallback = 'or3-cloud') {
  const name = value.toLowerCase().replaceAll(/[^a-z0-9_-]+/g, '-').replaceAll(/^-+|-+$/g, '');
  return name || fallback;
}

export function imageRepository(image: string) {
  const reference = image.split('@', 1)[0];
  const slash = reference.lastIndexOf('/');
  const colon = reference.lastIndexOf(':');
  return colon > slash ? reference.slice(0, colon) : reference;
}

/**
 * Compose must receive an immutable reference. The one intentional exception
 * is the isolated local-image qualification fixture, whose image ID is not a
 * registry manifest digest and therefore cannot be used as repository@digest.
 */
export function imageAtDigest(image: string, digest: string) {
  if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) {
    throw new Error(`Could not bind ${image} to a complete immutable image digest.`);
  }
  if (image.includes('@')) {
    if (!image.endsWith(`@${digest}`)) throw new Error(`Image reference ${image} does not match expected digest ${digest}.`);
    return image;
  }
  if (process.env.OR3_CLOUD_SKIP_PULL === 'true') return image;
  return `${imageRepository(image)}@${digest}`;
}

export function composeProjectNames(directory: string) {
  const base = sanitizeName(basename(directory));
  return {
    project: base,
    volume: `${base}-or3-data`,
    caddyData: `${base}-caddy-data`,
    caddyConfig: `${base}-caddy-config`,
  };
}

export function assertDeploymentIdentity(state: ManagedState, env: Record<string, string>) {
  const expected: Record<string, string | undefined> = {
    OR3_COMPOSE_PROJECT: state.composeProject,
    OR3_VOLUME_NAME: state.volumeName,
    OR3_CADDY_DATA_VOLUME: state.caddyDataVolume,
    OR3_CADDY_CONFIG_VOLUME: state.caddyConfigVolume,
    OR3_PORT: String(state.port),
    OR3_PUBLIC_DOMAIN: state.domain ?? 'localhost',
  };
  for (const key of DEPLOYMENT_ENV_KEYS) {
    if (state.mode === 'local' && (key === 'OR3_CADDY_DATA_VOLUME' || key === 'OR3_CADDY_CONFIG_VOLUME')) continue;
    if (env[key] !== expected[key]) {
      throw new Error(`Managed state does not match ${key} in .env. Refusing to operate on an unexpected deployment identity.`);
    }
  }
  const pending = state.incompleteOperation;
  let pendingTargetImage: string | undefined;
  if (pending?.targetImage) {
    try {
      pendingTargetImage = pending.targetImageDigest
        ? imageAtDigest(pending.targetImage, pending.targetImageDigest)
        : pending.targetImage;
    } catch {
      pendingTargetImage = undefined;
    }
  }
  const journaledTarget = Boolean(
    pending
    && (pending.operation === 'update' || pending.operation === 'restore' || pending.operation === 'rollback')
    && pending.targetVersion
    && pendingTargetImage
    && env.OR3_VERSION === pending.targetVersion
    && env.OR3_IMAGE === pendingTargetImage,
  );
  const journaledIdentityMigration = Boolean(
    journaledTarget
    && !state.deploymentId
    && pending?.targetDeploymentId
    && env[DEPLOYMENT_ID_ENV_KEY] === pending.targetDeploymentId,
  );
  if (state.deploymentId || env[DEPLOYMENT_ID_ENV_KEY]) {
    if ((!state.deploymentId || env[DEPLOYMENT_ID_ENV_KEY] !== state.deploymentId) && !journaledIdentityMigration) {
      throw new Error('Managed state does not match OR3_DEPLOYMENT_ID in .env. Refusing to operate on an unexpected deployment identity.');
    }
  }
  if ((env.OR3_VERSION !== state.appVersion || env.OR3_IMAGE !== state.image) && !journaledTarget) {
    throw new Error('Managed state does not match OR3_VERSION or OR3_IMAGE in .env. Refusing to create a backup or mutate an unverified release configuration.');
  }
}

/**
 * Refuses to operate on a directory whose basename no longer resolves to the
 * Compose project and volume names recorded in managed state. A renamed or
 * copied deployment would otherwise target a different (or unrelated) project
 * in Docker. Reuse of composeProjectNames keeps the same derivation as init.
 */
export function assertDeploymentDirectoryIdentity(directory: string, state: ManagedState) {
  const resolved = resolve(directory);
  if (state.deploymentRoot && resolve(state.deploymentRoot) !== resolved) {
    throw new Error(`Managed deployment root is ${state.deploymentRoot}, not ${resolved}. Refusing to operate on a copied or relocated deployment; perform an explicit relocation before mutation.`);
  }
  const names = composeProjectNames(resolved);
  const mismatches: string[] = [];
  if (state.composeProject !== names.project) {
    mismatches.push(`compose project "${state.composeProject}" (this directory resolves to "${names.project}")`);
  }
  if (state.volumeName !== names.volume) {
    mismatches.push(`volume "${state.volumeName}" (this directory resolves to "${names.volume}")`);
  }
  if (state.mode === 'public') {
    if (state.caddyDataVolume !== names.caddyData) mismatches.push(`Caddy data volume "${state.caddyDataVolume}"`);
    if (state.caddyConfigVolume !== names.caddyConfig) mismatches.push(`Caddy config volume "${state.caddyConfigVolume}"`);
  }
  if (mismatches.length) {
    throw new Error(`Managed state does not match the deployment directory identity: ${mismatches.join('; ')}. Refusing to operate on an unrelated project. Run doctor for diagnostics.`);
  }
}
