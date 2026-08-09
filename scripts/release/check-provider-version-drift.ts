import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const qualified = JSON.parse(
    await readFile(
        resolve(root, 'packages/create-or3-chat/first-party-versions.json'),
        'utf8',
    ),
) as Record<string, string>;
const source = await readFile(
    resolve(root, 'shared/cloud/wizard/provider-versions.ts'),
    'utf8',
);
const listed = Object.fromEntries(
    [...source.matchAll(/'([^']+)':\s*'([^']+)'/g)].map((match) => [
        match[1]!,
        match[2]!,
    ]),
);
const expected = Object.fromEntries(
    Object.entries(qualified).filter(([name]) => name.startsWith('or3-provider-')),
);

for (const [name, version] of Object.entries(expected)) {
    if (listed[name] !== version) {
        throw new Error(
            `Qualified provider ${name} is ${version}, but the wizard lists ${listed[name] ?? 'nothing'}.`,
        );
    }
}
for (const name of Object.keys(listed)) {
    if (!(name in expected)) {
        throw new Error(`Wizard lists unqualified provider ${name}.`);
    }
}

console.log('[provider-version-drift] wizard provider versions match the release manifest');
