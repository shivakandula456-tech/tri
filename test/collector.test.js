import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHashes,
  createMemoryIO,
  mergeIndex,
  parseArgs,
  planRaceWrites,
  resolveDates,
  runPipeline,
  runSelfTest
} from '../collector/src/collect.js';
import { CONFIG, emptyIndex, initialState } from '../collector/src/config.js';
import { evaluateRace, evaluationSummary } from '../js/core/rules-core.js';

function makeRace(overrides = {}) {
  const race = {
    raceId: 'COLLECT-1',
    dataset: 'published',
    testData: false,
    source: 'atr',
    sourceUrl: 'https://www.attheraces.com/racecard/x/2026-08-01/1',
    retrievedAt: '2026-08-01T17:00:00.000Z',
    parserVersion: 'atr-parser-0.1.0',
    date: '2026-08-01',
    time: '14:10',
    course: 'Fixtureton',
    courseRegion: 'GB',
    raceType: 'Flat',
    isHandicap: true,
    class: 4,
    name: 'Test Handicap',
    declaredRunners: 6,
    actualRunners: 6,
    resultStatus: 'unresolved',
    validation: { status: 'passed', checks: [] },
    runners: [
      { runnerNumber: 1, name: 'A', status: 'runner', odds: { fractional: '6/4', decimal: 2.5 }, sp: null, finishPosition: null, resultStatus: null },
      { runnerNumber: 2, name: 'B', status: 'runner', odds: { fractional: '4/1', decimal: 5 }, sp: null, finishPosition: null, resultStatus: null },
      { runnerNumber: 3, name: 'C', status: 'runner', odds: { fractional: '12/1', decimal: 13 }, sp: null, finishPosition: null, resultStatus: null },
      { runnerNumber: 4, name: 'D', status: 'runner', odds: { fractional: '6/1', decimal: 7 }, sp: null, finishPosition: null, resultStatus: null },
      { runnerNumber: 5, name: 'E', status: 'runner', odds: { fractional: '16/1', decimal: 17 }, sp: null, finishPosition: null, resultStatus: null },
      { runnerNumber: 6, name: 'F', status: 'runner', odds: { fractional: '8/1', decimal: 9 }, sp: null, finishPosition: null, resultStatus: null }
    ],
    ...overrides
  };
  race.evaluation = evaluateRace(race);
  return race;
}

test('self-test pipeline parses fixtures, evaluates, validates and publishes in memory only', async () => {
  const report = await runSelfTest();
  assert.equal(report.status, 'ok');
  assert.equal(report.exitCode, 0);
  assert.equal(report.counts.parsed, 2);
  assert.equal(report.counts.parseFailed, 1);
  assert.equal(report.expectedFailures, 1);
  assert.equal(report.unexpectedFailures, 0);
  assert.equal(report.publishedFiles.length, 2);
  assert.equal(report.counts.evaluatedQualified, 2);
  assert.equal(report.blocked, false);
});

test('duplicate detection skips identical snapshots and creates revisions for changes', () => {
  const race = makeRace();
  const { structuralHash, snapshotHash } = computeHashes(race);
  const summary = { ...evaluationSummary(race, race.evaluation, { path: 'data/races/x.json' }), structuralHash, snapshotHash, revision: 1 };
  const existingById = new Map([[race.raceId, summary]]);
  const first = planRaceWrites([{ record: race, sourceUrl: race.sourceUrl, confidence: 1, checks: [] }], existingById);
  assert.equal(first.writes.length, 0);
  assert.equal(first.skipped, 1);

  const changed = makeRace();
  changed.runners[0].odds = { fractional: '7/4', decimal: 2.75 };
  const second = planRaceWrites([{ record: changed, sourceUrl: changed.sourceUrl, confidence: 1, checks: [] }], existingById);
  assert.equal(second.writes.length, 1);
  assert.equal(second.updated, 1);
  assert.equal(second.writes[0].revision, 2);
});

test('mergeIndex sorts, deduplicates by raceId and recomputes coverage', () => {
  const existing = emptyIndex();
  existing.races = [{
    raceId: 'COLLECT-2',
    date: '2026-08-02',
    time: '15:00',
    course: 'Zeta',
    status: 'qualified',
    resultStatus: 'unresolved',
    path: 'data/races/2026/08/2026-08-02/COLLECT-2.json'
  }];
  const race = makeRace();
  const summary = { ...evaluationSummary(race, race.evaluation, { path: 'data/races/2026/08/2026-08-01/COLLECT-1.json' }), structuralHash: 'x', snapshotHash: 'y' };
  const merged = mergeIndex(existing, [summary]);
  assert.equal(merged.counts.races, 2);
  assert.equal(merged.races[0].date, '2026-08-01', 'entries are sorted by date');
  assert.equal(merged.datasetStatus, 'published');
  assert.deepEqual(merged.coverage.daysWithData, ['2026-08-01', '2026-08-02']);
  assert.equal(merged.coverage.daysWithoutData.length, 13);
});

test('a blocked source aborts the run, publishes nothing and exits with the blocked code', async () => {
  const io = createMemoryIO({
    [CONFIG.paths.indexFile]: `${JSON.stringify(emptyIndex())}\n`,
    [CONFIG.paths.stateFile]: `${JSON.stringify(initialState())}\n`
  });
  const client = {
    stats: { requests: 0, retries: 0, blocked: false, totalBytes: 0 },
    async request(url) {
      this.stats.requests += 1;
      if (url.endsWith('/robots.txt')) {
        return { ok: true, status: 200, headers: {}, body: 'User-agent: *\nDisallow:\n', attempts: 1, url };
      }
      return { ok: false, status: 403, blocked: true, reason: 'http_403', headers: {}, body: '', attempts: 1, url };
    }
  };
  const report = await runPipeline({ mode: 'dry-run', dates: ['2026-08-01'], client, io, config: CONFIG });
  assert.equal(report.status, 'blocked');
  assert.equal(report.blocked, true);
  assert.equal(report.blockedReason, 'http_403');
  assert.equal(report.exitCode, 2);
  const raceFiles = Object.keys(io.snapshot()).filter((key) => key.startsWith(`${CONFIG.paths.racesDir}/`));
  assert.equal(raceFiles.length, 0);
  assert.ok(report.notes.some((n) => n.includes('No bypass was attempted')));
});

test('robots disallow rules stop the run before any page fetch', async () => {
  const io = createMemoryIO({});
  let racecardRequests = 0;
  const client = {
    stats: { requests: 0, retries: 0, blocked: false, totalBytes: 0 },
    async request(url) {
      this.stats.requests += 1;
      if (url.endsWith('/robots.txt')) {
        return { ok: true, status: 200, headers: {}, body: 'User-agent: *\nDisallow: /racecards/\n', attempts: 1, url };
      }
      racecardRequests += 1;
      return { ok: true, status: 200, headers: {}, body: '', attempts: 1, url };
    }
  };
  const report = await runPipeline({ mode: 'dry-run', dates: ['2026-08-01'], client, io, config: CONFIG });
  assert.equal(report.status, 'blocked');
  assert.ok(report.blockedReason.startsWith('robots_disallow'));
  assert.equal(racecardRequests, 0);
});

test('resume state skips already completed urls on live runs', async () => {
  const indexHtml = '<a href="/racecard/fixtureton/2026-08-01/1001">x</a><a href="/racecard/fixtureton/2026-08-01/1002">y</a>';
  const racecardHtml = '<div data-race-id="1001" data-race-date="2026-08-01" data-course="X" data-course-region="GB" data-race-type="Flat" data-race-class="4" data-race-handicap="true" data-race-name="Handicap"><ul><li data-runner-number="1" data-runner-name="A" data-odds="6/4"></li><li data-runner-number="2" data-runner-name="B" data-odds="12/1"></li><li data-runner-number="3" data-runner-name="C" data-odds="4/1"></li></ul></div>';
  const io = createMemoryIO({
    [CONFIG.paths.indexFile]: `${JSON.stringify(emptyIndex())}\n`,
    [CONFIG.paths.stateFile]: `${JSON.stringify({ ...initialState(), completedUrls: [`${CONFIG.siteBase}/racecard/fixtureton/2026-08-01/1001`] })}\n`
  });
  let fetchedRacecards = 0;
  const client = {
    stats: { requests: 0, retries: 0, blocked: false, totalBytes: 0 },
    async request(url) {
      this.stats.requests += 1;
      if (url.endsWith('/robots.txt')) return { ok: true, status: 200, headers: {}, body: 'User-agent: *\nDisallow:\n', attempts: 1, url };
      if (url.endsWith('/racecards/2026-08-01')) return { ok: true, status: 200, headers: {}, body: indexHtml, attempts: 1, url };
      fetchedRacecards += 1;
      return { ok: true, status: 200, headers: {}, body: racecardHtml, attempts: 1, url };
    }
  };
  const report = await runPipeline({ mode: 'live', dates: ['2026-08-01'], client, io, config: CONFIG });
  assert.equal(fetchedRacecards, 1, 'the completed url is skipped and only the new one is fetched');
  assert.equal(report.counts.skippedDuplicates, 1);
  const state = io.readJson(CONFIG.paths.stateFile);
  assert.equal(state.completedUrls.length, 2);
});

test('argument parsing and date resolution behave as documented', () => {
  const args = parseArgs(['--dry-run', '--from', '2026-08-01', '--to', '2026-08-03', '--max-races', '5']);
  assert.equal(args.mode, 'dry-run');
  assert.equal(args.maxRaces, 5);
  const dates = resolveDates(args, new Date('2026-08-10T12:00:00Z'));
  assert.deepEqual(dates, ['2026-08-01', '2026-08-02', '2026-08-03']);
  const single = resolveDates(parseArgs(['--date', '2026-08-15']), new Date('2026-08-10T12:00:00Z'));
  assert.deepEqual(single, ['2026-08-15']);
  const fallback = resolveDates(parseArgs([]), new Date('2026-08-10T12:00:00Z'));
  assert.deepEqual(fallback, ['2026-08-10']);
});
