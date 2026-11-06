#!/usr/bin/env node
// Bounded native-worker/WAL diagnostic. Only its own temporary SQLite file is modified.
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

if (!isMainThread) {
    const db = new Database(workerData.path);
    db.pragma('busy_timeout = 10000');
    const write = db.prepare('INSERT INTO operations (worker, ordinal) VALUES (?, ?)');
    for (let i = 0; i < 1000; i++) {
        write.run(workerData.id, i);
        if (i % 10 === 0) {
            const reader = new Database(workerData.path, { readonly: true });
            reader.prepare('SELECT count(*) FROM operations').get();
            reader.close();
        }
        if (i % 100 === 0) db.pragma('wal_checkpoint(PASSIVE)');
    }
    // Alternate explicit close and worker environment cleanup, like Nitro worker replacement.
    if (workerData.id % 2 === 0) db.close();
    parentPort.postMessage('done');
} else {
    const root = await mkdtemp(join(tmpdir(), 'or3-billing-native-'));
    const path = join(root, 'shared.sqlite');
    const db = new Database(path);
    const report = { node: process.version, platform: process.platform, arch: process.arch,
        sqlite: db.prepare('SELECT sqlite_version() AS version').get().version, rounds: 8, workersPerRound: 4, writesPerWorker: 1000 };
    let workers = [];
    try {
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 10000');
        db.exec('CREATE TABLE operations(worker INTEGER, ordinal INTEGER, PRIMARY KEY(worker,ordinal))');
        for (let round = 0; round < report.rounds; round++) {
            workers = Array.from({ length: report.workersPerRound }, (_, index) => new Worker(new URL(import.meta.url), { workerData: { path, id: round * 4 + index } }));
            await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Native worker timed out')), 30000);
                worker.once('error', error => { clearTimeout(timeout); reject(error); });
                worker.once('exit', code => { clearTimeout(timeout); code ? reject(new Error(`Native worker exited ${code}`)) : resolve(); });
            })));
            assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
            assert.equal(db.prepare('SELECT count(*) AS count FROM operations').get().count, (round + 1) * 4000);
        }
        report.success = true;
        console.log(`PASS ${report.rounds * 4000} native WAL writes with concurrent readers and worker teardown; SQLite ${report.sqlite}`);
    } catch (error) { report.success = false; report.error = error.message; process.exitCode = 1; }
    finally {
        await Promise.allSettled(workers.map(worker => worker.terminate()));
        db.close();
        await rm(root, { recursive: true, force: true });
        await mkdir(resolve('output/hosted-billing'), { recursive: true });
        await writeFile(resolve('output/hosted-billing/sqlite-native-stress.json'), JSON.stringify(report, null, 2) + '\n');
    }
}
