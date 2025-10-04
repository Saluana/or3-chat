---
artifact_id: 7c1b0bf6-2a5f-4a12-8f8a-62f0e928ec5a
title: design.md
content_type: text/markdown
---

# Sidebar virtualization with a single scroll container and flattened items

## Overview

Goal: eliminate jank and nested overflows while scaling to thousands of sidebar items (Projects + Chats + Docs). We will:

-   Use a single scroll container sized by a measured `height` prop from the parent.
-   Replace multiple list types with one Virtualizer (virtua) fed by a flattened item model.
-   Remove nested overflows from the projects tree by rendering project rows (roots and children) as flat items with fixed heights.

This mirrors how `VirtualMessageList.vue` uses `Virtualizer` with a `scrollParent`, but adapted to heterogeneous sidebar rows.

## Architecture

```mermaid
flowchart TD
  A[SideNavContent.vue] -->|measured height + scroll ref| B[SidebarVirtualList.vue]
  B -->|single scroll div (overflow-y-auto)| C[Virtualizer]
  C -->|flatItems[] + item.height| D[Row Renderer]
  D --> E1[Section Header]
  D --> E2[Project Root Row]
  D --> E3[Project Child Row]
  D --> E4[Thread Row]
  D --> E5[Document Row]
```

Key points:

-   Only one scrolling element exists (owned by `SidebarVirtualList.vue`).
-   Virtualizer receives a `scrollRef` to that element (like `VirtualMessageList.vue`).
-   Projects are flattened: each project root and each entry is a distinct virtual row.
-   All row types have fixed heights to keep virtualization stable and prevent disappearing items.

## Components and interfaces

### Item model

```ts
// Height in px is explicit per item type for virtualization stability
type SidebarVirtualItem =
    | { type: 'sectionHeader'; key: string; label: string; height: 36 }
    | { type: 'projectRoot'; key: string; project: ProjectRow; height: 48 }
    | {
          type: 'projectChild';
          key: string;
          child: ProjectEntry;
          parentId: string;
          height: 40;
      }
    | { type: 'thread'; key: string; thread: import('~/db').Thread; height: 44 }
    | { type: 'doc'; key: string; doc: DocLite; height: 44 };

interface ProjectRow {
    id: string;
    name: string;
    data?: unknown; // normalize to ProjectEntry[] before flattening
}

interface DocLite {
    id: string;
    title: string;
    updated_at?: number;
    created_at?: number;
    postType?: string;
}
```

### SidebarVirtualList public contract

Inputs:

-   projects: ProjectRow[] (already filtered by search)
-   threads: Thread[]
-   documents: any[] (full posts) and displayDocuments?: any[] (search overrides)
-   expandedProjects: string[] (two-way via v-model:expanded)
-   activeSections: { projects?: boolean; threads?: boolean; docs?: boolean }
-   selections: activeThread(s)/activeDocument(s)
-   height: number (measured by parent)

Emitted events: unchanged from current component (select/rename/delete/add-to-project for threads/docs/projects).

### Rendering flow

```ts
// Pseudocode for flattening
const flatItems = computed<SidebarVirtualItem[]>(() => {
    const items: SidebarVirtualItem[] = [];
    if (activeSections.projects && projects.length) {
        items.push({
            type: 'sectionHeader',
            key: 'header:projects',
            label: 'Projects',
            height: 36,
        });
        for (const p of projects) {
            items.push({
                type: 'projectRoot',
                key: `project:${p.id}`,
                project: p,
                height: 48,
            });
            if (expandedProjects.includes(p.id)) {
                for (const child of normalizeProjectData(p.data)) {
                    items.push({
                        type: 'projectChild',
                        key: `project:${p.id}:${child.id}`,
                        child,
                        parentId: p.id,
                        height: 40,
                    });
                }
            }
        }
    }
    if (activeSections.threads && threads.length) {
        items.push({
            type: 'sectionHeader',
            key: 'header:threads',
            label: 'Chats',
            height: 36,
        });
        items.push(
            ...threads.map((t) => ({
                type: 'thread',
                key: `thread:${t.id}`,
                thread: t,
                height: 44,
            }))
        );
    }
    const docs = effectiveDocs.value; // from documents/displayDocuments
    if (activeSections.docs && docs.length) {
        items.push({
            type: 'sectionHeader',
            key: 'header:docs',
            label: 'Docs',
            height: 36,
        });
        items.push(
            ...docs.map((d) => ({
                type: 'doc',
                key: `doc:${d.id}`,
                doc: d,
                height: 44,
            }))
        );
    }
    return items;
});
```

### Virtualizer usage

```vue
<div
    ref="scrollEl"
    :style="{ height: `${height}px` }"
    class="overflow-y-auto overflow-x-hidden"
>
  <Virtualizer
    :data="flatItems"
    :itemSize="(it) => it.height"
    :overscan="5"
    :scrollRef="scrollEl"
    v-slot="{ item }"
  >
    <component :is="resolveRowComponent(item)" v-bind="resolveRowProps(item)" />
  </Virtualizer>
</div>
```

Row components (new):

-   SidebarProjectRoot.vue: renders project root row (expand/collapse; quick add; menu)
-   SidebarProjectChild.vue: renders a child entry with icon (chat/doc), actions

These replace the internal UTree for the sidebar. Expansion state continues to be `expandedProjects` in the parent to keep the contract stable.

## Data models

No database schema changes. We only transform/flatten UI data:

-   normalizeProjectData(data) -> ProjectEntry[] used to build child rows
-   Lightweight DocLite mapping to avoid heavy content in the list

## Error handling

-   Missing IDs: ignore rows without stable IDs (do not render; log in dev).
-   Project entry kind unknown: fallback to 'chat' icon/behavior.
-   Scroll parent not ready: default to internal root; rebind when ref resolves.
-   Events: guard emits with try/catch to avoid breaking virtualization.

ServiceResult style (for helpers, if needed):

```ts
type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };
```

## Testing strategy

-   Unit

    -   flatItems composition: project roots/children respect expandedProjects
    -   headers appear only when respective sections have data
    -   activeThreadSet/activeDocumentSet drive row active states

-   Integration

    -   Only one scroll container exists (DOM check)
    -   Expanding/collapsing projects updates flatItems without nested overflow
    -   Fast fling scroll: DOM items do not disappear (visible rows stable)
    -   Search filtering updates flatItems and scroll range

-   E2E
    -   Resize window: list height follows measured prop; no content cut off
    -   Performant with 5k+ rows (basic FPS sanity on modern hardware)

## Non-functional targets

-   Single scroll container; no nested overflows in projects section
-   Smooth scrolling at 60fps for typical datasets; overscan=5 as default
-   Stable keys: all vnodes have deterministic keys
