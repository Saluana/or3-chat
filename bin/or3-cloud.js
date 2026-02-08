#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(thisFile), '..');
const distEntry = resolve(rootDir, 'dist', 'or3-cloud.mjs');

if (!existsSync(distEntry)) {
    console.error(
        'Missing dist/or3-cloud.mjs. Run `bun run or3-cloud:build` before invoking the bin.'
    );
    process.exit(1);
}

await import(pathToFileURL(distEntry).href);
