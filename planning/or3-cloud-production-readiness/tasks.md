# OR3 Cloud Production Readiness Tasks

## 13. Configurable hardcoded values
> Requirements: 15

- [ ] 13.1 Make MIME type allowlist configurable via runtime config
- [ ] 13.2 Make rate limit thresholds overridable via runtime config
- [ ] 13.3 Make GC retention period configurable via runtime config
- [ ] 13.4 Make OpenRouter URL configurable for proxy setups
- [ ] 13.5 Make background job timeout configurable
- [ ] 13.6 Document all new config options

## 14. Per-user resource limits
> Requirements: 13

- [ ] 14.1 Add per-user background job concurrency limit (configurable, default 5)
- [ ] 14.2 Add per-workspace storage quota enforcement (configurable, optional)
- [ ] 14.3 Write tests for per-user job limiting
- [ ] 14.4 Write tests for storage quota rejection

## 15. Wire schema casing normalization
> Requirements: 14

- [ ] 15.1 Update sync schema validation to accept both camelCase and snake_case
- [ ] 15.2 Normalize to snake_case on ingestion
- [ ] 15.3 Write tests for both input shapes

## 16. Complete background jobs execution plan
> Requirements: from background-jobs-execution/tasks.md

- [ ] 16.1 Add structured logging for background tool/workflow execution with secret redaction
- [ ] 16.2 Add E2E tests for reattachment flow and notification emission
