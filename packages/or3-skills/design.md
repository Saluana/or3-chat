# OR3 Skills V1 design

The package has four short entry-point skills and six shared references. The
entry points carry routing and workflow decisions; the shared references hold
rules that must remain consistent across all skills. Scripts validate the skill
format, inspect an OR3 checkout, detect documentation drift, and verify the
evaluation corpus.

The skills use direct checkout paths instead of a copied documentation bundle:
the checkout's `AGENTS.md`, docmap, public API docs, tests, and implementation
are authoritative. This avoids a second documentation source that can drift.

Scripts emit human-readable output by default and structured JSON with
`--json`. They report missing contracts as errors and warnings separately, so
automation can fail closed without hiding compatibility uncertainty.
