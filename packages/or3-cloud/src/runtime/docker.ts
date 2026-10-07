import { createServer } from 'node:net';
import { lookup } from 'node:dns/promises';
import { requireCommand, run } from './command-runner';

function validateDomain(domain: string) {
  if (
    domain.includes('://') ||
    domain.includes('/') ||
    domain.includes(' ') ||
    !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain)
  ) {
    throw new Error(`"${domain}" is not a hostname. Use a name such as cloud.example.com.`);
  }
}

export async function ensureDocker() {
  await requireCommand('docker', ['info'], 'Docker Engine');
  await requireCommand('docker', ['compose', 'version'], 'Docker Compose v2');
}

export async function portAvailable(port: number) {
  return new Promise<boolean>((resolvePromise) => {
    const server = createServer();
    server.once('error', () => resolvePromise(false));
    server.once('listening', () => server.close(() => resolvePromise(true)));
    server.listen(port, '127.0.0.1');
  });
}

export async function dockerDaemonIsLocal() {
  const configured = process.env.DOCKER_HOST?.trim();
  if (configured) return configured.startsWith('unix://') || configured.startsWith('npipe://');
  const context = await run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  if (!context.ok) throw new Error(`Could not resolve the active Docker context endpoint. ${context.stderr.trim()}`);
  const endpoint = context.stdout.trim();
  return endpoint.startsWith('unix://') || endpoint.startsWith('npipe://');
}

export async function assertDockerProjectAbsent(project: string) {
  for (const [resource, args] of [
    ['container', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]],
    ['network', ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]],
  ] as Array<[string, string[]]>) {
    const result = await run('docker', args);
    if (!result.ok) {
      throw new Error(`Could not inspect Docker ${resource}s for Compose project ${project}. Refusing to continue while the daemon state is unknown. ${result.stderr.trim()}`);
    }
    if (result.stdout.trim()) {
      throw new Error(`Docker ${resource}s already exist for Compose project ${project}. Choose a different target directory or inspect the existing project before continuing.`);
    }
  }
}

export async function checkPublicPrerequisites(domain: string) {
  validateDomain(domain);
  let address: string;
  try {
    address = (await lookup(domain)).address;
  } catch {
    throw new Error(`DNS for ${domain} does not resolve yet. Create the A/AAAA record before starting public mode.`);
  }
  return address;
}
