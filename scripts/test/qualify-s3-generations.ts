#!/usr/bin/env node
/** Explicit paid-network qualification using a NEW disposable bucket only.
 * Does not change the application's bucket, canonical data or cleanup flags. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(resolve('node_modules/or3-provider-s3/package.json'));
const { S3Client, CreateBucketCommand, PutBucketVersioningCommand, GetBucketVersioningCommand,
    PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
    ListObjectVersionsCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
const index = process.argv.indexOf('--env');
if (index < 0 || !process.argv[index + 1]) throw new Error('Pass --env <private S3 environment file>.');
const env = parseEnv(await readFile(resolve(process.argv[index + 1]!), 'utf8'));
const endpoint = env.OR3_STORAGE_S3_ENDPOINT;
if (!endpoint || !env.OR3_STORAGE_S3_ACCESS_KEY_ID || !env.OR3_STORAGE_S3_SECRET_ACCESS_KEY) throw new Error('Missing S3 test configuration.');
const client = new S3Client({ endpoint, region: env.OR3_STORAGE_S3_REGION || 'us-east-1', forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 2,
    credentials: { accessKeyId: env.OR3_STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: env.OR3_STORAGE_S3_SECRET_ACCESS_KEY } });
const bucket = `or3-generation-test-${randomUUID().replaceAll('-', '')}`;
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), endpoint: new URL(endpoint).origin,
    fixtureBucket: bucket, checks: [], success: false, fixtureRemoved: false };
const checks = report.checks as string[];
let created = false;
const send = (Command: any, input: Record<string, unknown> = {}) => client.send(new Command({ Bucket: bucket, ...input }));
function version(value: { VersionId?: string }) {
    assert.ok(value.VersionId && value.VersionId !== 'null', 'Immutable version ID missing');
    return value.VersionId;
}
async function rejectsWrite(input: Record<string, unknown>) {
    try { await send(PutObjectCommand, input); }
    catch (error) {
        assert.equal((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode, 412);
        return;
    }
    throw new Error('Conditional create was ignored: overwrite succeeded');
}
try {
    await send(CreateBucketCommand); created = true;
    await send(PutBucketVersioningCommand, { VersioningConfiguration: { Status: 'Enabled' } });
    assert.equal((await send(GetBucketVersioningCommand)).Status, 'Enabled');
    checks.push('explicit versioning on disposable bucket');
    const first = await send(PutObjectCommand, { Key: 'generation/payload', Body: 'original', IfNoneMatch: '*' });
    const firstVersion = version(first);
    await rejectsWrite({ Key: 'generation/payload', Body: 'overwrite', IfNoneMatch: '*' });
    const original = await send(GetObjectCommand, { Key: 'generation/payload', VersionId: firstVersion });
    assert.equal(await original.Body.transformToString(), 'original');
    checks.push('conditional create rejects overwrite without changing original');
    const raced = await Promise.allSettled(['left', 'right'].map(Body => send(PutObjectCommand, { Key: 'race/payload', Body, IfNoneMatch: '*' })));
    assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1, 'Only one competing create may succeed');
    const rejected = raced.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.$metadata?.httpStatusCode, 412);
    checks.push('concurrent conditional creates have one winner');
    // A retained, non-delete-marker tombstone keeps conditional old uploads
    // fenced while an exact historical payload version is physically removed.
    const retired = await send(PutObjectCommand, { Key: 'generation/payload', Body: 'permanent-retired-generation' });
    const retiredVersion = version(retired);
    assert.notEqual(retiredVersion, firstVersion);
    assert.equal(await (await send(GetObjectCommand, { Key: 'generation/payload', VersionId: firstVersion })).Body.transformToString(), 'original');
    await send(DeleteObjectCommand, { Key: 'generation/payload', VersionId: firstVersion });
    try {
        await send(HeadObjectCommand, { Key: 'generation/payload', VersionId: firstVersion });
        throw new Error('Exact old version still exists');
    } catch (error) { assert.equal((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode, 404); }
    assert.equal(version(await send(HeadObjectCommand, { Key: 'generation/payload' })), retiredVersion);
    await rejectsWrite({ Key: 'generation/payload', Body: 'stale-upload', IfNoneMatch: '*' });
    checks.push('exact-version deletion retains tombstone and rejects stale upload');
    report.success = true;
} catch (error) {
    report.error = error instanceof assert.AssertionError ? error.message
        : (error as { name?: string }).name ?? 'Protocol qualification failed';
    report.failureMessage = error instanceof Error && !('$metadata' in error) ? error.message : undefined;
    process.exitCode = 1;
} finally {
    if (created) {
        try {
            // List only the freshly created fixture bucket, never the host bucket.
            for (let page = 0; page < 20; page++) {
                const objects = await send(ListObjectVersionsCommand, { MaxKeys: 100 });
                const entries = [...(objects.Versions ?? []), ...(objects.DeleteMarkers ?? [])];
                if (!entries.length) { assert.equal(objects.IsTruncated, false); break; }
                for (const object of entries) {
                    assert.ok(object.Key && object.VersionId, 'Incomplete fixture cleanup identity');
                    await send(DeleteObjectCommand, { Key: object.Key, VersionId: object.VersionId });
                }
            }
            await send(DeleteBucketCommand); report.fixtureRemoved = true;
        } catch { report.success = false; report.cleanupRequired = bucket; process.exitCode = 1; }
    }
    client.destroy();
    report.finishedAt = new Date().toISOString();
    await mkdir(resolve('output/hosted-billing'), { recursive: true });
    await writeFile(resolve('output/hosted-billing/s3-generation-protocol.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}
