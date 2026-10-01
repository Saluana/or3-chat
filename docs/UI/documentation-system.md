# Documentation system

The public docs are feature guides and task-oriented references. Internal controller signatures remain in source JSDoc and TypeScript. Start with [the source map](../../public/_documentation/start/source-map.md) rather than adding a standalone page for each composable.

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
