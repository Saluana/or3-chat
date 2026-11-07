/** Called only while writers are stopped, after authenticated archive extraction.
 * Runtime generation operations continue to enforce the original inode checks.
 * No database state, claim, receipt identity or absent payload is recreated.
 * Keep this function self-contained: it executes in the restored image.
 */
export function rebindRestoredGenerations(
  fs: typeof import('node:fs'), path: typeof import('node:path'), crypto: typeof import('node:crypto'),
  db: { prepare(sql: string): { all(...params: unknown[]): Array<Record<string, unknown>>; get(...params: unknown[]): Record<string, unknown> | undefined } }, root: string,
  options: { previousSafetySnapshot?: boolean } = {},
) {
  type GenerationRow = {
    workspace_id: string; storage_provider_id: string; storage_id: string;
    hash: string; size_bytes: number; state: string;
    namespace_id?: string; ready_receipt_id?: string | null;
  };
  // Recovery restores the source's exact bytes, including pre-existing absence.
  // It never repairs an incomplete fence or grants a new identity to its payload.
  const preserveMissing = options.previousSafetySnapshot === true;
  const fail = () => { throw new Error('Restored generation identity or payload is invalid'); };
  const info = (name: string) => {
    try { return fs.lstatSync(name, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  };
  const dir = (name: string) => { const s = info(name); if (!s?.isDirectory()) fail(); return s!; };
  const json = (name: string): unknown => {
    const s = info(name); if (!s?.isFile() || s.nlink !== 1n || s.size > 4096n) fail();
    return JSON.parse(fs.readFileSync(name, 'utf8'));
  };
  const base = path.join(root, 'generations-v1');
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  const required = new Set<string>();
  if (tables.has('storage_object_generations')) {
    for (const row of db.prepare("SELECT generation_id FROM storage_object_generations WHERE storage_provider_id = 'fs'").all()) required.add(String(row.generation_id));
  }
  if (tables.has('storage_generation_uploads')) {
    for (const row of db.prepare("SELECT generation_id FROM storage_generation_uploads WHERE storage_provider_id = 'fs' AND ready_receipt_id IS NOT NULL").all()) required.add(String(row.generation_id));
  }
  if (!info(base)) { if (required.size && !preserveMissing) fail(); return; }
  dir(root); dir(base);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const namespaceFile = path.join(base, 'namespace.json');
  if (!info(namespaceFile) && preserveMissing) return;
  const ns = json(namespaceFile) as { version: number; namespaceId: string };
  if (ns.version !== 1 || !uuid.test(ns.namespaceId)) fail();
  if (!tables.has('storage_object_generations')) fail();
  const workspaceRoot = path.join(base, 'workspaces');
  if (!info(workspaceRoot) && preserveMissing) return;
  dir(workspaceRoot);
  const changes: Array<{ file: string; ready: Record<string, unknown> }> = [];
  for (const workspace of fs.readdirSync(workspaceRoot)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspace)) fail();
    const work = path.join(workspaceRoot, workspace); dir(work);
    for (const id of fs.readdirSync(work)) {
      if (!uuid.test(id)) fail();
      const slot = path.join(work, id); dir(slot);
      const file = path.join(slot, 'ready.json');
      if (!info(file)) { if (required.has(id) && !preserveMissing) fail(); continue; }
      const ready = json(file) as {
        version: number; namespaceId: string; workspaceId: string; generationId: string;
        hash: string; sizeBytes: number; storageId: string; readyReceiptId: string;
      };
      if (ready.version !== 1 || ready.namespaceId !== ns.namespaceId || ready.workspaceId !== workspace || ready.generationId !== id ||
          !/^sha256:[a-f0-9]{64}$/.test(ready.hash) || !Number.isSafeInteger(ready.sizeBytes) || ready.sizeBytes < 0 ||
          !uuid.test(ready.readyReceiptId) || ready.storageId !== `fs-generation-v1:${ns.namespaceId}:${workspace}:${id}:${ready.hash.slice(7)}`) fail();
      const generation = db.prepare('SELECT * FROM storage_object_generations WHERE generation_id = ?').get(id) as GenerationRow | undefined;
      const upload = tables.has('storage_generation_uploads')
        ? db.prepare('SELECT * FROM storage_generation_uploads WHERE generation_id = ?').get(id) as GenerationRow | undefined : null;
      const record = generation ?? upload;
      if (!record || record.workspace_id !== workspace || record.storage_provider_id !== 'fs' || record.storage_id !== ready.storageId ||
          record.hash.replace(/^sha256:/i, '').toLowerCase() !== ready.hash.slice(7) || record.size_bytes !== ready.sizeBytes) fail();
      if (upload && (upload.namespace_id !== ns.namespaceId || (upload.ready_receipt_id && upload.ready_receipt_id !== ready.readyReceiptId))) fail();
      required.delete(id);
      const payload = path.join(slot, 'payload'); const payloadInfo = info(payload);
      const needsBlob = generation?.state === 'verified';
      if (!payloadInfo) { if (needsBlob && !preserveMissing) fail(); continue; }
      dir(payload);
      if (generation?.state === 'deleted' || (!generation && upload?.state === 'abandoned')) fail();
      const entries = fs.readdirSync(payload);
      const links = new Map<string, { count: bigint; expected: bigint }>();
      for (const entry of entries) {
        if (entry !== 'blob' && !/^\.upload-[0-9a-f-]{36}$/.test(entry)) fail();
        const s = info(path.join(payload, entry)); if (!s?.isFile()) fail();
        const key = `${s!.dev}:${s!.ino}`; const previous = links.get(key);
        links.set(key, { count: (previous?.count ?? 0n) + 1n, expected: s!.nlink });
      }
      if ([...links.values()].some(value => value.count !== value.expected)) fail();
      const blob = path.join(payload, 'blob');
      if (info(blob)) {
        const fd = fs.openSync(blob, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(65536); let size = 0, count = 0;
          while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { hash.update(buffer.subarray(0, count)); size += count; }
          if (size !== ready.sizeBytes || hash.digest('hex') !== ready.hash.slice(7)) fail();
        } finally { fs.closeSync(fd); }
      } else if (needsBlob) {
        if (!preserveMissing) fail();
        continue;
      }
      changes.push({ file, ready: { ...ready, payloadDevice: String(payloadInfo.dev), payloadInode: String(payloadInfo.ino) } });
    }
  }
  if (required.size && !preserveMissing) fail();
  // Validate the whole namespace before any change. Each replacement is atomic;
  // interrupted managed recovery re-extracts the authenticated archive before retry.
  for (const { file, ready } of changes) {
    const temp = file + '.restore-' + crypto.randomUUID();
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(ready)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  }
}
