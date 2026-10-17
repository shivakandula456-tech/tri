# ATR Phase 1 Research

A personal, static research dashboard for a single locked horse-racing ruleset ("Phase 1"). It evaluates race records against fixed rules, keeps a research journal, runs descriptive backtests and stores everything in the browser. There is no server, no account and no money concept anywhere in the project by design.

## Current status (honest snapshot)

- Test suite: 96 passing tests (`npm test`).
- Published dataset: **none yet** — `data/indexes/races-index.json` honestly reports `not_collected`.
- Test fixtures: 12 synthetic races covering every rule path, boundary and tie-break.
- Collector: **disabled** by default. Automated access was attempted on 2026-10-18 and the source answered **HTTP 403**; the collector hard-stops on blocks and never attempts to bypass protection.
- Parser: validated against bundled synthetic fixtures only; `parserValidatedAgainstLive` is `false` and stays `false` until a real probe run succeeds and is reviewed.

## The locked Phase 1 ruleset

Region GB only · Flat only · handicaps only · classes 2–6 · 6–12 actual runners (non-runners excluded) · complete odds required · exactly one strong favourite at 5/2 (3.5) or shorter · at least one longshot at 10/1 (11.0) or bigger · candidate = shortest-priced longshot, ties broken by lowest runner number. Full detail and the evaluation order live in `docs/RULES.md`.

## Repository layout

```
index.html              static site entry (GitHub Pages, branch deploy from root)
css/styles.css          site styling
js/core/                shared engine: odds, rules, validation, backtests, CSV
js/app.js, js/ui.js     router / DOM helpers
js/data.js              dataset loading (published, fixtures, imports)
js/storage.js           IndexedDB wrapper (atr-research-db)
js/views/               dashboard, finder, selection, backtests, strategy, validation, settings
collector/src/          Node collector (robots-aware, block-aware, disabled by default)
collector/fixtures/     synthetic HTML used by parser tests + observed robots.txt snapshot
data/                   published dataset tree (currently empty), fixtures, schemas, logs
test/                   node:test suites
.github/workflows/      CI + guarded collection workflow
docs/                   setup, deployment, rules, data sources, testing, limitations
```

## Quickstart

```
npm test                 # full suite (works offline)
npm run validate:data    # structural validation of the data/ tree
npm run validate:fixtures
node collector/src/collect.js --self-test   # offline end-to-end collector rehearsal
```

### Do not double-click index.html (important)

Opening the site by double-clicking `index.html` shows a blank page: Chrome (and every other modern browser) refuses to load JavaScript ES modules and `fetch()` JSON files from `file://` URLs. The console reports `blocked by CORS policy ... origin 'null'`. This is a browser security rule, not a bug in this project — the site must be served over HTTP. The page now detects this situation and explains it on screen instead of staying blank.

### Local preview on Windows (no extra installations)

This PC already has Node.js (it is used for `npm test`), and the repository ships its own zero-dependency preview server:

```
npm run preview
```

Then open **http://localhost:4173/** in Chrome. Press Ctrl+C in the terminal to stop the server.

You do not need to install anything new to use the website:

- The main intended way to use the site is the deployed GitHub Pages URL (see `docs/DEPLOYMENT.md`).
- If VS Code is already installed, the Live Server extension can also serve the folder, but `npm run preview` needs no extensions at all.

## Enabling collection

Collection stays off until the repository owner has written permission from the source and has reviewed a probe run. The step-by-step procedure, including the `COLLECTOR_ENABLED` repository variable that gates all network modes in CI, is in `docs/DEPLOYMENT.md` and `docs/DATA-SOURCES.md`. The workflows refuse network access without that variable; a scheduled run does nothing but the offline self-test until it is set.

## Ground rules this project follows

- No staking, payout, ROI or profit tracking — not even in test data.
- Fixtures are always labelled `TEST DATA` and can never be exported as published data.
- The parser fails loudly rather than inventing partial records; validation status is stored with every race.
- Current odds and starting price are stored separately and never merged.
