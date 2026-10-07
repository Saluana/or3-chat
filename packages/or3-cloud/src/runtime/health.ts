import type { Mode } from '../deployment/contracts';
import { redact } from '../util/primitives';
import { run } from './command-runner';
import { captureComposeDiagnostics, composeArgs, diagnostics } from './compose';

const DEEP_HEALTH_TIMEOUT_MS = 180_000;

export const HEALTH_SCRIPT = "const fs=require('node:fs');try{fs.accessSync('/data',fs.constants.R_OK|fs.constants.W_OK);for(const path of [process.env.OR3_BASIC_AUTH_DB_PATH,process.env.OR3_SQLITE_DB_PATH].filter(Boolean)){const fd=fs.openSync(path,'r+');fs.closeSync(fd)}}catch{process.exit(1)}fetch('http://127.0.0.1:3000/api/health?deep=true').then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok||body.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))";

export const VERIFY_DATABASES_SCRIPT = `
const fs = require('node:fs');
const Database = require('/app/.output/server/node_modules/better-sqlite3');
const results = [];
for (const path of [process.env.OR3_BASIC_AUTH_DB_PATH, process.env.OR3_SQLITE_DB_PATH].filter(Boolean)) {
  const info = fs.statSync(path);
  if (info.uid !== 65532 || info.gid !== 65532) throw new Error(path + ' must be owned by 65532:65532');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const quickCheck = db.pragma('quick_check', { simple: true });
  const tables = db.prepare("select count(*) as count from sqlite_master where type = 'table'").get().count;
  db.close();
  if (quickCheck !== 'ok') throw new Error(path + ' quick_check failed: ' + quickCheck);
  results.push({ path, quickCheck, tables });
}
if (process.env.OR3_FORCE_HTTPS === 'true' && process.env.NUXT_SECURITY_PROXY_TRUST_PROXY !== 'true') {
  throw new Error('NUXT_SECURITY_PROXY_TRUST_PROXY must be true for a managed public deployment');
}
console.log(JSON.stringify(results));
`;
const CONTAINER_NODE = '/nodejs/bin/node';
const LEGACY_CONTAINER_NODE = '/usr/local/bin/node';
const CONTAINER_NODE_SHELL = `if [ -x ${CONTAINER_NODE} ]; then exec ${CONTAINER_NODE} -e "$1"; elif [ -x ${LEGACY_CONTAINER_NODE} ]; then exec ${LEGACY_CONTAINER_NODE} -e "$1"; else exit 127; fi`;

export function containerNodeCommand(script: string) {
  return ['sh', '-c', CONTAINER_NODE_SHELL, 'or3-node', script];
}

export async function waitForDeepHealthWithArgs(composeCommand: string[], directory: string, secrets: string[] = []) {
  const startedAt = Date.now();
  const deadline = startedAt + DEEP_HEALTH_TIMEOUT_MS;
  let lastError = 'health check did not complete';
  let lastProgressAt = startedAt;
  while (Date.now() < deadline) {
    const result = await run('docker', [
      ...composeCommand,
      'exec', '-T', 'or3', ...containerNodeCommand(HEALTH_SCRIPT),
    ], directory);
    if (result.ok) return;
    lastError = redact(result.stderr, secrets);
    // Bounded waits must still surface progress every 15 seconds.
    if (Date.now() - lastProgressAt >= 15_000) {
      console.error(`Waiting for OR3 deep health (${Math.round((Date.now() - startedAt) / 1000)}s elapsed)…`);
      lastProgressAt = Date.now();
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`OR3 deep health did not pass within ${DEEP_HEALTH_TIMEOUT_MS / 1000} seconds. Last error: ${lastError}`);
}

export async function waitForDeepHealth(directory: string, mode: Mode, secrets: string[] = []) {
  try {
    await waitForDeepHealthWithArgs(composeArgs(directory, mode), directory, secrets);
  } catch (error) {
    const captured = await captureComposeDiagnostics(directory, mode, secrets).catch((captureError) =>
      redact(`Diagnostics capture failed: ${captureError instanceof Error ? captureError.message : String(captureError)}`, secrets),
    );
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nCaptured Docker diagnostics:\n${captured}\nDiagnostics: ${diagnostics(directory, mode)}`);
  }
}

/** Bounded single-shot health probe for status: ok | degraded | unreachable. */
export async function probeDeepHealth(directory: string, mode: Mode) {
  const result = await run('docker', [...composeArgs(directory, mode, ['exec', '-T', 'or3', ...containerNodeCommand(HEALTH_SCRIPT)])], directory);
  if (result.ok) return 'ok' as const;
  const ps = await run('docker', [...composeArgs(directory, mode, ['ps', '-q', 'or3'])], directory);
  if (ps.ok && ps.stdout.trim()) return 'degraded' as const;
  return 'unreachable' as const;
}
