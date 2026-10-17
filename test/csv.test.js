import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exportDatasetCsv,
  importDatasetFromCsv,
  parseCsv,
  toCsv
} from '../js/core/csv.js';
import { evaluateRace, PHASE1_RULESET } from '../js/core/rules-core.js';

function makeRace(raceId = 'CSV-TEST-1') {
  const race = {
    raceId,
    dataset: 'imported',
    testData: false,
    source: 'csv-import',
    sourceUrl: null,
    retrievedAt: null,
    parserVersion: 'csv-import-1.0.0',
    date: '2026-08-02',
    time: '15:00',
    course: 'Csvville',
    courseRegion: 'GB',
    raceType: 'Flat',
    isHandicap: true,
    class: 5,
    name: 'Csvville Handicap',
    declaredRunners: 8,
    actualRunners: 8,
    resultStatus: 'resolved',
    validation: { status: 'pending', checks: [] },
    runners: [
      { runnerNumber: 1, name: 'One', status: 'runner', odds: { fractional: '6/4', decimal: 2.5 }, sp: { fractional: '6/4', decimal: 2.5 }, finishPosition: 2, resultStatus: 'finished', jockey: 'J One', trainer: 'T One' },
      { runnerNumber: 2, name: 'Two', status: 'runner', odds: { fractional: '9/2', decimal: 5.5 }, sp: { fractional: '9/2', decimal: 5.5 }, finishPosition: 3, resultStatus: 'finished' },
      { runnerNumber: 3, name: 'Three', status: 'runner', odds: { fractional: '12/1', decimal: 13 }, sp: { fractional: '12/1', decimal: 13 }, finishPosition: 1, resultStatus: 'finished' },
      { runnerNumber: 4, name: 'Four', status: 'runner', odds: { fractional: '6/1', decimal: 7 }, sp: { fractional: '6/1', decimal: 7 }, finishPosition: 4, resultStatus: 'finished' },
      { runnerNumber: 5, name: 'Five, The "Fifth"', status: 'runner', odds: { fractional: '16/1', decimal: 17 }, sp: { fractional: '16/1', decimal: 17 }, finishPosition: 5, resultStatus: 'finished' },
      { runnerNumber: 6, name: 'Six', status: 'runner', odds: { fractional: '8/1', decimal: 9 }, sp: { fractional: '8/1', decimal: 9 }, finishPosition: 6, resultStatus: 'finished' },
      { runnerNumber: 7, name: 'Seven', status: 'runner', odds: { fractional: '25/1', decimal: 26 }, sp: { fractional: '25/1', decimal: 26 }, finishPosition: 7, resultStatus: 'finished' },
      { runnerNumber: 8, name: 'Eight', status: 'runner', odds: { fractional: '10/1', decimal: 11 }, sp: { fractional: '10/1', decimal: 11 }, finishPosition: 8, resultStatus: 'finished' }
    ]
  };
  race.evaluation = evaluateRace(race, PHASE1_RULESET);
  return race;
}

test('toCsv escapes commas, quotes and newlines', () => {
  const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'he said "hi"' }, { a: 'line\nbreak', b: null }]);
  assert.equal(csv, 'a,b\n"x,y","he said ""hi"""\n"line\nbreak",\n');
});

test('parseCsv round-trips quoted fields', () => {
  const rows = parseCsv('a,b\n"x,y","he said ""hi"""\n"line\nbreak",\n');
  assert.deepEqual(rows, [['a', 'b'], ['x,y', 'he said "hi"'], ['line\nbreak', '']]);
});

test('export then import round trip preserves races, runners, odds and results', () => {
  const original = makeRace();
  const csv = exportDatasetCsv([original]).csv;
  const result = importDatasetFromCsv(csv, { dataset: 'imported' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.races.length, 1);
  const restored = result.races[0];
  assert.equal(restored.raceId, original.raceId);
  assert.equal(restored.runners.length, original.runners.length);
  assert.equal(restored.runners[0].odds.decimal, 2.5);
  assert.equal(restored.runners[2].finishPosition, 1);
  assert.equal(restored.runners[4].name, 'Five, The "Fifth"');
  assert.equal(restored.resultStatus, 'resolved');
});

test('orphan runner rows are rejected rather than invented into a race', () => {
  const csv = [
    'recordType,raceId,runnerNumber,name',
    'runner,GHOST-1,1,Nobody'
  ].join('\n');
  const result = importDatasetFromCsv(csv);
  const orphanOrMissing = result.errors.length > 0 || result.rejected.length > 0 || result.races.length === 0;
  assert.equal(orphanOrMissing, true);
});

test('races with fewer than two runner rows are rejected on import', () => {
  const csv = [
    'recordType,raceId,date,course,courseRegion,raceType,isHandicap,class,runnerNumber,name',
    'race,TINY-1,2026-08-03,Tinyville,GB,Flat,true,5,,',
    'runner,TINY-1,1,Solo'
  ].join('\n');
  const result = importDatasetFromCsv(csv);
  assert.equal(result.races.length, 0);
  assert.ok(result.rejected.some((r) => r.raceId === 'TINY-1'));
});

test('missing required columns are reported clearly', () => {
  const result = importDatasetFromCsv('recordType,raceId\nrace,X-1\n');
  assert.ok(result.errors.some((e) => e.code === 'MISSING_COLUMN' && e.message.includes('date')));
});

test('decimal odds columns are cross-checked against fractional on import', () => {
  const csv = [
    'recordType,raceId,date,course,courseRegion,raceType,isHandicap,class,runnerNumber,name,oddsFractional,oddsDecimal',
    'race,BAD-1,2026-08-04,Badville,GB,Flat,true,4,,',
    'runner,BAD-1,1,One,5/2,2.5',
    'runner,BAD-1,2,Two,4/1,5'
  ].join('\n');
  const result = importDatasetFromCsv(csv);
  assert.equal(result.races.length, 0);
  assert.ok(result.rejected.length === 1);
});
