# Choosing an extension surface

| Requested outcome | Usual surface | Current checkout documentation |
| --- | --- | --- |
| Install, configure, connect, deploy, or repair an installation | Setup | Cloud setup, wizard, and configuration |
| Colors, typography, spacing, icons, backgrounds, or presentation | Theme | Theme API, styling, and component overrides |
| New panes, commands, actions, tools, or integrations | Plugin | Plugin runtime, SDK, and source registries |
| Auth, sync, or storage implementation | Provider | Provider guides and selected package |
| Core defect, host-owned behavior, or a missing extension contract | Core | Feature guide, public types, callers, and tests |

Prefer a supported extension surface when it fits; explain the choice only when a material tradeoff or missing contract needs review.
A provider implementation is not automatically a core change, and presentation-only work can remain a theme even inside a plugin.
Mixed theme/plugin work can share a task while preserving clear ownership and removal paths.
Do not manufacture a new abstraction to avoid fixing an existing core defect.
