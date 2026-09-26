import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArtifacts } from './profile.config.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const { profile, files } = buildArtifacts();

let drift = 0;
for (const [name, contents] of Object.entries(files)) {
    const path = resolve(packageRoot, name);
    if (check) {
        let committed = null;
        try {
            committed = readFileSync(path, 'utf8');
        } catch {
            committed = null;
        }
        if (committed !== contents) {
            drift += 1;
            console.error(`[or3-document-utilities] ${name} has drifted from the authoring config`);
        }
        continue;
    }
    writeFileSync(path, contents);
    console.log(`[or3-document-utilities] wrote ${name}`);
}

if (check) {
    if (drift > 0) process.exitCode = 1;
    else console.log('[or3-document-utilities] descriptors match the authoring config');
} else {
    console.log(
        `[or3-document-utilities] policy ${profile.revisions.policy} / setup ${profile.revisions.setup}`
    );
}
