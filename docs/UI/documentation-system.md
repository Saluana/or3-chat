# Documentation system

The public docs are feature guides and task-oriented references. Internal controller signatures remain in source JSDoc and TypeScript. Start with [the source map](../../public/_documentation/start/source-map.md) rather than adding a standalone page for each composable.

Use `public/_documentation/` for guides that should ship in the app. Keep
repository-specific procedures and source notes in `docs/`, and feature tasks
in `planning/`; the [repository index](../README.md#where-documentation-belongs)
explains the boundary. Maintain one guide per topic and use links or small
compatibility pointers for older paths.

## Source owners

| Module | Responsibility |
| --- | --- |
| `app/components/DocumentationShell.vue` | Viewer, navigation, search integration, and Markdown rendering. |
| `app/composables/documents/useDocumentationContent.ts` | Loads route-specific Markdown and accepts an optional content override. |
| `app/composables/documents/useDocumentationNavigation.ts` | Builds groups and page labels from docmap and manages expanded groups. |
| `app/composables/documents/useDocumentationToc.ts` | Builds the TOC from rendered headings. |
| `public/_documentation/docmap.json` | Published page inventory and navigation metadata. |

## Routing and discovery

`/documentation` resolves to `/start/overview`. The catch-all route loads the corresponding Markdown. SSR uses lazy raw modules bundled by Vite; client navigation fetches `/_documentation<slug>.md`, for example `/_documentation/database/overview.md`. Content loading follows the route path; a missing docmap entry alone does not stop a publicly served Markdown file from loading.

Docmap entries supply navigation and search discovery. Retire a page by removing its file, entry, and incoming/tooling references together. Failed loads show a Page Not Found screen. The viewer does not currently set an HTTP 404 status, so the screen alone is not proof of a 404 response.

Getting Started sorts first, then other sections alphabetically. Files sort by numeric `order`, then filename; groups use `categoryOrder`, then their label. `title` supplies a readable page label, falling back to its filename. The category groups are scoped to their section so repeated “Reference” or “Start here” labels remain distinct.

## Add a feature page

Read the existing category first. Prefer updating its task guide over creating another API mirror. Create a Markdown page under its feature directory and add an entry such as:

```json
{
  "name": "my-feature.md",
  "path": "/start/my-feature",
  "title": "Use my feature",
  "category": "Development",
  "categoryOrder": 1,
  "order": 4,
  "summary": "Explain the task and link to the source contracts."
}
```

Use `/documentation/...` Markdown links inside public pages. Verify headings and anchors against the viewer, especially when adding code or punctuation to a heading. Avoid copying complete TypeScript declarations that will drift separately from their implementation.

Run `bun scripts/release/check-docs.mjs` and open changed pages. Check sidebar labels, previous/next navigation, links, tables, syntax highlighting, and the TOC. A successful Markdown parse alone does not prove usable rendering.

## Embed the viewer

`DocumentationShell` accepts optional `content`, `navigation`, `toc`,
and `showToc` props. Omit content/navigation to use the route loader and docmap.
Custom navigation uses categories containing groups, not a flat category item
list. Its types live in `useDocumentationNavigation.ts`.

For a source component that displays supplied Markdown:

```vue
<script setup lang="ts">
import type { DocsNavCategory } from '~/composables/documents/useDocumentationNavigation';

const markdown = '# Feature guide\n\nRead the maintained guide for this feature.';
const navigation: DocsNavCategory[] = [{
  label: 'OR3',
  groups: [{
    label: 'Development',
    items: [{ label: 'Source map', path: '/documentation/start/source-map' }],
  }],
}];
</script>

<template>
  <DocumentationShell :content="markdown" :navigation="navigation" :show-toc="false" />
</template>
```

Without an explicit nonempty `toc`, the shell derives headings from rendered
content. Search uses the docmap-backed lazy SearchPanel; supplied content does
not automatically add a searchable page. Add maintained pages through docmap,
not a copied search-index implementation inside the shell.
