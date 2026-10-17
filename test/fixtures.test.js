import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateManifest,
  validateRaceRecord,
  validateIndexFile,
  validateStatusFile
} from '../js/core/validate-core.js';
import { PHASE1_RULESET, REJECTION_CODES, evaluateRace } from '../js/core/rules-core.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = path.join(rootDir, 'data', 'fixtures');
const racesDir = path.join(fixturesDir, 'races');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const manifest = readJson(path.join(fixturesDir, 'fixtures-manifest.json'));

test('fixture manifest is valid and self-describing', () => {
  const result = validateManifest(manifest);
  assert.deepEqual(result.errors, []);
  assert.equal(manifest.testData, true);
  assert.equal(manifest.datasetId, 'atr-phase1-fixtures');
});

test('every manifest entry exists on disk and the folder has no unlisted fixtures', () => {
  const listed = new Set();
  for (const entry of manifest.races) {
    assert.match(entry.file, /^races\/.+\.json$/);
    const fullPath = path.join(fixturesDir, entry.file);
    assert.ok(fs.existsSync(fullPath), `missing fixture file ${entry.file}`);
    assert.ok(!listed.has(entry.file), `duplicate manifest entry ${entry.file}`);
    listed.add(entry.file);
    const race = readJson(fullPath);
    assert.equal(race.raceId, entry.raceId, `raceId mismatch in ${entry.file}`);
  }
  const onDisk = fs.readdirSync(racesDir).filter((name) => name.endsWith('.json'));
  assert.equal(onDisk.length, listed.size, 'unlisted fixture files exist in data/fixtures/races');
  for (const name of onDisk) {
    assert.ok(listed.has(`races/${name}`), `fixture ${name} is not listed in the manifest`);
  }
});

for (const entry of manifest.races) {
  test(`fixture ${entry.raceId}: honest flags, valid record, evaluation matches manifest`, () => {
    const race = readJson(path.join(fixturesDir, entry.file));

    assert.equal(race.testData, true);
    assert.equal(race.dataset, 'test-fixture');
    assert.equal(race.source, 'test-fixture-generator');
    assert.equal(race.sourceUrl, null);
    assert.equal(race.parserVersion, 'fixture-generator-1.0.0');

    const validation = validateRaceRecord(race, {
      expectedDataset: 'test-fixture',
      requireTimestamps: true,
      strictEvaluation: true
    });
    assert.deepEqual(validation.errors, [], `unexpected validation errors in ${entry.raceId}`);
    assert.deepEqual(validation.warnings, [], `unexpected validation warnings in ${entry.raceId}`);

    const evaluation = evaluateRace(race, PHASE1_RULESET);
    const expected = entry.expected;

    assert.equal(evaluation.status, expected.status, `status mismatch for ${entry.raceId}`);
    assert.equal(evaluation.rejectionCode, expected.rejectionCode, `rejection code mismatch for ${entry.raceId}`);

    const candidateNumber = evaluation.candidate ? evaluation.candidate.runnerNumber : null;
    assert.equal(candidateNumber, expected.candidateRunnerNumber, `candidate mismatch for ${entry.raceId}`);

    const favouriteNumber = evaluation.favourite ? evaluation.favourite.runnerNumber : null;
    if (expected.favouriteRunnerNumber !== undefined) {
      assert.equal(favouriteNumber, expected.favouriteRunnerNumber, `favourite mismatch for ${entry.raceId}`);
    }
    if (expected.tieBreakApplied !== undefined && evaluation.candidate) {
      assert.equal(evaluation.candidate.tieBreakApplied, expected.tieBreakApplied, `tie-break flag mismatch for ${entry.raceId}`);
    }

    if (expected.resultStatus !== undefined) {
      assert.equal(race.resultStatus, expected.resultStatus);
      if (expected.candidateFinishPosition !== undefined && expected.candidateFinishPosition !== null) {
        const runner = race.runners.find((r) => r.runnerNumber === expected.candidateRunnerNumber);
        assert.equal(runner.finishPosition, expected.candidateFinishPosition, `candidate finish mismatch for ${entry.raceId}`);
      }
      if (expected.favouriteFinishPosition !== undefined && expected.favouriteFinishPosition !== null) {
        const runner = race.runners.find((r) => r.runnerNumber === expected.favouriteRunnerNumber);
        assert.equal(runner.finishPosition, expected.favouriteFinishPosition, `favourite finish mismatch for ${entry.raceId}`);
      }
    }

    if (expected.status === 'rejected') {
      assert.ok(Object.values(REJECTION_CODES).includes(expected.rejectionCode), 'manifest rejection code must be a known code');
      const failureIndex = evaluation.trace.findIndex((step) => !step.passed);
      assert.ok(failureIndex >= 0, `expected a failing step for ${entry.raceId}`);
      assert.equal(evaluation.trace[failureIndex].rejectionCode, expected.rejectionCode, `first failing step mismatch for ${entry.raceId}`);
      for (const step of evaluation.trace.slice(0, failureIndex)) {
        assert.equal(step.passed, true, `step ${step.code} before the failure should pass for ${entry.raceId}`);
      }
    } else {
      assert.ok(evaluation.candidate, `qualified fixture ${entry.raceId} must produce a candidate`);
      assert.ok(evaluation.longshots.length > 0);
      assert.equal(evaluation.trace.every((step) => step.passed), true);
    }
  });
}

test('published index is valid, empty and honest about not being collected', () => {
  const index = readJson(path.join(rootDir, 'data', 'indexes', 'races-index.json'));
  const result = validateIndexFile(index);
  assert.deepEqual(result.errors, []);
  assert.equal(index.datasetStatus, 'not_collected');
  assert.equal(index.races.length, 0);
  assert.equal(index.counts.races, 0);
  assert.equal(index.parserVersion, null);
});

test('status file is valid and reports collection as disabled and unvalidated', () => {
  const status = readJson(path.join(rootDir, 'data', 'indexes', 'status.json'));
  const result = validateStatusFile(status);
  assert.deepEqual(result.errors, []);
  assert.equal(status.collectorEnabled, false);
  assert.equal(status.parserValidatedAgainstLive, false);
  assert.equal(status.permissionStatus, 'blocked_http_403_observed');
  assert.ok(Array.isArray(status.permissionNotes) && status.permissionNotes.length > 0);
  assert.equal(status.lastRun, null);
});

test('each rejection code exercised by the fixtures is covered', () => {
  const expectedCodes = new Set(
    manifest.races.filter((r) => r.expected.rejectionCode).map((r) => r.expected.rejectionCode)
  );
  for (const code of ['NOT_GREAT_BRITAIN', 'NOT_FLAT', 'NOT_HANDICAP', 'CLASS_OUT_OF_RANGE', 'FIELD_SIZE_OUT_OF_RANGE', 'INCOMPLETE_ODDS', 'NO_STRONG_FAVOURITE', 'MULTIPLE_STRONG_FAVOURITES']) {
    assert.ok(expectedCodes.has(code), `no fixture exercises ${code}`);
  }
  assert.ok(manifest.races.some((r) => r.expected.status === 'qualified'), 'fixtures must include at least one qualifying race');
});
