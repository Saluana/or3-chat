/**
 * Builds the Node script executed inside the or3 container for `credentials reset`.
 *
 * Schema contract (or3-provider-basic-auth, session-store.ts):
 * - basic_auth_accounts: password_hash, token_version, updated_at; email unique.
 * - basic_auth_sessions: revoked_at, rotation_grace_until, rotation_grace_refresh_token;
 *   account lookup by email, sessions keyed by account_id.
 * The script mirrors updatePasswordAndRevokeSessions: it bumps token_version
 * (invalidates every outstanding refresh token, verified at refresh time) and
 * revokes all sessions for the owner account, clearing rotation grace tokens.
 * Admin credentials are re-hashed into /data/admin/admin-credentials.json
 * (bootstrapAdminCredentialsFromEnv only imports env credentials once, so the
 * file must be rewritten in place), preserving created_at.
 * Admin JWT session cookies are invalidated by rotating OR3_ADMIN_JWT_SECRET
 * in .env at restart; admin auth is per-request (no persistent session table).
 * The script fails hard with a plain-language message if better-sqlite3 or
 * bcryptjs cannot be required, and restores the admin credentials file if the
 * database update fails, so no partial state survives.
 */
export function buildCredentialsResetScript(input: {
  ownerEmail: string;
  ownerPassword: string;
  adminUsername: string;
  adminPassword: string;
  authDbPath?: string;
  adminCredentialsPath?: string;
}) {
  const authDbPath = input.authDbPath ?? '/data/auth.sqlite';
  const adminCredentialsPath = input.adminCredentialsPath ?? '/data/admin/admin-credentials.json';
  return `const fs = require('fs');
const path = require('path');
const candidates = [process.cwd(), '/app'];
const resolveModule = (name) => {
  for (const root of candidates) {
    const resolved = path.join(root, '.output/server/node_modules', name);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
};
let Database;
try {
  const betterSqlite3Path = resolveModule('better-sqlite3');
  if (!betterSqlite3Path) throw new Error('better-sqlite3 directory not found');
  Database = require(betterSqlite3Path);
} catch (error) {
  console.error('OR3 credentials reset failed: better-sqlite3 is not available in this image, so the auth database could not be updated. Nothing was changed. Update the OR3 image to a release that bundles it, then retry.');
  process.exit(1);
}
let bcrypt;
try {
  // bcryptjs 2.x ships a broken "exports" map (require -> missing umd/index.js),
  // so it must be loaded by explicit absolute path, like the server bundle does.
  const bcryptPath = resolveModule('bcryptjs/index.js');
  if (!bcryptPath) throw new Error('bcryptjs directory not found');
  bcrypt = require(bcryptPath);
} catch (error) {
  console.error('OR3 credentials reset failed: bcryptjs is not available in this image, so new password hashes could not be computed. Nothing was changed. Update the OR3 image to a release that bundles it, then retry.');
  process.exit(1);
}
const ownerEmail = process.env.OR3_RESET_OWNER_EMAIL;
const ownerPassword = process.env.OR3_RESET_OWNER_PASSWORD;
const adminUsername = process.env.OR3_RESET_ADMIN_USERNAME;
const adminPassword = process.env.OR3_RESET_ADMIN_PASSWORD;
if (!ownerEmail || !ownerPassword || !adminUsername || !adminPassword) {
  console.error('OR3 credentials reset failed: required environment values were not supplied to the reset script. Nothing was changed.');
  process.exit(1);
}
const ownerHash = bcrypt.hashSync(ownerPassword, 12);
const adminHash = bcrypt.hashSync(adminPassword, 12);
const now = Date.now();
const db = new Database(${JSON.stringify(authDbPath)});
db.pragma('busy_timeout = 10000');
const account = db.prepare('SELECT id FROM basic_auth_accounts WHERE email = ?').get(ownerEmail);
if (!account) {
  console.error('OR3 credentials reset failed: no Basic Auth account matches OR3_BASIC_AUTH_BOOTSTRAP_EMAIL. Nothing was changed.');
  process.exit(1);
}
const adminCredentialsPath = ${JSON.stringify(adminCredentialsPath)};
const previousCredentials = (() => {
  try { return fs.readFileSync(adminCredentialsPath, 'utf8'); } catch { return null; }
})();
let credentials;
try {
  credentials = previousCredentials ? JSON.parse(previousCredentials) : { created_at: new Date().toISOString() };
} catch (error) {
  console.error('OR3 credentials reset failed: the admin credentials file is corrupt. Nothing was changed.');
  process.exit(1);
}
credentials.username = adminUsername;
credentials.password_hash_bcrypt = adminHash;
credentials.updated_at = new Date().toISOString();
const atomicWrite = (target, contents) => {
  const temporary = target + '.reset-' + process.pid + '-' + Date.now();
  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, target);
  const directory = fs.openSync(path.dirname(target), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
};
try {
  db.transaction(() => {
    db.prepare('UPDATE basic_auth_accounts SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?').run(ownerHash, now, account.id);
    db.prepare('UPDATE basic_auth_sessions SET revoked_at = COALESCE(revoked_at, ?), rotation_grace_until = NULL, rotation_grace_refresh_token = NULL WHERE account_id = ?').run(now, account.id);
    atomicWrite(adminCredentialsPath, JSON.stringify(credentials, null, 2) + '\\n');
  })();
} catch (error) {
  if (previousCredentials !== null) {
    try { atomicWrite(adminCredentialsPath, previousCredentials); } catch {}
  } else {
    try { fs.rmSync(adminCredentialsPath, { force: true }); } catch {}
  }
  console.error('OR3 credentials reset failed: the atomic database/file update did not complete. Replay is safe through the managed recovery journal. ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
}
db.close();
console.log('credentials-reset: owner hash, sessions, and admin credentials updated.');
`;
}

export const CREDENTIALS_VERIFY_SCRIPT = `
const request = async (path, body) => {
  const response = await fetch('http://127.0.0.1:3000' + path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(path + ' returned HTTP ' + response.status);
};
Promise.all([
  request('/api/basic-auth/sign-in', { email: process.env.OR3_RESET_OWNER_EMAIL, password: process.env.OR3_RESET_OWNER_PASSWORD }),
  request('/api/admin/auth/login', { username: process.env.OR3_RESET_ADMIN_USERNAME, password: process.env.OR3_RESET_ADMIN_PASSWORD }),
]).catch((error) => { console.error('Credential verification failed: ' + error.message); process.exit(1); });
`;
