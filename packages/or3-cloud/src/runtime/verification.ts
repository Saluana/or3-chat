import { createHash, randomBytes, randomUUID } from 'node:crypto';

type VerificationHealth = {
  status: 'ok';
  providers: {
    auth: { provider: 'basic-auth' };
    sync: { provider: 'sqlite' };
    storage: { provider: 'fs' };
  };
};

export function validateVerificationHealth(value: unknown): VerificationHealth {
  const health = value as {
    status?: unknown;
    providers?: {
      auth?: { provider?: unknown };
      sync?: { provider?: unknown };
      storage?: { provider?: unknown };
    };
  } | null;
  if (
    !health ||
    health.status !== 'ok' ||
    health.providers?.auth?.provider !== 'basic-auth' ||
    health.providers.sync?.provider !== 'sqlite' ||
    health.providers.storage?.provider !== 'fs'
  ) {
    throw new Error('Public deep health does not report the managed Basic Auth + SQLite + filesystem profile.');
  }
  return health as VerificationHealth;
}

export async function verificationFetch(url: URL, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
}

export async function verificationJson(
  baseUrl: URL,
  path: string,
  options: { body?: unknown; cookie?: string; method?: 'GET' | 'POST'; allowStorageDeletionDeferral?: boolean } = {},
) {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const response = await verificationFetch(new URL(path, baseUrl), {
    method,
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(method === 'GET' ? {} : { origin: baseUrl.origin, 'x-or3-cloud-intent': 'mutation' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (response.status !== 200) {
    const responseText = await response.text().catch(() => '');
    const detail = responseText.slice(0, 300);
    if (options.allowStorageDeletionDeferral && path === '/api/storage/delete' && response.status === 503) {
      let failure: unknown;
      try { failure = JSON.parse(responseText); } catch { /* Unexpected responses remain failures. */ }
      if (failure && typeof failure === 'object' && 'statusMessage' in failure
          && failure.statusMessage === 'Provider-owned deletion coordination is required') {
        return { deletionDeferred: true };
      }
    }
    throw new Error(`${response.url} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${response.url} returned an invalid JSON object.`);
  }
  return value as Record<string, unknown> & {
    session?: { user?: { email?: unknown }; workspace?: { id?: unknown } };
    results?: { success?: unknown }[];
  };
}

export function sameOriginVerificationUrl(baseUrl: URL, value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`Filesystem storage did not return a ${label} URL.`);
  const url = new URL(value, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new Error(`Filesystem storage returned a cross-origin ${label} URL. Refusing to send the verification session to ${url.origin}.`);
  }
  return url;
}

export function assertVerificationGrant(value: Record<string, unknown>, expectedMethod: 'GET' | 'PUT', label: string) {
  if (value.method !== undefined && value.method !== expectedMethod) {
    throw new Error(`Filesystem storage returned unexpected ${label} method ${String(value.method)}.`);
  }
  if (value.headers !== undefined && (!value.headers || typeof value.headers !== 'object' || Array.isArray(value.headers) || Object.keys(value.headers).length > 0)) {
    throw new Error(`Filesystem storage returned unexpected ${label} headers.`);
  }
}

export async function verifyPublicApplication(baseUrl: URL, credentials: { email: string; password: string }) {
  const root = await verificationFetch(baseUrl);
  if (root.status !== 200) throw new Error(`${baseUrl} returned HTTP ${root.status}; redirects are not accepted during verification.`);

  const health = validateVerificationHealth(await verificationJson(baseUrl, '/api/health?deep=true'));
  const { email, password } = credentials;
  const signIn = await verificationFetch(new URL('/api/basic-auth/sign-in', baseUrl), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: baseUrl.origin },
    body: JSON.stringify({ email, password }),
  });
  if (signIn.status !== 200) throw new Error(`Public Basic Auth sign-in returned HTTP ${signIn.status}.`);
  const responseHeaders = signIn.headers as { getSetCookie?: () => string[] };
  const setCookies = responseHeaders.getSetCookie?.() ?? [signIn.headers.get('set-cookie')].filter((value): value is string => Boolean(value));
  const cookie = setCookies.map((value) => value.split(';', 1)[0]).join('; ');
  if (!cookie) throw new Error('Public Basic Auth sign-in did not set a session cookie.');

  try {
    const session = await verificationJson(baseUrl, '/api/auth/session', { cookie });
    if (session.session?.user?.email !== email || !session.session.workspace?.id) {
      throw new Error('Public session hydration did not return the verification user and workspace.');
    }
    const workspaceId = String(session.session.workspace.id);
    const pull = await verificationJson(baseUrl, '/api/sync/pull', {
      cookie,
      body: { scope: { workspaceId }, cursor: 0, limit: 1, tables: ['messages'] },
    });
    if (!Array.isArray(pull.changes) || typeof pull.nextCursor !== 'number') {
      throw new Error('Public SQLite sync pull returned an invalid response.');
    }

    const probeBytes = Buffer.concat([
      Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'),
      randomBytes(8),
    ]);
    const hash = `sha256:${createHash('sha256').update(probeBytes).digest('hex')}`;
    let storageId: string | undefined;
    let metadataAttempted = false;
    let physicalCleanupDeferred = false;
    try {
      const presign = await verificationJson(baseUrl, '/api/storage/presign-upload', {
        cookie,
        body: {
          workspace_id: workspaceId,
          hash,
          mime_type: 'image/png',
          size_bytes: probeBytes.length,
          disposition: 'inline',
        },
      });
      storageId = typeof presign.storageId === 'string' && presign.storageId.trim() ? presign.storageId : undefined;
      if (!storageId) throw new Error('Filesystem storage did not return a non-empty storage ID.');
      assertVerificationGrant(presign, 'PUT', 'upload');
      const upload = await verificationFetch(sameOriginVerificationUrl(baseUrl, presign.url, 'upload'), {
        method: 'PUT',
        headers: { 'content-type': 'image/png', cookie },
        body: probeBytes,
      });
      if (!upload.ok) throw new Error(`Filesystem verification upload returned HTTP ${upload.status}.`);
      // Commit can create canonical metadata even if its response or the later sync fails.
      metadataAttempted = true;
      await verificationJson(baseUrl, '/api/storage/commit', {
        cookie,
        body: {
          workspace_id: workspaceId,
          hash,
          storage_id: storageId,
          storage_provider_id: 'fs',
          mime_type: 'image/png',
          size_bytes: probeBytes.length,
          name: 'or3-production-verification.png',
          kind: 'image',
        },
      });
      const metadataCreatedAt = Date.now();
      const metadataOpId = randomUUID();
      const pushed = await verificationJson(baseUrl, '/api/sync/push', {
        cookie,
        body: {
          scope: { workspaceId },
          ops: [{
            id: `or3-verification-${metadataOpId}`,
            tableName: 'file_meta',
            operation: 'put',
            pk: hash,
            payload: {
              hash,
              kind: 'image',
              mime_type: 'image/png',
              size_bytes: probeBytes.length,
              storage_id: storageId,
              name: 'or3-production-verification.png',
              deleted: false,
              created_at: metadataCreatedAt,
              updated_at: metadataCreatedAt,
              clock: metadataCreatedAt,
            },
            stamp: {
              deviceId: 'or3-cloud-verification',
              opId: metadataOpId,
              hlc: `${String(metadataCreatedAt).padStart(13, '0')}:0000:or3-cloud-verification`,
              clock: metadataCreatedAt,
            },
            createdAt: metadataCreatedAt,
            attempts: 0,
            status: 'pending',
          }],
        },
      });
      if (pushed.results?.[0]?.success !== true) {
        throw new Error(`Filesystem verification metadata sync failed: ${JSON.stringify(pushed)}`);
      }
      const downloadGrant = await verificationJson(baseUrl, '/api/storage/presign-download', {
        cookie,
        body: { workspace_id: workspaceId, hash, storage_id: storageId, disposition: 'attachment' },
      });
      assertVerificationGrant(downloadGrant, 'GET', 'download');
      const download = await verificationFetch(sameOriginVerificationUrl(baseUrl, downloadGrant.url, 'download'), { headers: { cookie } });
      if (!download.ok || !Buffer.from(await download.arrayBuffer()).equals(probeBytes)) {
        throw new Error('Filesystem verification download did not match the uploaded probe.');
      }
    } finally {
      if (storageId) {
        // Canonical tombstoning must succeed before requesting any physical deletion.
        if (metadataAttempted) {
          const metadataDeleteAt = Date.now();
          const metadataDeleteOpId = randomUUID();
          const deleted = await verificationJson(baseUrl, '/api/sync/push', {
            cookie,
            body: {
              scope: { workspaceId },
              ops: [{
                id: `or3-verification-${metadataDeleteOpId}`,
                tableName: 'file_meta',
                operation: 'delete',
                pk: hash,
                payload: { hash },
                stamp: {
                  deviceId: 'or3-cloud-verification',
                  opId: metadataDeleteOpId,
                  hlc: `${String(metadataDeleteAt).padStart(13, '0')}:0000:or3-cloud-verification`,
                  clock: metadataDeleteAt,
                },
                createdAt: metadataDeleteAt,
                attempts: 0,
                status: 'pending',
              }],
            },
          });
          if (deleted.results?.[0]?.success !== true) {
            throw new Error(`Filesystem verification metadata cleanup failed: ${JSON.stringify(deleted)}`);
          }
        }
        const deletion = await verificationJson(baseUrl, '/api/storage/delete', {
          cookie,
          body: { workspace_id: workspaceId, hash, storage_id: storageId },
          allowStorageDeletionDeferral: true,
        });
        physicalCleanupDeferred = deletion.deletionDeferred === true;
      }
    }
    return { ...health, physicalCleanupDeferred };
  } finally {
    await verificationJson(baseUrl, '/api/basic-auth/sign-out', {
      cookie,
      method: 'POST',
    });
  }
}

function responseCookie(response: Response, label: string) {
  const headers = response.headers as { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [response.headers.get('set-cookie')].filter((value): value is string => Boolean(value));
  const cookie = values.map((value) => value.split(';', 1)[0]).join('; ');
  if (!cookie) throw new Error(`${label} did not set a session cookie.`);
  return cookie;
}

async function provisionManagedCredentialsOnce(
  baseUrl: URL,
  email: string,
  password: string,
  adminUsername = email,
  adminPassword = password,
) {
  const appSignIn = await verificationFetch(new URL('/api/basic-auth/sign-in', baseUrl), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: baseUrl.origin },
    body: JSON.stringify({ email, password }),
  });
  if (appSignIn.status !== 200) throw new Error(`Managed owner provisioning returned HTTP ${appSignIn.status}.`);
  const appCookie = responseCookie(appSignIn, 'Managed owner provisioning');
  try {
    const session = await verificationJson(baseUrl, '/api/auth/session', { cookie: appCookie });
    if (session.session?.user?.email !== email || !session.session.workspace?.id) {
      throw new Error('Managed owner provisioning did not create the expected account and workspace.');
    }
  } finally {
    await verificationJson(baseUrl, '/api/basic-auth/sign-out', { cookie: appCookie, method: 'POST' });
  }

  const adminSignIn = await verificationFetch(new URL('/api/admin/auth/login', baseUrl), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: baseUrl.origin },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  if (adminSignIn.status !== 200) throw new Error(`Managed admin provisioning returned HTTP ${adminSignIn.status}.`);
  const adminCookie = responseCookie(adminSignIn, 'Managed admin provisioning');
  await verificationJson(baseUrl, '/api/admin/auth/logout', { cookie: adminCookie, method: 'POST' });
}

export async function provisionManagedCredentials(
  baseUrl: URL,
  email: string,
  password: string,
  adminUsername = email,
  adminPassword = password,
) {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  do {
    try {
      await provisionManagedCredentialsOnce(baseUrl, email, password, adminUsername, adminPassword);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
  } while (Date.now() < deadline);
  throw new Error(`Managed credential provisioning did not become ready within 60 seconds: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
