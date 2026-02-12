# Runtime Configuration Guide

This document describes the available runtime configuration options for OR3 Chat.

## Overview

OR3 Chat supports runtime configuration through environment variables and the Nuxt runtime config system. Configuration values can be set via `.env` files or environment variables at runtime.

## Server-Side Configuration

These configuration values are only available on the server side and should not be exposed to clients.

### `openrouterApiKey`

**Environment Variable:** `OPENROUTER_API_KEY`  
**Type:** `string`  
**Default:** `''` (empty string)

The API key for OpenRouter. If not provided, the application will attempt to use the client-provided API key from the Authorization header.

**Example:**
```bash
OPENROUTER_API_KEY=sk-or-v1-abc123...
```

### `openrouterUrl`

**Environment Variable:** `OPENROUTER_URL`  
**Type:** `string`  
**Default:** `https://openrouter.ai/api/v1/chat/completions`

The OpenRouter API endpoint URL. This can be configured to use a proxy or alternative endpoint for OpenRouter requests.

**Example:**
```bash
# Use a proxy
OPENROUTER_URL=https://my-proxy.example.com/openrouter/v1/chat/completions

# Use staging environment
OPENROUTER_URL=https://staging.openrouter.ai/api/v1/chat/completions
```

## Client-Side (Public) Configuration

These configuration values are exposed to the client and can be accessed in browser code.

### `allowedMimeTypes`

**Environment Variable:** `NUXT_PUBLIC_ALLOWED_MIME_TYPES`  
**Type:** `string` (comma-separated list)  
**Default:** `image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif,image/heic,image/heif,image/bmp,image/tiff,image/x-icon,application/pdf`

Comma-separated list of allowed MIME types for file uploads. Only files with MIME types in this list can be attached to messages.

**Example:**
```bash
# Allow only JPEG, PNG, and PDF files
NUXT_PUBLIC_ALLOWED_MIME_TYPES=image/jpeg,image/png,application/pdf

# Add WebP support to defaults
NUXT_PUBLIC_ALLOWED_MIME_TYPES=image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif,image/heic,image/heif,image/bmp,image/tiff,image/x-icon,application/pdf
```

**Notes:**
- MIME types are validated when files are selected for upload
- The file validation logic also checks that image/* types are classified as 'image' and 'application/pdf' as 'pdf'
- Whitespace is automatically trimmed from each MIME type
- Empty entries are filtered out

### `maxFileSizeBytes`

**Environment Variable:** `NUXT_PUBLIC_MAX_FILE_SIZE_BYTES`  
**Type:** `number` (integer)  
**Default:** `20971520` (20MB = 20 * 1024 * 1024)

Maximum file size in bytes for file uploads. Files larger than this limit will be rejected during validation.

**Example:**
```bash
# Set max file size to 10MB
NUXT_PUBLIC_MAX_FILE_SIZE_BYTES=10485760

# Set max file size to 50MB
NUXT_PUBLIC_MAX_FILE_SIZE_BYTES=52428800

# Set max file size to 5MB
NUXT_PUBLIC_MAX_FILE_SIZE_BYTES=5242880
```

**Notes:**
- The value must be a valid integer
- Invalid values will fall back to the default (20MB)
- Consider your hosting provider's request size limits when configuring this value
- Larger files require more memory and bandwidth

## Configuration File Examples

### Development (.env.local)

```bash
# Server-side config
OPENROUTER_API_KEY=sk-or-v1-development-key

# Client-side config (public)
NUXT_PUBLIC_MAX_FILE_SIZE_BYTES=10485760
NUXT_PUBLIC_ALLOWED_MIME_TYPES=image/jpeg,image/png,application/pdf
```

### Production (.env.production)

```bash
# Server-side config
OPENROUTER_API_KEY=sk-or-v1-production-key
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions

# Client-side config (public)
NUXT_PUBLIC_MAX_FILE_SIZE_BYTES=20971520
NUXT_PUBLIC_ALLOWED_MIME_TYPES=image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif,application/pdf
```

### Using a Proxy

```bash
# Server-side config
OPENROUTER_URL=https://my-proxy.example.com/api/openrouter/v1/chat/completions
OPENROUTER_API_KEY=proxy-auth-token
```

## Accessing Configuration in Code

### Server-Side (API Routes)

```typescript
export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    
    // Access server-only config
    const apiKey = config.openrouterApiKey;
    const openrouterUrl = config.openrouterUrl;
    
    // Access public config (also available server-side)
    const maxSize = config.public.maxFileSizeBytes;
    const allowedTypes = config.public.allowedMimeTypes;
});
```

### Client-Side (Components/Composables)

```typescript
export default defineComponent({
    setup() {
        const config = useRuntimeConfig();
        
        // Access public config only
        const maxSize = config.public.maxFileSizeBytes;
        const allowedTypes = config.public.allowedMimeTypes;
        
        // Server-only config is NOT accessible on client
        // config.openrouterApiKey // ❌ undefined on client
    }
});
```

## Best Practices

1. **Never commit sensitive keys** - Use `.env.local` for local development and set environment variables in production
2. **Use `.env.example`** - Document all required environment variables in an example file
3. **Validate configuration** - Always check for required values at startup
4. **Consider defaults** - Provide sensible defaults for optional configuration
5. **Document changes** - Update this file when adding new configuration options

## Future Configuration Options

The following configuration options may be added in future releases:

- **Rate Limiting** - Configurable rate limits per user/IP
- **GC Retention Period** - How long to retain deleted items before garbage collection
- **Background Job Timeout** - Maximum execution time for background jobs
- **Per-User Concurrency Limits** - Maximum concurrent background jobs per user
- **Storage Quotas** - Per-workspace storage limits

## Related Documentation

- [OpenRouter Integration](./openrouter-integration.md) - Details about OpenRouter API integration
- [Error Handling](./error-handling.md) - How validation errors are handled
- [Hooks System](./hooks.md) - Extend file validation via hooks

## Migration Notes

### From Hardcoded Values

If you were previously using hardcoded values for MIME types or file sizes, they will now use the configuration system. The defaults match the previous hardcoded values, so no changes are required unless you want to customize them.

**Before (hardcoded):**
```typescript
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
```

**After (configurable):**
```typescript
const maxSize = getMaxFileSizeBytes(); // Reads from config, defaults to 20MB
```
