import { lookup } from 'node:dns/promises';

const hostname = 'registry.npmjs.org';
const attempts = 5;
let lastError;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
        await lookup(hostname);
        process.exit(0);
    } catch (error) {
        lastError = error;
        if (attempt < attempts) {
            await new Promise((resolvePromise) =>
                setTimeout(resolvePromise, attempt * 2_000)
            );
        }
    }
}

const detail = lastError instanceof Error ? lastError.message : String(lastError);
console.error(
    `Docker BuildKit could not resolve ${hostname} after ${attempts} attempts (${detail}). Configure Docker daemon DNS, then retry the build.`
);
process.exit(1);
