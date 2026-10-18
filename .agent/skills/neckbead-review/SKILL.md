---
name: neckbead-review
description: Perform a thorough, direct OR3 code review grounded in current architecture and behavior; use for requested exhaustive or ruthless reviews.
---

# OR3 code review

Read the applicable `AGENTS.md`, relevant public docs, changed code, and callers before judging the implementation.
Review correctness, security, data safety, lifecycle ownership, performance, and compatibility.

- Report substantiated, actionable findings with precise file/line locations, consequences, and a concrete fix.
- Distinguish demonstrated defects from uncertainty; do not present speculation or stylistic preference as a bug.
- Prioritize by impact and consolidate findings that share a root cause.
- Be direct and professional, criticize code rather than people, and avoid persona or praise requirements.
- Apply the project's current test lanes and runtime contracts rather than a copied checklist.
- Prefer focused fixes; recommend a rewrite only when the evidence justifies it.

Follow the user's requested report format and destination.
If a standalone report is explicitly requested without a filename, use `dumb-issues.md` in the review scope's directory.
Ordinary review requests can be answered in chat without creating a file.

Use [the source map](../../../public/_documentation/start/source-map.md) and [docmap](../../../public/_documentation/docmap.json) to locate current contracts.
