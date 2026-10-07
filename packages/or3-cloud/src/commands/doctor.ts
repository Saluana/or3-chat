import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { ManagedState } from '../deployment/contracts';
import { parseEnv, secretValues } from '../deployment/env';
import { deploymentPaths } from '../deployment/paths';
import { readState } from '../deployment/state-store';
import { run } from '../runtime/command-runner';
import {
  checkResolvedLoopbackBinding,
  composeArgs,
  diagnostics,
  resolvedComposeConfig,
} from '../runtime/compose';
import { assertDashboardOperatorMounts } from '../runtime/dashboard-operator';
import { checkPublicPrerequisites, ensureDocker } from '../runtime/docker';
import { waitForDeepHealth } from '../runtime/health';
import { imageDigest } from '../runtime/images';
import { verificationFetch } from '../runtime/verification';
import { readText } from '../util/fs';

export async function doctorCommand(directory: string) {
  const resolved = resolve(directory);
  const paths = deploymentPaths(resolved);
  const failures: string[] = [];
  let state: ManagedState | undefined;
  let env: Record<string, string> = {};
  let dockerReady = false;
  console.log(`OR3 Cloud doctor: ${resolved}`);
  try {
    await ensureDocker();
    dockerReady = true;
    console.log('✓ Docker Engine and Compose v2 are available');
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    console.log(`✗ Docker preflight failed`);
  }
  try {
    state = await readState(resolved);
    env = parseEnv(await readText(paths.env));
    console.log(`✓ Managed state: OR3 ${state.appVersion} (${state.imageDigest})`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    console.log('✗ Managed state or .env is missing/invalid');
  }
  for (const file of [paths.env, paths.state, join(resolved, '.or3-initial-credentials')]) {
    if (!existsSync(file)) continue;
    const mode = (await stat(file)).mode & 0o777;
    if (mode !== 0o600) {
      failures.push(`${file} must be mode 0600 (currently ${mode.toString(8)}).`);
      console.log(`✗ Permissions: ${file} is ${mode.toString(8)}`);
    } else {
      console.log(`✓ Permissions: ${basename(file)} is 0600`);
    }
  }
  if (state) {
    try {
      if (
        env.OR3_VERSION !== state.appVersion ||
        env.OR3_IMAGE !== state.image ||
        env.OR3_COMPOSE_PROJECT !== state.composeProject ||
        env.OR3_VOLUME_NAME !== state.volumeName ||
        Number(env.OR3_PORT) !== state.port ||
        env.OR3_PUBLIC_DOMAIN !== (state.domain ?? 'localhost') ||
        (state.mode === 'public' && (env.OR3_CADDY_DATA_VOLUME !== state.caddyDataVolume || env.OR3_CADDY_CONFIG_VOLUME !== state.caddyConfigVolume))
      ) {
        throw new Error('Managed state does not match the deployment .env (version, image, or data volume).');
      }
      const actualDigest = await imageDigest(state.image);
      if (actualDigest !== state.imageDigest) {
        throw new Error(`Managed image digest differs from state. Expected ${state.imageDigest}, found ${actualDigest}.`);
      }
      const config = await resolvedComposeConfig(resolved, state.mode);
      if (!checkResolvedLoopbackBinding(config, state.port)) throw new Error('Resolved Compose configuration does not bind OR3 only to 127.0.0.1.');
      console.log('✓ OR3 port binding is loopback-only');
      console.log('✓ Compose configuration is valid');
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      console.log('✗ Compose configuration or port binding failed');
    }
    if (state.incompleteOperation) {
      failures.push(`Incomplete ${state.incompleteOperation.operation} ${state.incompleteOperation.id} is recorded.`);
      console.log(`✗ Incomplete operation: ${state.incompleteOperation.operation} (${state.incompleteOperation.id}). Run "npx @or3/cloud recover" after reviewing the diagnostics.`);
    }
    if (dockerReady) {
      try {
        await waitForDeepHealth(resolved, state.mode, secretValues(env));
        console.log('✓ Deep health is passing');
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log('✗ Deep health is not passing');
      }
      try {
        const operatorEnabled = env.OR3_DASHBOARD_UPDATES_ENABLED === 'true';
        const operatorContainer = await run('docker', [
          'ps', '-aq',
          '--filter', `label=com.docker.compose.project=${state.composeProject}`,
          '--filter', 'label=com.docker.compose.service=or3-operator',
        ], resolved);
        if (!operatorContainer.ok) throw new Error(`Could not inspect the dashboard operator service. ${operatorContainer.stderr.trim()}`);
        const containerId = operatorContainer.stdout.trim();
        if (!operatorEnabled) {
          if (containerId) throw new Error('A dashboard operator container exists even though the bridge is disabled.');
          console.log('✓ Dashboard operator is disabled with no orphaned service');
        } else {
          if (!containerId) throw new Error('Dashboard updates are enabled but the operator container is missing.');
          const inspected = await run('docker', ['inspect', containerId]);
          if (!inspected.ok) throw new Error(`Could not inspect dashboard operator container ${containerId}.`);
          const container = JSON.parse(inspected.stdout)?.[0] as {
            Config?: { Image?: string; Labels?: Record<string, string> };
            Mounts?: Array<{ Destination?: string }>;
          };
          if (container.Config?.Image !== env.OR3_OPERATOR_IMAGE) throw new Error('Dashboard operator runtime image does not match the digest-qualified managed environment.');
          if (state.deploymentId && container.Config?.Labels?.['io.or3.cloud.deployment-id'] !== state.deploymentId) {
            throw new Error('Dashboard operator deployment identity does not match managed state.');
          }
          assertDashboardOperatorMounts(container.Mounts ?? [], resolved);
          const ipcDirectory = await stat(paths.operatorIpc);
          const operatorSocket = await stat(join(paths.operatorIpc, 'operator.sock'));
          const operatorUid = Number(env.OR3_OPERATOR_UID);
          const operatorGid = Number(env.OR3_OPERATOR_GID);
          if (
            (ipcDirectory.mode & 0o777) !== 0o710
            || ipcDirectory.uid !== operatorUid
            || ipcDirectory.gid !== operatorGid
            || !operatorSocket.isSocket()
            || (operatorSocket.mode & 0o777) !== 0o660
            || operatorSocket.uid !== operatorUid
            || operatorSocket.gid !== operatorGid
          ) {
            throw new Error('Dashboard operator IPC ownership boundary has unexpected owners, types, or modes.');
          }
          console.log('✓ Dashboard operator image, identity, mounts, and IPC modes are valid');
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log('✗ Dashboard operator boundary is invalid');
      }
    }
    if (state.mode === 'public' && state.domain) {
      try {
        const caddy = await run('docker', composeArgs(resolved, state.mode, ['ps', '--services', '--status', 'running']), resolved);
        if (!caddy.ok || !caddy.stdout.split(/\s+/).includes('caddy')) throw new Error('Caddy is not running.');
        console.log('✓ Caddy service is running');
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log('✗ Caddy service is not running');
      }
      try {
        const address = await checkPublicPrerequisites(state.domain);
        console.log(`✓ DNS: ${state.domain} → ${address}`);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log(`✗ DNS: ${state.domain} does not resolve`);
      }
      for (const port of [80, 443]) {
        const mapping = await run('docker', composeArgs(resolved, state.mode, ['port', 'caddy', String(port)]), resolved);
        if (!mapping.ok || !mapping.stdout.trim().split(/\r?\n/).some((line) => line.trim().endsWith(`:${port}`))) {
          failures.push(`Caddy does not publish TCP ${port} through the selected Docker daemon.`);
          console.log(`✗ Caddy does not publish TCP ${port}`);
        } else {
          console.log(`✓ Caddy publishes TCP ${port}`);
        }
      }
      try {
        const response = await verificationFetch(new URL(`https://${state.domain}`));
        if (response.status !== 200) throw new Error(`Public HTTPS root returned HTTP ${response.status}; redirects are not accepted.`);
        console.log('✓ Public HTTPS root returns HTTP 200 without redirects');
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log('✗ Public HTTPS root is unreachable or redirects');
      }
      console.log('ℹ Firewall: allow TCP 80/443 (and optional UDP 443) in your existing nftables or UFW rules; OR3 did not modify them.');
    }
  }
  if (failures.length) {
    throw new Error(`Doctor found ${failures.length} issue(s). Run: ${diagnostics(resolved, state?.mode ?? 'local')}`);
  }
  console.log('OR3 Cloud doctor passed.');
}
