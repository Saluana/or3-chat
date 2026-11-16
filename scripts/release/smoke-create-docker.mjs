#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const phase = process.argv[2];
if (!['write','verify','legacy-fence','validation-failure'].includes(phase)) {
    throw new Error('Usage: smoke-create-docker.mjs write|verify|legacy-fence|validation-failure <cli-tarball>');
}

const baseUrl = process.env.OR3_SMOKE_URL ?? 'http://127.0.0.1:3000';
const statePath = resolve('.or3-smoke-state.json');

function parseEnv(source) {
    const values = {};
    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1).replaceAll(/\\([\\'])/g, '$1');
        } else if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

const legacyDigests = new Set([
    'sha256:f7e6c507f2fb944c91f285e976b69b578ff9a24cdb8ceeaf22db7e22c79de692',
    'sha256:772975a54da5662fd08cf7627b352eea769006d7536123d766643a455b4c2364',
    'sha256:8dcafc169a27579bb14c41097dc9efdecc2ce08bf7589dd96fbee3ecd222e34b',
]);
async function isPublishedLegacy() {
    const state = JSON.parse(await readFile(resolve('.or3-cloud/state.json'), 'utf8'));
    return state.appVersion === '0.1.116' && legacyDigests.has(state.imageDigest);
}

// RB-2: kill only the disposable, exact candidate AFTER observing its real
// immutable validation process. No synthetic closed-admission journal.
if (phase === 'validation-failure') {
    const tarball = process.argv[3];
    if (!tarball || !await isPublishedLegacy()) throw new Error('Validation failure needs a pinned published 0.1.116 source and exact CLI tarball');
    const args = ['compose','--env-file',resolve('.env'),'-f',resolve('compose.yaml')];
    const docker = argv => execFileSync('docker',argv,{encoding:'utf8',timeout:30000}).trim();
    const initial = JSON.parse(await readFile(resolve('.or3-cloud/state.json'),'utf8'));
    const child = spawn('npm',['exec','--yes','--package='+resolve(tarball),'--','or3','update','--to',process.env.VERSION],{stdio:['ignore','pipe','pipe'],env:process.env});
    let log = '', exit;
    child.stdout.on('data',data=>{log+=data;}); child.stderr.on('data',data=>{log+=data;});
    const ended = new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('exit',code=>{exit=code;resolveExit(code);});});
    let injected = false;
    try {
        const deadline = Date.now()+240000;
        while (exit === undefined && Date.now()<deadline) {
            const response = await fetch(new URL('/api/health?deep=true',baseUrl),{signal:AbortSignal.timeout(2000)}).catch(()=>null);
            const health = await response?.json().catch(()=>null);
            if (health?.validation === 'health-only-v1') {
                const id = docker([...args,'ps','-q','or3']);
                const container = JSON.parse(docker(['inspect','--format','{{json .}}',id]));
                const expected = JSON.parse(docker(['image','inspect','--format','{{json .}}',process.env.OR3_CLOUD_TEST_IMAGE]));
                if (container.Image !== expected.Id || !container.Config.Env.includes('OR3_CLOUD_UPDATE_VALIDATION=true')) throw new Error('Validation container binding mismatch');
                for (const [path,method] of [['/','GET'],['/api/basic-auth/sign-in','POST'],['/api/sync/push','POST'],['/api/storage/commit','POST']]) {
                    const denied = await fetch(new URL(path,baseUrl),{method,redirect:'manual',signal:AbortSignal.timeout(2000)});
                    if (denied.status!==503 || (await denied.json()).data?.code!=='update_validation') throw new Error('Validation admitted application work');
                }
                // Docker keeps the immutable env/image configuration after exit,
                // allowing the managed CLI to prove this failed boot stayed closed.
                docker(['update','--restart=no',id]); docker(['kill',id]); injected=true; break;
            }
            await new Promise(resolveWait=>setTimeout(resolveWait,100));
        }
        const code = await Promise.race([ended,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Validation rollback timed out')),240000).unref())]);
        const restored = JSON.parse(await readFile(resolve('.or3-cloud/state.json'),'utf8'));
        if (!injected || code===0 || restored.incompleteOperation || restored.imageDigest!==initial.imageDigest || !restored.lastReceipt?.checks.some(check=>check.code==='automatic-source-restore'&&check.status==='passed')) throw new Error('Closed validation did not automatically restore the source: '+log.slice(-2000));
        console.log('RB-2 real candidate validation failure restored published source; update exited nonzero.');
    } finally { if (exit===undefined) child.kill('SIGTERM'); }
    process.exit(0);
}

async function deploymentCredentials() {
    const env = parseEnv(await readFile(resolve('.env'), 'utf8'));
    const handoff = parseEnv(await readFile(resolve('.or3-initial-credentials'), 'utf8'));
    return {
        ownerEmail: env.OR3_MANAGED_OWNER_EMAIL || handoff.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL,
        ownerPassword: handoff.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD,
        adminUsername: env.OR3_ADMIN_USERNAME || handoff.OR3_ADMIN_USERNAME,
        adminPassword: handoff.OR3_ADMIN_PASSWORD,
    };
}

async function responseError(response) {
    const body = await response.text().catch(() => '');
    return new Error(
        `${response.url} returned ${response.status}: ${body.slice(0, 300)}`
    );
}

async function expectOk(response) {
    if (!response.ok) throw await responseError(response);
    return response;
}

async function jsonRequest(path, { body, cookie, method = 'POST' } = {}) {
    const response = await fetch(new URL(path, baseUrl), {
        method,
        headers: {
            accept: 'application/json',
            ...(body === undefined
                ? {}
                : { 'content-type': 'application/json' }),
            ...(cookie ? { cookie } : {}),
            ...(method === 'GET'
                ? {}
                : { origin: new URL(baseUrl).origin, 'x-or3-cloud-intent': 'mutation' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    await expectOk(response);
    return await response.json();
}

async function authenticate() {
    const { ownerEmail: email, ownerPassword: password } = await deploymentCredentials();
    if (!email || !password) {
        throw new Error('Basic Auth owner credentials are missing from the managed handoff.');
    }

    const signIn = await fetch(new URL('/api/basic-auth/sign-in', baseUrl), {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            origin: baseUrl,
        },
        body: JSON.stringify({ email, password }),
    });
    await expectOk(signIn);
    const setCookies =
        typeof signIn.headers.getSetCookie === 'function'
            ? signIn.headers.getSetCookie()
            : [signIn.headers.get('set-cookie')].filter(Boolean);
    const cookie = setCookies
        .map((value) => value.split(';', 1)[0])
        .join('; ');
    if (!cookie) throw new Error('Basic Auth sign-in did not set a cookie.');

    const session = await jsonRequest('/api/auth/session', {
        cookie,
        method: 'GET',
    });
    if (
        session.session?.user?.email !== email ||
        !session.session?.workspace?.id
    ) {
        throw new Error('Authenticated session did not include the admin workspace.');
    }
    return {
        cookie,
        workspaceId: session.session.workspace.id,
    };
}

async function verifyAdminDashboard() {
    const { adminUsername: username, adminPassword: password } = await deploymentCredentials();
    if (!username || !password) {
        throw new Error('Cloud smoke requires the managed admin credential handoff.');
    }

    const signIn = await fetch(new URL('/api/admin/auth/login', baseUrl), {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            origin: baseUrl,
        },
        body: JSON.stringify({ username, password }),
    });
    await expectOk(signIn);
    const setCookies =
        typeof signIn.headers.getSetCookie === 'function'
            ? signIn.headers.getSetCookie()
            : [signIn.headers.get('set-cookie')].filter(Boolean);
    const cookie = setCookies
        .map((value) => value.split(';', 1)[0])
        .join('; ');
    if (!cookie) throw new Error('Admin sign-in did not set a cookie.');

    const dashboard = await expectOk(
        await fetch(new URL('/admin', baseUrl), {
            headers: { cookie },
        })
    );
    const page = await dashboard.text();
    if (!page.includes('Admin')) {
        throw new Error('Admin dashboard did not render after sign-in.');
    }
}

let historyIncarnation;
async function verifySync(cookie, workspaceId) {
    const pull = await jsonRequest('/api/sync/pull', {
        cookie,
        body: {
            scope: { workspaceId },
            historyIncarnation: null, historyIncarnationCapability: 'incarnation-v1',
            cursor: 0,
            limit: 10,
            tables: ['messages'],
        },
    });
    historyIncarnation = pull.historyIncarnation;
    if (typeof historyIncarnation !== 'string' || !/^[\x00-\x7f]{1,128}$/.test(historyIncarnation)) {
        if (!await isPublishedLegacy()) throw new Error('Unqualified history incarnation runtime');
        historyIncarnation = undefined;
        console.warn('Published legacy sync: incarnation protection unavailable.');
    }
    if (!Array.isArray(pull.changes) || typeof pull.nextCursor !== 'number') {
        throw new Error('SQLite sync pull returned an invalid response.');
    }
}

async function verifyCloudMode() {
    // The production lock page can be streamed/serialized differently across
    // Nuxt builds, so qualify the runtime contract through the public deep
    // health response rather than brittle HTML substring matching.
    const response = await expectOk(
        await fetch(new URL('/api/health?deep=true', baseUrl))
    );
    const health = await response.json();
    const providers = health.providers ?? {};
    if (
        health.status !== 'ok' ||
        providers.auth?.provider !== 'basic-auth' ||
        providers.sync?.provider !== 'sqlite' ||
        providers.storage?.provider !== 'fs'
    ) {
        throw new Error(
            `Managed Cloud provider profile is not active: ${JSON.stringify({
                status: health.status,
                providers: {
                    auth: providers.auth?.provider,
                    sync: providers.sync?.provider,
                    storage: providers.storage?.provider,
                },
            })}`
        );
    }
}

const uploadBytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
    'hex'
);

async function writeFixture(cookie, workspaceId) {
    const hash = createHash('sha256').update(uploadBytes).digest('hex');
    const qualifiedHash = `sha256:${hash}`;
    const presign = await jsonRequest('/api/storage/presign-upload', {
        cookie,
        body: {
            workspace_id: workspaceId,
            hash: qualifiedHash,
            mime_type: 'image/png',
            size_bytes: uploadBytes.length,
            disposition: 'inline',
        },
    });
    const upload = await fetch(new URL(presign.url, baseUrl), {
        method: presign.method ?? 'PUT',
        headers: {
            'content-type': 'image/png',
            ...(cookie ? { cookie } : {}),
            ...(presign.headers ?? {}),
        },
        body: uploadBytes,
    });
    await expectOk(upload);

    await jsonRequest('/api/storage/commit', {
        cookie,
        body: {
            workspace_id: workspaceId,
            hash: qualifiedHash,
            storage_id: presign.storageId,
            intent_id: presign.intentId,
            storage_provider_id: 'fs',
            mime_type: 'image/png',
            size_bytes: uploadBytes.length,
            name: 'or3-docker-smoke.png',
            kind: 'image',
        },
    });
    const now = Date.now();
    const opId = randomUUID();
    const pushed = await jsonRequest('/api/sync/push', {
        cookie,
        body: {
            scope: { workspaceId }, historyIncarnation, historyIncarnationCapability: 'incarnation-v1',
            ops: [{
                id: `release-smoke-${opId}`,
                tableName: 'file_meta',
                operation: 'put',
                pk: qualifiedHash,
                payload: {
                    hash: qualifiedHash,
                    kind: 'image',
                    mime_type: 'image/png',
                    size_bytes: uploadBytes.length,
                    storage_id: presign.storageId,
                    name: 'or3-docker-smoke.png',
                    deleted: false,
                    created_at: now,
                    updated_at: now,
                    clock: now,
                },
                stamp: {
                    deviceId: 'release-smoke',
                    opId,
                    hlc: `${String(now).padStart(13, '0')}:0000:release-smoke`,
                    clock: now,
                },
                createdAt: now,
                attempts: 0,
                status: 'pending',
            }],
        },
    });
    if (pushed.results?.[0]?.success !== true) {
        throw new Error(`File metadata sync failed: ${JSON.stringify(pushed)}`);
    }
    await writeFile(
        statePath,
        `${JSON.stringify(
            {
                workspaceId,
                hash: qualifiedHash,
                storageId: presign.storageId,
            },
            null,
            2
        )}\n`
    );
}

async function verifyFixture(cookie, workspaceId) {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (state.workspaceId !== workspaceId) {
        throw new Error('Workspace identity changed after container restart.');
    }
    const presign = await jsonRequest('/api/storage/presign-download', {
        cookie,
        body: {
            workspace_id: workspaceId,
            hash: state.hash,
            storage_id: state.storageId,
            mime_type: 'image/png',
            disposition: 'attachment',
        },
    });
    const download = await fetch(new URL(presign.url, baseUrl), {
        headers: cookie ? { cookie } : {},
    });
    await expectOk(download);
    const restored = Buffer.from(await download.arrayBuffer());
    if (!restored.equals(uploadBytes)) {
        throw new Error('Uploaded file did not survive the container restart.');
    }
}

const { cookie, workspaceId } = await authenticate();
await verifyCloudMode();
await verifyAdminDashboard();
await verifySync(cookie, workspaceId);
if (phase === 'legacy-fence') {
    if (!await isPublishedLegacy()) throw new Error('Legacy fence requires exact published source digest');
    const { cookie, workspaceId } = await authenticate();
    const response = await fetch(new URL('/api/sync/push',baseUrl),{method:'POST',headers:{'content-type':'application/json',origin:new URL(baseUrl).origin,cookie,'x-or3-cloud-intent':'mutation-incarnation-v1'},body:JSON.stringify({scope:{workspaceId},ops:[]}),signal:AbortSignal.timeout(10000)});
    const body = await response.text();
    if(response.status!==403 || !body.includes('Missing mutation intent')) throw new Error('Published legacy runtime did not reject new intent before dispatch: '+body.slice(0,300));
    console.log('Published legacy image rejected new mutation intent before body dispatch.');
    process.exit(0);
}

if (phase === 'write') {
    await writeFixture(cookie, workspaceId);
    console.log('Docker login, SQLite sync, and file upload smoke passed.');
} else {
    await verifyFixture(cookie, workspaceId);
    console.log('Docker authentication and file persistence smoke passed.');
}
