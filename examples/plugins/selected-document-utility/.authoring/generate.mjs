import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArtifacts } from './profile.config.mjs';
import { DEFAULT_DIGEST_OPTIONS, analyzeSelection } from '../lib/digest.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const { profile, files } = buildArtifacts();

// Regenerate the first-action golden from the committed sample workspace.
const sample = JSON.parse(
    readFileSync(resolve(packageRoot, 'fixtures/sample-selection.json'), 'utf8')
);
files['fixtures/expected-digest.json'] = `${JSON.stringify(
    analyzeSelection(sample.selection, DEFAULT_DIGEST_OPTIONS),
    null,
    2
)}\n`;

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
            console.error(`[selected-document-utility] ${name} has drifted from the authoring config`);
        }
        continue;
    }
    writeFileSync(path, contents);
    console.log(`[selected-document-utility] wrote ${name}`);
}

if (check) {
    if (drift > 0) {
        console.error(
            `[selected-document-utility] ${drift} file(s) drifted; run "bun .authoring/generate.mjs"`
        );
        process.exitCode = 1;
    } else {
        console.log('[selected-document-utility] descriptors match the authoring config');
    }
} else {
    console.log(
        `[selected-document-utility] policy ${profile.revisions.policy} / setup ${profile.revisions.setup}`
    );
}
