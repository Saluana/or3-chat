// bunx tsx audit-evidence/performance-20261022/run-scroll-paint-probe.mjs '{"surface":"projects","delta":120,"cpuRate":4}' /tmp/paint-result.json
// Requires the documented local production journey preview on port 3147.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const options = JSON.parse(process.argv[2] ?? '{}');
const output = process.argv[3];
if (!output) throw new Error('Supply an output JSON path');
const source = await readFile(new URL('./scroll-paint-probe.js', import.meta.url), 'utf8');
const probe = new Function(`${source}; return scrollPaintProbe;`)();
const headed = options.headed ?? false;
const browser = await chromium.launch({ channel: options.channel, headless: !headed });
const timer = setTimeout(() => browser.close().catch(() => {}), 90_000);
try {
    const page = await browser.newPage();
    const result = await probe(page, options);
    await writeFile(output, JSON.stringify({ browser: browser.version(), headed, ...result }, null, 2) + '\n');
    console.log(JSON.stringify({ output, surface: result.surface, cpuRate: result.cpuRate, input: result.input,
        captures: result.capturedFrames, gaps: result.framesWithGapOver8px, maxGap: result.worst[0]?.largestMissing,
        endScrollTop: result.endpoints.at(-1)?.scrollTop }));
} finally {
    clearTimeout(timer);
    await browser.close();
}
