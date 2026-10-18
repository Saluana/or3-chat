---
name: plugin-development
description: Develop OR3 source extensions or installable plugins using the current registry and SDK contracts.
---

# OR3 plugin development

Use [the maintained plugin skill](../../../packages/or3-skills/skills/or3-plugin-development/SKILL.md) for runtime selection, grants, packaging, and validation.
Source integrations and installable SDK packages have different import and trust boundaries.

- Locate source-owned contributions through [the source map](../../../public/_documentation/start/source-map.md).
- For a source pane/sidebar integration, use [the current tutorial](../../../public/_documentation/start/mini-app-tutorial.md).
- For an installable package, use [the plugin guide](../../../public/_documentation/plugins/first-plugin.md) and [SDK](../../../public/_documentation/plugins/plugin-sdk.md).
- Use the defining registry's actual registration/cleanup contract; helpers do not all share the same interface.
- Select tool runtimes and background behavior using [tool runtime](../../../public/_documentation/utils/tool-runtime.md) and [background capabilities](../../../public/_documentation/cloud/background-execution.md).

Keep API examples in the maintained documentation rather than copying them into this skill.
