# Phase 1 ruleset (locked)

Version: `phase1-1.0.0`. The ruleset lives in `js/core/rules-core.js` as `PHASE1_RULESET` and is deep-frozen. Backtest A always uses it; every other ruleset is sandbox material and is permanently marked unlocked.

## Qualification rules

| Rule | Requirement |
| --- | --- |
| Region | `courseRegion` must be `GB`. |
| Race type | Must be `Flat`. Hurdle, Chase and NH Flat are excluded. |
| Handicap | `isHandicap` must be `true`. |
| Class | Integer 2–6 inclusive. |
| Field size | 6–12 **actual** runners. Declared non-runners are excluded from the count. |
| Odds completeness | Every actual runner needs a captured price. One missing price fails the race. |
| Strong favourite | Exactly one actual runner priced at 5/2 (decimal 3.5) or shorter. Zero fails; two or more fail. |
| Longshot | At least one actual runner priced at 10/1 (decimal 11.0) or bigger. |

Boundaries are inclusive: 5/2 counts as a strong favourite, 10/1 counts as a longshot.

## Candidate selection

The candidate is the **shortest-priced longshot**. When two longshots share the same price, the tie breaks to the **lowest runner number** and the evaluation records `tieBreakApplied: true`.

## Evaluation order and rejection codes

Rules are checked in this order; the first failure decides the rejection code, and the full trace is always recorded:

1. `REGION` → `NOT_GREAT_BRITAIN`
2. `RACE_TYPE` → `NOT_FLAT`
3. `HANDICAP` → `NOT_HANDICAP`
4. `CLASS` → `CLASS_OUT_OF_RANGE`
5. `FIELD_SIZE` → `FIELD_SIZE_OUT_OF_RANGE`
6. `ODDS_COMPLETENESS` → `INCOMPLETE_ODDS`
7. `STRONG_FAVOURITE` → `NO_STRONG_FAVOURITE` or `MULTIPLE_STRONG_FAVOURITES`
8. `LONGSHOT` → `NO_LONGSHOT`
9. `CANDIDATE` → passes only when no earlier rule failed

## Data rules

- Current odds live under runner `odds` with a `capturedAt` timestamp; the historical starting price lives under `sp`. They are never merged.
- Race identity is the stable `raceId`; runner identity is the runner number within the race. Re-runs update timestamps rather than duplicating records.
- Every record stores its source URL, retrieval time, parser version and validation status.

## Experimental sandbox (Backtest B)

`makeExperimentalRuleset` can relax regions, race types, handicap-only, classes, field bounds, the favourite mode (`exactlyOne`, `atLeastOne`, `ignore`) and thresholds. Guardrails:

- `validateExperimentalRules` bounds every value and warns whenever a setting diverges from Phase 1.
- Experimental rulesets are `locked: false` and reports carry an `UNLOCKED — sandbox only` badge.
- Experimental results must never be presented as Phase 1 results.

## Out of scope by design

Money-related measures do not exist in this project: no staking, no payouts, no ROI, no profit tracking. Backtests produce descriptive statistics about stored records only (counts, coverage, finish distributions, win counts). A test enforces that report payloads never contain those concepts.
