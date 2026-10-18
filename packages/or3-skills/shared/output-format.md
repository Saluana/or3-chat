# Output format

Use a concise response suited to the task and the user's requested format.
Follow [completion guidance](./completion-contract.md) for relevant evidence rather than a fixed report template.

When structured output is requested, the existing field vocabulary is available:

```json
{
  "architecture": { "primarySurface": "plugin", "runtime": "isolated-client" },
  "changes": [],
  "permissions": [],
  "validation": [{ "name": "targeted check", "status": "passed" }],
  "artifactOrInstallation": null,
  "rollback": [],
  "remainingRisks": []
}
```

Include fields relevant to the request and represent unavailable artifact/installation status honestly; an empty value must not disguise a failed check.
