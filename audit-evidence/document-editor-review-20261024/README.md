# Document editor review evidence

Review: [dumb-issues.md](../../app/components/documents/dumb-issues.md)

Reviewed commit: `8e8557404d91eb6057a1d8d49faf9f7de6f34230`. Review date: 2026-10-24, America/Los_Angeles.

## Meaning of these probes

**PASS means the named defect was reproduced. These are audit demonstrations, not regression tests asserting correct behavior.** They are isolated from the normal test lanes by this directory's dedicated Vitest configuration. After a fix, move a corrected-contract regression into its canonical suite; these demonstrations should then fail or be retired.

No production exports, flags, or test-only behavior were added. Production source was not changed. IndexedDB probes use synthetic data in disposable fake-indexeddb databases and delete those databases afterward. The browser harness uses fresh browser contexts. These probes do not read or edit the user's actual document databases.

## Reproduction command

From the repository root:

```sh
bunx vitest run --config audit-evidence/document-editor-review-20261024/vitest.config.ts
```

Final result: **18 passing probes in 5 files**, captured in [probes-output.txt](probes-output.txt).

| File | Findings | Boundary and controlled inputs |
| --- | --- | --- |
| `storage.probe.test.ts` | DE-03, DE-04, DE-06, DE-07, DE-08, DE-09, DE-16 | Real CRUD/store/revision helpers and hook engine against fake-indexeddb. One read failure is injected. Native compression uses Node's Blob. The size case exercises local persistence and sanitization, not a live provider push. |
| `ai.probe.test.ts` | DE-01 (two cases), DE-11, DE-12, DE-18 | Real TipTap, snapshot/candidate/hunk logic, and AI agent. Model catalog, tokenizer, agent loop, checkpoint storage, and requested persistence errors are controlled. No model request is sent. The read-only case checks the agent boundary; Trash routing is source-traced separately. |
| `settings.probe.test.ts` | DE-05 | Real settings singleton/update implementation with a deferred KV read and a destination-recording KV writer. Production KV defaults were inspected separately. No account switch or real workspace write is performed. |
| `editor.probe.test.ts` | DE-02, DE-10 | Mounted production root, real TipTap and store/DB. Unrelated UI dependencies and AI status are controlled. A checkpoint promise gates the restore race. The real toolbar component's activation event drives the mutation. |
| `format.probe.test.ts` | DE-13, DE-14, DE-15 | Real document serializer, autocomplete plugin reducer, and AI-hunk DOM widgets. Autocomplete uses the timeout's exact metadata update; it does not simulate an actual hung network transport. Semantic click versus mousedown is exercised; a screen reader is not. |

The probes cover missing negative cases rather than duplicating happy-path coverage: work changing during awaits, ownership checks at destructive boundaries, pending-state recovery after failure, alternate command/input routes, and derived-data consistency after hooks. They assert resulting content/state or deletion, and need no production test seam. Their deliberately inverted expectations are suitable for an audit artifact, not a permanent passing safety gate.

## Existing targeted suite

```sh
bun run test app/components/documents/__tests__ app/composables/documents/__tests__ app/composables/editor/__tests__ app/utils/documents/__tests__ app/db/__tests__/documents app/db/__tests__/document-revision app/core/documents/__tests__ app/composables/__tests__/editorIntegration.test.ts app/composables/__tests__/editorNodes.test.ts app/composables/__tests__/editorToolbar.test.ts
```

Result: **191 tests passed in 33 files**, captured in [baseline-output.txt](baseline-output.txt). This is a targeted baseline, not a full-repository qualification. The initial test driver was the locally available Bun 1.4.4; the source dev launcher separately required Bun 1.3.14.

## Browser attempt and limitation

The existing repository harness was invoked with:

```sh
bun run test:e2e:journeys --grep 'local document recovery faults|document polish' --output audit-evidence/document-editor-review-20261024/browser-results
```

The first attempt was prevented from starting its IPC socket by the execution sandbox. The authorized retry reached the launcher but found Bun 1.4.4 incompatible with the vault's pinned 1.3.14 requirement. A further retry used the **already installed/cached** 1.3.14 executable on PATH:

```sh
PATH="<bun-1.3.14-bin>:$PATH" bun run test:e2e:journeys --grep 'local document recovery faults|document polish' --output audit-evidence/document-editor-review-20261024/browser-results
```

That run ended with `Timed out waiting 120000ms from config.webServer`; its log also reported the local secret vault stopping. **No browser test pass or editor failure is inferred from this startup failure.** No secret-store configuration, credentials, runtime installation, or migration was changed to force startup. The final attempt is captured in [browser-output.txt](browser-output.txt).

The filtered recovery tests deny external browser requests, use synthetic image fixtures, and avoid model/cloud mutations. Browser initialization, real IME/touch/keyboard behavior, and live provider delivery remain qualification gaps.

## Source-only findings

DE-17, DE-19, and DE-20 are based on inspected production call paths and have no dedicated probe in this folder. Additional risk areas in the report are explicitly excluded from the confirmed-finding count. No OOM experiment, hostile live import, paid AI generation, or production cloud sync operation was performed.
