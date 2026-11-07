#!/usr/bin/env node
/** Disposable installed-artifact directory scale receipt. No host database/env is read. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WorkspaceAccessStore } from '../../server/admin/stores/types';

// Failure inventory: a large default directory must not sort every user into a
// temporary B-tree; keyset pages must be complete, bounded and duplicate-free.
const artifact = resolve(process.env.OR3_SQLITE_ARTIFACT_ROOT ?? 'node_modules/or3-provider-sqlite');
const load = (name: string) => import(pathToFileURL(join(artifact, 'dist/runtime/server', name + '.js')).href);
const { initializeSqliteDb, destroySqliteDb, getRawDb } = await load('db/kysely');
const { runMigrations } = await load('db/migrate');
const { createSqliteWorkspaceAccessStore } = await load('admin/stores/sqlite-store');
const root = await mkdtemp(join(tmpdir(), 'or3-admin-directory-'));
const report: Record<string, unknown> = { artifact, fixtureUsers: 50_000, pageLimit: 50, success: false };
try {
    await runMigrations(await initializeSqliteDb({ path: join(root, 'canonical.sqlite'), driver: 'better-sqlite3' }));
    const raw = getRawDb();
    raw.transaction(() => {
        const insert = raw.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)');
        for (let i = 0; i < 50_000; i++) insert.run(`user-${String(i).padStart(6, '0')}`, `user-${i}@example.test`, `User ${i}`, 1_800_000_000 + Math.floor(i / 5));
    })();
    const plan = raw.prepare('EXPLAIN QUERY PLAN SELECT id,email,display_name,created_at FROM users ORDER BY created_at DESC,id DESC LIMIT 51').all() as Array<{ detail: string }>;
    report.queryPlan = plan.map(row => row.detail);
    const store = createSqliteWorkspaceAccessStore() as WorkspaceAccessStore;
    const start = performance.now();
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
        const result = await store.listCustomers!({ limit: 50, cursor });
        assert.equal(result.items.length, 50);
        for (const item of result.items) { assert.ok(!seen.has(item.userId)); seen.add(item.userId); }
        assert.ok(result.nextCursor); cursor = result.nextCursor;
    }
    report.pages = 20; report.uniqueUsers = seen.size; report.elapsedMs = Math.round((performance.now() - start) * 100) / 100;
    assert.equal(seen.size, 1000);
    assert.ok(plan.every(row => !/TEMP B-TREE/i.test(row.detail)), 'Directory requires a full temporary sort; qualify the canonical pagination index first.');
    report.success = true;
} catch (error) {
    report.error = error instanceof Error ? error.message : 'Directory qualification failed';
    process.exitCode = 1;
} finally {
    await destroySqliteDb(); await rm(root, { recursive: true, force: true });
    await mkdir(resolve('output/admin-customer-operations'), { recursive: true });
    await writeFile(resolve('output/admin-customer-operations/directory-scale.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
}
