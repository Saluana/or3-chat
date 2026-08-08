# Troubleshooting OR3 Cloud

This guide helps you diagnose and fix common issues with OR3 Cloud features including authentication, sync, storage, and notifications.

---

## Quick Diagnostic Checklist

Run through this checklist first:

```bash
# 1. Verify environment variables
echo $SSR_AUTH_ENABLED        # Should be "true" for cloud features
echo $OR3_AUTH_PROVIDER        # Selected provider (e.g., basic-auth, clerk)
echo $OR3_SYNC_ENABLED         # Should be "true" for sync
echo $VITE_CONVEX_URL          # Should be set for sync/storage (Convex provider)

# 2. Check build mode
# Static builds (nuxt generate) don't support cloud features
# SSR builds (nuxt build) required for cloud features

# 3. Verify network connectivity
# - Can you reach Convex? (check browser console)
# - Can you reach your auth provider? (check auth popup)
```

---

## Authentication Issues

### Can't Log In

**Symptoms:** Login button does nothing, auth popup blocked, or infinite loading.

**Common Causes & Solutions:**

1. **Missing Environment Variables**
   ```bash
   # Required for auth
   NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   NUXT_CLERK_SECRET_KEY=sk_test_...
   SSR_AUTH_ENABLED=true
   ```

2. **Popup Blocked**
   - Check browser popup blocker settings
   - Look for blocked popup icon in address bar
   - Allow popups for your domain

3. **Clerk Configuration**
   - Verify Clerk publishable key is correct
   - Check Clerk dashboard for allowed origins
   - Ensure redirect URLs are configured

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

See: [admin-access-bridge](./admin-access-bridge)

### Workspace Not Created

**Symptoms:** Logged in but no workspace, sync fails immediately.

**Checks:**
```typescript
// Check session context
const session = useSessionContext();
console.log('Session:', session.data.value);
// Should have: user, workspace.id, authenticated: true
```

**Solutions:**
- Verify `VITE_CONVEX_URL` is set
- Check Convex dashboard for workspace creation errors
- Ensure user has proper permissions
- Check server logs for `resolveSessionContext` errors

---

## Sync Issues

### Changes Not Syncing

**Symptoms:** Data saved locally but doesn't appear on other devices.

**Diagnostic Steps:**

1. **Check Sync Status**
   ```typescript
   // In browser console
   hooks.addAction('sync.subscription:action:statusChange', (data) => {
       console.log('Sync status:', data.status);
       // Should be: 'connected'
   });
   ```

2. **Verify Environment**
   ```bash
   SSR_AUTH_ENABLED=true
   OR3_SYNC_ENABLED=true
   VITE_CONVEX_URL=https://your-project.convex.cloud
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
- Check network connectivity to Convex
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
- Cursor expiration (default 24 hours)
- Device cursor tracking issues
- Clock skew between devices

**Solutions:**
- Check `sync.rescan:action:starting` frequency in console
- Verify device cursor is being updated
- Check for clock synchronization issues

---

## Storage Issues

### File Uploads Failing

**Symptoms:** Upload starts but fails, progress bar stops, error message.

**Diagnostic Steps:**

1. **Check File Size**
   ```typescript
   // Default limits
   maxFileSizeBytes: 20MB (local)
   maxCloudFileSizeBytes: 100MB (cloud)
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
       .where('status')
       .equals('error')
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
const transfer = await db.file_transfers.get(fileHash);
console.log('Transfer status:', transfer?.status);
```

**Solutions:**
- Trigger manual download via `FileTransferQueue`
- Check presigned URL generation
- Verify file exists in cloud storage
- Check browser console for CORS errors

### Storage Quota Exceeded

**Symptoms:** Uploads fail with quota errors, console shows storage warnings.

**Solutions:**
- Clear old files from recycle bin
- Export and delete old workspaces
- Increase `localStorageQuotaMB` in config
- Check browser storage usage

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
   ```bash
   # Wrong - static build doesn't support cloud
   nuxt generate
   
   # Correct - SSR build required
   nuxt build
   ```

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

// Log all sync events
hooks.addAction('sync.*', (data, name) => {
    console.log(`[${name}]`, data);
});

// Log all notification events
hooks.addAction('notify.*', (data, name) => {
    console.log(`[${name}]`, data);
});
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
const cursor = await db.sync_state.get('cursor');
console.log('Sync cursor:', cursor);
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
   - [Configuration Reference](./config-reference)
   - [Auth System](./auth-system)
   - [Sync Layer](./sync-layer)
   - [Storage Layer](./storage-layer)
   - [Notifications](./notifications)

5. **Check Related Issues**
   - Search GitHub issues
   - Check Discord community
   - Review recent changes

---

## Common Error Messages

### "Unauthorized: No identity"
**Cause:** User not authenticated
**Solution:** Check Clerk session, verify auth flow

### "Sync provider not found"
**Cause:** No sync provider registered
**Solution:** Ensure `convex-sync.client.ts` plugin loads

### "Circuit breaker open"
**Cause:** Too many sync failures
**Solution:** Check network, wait for retry, check server health

### "Database version mismatch"
**Cause:** Dexie schema version conflict
**Solution:** Clear IndexedDB, reload page

### "QuotaExceededError"
**Cause:** Browser storage full
**Solution:** Clear old data, increase quota, export workspace
