# Testing

Run everything with:

```
npm test        # node --test, from the repository root
```

The suite is fully offline and currently has 96 passing tests.

## What the suites cover

| File | Focus |
| --- | --- |
| `test/odds.test.js` | Fractional ↔ decimal conversion, boundaries (3.5 favourite, 11.0 longshot), common-price table, round trips. |
| `test/rules.test.js` | The full Phase 1 evaluation: order of checks, every rejection code, boundaries, non-runner handling, tie-break rule, experimental sandbox bounds. |
| `test/validate.test.js` | Record/index/status/manifest validation, odds cross-checks, duplicate detection, secret-field scanning, stored-evaluation recomputation. |
| `test/csv.test.js` | CSV escaping, combined dataset export, import round trips, orphan-row rejection, column checks. |
| `test/backtest.test.js` | Window filtering, validation gating, test-data exclusion, mismatch surfacing, outcome counting, and the guarantee that no money concepts exist in report payloads. |
| `test/parser.test.js` | Racecard and results parsing against the synthetic HTML fixtures, loud failure on malformed pages, link discovery. |
| `test/http-robots.test.js` | Robots parsing/decisions against the observed ATR snapshot, 403/429 handling, backoff, budgets, challenge-page detection. |
| `test/collector.test.js` | End-to-end self-test pipeline, blocked-source abort, robots refusal, resume state, dedupe/revision behaviour. |
| `test/fixtures.test.js` | Every `data/fixtures/races/*.json` file versus the manifest expectation, honest flags, and the empty published index/status claims. |
| `test/site-modules.test.js` | Imports every site module in Node, checks route/view wiring, the HTML shell, and that no site file hard-codes external URLs. |

## Fixture design

Twelve synthetic races (`FIX-...`) exercise: a clean qualification, non-runners with boundary-exact prices, missing favourite, duplicate favourites, small field after a non-runner, oversized field, non-handicap, hurdle, Irish venue, class 1, a longshot tie-break with a resolved result, and a runner without odds. `data/fixtures/fixtures-manifest.json` records the expected status, rejection code and candidate for each; tests fail if the engine ever drifts.

## Repository validation scripts

```
npm run validate:data       # walks data/ (published + fixtures)
npm run validate:fixtures   # fixtures only
```

Both exit non-zero on any error and are run in CI after the test suite.

## Adding tests

- Put new suites in `test/*.test.js`; the `node --test` default discovery picks them up.
- Prefer table-driven cases and explicit `assert.deepEqual` on error arrays.
- For parser changes, extend the synthetic HTML fixtures rather than adding live URLs — the suite must stay runnable offline.
