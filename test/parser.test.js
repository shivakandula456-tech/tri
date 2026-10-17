import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyResultsPatch, discoverRaceLinks, parseRacecard, parseResults } from '../collector/src/atr-parser.js';
import { evaluateRace } from '../js/core/rules-core.js';
import { isBlockPage } from '../collector/src/http.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'collector', 'fixtures');
const readFixture = (name) => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

const indexUrl = 'https://www.attheraces.com/racecards/2026-08-01';
const racecard1001Url = 'https://www.attheraces.com/racecard/fixtureton/2026-08-01/1001';

test('racecard parsing extracts every locked field from the synthetic fixture', () => {
  const html = readFixture('synthetic-racecard-1001.html');
  const result = parseRacecard(html, { sourceUrl: racecard1001Url, retrievedAt: '2026-08-01T17:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.ok(result.confidence >= 0.7, `confidence ${result.confidence}`);
  const race = result.race;
  assert.equal(race.raceId, '1001');
  assert.equal(race.date, '2026-08-01');
  assert.equal(race.time, '14:10');
  assert.equal(race.course, 'Fixtureton');
  assert.equal(race.courseRegion, 'GB');
  assert.equal(race.raceType, 'Flat');
  assert.equal(race.isHandicap, true);
  assert.equal(race.class, 4);
  assert.equal(race.declaredRunners, 9);
  assert.equal(race.actualRunners, 8);
  assert.equal(race.runners.length, 9);
  const nonRunner = race.runners.find((r) => r.runnerNumber === 9);
  assert.equal(nonRunner.status, 'non_runner');
  assert.equal(race.runners[0].odds.fractional, '6/4');
  assert.equal(race.runners[0].odds.decimal, 2.5);
  assert.equal(race.runners.find((r) => r.runnerNumber === 5).odds.decimal, 17);
  assert.equal(race.resultStatus, 'unresolved');
});

test('a parsed racecard flows through the Phase 1 engine to a qualified selection', () => {
  const result = parseRacecard(readFixture('synthetic-racecard-1001.html'), { sourceUrl: racecard1001Url, retrievedAt: '2026-08-01T17:00:00.000Z' });
  const evaluation = evaluateRace(result.race);
  assert.equal(evaluation.status, 'qualified');
  assert.equal(evaluation.candidate.runnerNumber, 3);
  assert.equal(evaluation.candidate.decimal, 13);
  assert.equal(evaluation.actualRunners, 8);
});

test('results parsing merges finish positions, SP and non-finisher status', () => {
  const html = readFixture('synthetic-racecard-1002-results.html');
  const parsed = parseRacecard(html, { sourceUrl: 'https://www.attheraces.com/racecard/fixtureton/2026-08-01/1002', retrievedAt: '2026-08-01T17:00:00.000Z' });
  assert.equal(parsed.ok, true);
  const results = parseResults(html, { race: parsed.race, retrievedAt: '2026-08-01T18:00:00.000Z' });
  assert.equal(results.ok, true);
  assert.equal(results.patch.resultStatus, 'resolved');
  const merged = applyResultsPatch(parsed.race, results.patch, '2026-08-01T18:00:00.000Z');
  assert.equal(merged.resultStatus, 'resolved');
  const candidate = merged.runners.find((r) => r.runnerNumber === 4);
  assert.equal(candidate.finishPosition, 1);
  assert.equal(candidate.sp.decimal, 11);
  const pulledUp = merged.runners.find((r) => r.runnerNumber === 7);
  assert.equal(pulledUp.resultStatus, 'pulled_up');
  assert.equal(pulledUp.finishPosition, null);
  const evaluation = evaluateRace(merged);
  assert.equal(evaluation.candidate.runnerNumber, 4);
});

test('malformed pages fail loudly instead of silently producing partial data', () => {
  const result = parseRacecard(readFixture('synthetic-racecard-1003-malformed.html'), { sourceUrl: 'https://www.attheraces.com/racecard/fixtureton/2026-08-01/1003', retrievedAt: '2026-08-01T17:00:00.000Z' });
  assert.equal(result.ok, false);
  assert.equal(result.race, null);
  const failed = result.checks.filter((c) => !c.passed).map((c) => c.name);
  assert.ok(failed.includes('runnerNamesComplete'));
  assert.ok(result.reason.startsWith('essential_checks_failed'));
});

test('html without a race container is rejected', () => {
  const filler = '<p>no race data here</p>'.repeat(20);
  const result = parseRacecard(`<html><body>${filler}</body></html>`, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_race_container');
});

test('race links are discovered, resolved to absolute same-origin urls and deduplicated', () => {
  const links = discoverRaceLinks(readFixture('synthetic-racecards-index.html'), indexUrl);
  assert.equal(links.length, 3);
  assert.ok(links.every((link) => link.startsWith('https://www.attheraces.com/racecard/fixtureton/2026-08-01/')));
  const duplicated = `${readFixture('synthetic-racecards-index.html')}<a href="/racecard/fixtureton/2026-08-01/1001">again</a><a href="https://elsewhere.example/racecard/x">offsite</a>`;
  const deduped = discoverRaceLinks(duplicated, indexUrl);
  assert.equal(deduped.length, 3);
});

test('challenge and block pages are recognised before any parsing is attempted', () => {
  assert.equal(isBlockPage('<html><title>Just a moment...</title></html>'), true);
  assert.equal(isBlockPage('<html><body>Enable JavaScript and cookies to continue</body></html>'), true);
  assert.equal(isBlockPage(readFixture('synthetic-racecard-1001.html')), false);
});
