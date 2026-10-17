# Setup

## Prerequisites

- Node.js 22 or newer (24.x tested locally; CI uses 22).
- A static file server for viewing the site (any of `npx serve .`, `python -m http.server`, or an editor preview).
- Git (only needed for pushing to GitHub).

## First run

```
npm test                      # 96 tests, fully offline
npm run validate:data         # structural validation of data/
npm run validate:fixtures     # same, fixtures-only view
node collector/src/collect.js --self-test
```

The self-test parses the synthetic racecard HTML in `collector/fixtures/`, evaluates every race, validates the results and publishes them into an in-memory dataset only. It proves the whole pipeline without touching the network.

## Viewing the site locally

```
npm run preview
```

Then open http://localhost:4173/ in Chrome. The preview server is a small zero-dependency script (`tools/preview.js`) using the Node.js that already runs the tests; it supports `--port` and `--base` (e.g. `--base /atr-phase1/` to rehearse a GitHub Pages project path).

Do not open `index.html` directly from disk: browsers block ES module loading and data fetches over `file://`, which produces a blank page. The page detects this and shows instructions when it happens.

## Collector modes (local)

| Command | Network | Writes to data/ |
| --- | --- | --- |
| `--self-test` (default) | none | no (in-memory only) |
| `--dry-run` | yes | no |
| `--probe` | yes | saves raw HTML under `collector/.probe/` only |
| `--live` | yes | yes, after validation |

Network modes are intentionally gated: they will be refused unless you deliberately set the environment as documented in `docs/DATA-SOURCES.md`. Run reports are written to `collector/tmp/` (gitignored).

## Node engine notes

- The project is ESM (`"type": "module"`); all source files use `import`/`export`.
- Tests use the built-in `node:test` runner via `node --test` (run from the repository root).
- There are no runtime dependencies; `package.json` has no `dependencies` block by design, which keeps the static site and the collector auditable.
