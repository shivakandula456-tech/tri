import { PHASE1_RULESET, evaluateRace } from './core/rules-core.js';
import { listDatasets } from './storage.js';

export const DATASET_KINDS = Object.freeze(['published', 'fixture', 'imported']);

const cache = new Map();
const evaluationCache = new Map();

export function invalidate() {
  cache.clear();
  evaluationCache.clear();
}

export async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} while fetching ${url}`);
    error.status = response.status;
    error.url = url;
    throw error;
  }
  return response.json();
}

function toEntry(race, kind, extra = {}) {
  return { race, kind, ...extra };
}

export async function getPublished() {
  if (cache.has('published')) return cache.get('published');
  const promise = (async () => {
    const index = await fetchJson('data/indexes/races-index.json');
    let statusFile = null;
    try {
      statusFile = await fetchJson('data/indexes/status.json');
    } catch {
      statusFile = null;
    }
    const entries = [];
    const failures = [];
    if (index.datasetStatus !== 'not_collected' && Array.isArray(index.races)) {
      for (const item of index.races) {
        try {
          const race = await fetchJson(item.path);
          entries.push(toEntry(race, 'published', { path: item.path }));
        } catch (error) {
          failures.push({ raceId: item.raceId, message: error.message });
        }
      }
    }
    return {
      kind: 'published',
      index,
      statusFile,
      entries,
      failures,
      note: index.datasetStatus === 'not_collected'
        ? 'No collection run has published data yet. The dashboard is showing honest empty state.'
        : null
    };
  })();
  cache.set('published', promise);
  return promise;
}

export async function getFixtures() {
  if (cache.has('fixture')) return cache.get('fixture');
  const promise = (async () => {
    const manifest = await fetchJson('data/fixtures/fixtures-manifest.json');
    const entries = [];
    const failures = [];
    for (const item of manifest.races) {
      try {
        const race = await fetchJson(`data/fixtures/${item.file}`);
        entries.push(toEntry(race, 'fixture', { path: `data/fixtures/${item.file}`, expected: item.expected, description: item.description }));
      } catch (error) {
        failures.push({ raceId: item.raceId, message: error.message });
      }
    }
    return { kind: 'fixture', manifest, entries, failures };
  })();
  cache.set('fixture', promise);
  return promise;
}

export async function getImported() {
  const rows = await listDatasets();
  const entries = [];
  for (const row of rows) {
    for (const race of row.races || []) {
      entries.push(toEntry(race, 'imported', { datasetId: row.id, datasetName: row.name, testData: race.testData === true || row.testData === true }));
    }
  }
  return { kind: 'imported', datasets: rows, entries };
}

export async function getDataset(kind) {
  if (kind === 'published') return getPublished();
  if (kind === 'fixture') return getFixtures();
  if (kind === 'imported') return getImported();
  throw new Error(`Unknown dataset kind: ${kind}`);
}

export async function getAllEntries({ includeFixtures = true, includeImported = true } = {}) {
  const parts = [];
  const published = await getPublished();
  parts.push(...published.entries);
  if (includeFixtures) {
    const fixtures = await getFixtures();
    parts.push(...fixtures.entries);
  }
  if (includeImported) {
    const imported = await getImported();
    parts.push(...imported.entries);
  }
  return parts;
}

export function entryKey(entry) {
  return `${entry.kind}:${entry.race && entry.race.raceId ? entry.race.raceId : 'unknown'}`;
}

export function evaluateEntry(entry, ruleset = PHASE1_RULESET) {
  const key = `${entryKey(entry)}:${ruleset.version}`;
  if (ruleset.locked && evaluationCache.has(key)) return evaluationCache.get(key);
  const evaluation = evaluateRace(entry.race, ruleset);
  if (ruleset.locked) evaluationCache.set(key, evaluation);
  return evaluation;
}

export function isTestEntry(entry) {
  return entry.race && entry.race.testData === true;
}

export function summarize(entries, ruleset = PHASE1_RULESET) {
  const summary = {
    total: entries.length,
    qualified: 0,
    rejected: 0,
    resolved: 0,
    unresolved: 0,
    testData: 0,
    byRejectionCode: {}
  };
  for (const entry of entries) {
    const evaluation = evaluateEntry(entry, ruleset);
    if (evaluation.status === 'qualified') summary.qualified += 1;
    else {
      summary.rejected += 1;
      const code = evaluation.rejectionCode || 'UNKNOWN';
      summary.byRejectionCode[code] = (summary.byRejectionCode[code] || 0) + 1;
    }
    if (entry.race.resultStatus === 'resolved') summary.resolved += 1;
    else summary.unresolved += 1;
    if (isTestEntry(entry)) summary.testData += 1;
  }
  return summary;
}

export function toRaceList(entries, ruleset = PHASE1_RULESET) {
  return entries.map((entry) => {
    const evaluation = evaluateEntry(entry, ruleset);
    return {
      key: entryKey(entry),
      kind: entry.kind,
      path: entry.path || null,
      race: entry.race,
      evaluation,
      testData: isTestEntry(entry)
    };
  });
}
