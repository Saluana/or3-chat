# Code Review: Admin Dashboard Refactor

**Branch:** `admin-dashboard-refactor`  
**Review Date:** 2026-01-29  
**Reviewer:** Stack Overflow Elite Engineer Neckbeard  

---

## Issue 1: Debug Logging Left in Production Code

**File:** `server/admin/auth/jwt.ts`  
**Lines:** 85-103

```typescript
export async function verifyAdminJwt(
    event: H3Event,
    token: string
): Promise<AdminJwtClaims | null> {
    const secret = await getJwtSecret(event);
    console.log('[admin:verifyAdminJwt] Token length:', token.length);
    console.log('[admin:verifyAdminJwt] Secret length:', secret.length);

    try {
        const decoded = jwt.verify(token, secret, {
            algorithms: ['HS256'],
        }) as AdminJwtClaims;

        // Validate the claims structure
        if (decoded.kind !== 'super_admin' || !decoded.username) {
            console.log('[admin:verifyAdminJwt] Invalid claims structure:', decoded);
            return null;
        }

        console.log('[admin:verifyAdminJwt] Token verified successfully for:', decoded.username);
        return decoded;
    } catch (err) {
        console.log('[admin:verifyAdminJwt] Token verification failed:', err instanceof Error ? err.message : String(err));
        return null;
    }
}
```

**Why this is bad:**
You've left 5 `console.log` statements in JWT verification code. This is a security-sensitive authentication path, and you're logging token lengths and usernames to stdout. In production, this creates log noise, potentially leaks sensitive info (token lengths can be used for timing attacks), and shows you don't understand the difference between development debugging and production code.

**Real-world consequences:**
- Log spam in production
- Potential security info leakage
- Performance hit from unnecessary I/O on every auth check
- Looks amateurish

**Fix:**
Remove all debug logging or replace with a proper logger that respects log levels:
```typescript
export async function verifyAdminJwt(
    event: H3Event,
    token: string
): Promise<AdminJwtClaims | null> {
    const secret = await getJwtSecret(event);
    
    try {
        const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as AdminJwtClaims;
        
        if (decoded.kind !== 'super_admin' || !decoded.username) {
            return null;
        }
        
        return decoded;
    } catch {
        return null;
    }
}
```

---

## Issue 2: More Debug Logging in Cookie Handling

**File:** `server/admin/auth/jwt.ts`  
**Lines:** 131-148

```typescript
export async function getAdminFromCookie(
    event: H3Event
): Promise<AdminJwtClaims | null> {
    const token = getCookie(event, COOKIE_NAME);
    console.log('[admin:getAdminFromCookie] Path:', event.path);
    console.log('[admin:getAdminFromCookie] Cookie name:', COOKIE_NAME);
    console.log('[admin:getAdminFromCookie] Token found:', !!token);
    console.log('[admin:getAdminFromCookie] All cookies:', getCookie(event, COOKIE_NAME) ? 'present' : 'missing');

    if (!token) {
        console.log('[admin:getAdminFromCookie] No token found, returning null');
        return null;
    }

    const result = await verifyAdminJwt(event, token);
    console.log('[admin:getAdminFromCookie] Verification result:', result ? 'success' : 'failed');
    return result;
}
```

**Why this is bad:**
4 more `console.log` statements in the cookie retrieval path. You're logging request paths and cookie presence on EVERY request to admin routes. This is called on every authenticated request and you're doing 4-5 console logs each time.

**Real-world consequences:**
- Massive log spam (every admin request = 4-5 log lines)
- Path leakage in logs
- Unnecessary performance overhead

**Fix:**
Delete all of it. If you need debugging, use a proper logger with levels.

---

## Issue 3: Debug Logging in Login Handler

**File:** `server/api/admin/auth/login.post.ts`  
**Lines:** 119-126

```typescript
console.log('[admin:login] Cookie set successfully for user:', credentials.username);
console.log('[admin:login] Request path:', event.path);
console.log('[admin:login] Response headers:', event.node.res.getHeader('set-cookie'));

return {
    success: true,
    username: credentials.username,
};
```

**Why this is bad:**
Logging the set-cookie header value in production? Really? You're literally logging the JWT token to the console. This is a security vulnerability - if someone has access to logs, they have admin access.

**Real-world consequences:**
- JWT tokens in logs = admin credentials in logs
- Compliance violations (GDPR, SOC2, etc.)
- If logs are shipped to a third party, you've leaked admin credentials

**Fix:**
```typescript
return {
    success: true,
    username: credentials.username,
};
```

---

## Issue 4: Debug Logging in Admin Gate Middleware

**File:** `server/middleware/admin-gate.ts`  
**Lines:** 70-87

```typescript
// Require admin authentication for all other admin paths
console.log('[admin-gate] Resolving admin context for:', event.path);
const adminContext = await resolveAdminRequestContext(event);
console.log('[admin-gate] Admin context resolved:', adminContext ? `kind=${adminContext.principal.kind}` : 'null');

if (!adminContext) {
    // Redirect to login page for UI routes, 401 for API routes
    console.log('[admin-gate] No admin context, returning 401/redirect');
    ...
}

// Store admin context in event for downstream use
event.context.admin = adminContext;
console.log('[admin-gate] Admin context stored in event.context.admin');
```

**Why this is bad:**
3 more debug logs in the authentication gate. This runs on EVERY admin request. You're logging paths and auth status. Combined with the previous issues, every single admin request generates 10+ log lines.

**Real-world consequences:**
- Log storage costs explode
- Makes finding real issues impossible
- Path enumeration in logs

**Fix:**
Remove all console.log statements from production auth code.

---

## Issue 5: Debug Logging in Cookie Clearing

**File:** `server/admin/auth/jwt.ts`  
**Lines:** 153-163

```typescript
export function clearAdminCookie(event: H3Event): void {
    console.log('[admin:clearAdminCookie] Clearing cookie:', COOKIE_NAME, 'with path:', COOKIE_PATH);
    deleteCookie(event, COOKIE_NAME, {
        path: COOKIE_PATH,
    });
    // Clear legacy cookie path (/admin) from earlier versions
    deleteCookie(event, COOKIE_NAME, {
        path: '/admin',
    });
    console.log('[admin:clearAdminCookie] Cookie cleared (/, /admin)');
}
```

**Why this is bad:**
Logging on logout. This is the 6th file with debug logging. You clearly don't have a code review process or you ignored it.

**Fix:**
Delete the console.logs.

---

## Issue 6: In-Memory Rate Limiting is a Joke

**File:** `server/admin/auth/rate-limit.ts`

```typescript
// In-memory storage: Map<key, RateLimitEntry>
const rateLimitStore = new Map<string, RateLimitEntry>();
```

**Why this is bad:**
You're using an in-memory Map for rate limiting in what appears to be a production admin auth system. This means:
1. Rate limits don't work across server instances (if you scale horizontally)
2. Rate limits reset on every server restart
3. Memory grows unbounded as you accumulate entries for different IPs/usernames
4. No TTL/cleanup mechanism - old entries stay in memory forever

**Real-world consequences:**
- Attacker can bypass rate limits by hitting different server instances
- Server memory grows over time until OOM
- Restarting the server resets all rate limits (attacker gets 5 more attempts)
- Not actually protecting against brute force attacks in a real deployment

**Fix:**
Use Redis or at least implement proper cleanup:
```typescript
// Add periodic cleanup
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
        if (now - entry.windowStart > WINDOW_MS) {
            rateLimitStore.delete(key);
        }
    }
}, WINDOW_MS);
```

Better yet, use the existing rate_limits table in Convex that I see in the schema.

---

## Issue 7: Import at the Bottom of the File

**File:** `server/admin/auth/rate-limit.ts`  
**Lines:** 129-131

```typescript
// Import for headers
import { getRequestHeaders } from 'h3';
```

**Why this is bad:**
You put an import statement at the BOTTOM of the file. This works in some module systems but is non-standard, confusing, and breaks in certain bundlers. It's also 100+ lines away from where it's used (line 121).

**Real-world consequences:**
- Confuses other developers
- May break in certain build configurations
- Shows lack of attention to detail

**Fix:**
Move the import to the top of the file where it belongs.

---

## Issue 8: Silent Failures in File Operations

**File:** `server/admin/auth/credentials.ts`  
**Lines:** 23-29

```typescript
async function ensureDataDir(): Promise<void> {
    try {
        await mkdir(DATA_DIR, { mode: 0o700, recursive: true });
    } catch {
        // Directory may already exist
    }
}
```

**Why this is bad:**
You're swallowing ALL errors, not just "directory already exists". If mkdir fails due to permissions, disk full, or any other reason, you silently continue. Then later when you try to write the credentials file, it fails mysteriously.

**Real-world consequences:**
- Hard to debug permission issues
- Credentials file creation fails with confusing errors
- Security issue: if mkdir fails due to permissions, you might write to wrong location

**Fix:**
```typescript
async function ensureDataDir(): Promise<void> {
    try {
        await mkdir(DATA_DIR, { mode: 0o700, recursive: true });
    } catch (err: any) {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    }
}
```

---

## Issue 9: Silent Failures in Credentials Reading

**File:** `server/admin/auth/credentials.ts`  
**Lines:** 47-54

```typescript
export async function readAdminCredentials(): Promise<AdminCredentialsFile | null> {
    try {
        const content = await readFile(CREDENTIALS_FILE, 'utf-8');
        return JSON.parse(content) as AdminCredentialsFile;
    } catch {
        return null;
    }
}
```

**Why this is bad:**
Same problem - you're swallowing ALL errors. If the file exists but has bad permissions, corrupted data, or JSON parse errors, you return null. This makes debugging impossible.

**Real-world consequences:**
- Corrupted credentials file = silent failure
- Permission issues = silent failure  
- Invalid JSON = silent failure
- Admin can't log in and has no idea why

**Fix:**
```typescript
export async function readAdminCredentials(): Promise<AdminCredentialsFile | null> {
    try {
        const content = await readFile(CREDENTIALS_FILE, 'utf-8');
        return JSON.parse(content) as AdminCredentialsFile;
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            return null; // File doesn't exist - expected
        }
        throw err; // Re-throw unexpected errors
    }
}
```

---

## Issue 10: Global Module-Level Cache Without Cleanup

**File:** `server/admin/stores/registry.ts`  
**Lines:** 16-18

```typescript
let cachedCapabilities: AdminStoreCapabilities | null = null;
let cachedProviderId: string | null = null;
```

**Why this is bad:**
You're using module-level variables to cache capabilities. This means:
1. Cache persists across requests (good)
2. Cache is never invalidated when config changes (bad)
3. If you have multiple sync providers in tests, they interfere with each other
4. No TTL or cleanup mechanism

**Real-world consequences:**
- Changing sync provider requires server restart
- Tests can interfere with each other
- Memory leak if capabilities object is large

**Fix:**
Add a TTL or use a proper cache:
```typescript
let cachedCapabilities: AdminStoreCapabilities | null = null;
let cachedProviderId: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

export function getAdminStoreCapabilities(event?: H3Event): AdminStoreCapabilities {
    const config = useRuntimeConfig(event);
    const provider = config.sync.provider as string | undefined;
    const now = Date.now();

    // Return cached capabilities if valid and provider hasn't changed
    if (cachedCapabilities && 
        cachedProviderId === provider && 
        now - cacheTimestamp < CACHE_TTL_MS) {
        return cachedCapabilities;
    }

    const capabilities = getCapabilitiesForProvider(provider);
    cachedCapabilities = capabilities;
    cachedProviderId = provider || null;
    cacheTimestamp = now;

    return capabilities;
}
```

---

## Issue 11: Same Global Cache Pattern in deployment-admin.ts

**File:** `server/auth/deployment-admin.ts`  
**Lines:** 21-23

```typescript
let cachedChecker: DeploymentAdminChecker | null = null;
let cachedProviderId: string | null = null;
```

**Why this is bad:**
You copy-pasted the same flawed caching pattern from the registry. Same issues - no TTL, no invalidation, test interference.

**Fix:**
Apply the same fix as Issue 10, or better yet, extract a reusable caching utility.

---

## Issue 12: Type Assertion Abuse

**File:** `server/admin/stores/convex/convex-store.ts`  
**Lines:** 29-109 (multiple instances)

```typescript
return {
    async listMembers({ workspaceId }) {
        const client = await getConvexClientWithAuth(event);
        return await client.query(api.admin.listWorkspaceMembers, {
            workspace_id: workspaceId as Id<'workspaces'>,
        });
    },
    // ... 8 more methods with the same pattern
}
```

**Why this is bad:**
You're using type assertions (`as Id<'workspaces'>`) everywhere instead of proper type safety. This is a code smell that indicates your type boundaries are wrong. If the string isn't actually a valid Convex ID, you're just lying to the compiler.

**Real-world consequences:**
- Runtime errors that TypeScript can't catch
- Harder refactoring
- Technical debt accumulates

**Fix:**
Define proper types at the API boundary:
```typescript
// In types.ts or similar
export type WorkspaceId = string & { __brand: 'WorkspaceId' };

// Then use branded types instead of raw strings
async listMembers({ workspaceId }: { workspaceId: WorkspaceId }) {
    const client = await getConvexClientWithAuth(event);
    return await client.query(api.admin.listWorkspaceMembers, {
        workspace_id: workspaceId, // No assertion needed
    });
}
```

---

## Issue 13: N+1 Query Problem in listWorkspaces

**File:** `convex/admin.ts`  
**Lines:** 178-237

```typescript
export const listWorkspaces = query({
    args: { ... },
    handler: async (ctx, args) => {
        // Get all workspaces
        let workspaces = await ctx.db.query('workspaces').collect();

        // ... filtering ...

        // Paginate
        const paginated = workspaces.slice(skip, skip + per_page);

        // Get owner and member info
        const results = await Promise.all(
            paginated.map(async (workspace) => {
                const owner = await ctx.db.get(workspace.owner_user_id);
                const members = await ctx.db
                    .query('workspace_members')
                    .withIndex('by_workspace', (q) =>
                        q.eq('workspace_id', workspace._id)
                    )
                    .collect();

                return {
                    ...
                    ownerEmail: owner?.email,
                    memberCount: members.length,
                };
            })
        );

        return { items: results, total };
    },
});
```

**Why this is bad:**
For each workspace in the paginated list, you're making 2 additional database queries (owner + members). With 20 workspaces per page, that's 41 queries total (1 + 20*2). This is the classic N+1 problem.

**Real-world consequences:**
- Slow API responses
- Database load increases linearly with page size
- Bad user experience

**Fix:**
Use batched queries:
```typescript
const paginated = workspaces.slice(skip, skip + per_page);
const workspaceIds = paginated.map(w => w._id);
const ownerIds = paginated.map(w => w.owner_user_id);

// Batch fetch owners
const owners = await ctx.db.query('users')
    .filter(q => q.eq(q.field('_id'), q.any(ownerIds)))
    .collect();
const ownerMap = new Map(owners.map(o => [o._id, o]));

// Batch fetch members
const allMembers = await ctx.db.query('workspace_members')
    .filter(q => q.eq(q.field('workspace_id'), q.any(workspaceIds)))
    .collect();
const memberCounts = new Map();
for (const m of allMembers) {
    memberCounts.set(m.workspace_id, (memberCounts.get(m.workspace_id) || 0) + 1);
}

// Now map without additional queries
const results = paginated.map(workspace => ({
    ...
    ownerEmail: ownerMap.get(workspace.owner_user_id)?.email,
    memberCount: memberCounts.get(workspace._id) || 0,
}));
```

---

## Issue 14: Inefficient User Search

**File:** `convex/admin.ts`  
**Lines:** 138-168

```typescript
export const searchUsers = query({
    args: { query: v.string(), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 20;
        const searchTerm = args.query.toLowerCase().trim();

        if (!searchTerm) {
            return [];
        }

        // Get all users and filter (in production, use full-text search)
        const allUsers = await ctx.db.query('users').take(limit * 2);

        const matching = allUsers
            .filter(
                (user) =>
                    user.email?.toLowerCase().includes(searchTerm) ||
                    user.display_name?.toLowerCase().includes(searchTerm)
            )
            .slice(0, limit);

        return matching.map((user) => ({
            userId: user._id,
            email: user.email,
            displayName: user.display_name,
        }));
    },
});
```

**Why this is bad:**
You're loading `limit * 2` users into memory and doing client-side filtering. The comment even admits "in production, use full-text search". This is a TODO in production code. With 10,000 users and limit=20, you're loading 40 records to return 20.

**Real-world consequences:**
- Slow search with many users
- Memory pressure on Convex
- Bad user experience

**Fix:**
Add a search index or use Convex's built-in search:
```typescript
// Add index to schema
users: defineTable({
    email: v.optional(v.string()),
    display_name: v.optional(v.string()),
    ...
}).index('by_email', ['email'])
 .index('by_display_name', ['display_name']),

// Then query with index
const byEmail = await ctx.db.query('users')
    .withIndex('by_email', q => q.gte('email', searchTerm).lt('email', searchTerm + '\xff'))
    .take(limit);
```

---

## Issue 15: Missing Authorization Checks in Convex Functions

**File:** `convex/admin.ts`  
**Lines:** 47-67 (listAdmins), 73-106 (grantAdmin), 111-132 (revokeAdmin)

```typescript
export const listAdmins = query({
    args: {},
    handler: async (ctx) => {
        // Note: In production, this should check if the caller is an admin
        // For now, we rely on the server-side authorization
        const admins = await ctx.db.query('admin_users').collect();
        ...
    },
});
```

**Why this is bad:**
You have comments saying "In production, this should check if the caller is an admin" but you didn't implement it. This is a security vulnerability - anyone can call these Convex functions directly from the client if they bypass your SSR layer.

**Real-world consequences:**
- Anyone can list all admin users
- Anyone can grant themselves admin access
- Anyone can revoke admin access from others
- Complete admin system bypass

**Fix:**
Add authorization checks:
```typescript
export const listAdmins = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error('Not authenticated');
        }
        
        // Check if caller is admin
        const callerAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', q => 
                q.eq('provider', 'clerk').eq('provider_user_id', identity.subject)
            )
            .first();
            
        if (!callerAccount) {
            throw new Error('Unauthorized');
        }
        
        const isCallerAdmin = await ctx.db
            .query('admin_users')
            .withIndex('by_user', q => q.eq('user_id', callerAccount.user_id))
            .first();
            
        if (!isCallerAdmin) {
            throw new Error('Forbidden: Admin access required');
        }
        
        // Now safe to proceed
        const admins = await ctx.db.query('admin_users').collect();
        ...
    },
});
```

---

## Issue 16: Method Not Allowed Check is Redundant

**File:** `server/api/admin/auth/login.post.ts`  
**Lines:** 39-45

```typescript
// Only POST allowed
if (event.method !== 'POST') {
    throw createError({
        statusCode: 405,
        statusMessage: 'Method Not Allowed',
    });
}
```

**Why this is bad:**
The file is literally named `login.post.ts`. Nuxt/Nitro automatically routes based on HTTP method. This check will never trigger because a GET request to `/api/admin/auth/login` won't even hit this handler.

**Real-world consequences:**
- Dead code
- Confusion about how the framework works

**Fix:**
Delete this entire block. The framework handles HTTP method routing.

---

## Issue 17: Same Redundant Method Check in change-password.post.ts

**File:** `server/api/admin/auth/change-password.post.ts`  
**Lines:** 36-42

```typescript
// Only POST allowed
if (event.method !== 'POST') {
    throw createError({
        statusCode: 405,
        statusMessage: 'Method Not Allowed',
    });
}
```

**Why this is bad:**
Same issue as #16. File is named `change-password.post.ts`, the check is redundant.

**Fix:**
Delete it.

---

## Issue 18: Hardcoded Cookie Max Age

**File:** `server/admin/auth/jwt.ts`  
**Lines:** 117-124

```typescript
setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.security?.forceHttps ?? process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: COOKIE_PATH,
    // Max age is handled by JWT expiry, but we set a cookie maxAge too
    maxAge: 60 * 60 * 24, // 1 day default
});
```

**Why this is bad:**
You have `OR3_ADMIN_JWT_EXPIRY` in the config, but you're hardcoding the cookie maxAge to 1 day. If someone sets `OR3_ADMIN_JWT_EXPIRY=7d`, the JWT is valid for 7 days but the cookie expires in 1 day. These should match.

**Real-world consequences:**
- Confusing behavior where JWT is valid but cookie is gone
- Users mysteriously logged out before JWT expires

**Fix:**
```typescript
const expiry = config.admin?.auth?.jwtExpiry || '24h';
const maxAgeSeconds = parseExpiryToSeconds(expiry);

setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.security?.forceHttps ?? process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: maxAgeSeconds,
});
```

---

## Issue 19: Cookie Path Mismatch

**File:** `server/admin/auth/jwt.ts`  
**Lines:** 9-10

```typescript
const COOKIE_NAME = 'or3_admin';
const COOKIE_PATH = '/';
```

**Why this is bad:**
The design doc says "cookie scoped to `/admin`" but you're setting it to `/`. This means the admin cookie is sent with EVERY request to the entire domain, not just admin routes. Combined with the JWT in the cookie, you're exposing admin credentials on every request.

**Real-world consequences:**
- Admin JWT sent with every request (performance overhead)
- Increased attack surface
- Violates principle of least privilege

**Fix:**
```typescript
const COOKIE_PATH = '/admin';
```

---

## Issue 20: Client-Side Cookie Manipulation

**File:** `app/layouts/admin.vue`  
**Lines:** 350

```typescript
// Force clear the cookie client-side as well
document.cookie = 'or3_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
```

**Why this is bad:**
You're trying to clear a httpOnly cookie from client-side JavaScript. httpOnly cookies CANNOT be accessed or modified by JavaScript - that's the whole point of httpOnly. This line does nothing but confuse developers into thinking the cookie is cleared.

**Real-world consequences:**
- Cookie not actually cleared
- False sense of security
- Confusing code

**Fix:**
Remove this line. The server-side logout endpoint should clear the cookie, and since it's httpOnly, that's the only way to clear it.

---

## Issue 21: Magic Numbers in Pagination

**File:** `server/api/admin/search-users.get.ts`  
**Lines:** 24-25

```typescript
const limit = Math.min(50, Math.max(1, parseInt(query.limit?.toString() || '20', 10)));
```

**Why this is bad:**
Magic numbers (50, 1, 20) with no explanation. What are these limits? Why 50? Why not 100? Why default to 20?

**Real-world consequences:**
- Hard to understand intent
- Hard to change consistently
- Technical debt

**Fix:**
```typescript
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const MIN_SEARCH_LIMIT = 1;

const limit = Math.min(
    MAX_SEARCH_LIMIT, 
    Math.max(MIN_SEARCH_LIMIT, parseInt(query.limit?.toString() || String(DEFAULT_SEARCH_LIMIT), 10))
);
```

---

## Issue 22: No Input Validation on Workspace Creation

**File:** `server/api/admin/workspaces.post.ts`  
**Lines:** 30-46

```typescript
const body = await readBody<CreateWorkspaceBody>(event);
const { name, description, ownerUserId } = body;

// Validate input
if (!name || !name.trim()) {
    throw createError({
        statusCode: 400,
        statusMessage: 'Workspace name is required',
    });
}

if (!ownerUserId) {
    throw createError({
        statusCode: 400,
        statusMessage: 'Owner user ID is required',
    });
}
```

**Why this is bad:**
You're validating that ownerUserId exists but not that it's a valid Convex ID format. You're also not validating the length of the name or description. Someone could create a workspace with a 1MB name.

**Real-world consequences:**
- Database bloat
- UI breakage with long names
- Potential DoS via large payloads

**Fix:**
```typescript
if (!name || !name.trim() || name.length > 100) {
    throw createError({
        statusCode: 400,
        statusMessage: 'Workspace name is required and must be under 100 characters',
    });
}

if (description && description.length > 1000) {
    throw createError({
        statusCode: 400,
        statusMessage: 'Description must be under 1000 characters',
    });
}

// Validate Convex ID format (starts with specific pattern)
if (!ownerUserId || !/^users:[a-zA-Z0-9_-]+$/.test(ownerUserId)) {
    throw createError({
        statusCode: 400,
        statusMessage: 'Valid owner user ID is required',
    });
}
```

---

## Issue 23: Duplicate Interface Definitions

**File:** `app/pages/admin/workspaces/index.vue`  
**Lines:** 147-161

```typescript
interface Workspace {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    deleted: boolean;
    deletedAt?: number;
    ownerUserId?: string;
    ownerEmail?: string;
    memberCount: number;
}
```

**Why this is bad:**
This interface is defined in multiple places (here, in `server/admin/stores/types.ts`, and probably elsewhere). When the API changes, you have to update it in N places. This is a maintenance nightmare.

**Real-world consequences:**
- Type drift between client and server
- Maintenance burden
- Bugs when types don't match

**Fix:**
Export the type from a shared location:
```typescript
// In types/admin.ts or similar
export interface WorkspaceSummary {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    deleted: boolean;
    deletedAt?: number;
    ownerUserId?: string;
    ownerEmail?: string;
    memberCount: number;
}

// Import in both client and server
import type { WorkspaceSummary } from '~/types/admin';
```

---

## Issue 24: Missing Error Handling in Workspace Detail

**File:** `app/pages/admin/workspaces/[id].vue`  
**Lines:** 164-187

```typescript
async function handleSoftDelete() {
    if (!confirm('Are you sure you want to delete this workspace?')) return;

    isDeleting.value = true;
    try {
        await $fetch(`/api/admin/workspaces/${workspaceId}/soft-delete`, {
            method: 'POST',
            credentials: 'include',
        });
        toast.add({
            title: 'Workspace deleted',
            color: 'success',
        });
        refresh();
    } catch (err: any) {
        toast.add({
            title: 'Failed to delete workspace',
            description: err?.data?.statusMessage || 'Unknown error',
            color: 'error',
        });
    } finally {
        isDeleting.value = false;
    }
}
```

**Why this is bad:**
You're showing a generic "Unknown error" message instead of handling specific error cases. If the workspace doesn't exist, if the user doesn't have permission, or if the server is down, the user gets the same message.

**Real-world consequences:**
- Poor user experience
- Harder to debug user issues
- Users can't tell if they should retry or give up

**Fix:**
```typescript
} catch (err: any) {
    const status = err?.statusCode || err?.status;
    const message = err?.data?.statusMessage || 'Unknown error';
    
    if (status === 404) {
        toast.add({
            title: 'Workspace not found',
            description: 'The workspace may have been deleted by another admin.',
            color: 'warning',
        });
        router.push('/admin/workspaces');
    } else if (status === 403) {
        toast.add({
            title: 'Permission denied',
            description: 'You do not have permission to delete this workspace.',
            color: 'error',
        });
    } else {
        toast.add({
            title: 'Failed to delete workspace',
            description: message,
            color: 'error',
        });
    }
}
```

---

## Issue 25: No Loading State for Page Navigation

**File:** `app/pages/admin/workspaces/index.vue`  
**Lines:** 100-108

```typescript
<UButton
    :to="`/admin/workspaces/${workspace.id}`"
    variant="ghost"
    color="neutral"
    icon="i-heroicons-arrow-right"
>
    View
</UButton>
```

**Why this is bad:**
You're using a plain NuxtLink (via UButton's `to` prop) for navigation. When the user clicks, there's no indication that anything is happening while the next page loads. On slow connections, users will think the click didn't work and click multiple times.

**Real-world consequences:**
- Poor perceived performance
- Double-clicks causing issues
- Users think the app is broken

**Fix:**
Use a click handler with loading state:
```typescript
const navigatingTo = ref<string | null>(null);

async function navigateToWorkspace(id: string) {
    navigatingTo.value = id;
    await navigateTo(`/admin/workspaces/${id}`);
    navigatingTo.value = null;
}

// In template
<UButton
    @click="navigateToWorkspace(workspace.id)"
    :loading="navigatingTo === workspace.id"
    variant="ghost"
    color="neutral"
    icon="i-heroicons-arrow-right"
>
    View
</UButton>
```

---

## Issue 26: Missing Accessibility on Confirm Dialog

**File:** `app/pages/admin/workspaces/[id].vue`  
**Lines:** 164-166

```typescript
async function handleSoftDelete() {
    if (!confirm('Are you sure you want to delete this workspace?')) return;
    ...
}
```

**Why this is bad:**
You're using the native `confirm()` dialog which:
1. Blocks the main thread
2. Can't be styled
3. Has poor accessibility (screen readers struggle with it)
4. Doesn't work well on mobile
5. Can't be customized with your app's design

**Real-world consequences:**
- Poor accessibility
- Bad mobile experience
- Inconsistent UI

**Fix:**
Use your existing ConfirmDialog component that I see imported in the layout:
```typescript
const { confirm } = useConfirm();

async function handleSoftDelete() {
    const confirmed = await confirm({
        title: 'Delete Workspace',
        message: 'Are you sure you want to delete this workspace? This action can be undone.',
        confirmText: 'Delete',
        danger: true,
    });
    
    if (!confirmed) return;
    ...
}
```

---

## Issue 27: Computed Property Abuse for Icons

**File:** `app/layouts/admin.vue`  
**Lines:** 371-388

```typescript
const navLinks = computed(() => {
    const base = [
        { label: 'Overview', to: '/admin', icon: useIcon('dashboard.home').value },
        { label: 'Workspaces', to: '/admin/workspaces', icon: useIcon('sidebar.user').value },
        { label: 'Plugins', to: '/admin/plugins', icon: useIcon('dashboard.plugins').value },
        { label: 'Themes', to: '/admin/themes', icon: useIcon('dashboard.settings').value },
        { label: 'System', to: '/admin/system', icon: useIcon('ui.settings').value },
    ];
    
    const pluginLinks = adminPages.value.map((page) => ({
        label: page.label,
        to: `/admin/extensions/${page.path ?? page.id}`,
        icon: useIcon('dashboard.plugins').value,
    }));
    
    return [...base, ...pluginLinks];
});
```

**Why this is bad:**
You're calling `useIcon()` inside a computed property. Composables should be called at the top level of setup functions, not inside computed properties. This works by accident but violates Vue composition API rules and can cause subtle reactivity bugs.

**Real-world consequences:**
- Subtle reactivity bugs
- Violates Vue best practices
- May break in future Vue versions

**Fix:**
```typescript
// At top level of setup
const homeIcon = useIcon('dashboard.home');
const userIcon = useIcon('sidebar.user');
const pluginsIcon = useIcon('dashboard.plugins');
const settingsIcon = useIcon('dashboard.settings');
const systemIcon = useIcon('ui.settings');

const navLinks = computed(() => {
    const base = [
        { label: 'Overview', to: '/admin', icon: homeIcon.value },
        { label: 'Workspaces', to: '/admin/workspaces', icon: userIcon.value },
        { label: 'Plugins', to: '/admin/plugins', icon: pluginsIcon.value },
        { label: 'Themes', to: '/admin/themes', icon: settingsIcon.value },
        { label: 'System', to: '/admin/system', icon: systemIcon.value },
    ];
    ...
});
```

---

## Issue 28: Direct DOM Manipulation in Vue

**File:** `app/layouts/admin.vue`  
**Lines:** 400-402, 406-408

```typescript
function toggleMobileMenu() {
    isMobileMenuOpen.value = !isMobileMenuOpen.value;
    // Prevent body scroll when menu is open
    if (import.meta.client) {
        document.body.style.overflow = isMobileMenuOpen.value ? 'hidden' : '';
    }
}
```

**Why this is bad:**
You're directly manipulating the DOM in a Vue component. Vue is supposed to manage the DOM. This bypasses Vue's reactivity system and can cause conflicts.

**Real-world consequences:**
- Vue and manual DOM manipulation can conflict
- Harder to test
- Side effects not tracked by Vue

**Fix:**
Use a Vue-friendly approach:
```typescript
// Use a body class binding in the template or a watcher
watch(isMobileMenuOpen, (isOpen) => {
    if (import.meta.client) {
        document.body.classList.toggle('overflow-hidden', isOpen);
    }
});
```

Or better yet, use a library like `body-scroll-lock` or a Vue-specific solution.

---

## Issue 29: Missing Cleanup in onUnmounted

**File:** `app/layouts/admin.vue`  
**Lines:** 422-426

```typescript
// Cleanup on unmount
onUnmounted(() => {
    if (import.meta.client) {
        document.body.style.overflow = '';
    }
});
```

**Why this is bad:**
You're cleaning up the body overflow style, but if the component unmounts while the menu is open, you're resetting overflow even if another component also set it. You should only reset it if YOU set it.

**Real-world consequences:**
- Can interfere with other components that manage body overflow
- Race conditions

**Fix:**
Track whether you modified it:
```typescript
const didModifyOverflow = ref(false);

watch(isMobileMenuOpen, (isOpen) => {
    if (import.meta.client) {
        if (isOpen && !didModifyOverflow.value) {
            document.body.style.overflow = 'hidden';
            didModifyOverflow.value = true;
        } else if (!isOpen && didModifyOverflow.value) {
            document.body.style.overflow = '';
            didModifyOverflow.value = false;
        }
    }
});

onUnmounted(() => {
    if (import.meta.client && didModifyOverflow.value) {
        document.body.style.overflow = '';
    }
});
```

---

## Issue 30: No Debouncing on Search Input

**File:** `app/pages/admin/admin-users.vue`  
**Lines:** 156, 172-196

```typescript
const searchQuery = ref('');

async function searchUsers() {
    if (!searchQuery.value.trim()) return;

    isSearching.value = true;
    try {
        const results = await $fetch<User[]>('/api/admin/search-users', {
            query: { q: searchQuery.value },
            credentials: 'include',
        });
        ...
    } finally {
        isSearching.value = false;
    }
}
```

**Why this is bad:**
You're calling the API on every keystroke without debouncing. If a user types "johnson" quickly, you make 7 API calls. 6 of them are wasted.

**Real-world consequences:**
- Wasted API calls
- Server load
- Race conditions (results coming back out of order)

**Fix:**
Use debounce:
```typescript
import { refDebounced } from '@vueuse/core';

const searchQuery = ref('');
const debouncedQuery = refDebounced(searchQuery, 300);

watch(debouncedQuery, (query) => {
    if (query.trim()) {
        searchUsers(query);
    }
});

async function searchUsers(query: string) {
    isSearching.value = true;
    try {
        const results = await $fetch<User[]>('/api/admin/search-users', {
            query: { q: query },
            credentials: 'include',
        });
        searchResults.value = results.map((user) => ({
            ...user,
            isAdmin: admins.value.some((a) => a.userId === user.userId),
        }));
    } catch (err: any) {
        toast.add({
            title: 'Search failed',
            description: err?.data?.statusMessage || 'Unknown error',
            color: 'error',
        });
    } finally {
        isSearching.value = false;
    }
}
```

---

## Issue 31: Inconsistent Error Message Pattern

**File:** Multiple files

**Pattern seen in:**
- `app/pages/admin/login.vue`: `err?.data?.statusMessage || 'Login failed'`
- `app/pages/admin/workspaces/create.vue`: `err?.data?.statusMessage || 'Unknown error'`
- `app/pages/admin/admin-users.vue`: `err?.data?.statusMessage || 'Unknown error'`

**Why this is bad:**
You're using the same error handling pattern copy-pasted everywhere with slight variations. If you need to change how errors are displayed, you have to update N files.

**Real-world consequences:**
- Inconsistent UX
- Maintenance burden
- Easy to miss spots when updating

**Fix:**
Create a composable:
```typescript
// composables/useApiError.ts
export function useApiError() {
    return {
        getMessage(err: any, fallback = 'An error occurred'): string {
            return err?.data?.statusMessage || err?.message || fallback;
        }
    };
}

// Usage
const { getMessage } = useApiError();

catch (err: any) {
    toast.add({
        title: 'Search failed',
        description: getMessage(err, 'Unable to search users'),
        color: 'error',
    });
}
```

---

## Issue 32: Magic String for Admin State Key

**File:** `app/composables/admin/useAdminWorkspaceContext.ts`  
**Lines:** 13

```typescript
const WORKSPACE_STATE_KEY = 'admin-selected-workspace';
```

**Why this is bad:**
You're using a hardcoded string for the state key. If you need to change it or use it elsewhere, you have to remember this exact string.

**Real-world consequences:**
- Hard to maintain
- Risk of typos
- No autocomplete

**Fix:**
Export the constant:
```typescript
export const ADMIN_WORKSPACE_STATE_KEY = 'admin-selected-workspace';

export function useAdminWorkspaceContext() {
    const selectedWorkspaceId = useState<string | null>(
        `${ADMIN_WORKSPACE_STATE_KEY}-id`,
        () => null
    );
    ...
}
```

---

## Issue 33: Duplicate State Management Pattern

**File:** `app/composables/admin/useAdminWorkspaceContext.ts`

```typescript
export function getSelectedWorkspaceId(): string | null {
    const id = useState<string | null>(`${WORKSPACE_STATE_KEY}-id`);
    return id.value;
}

export function setSelectedWorkspaceId(id: string) {
    const selectedId = useState<string | null>(`${WORKSPACE_STATE_KEY}-id`);
    selectedId.value = id;
}
```

**Why this is bad:**
These standalone functions break Vue's composition API rules. `useState` should only be called in setup functions or other composables, not in regular functions. These will create new state instances instead of accessing the existing one.

**Real-world consequences:**
- State not actually shared
- Bugs where changes don't reflect
- Violates Vue patterns

**Fix:**
Delete these functions. If you need to access state outside of setup, pass it as a parameter or use a proper state management solution like Pinia.

---

## Issue 34: No Retry Logic for Failed Requests

**File:** `app/composables/admin/useAdminData.ts`

```typescript
export function useAdminWorkspacesList() {
    return useFetch<{
        items: Array<{
            id: string;
            name: string;
            memberCount: number;
            ownerEmail?: string;
            deleted?: boolean;
        }>;
        total: number;
    }>('/api/admin/workspaces', {
        key: 'admin:workspaces:list',
        query: { perPage: '100' },
        ...adminFetchOptions,
        server: false,
    });
}
```

**Why this is bad:**
You're using `useFetch` with no retry logic. If the request fails due to a transient network error, it fails permanently until the user refreshes.

**Real-world consequences:**
- Poor user experience on flaky connections
- Users see errors that would resolve with a retry

**Fix:**
Add retry logic:
```typescript
export function useAdminWorkspacesList() {
    return useFetch<...>('/api/admin/workspaces', {
        key: 'admin:workspaces:list',
        query: { perPage: '100' },
        ...adminFetchOptions,
        server: false,
        retry: 3,
        retryDelay: 1000,
    });
}
```

---

## Issue 35: Missing Type Safety on Event Context

**File:** `server/middleware/admin-gate.ts`  
**Lines:** 85

```typescript
// Store admin context in event for downstream use
event.context.admin = adminContext;
```

**Why this is bad:**
You're attaching to `event.context` without extending the type definition. TypeScript doesn't know about this property, so you get no type safety when accessing it later.

**Real-world consequences:**
- No autocomplete
- No type checking
- Runtime errors that TypeScript could have caught

**Fix:**
Extend the H3EventContext type:
```typescript
// types/h3.d.ts
declare module 'h3' {
    interface H3EventContext {
        admin?: AdminRequestContext;
    }
}
```

---

## Issue 36: Inconsistent Permission Checking

**File:** `server/admin/api.ts`  
**Lines:** 34-109

The `requireAdminApi` function is deprecated but still contains complex logic that duplicates `requireAdminApiContext`. You're maintaining two code paths for the same thing.

**Why this is bad:**
Code duplication leads to bugs when one path is updated but not the other. The deprecated function still works, so developers might use it by accident.

**Real-world consequences:**
- Security holes when one path has a fix the other doesn't
- Confusion about which to use
- Technical debt

**Fix:**
Either:
1. Remove the deprecated function entirely
2. Or make it a thin wrapper that calls the new function

```typescript
/**
 * @deprecated Use requireAdminApiContext instead
 */
export async function requireAdminApi(
    event: H3Event,
    options: AdminApiOptions = {}
): Promise<SessionContext> {
    const context = await requireAdminApiContext(event, options);
    return context.session || {
        authenticated: true,
        provider: 'admin',
        providerUserId: context.principal.kind === 'super_admin' 
            ? context.principal.username 
            : context.principal.userId,
        user: {
            id: context.principal.kind === 'super_admin' 
                ? context.principal.username 
                : context.principal.userId,
            email: undefined,
            displayName: context.principal.kind === 'super_admin'
                ? `Super Admin: ${context.principal.username}`
                : undefined,
        },
        role: 'owner',
        deploymentAdmin: true,
    };
}
```

---

## Issue 37: No Rate Limiting on Admin API Endpoints

**File:** `server/api/admin/workspaces.post.ts`, `server/api/admin/workspaces/[id].get.ts`, etc.

**Why this is bad:**
Only the login endpoint has rate limiting. The other admin endpoints (create workspace, delete workspace, list workspaces) have no rate limiting. An attacker could spam these endpoints.

**Real-world consequences:**
- DoS attacks
- Database overload
- Cost overruns

**Fix:**
Add rate limiting to all admin endpoints:
```typescript
import { checkRateLimit, getClientIp } from '../../../admin/auth/rate-limit';

export default defineEventHandler(async (event) => {
    // Rate limit check
    const clientIp = getClientIp(event);
    const rateLimit = checkRateLimit(clientIp, 'admin-api');
    
    if (!rateLimit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many requests',
        });
    }
    
    // ... rest of handler
});
```

---

## Issue 38: Hardcoded Provider Assumptions

**File:** `server/admin/stores/convex/convex-store.ts`  
**Lines:** 18-27

```typescript
async function getConvexClientWithAuth(event: H3Event) {
    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Missing provider token',
        });
    }
    return getConvexGatewayClient(event, token);
}
```

**Why this is bad:**
You're hardcoding Clerk as the auth provider. If someone configures a different auth provider, this will fail mysteriously. The error message says "Missing provider token" but doesn't say WHICH provider or why.

**Real-world consequences:**
- Doesn't work with non-Clerk auth
- Confusing error messages
- Not provider-agnostic as claimed

**Fix:**
Make it provider-agnostic or at least provide better errors:
```typescript
async function getConvexClientWithAuth(event: H3Event) {
    const config = useRuntimeConfig(event);
    const authProvider = config.auth?.provider;
    
    if (authProvider !== 'clerk') {
        throw createError({
            statusCode: 501,
            statusMessage: `Admin dashboard requires Clerk auth provider. Current: ${authProvider}`,
        });
    }
    
    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Missing Clerk authentication token',
        });
    }
    return getConvexGatewayClient(event, token);
}
```

---

## Issue 39: Missing Transaction Support in Workspace Creation

**File:** `convex/admin.ts`  
**Lines:** 278-318

```typescript
export const createWorkspace = mutation({
    args: { ... },
    handler: async (ctx, args) => {
        // Verify owner exists
        const owner = await ctx.db.get(args.owner_user_id);
        if (!owner) {
            throw new Error('Owner user not found');
        }

        const now = Date.now();

        // Create workspace
        const workspaceId = await ctx.db.insert('workspaces', {
            name: args.name,
            description: args.description,
            owner_user_id: args.owner_user_id,
            created_at: now,
            deleted: false,
        });

        // Add owner as member
        await ctx.db.insert('workspace_members', {
            workspace_id: workspaceId,
            user_id: args.owner_user_id,
            role: 'owner',
            created_at: now,
        });

        // Initialize server version counter
        await ctx.db.insert('server_version_counter', {
            workspace_id: workspaceId,
            value: 0,
        });

        return { workspace_id: workspaceId };
    },
});
```

**Why this is bad:**
Convex mutations are atomic, so this is actually fine from a transaction perspective. BUT, if any of these inserts fail (e.g., unique constraint violation on server_version_counter), you have a partially created workspace. You're not handling the case where the workspace was created but subsequent inserts failed.

**Real-world consequences:**
- Orphaned workspace records
- Inconsistent state
- Hard to recover from

**Fix:**
Convex handles transactions automatically, but you should still handle errors:
```typescript
export const createWorkspace = mutation({
    args: { ... },
    handler: async (ctx, args) => {
        // Verify owner exists
        const owner = await ctx.db.get(args.owner_user_id);
        if (!owner) {
            throw new Error('Owner user not found');
        }

        // Check if workspace with same name already exists
        const existing = await ctx.db
            .query('workspaces')
            .filter(q => q.eq(q.field('name'), args.name))
            .first();
            
        if (existing) {
            throw new Error('Workspace with this name already exists');
        }

        const now = Date.now();

        try {
            // Create workspace
            const workspaceId = await ctx.db.insert('workspaces', {
                name: args.name,
                description: args.description,
                owner_user_id: args.owner_user_id,
                created_at: now,
                deleted: false,
            });

            // Add owner as member
            await ctx.db.insert('workspace_members', {
                workspace_id: workspaceId,
                user_id: args.owner_user_id,
                role: 'owner',
                created_at: now,
            });

            // Initialize server version counter
            await ctx.db.insert('server_version_counter', {
                workspace_id: workspaceId,
                value: 0,
            });

            return { workspace_id: workspaceId };
        } catch (err) {
            // Convex transactions are atomic, so this shouldn't happen,
            // but if it does, we want a clear error
            throw new Error(`Failed to create workspace: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    },
});
```

---

## Issue 40: No Pagination on Admin Users List

**File:** `app/pages/admin/admin-users.vue`  
**Lines:** 162-168

```typescript
const { data: adminsData, pending, error, refresh: refreshAdmins } = await useFetch<{ admins: Admin[] }>(
    '/api/admin/admin-users',
    {
        key: 'admin:admin-users',
        server: false,
        credentials: 'include',
    }
);
```

**Why this is bad:**
You're fetching ALL admin users with no pagination. If there are 1000 admin users, you're loading them all at once. This will get slower over time.

**Real-world consequences:**
- Slow page load with many admins
- Memory issues
- Bad user experience

**Fix:**
Add pagination:
```typescript
const page = ref(1);
const perPage = ref(20);

const { data: adminsData, pending, error, refresh: refreshAdmins } = await useFetch<{ 
    admins: Admin[];
    total: number;
}>(
    '/api/admin/admin-users',
    {
        key: computed(() => `admin:admin-users:${page.value}`),
        query: computed(() => ({
            page: page.value.toString(),
            perPage: perPage.value.toString(),
        })),
        server: false,
        credentials: 'include',
    }
);
```

---

## Issue 41: Missing Loading State on Initial Load

**File:** `app/pages/admin/workspaces/index.vue`  
**Lines:** 62-64

```vue
<!-- Loading State -->
<div v-if="pending" class="space-y-4">
    <div v-for="i in 3" :key="i" class="h-20 bg-[var(--md-surface-container-highest)] rounded-lg animate-pulse" />
</div>
```

**Why this is bad:**
You have a loading state, but it's only 3 skeleton items. If the user has 20 workspaces per page, the loading state doesn't match the final layout, causing layout shift when data loads.

**Real-world consequences:**
- Layout shift (CLS)
- Poor perceived performance
- Jarring user experience

**Fix:**
Match the skeleton count to the actual item count:
```vue
<!-- Loading State -->
<div v-if="pending" class="space-y-4">
    <div v-for="i in perPage" :key="i" class="h-20 bg-[var(--md-surface-container-highest)] rounded-lg animate-pulse" />
</div>
```

---

## Issue 42: No Empty State for Search Results

**File:** `app/pages/admin/admin-users.vue`  
**Lines:** 38-68

```vue
<!-- Search Results -->
<div v-if="searchResults.length > 0" class="mt-4 space-y-2">
    ...
</div>
```

**Why this is bad:**
You only show search results if there ARE results. If the search returns nothing, the user sees... nothing. No "No users found" message, no feedback that the search completed.

**Real-world consequences:**
- Users don't know if search is still running or returned no results
- Poor UX
- Confusion

**Fix:**
```vue
<!-- Search Results -->
<div v-if="searchResults.length > 0" class="mt-4 space-y-2">
    ...
</div>
<div v-else-if="hasSearched && !isSearching" class="mt-4 text-center py-4 text-sm opacity-50">
    No users found matching "{{ searchQuery }}"
</div>
```

---

## Issue 43: Inconsistent Date Formatting

**File:** Multiple files

- `app/pages/admin/workspaces/index.vue`: `new Date(timestamp).toLocaleDateString()`
- `app/pages/admin/workspaces/[id].vue`: `new Date(timestamp).toLocaleString()`
- `app/pages/admin/admin-users.vue`: `new Date(timestamp).toLocaleDateString()`

**Why this is bad:**
You're using different date formats in different places. Some show time, some don't. This inconsistency is confusing.

**Real-world consequences:**
- Inconsistent UX
- Confusion about exact times
- Looks unprofessional

**Fix:**
Create a shared date utility:
```typescript
// utils/date.ts
export function formatDate(timestamp: number, includeTime = false): string {
    const date = new Date(timestamp);
    return includeTime 
        ? date.toLocaleString() 
        : date.toLocaleDateString();
}

// Usage
import { formatDate } from '~/utils/date';

formatDate(workspace.createdAt); // Just date
formatDate(workspace.createdAt, true); // Date + time
```

---

## Issue 44: No Confirmation on Grant Admin

**File:** `app/pages/admin/admin-users.vue`  
**Lines:** 198-222

```typescript
async function grantAdmin(userId: string) {
    grantingUserId.value = userId;
    try {
        await $fetch('/api/admin/admin-users/grant', {
            method: 'POST',
            credentials: 'include',
            body: { userId },
        });
        toast.add({
            title: 'Admin access granted',
            color: 'success',
        });
        refreshAdmins();
        searchResults.value = [];
        searchQuery.value = '';
    } catch (err: any) {
        ...
    } finally {
        grantingUserId.value = null;
    }
}
```

**Why this is bad:**
Granting admin access is a sensitive operation, but you don't ask for confirmation. One accidental click and someone has admin access.

**Real-world consequences:**
- Accidental admin grants
- Security issues
- Hard to audit/undo

**Fix:**
Add confirmation:
```typescript
async function grantAdmin(userId: string, email?: string) {
    const confirmed = await confirm({
        title: 'Grant Admin Access',
        message: `Are you sure you want to grant admin access to ${email || userId}?`,
        confirmText: 'Grant',
        danger: false,
    });
    
    if (!confirmed) return;
    
    grantingUserId.value = userId;
    // ... rest of function
}
```

---

## Issue 45: Missing Audit Trail

**File:** All admin mutation endpoints

**Why this is bad:**
You have no audit logging for admin actions. When someone deletes a workspace, grants admin access, or changes a password, there's no record of WHO did it or WHEN.

**Real-world consequences:**
- Can't investigate security incidents
- Compliance violations
- No accountability

**Fix:**
Add audit logging:
```typescript
// In each admin mutation
await ctx.db.insert('audit_log', {
    action: 'workspace.delete',
    actor_id: context.principal.kind === 'super_admin' 
        ? context.principal.username 
        : context.principal.userId,
    actor_type: context.principal.kind,
    target_type: 'workspace',
    target_id: workspaceId,
    details: { ... },
    created_at: Date.now(),
});
```

---

## Issue 46: No Input Sanitization

**File:** `server/api/admin/workspaces.post.ts`  
**Lines:** 30-46

```typescript
const body = await readBody<CreateWorkspaceBody>(event);
const { name, description, ownerUserId } = body;

// Validate input
if (!name || !name.trim()) {
    throw createError({
        statusCode: 400,
        statusMessage: 'Workspace name is required',
    });
}
```

**Why this is bad:**
You're not sanitizing the name or description. Someone could inject HTML/JS that gets rendered elsewhere.

**Real-world consequences:**
- XSS vulnerabilities
- HTML injection
- Security issues

**Fix:**
Sanitize inputs:
```typescript
import DOMPurify from 'isomorphic-dompurify';

const sanitizedName = DOMPurify.sanitize(name.trim());
const sanitizedDescription = description ? DOMPurify.sanitize(description.trim()) : undefined;
```

---

## Issue 47: No Caching on Workspace List

**File:** `server/api/admin/workspaces.get.ts`

**Why this is bad:**
The requirements say "Workspace list SHALL be cached for 30 seconds to reduce database load" but there's no caching implemented.

**Real-world consequences:**
- Unnecessary database load
- Slower responses
- Higher costs

**Fix:**
Add caching:
```typescript
import { createHash } from 'crypto';

const CACHE_TTL = 30000; // 30 seconds
const cache = new Map<string, { data: any; timestamp: number }>();

export default defineEventHandler(async (event) => {
    // ... validation ...
    
    // Generate cache key from query params
    const query = getQuery(event);
    const cacheKey = createHash('md5')
        .update(JSON.stringify(query))
        .digest('hex');
    
    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    // Fetch from store
    const store = getWorkspaceAccessStore(event);
    const result = await store.listWorkspaces({ ... });
    
    // Cache result
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return result;
});
```

---

## Issue 48: Hardcoded Version Number

**File:** `app/layouts/admin.vue`  
**Lines:** 39, 141, 234

```vue
<span class="text-xs text-[var(--md-on-surface-variant)] font-medium">v1.0</span>
...
<span>OR3 v1.0.0</span>
```

**Why this is bad:**
You're hardcoding the version number in multiple places. When you release v1.1, you have to remember to update all of them.

**Real-world consequences:**
- Version drift
- Maintenance burden
- Confusion

**Fix:**
Use a constant or environment variable:
```typescript
// config.ts
export const APP_VERSION = process.env.npm_package_version || '1.0.0';

// In component
import { APP_VERSION } from '~/config';

<span>OR3 v{{ APP_VERSION }}</span>
```

---

## Issue 49: No Error Boundary

**File:** `app/layouts/admin.vue`

**Why this is bad:**
If an error occurs in the layout or any child component, the entire admin dashboard crashes with no graceful error handling.

**Real-world consequences:**
- White screen of death
- Poor user experience
- Hard to debug

**Fix:**
Add error handling:
```vue
<template>
    <NuxtErrorBoundary @error="handleError">
        <div class="flex h-screen...">
            <!-- layout content -->
        </div>
        <template #error="{ error, clearError }">
            <div class="flex items-center justify-center h-screen">
                <div class="text-center">
                    <h1 class="text-2xl font-bold mb-4">Something went wrong</h1>
                    <p class="text-gray-600 mb-4">{{ error.message }}</p>
                    <UButton @click="clearError">Try again</UButton>
                </div>
            </div>
        </template>
    </NuxtErrorBoundary>
</template>
```

---

## Issue 50: Missing Tests

**File:** None (that's the problem)

**Why this is bad:**
The tasks.md file shows:
```markdown
- [ ] Unit tests:
  - [ ] admin auth (hash/verify, jwt sign/verify)
  - [ ] `can()` allows `admin.access` when `deploymentAdmin` true
  - [ ] retention config parsing (unset retains indefinitely)
```

None of these are checked off. You have zero tests for a critical authentication and authorization system.

**Real-world consequences:**
- Bugs go undetected
- Refactoring is dangerous
- No confidence in changes
- Security vulnerabilities

**Fix:**
Write tests. At minimum:
- Unit tests for hash/verify
- Unit tests for JWT sign/verify
- Unit tests for rate limiting
- Integration tests for login/logout flow
- Integration tests for workspace CRUD
- Tests for authorization (can/reject scenarios)

---

## Summary

This code has **50 issues** ranging from minor annoyances to serious security vulnerabilities. The most critical are:

1. **Security**: Debug logging of JWT tokens, missing authorization in Convex functions, no audit trail
2. **Performance**: N+1 queries, no caching, in-memory rate limiting
3. **Maintainability**: Debug logging everywhere, code duplication, no tests
4. **UX**: Poor error handling, missing loading states, inconsistent UI

**Recommendation**: 
- Fix the security issues immediately (Issues 1-5, 15, 20)
- Remove all debug logging before merging
- Add proper tests
- Address the N+1 query problem
- Implement proper rate limiting

This code is not production-ready.

---

## FIX PROGRESS

**Status:** Issues 1-15 completed

**Completed by:** opencode  
**Date:** 2026-01-29  
**Next issue to fix:** Issue 16

### Fixed Issues:

1. **Issues 1-5** - Removed all debug console.log statements from JWT verification, cookie handling, login handler, admin gate middleware, and cookie clearing

2. **Issue 6** - Added periodic cleanup (every 5 minutes) to in-memory rate limiting to prevent unbounded memory growth

3. **Issue 7** - Moved import statement from bottom to top of rate-limit.ts file

4. **Issues 8-9** - Fixed silent failures in credentials.ts by only catching expected errors (EEXIST, ENOENT) and rethrowing unexpected errors

5. **Issues 10-11** - Added TTL (1 minute) to global caches in registry.ts and deployment-admin.ts to prevent stale data and memory leaks

6. **Issue 12** - Replaced unsafe type assertions with validation functions that check ID format before casting

7. **Issue 13** - Fixed N+1 query problem in listWorkspaces by batching owner and member queries

8. **Issue 14** - Added search indexes on users table (by_email, by_display_name) and updated searchUsers to use indexed queries with prefix matching

9. **Issue 15** - Added proper authorization checks to Convex admin functions (listAdmins, grantAdmin, revokeAdmin) using new requireAdmin() helper

### Remaining Issues (16-50):

Issues 16-50 still need to be addressed. The next issue is:

**Issue 16:** Redundant method check in login.post.ts (file is already named .post.ts)

**Next developer should start with:** Issue 16
