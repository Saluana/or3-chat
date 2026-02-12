# Wire Schema Casing Normalization

This document describes the casing normalization utilities for wire schema handling in OR3 Chat.

## Overview

OR3 Chat's database schema uses `snake_case` for field names (e.g., `created_at`, `user_id`), while JavaScript/TypeScript code typically uses `camelCase` (e.g., `createdAt`, `userId`). 

When syncing data with external services or accepting data from various sources, we need to handle both casing styles gracefully. The casing utilities provide functions to:

1. Accept both `camelCase` and `snake_case` input
2. Normalize to `snake_case` for storage
3. Convert between formats as needed

## Location

The casing utilities are located in `shared/utils/casing.ts` and can be imported in both client and server code.

## API Reference

### `camelToSnake(str: string): string`

Converts a string from camelCase to snake_case.

**Example:**
```typescript
import { camelToSnake } from '~~/shared/utils/casing';

camelToSnake('userId');      // 'user_id'
camelToSnake('createdAt');   // 'created_at'
camelToSnake('mimeType');    // 'mime_type'
```

### `snakeToCamel(str: string): string`

Converts a string from snake_case to camelCase.

**Example:**
```typescript
import { snakeToCamel } from '~~/shared/utils/casing';

snakeToCamel('user_id');      // 'userId'
snakeToCamel('created_at');   // 'createdAt'
snakeToCamel('mime_type');    // 'mimeType'
```

### `keysToSnakeCase<T>(obj: unknown): T`

Recursively converts all object keys from camelCase to snake_case.

**Example:**
```typescript
import { keysToSnakeCase } from '~~/shared/utils/casing';

const input = {
    userId: 123,
    createdAt: 1234567890,
    userProfile: {
        firstName: 'John',
        lastName: 'Doe'
    }
};

const output = keysToSnakeCase(input);
// {
//     user_id: 123,
//     created_at: 1234567890,
//     user_profile: {
//         first_name: 'John',
//         last_name: 'Doe'
//     }
// }
```

**Features:**
- Handles nested objects recursively
- Preserves arrays and their contents
- Handles `null` and `undefined` gracefully
- Preserves primitive values unchanged
- Already snake_case keys pass through unchanged

### `keysToCamelCase<T>(obj: unknown): T`

Recursively converts all object keys from snake_case to camelCase.

**Example:**
```typescript
import { keysToCamelCase } from '~~/shared/utils/casing';

const input = {
    user_id: 123,
    created_at: 1234567890,
    user_profile: {
        first_name: 'John',
        last_name: 'Doe'
    }
};

const output = keysToCamelCase(input);
// {
//     userId: 123,
//     createdAt: 1234567890,
//     userProfile: {
//         firstName: 'John',
//         lastName: 'Doe'
//     }
// }
```

### `normalizeWireSchema<T>(input: unknown): T`

Normalizes wire schema input to snake_case. This is the primary function for handling incoming data from external sources.

**Example:**
```typescript
import { normalizeWireSchema } from '~~/shared/utils/casing';

// Accepts camelCase input
const camelInput = {
    userId: 123,
    threadData: {
        messageCount: 5
    }
};
const normalized1 = normalizeWireSchema(camelInput);
// { user_id: 123, thread_data: { message_count: 5 } }

// Accepts snake_case input (passes through)
const snakeInput = {
    user_id: 123,
    thread_data: {
        message_count: 5
    }
};
const normalized2 = normalizeWireSchema(snakeInput);
// { user_id: 123, thread_data: { message_count: 5 } }

// Accepts mixed input (normalizes everything to snake_case)
const mixedInput = {
    userId: 123,
    created_at: 1234567890,  // Already snake_case
    threadData: {
        thread_id: 'abc',    // Already snake_case
        messageCount: 5      // camelCase
    }
};
const normalized3 = normalizeWireSchema(mixedInput);
// { user_id: 123, created_at: 1234567890, thread_data: { thread_id: 'abc', message_count: 5 } }
```

## Use Cases

### 1. Accepting Sync Data from External Services

When receiving data from a sync provider (e.g., Convex, Firebase), the data may come in camelCase. Use `normalizeWireSchema` to ensure it matches the database schema:

```typescript
export async function ingestSyncData(externalData: unknown) {
    // External data might be camelCase or snake_case
    const normalized = normalizeWireSchema(externalData);
    
    // Now safe to store in database (expects snake_case)
    await db.threads.add(normalized);
}
```

### 2. Creating API Endpoints that Accept Both Formats

```typescript
export default defineEventHandler(async (event) => {
    const body = await readBody(event);
    
    // Accept both camelCase and snake_case from clients
    const normalized = normalizeWireSchema(body);
    
    // Validate with Zod schema (expects snake_case)
    const validated = ThreadSchema.parse(normalized);
    
    return { success: true };
});
```

### 3. Middleware for Schema Validation

```typescript
export async function validateAndNormalizeInput(input: unknown, schema: ZodSchema) {
    // Normalize to snake_case first
    const normalized = normalizeWireSchema(input);
    
    // Then validate
    return schema.parse(normalized);
}
```

### 4. Converting Database Output for External APIs

```typescript
export async function exportToExternalService() {
    const threads = await db.threads.toArray();
    
    // Convert snake_case database schema to camelCase for external API
    const camelCaseThreads = keysToCamelCase(threads);
    
    await externalApi.upload(camelCaseThreads);
}
```

## Design Decisions

### Why snake_case for Database?

1. **SQL Convention** - Most SQL databases use snake_case
2. **Dexie Compatibility** - Works well with Dexie's IndexedDB abstraction
3. **Sync Target Compatibility** - Many backend systems (PostgreSQL, etc.) prefer snake_case
4. **Explicit Schema** - Makes it clear when data is from the database vs. in-memory

### Why Normalize on Ingestion?

1. **Single Source of Truth** - Database always uses snake_case
2. **Validation Simplicity** - Zod schemas only need to handle one format
3. **Flexibility** - Accept data from any source without forcing them to use our casing
4. **Forward Compatibility** - Easy to add new data sources

### Why Not Automatically Convert?

We don't automatically convert between formats at the Dexie layer because:

1. **Explicit is Better** - Developers should be aware of format conversions
2. **Performance** - Avoid unnecessary conversions on every database operation
3. **Type Safety** - TypeScript types should match the actual data structure
4. **Hooks Integration** - Hooks receive data in the expected format

## Testing

The casing utilities are thoroughly tested in `tests/unit/casing.test.ts`. Run tests with:

```bash
npm run test tests/unit/casing.test.ts
```

Tests cover:
- String conversion (camelCase ↔ snake_case)
- Object key conversion (recursive)
- Array handling
- Null/undefined handling
- Mixed format input
- Edge cases

## Best Practices

1. **Normalize Early** - Convert to snake_case as soon as data enters your system
2. **Use Types** - TypeScript types should match the actual casing used
3. **Document Boundaries** - Clearly document where format conversions occur
4. **Avoid Round-Tripping** - Don't convert back and forth unnecessarily
5. **Test Edge Cases** - Test with real-world data that may have unexpected formats

## Integration with Existing Systems

### Database Schema

All Zod schemas in `app/db/schema.ts` use snake_case:

```typescript
export const ThreadSchema = z.object({
    id: z.string(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    // ... more snake_case fields
});
```

### Hooks

When using hooks that process database data, the payload will be in snake_case:

```typescript
const hooks = useHooks();

hooks.addFilter('db.threads.create:filter:input', (thread) => {
    // thread has snake_case fields: created_at, updated_at, etc.
    return thread;
});
```

## Future Enhancements

Potential future improvements:

1. **Automatic Hook Integration** - Add hooks that automatically normalize input
2. **Schema Annotations** - Allow schemas to specify preferred casing
3. **Performance Optimization** - Cache conversion results for repeated operations
4. **Custom Mappings** - Support custom field name mappings beyond casing
5. **Validation Integration** - Combine normalization with Zod validation in a single step

## Related Documentation

- [Database Schema](../app/db/schema.ts) - Zod schemas using snake_case
- [Hooks System](./hooks.md) - Hook payload formats
- [Error Handling](./error-handling.md) - Validation error patterns

## Migration Guide

### For Existing Code

If you have existing code that expects camelCase from external sources:

**Before:**
```typescript
const thread = await externalApi.getThread();
// Manually convert each field
const dbThread = {
    id: thread.id,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
    // ... more manual conversions
};
```

**After:**
```typescript
const thread = await externalApi.getThread();
// Automatic conversion
const dbThread = normalizeWireSchema(thread);
```

### For New Code

When adding new features that interact with external data:

1. Import the normalization utility
2. Normalize immediately after receiving data
3. Use normalized data with database/validation
4. Convert back to camelCase only when exporting

```typescript
import { normalizeWireSchema, keysToCamelCase } from '~~/shared/utils/casing';

// Receive data
const externalData = await fetchFromExternal();

// Normalize for internal use
const normalized = normalizeWireSchema(externalData);

// Store in database (expects snake_case)
await db.threads.add(normalized);

// Export to external API (convert to camelCase)
const exported = keysToCamelCase(normalized);
await uploadToExternal(exported);
```
