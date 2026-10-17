# Collection logs

This folder receives one JSON log per live collection run, named `<runId>.json`, plus a rolling `index.json` that lists the most recent 100 runs.

- Logs are written by `collector/src/collect.js` only in `--live` mode, after the run completes or aborts.
- Each log contains counts, failures (capped at 50 entries), notes, robots decisions, parser version and the exit code.
- Full-fidelity run reports are also uploaded as GitHub Actions artifacts for every run, including self-test and dry runs that never touch this folder.
- No credentials or private tokens are ever written here. The repository validation (`npm run validate:data`) rejects any file containing credential-shaped field names.
- Logs appear only after the first live run; an empty folder is expected until then.
