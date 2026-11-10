import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { dockerProfile } from './prepare-manifest.mjs';

const destination = process.argv[2];
if (!destination) throw new Error('Remote helper output directory is required.');
await mkdir(destination, { recursive: true });
if (dockerProfile() === 'clerk-sqlite-s3') {
  // Keep the inspector external so its own command entrypoint is not folded
  // into this bundle; the runtime image already contains the same inspector.
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./remote-objects.mjs', import.meta.url))],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    external: ['./backup-inspect.mjs'],
    banner: { js: 'import { createRequire as __or3CreateRequire } from "node:module"; const require = __or3CreateRequire(import.meta.url);' },
    write: false,
  });
  if (result.outputFiles.length !== 1) throw new Error('Unexpected remote helper bundle output.');
  await writeFile(join(destination, 'remote-objects.mjs'), result.outputFiles[0].contents, { flag: 'wx', mode: 0o644 });
}
