import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLLECTOR_VERSION = '0.1.0';
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SITE_BASE = process.env.ATR_SITE_BASE || 'https://www.attheraces.com';
export const CONTACT_URL = process.env.COLLECTOR_CONTACT_URL || 'contact-url-not-configured';
export const USER_AGENT = `atr-research-collector/${COLLECTOR_VERSION} (+${CONTACT_URL}; research use; honours robots.txt; stops on bot protection)`;
export const ROBOTS_USER_AGENT = 'atr-research-collector';

export const CONFIG = {
  siteBase: SITE_BASE,
  userAgent: USER_AGENT,
  robotsUserAgent: ROBOTS_USER_AGENT,
  requestIntervalMs: 5000,
  timeoutMs: 20000,
  maxRetries: 2,
  retryBaseMs: 1500,
  maxRetryAfterMs: 60000,
  maxRequestsPerRun: 60,
  maxRacesPerRun: 40,
  maxRunMs: 15 * 60 * 1000,
  minParseConfidence: 0.7,
  minOddsCoverage: 0.8,
  fetchResults: true,
  raceLinkHint: 'racecard/',
  selfTestDate: '2026-08-01',
  windowFrom: '2026-08-01',
  windowTo: '2026-08-15',
  paths: {
    racesDir: 'data/races',
    indexFile: 'data/indexes/races-index.json',
    statusFile: 'data/indexes/status.json',
    validationReport: 'data/indexes/validation-report.json',
    stateFile: 'data/collector-state.json',
    logsDir: 'data/logs/collection',
    tmpDir: 'collector/tmp',
    probesDir: 'collector/.probe',
    fixtureRacesDir: 'data/fixtures/races',
    fixtureManifest: 'data/fixtures/fixtures-manifest.json',
    htmlFixturesDir: 'collector/fixtures'
  }
};

export const EXIT_CODES = Object.freeze({
  OK: 0,
  BLOCKED: 2,
  VALIDATION_FAILED: 3,
  PARTIAL: 4,
  INTERNAL_ERROR: 10
});

export function racecardsIndexUrl(date, base = CONFIG.siteBase) {
  return `${base}/racecards/${date}`;
}

export function initialState() {
  return {
    version: '1.0.0',
    lastRunId: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    completedUrls: [],
    completedRaceIds: [],
    failedTargets: [],
    pendingDates: [],
    cursorDate: null
  };
}

export function emptyIndex() {
  return {
    schemaVersion: '1.0.0',
    datasetStatus: 'not_collected',
    collectorVersion: COLLECTOR_VERSION,
    parserVersion: null,
    generatedAt: null,
    window: { requestedFrom: CONFIG.windowFrom, requestedTo: CONFIG.windowTo },
    counts: { races: 0, qualified: 0, rejected: 0, resolvedResults: 0 },
    coverage: { daysWithData: [], daysWithoutData: [] },
    integrity: { structuralHash: null, lastValidatedAt: null, status: 'not_run' },
    races: []
  };
}
