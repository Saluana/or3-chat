# Extension decision tree

Classify before changing files. State the selected surface and why the lower
surface was insufficient.

| Request characteristic | Primary surface | First evidence to read |
| --- | --- | --- |
| Install, configure, connect, deploy, or repair an installation | Setup | Cloud wizard and config docs |
| Colors, typography, spacing, icons, backgrounds, or component presentation | Theme | Theme quick start and API reference |
| A pane, command, action, tool, integration, or functional UI addition | Plugin | Plugin runtime and SDK docs |
| Auth, sync, or storage implementation | Provider | Provider docs; outside this V1 skill set |
| No public extension contract can support the request | Core | Relevant public types, hooks, callers, and tests |

Use these tie-breakers:

1. Presentation-only work is a theme, even when it touches an existing plugin.
2. New behavior is a plugin when a public contract supports it.
3. Provider implementation is not core by default.
4. Core is permitted only after recording why configuration, theme, plugin, and
   provider surfaces cannot express the behavior.
5. A mixed request may use theme plus plugin, but keep their changes and
   rollback paths independently reviewable.
