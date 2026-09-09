# OR3 Tactics fixture notes

These notes map the authored examples to their numeric expectations for
integrators. The JSON files in `app/features/or3-tactics/tests/fixtures/` are
the unchanged source inputs. Nothing here claims that the engine or these
integrations have been tested.

## CT schedule

`ct-golden.json` uses units `a=10`, `b=8`, and `c=5`, all at CT 0. Applying
`slotPattern` in order should produce these activation records:

| # | unit | tick | CT before end turn | slots used | retained CT |
|---:|---|---:|---:|---|---:|
| 1 | a | 10 | 100 | both | 0 |
| 2 | b | 13 | 104 | one | 20 |
| 3 | a | 20 | 100 | neither | 40 |
| 4 | c | 20 | 100 | both | 0 |
| 5 | b | 23 | 100 | both | 0 |
| 6 | a | 26 | 100 | one | 20 |
| 7 | a | 34 | 100 | both | 0 |
| 8 | b | 36 | 104 | both | 0 |

The fixture has no statuses. Add separate engine cases for ready-unit ties
(descending CT, descending Speed, then ascending stable ID), Slow affecting
CT immediately, a unit killed by an owner-turn-start status before slots are
granted, retained CT values 0/20/40, and the stalled all-ineligible case.

## Formula and healing values

`formula-golden.json` checks the staged integer damage formula. The middle
column shows `scaledAttack -> rawDamage -> finalDamage -> actual HP loss`:

| case | staged values | expected |
|---|---|---:|
| `ordinary-physical` | `24 -> 21 -> 21 -> 21` | final 21, loss 21 |
| `guard-floor` | `24 -> 21 -> 10 -> 10` | final 10, loss 10 |
| `round-scaled-attack-first` | `10 -> 9 -> 9 -> 9` | final 9, loss 9 |
| `minimum-through-guard` | `2 -> 1 -> 1 -> 1` | final 1, loss 1 |
| `actual-loss-cap` | `24 -> 21 -> 21 -> 3` | final 21, loss 3 |

Healing cases are `normal-mend: floor(13*15000/10000)+5 = 24`, capped by
`missingHP=40`, and `missing-hp-cap: 24` capped to `missingHP=7`. Add tests
for the explicit minimum-damage floor, Guard's post-base-damage multiplier,
true damage bypassing defense/Guard, non-reviving healing, negative division
flooring, and forbidden or overflowing formula inputs.

## Movement and occupancy

`movement-golden.json` starts at `(0,1)` with Move 4, Climb 1 and Drop 1.
The expected reachable endpoints and accumulated costs are:

| endpoint | cost |
|---|---:|
| `(0,0)` | 1 |
| `(1,0)` | 2 |
| `(2,0)` | 4 |
| `(0,1)` | 0 |
| `(2,1)` | 2 |
| `(0,2)` | 1 |
| `(1,2)` | 2 |

The ally at `(1,1)` may be traversed but cannot be an endpoint. The enemy at
`(3,1)` and prop blocker at `(2,2)` cannot be entered, and `(4,2)` is void.
Terrain costs are destination costs; there is no hidden elevation surcharge.
Use the canonical North, East, South, West neighbor order and test equal-cost
predecessor selection with `(y, x, id)` ordering. Add cases for over-limit
climb/drop, non-walkable terrain, dead occupancy removal, origin as the valid
zero-cost endpoint, and rejection of a no-op committed move.

## Facing and line of sight

There is no standalone facing/LOS golden JSON in the authored source set.
These are required integration cases from section 5 of `02_DESIGN.md`:

- World facing is N `(0,-1)`, E `(1,0)`, S `(0,1)`, W `(-1,0)`. Determine the
  incoming attacker direction by the dominant planar axis; ties use the x
  axis. For an ability with facing enabled, front/side/back add respectively
  0/1,000/2,000 hit basis points, clamped to 10,000. Same-cell effects have
  no facing modifier.
- In `reference-content.json`, `Strike`, `Shot` and `Shield Bash` have base
  hit 8,000 and facing enabled, so their front/side/back values are
  8,000/9,000/10,000. `Venom Dart` and `Slow Hex` have base hit 8,500 but
  facing disabled; position must not change that value. Magic and healing
  cases likewise ignore facing when their fixture ability says so.
- LOS uses fixed-point semantic terrain/prop solids and a direct segment from
  source to target aim points. Intermediate LOS-blocking terrain or props
  block; living units do not. Touching an obstacle corner is blocked, the
  source/target visual sprite is not an obstacle, and camera angle or the
  displayed projectile cannot affect the result. Height tolerance and range
  remain separate checks.

Add clear-path, blocker, corner-touch, intermediate-living-unit, source/target
visual, and height-boundary cases. `Shot` supplies the reference range
`2..5`, height tolerance 4 and LOS-enabled attack; `Flame Burst` supplies an
LOS-enabled area case with range `1..4` and area height tolerance 1.

## Other authored examples

- `map-seeds.json` contains two complete coordinate grids: `map.pass` is
  16x16 with 256 cells and `map.courtyard` is 20x16 with 320 cells. Both use
  grass/stone cost 1 and mud cost 2, and include the authored player/enemy
  deployment coordinates. Props, dialogue and exact enemy records are
  intentionally absent.
- `post-encoding.json` records the source digest
  `42e6da48ccb9af62c9c09b18bf08d910ec791c11edd5aa8d7fc96a3c262f0c47`, the
  canonical prepared content/meta strings, and the host-owned timestamp/clock
  boundary. The source is not a raw database write.
- `reference-content.json` is a new numeric seed for three jobs, eight
  abilities, three statuses, six items, four party units and two encounters.
  It is explicitly not a complete canonical schema or compiled game.

The source set omits full combat resolution, RNG/replay, status timing traces,
area/friendly-fire traces, event continuations, objective/reward idempotency,
AI decisions, knockback paths, and invalid-command rollback records. Those
are integration cases to add around the shared rules; they are not implied by
the copied seed data.
