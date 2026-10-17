import { isPlainObject, isValidDateString } from './util.js';
import { parseFractional } from './odds.js';
import { PHASE1_RULESET, evaluateRace } from './rules-core.js';

export const SCHEMA_VERSION = '1.0.0';

const RACE_ID_PATTERN = /^[A-Za-z0-9._-]{3,120}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const RACE_TYPES = ['Flat', 'Hurdle', 'Chase', 'NH Flat', 'Unknown'];
const RUNNER_STATUSES = ['runner', 'non_runner'];
const RESULT_STATUSES = ['resolved', 'partial', 'unresolved'];
const VALIDATION_STATUSES = ['passed', 'failed', 'pending'];
const NON_FINISH_STATUSES = ['fell', 'pulled_up', 'unseated', 'refused', 'brought_down', 'disqualified', 'withdrawn'];
const SECRET_KEY_PATTERN = /(token|secret|password|passwd|api[_-]?key|private[_-]?key|authorization|credential)/i;

export function scanForSecretFields(value, pathPrefix = '$') {
  const hits = [];
  const walk = (v, p) => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        if (SECRET_KEY_PATTERN.test(k)) hits.push(`${p}.${k}`);
        walk(child, `${p}.${k}`);
      }
    }
  };
  walk(value, pathPrefix);
  return hits;
}

export function oddsIssues(odds, prefix) {
  const issues = [];
  if (odds === null || odds === undefined) return issues;
  if (!isPlainObject(odds)) {
    issues.push({ code: 'INVALID_ODDS', field: prefix, message: `${prefix} must be an object with fractional and/or decimal values.` });
    return issues;
  }
  const hasFractional = odds.fractional !== undefined && odds.fractional !== null;
  const hasDecimal = odds.decimal !== undefined && odds.decimal !== null;
  if (!hasFractional && !hasDecimal) {
    issues.push({ code: 'INVALID_ODDS', field: prefix, message: `${prefix} has neither fractional nor decimal value.` });
    return issues;
  }
  let parsed = null;
  if (hasFractional) {
    if (typeof odds.fractional !== 'string' || !/^(\d+\/\d+|evens|evs|even)$/i.test(odds.fractional.trim())) {
      issues.push({ code: 'INVALID_ODDS', field: `${prefix}.fractional`, message: `${prefix}.fractional "${odds.fractional}" is not a fractional price such as 5/2, 10/1 or evens.` });
    } else {
      parsed = parseFractional(odds.fractional);
      if (parsed === null) issues.push({ code: 'INVALID_ODDS', field: `${prefix}.fractional`, message: `${prefix}.fractional "${odds.fractional}" could not be normalised.` });
    }
  }
  if (hasDecimal) {
    if (typeof odds.decimal !== 'number' || !Number.isFinite(odds.decimal) || odds.decimal <= 1 || odds.decimal > 1001) {
      issues.push({ code: 'INVALID_ODDS', field: `${prefix}.decimal`, message: `${prefix}.decimal must be a number greater than 1 and at most 1001.` });
    } else if (parsed !== null && Math.abs(parsed - odds.decimal) > 0.001) {
      issues.push({ code: 'ODDS_MISMATCH', field: `${prefix}.decimal`, message: `${prefix} fractional (${odds.fractional}) normalises to ${parsed} but decimal is ${odds.decimal}.` });
    }
  }
  return issues;
}

export function validateRaceRecord(race, options = {}) {
  const errors = [];
  const warnings = [];
  const err = (code, field, message) => errors.push({ code, field, message });
  const warn = (code, field, message) => warnings.push({ code, field, message });

  if (!isPlainObject(race)) {
    return { raceId: null, errors: [{ code: 'INVALID_RECORD', field: '$', message: 'Record is not a JSON object.' }], warnings };
  }

  if (typeof race.raceId !== 'string' || !RACE_ID_PATTERN.test(race.raceId)) err('INVALID_RACE_ID', 'raceId', 'raceId must match /^[A-Za-z0-9._-]{3,120}$/.');
  if (!isValidDateString(race.date)) err('INVALID_DATE', 'date', 'date must be a valid YYYY-MM-DD value between 2000 and 2100.');
  if (typeof race.course !== 'string' || race.course.trim() === '') err('MISSING_FIELD', 'course', 'course is required.');
  if (typeof race.courseRegion !== 'string' || race.courseRegion.trim() === '') err('MISSING_FIELD', 'courseRegion', 'courseRegion is required.');
  if (!RACE_TYPES.includes(race.raceType)) err('INVALID_VALUE', 'raceType', `raceType must be one of ${RACE_TYPES.join(', ')}.`);
  if (typeof race.isHandicap !== 'boolean') err('INVALID_VALUE', 'isHandicap', 'isHandicap must be a boolean.');
  if (!Number.isInteger(race.class) || race.class < 1 || race.class > 8) err('INVALID_VALUE', 'class', 'class must be an integer between 1 and 8.');
  if (race.time !== undefined && race.time !== null && !TIME_PATTERN.test(String(race.time))) warn('INVALID_TIME', 'time', 'time should be HH:MM (24 hour).');
  if (race.resultStatus !== undefined && !RESULT_STATUSES.includes(race.resultStatus)) err('INVALID_VALUE', 'resultStatus', `resultStatus must be one of ${RESULT_STATUSES.join(', ')}.`);
  if (race.validation !== undefined) {
    if (!isPlainObject(race.validation) || !VALIDATION_STATUSES.includes(race.validation.status)) err('INVALID_VALUE', 'validation.status', 'validation.status must be passed, failed or pending.');
  }
  if (race.sourceUrl !== undefined && race.sourceUrl !== null && !/^https:\/\//i.test(String(race.sourceUrl))) warn('INVALID_SOURCE_URL', 'sourceUrl', 'sourceUrl should be an https URL or null.');
  if (options.requireTimestamps && (race.retrievedAt === undefined || race.retrievedAt === null)) warn('MISSING_TIMESTAMP', 'retrievedAt', 'retrievedAt is missing; provenance is incomplete.');
  if (options.requireTimestamps && !race.parserVersion) warn('MISSING_PARSER_VERSION', 'parserVersion', 'parserVersion is missing; provenance is incomplete.');

  if (options.expectedDataset === 'published') {
    if (race.testData === true) err('TEST_DATA_FLAG', 'testData', 'Published dataset must not contain records flagged testData=true.');
    if (race.dataset !== undefined && race.dataset !== 'published') warn('DATASET_KIND', 'dataset', `Expected dataset "published" but found "${race.dataset}".`);
  } else if (options.expectedDataset === 'test-fixture') {
    if (race.testData !== true) err('TEST_DATA_FLAG', 'testData', 'Fixture records must be flagged testData=true.');
    if (race.dataset !== 'test-fixture') err('DATASET_KIND', 'dataset', 'Fixture records must use dataset "test-fixture".');
  } else if (options.expectedDataset === 'imported') {
    if (race.dataset !== 'imported') warn('DATASET_KIND', 'dataset', 'Imported records should use dataset "imported".');
  }

  if (!Array.isArray(race.runners) || race.runners.length < 2) {
    err('INVALID_RUNNERS', 'runners', 'runners must be an array with at least 2 entries.');
    for (const hit of scanForSecretFields(race)) err('SECRET_FIELD', hit, `Field "${hit}" looks like a credential and must never be stored.`);
    return { raceId: race.raceId ?? null, errors, warnings };
  }

  const numbers = new Set();
  const finishPositions = new Set();
  let activeCount = 0;
  race.runners.forEach((runner, index) => {
    const field = `runners[${index}]`;
    if (!isPlainObject(runner)) {
      err('INVALID_RUNNER', field, 'Runner must be an object.');
      return;
    }
    if (!Number.isInteger(runner.runnerNumber) || runner.runnerNumber < 1) err('INVALID_RUNNER_NUMBER', `${field}.runnerNumber`, 'runnerNumber must be a positive integer.');
    else if (numbers.has(runner.runnerNumber)) err('DUPLICATE_RUNNER_NUMBER', `${field}.runnerNumber`, `runnerNumber ${runner.runnerNumber} is duplicated.`);
    else numbers.add(runner.runnerNumber);
    if (typeof runner.name !== 'string' || runner.name.trim() === '') err('MISSING_FIELD', `${field}.name`, 'Runner name is required.');
    if (runner.status !== undefined && !RUNNER_STATUSES.includes(runner.status)) err('INVALID_VALUE', `${field}.status`, 'status must be "runner" or "non_runner".');
    if (runner.status !== 'non_runner') activeCount += 1;
    for (const issue of oddsIssues(runner.odds, `${field}.odds`)) errors.push(issue);
    for (const issue of oddsIssues(runner.sp, `${field}.sp`)) errors.push(issue);
    if (runner.finishPosition !== undefined && runner.finishPosition !== null) {
      if (!Number.isInteger(runner.finishPosition) || runner.finishPosition < 1) err('INVALID_VALUE', `${field}.finishPosition`, 'finishPosition must be a positive integer or null.');
      else if (finishPositions.has(runner.finishPosition)) err('DUPLICATE_FINISH_POSITION', `${field}.finishPosition`, `finishPosition ${runner.finishPosition} is duplicated within the race.`);
      else finishPositions.add(runner.finishPosition);
    }
    if (runner.status === 'non_runner' && runner.finishPosition !== undefined && runner.finishPosition !== null) warn('RESULT_INCONSISTENT', `${field}.finishPosition`, 'Non-runner has a finish position.');
  });

  if (race.declaredRunners !== undefined && race.declaredRunners !== race.runners.length) err('RUNNER_COUNT_MISMATCH', 'declaredRunners', `declaredRunners ${race.declaredRunners} does not match runners array length ${race.runners.length}.`);
  if (race.actualRunners !== undefined && race.actualRunners !== activeCount) err('RUNNER_COUNT_MISMATCH', 'actualRunners', `actualRunners ${race.actualRunners} does not match computed count ${activeCount}.`);

  if (race.resultStatus === 'resolved') {
    const unresolved = race.runners.filter((r) => r.status !== 'non_runner' && (r.finishPosition === undefined || r.finishPosition === null) && !NON_FINISH_STATUSES.includes(r.resultStatus));
    if (unresolved.length > 0) warn('RESULT_INCONSISTENT', 'resultStatus', `resultStatus is "resolved" but ${unresolved.length} runner(s) have no finish position or non-finish reason.`);
  }
  if (race.resultStatus === 'unresolved' && finishPositions.size > 0) warn('RESULT_INCONSISTENT', 'resultStatus', 'resultStatus is "unresolved" but finish positions are present.');

  if (race.evaluation !== undefined && race.evaluation !== null) {
    const recomputed = evaluateRace(race, PHASE1_RULESET);
    const stored = race.evaluation;
    const mismatches = [];
    if (stored.status !== recomputed.status) mismatches.push(`status stored=${stored.status} recomputed=${recomputed.status}`);
    if ((stored.rejectionCode ?? null) !== (recomputed.rejectionCode ?? null)) mismatches.push(`rejectionCode stored=${stored.rejectionCode} recomputed=${recomputed.rejectionCode}`);
    const storedCandidate = stored.candidate ? stored.candidate.runnerNumber : null;
    const recomputedCandidate = recomputed.candidate ? recomputed.candidate.runnerNumber : null;
    if (storedCandidate !== recomputedCandidate) mismatches.push(`candidate stored=#${storedCandidate} recomputed=#${recomputedCandidate}`);
    if (mismatches.length > 0) {
      const target = options.strictEvaluation ? err : warn;
      target('EVALUATION_MISMATCH', 'evaluation', `Stored evaluation differs from recomputation: ${mismatches.join('; ')}.`);
    }
  }

  for (const hit of scanForSecretFields(race)) err('SECRET_FIELD', hit, `Field "${hit}" looks like a credential and must never be stored.`);

  return { raceId: race.raceId ?? null, errors, warnings };
}

export function validateDataset(races, options = {}) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  const counts = { races: 0, qualified: 0, rejected: 0, resolved: 0, unresolved: 0, partial: 0 };
  const byCode = {};

  (races || []).forEach((race, index) => {
    const result = validateRaceRecord(race, options);
    for (const e of result.errors) errors.push({ ...e, raceId: result.raceId, index });
    for (const w of result.warnings) warnings.push({ ...w, raceId: result.raceId, index });
    if (race && race.raceId) {
      if (seen.has(race.raceId)) errors.push({ code: 'DUPLICATE_RACE_ID', field: 'raceId', message: `raceId ${race.raceId} appears more than once in the dataset.`, raceId: race.raceId, index });
      else seen.set(race.raceId, true);
    }
    if (race && race.evaluation) {
      counts.races += 1;
      if (race.evaluation.status === 'qualified') counts.qualified += 1;
      else {
        counts.rejected += 1;
        const code = race.evaluation.rejectionCode || 'UNKNOWN';
        byCode[code] = (byCode[code] || 0) + 1;
      }
    } else if (race) {
      counts.races += 1;
    }
    if (race && race.resultStatus === 'resolved') counts.resolved += 1;
    else if (race && race.resultStatus === 'partial') counts.partial += 1;
    else if (race) counts.unresolved += 1;
  });

  return { errors, warnings, counts, byCode };
}

export function validateIndexFile(index) {
  const errors = [];
  const warnings = [];
  const err = (field, message) => errors.push({ code: 'INDEX_INVALID', field, message });
  if (!isPlainObject(index)) return { errors: [{ code: 'INDEX_INVALID', field: '$', message: 'Index file is not an object.' }], warnings };
  if (!['not_collected', 'collecting', 'partial', 'published'].includes(index.datasetStatus)) err('datasetStatus', 'datasetStatus must be not_collected, collecting, partial or published.');
  if (!Array.isArray(index.races)) err('races', 'races must be an array.');
  else {
    const seen = new Set();
    index.races.forEach((entry, i) => {
      const field = `races[${i}]`;
      if (!isPlainObject(entry)) {
        err(field, 'Index entry must be an object.');
        return;
      }
      if (typeof entry.raceId !== 'string' || !RACE_ID_PATTERN.test(entry.raceId)) err(`${field}.raceId`, 'raceId missing or malformed.');
      else if (seen.has(entry.raceId)) err(`${field}.raceId`, `Duplicate raceId ${entry.raceId} in index.`);
      else seen.add(entry.raceId);
      if (!isValidDateString(entry.date)) err(`${field}.date`, 'date missing or malformed.');
      if (!['qualified', 'rejected'].includes(entry.status)) err(`${field}.status`, 'status must be qualified or rejected.');
      if (typeof entry.path !== 'string' || !entry.path.startsWith('data/races/')) err(`${field}.path`, 'path must point into data/races/.');
    });
    if (isPlainObject(index.counts) && Number.isInteger(index.counts.races) && index.counts.races !== index.races.length) {
      err('counts.races', `counts.races ${index.counts.races} does not match the number of index entries ${index.races.length}.`);
    }
  }
  if (!isPlainObject(index.counts)) warnings.push({ code: 'INDEX_INCOMPLETE', field: 'counts', message: 'Index is missing counts block.' });
  return { errors, warnings };
}

export function validateStatusFile(status) {
  const errors = [];
  const warnings = [];
  const warn = (field, message) => warnings.push({ code: 'STATUS_INCOMPLETE', field, message });
  if (!isPlainObject(status)) return { errors: [{ code: 'STATUS_INVALID', field: '$', message: 'Status file is not an object.' }], warnings };
  if (typeof status.collectorEnabled !== 'boolean') warn('collectorEnabled', 'collectorEnabled flag is missing.');
  if (typeof status.parserValidatedAgainstLive !== 'boolean') warn('parserValidatedAgainstLive', 'parserValidatedAgainstLive flag is missing.');
  if (typeof status.permissionStatus !== 'string') warn('permissionStatus', 'permissionStatus is missing.');
  if (status.runs !== undefined && !Array.isArray(status.runs)) errors.push({ code: 'STATUS_INVALID', field: 'runs', message: 'runs must be an array when present.' });
  if (Array.isArray(status.runs) && status.runs.length > 500) warn('runs', 'runs array is large; consider trimming older entries.');
  if (status.runs && status.runs.some((r) => !isPlainObject(r) || typeof r.runId !== 'string')) errors.push({ code: 'STATUS_INVALID', field: 'runs', message: 'Each run entry must be an object with a runId.' });
  for (const hit of scanForSecretFields(status)) errors.push({ code: 'SECRET_FIELD', field: hit, message: `Field "${hit}" looks like a credential and must never be stored.` });
  return { errors, warnings };
}

export function validateManifest(manifest) {
  const errors = [];
  const warnings = [];
  const err = (field, message) => errors.push({ code: 'MANIFEST_INVALID', field, message });
  if (!isPlainObject(manifest)) return { errors: [{ code: 'MANIFEST_INVALID', field: '$', message: 'Manifest is not an object.' }], warnings };
  if (manifest.testData !== true) err('testData', 'Fixture manifest must be flagged testData=true.');
  if (!Array.isArray(manifest.races) || manifest.races.length === 0) err('races', 'Manifest must list at least one fixture race.');
  else {
    manifest.races.forEach((entry, i) => {
      const field = `races[${i}]`;
      if (typeof entry.file !== 'string' || !entry.file.endsWith('.json')) err(`${field}.file`, 'Fixture entry must reference a .json file.');
      if (typeof entry.raceId !== 'string') err(`${field}.raceId`, 'Fixture entry must include raceId.');
      if (!isPlainObject(entry.expected) || !['qualified', 'rejected'].includes(entry.expected.status)) err(`${field}.expected`, 'Fixture entry must include expected.status of qualified or rejected.');
    });
  }
  return { errors, warnings };
}

export function summarizeIssues(errors, warnings) {
  const byCode = {};
  for (const item of errors) byCode[item.code] = (byCode[item.code] || 0) + 1;
  return { errorCount: errors.length, warningCount: warnings.length, byCode };
}
