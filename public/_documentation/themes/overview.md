# Themes overview

Themes control OR3's colors, fonts, icons, backgrounds, controls, and selected
app components. You can customize the current theme without creating a package.

| Your goal | Start here |
| --- | --- |
| Change your own appearance | [Customize your appearance](/documentation/themes/customize) |
| Make an installable visual theme | [Build your first theme](/documentation/themes/first-theme) |
| Add styles, icons, or control recipes | [Style your theme](/documentation/themes/styling) |
| Replace a Vue surface | [Replace app components](/documentation/themes/component-overrides) |
| Distribute or install a theme | [Package and install](/documentation/themes/package-install) |

## Choose an authoring path

**Declarative themes** contain `or3.theme.json`, a manifest, and optional local
CSS/assets. They can define tokens, icons, UI recipes, and overrides without
shipping executable code. Start here for visual themes.

**Trusted-code themes** contain `theme.ts` and can include Vue replacements and
TypeScript helpers. They run as application code and require a trusted source.
A theme is not a plugin sandbox. Both installation paths require an administrator
and build-time discovery; installing a ZIP does not dynamically add a theme to
an existing production bundle.

The source scaffold, `bun run theme:create ocean-dark`, creates a trusted-code
`theme.ts` and README. It does not create a declarative package or its manifest.
The first tutorial explains both how to make a declarative package and how to
preview it in a source checkout.

## Learn in order

1. Build the small two-file theme in [Build your first theme](/documentation/themes/first-theme).
2. Add one feature at a time with [Style your theme](/documentation/themes/styling).
3. Follow [Package and install](/documentation/themes/package-install) for distribution.

Use [Theme reference](/documentation/themes/api-reference) for exact fields and
methods, [Runtime and architecture](/documentation/themes/architecture) for
SSR and persistence, and [Troubleshooting](/documentation/themes/troubleshooting)
when the result differs from your expectation.

## Examples in the checkout

`app/theme/blank`, `app/theme/retro`, and `app/theme/cyberpunk` are trusted source
themes. Study their tokens and recipes; copying their TypeScript/Vue files into
a declarative ZIP will be refused. A packaged workspace profile is offered as a
choice, not applied automatically when its theme is selected. See
[Workspace profiles](/documentation/architecture/workspace-profiles).
