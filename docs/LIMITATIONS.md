# Limitations

Known, current, and deliberately documented — nothing here should ever be papered over.

## Data availability

- **Automated access is blocked.** Direct requests to the intended source returned HTTP 403 on 2026-10-18. The collector refuses to bypass protection, so no real data can be collected until access is legitimately available.
- **The published dataset is empty.** `data/indexes/races-index.json` reports `not_collected`. All tables and backtests are honestly empty or fixture-based.
- **The historical window is unverified.** Whether the source exposes 2026-08-01 → 2026-08-15 to an approved collector is unknown until a probe run succeeds.
- **`parserValidatedAgainstLive` is false.** The parser has only ever been validated against bundled synthetic HTML.

## Coverage and results

- Backtests can only report on resolved races; wait for results to be collected before drawing conclusions from outcome statistics.
- Fixture-based numbers prove the engine, not real behaviour. Reports including fixtures carry a warning banner and flag every fixture row.
- Imported data is user-supplied: provenance, accuracy and completeness are the user's responsibility, and malformed rows are rejected rather than repaired.

## Platform behaviour

- **GitHub schedule reliability:** scheduled workflows are disabled after roughly 60 days without repository activity; any push or manual run re-arms them. Cron can also be delayed under load.
- **Static site constraints:** no server-side anything. The site cannot fetch third-party APIs from the browser; it only reads repository files and the user's local IndexedDB.
- **Storage is per-browser:** journal notes, strategies, runs, imports and settings live in one browser profile's IndexedDB (`atr-research-db`) and are not synced. Use Settings → Export for backups.
- **`file://` does not work:** the site must be served over HTTP (locally with a static server, or GitHub Pages).

## Engine scope

- Non-runners are excluded by declared status; a runner withdrawn after the stored snapshot is only reflected once a later snapshot records it.
- Odds are a captured snapshot, not a live feed; the capture timestamp on each price is the ground truth.
- The Phase 1 ruleset is intentionally narrow (GB Flat handicaps, classes 2–6, 6–12 runners) and locked — everything else belongs to the clearly marked experimental sandbox.
- Money-related analysis is out of scope entirely; this is a descriptive research tool, not a wagering system.
