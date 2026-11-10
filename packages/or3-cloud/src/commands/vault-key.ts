import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import type { Flags } from '../cli/args';
import { requireStringFlag } from '../cli/args';
import { imageAtDigest } from '../deployment/identity';
import { assertNoPending, loadManaged } from '../deployment/state-store';
import { run } from '../runtime/command-runner';
import { ensureDocker } from '../runtime/docker';
import { requireImageDigest } from '../runtime/images';

export async function vaultKeyCommand(directory: string, positionals: string[], flags: Flags) {
  if (positionals.length !== 1 || positionals[0] !== 'export') throw new Error('Use vault-key export --out <absolute-path>.');
  const destination = requireStringFlag(flags, 'out');
  if (!isAbsolute(destination)) throw new Error('Vault key destination must be an absolute path.');
  const leaf = destination.split(sep).at(-1);
  if (!leaf || leaf === '.' || leaf === '..') throw new Error('Vault key destination must name a new file.');
  const parent = await realpath(dirname(destination));
  const parentInfo = await stat(parent);
  if (!parentInfo.isDirectory() || (parentInfo.mode & 0o777) !== 0o700 || typeof process.getuid === 'function' && parentInfo.uid !== process.getuid()) {
    throw new Error('Vault key destination parent must be an owner-only directory (0700).');
  }
  const target = join(parent, basename(destination));
  const deployment = await realpath(directory);
  if (target === deployment || target.startsWith(`${deployment}${sep}`)) throw new Error('Vault key destination must be outside the managed deployment directory.');
  // Open exclusively before starting Docker. A pre-existing path or symlink is
  // never replaced; no key bytes are printed or placed on a command line.
  const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let written = false;
  const parts: Buffer[] = [];
  try {
    await ensureDocker();
    const loaded = await loadManaged(directory);
    assertNoPending(loaded.state);
    await requireImageDigest(loaded.state.image, loaded.state.imageDigest, 'Current deployment');
    const volume = `${loaded.state.volumeName}-vault-key`;
    if (!(await run('docker', ['volume', 'inspect', volume], directory)).ok) throw new Error('Vault key custody is missing or cannot be inspected.');
    const script = `const fs=require('node:fs');const p='/vault-key/master.key';const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.uid!==1000||(s.mode&0o777)!==0o600||s.nlink!==1||s.size!==32)process.exit(1);process.stdout.write(fs.readFileSync(p));`;
    const helperName = `or3-vault-key-export-${randomUUID()}`;
    const child = spawn('docker', ['run', '--rm', '--name', helperName, '--log-driver', 'none', '--pull', 'never', '--network', 'none', '--read-only', '--user', '1000:65532',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
      '--mount', `type=volume,src=${volume},dst=/vault-key,readonly`,
      '--entrypoint', '/nodejs/bin/node', imageAtDigest(loaded.state.image, loaded.state.imageDigest), '-e', script],
    { cwd: directory, stdio: ['ignore', 'pipe', 'ignore'] });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 120_000);
    const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    let bytes = 0;
    let helperFailure: unknown;
    try {
      for await (const chunk of child.stdout) {
        const buffer = Buffer.from(chunk); parts.push(buffer); bytes += buffer.length;
        if (bytes > 32) { child.kill('SIGKILL'); throw new Error('Vault key export returned an invalid key.'); }
      }
      if (await exited !== 0 || bytes !== 32) throw new Error('Vault key export could not read valid custody.');
    } catch (error) {
      helperFailure = error;
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited.catch(() => null);
      const cleanup = await run('docker', ['rm', '--force', helperName], directory);
      if (!cleanup.ok && !/No such container/i.test(cleanup.stderr)) {
        throw new AggregateError(helperFailure ? [helperFailure] : [], 'Vault key helper cleanup failed; inspect the named helper before retrying.');
      }
    }
    if (helperFailure) throw helperFailure;
    const key = Buffer.concat(parts, bytes);
    try {
      await file.writeFile(key);
      await file.chmod(0o600);
      await file.sync();
      const parentHandle = await open(parent, 'r');
      try { await parentHandle.sync(); } finally { await parentHandle.close(); }
      written = true;
      console.log(`Exported vault master key to ${target} (SHA-256 ${createHash('sha256').update(key).digest('hex')}). Protect it separately from the backup.`);
    } finally { key.fill(0); }
  } finally {
    for (const part of parts) part.fill(0);
    await file.close();
    if (!written) {
      // Never delete a potentially replaced destination. Leave the exclusive
      // owner-only file for explicit inspection if the export failed.
      console.error(`Vault key export did not complete; inspect the owner-only destination ${target} before retrying.`);
    }
  }
}
