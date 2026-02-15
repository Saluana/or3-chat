#!/usr/bin/env node
/**
 * Preinstall check: ensure sibling provider repos exist for file: dependencies.
 * This runs before `bun install` to give a clear error instead of a cryptic ENOENT.
 */
const fs = require('fs');
const path = require('path');

const providers = [
    { dir: '../or3-provider-clerk', pkg: 'or3-provider-clerk' },
    { dir: '../or3-provider-convex', pkg: 'or3-provider-convex' },
];

const root = path.resolve(__dirname, '..');
const missing = providers.filter(p => !fs.existsSync(path.resolve(root, p.dir)));

if (missing.length > 0) {
    console.error(`
❌ Missing provider repos (required by file: dependencies):
${missing.map(p => `   ${p.pkg} → expected at ${path.resolve(root, p.dir)}`).join('\n')}

Clone them as siblings of this repo:
   git clone <url> ${path.resolve(root, missing[0].dir)}
`);
    process.exit(1);
}
