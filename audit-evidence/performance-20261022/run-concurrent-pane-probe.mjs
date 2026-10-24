// Local-only production preview on port 3147; see PANE-HISTORY.md.
// bunx tsx audit-evidence/performance-20261022/run-concurrent-pane-probe.mjs '{"shellAudit":true,"synchronized":true,"cpuRate":4}' /tmp/shell-result.json
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const options = JSON.parse(process.argv[2] ?? '{}');
const output = process.argv[3];
if (!output) throw new Error('Supply an output JSON path');
const source = await readFile(new URL('./concurrent-pane-stream-probe.js', import.meta.url), 'utf8');
const probe = new Function(`${source};return concurrentPaneStreamProbe;`)();
const browser = await chromium.launch({ headless: true });
const timer = setTimeout(() => browser.close().catch(() => {}), 90_000);
try {
    const result = await probe(await browser.newPage(), options);
    await writeFile(output, JSON.stringify({ browser: browser.version(), options, ...result }, null, 2) + '\n');
    console.log(JSON.stringify({ output, p95: result.p95, max: result.max, longTasks: result.longTasks.length,
        savedExact: result.savedExact, shell: result.shell ? { initialInstances: result.shell.initialInstances,
            updates: Object.entries(result.shell.grouped).filter(([,v])=>v.streaming||v.afterTransport)
                .sort((a,b)=>b[1].streaming-a[1].streaming).slice(0,20), dom: result.shell.dom, editors: result.shell.editors } : undefined }));
} finally { clearTimeout(timer); await browser.close(); }
