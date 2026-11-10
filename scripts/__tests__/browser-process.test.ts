import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBrowserProcess } from '../release/browser-process.mjs';

// A timed-out browser journey must fail, offer its Playwright process time to
// clean up, and forcibly terminate an unresponsive process group afterward.
describe('bounded browser process', () => {
  it('offers graceful termination and still reports timeout as failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'or3-browser-process-'));
    try {
      const marker = join(dir, 'terminated');
      const script = join(dir, 'browser.mjs');
      await writeFile(script, `import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{writeFileSync(process.env.MARKER,'cleaned');process.exit(0)});setInterval(()=>{},1000);`);
      const result = await runBrowserProcess(script, { cwd: dir, env: { ...process.env, MARKER: marker }, timeoutMs: 300, graceMs: 1000 });
      expect(result.timedOut).toBe(true);
      expect(await readFile(marker, 'utf8')).toBe('cleaned');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('hard-kills a process that ignores graceful termination', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'or3-browser-process-'));
    try {
      const script = join(dir, 'browser.mjs');
      await writeFile(script, `process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
      const start = Date.now();
      const result = await runBrowserProcess(script, { cwd: dir, env: process.env, timeoutMs: 300, graceMs: 200 });
      expect(result.timedOut).toBe(true);
      expect(result.signal).toBe('SIGKILL');
      expect(Date.now() - start).toBeLessThan(5000);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
