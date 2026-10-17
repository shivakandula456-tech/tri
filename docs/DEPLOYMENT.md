# Deployment and operations

## GitHub Pages (static site)

The site is a plain static bundle served from the repository root. Exactly what to click on GitHub:

1. Open the repository on GitHub, then click **Settings** in the repository's top tab bar.
2. In the left sidebar click **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Under **Branch**, choose **main** and folder **/(root)**, then click **Save**.
5. Wait for the "Your site is live at …" banner (usually under two minutes), then click **Visit site** or open `https://<owner>.github.io/<repo>/` directly.

Requirements and honesty notes:

- On the free plan the repository must be **public** for Pages to publish; private repositories need GitHub Pro.
- `.nojekyll` at the repository root disables Jekyll processing so nothing is filtered out.
- The site only counts as **deployed** once that HTTPS URL has actually been opened and the Dashboard is confirmed to render. Until then, treat it as not deployed.
- Every push to `main` — including future live collection commits — republishes automatically; there is no build step.
- Optional: tick **Enforce HTTPS** on the same Pages settings screen once available.

The site must be served over HTTP (GitHub Pages does this). Opening `index.html` from disk with `file://` shows a blank page because browsers refuse to load ES modules and data fetches from disk; use `npm run preview` locally (see README) or the Pages URL.

## Repository variable

Create the repository variable **`COLLECTOR_ENABLED`** (Settings → Secrets and variables → Actions → Variables; it is a variable, not a secret):

- Absent or any value other than `true`: the scheduled workflow runs only `--self-test` (offline, no network).
- `true`: the schedule runs `--live`, and manual dispatch unlocks `dry-run`, `probe` and `live`.

Set it to `true` only after written permission and a reviewed probe run (see `docs/DATA-SOURCES.md`). The workflow additionally refuses `live` unless the variable is `true`, and the collector itself refuses `--live` without `COLLECTOR_LIVE_CONFIRMED=1`, which only the workflow sets.

## Workflows

### `ci.yml`

Runs on pushes to `main`, pull requests and manual dispatch: installs Node 22, runs the full test suite, then validates the data tree (`validate:data`, `validate:fixtures`). Any failure fails the check.

### `collect-atr.yml`

- **Schedule:** daily at 06:17 UTC. Mode resolves to `self-test` unless `COLLECTOR_ENABLED=true` (then `live`).
- **Manual dispatch inputs:** `mode` (`self-test`, `dry-run`, `probe`, `live`), `from`, `to`, `max_races`.
- Tests run first as a safety gate in every mode.
- Run reports are uploaded as artifacts (`collector-report-<run number>`), and `collector/tmp/summary.md` is appended to the job summary.
- Only `live` commits: `chore(data): collection run <timestamp>` onto `main`, then pushes. Empty diffs are skipped.

## Operating notes

- GitHub disables scheduled workflows after ~60 days without repository activity. Pushing any commit (including a manual dispatch) re-arms the schedule.
- To research the historical window (2026-08-01 → 2026-08-15), dispatch with explicit `from`/`to` inputs; scheduled runs default to the current UTC day.
- Rollback: revert the unwanted `chore(data): ...` commit; the next Pages build restores the previous dataset.
- Local rehearsal of any workflow behaviour: `npm test`, then `node collector/src/collect.js --self-test`.
- The collector is deliberately conservative: one request at a time with throttling, bounded request budgets, and permanent stops on blocks. Do not raise budgets without re-reading `docs/DATA-SOURCES.md`.
