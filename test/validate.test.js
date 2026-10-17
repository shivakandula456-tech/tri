import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDataset,
  validateIndexFile,
  validateManifest,
  validateRaceRecord,
  validateStatusFile
} from '../js/core/validate-core.js';
import { evaluateRace, PHASE1_RULESET } from '../js/core/rules-core.js';

function makeValidRace(overrides = {}) {
  const race = {
    raceId: 'PUB-2026-08-01-TESTV-1410',
    dataset: 'published',
    testData: false,
    source: 'atr',
    sourceUrl: 'https://www.attheraces.com/racecard/testville/2026-08-01/1',
    retrievedAt: '2026-08-01T17:00:00.000Z',
    parserVersion: 'atr-parser-0.1.0',
    date: '2026-08-01',
    time: '14:10',
    course: 'Testville',
    courseRegion: 'GB',
    raceType: 'Flat',
    isHandicap: true,
    class: 4,
    name: 'Testville Handicap',
    declaredRunners: 7,
    actualRunners: 7,
    resultStatus: 'resolved',
    validation: { status: 'passed', checks: [] },
    runners: [
      { runnerNumber: 1, name: 'Alpha', status: 'runner', odds: { fractional: '5/2', decimal: 3.5 }, sp: { fractional: '9/4', decimal: 3.25 }, finishPosition: 2, resultStatus: 'finished' },
      { runnerNumber: 2, name: 'Bravo', status: 'runner', odds: { fractional: '4/1', decimal: 5 }, sp: { fractional: '4/1', decimal: 5 }, finishPosition: 1, resultStatus: 'finished' },
      { runnerNumber: 3, name: 'Charlie', status: 'runner', odds: { fractional: '10/1', decimal: 11 }, sp: { fractional: '10/1', decimal: 11 }, finishPosition: 3, resultStatus: 'finished' },
      { runnerNumber: 4, name: 'Delta', status: 'runner', odds: { fractional: '6/1', decimal: 7 }, sp: { fractional: '6/1', decimal: 7 }, finishPosition: 4, resultStatus: 'finished' },
      { runnerNumber: 5, name: 'Echo', status: 'runner', odds: { fractional: '20/1', decimal: 21 }, sp: { fractional: '20/1', decimal: 21 }, finishPosition: 5, resultStatus: 'finished' },
      { runnerNumber: 6, name: 'Foxtrot', status: 'runner', odds: { fractional: '8/1', decimal: 9 }, sp: { fractional: '8/1', decimal: 9 }, finishPosition: 6, resultStatus: 'finished' },
      { runnerNumber: 7, name: 'Golf', status: 'runner', odds: { fractional: '25/1', decimal: 26 }, sp: { fractional: '25/1', decimal: 26 }, finishPosition: 7, resultStatus: 'finished' }
    ]
  };
  return { ...race, ...overrides };
}

test('a well-formed published race passes validation', () => {
  const result = validateRaceRecord(makeValidRace(), { expectedDataset: 'published', strictEvaluation: true, requireTimestamps: true });
  assert.deepEqual(result.errors, []);
});

test('malformed fields produce precise error codes', () => {
  const bad = makeValidRace({
    raceId: 'no spaces allowed',
    date: '2026-13-45',
    course: '',
    courseRegion: '',
    raceType: 'Swimming',
    isHandicap: 'yes',
    class: 9,
    declaredRunners: 99,
    actualRunners: 99
  });
  const result = validateRaceRecord(bad, { expectedDataset: 'published' });
  const codes = result.errors.map((e) => e.code);
  assert.ok(codes.includes('INVALID_RACE_ID'));
  assert.ok(codes.includes('INVALID_DATE'));
  assert.ok(codes.includes('MISSING_FIELD'));
  assert.ok(codes.includes('INVALID_VALUE'));
  assert.ok(codes.includes('RUNNER_COUNT_MISMATCH'));
});

test('odds inconsistencies are detected, including fractional/decimal mismatch', () => {
  const bad = makeValidRace();
  bad.runners[0].odds = { fractional: '5/2', decimal: 2.5 };
  bad.runners[1].odds = { fractional: 'not-odds' };
  bad.runners[2].odds = { decimal: 0.5 };
  const result = validateRaceRecord(bad, { expectedDataset: 'published' });
  const codes = result.errors.map((e) => e.code);
  assert.ok(codes.includes('ODDS_MISMATCH'), 'fractional 5/2 with decimal 2.5 is a mismatch');
  assert.ok(codes.includes('INVALID_ODDS'));
});

test('duplicate runner numbers and duplicate finish positions are errors', () => {
  const bad = makeValidRace();
  bad.runners[1].runnerNumber = 1;
  bad.runners[1].finishPosition = 2;
  const result = validateRaceRecord(bad, { expectedDataset: 'published' });
  const codes = result.errors.map((e) => e.code);
  assert.ok(codes.includes('DUPLICATE_RUNNER_NUMBER'));
});

test('dataset-level duplicate race ids are rejected', () => {
  const a = makeValidRace();
  const b = makeValidRace();
  const result = validateDataset([a, b], { expectedDataset: 'published' });
  assert.ok(result.errors.some((e) => e.code === 'DUPLICATE_RACE_ID'));
});

test('test data can never masquerade as published data', () => {
  const smuggled = makeValidRace({ testData: true, dataset: 'test-fixture' });
  const result = validateRaceRecord(smuggled, { expectedDataset: 'published' });
  assert.ok(result.errors.some((e) => e.code === 'TEST_DATA_FLAG'));
  const fixture = makeValidRace({ testData: true, dataset: 'test-fixture' });
  const fixtureResult = validateRaceRecord(fixture, { expectedDataset: 'test-fixture' });
  assert.equal(fixtureResult.errors.some((e) => e.code === 'TEST_DATA_FLAG'), false);
});

test('credential-shaped fields are rejected everywhere', () => {
  const sneaky = makeValidRace({ apiKey: 'abc', meta: { password: 'hunter2' } });
  const result = validateRaceRecord(sneaky, { expectedDataset: 'published' });
  const secretErrors = result.errors.filter((e) => e.code === 'SECRET_FIELD');
  assert.equal(secretErrors.length, 2);
});

test('stored evaluations are checked against recomputation', () => {
  const race = makeValidRace();
  const evaluation = evaluateRace(race, PHASE1_RULESET);
  race.evaluation = { ...evaluation, candidate: { ...evaluation.candidate, runnerNumber: 99 } };
  const loose = validateRaceRecord(race, { expectedDataset: 'published' });
  assert.ok(loose.warnings.some((w) => w.code === 'EVALUATION_MISMATCH'));
  const strict = validateRaceRecord(race, { expectedDataset: 'published', strictEvaluation: true });
  assert.ok(strict.errors.some((e) => e.code === 'EVALUATION_MISMATCH'));
});

test('a consistent stored evaluation passes', () => {
  const race = makeValidRace();
  race.evaluation = evaluateRace(race, PHASE1_RULESET);
  const result = validateRaceRecord(race, { expectedDataset: 'published', strictEvaluation: true });
  assert.deepEqual(result.errors, []);
});

test('index validation catches count mismatches and dangling entries', () => {
  const validEmpty = {
    schemaVersion: '1.0.0',
    datasetStatus: 'not_collected',
    counts: { races: 0, qualified: 0, rejected: 0, resolvedResults: 0 },
    races: []
  };
  assert.deepEqual(validateIndexFile(validEmpty).errors, []);
  const broken = {
    datasetStatus: 'published',
    counts: { races: 3 },
    races: [{ raceId: 'A', date: '2026-08-01', status: 'qualified', path: 'not-data/x.json' }]
  };
  const result = validateIndexFile(broken);
  assert.ok(result.errors.some((e) => e.field === 'counts.races'));
  assert.ok(result.errors.some((e) => e.field.endsWith('.path')));
});

test('status file validation accepts the honest initial state', () => {
  const status = {
    collectorEnabled: false,
    parserValidatedAgainstLive: false,
    permissionStatus: 'blocked_http_403_observed',
    runs: []
  };
  assert.deepEqual(validateStatusFile(status).errors, []);
});

test('fixture manifest validation requires the testData flag', () => {
  const manifest = {
    testData: false,
    races: [{ file: 'races/x.json', raceId: 'X', expected: { status: 'qualified' } }]
  };
  const result = validateManifest(manifest);
  assert.ok(result.errors.some((e) => e.field === 'testData'));
});
