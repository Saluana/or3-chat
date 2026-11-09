import { spawn } from 'node:child_process';

// Give Playwright time to clean up, then bound the smoke process itself.
// Browsers can create detached groups; runner teardown owns their final cleanup.
export async function runBrowserProcess(script, { cwd, env, timeoutMs = 300_000, graceMs = 10_000 }) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd, env, stdio: 'inherit', detached: true });
    let timedOut = false;
    let hardKill;
    const signalGroup = (signal) => {
      try { if (child.pid) process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup('SIGTERM');
      hardKill = setTimeout(() => signalGroup('SIGKILL'), graceMs);
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); clearTimeout(hardKill); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); clearTimeout(hardKill); resolve({ code, signal, timedOut }); });
  });
}
