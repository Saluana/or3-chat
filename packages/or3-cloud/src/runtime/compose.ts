import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mode } from '../deployment/contracts';
import { dashboardUpdatesEnabled, parseEnv } from '../deployment/env';
import { imageRepository } from '../deployment/identity';
import { quote, redact } from '../util/primitives';
import { run } from './command-runner';

export function composeArgs(directory: string, mode: Mode, command: string[] = []) {
  const env = parseEnv(readFileSync(join(directory, '.env'), 'utf8'));
  const project = env.OR3_COMPOSE_PROJECT;
  if (!project) throw new Error(`Managed Compose environment at ${join(directory, '.env')} has no OR3_COMPOSE_PROJECT.`);
  const files = ['-f', join(directory, 'compose.yaml')];
  if (mode === 'public') files.push('-f', join(directory, 'compose.public.yaml'));
  if (dashboardUpdatesEnabled(directory)) {
    const operatorOverlay = join(directory, 'compose.operator.yaml');
    if (!existsSync(operatorOverlay)) {
      throw new Error('Dashboard updates are enabled but compose.operator.yaml is missing. Run `npx @or3/cloud recover` before operating on this deployment.');
    }
    files.push('-f', operatorOverlay);
  }
  return [
    'compose',
    '--project-name',
    project,
    '--project-directory',
    directory,
    '--env-file',
    join(directory, '.env'),
    ...files,
    ...command,
  ];
}

export function diagnostics(directory: string, mode: Mode) {
  const files = `-f ${quote(join(directory, 'compose.yaml'))}${mode === 'public' ? ` -f ${quote(join(directory, 'compose.public.yaml'))}` : ''}${dashboardUpdatesEnabled(directory) ? ` -f ${quote(join(directory, 'compose.operator.yaml'))}` : ''}`;
  return `cd ${quote(directory)} && docker compose --env-file ${quote(join(directory, '.env'))} ${files} ps && docker compose --env-file ${quote(join(directory, '.env'))} ${files} logs --tail=200`;
}

export async function captureComposeDiagnostics(directory: string, mode: Mode, secrets: string[]) {
  const sections: string[] = [];
  for (const [label, command] of [
    ['compose ps', ['ps', '-a']],
    ['compose logs', ['logs', '--tail=200']],
  ] as const) {
    const result = await run('docker', composeArgs(directory, mode, [...command]), directory);
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    sections.push(`${label}:\n${detail || '(no output)'}`);
  }
  const containers = await run('docker', composeArgs(directory, mode, ['ps', '-aq']), directory);
  for (const container of containers.stdout.split(/\s+/).filter(Boolean)) {
    const state = await run('docker', ['inspect', '--format', '{{json .State}}', container], directory);
    const detail = [state.stdout, state.stderr].filter(Boolean).join('\n').trim();
    sections.push(`container ${container} state:\n${detail || '(no output)'}`);
  }
  return redact(sections.join('\n\n'), secrets);
}

export async function compose(directory: string, mode: Mode, command: string[], secrets: string[] = []) {
  const result = await run('docker', composeArgs(directory, mode, command), directory);
  if (!result.ok) {
    const captured = await captureComposeDiagnostics(directory, mode, secrets).catch((error) =>
      redact(`Diagnostics capture failed: ${error instanceof Error ? error.message : String(error)}`, secrets),
    );
    throw new Error(`${redact(result.command, secrets)}\n${redact(result.stderr, secrets)}\nCaptured Docker diagnostics:\n${captured}\nDiagnostics: ${diagnostics(directory, mode)}`);
  }
  return result.stdout;
}

type ComposeService = {
  image?: string;
  network_mode?: string;
  ports?: Array<Record<string, unknown>>;
  volumes?: Array<Record<string, unknown>>;
  environment?: Record<string, unknown> | string[];
  labels?: Record<string, unknown> | string[];
};

type ComposeConfig = {
  name?: string;
  services?: Record<string, ComposeService>;
  volumes?: Record<string, { name?: string; labels?: Record<string, unknown> | string[] }>;
};

export function parseComposeConfig(text: string): ComposeConfig {
  try {
    const parsed = JSON.parse(text) as ComposeConfig | null;
    if (!parsed || typeof parsed !== 'object' || !parsed.services) throw new Error('missing services');
    return parsed;
  } catch (error) {
    throw new Error(`Docker Compose did not return a readable JSON configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function composeEnvironmentValue(service: ComposeService, key: string) {
  const environment = service.environment;
  if (Array.isArray(environment)) {
    const line = environment.find((value) => value.startsWith(`${key}=`));
    return line?.slice(key.length + 1);
  }
  const value = environment?.[key];
  return typeof value === 'string' ? value : undefined;
}

function composeLabelValue(service: ComposeService, key: string) {
  const labels = service.labels;
  if (Array.isArray(labels)) {
    const line = labels.find((value) => value.startsWith(`${key}=`));
    return line?.slice(key.length + 1);
  }
  const value = labels?.[key];
  return typeof value === 'string' ? value : undefined;
}

function composePublishedPort(port: Record<string, unknown>) {
  const target = Number(port.target);
  const published = Number(port.published);
  const hostIp = typeof port.host_ip === 'string' ? port.host_ip : undefined;
  return { target, published, hostIp, protocol: port.protocol };
}

export function checkResolvedLoopbackBinding(config: string, expectedPort?: number) {
  try {
    const parsed = parseComposeConfig(config);
    const service = parsed.services?.or3;
    if (!service) return false;
    if (service.network_mode) return false;
    const ports = (service.ports ?? []).map(composePublishedPort);
    const appPorts = ports.filter(({ target }) => target === 3000);
    if (!appPorts.length) return false;
    if (expectedPort !== undefined && !appPorts.some(({ published }) => published === expectedPort)) return false;
    return appPorts.every(({ hostIp, protocol }) => hostIp === '127.0.0.1' && (protocol === undefined || protocol === 'tcp'));
  } catch {
    return false;
  }
}

export async function resolvedComposeConfig(directory: string, mode: Mode) {
  const result = await run('docker', composeArgs(directory, mode, ['config', '--format', 'json']), directory);
  if (!result.ok) throw new Error(`${result.command}\n${result.stderr}`);
  return result.stdout;
}

export async function assertSafeComposeBinding(directory: string, mode: Mode, env: Record<string, string>) {
  const config = await resolvedComposeConfig(directory, mode);
  const parsed = parseComposeConfig(config);
  const service = parsed.services?.or3;
  if (parsed.name !== undefined && parsed.name !== env.OR3_COMPOSE_PROJECT) {
    throw new Error('Resolved Compose configuration does not use the managed project name. Refusing to operate on another deployment.');
  }
  if (!checkResolvedLoopbackBinding(config, Number(env.OR3_PORT))) {
    throw new Error('Resolved Compose configuration must publish OR3 port 3000 only on 127.0.0.1. Refusing to expose the application directly.');
  }
  if (!service || service.image !== env.OR3_IMAGE) {
    throw new Error('Resolved Compose configuration does not use the managed immutable OR3 image reference. Refusing to start an unexpected image.');
  }
  if (env.OR3_DEPLOYMENT_ID && composeLabelValue(service, 'io.or3.cloud.deployment-id') !== env.OR3_DEPLOYMENT_ID) {
    throw new Error('Resolved Compose configuration does not carry the managed deployment identity label. Refusing to start an unbound project.');
  }
  const dataMount = (service.volumes ?? []).find((mount) => mount.target === '/data');
  const source = typeof dataMount?.source === 'string' ? dataMount.source : '';
  const volumeName = source ? parsed.volumes?.[source]?.name : undefined;
  if (dataMount?.type !== 'volume' || volumeName !== env.OR3_VOLUME_NAME) {
    throw new Error('Resolved Compose configuration does not bind the managed OR3 data volume. Refusing to operate on an unexpected volume.');
  }
  const volumeLabels = source ? parsed.volumes?.[source]?.labels : undefined;
  const deploymentLabel = Array.isArray(volumeLabels)
    ? volumeLabels.find((value) => value.startsWith('io.or3.cloud.deployment-id='))?.slice('io.or3.cloud.deployment-id='.length)
    : volumeLabels?.['io.or3.cloud.deployment-id'];
  if (env.OR3_DEPLOYMENT_ID && deploymentLabel !== env.OR3_DEPLOYMENT_ID) {
    throw new Error('Resolved managed data volume lacks the expected deployment identity label.');
  }
  if (env.OR3_DASHBOARD_UPDATES_ENABLED === 'true') {
    const operator = parsed.services?.['or3-operator'];
    if (
      !operator
      || operator.network_mode
      || operator.image !== env.OR3_OPERATOR_IMAGE
      || (env.OR3_DEPLOYMENT_ID && composeLabelValue(operator, 'io.or3.cloud.deployment-id') !== env.OR3_DEPLOYMENT_ID)
    ) {
      throw new Error('Resolved dashboard operator does not match the managed digest-qualified deployment bridge. Refusing to start it.');
    }
    if (process.env.OR3_CLOUD_SKIP_PULL !== 'true' && !/@sha256:[0-9a-f]{64}$/i.test(env.OR3_OPERATOR_IMAGE ?? '')) {
      throw new Error('The dashboard operator image is not digest-qualified. Refusing to start a mutable privileged runtime.');
    }
  }
}

export async function assertRunningAppImage(directory: string, mode: Mode, expectedImage: string) {
  const container = await run('docker', composeArgs(directory, mode, ['ps', '-q', 'or3']), directory);
  const containerId = container.stdout.trim();
  if (!container.ok || !containerId) throw new Error('OR3 started without a running application container.');
  const image = await run('docker', ['inspect', '--format', '{{.Image}}', containerId], directory);
  if (!image.ok || !image.stdout.trim()) throw new Error('Could not inspect the image of the running OR3 container.');
  const expectedDigest = expectedImage.match(/@((?:sha256:)[0-9a-f]{64})$/i)?.[1];
  if (!expectedDigest && process.env.OR3_CLOUD_SKIP_PULL === 'true') {
    const expectedId = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', expectedImage], directory);
    if (!expectedId.ok || expectedId.stdout.trim() !== image.stdout.trim()) {
      throw new Error('The local qualification fixture started a different OR3 image than the one selected by the managed environment.');
    }
    return;
  }
  if (!expectedDigest) throw new Error(`Managed OR3 image ${expectedImage} is not digest-qualified.`);
  const repoDigests = await run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', image.stdout.trim()], directory);
  if (!repoDigests.ok) throw new Error('Could not inspect repository digests for the running OR3 container.');
  let values: string[];
  try {
    values = JSON.parse(repoDigests.stdout.trim()) as string[];
  } catch {
    throw new Error('The running OR3 container has no readable repository digests.');
  }
  const expected = `${imageRepository(expectedImage)}@${expectedDigest}`;
  if (!values.includes(expected)) {
    throw new Error(`The running OR3 container image does not match the managed digest ${expectedDigest}. Refusing to commit startup.`);
  }
}
