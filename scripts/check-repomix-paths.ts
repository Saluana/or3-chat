import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter((path) => path && existsSync(`${root}/${path}`));
let missing = 0;
for (const file of readdirSync(root).filter((name) => /^repomix.*\.config\.json$/.test(name))) {
    const config = JSON.parse(readFileSync(`${root}/${file}`, 'utf8'));
    for (const pattern of config.include ?? []) {
        const glob = new Bun.Glob(pattern);
        if (!tracked.some((path) => glob.match(path))) {
            console.error(`${file}: no tracked files match ${pattern}`);
            missing++;
        }
    }
}
if (missing) process.exitCode = 1;
else console.log('All Repomix include patterns match tracked files.');
