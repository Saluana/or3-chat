import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeSecure(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomBytes(4).toString('hex')}`;
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await durableRename(temporary, path);
}

async function syncFile(path: string) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(path: string) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function durableRename(source: string, destination: string) {
  await syncFile(source);
  await rename(source, destination);
  await syncDirectory(dirname(destination));
}

export async function copySecure(source: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  await chmod(destination, 0o600);
  await syncFile(destination);
  await syncDirectory(dirname(destination));
}

export async function fileExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readText(path: string) {
  return readFile(path, 'utf8');
}

export async function readOwnerOnlyText(path: string, label: string) {
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a regular owner-only file with no group/world permissions.`);
  }
  return readText(path);
}

export async function sha256File(path: string) {
  const digest = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return digest.digest('hex');
}
