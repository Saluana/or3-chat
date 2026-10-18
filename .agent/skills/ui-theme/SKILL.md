---
name: ui-theme
description: Design and implement OR3 visual changes through its theme system, Nuxt UI variants, and supported component overrides.
---

# OR3 UI and theme design

Use [the maintained theme skill](../../../packages/or3-skills/skills/or3-theme-development/SKILL.md) and the current theme documentation.
Choose reasonable visual defaults from the request, active theme, and existing surfaces; request references only when the design direction is materially ambiguous.

- Preserve semantic tokens, component identifiers, and the active theme's visual language.
- Centralize shared Nuxt UI variants and avoid a parallel styling system.
- `v-theme` decorates DOM; use `useThemeOverrides()` for reactive component props and pass contexts explicitly when required.
- Verify the affected light/dark, responsive, interaction, and accessibility states.
- Prefer supported tokens/overrides before a trusted component replacement; explain executable theme code when packaging.

See [styling](../../../public/_documentation/themes/styling.md), [API reference](../../../public/_documentation/themes/api-reference.md), and [component overrides](../../../public/_documentation/themes/component-overrides.md).
