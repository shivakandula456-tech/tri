# Published dataset layout

```
data/
  indexes/
    races-index.json       summary of every published race (source of truth for the website tables)
    status.json            collection status, permission notes and run history
    validation-report.json written by the repository validator (npm run validate:data -- --write)
  races/YYYY/MM/YYYY-MM-DD/<raceId>.json
  logs/collection/         one JSON log per live run + rolling index
  fixtures/races/          synthetic TEST fixtures (testData=true) - never production data
  schema/                  documentation schemas; runtime validation lives in js/core/validate-core.js
```

Rules that apply to everything in this folder:

- Current odds are stored per runner under `odds` with a `capturedAt` timestamp; the historical starting price is stored separately under `sp`. The two are never merged.
- Every record keeps its source URL, retrieval timestamp, parser version and validation status.
- Race identity is the stable `raceId`; runner identity is the runner number within the race. Re-runs timestamp, not duplicate.
- Files under `fixtures/` are synthetic and must always carry `"testData": true`. The validators reject fixture records presented as published data and vice versa.
- No credentials, tokens or private information belong in this folder; the validator scans for credential-shaped keys and fails the dataset if any are found.
