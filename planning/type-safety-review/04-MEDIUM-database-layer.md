# MEDIUM: Database Layer Type Safety Review

**Severity: MEDIUM to HIGH**

**Total occurrences: 40+ in DB layer**

## Executive Summary

The database layer has type holes around:

1. **TipTap content**: Stored as `any` JSON object (justified but needs constraints)
2. **Post type discrimination**: Using `as any` to bypass type checking on union types
3. **Hook filtering**: Database operations pass through untyped hooks
4. **Serialization**: File hashes and content parsed without validation

**Why MEDIUM not HIGH**: Database schema is stable, and Dexie provides some type safety. However, TipTap content and type discrimination are risky.

---

## Findings by Concern Area

### HIGH: TipTap Content Type

**Files:** `documents.ts`, `prompts.ts`

**Lines:** `documents.ts:32, 141, 166, 257` | `prompts.ts:30, 118, 143, 214`

```typescript
// documents.ts:32
content: any; // TipTap JSON object

// documents.ts:141
function parseContent(raw: string | null | undefined): any {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}
```

**Why:**
- **TipTap JSON is complex**: Has nodes, marks, content arrays
- **Unvalidated parse**: No schema validation after JSON.parse
- **Type propagates**: `any` spreads through get/update operations
- **Corruption risk**: Invalid JSON structure can break editor

**Fix:**

```typescript
// Define TipTap types (can be minimal)
interface TipTapNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: TipTapNode[];
    marks?: TipTapMark[];
    text?: string;
}

interface TipTapMark {
    type: string;
    attrs?: Record<string, unknown>;
}

interface TipTapDocument {
    type: 'doc';
    content: TipTapNode[];
}

// Runtime validation with Zod (optional but recommended)
import { z } from 'zod';

const TipTapNodeSchema: z.ZodType<TipTapNode> = z.lazy(() =>
    z.object({
        type: z.string(),
        attrs: z.record(z.unknown()).optional(),
        content: z.array(TipTapNodeSchema).optional(),
        marks: z.array(z.object({
            type: z.string(),
            attrs: z.record(z.unknown()).optional()
        })).optional(),
        text: z.string().optional()
    })
);

const TipTapDocumentSchema = z.object({
    type: z.literal('doc'),
    content: z.array(TipTapNodeSchema)
});

// Parsing with validation
function parseContent(raw: string | null | undefined): TipTapDocument | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        // Optional: validate in dev mode
        if (import.meta.dev) {
            return TipTapDocumentSchema.parse(parsed);
        }
        return parsed as TipTapDocument;
    } catch (e) {
        console.warn('Invalid TipTap content', e);
        return null;
    }
}

// Update interfaces
interface Document {
    id: string;
    title: string;
    content: TipTapDocument | null;
    created_at: number;
    updated_at: number;
}
```

**Tests:**
```typescript
describe('TipTap content parsing', () => {
    it('should parse valid TipTap JSON', () => {
        const json = JSON.stringify({
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }
            ]
        });
        const result = parseContent(json);
        expect(result).toHaveProperty('type', 'doc');
        expect(result?.content).toHaveLength(1);
    });
    
    it('should return null for invalid JSON', () => {
        const result = parseContent('not json');
        expect(result).toBeNull();
    });
    
    it('should handle malformed TipTap structure in dev', () => {
        const json = JSON.stringify({ type: 'invalid' });
        if (import.meta.dev) {
            expect(() => parseContent(json)).toThrow();
        }
    });
});
```

---

### MEDIUM: Post Type Discrimination

**Files:** `documents.ts`, `prompts.ts`

**Lines:** `documents.ts:199, 220, 238, 270, 311, 331, 359` | `prompts.ts:170, 182, 198, 223, 258, 270, 289`

```typescript
// documents.ts:199
() => db.posts.put(persistedRow as any),

// documents.ts:220
if (!row || (row as any).postType !== 'doc') return undefined;

// documents.ts:238
.and((r) => !(r as any).deleted)
```

**Why:**
- **Union type issue**: `posts` table stores documents, prompts, and other post types
- **TypeScript can't discriminate**: Dexie returns generic Post type
- **Unsafe casts**: Bypass type checking to access type-specific fields
- **Runtime errors**: If postType doesn't match, accessing fields fails

**Root Cause**: Posts table has multiple entity types but single type definition

**Fix:**

```typescript
// Define discriminated union
type PostType = 'doc' | 'prompt' | 'thread' | 'folder';

interface BasePost {
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
    deleted?: boolean;
}

interface DocumentPost extends BasePost {
    postType: 'doc';
    content: TipTapDocument | null;
    folderId?: string;
}

interface PromptPost extends BasePost {
    postType: 'prompt';
    content: TipTapDocument | null;
    isDefault?: boolean;
}

interface ThreadPost extends BasePost {
    postType: 'thread';
    messageCount?: number;
}

type Post = DocumentPost | PromptPost | ThreadPost;

// Type guard functions
function isDocument(post: Post): post is DocumentPost {
    return post.postType === 'doc';
}

function isPrompt(post: Post): post is PromptPost {
    return post.postType === 'prompt';
}

// Usage - no casts needed
async function getDocument(id: string): Promise<DocumentPost | undefined> {
    const row = await db.posts.get(id);
    if (!row || !isDocument(row)) return undefined;
    // TypeScript now knows row is DocumentPost
    return row;
}

// Update - properly typed
async function updateDocument(
    id: string,
    updates: Partial<Omit<DocumentPost, 'id' | 'postType'>>
): Promise<void> {
    const existing = await getDocument(id);
    if (!existing) return;
    
    const updated: DocumentPost = {
        ...existing,
        ...updates,
        updated_at: Date.now()
    };
    
    await db.posts.put(updated); // No cast needed
}
```

**Tests:**
```typescript
describe('post type discrimination', () => {
    it('should identify document posts', () => {
        const doc: Post = {
            id: '1',
            postType: 'doc',
            title: 'Test',
            content: null,
            created_at: Date.now(),
            updated_at: Date.now()
        };
        expect(isDocument(doc)).toBe(true);
        if (isDocument(doc)) {
            // TypeScript knows doc.content exists
            expect(doc.content).toBeNull();
        }
    });
    
    it('should reject non-document posts', () => {
        const prompt: Post = {
            id: '1',
            postType: 'prompt',
            title: 'Test',
            content: null,
            created_at: Date.now(),
            updated_at: Date.now()
        };
        expect(isDocument(prompt)).toBe(false);
    });
});
```

---

### MEDIUM: Hook Filter Type Loss

**Files:** `documents.ts`, `messages.ts`

**Lines:** `documents.ts:134` | `messages.ts:32, 63, 99`

```typescript
// documents.ts:134
return (hooks.applyFilters as any)(
    'db.documents.get:filter:output',
    mapped,
    { id }
);

// messages.ts:32
input as any

// messages.ts:99
? hooks.applyFilters('db.messages.get:filter:output', res as any)
```

**Why:**
- **Hooks system untyped**: As noted in hooks review, applyFilters uses `any`
- **DB operations lose types**: Filtering returns unknown type
- **Plugin risk**: Plugins could return wrong type silently

**Fix:**

Once hooks system is fixed (see 03-HIGH-core-hooks-system.md), these should become:

```typescript
// With typed hooks
return hooks.applyFilters(
    'db.documents.get:filter:output',
    mapped, // Type is Document
    { id }
); // Returns Promise<Document>

// In hook-types.ts
interface HookPayloadMap {
    'db.documents.get:filter:output': [Document, { id: string }];
    'db.messages.get:filter:output': [Message, { messageId: string }];
    // ...
}
```

**Temporary mitigation** (until hooks fixed):

```typescript
// Add type assertion helper
function applyDbFilter<T>(
    filterName: string,
    value: T,
    context: Record<string, unknown>
): Promise<T> {
    return (hooks.applyFilters as any)(filterName, value, context) as Promise<T>;
}

// Usage
return applyDbFilter('db.documents.get:filter:output', mapped, { id });
```

---

### LOW: File Hash Serialization

**Files:** `messages.ts`

**Lines:** 35-37

```typescript
// messages.ts:35-37
if (Array.isArray((filtered as any).file_hashes)) {
    (filtered as any).file_hashes = serializeFileHashes(
        (filtered as any).file_hashes
    );
}
```

**Why:**
- **Type guard missing**: Checking if property exists without type
- **Repeated casts**: Same object cast three times
- **Fragile**: If `file_hashes` field name changes, breaks silently

**Fix:**

```typescript
interface MessageWithFiles {
    file_hashes?: string[] | string;
}

function hasFileHashes(msg: unknown): msg is MessageWithFiles {
    return (
        typeof msg === 'object' &&
        msg !== null &&
        'file_hashes' in msg
    );
}

// Usage
if (hasFileHashes(filtered) && Array.isArray(filtered.file_hashes)) {
    filtered.file_hashes = serializeFileHashes(filtered.file_hashes);
}
```

---

## Summary Statistics

| File | Any Count | Primary Issue |
|------|-----------|---------------|
| documents.ts | 12 | TipTap content, post type casts |
| prompts.ts | 11 | TipTap content, post type casts |
| messages.ts | 6 | Hook filters, file hashes |
| posts.ts | 1 | Hook filters |

**Total:** 30+ type holes in core DB operations

---

## Recommended Action Plan

### Phase 1: Define Schema Types (Days 1-2)

1. Create `types/database.d.ts`:
   - `TipTapDocument`, `TipTapNode` interfaces
   - Post discriminated union (`DocumentPost`, `PromptPost`, etc.)
   - Type guard functions

2. Optional: Create `app/db/validation.ts`:
   - Zod schemas for TipTap content
   - Runtime validation for dev mode

### Phase 2: Fix Post Type Discrimination (Days 3-4)

1. **documents.ts**:
   - Replace all `(row as any).postType` with type guards
   - Remove casts in put operations
   - Update function signatures to use `DocumentPost`

2. **prompts.ts**:
   - Same as documents.ts but for `PromptPost`

### Phase 3: Fix Content Parsing (Days 5-6)

1. Update `parseContent` functions to return `TipTapDocument | null`
2. Add optional validation in dev mode
3. Update all content fields to use typed interface

### Phase 4: Wait for Hooks Fix (Dependent)

1. This depends on 03-HIGH-core-hooks-system.md being completed
2. Once hooks are typed, remove casts from hook filter calls
3. Add hook payload types to `HookPayloadMap`

### Phase 5: Testing (Days 7-8)

1. Add unit tests for type guards
2. Test content parsing with valid/invalid JSON
3. Test discriminated union usage
4. Integration tests for filtered operations

---

## Impact if Not Fixed

### Data Integrity Impact
- **TipTap corruption**: Invalid JSON can corrupt documents
- **Type confusion**: Accessing wrong fields on wrong post types
- **Silent failures**: Type errors only show up at runtime

### Maintenance Impact
- **Refactoring risk**: Changing post structure breaks silently
- **Plugin fragility**: Hooks can return wrong types
- **Schema drift**: Types and database can diverge

### Performance Impact
- **Minimal**: Type checks happen at compile time
- **Validation cost**: If adding Zod, only in dev mode

---

## Design Considerations

### TipTap Content

**Option 1: Minimal Types** (Recommended)
```typescript
interface TipTapDocument {
    type: 'doc';
    content: TipTapNode[];
}
```
- ✅ Simple, covers 80% of cases
- ✅ Easy to maintain
- ❌ Doesn't validate node structure

**Option 2: Full Type Definition**
```typescript
// Import from @tiptap/core or define exhaustively
type TipTapNode = 
    | ParagraphNode
    | HeadingNode
    | CodeBlockNode
    // ... 20+ node types
```
- ✅ Perfect type safety
- ❌ High maintenance burden
- ❌ Breaks if TipTap updates

**Option 3: Schema Validation**
```typescript
const schema = TipTapDocumentSchema.parse(json);
```
- ✅ Catches invalid data
- ✅ Self-documenting
- ❌ Runtime cost
- ❌ Schema maintenance

**Recommendation**: Use Option 1 with optional Option 3 in dev mode.

### Post Type Discrimination

**Current Problem**: Single `posts` table, multiple entity types

**Solution 1: Discriminated Union** (Recommended)
- ✅ Leverages TypeScript's type narrowing
- ✅ No runtime cost
- ✅ Type-safe access after guard

**Solution 2: Separate Tables**
- Would require schema migration
- Not worth the effort for this codebase
- Current approach is fine with proper types

---

## Files to Create/Modify

### New Files
1. `types/database.d.ts` - Core DB type definitions
2. `app/db/validation.ts` - Optional Zod schemas
3. `app/db/type-guards.ts` - Post type guard functions
4. `app/db/__tests__/type-safety.test.ts` - Type guard tests

### Modified Files
1. `app/db/documents.ts` - Remove casts, use type guards
2. `app/db/prompts.ts` - Remove casts, use type guards
3. `app/db/messages.ts` - Fix file hash typing, remove hook casts
4. `app/db/posts.ts` - Define discriminated union
5. `app/db/schema.ts` - Update table type definitions

---

## Dependencies

- **Depends on**: 03-HIGH-core-hooks-system.md (for hook filter types)
- **Blocks**: Plugin development (plugins need stable DB types)

---

## Notes

The database layer is in better shape than chat and hooks systems because:
- Dexie provides some type safety
- Schema is relatively stable
- Main issues are edge cases (TipTap, post types)

However, the TipTap content type is **HIGH risk** because:
- Editor can crash on invalid JSON
- Users could lose work if corruption occurs
- Should add validation, at least in dev mode

Post type discrimination is **MEDIUM risk**:
- Current casts work but are fragile
- Type guards are simple to add
- Low effort, high safety improvement
