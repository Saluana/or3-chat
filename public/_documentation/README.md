# OR3 documentation

Public docs are task guides and supported feature references. Function signatures and return types for internal controllers stay in source TypeScript/JSDoc; the [source contributor map](start/source-map.md) identifies the important owners.

These files ship with the app and are discovered through `docmap.json`.
Repository-specific procedures, source integration notes, and dated maintenance
evidence belong in [`docs/`](../../docs/README.md); feature plans belong in
`planning/`. Choose one maintained home for each topic and link across those
boundaries instead of copying a second guide.

## Add or update a page

1. Read `docmap.json` and the existing feature guide before adding another page.
2. Keep usage and integration rules in the relevant category. Avoid a page per internal helper or copied interfaces.
3. Add the Markdown file and its docmap entry. Use `title` for a readable navigation label, `category` for grouping, and `categoryOrder`/`order` for intentional ordering.
4. Use root links such as `/documentation/database/overview` in rendered public docs.
5. Run `bun run check:docs` and open the page to check code blocks, tables, links, navigation, and the table of contents.

The maintained checker derives routes from docmap, checks local links and heading anchors, and detects unlisted Markdown pages. Source examples in Getting Started, OpenRouter, Database, Types, Architecture, and Utils also receive TypeScript checks against the generated Nuxt application types. Vue checks cover script blocks, not templates; other categories include partial API/config excerpts that still need source review. Run `bun run postinstall` first if Nuxt types are missing.

## Routes and navigation

`/documentation` opens the Getting Started overview. `/documentation/{section}/{file}` loads the corresponding `/_documentation/{section}/{file}.md`. For example, `/documentation/start/source-map` loads `start/source-map.md`.

The docmap supplies navigation and search discovery. Getting Started appears first; other sections sort alphabetically. Explicit file/group order wins, with filename/group fallbacks. Readable labels use `title` when present and the filename otherwise.

Removing a page requires removing its docmap entry and updating inbound links and tooling references. Keeping an unlisted Markdown file under public still serves it directly; retiring a page means removing the file too.

The viewer implementation lives in `app/components/DocumentationShell.vue` and `app/composables/documents/useDocumentation*.ts`. See [documentation system](../../docs/UI/documentation-system.md) for source implementation guidance.
