# Wizard-only runtime — evidence

Produced by `bun run test:e2e:setup-wizard` (R1, R2 and W1–W6 in
[planning/setup-ux/journeys.md](../../planning/setup-ux/journeys.md), all
passing) with the wizard served by its own host instead of a Nuxt dev server.
The two screenshots (first step, Advanced setup open) show the page looks the same as in
[setup-wizard-20261016](../setup-wizard-20261016/README.md).


`timings.json`, measured on one machine after `bun install`, from the
`bun run setup --ui --no-open` launch to the first screen being interactive
(the browser's session request answered and a template card clicked):

| Run | Before (Nuxt dev host) | After, cold: page rebuilt first | After, page already built |
| --- | --- | --- | --- |
| 1 | 55.0 s | 4.5 s | 1.0 s |
| 2 | 60.0 s | 4.0 s | 1.0 s |
| 3 | — | 4.4 s | 1.0 s |

"Before" comes from the two last runs of the previous harness; the warm column
is three fresh `setup` processes with the page left in
`node_modules/.cache/or3-wizard-ui/`.
