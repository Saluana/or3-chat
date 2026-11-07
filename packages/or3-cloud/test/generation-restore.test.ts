import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { rebindRestoredGenerations } from '../src/backup/generation-restore';

// Restore contract: copying changes directory identity, but must preserve bytes,
// canonical state and the permanent removal fence. Existing process tests never
// copy a live generation. Exercise real files and SQLite before implementing repair.
// Failures: corrupt bytes, mismatched canonical identity, missing live payload,
// partial claimed removal and repeated repair. No runtime safety bypass is added.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(state = 'verified') {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'or3-restore-')); roots.push(root);
  const ns = crypto.randomUUID();
  fs.mkdirSync(path.join(root, 'generations-v1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'generations-v1/namespace.json'), JSON.stringify({ version: 1, namespaceId: ns }));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE storage_object_generations (generation_id TEXT,workspace_id TEXT,hash TEXT,storage_provider_id TEXT,storage_id TEXT,size_bytes INTEGER,state TEXT)');
  function addGeneration(generationState: string, content = 'preserved payload') {
    const id = crypto.randomUUID(), blob = Buffer.from(content);
    const hash = 'sha256:' + crypto.createHash('sha256').update(blob).digest('hex');
    const slot = path.join(root, 'generations-v1/workspaces/workspace', id);
    fs.mkdirSync(path.join(slot, 'payload'), { recursive: true });
    const ready = { version: 1, namespaceId: ns, workspaceId: 'workspace', generationId: id, hash, sizeBytes: blob.length,
      storageId: `fs-generation-v1:${ns}:workspace:${id}:${hash.slice(7)}`, readyReceiptId: crypto.randomUUID(), payloadDevice: '1', payloadInode: '1' };
    fs.writeFileSync(path.join(slot, 'ready.json'), JSON.stringify(ready));
    fs.writeFileSync(path.join(slot, 'payload/blob'), blob);
    db.prepare('INSERT INTO storage_object_generations VALUES (?,?,?,?,?,?,?)').run(id, 'workspace', hash, 'fs', ready.storageId, blob.length, generationState);
    return { slot, ready };
  }
  return { root, ...addGeneration(state), db, addGeneration,
    repair: (options?: { previousSafetySnapshot?: boolean }) => rebindRestoredGenerations(fs, path, crypto, db, root, options) };
}
test('offline restore rebinds directory identity without changing canonical state or file content; replay is safe', () => {
  const f = fixture();
  try {
    f.repair(); f.repair();
    const ready = JSON.parse(fs.readFileSync(path.join(f.slot, 'ready.json'), 'utf8'));
    const stat = fs.statSync(path.join(f.slot, 'payload'), { bigint: true });
    expect(ready).toEqual({ ...f.ready, payloadDevice: String(stat.dev), payloadInode: String(stat.ino) });
    expect(fs.readFileSync(path.join(f.slot, 'payload/blob'), 'utf8')).toBe('preserved payload');
    expect(f.db.prepare('SELECT state FROM storage_object_generations').get()).toEqual({ state: 'verified' });
  } finally { f.db.close(); }
});
test.each([false, true])('restore refuses corrupt live bytes before changing the readiness fence (safety snapshot: %s)', (previousSafetySnapshot) => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.slot, 'payload/blob'), 'corrupt');
    expect(() => f.repair({ previousSafetySnapshot })).toThrow();
    expect(JSON.parse(fs.readFileSync(path.join(f.slot, 'ready.json'), 'utf8'))).toEqual(f.ready);
  } finally { f.db.close(); }
});
test('restore preserves a partially removed claimed generation without recreating payload bytes', () => {
  const f = fixture('claimed');
  try {
    fs.unlinkSync(path.join(f.slot, 'payload/blob')); f.repair();
    expect(fs.existsSync(path.join(f.slot, 'payload/blob'))).toBe(false);
    expect(f.db.prepare('SELECT state FROM storage_object_generations').get()).toEqual({ state: 'claimed' });
  } finally { f.db.close(); }
});

// Canonical records, rather than the files that happen to survive extraction,
// must determine completeness. The previous traversal only checked present files.
test.each(['blob', 'payload', 'ready', 'slot', 'namespace'] as const)('restore refuses a canonical generation missing its %s', (missing) => {
  const f = fixture();
  try {
    const target = missing === 'blob' ? path.join(f.slot, 'payload/blob') : missing === 'payload' ? path.join(f.slot, 'payload') :
      missing === 'ready' ? path.join(f.slot, 'ready.json') : missing === 'slot' ? f.slot : path.join(f.root, 'generations-v1');
    fs.rmSync(target, { recursive: true });
    expect(f.repair).toThrow();
    expect(f.db.prepare('SELECT state FROM storage_object_generations').get()).toEqual({ state: 'verified' });
  } finally { f.db.close(); }
});

// Byte-preservation recovery must not turn a failed update into an outage just
// because the original deployment already had a missing attachment. Existing
// ordinary-restore cases enforce completeness but do not cover this mode.
// Missing bytes/fences stay missing; surviving invalid content is still refused,
// and one incomplete generation must not prevent healthy siblings from rebinding.
test.each(['blob', 'payload', 'ready', 'slot'] as const)('safety recovery preserves a missing %s while repairing healthy siblings', (missing) => {
  const f = fixture();
  try {
    const sibling = f.addGeneration('verified', 'healthy sibling');
    const rows = f.db.prepare('SELECT * FROM storage_object_generations ORDER BY generation_id').all();
    const target = missing === 'blob' ? path.join(f.slot, 'payload/blob') : missing === 'payload' ? path.join(f.slot, 'payload') :
      missing === 'ready' ? path.join(f.slot, 'ready.json') : f.slot;
    fs.rmSync(target, { recursive: true });
    f.repair({ previousSafetySnapshot: true });
    f.repair({ previousSafetySnapshot: true });
    expect(fs.existsSync(target)).toBe(false);
    if (missing === 'blob' || missing === 'payload') expect(JSON.parse(fs.readFileSync(path.join(f.slot, 'ready.json'), 'utf8'))).toEqual(f.ready);
    const stat = fs.statSync(path.join(sibling.slot, 'payload'), { bigint: true });
    expect(JSON.parse(fs.readFileSync(path.join(sibling.slot, 'ready.json'), 'utf8')))
      .toEqual({ ...sibling.ready, payloadDevice: String(stat.dev), payloadInode: String(stat.ino) });
    expect(fs.readFileSync(path.join(sibling.slot, 'payload/blob'), 'utf8')).toBe('healthy sibling');
    expect(f.db.prepare('SELECT * FROM storage_object_generations ORDER BY generation_id').all()).toEqual(rows);
    expect(() => f.repair()).toThrow();
  } finally { f.db.close(); }
});
