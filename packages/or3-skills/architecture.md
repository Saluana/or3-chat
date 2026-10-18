# OR3 Skills architecture

Skills carry task-specific decisions and non-obvious constraints.
The target checkout's public docs, SDKs, schemas, CLIs, and implementation define exact contracts.

- Use configuration, theme, plugin, provider, or core changes according to the requested outcome.
- Prefer supported extension points, and fix core defects at their actual owner.
- Distinguish source integrations from installable SDK packages.
- Select supported portable or trusted runtimes from current host documentation and capability checks.
- Treat trusted-host as host code and fail closed when required isolation is unavailable.
- Preserve meaningful validation, truthful artifact status, and recovery information without prescribing a report template.

The shared references keep routing, safety, validation, and completion guidance consistent.
Package scripts validate metadata, local links, checkout compatibility, and fixture consistency; they do not simulate a model completing a task.
