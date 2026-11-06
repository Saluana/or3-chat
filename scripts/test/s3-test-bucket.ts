import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Opt-in paid-network fixture. Own only a unique key prefix and one CORS rule;
 * never delete the bucket, pre-existing objects, or another run's CORS rules. */
export async function prepareS3TestBucket(origin: string) {
    const required = ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'];
    for (const key of required) if (!process.env[`OR3_STORAGE_S3_${key}`]?.trim()) throw new Error(`Missing OR3_STORAGE_S3_${key} for disposable S3 testing`);
    const require = createRequire(join(process.cwd(), 'node_modules/or3-provider-s3/package.json'));
    const { S3Client, GetBucketCorsCommand, PutBucketCorsCommand, DeleteBucketCorsCommand,
        ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
    const bucket = process.env.OR3_STORAGE_S3_BUCKET!;
    const id = `or3-e2e-${crypto.randomUUID()}`;
    const prefix = `${id}/`;
    const client = new S3Client({ region: process.env.OR3_STORAGE_S3_REGION, endpoint: process.env.OR3_STORAGE_S3_ENDPOINT,
        forcePathStyle: process.env.OR3_STORAGE_S3_FORCE_PATH_STYLE === 'true',
        credentials: { accessKeyId: process.env.OR3_STORAGE_S3_ACCESS_KEY_ID!, secretAccessKey: process.env.OR3_STORAGE_S3_SECRET_ACCESS_KEY!,
            sessionToken: process.env.OR3_STORAGE_S3_SESSION_TOKEN } });
    const readCors = async () => {
        try { return (await client.send(new GetBucketCorsCommand({ Bucket: bucket }))).CORSRules ?? []; }
        catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return []; throw error; }
    };
    let corsInstalled = false;
    async function cleanup() {
        try {
            // Always restart listing after removing a page, rather than relying
            // on a continuation token across changes to this fixture's keys.
            for (let page = 0; ; page++) {
                if (page >= 100) throw new Error('S3 fixture cleanup exceeded its bound');
                const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }));
                const objects = result.Contents ?? [];
                if (!objects.length) break;
                if (objects.some((object: { Key?: string }) => !object.Key?.startsWith(prefix))) throw new Error('S3 fixture returned a foreign key');
                const deleted = await client.send(new DeleteObjectsCommand({ Bucket: bucket,
                    Delete: { Objects: objects.map((object: { Key: string }) => ({ Key: object.Key })), Quiet: true } }));
                if (deleted.Errors?.length) throw new Error('S3 fixture objects could not be removed');
            }
        } finally {
            try {
                if (corsInstalled) {
                    const rules = (await readCors()).filter((rule: { ID?: string }) => rule.ID !== id);
                    await client.send(rules.length ? new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } })
                        : new DeleteBucketCorsCommand({ Bucket: bucket }));
                }
            } finally { client.destroy(); }
        }
    }
    try {
        const rules = await readCors();
        await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [...rules,
            { ID: id, AllowedOrigins: [origin], AllowedMethods: ['GET', 'PUT', 'HEAD'],
                AllowedHeaders: ['Content-Type', 'Content-MD5', 'x-amz-*'], ExposeHeaders: ['ETag', 'Content-Length'], MaxAgeSeconds: 300 },
        ] } }));
        corsInstalled = true;
        return { prefix, cleanup, env: { OR3_STORAGE_S3_KEY_PREFIX: prefix } };
    } catch (error) { client.destroy(); throw error; }
}
