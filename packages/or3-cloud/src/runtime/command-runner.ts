import { randomBytes } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { parseEnv } from '../deployment/env';
import { lifecycleFaults } from '../lifecycle-faults';
import { durableRename, fileExists } from '../util/fs';
import { quote, redact } from '../util/primitives';

const execFile = promisify(execFileCallback);

const COMMAND_TIMEOUT_MS = 180_000;
const STREAM_COMMAND_TIMEOUT_MS = 15 * 60_000;

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  command: string;
  exitCode: number | null;
};

const PROCESS_ENV_PASSTHROUGH = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CONFIG_HOME',
  'XDG_RUNTIME_DIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
  'DOCKER_CONFIG',
] as const;

export function composeProcessEnv(directory: string): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const key of PROCESS_ENV_PASSTHROUGH) {
    if (process.env[key] !== undefined) safe[key] = process.env[key];
  }
  const envPath = join(directory, '.env');
  try {
    // Compose reads the full file through `env_file`; only OR3 interpolation
    // values belong in its process environment. In particular, never let a
    // managed .env replace PATH or smuggle COMPOSE_* control variables into
    // the Docker client invocation.
    for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, 'utf8')))) {
      if (key.startsWith('OR3_')) safe[key] = value;
    }
    return safe;
  } catch (error) {
    throw new Error(`Could not read managed Compose environment ${envPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function commandEnvironment(command: string, args: string[], cwd?: string, supplied?: NodeJS.ProcessEnv) {
  if (supplied) return supplied;
  return command === 'docker' && args[0] === 'compose' && cwd
    ? composeProcessEnv(cwd)
    : process.env;
}

export async function run(command: string, args: string[], cwd?: string, environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
  const printable = `${command} ${args.map(quote).join(' ')}`;
  await lifecycleFaults.beforeCommand?.(command, args);
  try {
    const result = await execFile(command, args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: commandEnvironment(command, args, cwd, environment),
    });
    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
      command: printable,
      exitCode: 0,
    };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    const stdout = failure.stdout ?? '';
    return {
      ok: false,
      stdout,
      command: printable,
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      stderr: redact(failure.stderr || stdout || String(error)),
    };
  }
}

export async function requireCommand(command: string, args: string[], label: string, cwd?: string) {
  const result = await run(command, args, cwd);
  if (!result.ok) throw new Error(`${label} is unavailable. Run: ${result.command}\n${result.stderr}`);
  return result.stdout.trim();
}

function terminateChildProcess(child: ReturnType<typeof spawn>) {
  if (child.killed) return;
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); return; } catch {}
  }
  child.kill('SIGKILL');
}

/** Streams a container archive to a host-owned file without a root bind mount. */
export async function streamCommandToFile(
  command: string,
  args: string[],
  destination: string,
  cwd?: string,
  secrets: string[] = [],
) {
  if (await fileExists(destination)) {
    throw new Error(`Refusing to overwrite existing archive ${destination}.`);
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomBytes(8).toString('hex')}.partial`;
  const child = spawn(command, args, {
    cwd,
    env: commandEnvironment(command, args, cwd),
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let timedOut = false;
  const hasTimedOut = (): boolean => timedOut;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminateChildProcess(child);
  }, STREAM_COMMAND_TIMEOUT_MS);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  const exit = new Promise<number | null>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', resolvePromise);
  });
  try {
    const [exitCode] = await Promise.all([
      exit,
      pipeline(child.stdout, createWriteStream(temporary, { flags: 'wx', mode: 0o600 })),
    ]);
    if (hasTimedOut()) throw new Error(`${command} exceeded the ${STREAM_COMMAND_TIMEOUT_MS / 1000}-second archive deadline.`);
    if (exitCode !== 0) {
      throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}. ${redact(stderr, secrets)}`.trim());
    }
    await chmod(temporary, 0o600);
    await durableRename(temporary, destination);
  } catch (error) {
    terminateChildProcess(child);
    await rm(temporary, { force: true }).catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}${stderr && !detail.includes(stderr) ? `\n${redact(stderr, secrets)}` : ''}`);
  } finally {
    clearTimeout(timeout);
  }
}

/** Streams a private host archive into a container without bind-mounting it. */
export async function streamFileToCommand(
  command: string,
  args: string[],
  source: string,
  cwd?: string,
  secrets: string[] = [],
) {
  const child = spawn(command, args, {
    cwd,
    env: commandEnvironment(command, args, cwd),
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let stderr = '';
  let timedOut = false;
  const hasTimedOut = (): boolean => timedOut;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminateChildProcess(child);
  }, STREAM_COMMAND_TIMEOUT_MS);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  const exit = new Promise<number | null>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', resolvePromise);
  });
  try {
    const [exitCode] = await Promise.all([
      exit,
      pipeline(createReadStream(source), child.stdin),
    ]);
    if (hasTimedOut()) throw new Error(`${command} exceeded the ${STREAM_COMMAND_TIMEOUT_MS / 1000}-second archive deadline.`);
    if (exitCode !== 0) {
      throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}. ${redact(stderr, secrets)}`.trim());
    }
  } catch (error) {
    terminateChildProcess(child);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}${stderr && !detail.includes(stderr) ? `\n${redact(stderr, secrets)}` : ''}`);
  } finally {
    clearTimeout(timeout);
  }
}
