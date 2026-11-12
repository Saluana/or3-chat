import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupManifest } from '../deployment/contracts';

/** Return the same bytes whose digest is authenticated by the manifest. */
export async function readAuthenticatedBackupConfig(backupPath: string, manifest: BackupManifest) {
  const bytes = await readFile(join(backupPath, 'config.env'));
  if (!manifest.configSha256 || createHash('sha256').update(bytes).digest('hex') !== manifest.configSha256) {
    throw new Error(`Backup configuration checksum mismatch for ${manifest.backupId}.`);
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Backup configuration has invalid UTF-8.');
  return text;
}

/** Reject syntax that can hide or override a vault selector. */
export function hasUnambiguousEnvSyntax(text: string, allowedKeys?: ReadonlySet<string>) {
  const keys = new Set<string>();
  for (const source of text.split(/\r?\n/)) {
    const line = source.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || keys.has(match[1]!) || (allowedKeys && !allowedKeys.has(match[1]!))) return false;
    keys.add(match[1]!);
    const value = match[2]!;
    if (!/^'(?:[^'\\\x00\r\n]|\\['\\])*'$/.test(value) && !/^[A-Za-z0-9._:@%+=/-]*$/.test(value)) return false;
  }
  return true;
}
