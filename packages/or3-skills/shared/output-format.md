# Output format

Keep normal reports concise and use the headings defined in the
[completion contract](./completion-contract.md). If structured output is
requested, preserve these fields:

```json
{
  "architecture": { "primarySurface": "plugin", "runtime": "v1" },
  "changes": [],
  "permissions": [],
  "validation": [{ "name": "targeted test", "status": "passed" }],
  "artifactOrInstallation": null,
  "rollback": [],
  "remainingRisks": []
}
```

Use `null` for an unavailable artifact or installation status; do not replace a
failure with an empty success-shaped value.
