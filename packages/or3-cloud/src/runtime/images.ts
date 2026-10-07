import { imageRepository } from '../deployment/identity';
import { packagedSourceRevision } from '../package-info';
import { run } from './command-runner';

export async function pullImage(image: string, expectedDigest?: string) {
  const local = await run('docker', ['image', 'inspect', image]);
  if (local.ok) {
    const localDigest = await imageDigest(image);
    if (!expectedDigest || localDigest === expectedDigest) return localDigest;
    if (process.env.OR3_CLOUD_SKIP_PULL === 'true') {
      throw new Error(`Local image digest mismatch for ${image}. Expected ${expectedDigest}, found ${localDigest}, and OR3_CLOUD_SKIP_PULL=true prevents downloading the authenticated image.`);
    }
  }
  if (process.env.OR3_CLOUD_SKIP_PULL !== 'true') {
    const result = await run('docker', ['pull', image]);
    if (!result.ok) {
      const detail = result.stderr.trim();
      if (/(not found|manifest unknown|pull access denied)/i.test(detail)) {
        throw new Error(`The matching OR3 container image is not published yet: ${image}. This is a release issue, not a problem with your computer. Try again after the image release completes. ${detail}`);
      }
      throw new Error(`Could not download ${image}. Check your internet connection and Docker registry access, then retry. ${detail}`);
    }
  } else {
    throw new Error(`${image} is not available locally and OR3_CLOUD_SKIP_PULL=true prevents downloading it.`);
  }
  const actual = await imageDigest(image);
  if (expectedDigest && actual !== expectedDigest) {
    throw new Error(`Published image digest mismatch for ${image}. Expected the package-authenticated ${expectedDigest}, found ${actual}. The image tag may have been replaced; refusing to continue.`);
  }
  return actual;
}

export async function requireImageDigest(image: string, expected: string, label: string) {
  const actual = await imageDigest(image);
  if (actual !== expected) {
    throw new Error(`${label} image digest mismatch for ${image}. Expected ${expected}, found ${actual}. The registry tag may have moved; refusing to mutate the deployment.`);
  }
  return actual;
}

export async function pullAndRequireImage(image: string, expected: string, label: string) {
  const actual = await pullImage(image, expected);
  if (actual !== expected) {
    throw new Error(`${label} image digest mismatch for ${image}. Expected ${expected}, found ${actual}. The registry tag may have moved; refusing to mutate the deployment.`);
  }
  return actual;
}

export function assertImageReleaseLabels(image: string, labels: Record<string, unknown>, version: string, expectedRevision?: string) {
  const revision = labels['org.opencontainers.image.revision'];
  if (
    labels['org.opencontainers.image.source'] !== 'https://github.com/Saluana/or3-chat'
    || labels['org.opencontainers.image.version'] !== version
    || typeof revision !== 'string'
    || !/^[0-9a-f]{40}$/i.test(revision)
    || (expectedRevision !== undefined && revision.toLowerCase() !== expectedRevision)
  ) {
    throw new Error(`OR3 image ${image} does not carry the expected source/version release labels for ${version}.`);
  }
}

export async function assertImageReleaseIdentity(image: string, version: string) {
  const result = await run('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', image]);
  if (!result.ok) throw new Error(`Could not inspect release labels for ${image}. ${result.stderr.trim()}`);
  let labels: Record<string, unknown> | null;
  try {
    labels = JSON.parse(result.stdout.trim()) as Record<string, unknown> | null;
  } catch {
    throw new Error(`OR3 image ${image} has no readable release labels.`);
  }
  if (!labels || typeof labels !== 'object') throw new Error(`OR3 image ${image} has no readable release labels.`);
  assertImageReleaseLabels(image, labels, version, packagedSourceRevision(version));
}

export async function imageDigest(image: string) {
  const result = await run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', image]);
  if (!result.ok) throw new Error(`${result.command}\n${result.stderr}`);
  try {
    const digests = JSON.parse(result.stdout.trim()) as string[];
    const repository = imageRepository(image);
    const digest = digests.find((value) => value.startsWith(`${repository}@sha256:`))?.split('@').at(-1);
    if (digest) return digest;
  } catch {
    // Fall through to the image ID for local registries that omit RepoDigests.
  }
  const idResult = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
  if (!idResult.ok || !idResult.stdout.trim()) throw new Error(`Could not resolve a digest for ${image}.`);
  return idResult.stdout.trim();
}

export type ImageManifest = {
  architecture?: string;
  manifests?: Array<{ platform?: { architecture?: string } }>;
};

export function supportedImageArchitectures(manifest: ImageManifest | null | undefined): string[] {
  if (manifest && Array.isArray(manifest.manifests)) {
    const architectures = manifest.manifests
      .map((entry) => entry.platform?.architecture)
      .filter((value): value is string => typeof value === 'string');
    if (architectures.length > 0) return [...new Set(architectures)];
  }
  if (manifest && typeof manifest.architecture === 'string') return [manifest.architecture];
  throw new Error('The OR3 image manifest has no recognizable architecture list. Refusing to continue without confirming the image supports this machine.');
}

export function assertSupportedArchitecture(manifest: ImageManifest | null | undefined, hostArch: 'arm64' | 'amd64') {
  const supported = supportedImageArchitectures(manifest);
  if (!supported.includes(hostArch)) {
    throw new Error(
      `OR3 does not publish a ${hostArch} image for this version yet. Supported architectures: ${supported.join(', ') || 'none detected'}. Install on a supported machine or wait for the next release.`,
    );
  }
}

export async function dockerDaemonArchitecture(): Promise<'arm64' | 'amd64'> {
  const result = await run('docker', ['info', '--format', '{{.Architecture}}']);
  if (!result.ok) throw new Error(`Could not determine the selected Docker daemon architecture. ${result.stderr.trim()}`);
  const architecture = result.stdout.trim().toLowerCase();
  if (architecture === 'arm64' || architecture === 'aarch64') return 'arm64';
  if (architecture === 'amd64' || architecture === 'x86_64') return 'amd64';
  throw new Error(`OR3 supports only linux/amd64 and linux/arm64 Docker daemons; the selected daemon reports ${architecture || 'no architecture'}.`);
}

export async function assertSupportedHostArchitecture(image: string) {
  const hostArch = await dockerDaemonArchitecture();
  // pullImage runs before this check. The exact local image configuration is
  // therefore authoritative for the selected daemon and avoids making a
  // second client-side registry request from the dashboard operator.
  const local = await run('docker', ['image', 'inspect', '--format', '{{.Architecture}}', image]);
  if (local.ok && local.stdout.trim()) {
    assertSupportedArchitecture({ architecture: local.stdout.trim() }, hostArch);
    return;
  }
  const result = await run('docker', ['manifest', 'inspect', image]);
  if (!result.ok) {
    throw new Error(`Could not inspect the OR3 image manifest for ${image}. ${result.stderr.trim()}`);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`The OR3 image manifest for ${image} could not be parsed. Refusing to continue without confirming the image supports this machine.`);
  }
  assertSupportedArchitecture(manifest as ImageManifest, hostArch);
}
