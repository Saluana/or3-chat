# File Hashing & Storage Performance

This document captures performance expectations and instrumentation for the file hashing + storage pipeline.

## Instrumentation

Dev‑only `performance.mark` / `performance.measure` calls were added in:

-   `app/utils/hash.ts` – Marks: `hash:md5:subtle:bytes=<n>` or `hash:md5:stream:bytes=<n>` plus error variants.
-   `app/db/files.ts` – Marks: `file:create:bytes=<n>` when a new file is inserted, and `file:ref:bytes=<n>` when an existing file is re‑referenced (dedupe path).

Console `debug` logs (guarded by dev build) provide concise timing summaries:

```
[perf] computeFileHash stream 210.4KB 42.3ms
[perf] file store create 210.4KB 8.7ms
```

## Expected Timings (Baseline Targets)

| Operation                | Size                | Target (Cold)   | Notes                                      |
| ------------------------ | ------------------- | --------------- | ------------------------------------------ |
| MD5 (subtle)             | ≤4MB (single read)  | ~5–40ms per MB  | Uses Web Crypto when available.            |
| MD5 (stream)             | >4MB or unsupported | ~35–55ms per MB | 256KB chunk size yields UI responsiveness. |
| Store (create) meta+blob | ≤1MB                | <15ms           | IndexedDB put of meta + blob.              |
| Store (ref path)         | any                 | <5ms            | Only ref count increment.                  |

Empirical target in requirements: <150ms for ~200KB end‑to‑end (hash + create). With current chunk size this remains well below (typically <60ms on modern hardware).

## Adjusting Chunk Size

`CHUNK_SIZE` in `hash.ts` is 256KB. Increasing improves throughput but risks longer main thread blocks; decrease for smoother interactivity on low‑end devices.

## Viewing Marks

In DevTools Performance panel, filter for `hash:` or `file:` measures to inspect durations.

Programmatically:

```js
performance
    .getEntriesByType('measure')
    .filter((m) => m.name.startsWith('hash:'));
```

## Future Enhancements

1. Web Worker offload for large (>8MB) files (Task 10.2).
2. Adaptive chunk size based on device performance (RTT heuristics or timing feedback).
3. Aggregate rolling average metrics surfaced in a tiny dev overlay.
4. Add percentile sampling for hashing durations (P50/P95) to console summary on unload in dev.

## Troubleshooting

| Symptom             | Possible Cause                                | Mitigation                                                   |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| Missing marks       | Running in production build                   | Enable dev mode / ensure `import.meta.dev` true.             |
| High durations      | Low‑end hardware or background tab throttling | Consider worker offload or smaller chunk size.               |
| Jank during hashing | Large single blob path                        | Stream fallback already mitigates; worker offload next step. |

---

Document version: 1.0 (Task 7.2)
