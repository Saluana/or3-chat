# Troubleshooting OR3 Cloud

This guide helps you diagnose and fix common issues with OR3 Cloud features including authentication, sync, storage, and notifications.

---

## Quick Diagnostic Checklist

For managed deployments, run these read-only diagnostics from the deployment directory:

```bash
npx @or3/cloud doctor
npx @or3/cloud status --json
npx @or3/cloud logs --tail 200
```

For source deployments, use the [source wizard doctor](/documentation/cloud/or3-cloud-wizard) and [environment reference](/documentation/cloud/environment-reference). Confirm the selected provider, its required workspace store, and the effective canonical feature flags. A Convex URL is required only when Convex is selected. Do not print secrets into shared logs.

Cloud requires the SSR server. If an endpoint is unexpectedly missing, confirm which development process owns ports 3000 and 24678 before restarting. Preserve queued local changes while investigating.

The code snippets below run in application source with `useHooks`, `getDb`, and composables in scope; they are not globals available by pasting into a plain browser console.

---

## Authentication Issues

### Can't Log In

**Symptoms:** Login button does nothing, auth popup blocked, or infinite loading.

**Common Causes & Solutions:**

1. **Managed Basic Auth:** use the saved account credentials, check cookie policy and origin, and run doctor. The application login and `/admin` login are separate.
2. **Source Basic Auth:** verify its JWT secret, persistent auth DB, and bootstrap email/password. Invite-only registration also requires the invitation token secret; see [Basic Auth](/documentation/cloud/provider-basic-auth).
3. **Clerk only:** check publishable/secret key pairing, allowed origins, redirect URLs, and popup blockers; see [Clerk](/documentation/cloud/provider-clerk).
4. Inspect `GET /api/auth/session` and server logs for verified identity and provisioning failures. An authenticated identity can still lack access to a workspace.

### Session Not Persisting

**Symptoms:** Logged out on page refresh, session expires quickly.

**Solutions:**
- Check browser cookies are enabled
- Verify Clerk session duration settings
- Check for cookie-blocking extensions
- Look for `SessionContext` errors in console

### "I Logged Out of Admin But Still Have Elevated Access"

**Symptoms:** After clicking admin logout, admin grants still exist and some privileged non-panel operations may still succeed.

**Cause:** In Clerk + Convex mode, admin grants are persisted in `admin_users` and are separate from the super-admin cookie.

`POST /api/admin/auth/logout` clears only `or3_admin`. It does not sign out Clerk and does not revoke deployment admin grants.

Note:
- `/admin/*` pages are super-admin-only. A deployment-admin grant alone should not open the admin panel.

**Checks:**
- Open `/admin/admin-users` as super admin and verify whether the user has a grant.

**Fix:**
- Revoke the user in `/admin/admin-users` if they should not have deployment admin.
- Optionally sign out Clerk from the main app session too.

See: [Deployment administration](/documentation/cloud/auth-system#deployment-administration)

### Workspace Not Created

**Symptoms:** Logged in but no workspace, sync fails immediately.

**Checks:**
```typescript
// Check session context
const session = useSessionContext();
console.log('Session:', session.data.value);
// Envelope: data.value?.session contains user, workspace.id, and authenticated.
```

**Solutions:**
- Verify the selected backend's workspace store and provider health
- Check invite-only/auto-provision policy; a first login does not always create a workspace
- Ensure user has proper permissions
- Check server logs for `resolveSessionContext` errors

---

## Sync Issues

### Changes Not Syncing

**Symptoms:** Data saved locally but doesn't appear on other devices.

**Diagnostic Steps:**

1. **Check Sync Status**
   ```typescript
   // In source, after resolving hooks
   hooks.addAction('sync.subscription:action:statusChange', (data) => {
       console.log('Sync status:', data.status);
       // Should be: 'connected'
   });
   ```

2. **Verify Environment**
   ```bash
   SSR_AUTH_ENABLED=true
   OR3_SYNC_ENABLED=true
   OR3_SYNC_PROVIDER=sqlite # or convex, with its required connection URL
   ```

3. **Check Pending Operations**
   ```typescript
   const db = getDb();
   const pending = await db.pending_ops.count();
   console.log('Pending ops:', pending);
   // If > 0 and not decreasing, sync is stuck
   ```

**Solutions:**
- Ensure OR3 Cloud is enabled
- Check network connectivity to the selected backend
- Verify user is authenticated
- Look for sync errors in console
- Check if sync provider is registered

### Too Many Conflict Notifications

**Symptoms:** Dozens of "Sync conflict resolved" notifications on first load.

**This cannot happen anymore.** Conflict events never create notifications.
Sync error warnings are the only sync-related notification type, and they are:

- Suppressed during bootstrap/rescan
- Deduplicated within a 15-second window per record and message
- Burst-limited (more than 5 in 10 seconds starts a 60-second cooldown)

**If You Still See Repeated Sync Notifications:**
- Verify `notification-listeners.client.ts` plugin is loaded
- Look for `[notify]` entries in the browser console
- Check for AI completion notifications instead: those only fire when no
  viewer is attached to the job and the thread is not muted

### Bootstrap Taking Forever

**Symptoms:** Initial workspace load is very slow, progress seems stuck.

**This is Normal For:**
- Large workspaces (1000+ records)
- Slow network connections
- First-time sync on new device

**Monitor Progress:**
```typescript
hooks.addAction('sync.bootstrap:action:progress', (data) => {
    console.log(`Synced ${data.pulledCount} records...`);
});

hooks.addAction('sync.bootstrap:action:complete', (data) => {
    console.log(`Bootstrap complete! Total: ${data.totalPulled}`);
});
```

**Solutions:**
- Add a loading indicator during bootstrap
- Consider pagination for large workspaces
- Check network speed

### Sync Loop / Constant Rescan

**Symptoms:** Sync keeps restarting, data re-downloads frequently.

**Causes:**
- The server has pruned history beyond this device's cursor and requests a snapshot
- Legacy providers without retention fields can trigger the 24-hour client fallback
- Device cursor tracking issues
- Clock skew between devices

**Solutions:**
- Check `sync.rescan:action:starting` frequency in console
- Verify device cursor is being updated
- Inspect pull response `oldestRetainedVersion` / `requiresSnapshot` and provider `snapshot-v1` capability
- Do not reset the cursor or discard pending writes to suppress the symptom

---

## Storage Issues

### File Uploads Failing

**Symptoms:** Upload starts but fails, progress bar stops, error message.

**Diagnostic Steps:**

1. **Check File Size**
   ```typescript
   const limits = useOr3Config().limits;
   console.log(limits.maxFileSizeBytes, limits.maxCloudFileSizeBytes);
   ```

2. **Verify Storage Configuration**
   ```bash
   OR3_STORAGE_ENABLED=true
   VITE_CONVEX_URL=https://your-project.convex.cloud
   ```

3. **Check Transfer Queue**
   ```typescript
   const db = getDb();
   const transfers = await db.file_transfers
       .where('state')
       .equals('failed')
       .toArray();
   console.log('Failed transfers:', transfers);
   ```

**Common Solutions:**
- Reduce file size
- Check network connectivity
- Verify storage provider is configured
- Check file type is allowed (images, PDFs, text)

### Files Not Downloading

**Symptoms:** File metadata visible but blob won't load, broken image icons.

**Checks:**
```typescript
// Check if blob exists locally
const db = getDb();
const blob = await db.file_blobs.get(fileHash);
console.log('Blob exists:', !!blob);

// Check transfer status
const transfers = await db.file_transfers
    .where('[hash+direction]')
    .equals([fileHash, 'download'])
    .toArray();
console.log('Download state and errors:', transfers.map(({ state, last_error }) => ({ state, last_error })));
```

**Solutions:**
- Trigger manual download via `FileTransferQueue`
- Check presigned URL generation
- Verify file exists in cloud storage
- Check browser console for CORS errors

### Storage Quota Exceeded

**Symptoms:** Uploads fail with quota errors, console shows storage warnings.

**Solutions:**
- Distinguish a browser `QuotaExceededError` from a server workspace-quota rejection.
- `localStorageQuotaMB` is a warning threshold; increasing it does not increase browser capacity. Export and verify data before deleting anything.
- Server quota is `OR3_STORAGE_WORKSPACE_QUOTA_BYTES`, enforced against canonical metadata and upload reservations. Review the storage provider and active reservations before changing that quota.

---

## Notification Issues

### Notifications Not Appearing

**Symptoms:** Bell icon shows no badge, panel is empty.

**Diagnostic Steps:**

1. **Check Client-Side Execution**
   ```typescript
   console.log('Is client?', import.meta.client);
   // Should be true
   ```

2. **Check Database**
   ```typescript
   const db = getDb();
   const count = await db.notifications.count();
   console.log('Total notifications:', count);
   ```

3. **Check User ID**
   ```typescript
   const { notifications } = useNotifications();
   console.log('Notifications:', notifications.value);
   ```

**Solutions:**
- Ensure code runs client-side
- Verify notification was created
- Check for console errors
- Ensure user ID is set correctly

### Duplicate Notifications

**Symptoms:** Same notification appears multiple times.

**Causes:**
- Multiple listeners registered
- Hook emitted multiple times
- Sync creating duplicates

**Solutions:**
- Check for duplicate plugin registrations
- Use idempotency keys when creating notifications
- Verify singleton pattern in NotificationService

### Notifications Not Syncing

**Symptoms:** Notification on one device doesn't appear on another.

**Checks:**
- Verify OR3 Cloud is enabled
- Check notification was synced (has `clock` field)
- Verify `read_at` updates are syncing

**Solutions:**
- Enable OR3 Cloud features
- Check sync is working for other data types
- Verify notifications table is in sync list

---

## Background Streaming Issues

### 401 When Starting a Background Job

**Symptoms:** `POST /api/openrouter/stream` returns 401 with
"Authentication required for background streaming".

**Cause:** Background mode requires an authenticated SSR session with an active
workspace. Guests and signed-out users are rejected even if they supply their
own OpenRouter key.

**Fix:** Sign in, confirm `/api/auth/session` returns `authenticated: true`
with a `workspace.id`, then retry.

### 404/405 on /api/openrouter/stream

**Symptoms:** The stream route returns 404 or 405.

**Causes:**
- Static build (no server routes)
- Stale dev process on port 3000/24678
- Stale `or3:server-route-available` cache

**Fix:** Clear the availability cache and reload:

```js
localStorage.removeItem('or3:server-route-available');
localStorage.removeItem('or3:background-streaming-available');
```

The route cache has a 15-minute TTL and is set after the first successful or
failed probe. After a runtime or provider switch, clear both keys before
debugging.

### 503 "Server Busy"

**Symptoms:** Background start returns 503 "Server busy, try again later".

**Cause:** The concurrency cap was hit: `OR3_BACKGROUND_MAX_JOBS` (default 20)
or `OR3_BACKGROUND_MAX_JOBS_PER_USER` (default 5).

**Fix:** Wait for an active job to finish, or raise the caps and restart.

### Background Mode Never Triggers

**Symptoms:** Chat always streams in the foreground even though background
mode is configured.

**Checks:**
- Is `OR3_BACKGROUND_STREAMING_ENABLED=true` (both
  `runtimeConfig.backgroundJobs.enabled` and
  `public.backgroundStreaming.enabled`)?
- Is the start mode `background` and the model modality text-only
  (`modalities === ['text']`)?
- Is the client on a static build or hitting an old dev process?

### "It Worked Yesterday" Weirdness

**Cause:** The localStorage availability caches persist across runtime and
provider switches. Behavior can look inconsistent after toggling SSR or
providers.

**Fix:** Clear `or3:server-route-available` and
`or3:background-streaming-available` (or use a fresh browser profile).

---

## Build & Deployment Issues

### Cloud Features Not Working in Production

**Symptoms:** Everything works locally but fails in production.

**Checks:**

1. **Build Mode**
   Managed deployments use the versioned container. For editable source, use `bun run build` for SSR; `bun run generate:static` produces local-only output with Cloud disabled.

2. **Environment Variables**
   - Ensure env vars are set in production
   - Check `runtimeConfig` includes necessary values
   - Verify secrets aren't exposed to client

3. **CORS Configuration**
   - Check `allowedOrigins` includes your domain
   - Verify Clerk allowed origins
   - Check Convex CORS settings

### Plugin Not Loading

**Symptoms:** Cloud features don't initialize, plugins missing.

**Checks:**
```typescript
// Verify plugin file naming
plugins/
├── my-feature.client.ts    # ✓ Runs in both static and SSR
├── my-feature.server.ts    # ✓ SSR only
└── my-feature.ts           # Both sides in SSR, client-only in static
```

**Solutions:**
- Use `.client.ts` suffix for client-only plugins
- Check for errors in plugin initialization
- Verify plugin is imported in nuxt.config.ts

### Managed update or recovery is blocked

**Symptoms:** `update` refuses because an incomplete operation is recorded, a
cleanup warning appears after a successful update, or the Dashboard Update card
says the operator needs host attention.

**Diagnosis (read-only, never changes state):**

```bash
npx @or3/cloud status --json
npx @or3/cloud doctor
npx @or3/cloud verify --read-only
npx @or3/cloud recover --dry-run
npx @or3/cloud backup list
```

**Resolution:**
- A completed replacement with a recorded target-ready milestone:
  `npx @or3/cloud recover --finish` adopts the live target and keeps writes made
  after replacement.
- A deployment that may have replaced data without completion proof: nothing is
  changed automatically. Review `recover --dry-run`, then choose explicitly with
  `npx @or3/cloud recover --restore --yes` (this discards writes after the
  recorded snapshot).
- Cleanup warnings after a successful update are not deployment failures; the
  app is upgraded. Run `npx @or3/cloud backup list` to inspect what was
  preserved.
- Never delete or edit `.or3-cloud/state.json`, the lease, or recovery files by
  hand. If `status` reports a schema or digest mismatch, run `doctor` before any
  mutation.

---

## Debugging Tips

### Enable Debug Logging

There are no `debug:*` localStorage flags. Relevant logs appear under these
console prefixes:

- `[sync]` and `[OutboxManager]` - sync engine activity (development builds)
- `[notify]` - notification listener activity
- `[useNotifications]` - notification query and subscription errors
- `[openrouterStream]` - chat streaming and background start decisions

### Monitor Hooks

```typescript
const hooks = useHooks();

// Wildcard callbacks receive each emitter's arguments, not an appended hook name.
const offSync = hooks.on('sync.*', (...args) => console.log('Sync event:', ...args));
const offNotify = hooks.on('notify.*', (...args) => console.log('Notification event:', ...args));
// Remove when debugging ends:
// offSync(); offNotify();
```

### Check Database State

```typescript
const db = getDb();

// Check table counts
console.log('Messages:', await db.messages.count());
console.log('Notifications:', await db.notifications.count());
console.log('Pending ops:', await db.pending_ops.count());
console.log('File blobs:', await db.file_blobs.count());

// Check sync state
const states = await db.sync_state.toArray();
console.log('Workspace-scoped sync state:', states);
```

### Performance Profiling

```typescript
// Time sync operations
console.time('bootstrap');
hooks.addAction('sync.bootstrap:action:complete', () => {
    console.timeEnd('bootstrap');
});

// Time database queries
console.time('query');
const results = await db.messages.where('thread_id').equals(id).toArray();
console.timeEnd('query');
```

---

## Getting Help

If you're still stuck:

1. **Check the Logs**
   - Browser console for client-side errors
   - Server logs for SSR errors
   - Convex dashboard for backend errors

2. **Verify Configuration**
   - Run through the Quick Diagnostic Checklist
   - Compare with working environment
   - Check for typos in env vars

3. **Isolate the Issue**
   - Test auth without sync
   - Test sync without storage
   - Create minimal reproduction

4. **Review Documentation**
   - [Configuration Reference](/documentation/cloud/config-reference)
   - [Auth System](/documentation/cloud/auth-system)
   - [Sync Layer](/documentation/cloud/sync-layer)
   - [Storage Layer](/documentation/cloud/storage-layer)
   - [Notifications](/documentation/cloud/notifications)

5. **Check Related Issues**
   - Search GitHub issues
   - Check Discord community
   - Review recent changes

---

## Common Error Messages

### "Unauthorized: No identity"
**Cause:** User not authenticated
**Solution:** Check the selected auth provider and resolved session envelope.

### "Sync provider not found"
**Cause:** No sync provider registered
**Solution:** Check the selected provider package, client registration, and SSR gateway registration.

### "Circuit breaker open"
**Cause:** Too many sync failures
**Solution:** Check network, wait for retry, check server health

### "Database version mismatch"
**Cause:** Dexie schema version conflict
**Solution:** Confirm application/provider versions and inspect the migration error. Export and verify a backup before any reset; preserve unsynced data and report the failed schema migration.

### "QuotaExceededError"
**Cause:** Browser storage full
**Solution:** Export and verify a backup first. Inspect browser storage capacity; changing the local warning threshold does not grant more space. Do not clear unsynced workspace data.
