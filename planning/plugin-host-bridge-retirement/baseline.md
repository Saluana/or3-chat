# Installed baseline and parity

Starting host commit: `59c39b4ba9558a63b4362ade196e1de4fe3d81f1` on `or3-cloud`. This is the actual implementation starting point, newer than the planning inspection commit.

Both original 0.1.1 sibling packages were rebuilt with the original SDK and installed through package admission, grant review, browser canary, promotion and workspace enablement on an isolated Basic Auth/SQLite/filesystem host. The Agents installed spec passed; both Workflows installed specs passed, including the original no-model background run and persistence after reload. The harness selectors were refreshed for the current welcome-card disclosure and password input; baseline host and plugin production source were unchanged.

The original package tree digests and artifact SHA-256s are in `baseline-summary.json`. Screenshots and JSON artifacts live under `output/playwright/plugin-host-retirement/`, with original installed captures in `baseline/` and matched captures in `parity-baseline/` and `parity-candidate/`.

Matched capture conditions: Chromium, 1440×960, same default theme, empty saved hosts/workflows, qualification notifications marked read, cursor away from the captured controls. Only disposable qualification rows were removed. Development-overlay controls were hidden equally; no plugin content was masked. The remaining launcher difference is confined to the bottom development status badge (x712–718, y931–940).

| Surface | Prior phase 5–6 measurement | This cutover |
| --- | ---: | ---: |
| Agents sidebar | 0 / 232,560 pixels | 0 / 232,560 |
| Agents launcher | 114 / 1,382,400 (0.008%) | 55 / 1,382,400 (0.00398%) |
| Workflows sidebar | 6 / 224,000 (0.003%) | 0 / 224,000 |

All three comparisons are within the earlier measurements in `../planning/unified-plugin-extraction/phase-5-6-verification.md`. Exact image hashes, dimensions and changed-pixel bounds are recorded in `baseline-summary.json` and the local `parity.json` artifact.
