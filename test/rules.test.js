import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVALUATION_ORDER,
  PHASE1_RULESET,
  REJECTION_CODES,
  RULESET_VERSION,
  evaluateRace,
  makeExperimentalRuleset,
  validateExperimentalRules
} from '../js/core/rules-core.js';

function runner(number, name, oddsFractional, extra = {}) {
  const decimals = {
    '2/1': 3, '9/4': 3.25, '5/2': 3.5, '11/4': 3.75, '3/1': 4, '7/2': 4.5, '4/1': 5,
    '9/2': 5.5, '5/1': 6, '6/1': 7, '7/1': 8, '8/1': 9, '9/1': 10, '10/1': 11,
    '12/1': 13, '14/1': 15, '16/1': 17, '20/1': 21, '25/1': 26, '33/1': 34, '6/4': 2.5, '4/6': 1.6667
  };
  return {
    runnerNumber: number,
    name,
    status: 'runner',
    odds: oddsFractional === null ? null : { fractional: oddsFractional, decimal: decimals[oddsFractional] },
    sp: null,
    finishPosition: null,
    resultStatus: null,
    ...extra
  };
}

function baseRace(overrides = {}) {
  const race = {
    raceId: 'TEST-RACE-1',
    date: '2026-08-01',
    course: 'Testville',
    courseRegion: 'GB',
    raceType: 'Flat',
    isHandicap: true,
    class: 4,
    name: 'Test Handicap',
    declaredRunners: 8,
    actualRunners: 8,
    resultStatus: 'unresolved',
    runners: [
      runner(1, 'Alpha', '6/4'),
      runner(2, 'Bravo', '4/1'),
      runner(3, 'Charlie', '12/1'),
      runner(4, 'Delta', '6/1'),
      runner(5, 'Echo', '16/1'),
      runner(6, 'Foxtrot', '8/1'),
      runner(7, 'Golf', '25/1'),
      runner(8, 'Hotel', '9/1')
    ],
    ...overrides
  };
  return race;
}

test('a compliant race qualifies with the shortest-priced longshot as candidate', () => {
  const result = evaluateRace(baseRace());
  assert.equal(result.status, 'qualified');
  assert.equal(result.qualificationStatus, 'QUALIFIED');
  assert.equal(result.rejectionCode, null);
  assert.equal(result.candidate.runnerNumber, 3);
  assert.equal(result.candidate.decimal, 13);
  assert.equal(result.favourite.runnerNumber, 1);
  assert.equal(result.favourite.decimal, 2.5);
  assert.equal(result.actualRunners, 8);
  assert.equal(result.rulesetVersion, RULESET_VERSION);
});

test('evaluation trace follows the locked Phase 1 order', () => {
  const result = evaluateRace(baseRace());
  assert.deepEqual(result.trace.map((t) => t.code), [
    'REGION', 'RACE_TYPE', 'HANDICAP', 'CLASS', 'FIELD_SIZE', 'ODDS_COMPLETENESS',
    'STRONG_FAVOURITE', 'LONGSHOT', 'CANDIDATE'
  ]);
  assert.equal(result.trace.length, 9);
  assert.ok(result.trace.every((t) => t.passed));
});

test('non-GB races are rejected first', () => {
  const result = evaluateRace(baseRace({ courseRegion: 'IRE', raceType: 'Hurdle', class: 1 }));
  assert.equal(result.rejectionCode, REJECTION_CODES.NOT_GREAT_BRITAIN);
  assert.equal(result.status, 'rejected');
});

test('non-Flat races are rejected with NOT_FLAT', () => {
  for (const raceType of ['Hurdle', 'Chase', 'NH Flat']) {
    const result = evaluateRace(baseRace({ raceType }));
    assert.equal(result.rejectionCode, REJECTION_CODES.NOT_FLAT, raceType);
  }
});

test('non-handicap races are rejected with NOT_HANDICAP', () => {
  const result = evaluateRace(baseRace({ isHandicap: false }));
  assert.equal(result.rejectionCode, REJECTION_CODES.NOT_HANDICAP);
});

test('classes outside 2-6 are rejected, boundaries 2 and 6 pass', () => {
  assert.equal(evaluateRace(baseRace({ class: 1 })).rejectionCode, REJECTION_CODES.CLASS_OUT_OF_RANGE);
  assert.equal(evaluateRace(baseRace({ class: 7 })).rejectionCode, REJECTION_CODES.CLASS_OUT_OF_RANGE);
  assert.equal(evaluateRace(baseRace({ class: 2 })).rejectionCode, null);
  assert.equal(evaluateRace(baseRace({ class: 6 })).rejectionCode, null);
});

test('field size outside 6-12 actual runners is rejected, boundaries pass', () => {
  const nine = baseRace({
    runners: [
      runner(1, 'A', '6/4'), runner(2, 'B', '4/1'), runner(3, 'C', '12/1'), runner(4, 'D', '6/1'),
      runner(5, 'E', '16/1'), runner(6, 'F', '8/1'), runner(7, 'G', '25/1'), runner(8, 'H', '9/1'),
      runner(9, 'I', '33/1')
    ]
  });
  const thirteen = baseRace({
    runners: [
      ...nine.runners,
      runner(10, 'J', '40/1'), runner(11, 'K', '50/1'), runner(12, 'L', '66/1'), runner(13, 'M', '100/1')
    ]
  });
  assert.equal(evaluateRace(thirteen).rejectionCode, REJECTION_CODES.FIELD_SIZE_OUT_OF_RANGE);
  const five = baseRace({ runners: baseRace().runners.slice(0, 4).concat(runner(5, 'E', '20/1')) });
  assert.equal(evaluateRace(five).rejectionCode, REJECTION_CODES.FIELD_SIZE_OUT_OF_RANGE);
  assert.equal(evaluateRace(baseRace({ class: 5, runners: baseRace().runners.slice(0, 12) })).status, 'qualified');
});

test('non-runners are removed before counting the field', () => {
  const race = baseRace({
    runners: [
      ...baseRace().runners,
      runner(9, 'India', '2/1', { status: 'non_runner' }),
      runner(10, 'Juliet', '10/1', { status: 'non_runner' })
    ],
    declaredRunners: 10
  });
  const result = evaluateRace(race);
  assert.equal(result.actualRunners, 8);
  assert.deepEqual(result.nonRunnerNumbers, [9, 10]);
  assert.equal(result.status, 'qualified');
  assert.equal(result.favourite.runnerNumber, 1, 'the removed 2/1 non-runner must not become the favourite');
  assert.equal(result.candidate.runnerNumber, 3, 'the removed 10/1 non-runner is not a longshot');
});

test('one missing odds value rejects with INCOMPLETE_ODDS', () => {
  const race = baseRace({
    runners: baseRace().runners.map((r) => (r.runnerNumber === 4 ? { ...r, odds: null } : r))
  });
  const result = evaluateRace(race);
  assert.equal(result.rejectionCode, REJECTION_CODES.INCOMPLETE_ODDS);
});

test('exactly one strong favourite is required at 5/2 or shorter', () => {
  const noFavourite = baseRace({
    runners: baseRace().runners.map((r, i) => (i === 0 ? runner(1, 'Alpha', '3/1') : r))
  });
  assert.equal(evaluateRace(noFavourite).rejectionCode, REJECTION_CODES.NO_STRONG_FAVOURITE);
  const twoFavourites = baseRace({
    runners: baseRace().runners.map((r) => (r.runnerNumber === 2 ? runner(2, 'Bravo', '9/4') : r))
  });
  assert.equal(evaluateRace(twoFavourites).rejectionCode, REJECTION_CODES.MULTIPLE_STRONG_FAVOURITES);
  const exactBoundary = baseRace({
    runners: baseRace().runners.map((r) => {
      if (r.runnerNumber === 1) return runner(1, 'Alpha', '5/2');
      if (r.runnerNumber === 2) return runner(2, 'Bravo', '11/4');
      return r;
    })
  });
  assert.equal(evaluateRace(exactBoundary).status, 'qualified', '5/2 exactly is a strong favourite');
});

test('at least one longshot at 10/1 or greater is required', () => {
  const noLongshot = baseRace({
    runners: baseRace().runners.map((r) => (['12/1', '16/1', '25/1'].includes(r.odds.fractional) ? runner(r.runnerNumber, r.name, '9/1') : r))
  });
  assert.equal(evaluateRace(noLongshot).rejectionCode, REJECTION_CODES.NO_LONGSHOT);
  const exactBoundary = baseRace({
    runners: baseRace().runners.map((r) => (r.runnerNumber === 8 ? runner(8, 'Hotel', '10/1') : r))
  });
  const result = evaluateRace(exactBoundary);
  assert.equal(result.status, 'qualified');
  assert.equal(result.candidate.decimal, 11);
});

test('candidate is the shortest-priced longshot and ties break to the lowest runner number', () => {
  const tie = baseRace({
    runners: baseRace().runners.map((r) => {
      if (r.runnerNumber === 2) return runner(2, 'Bravo', '14/1');
      if (r.runnerNumber === 6) return runner(6, 'Foxtrot', '14/1');
      if (r.runnerNumber === 3) return runner(3, 'Charlie', '20/1');
      return r;
    })
  });
  const result = evaluateRace(tie);
  assert.equal(result.candidate.runnerNumber, 2);
  assert.equal(result.candidate.decimal, 15);
  assert.equal(result.candidate.tieBreakApplied, true);
  assert.equal(result.longshots[0].runnerNumber, 2);
  assert.equal(result.longshots[1].runnerNumber, 6);
});

test('rejection codes evaluate in the documented order when several rules fail', () => {
  const broken = baseRace({
    courseRegion: 'IRE',
    raceType: 'Hurdle',
    isHandicap: false,
    class: 1,
    runners: [runner(1, 'A', '6/4'), runner(2, 'B', '4/1'), runner(3, 'C', '8/1')]
  });
  const result = evaluateRace(broken);
  assert.equal(result.rejectionCode, REJECTION_CODES.NOT_GREAT_BRITAIN);
  assert.deepEqual(EVALUATION_ORDER.slice(0, 2), [REJECTION_CODES.NOT_GREAT_BRITAIN, REJECTION_CODES.NOT_FLAT]);
  assert.equal(result.trace.filter((t) => !t.passed).length, 7, 'the full trace is still recorded for every failing step');
});

test('experimental rulesets can relax the favourite rule but stay marked unlocked', () => {
  const ruleset = makeExperimentalRuleset({ favouriteMode: 'ignore', label: 'Ignore favourites' });
  assert.equal(ruleset.id, 'experimental');
  assert.equal(ruleset.locked, false);
  assert.equal(ruleset.baseVersion, RULESET_VERSION);
  const noFavourite = baseRace({
    runners: baseRace().runners.map((r) => (r.runnerNumber === 1 ? runner(1, 'Alpha', '3/1') : r))
  });
  assert.equal(evaluateRace(noFavourite, PHASE1_RULESET).status, 'rejected');
  assert.equal(evaluateRace(noFavourite, ruleset).status, 'qualified');
});

test('experimental ruleset validation bounds the sandbox', () => {
  assert.equal(validateExperimentalRules({ minRunners: 1 }).ok, false);
  assert.equal(validateExperimentalRules({ minRunners: 8, maxRunners: 4 }).ok, false);
  assert.equal(validateExperimentalRules({ favouriteMaxDecimal: 500 }).ok, false);
  assert.equal(validateExperimentalRules({ classes: [] }).ok, false);
  assert.equal(validateExperimentalRules({ raceTypes: ['Hurdle'] }).warnings.length > 0, true);
  assert.equal(validateExperimentalRules({}).ok, true);
});
