# Troubleshooting OR3 Cloud

This guide helps you diagnose and fix common issues with OR3 Cloud features including authentication, sync, storage, and notifications.

---

## Quick Diagnostic Checklist

Run through this checklist first:

```bash
# 1. Verify environment variables
echo $SSR_AUTH_ENABLED        # Should be "true" for cloud features
echo $OR3_SYNC_ENABLED         # Should be "true" for sync
echo $VITE_CONVEX_URL          # Should be set for sync/storage
echo $NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY  # Should be set for auth

# 2. Check build mode
# Static builds (nuxt generate) don't support cloud features
# SSR builds (nuxt build) required for cloud features

# 3. Verify network connectivity
# - Can you reach Convex? (check browser console)
# - Can you reach Clerk? (check auth popup)
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

**This is Fixed:** The system now automatically:
- Suppresses conflict notifications during bootstrap/rescan
- Filters historical conflicts (older than 24 hours)
- Deduplicates within 15-second windows

**If Still Seeing Many:**
- Check browser console for: `[notify] Skipping historical conflict notification`
- Verify `notification-listeners.client.ts` plugin is loaded
- Ensure you're on the latest version

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
- Cursor expiration (default 7 days)
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

```typescript
// In browser console
localStorage.setItem('debug:sync', 'true');
localStorage.setItem('debug:notifications', 'true');
localStorage.setItem('debug:auth', 'true');

// Reload page and check console
```

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
