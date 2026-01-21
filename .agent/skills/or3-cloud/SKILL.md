---
name: or3-cloud skill
description: How to develop and maintain OR3 Cloud core features (auth, sync, storage)
---

# OR3 Cloud Development Skill

This skill provides guidance for developing and maintaining the OR3 Cloud infrastructure: **Authentication**, **Database Sync**, and **Storage**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        config.or3cloud.ts                       │
│                    (Single source of truth)                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Auth Layer    │ │   Sync Layer    │ │  Storage Layer  │
│ app/core/auth/  │ │ app/core/sync/  │ │ app/core/storage│
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Server API      │ │ Server API      │ │ Server API      │
│ server/api/auth │ │ server/api/sync │ │ server/api/     │
│                 │ │                 │ │   storage       │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             ▼
                    ┌─────────────────┐
                    │ Convex Backend  │
                    │  convex/*.ts    │
                    └─────────────────┘
```

---

## Key Files Reference

| Component | Client Code | Server API | Convex Backend |
|-----------|-------------|------------|----------------|
| **Config** | `config.or3cloud.ts`, `utils/or3-cloud-config.ts` | via `useRuntimeConfig()` | N/A |
| **Auth** | `app/core/auth/` | `server/api/auth/` | `convex/users.ts` |
| **Sync** | `app/core/sync/` | `server/api/sync/` | `convex/sync.ts` |
| **Storage** | `app/core/storage/` | `server/api/storage/` | `convex/storage.ts` |
| **Schema** | N/A | N/A | `convex/schema.ts` |

---

## 1. Cloud Config (`config.or3cloud.ts`)

### Purpose
Centralized configuration for all cloud features. Consumed by `nuxt.config.ts` and exposed via `useRuntimeConfig()`.

### Adding a New Config Section

1. **Update type definition:**
   ```typescript
   // types/or3-cloud-config.d.ts
   export interface Or3CloudConfig {
       // ... existing sections ...
       
       myFeature?: {
           enabled?: boolean;
           apiKey?: string;
       };
   }
   ```

2. **Add defaults and validation:**
   ```typescript
   // utils/or3-cloud-config.ts
   const DEFAULT_OR3_CLOUD_CONFIG: Or3CloudConfig = {
       // ...
       myFeature: {
           enabled: false,
           apiKey: undefined,
       },
   };
   
   // Add to cloudConfigSchema (Zod v4)
   myFeature: z.object({
       enabled: z.boolean().optional(),
       apiKey: z.string().optional(),
   }).optional(),
   ```

3. **Configure in root:**
   ```typescript
   // config.or3cloud.ts
   myFeature: {
       enabled: process.env.MY_FEATURE_ENABLED === 'true',
       apiKey: process.env.MY_FEATURE_API_KEY,
   },
   ```

4. **Map to runtimeConfig in `nuxt.config.ts`**

### Validation
- Zod v4 is used for schema validation
- Use `.issues` (not `.errors`) for error access
- `strict` mode throws on missing required secrets in production

---

## 2. Authentication Layer

### File Structure
```
app/core/auth/
├── models-service.ts      # LLM model fetching with auth
├── openrouter-auth.ts     # OpenRouter OAuth flow
├── openrouter-build.ts    # Build utilities
├── useOpenrouter.ts       # Main OpenRouter composable
└── useUserApiKey.ts       # User API key management
```

### Key Concepts
- SSR auth is gated by `or3CloudConfig.auth.enabled`
- Clerk is the primary SSR provider (`@clerk/nuxt` module)
- OpenRouter uses OAuth for server-side API access

### Adding a New Auth Provider

1. Create provider file in `app/core/auth/`
2. Add provider type to `Or3CloudConfig.auth.provider` enum
3. Handle in `nuxt.config.ts` modules array
4. Create server middleware if needed

---

## 3. Database Sync Layer

### File Structure
```
app/core/sync/
├── index.ts                    # Barrel export
├── hlc.ts                      # Hybrid Logical Clock
├── hook-bridge.ts              # Connects Dexie hooks to sync
├── outbox-manager.ts           # Queues local changes for push
├── subscription-manager.ts     # Handles Convex subscriptions
├── conflict-resolver.ts        # Last-write-wins resolution
├── cursor-manager.ts           # Tracks sync cursors
├── gc-manager.ts               # Garbage collection
├── sync-payload-normalizer.ts  # Sanitizes payloads
├── sync-provider-registry.ts   # Provider management
└── providers/
    ├── convex-sync-provider.ts # Direct Convex client
    └── gateway-sync-provider.ts # Via Nuxt server proxy
```

### Sync Flow
```
Local Write → Dexie → HookBridge → OutboxManager → Push to Convex
                                                         │
Remote Update ← ConflictResolver ← SubscriptionManager ←─┘
```

### Key Exports (from `app/core/sync/index.ts`)
- `HookBridge`, `getHookBridge` - Connects Dexie to sync
- `OutboxManager` - Manages outbound change queue
- `ConflictResolver` - Handles merge conflicts
- `SubscriptionManager` - Real-time subscriptions
- `CursorManager` - Sync cursor persistence
- `createConvexSyncProvider`, `createGatewaySyncProvider`

### Backend (`convex/sync.ts`)
- `push` mutation - Receives batches from clients
- `pull` query - Returns changes since cursor
- `subscribe` query - Real-time updates

### Server Proxy (`server/api/sync/`)
```
server/api/sync/
├── push.post.ts          # Forward push to Convex
├── pull.post.ts          # Forward pull queries
└── update-cursor.post.ts # Update sync cursors
```

---

## 4. Storage Layer

### File Structure
```
app/core/storage/
├── provider-registry.ts   # Storage provider management
├── transfer-queue.ts      # Upload/download queue with retries
├── types.ts               # Type definitions
└── providers/
    └── convex-storage-provider.ts
```

### Key Concepts
- Provider pattern allows swapping backends (Convex, S3)
- `FileTransferQueue` handles concurrent uploads with retry logic
- Presigned URLs used for secure client uploads

### Backend (`convex/storage.ts`)
- `generateUploadUrl` - Creates presigned upload URL
- `completeUpload` - Finalizes upload, creates file record
- `getDownloadUrl` - Returns presigned download URL
- `deleteFile` - Soft/hard delete

### Server API (`server/api/storage/`)
```
server/api/storage/
├── presign-upload.post.ts    # Get upload URL
├── presign-download.post.ts  # Get download URL  
├── confirm-upload.post.ts    # Confirm completed upload
└── delete.post.ts            # Delete file
```

---

## 5. Testing

### Test Locations
- Unit tests: `tests/unit/` or `**/__tests__/`
- Test pattern: `*.test.ts`

### Running Tests
```bash
# Run all tests
bunx vitest run

# Run specific test file
bunx vitest run tests/unit/or3-cloud-config.test.ts

# Run tests matching pattern
bunx vitest run --grep "sync"

# Watch mode
bunx vitest
```

### Typecheck
```bash
bunx nuxi typecheck
```

---

## 6. Environment Variables

### Auth
| Variable | Description |
|----------|-------------|
| `SSR_AUTH_ENABLED` | Enable SSR authentication (`true`/`false`) |
| `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public key |
| `NUXT_CLERK_SECRET_KEY` | Clerk secret key |

### Sync
| Variable | Description |
|----------|-------------|
| `OR3_SYNC_ENABLED` | Enable sync (`true`/`false`) |
| `NUXT_PUBLIC_CONVEX_URL` | Convex deployment URL |

### Storage
| Variable | Description |
|----------|-------------|
| `OR3_STORAGE_ENABLED` | Enable storage (`true`/`false`) |

### LLM
| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Instance-level OpenRouter key |
| `OR3_OPENROUTER_ALLOW_USER_OVERRIDE` | Allow user keys (`true`/`false`) |

---

## 7. Common Tasks

### Enable Cloud Features Locally
```bash
# .env.local
SSR_AUTH_ENABLED=true
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
NUXT_CLERK_SECRET_KEY=sk_test_...
NUXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

### Deploy Convex Schema Changes
```bash
bun run convex-dev   # Development
bun run convex-push  # Production deployment
```

### Add a New Synced Table

1. Add to `convex/schema.ts`:
   ```typescript
   myTable: defineTable({
       // fields...
       workspaceId: v.string(),
       deleted: v.optional(v.boolean()),
       _syncVersion: v.optional(v.number()),
   }).index('by_workspace', ['workspaceId']),
   ```

2. Add to sync handler in `convex/sync.ts`

3. Create Dexie table + hooks in client code

---

## 8. Debugging Tips

- **Sync issues**: Check `OutboxManager` state via dev tools
- **Auth failures**: Verify Clerk keys match environment
- **Storage uploads**: Check presign URL expiration
- **Convex errors**: Run `bun run convex-dev` to see backend logs

---

## 9. Code Quality Standards

- **Type Safety**: No `any`, use Zod for external data
- **Error Handling**: Wrap promises, handle edge cases
- **Testing**: Add tests for new sync logic
- **Vite Style**: Use `import.meta.env` not `process.env`
