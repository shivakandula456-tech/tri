import { deepFreeze, fnv1a, stableStringify } from './util.js';
import {
  LONGSHOT_MIN_DECIMAL,
  STRONG_FAVOURITE_MAX_DECIMAL,
  isLongshot,
  isStrongFavourite,
  parseFractional
} from './odds.js';

export const RULESET_VERSION = 'phase1-1.0.0';
export const QUALIFIED = 'QUALIFIED';

export const REJECTION_CODES = Object.freeze({
  NOT_GREAT_BRITAIN: 'NOT_GREAT_BRITAIN',
  NOT_FLAT: 'NOT_FLAT',
  NOT_HANDICAP: 'NOT_HANDICAP',
  CLASS_OUT_OF_RANGE: 'CLASS_OUT_OF_RANGE',
  FIELD_SIZE_OUT_OF_RANGE: 'FIELD_SIZE_OUT_OF_RANGE',
  INCOMPLETE_ODDS: 'INCOMPLETE_ODDS',
  NO_STRONG_FAVOURITE: 'NO_STRONG_FAVOURITE',
  MULTIPLE_STRONG_FAVOURITES: 'MULTIPLE_STRONG_FAVOURITES',
  NO_LONGSHOT: 'NO_LONGSHOT'
});

export const EVALUATION_ORDER = Object.freeze([
  'NOT_GREAT_BRITAIN',
  'NOT_FLAT',
  'NOT_HANDICAP',
  'CLASS_OUT_OF_RANGE',
  'FIELD_SIZE_OUT_OF_RANGE',
  'INCOMPLETE_ODDS',
  'NO_STRONG_FAVOURITE',
  'MULTIPLE_STRONG_FAVOURITES',
  'NO_LONGSHOT'
]);

export const PHASE1_RULESET = deepFreeze({
  id: 'phase1',
  version: RULESET_VERSION,
  label: 'Phase 1 (locked)',
  locked: true,
  rules: {
    regions: ['GB'],
    raceTypes: ['Flat'],
    handicapOnly: true,
    classes: [2, 3, 4, 5, 6],
    minRunners: 6,
    maxRunners: 12,
    favouriteMode: 'exactlyOne',
    favouriteMaxDecimal: STRONG_FAVOURITE_MAX_DECIMAL,
    favouriteMaxFractional: '5/2',
    longshotMinDecimal: LONGSHOT_MIN_DECIMAL,
    longshotMinFractional: '10/1',
    requireCompleteOdds: true,
    candidate: 'shortest_longshot_lowest_runner_number'
  }
});

export function rulesetHash(ruleset) {
  return fnv1a(stableStringify({ id: ruleset.id, version: ruleset.version, rules: ruleset.rules }));
}

export function makeExperimentalRuleset(config = {}) {
  const base = PHASE1_RULESET.rules;
  const rules = {
    regions: config.regions ? [...config.regions] : [...base.regions],
    raceTypes: config.raceTypes ? [...config.raceTypes] : [...base.raceTypes],
    handicapOnly: config.handicapOnly !== undefined ? Boolean(config.handicapOnly) : base.handicapOnly,
    classes: config.classes ? [...config.classes] : [...base.classes],
    minRunners: config.minRunners !== undefined ? Number(config.minRunners) : base.minRunners,
    maxRunners: config.maxRunners !== undefined ? Number(config.maxRunners) : base.maxRunners,
    favouriteMode: config.favouriteMode || base.favouriteMode,
    favouriteMaxDecimal: config.favouriteMaxDecimal !== undefined ? Number(config.favouriteMaxDecimal) : base.favouriteMaxDecimal,
    favouriteMaxFractional: config.favouriteMaxFractional || base.favouriteMaxFractional,
    longshotMinDecimal: config.longshotMinDecimal !== undefined ? Number(config.longshotMinDecimal) : base.longshotMinDecimal,
    longshotMinFractional: config.longshotMinFractional || base.longshotMinFractional,
    requireCompleteOdds: config.requireCompleteOdds !== undefined ? Boolean(config.requireCompleteOdds) : base.requireCompleteOdds,
    candidate: base.candidate
  };
  const draft = {
    id: 'experimental',
    version: `experimental-${fnv1a(stableStringify(rules))}`,
    label: config.label || 'Experimental rules',
    locked: false,
    baseVersion: RULESET_VERSION,
    createdAt: config.createdAt || null,
    rules
  };
  return draft;
}

export function validateExperimentalRules(config = {}) {
  const errors = [];
  const warnings = [];
  const base = PHASE1_RULESET.rules;
  const err = (field, message) => errors.push({ field, message });
  const warn = (field, message) => warnings.push({ field, message });
  const minRunners = config.minRunners !== undefined ? Number(config.minRunners) : base.minRunners;
  const maxRunners = config.maxRunners !== undefined ? Number(config.maxRunners) : base.maxRunners;
  const classes = config.classes !== undefined ? config.classes : base.classes;
  const regions = config.regions !== undefined ? config.regions : base.regions;
  const raceTypes = config.raceTypes !== undefined ? config.raceTypes : base.raceTypes;
  if (!Number.isInteger(minRunners) || minRunners < 2 || minRunners > 40) err('minRunners', 'minRunners must be an integer between 2 and 40.');
  if (!Number.isInteger(maxRunners) || maxRunners < 2 || maxRunners > 40) err('maxRunners', 'maxRunners must be an integer between 2 and 40.');
  if (minRunners > maxRunners) err('minRunners', 'minRunners must not exceed maxRunners.');
  const favMax = config.favouriteMaxDecimal !== undefined ? Number(config.favouriteMaxDecimal) : STRONG_FAVOURITE_MAX_DECIMAL;
  if (!Number.isFinite(favMax) || favMax < 1.01 || favMax > 50) err('favouriteMaxDecimal', 'favouriteMaxDecimal must be between 1.01 and 50.');
  const longMin = config.longshotMinDecimal !== undefined ? Number(config.longshotMinDecimal) : LONGSHOT_MIN_DECIMAL;
  if (!Number.isFinite(longMin) || longMin < 1.01 || longMin > 300) err('longshotMinDecimal', 'longshotMinDecimal must be between 1.01 and 300.');
  if (Number.isFinite(favMax) && Number.isFinite(longMin) && longMin <= favMax) warn('longshotMinDecimal', 'longshotMinDecimal is not greater than favouriteMaxDecimal; almost every priced runner counts as both favourite and longshot.');
  if (!Array.isArray(classes) || classes.length === 0) err('classes', 'At least one class must be selected.');
  else if (classes.some((c) => !Number.isInteger(Number(c)) || Number(c) < 1 || Number(c) > 8)) err('classes', 'Classes must be integers between 1 and 8.');
  if (!Array.isArray(regions) || regions.length === 0) err('regions', 'At least one region must be selected.');
  else if (!regions.every((r) => ['GB', 'IRE', 'FR', 'USA'].includes(r))) err('regions', 'Regions must be selected from GB, IRE, FR, USA.');
  if (!Array.isArray(raceTypes) || raceTypes.length === 0) err('raceTypes', 'At least one race type must be selected.');
  if (!['exactlyOne', 'atLeastOne', 'ignore'].includes(config.favouriteMode || 'exactlyOne')) err('favouriteMode', 'favouriteMode must be exactlyOne, atLeastOne or ignore.');
  if (Array.isArray(regions) && regions.some((r) => r !== 'GB')) warn('regions', 'Experimental rule set includes non-GB regions. This does not match Phase 1 and is for sandbox research only.');
  if (Array.isArray(raceTypes) && raceTypes.some((t) => t !== 'Flat')) warn('raceTypes', 'Experimental rule set includes non-Flat race types. This does not match Phase 1 and is for sandbox research only.');
  if (Array.isArray(classes) && classes.some((c) => ![2, 3, 4, 5, 6].includes(Number(c)))) warn('classes', 'Experimental rule set includes classes outside 2-6. This does not match Phase 1 and is for sandbox research only.');
  if (config.handicapOnly === false) warn('handicapOnly', 'Experimental rule set includes non-handicap races. This does not match Phase 1 and is for sandbox research only.');
  return { ok: errors.length === 0, errors, warnings };
}

export function isRunner(runner) {
  return !(runner && (runner.status === 'non_runner' || runner.nonRunner === true));
}

export function runnerDecimal(runner) {
  if (!runner) return null;
  const odds = runner.odds;
  if (odds && typeof odds === 'object') {
    if (typeof odds.decimal === 'number' && Number.isFinite(odds.decimal)) return odds.decimal;
    if (typeof odds.fractional === 'string') return parseFractional(odds.fractional);
    return null;
  }
  if (typeof odds === 'string' || typeof odds === 'number') return parseFractional(odds);
  return null;
}

export function actualRunnerNumbers(race) {
  return (race.runners || []).filter(isRunner).map((r) => r.runnerNumber);
}

export function nonRunnerNumbers(race) {
  return (race.runners || []).filter((r) => !isRunner(r)).map((r) => r.runnerNumber);
}

function priceOf(entry) {
  const runner = entry.runner;
  return {
    runnerNumber: runner.runnerNumber,
    name: runner.name,
    decimal: entry.decimal,
    fractional: runner.odds && runner.odds.fractional ? runner.odds.fractional : null
  };
}

export function evaluateRace(race, ruleset = PHASE1_RULESET) {
  const rules = ruleset.rules;
  const trace = [];
  let rejectionCode = null;
  const step = (code, passed, detail, explicitRejection = null) => {
    const entry = { order: trace.length + 1, code, passed, detail };
    if (!passed) {
      entry.rejectionCode = explicitRejection || code;
      if (!rejectionCode) rejectionCode = entry.rejectionCode;
    }
    trace.push(entry);
    return passed;
  };

  const region = String(race.courseRegion || race.region || '').toUpperCase();
  step('REGION', rules.regions.includes(region), `region=${region || 'unknown'}`, REJECTION_CODES.NOT_GREAT_BRITAIN);

  const raceType = String(race.raceType || '');
  step('RACE_TYPE', rules.raceTypes.includes(raceType), `raceType=${raceType || 'unknown'}`, REJECTION_CODES.NOT_FLAT);

  const handicapPass = !rules.handicapOnly || race.isHandicap === true;
  step('HANDICAP', handicapPass, `isHandicap=${race.isHandicap === true}`, REJECTION_CODES.NOT_HANDICAP);

  const classNumber = Number(race.class);
  step('CLASS', rules.classes.map(Number).includes(classNumber), `class=${race.class === undefined ? 'missing' : race.class}`, REJECTION_CODES.CLASS_OUT_OF_RANGE);

  const field = actualRunnerNumbers(race);
  step(
    'FIELD_SIZE',
    field.length >= rules.minRunners && field.length <= rules.maxRunners,
    `actualRunners=${field.length} (allowed ${rules.minRunners}-${rules.maxRunners})`,
    REJECTION_CODES.FIELD_SIZE_OUT_OF_RANGE
  );

  const activeRunners = (race.runners || []).filter(isRunner);
  const priced = activeRunners.map((runner) => ({ runner, decimal: runnerDecimal(runner) })).filter((x) => x.decimal !== null);
  const oddsComplete = rules.requireCompleteOdds
    ? activeRunners.length > 0 && priced.length === activeRunners.length
    : priced.length > 0;
  step('ODDS_COMPLETENESS', oddsComplete, `pricedRunners=${priced.length}/${activeRunners.length}`, REJECTION_CODES.INCOMPLETE_ODDS);

  const favourites = priced.filter((x) => isStrongFavourite(x.decimal, rules.favouriteMaxDecimal));
  let favouritePass = true;
  if (rules.favouriteMode === 'exactlyOne') favouritePass = favourites.length === 1;
  else if (rules.favouriteMode === 'atLeastOne') favouritePass = favourites.length >= 1;
  if (rules.favouriteMode === 'ignore') {
    step('STRONG_FAVOURITE', true, 'favourite rule ignored (experimental)');
  } else if (favourites.length === 0) {
    step('STRONG_FAVOURITE', false, `strong favourites at or below ${rules.favouriteMaxFractional || rules.favouriteMaxDecimal}: 0`, REJECTION_CODES.NO_STRONG_FAVOURITE);
  } else if (rules.favouriteMode === 'exactlyOne' && favourites.length > 1) {
    step('STRONG_FAVOURITE', false, `strong favourites at or below ${rules.favouriteMaxFractional || rules.favouriteMaxDecimal}: ${favourites.length}`, REJECTION_CODES.MULTIPLE_STRONG_FAVOURITES);
  } else {
    step('STRONG_FAVOURITE', favouritePass, `strong favourites at or below ${rules.favouriteMaxFractional || rules.favouriteMaxDecimal}: ${favourites.length}`);
  }

  const longshots = priced
    .filter((x) => isLongshot(x.decimal, rules.longshotMinDecimal))
    .sort((a, b) => (a.decimal === b.decimal ? a.runner.runnerNumber - b.runner.runnerNumber : a.decimal - b.decimal));
  if (longshots.length === 0) {
    step('LONGSHOT', false, `longshots at or above ${rules.longshotMinFractional || rules.longshotMinDecimal}: 0`, REJECTION_CODES.NO_LONGSHOT);
  } else {
    step('LONGSHOT', true, `longshots at or above ${rules.longshotMinFractional || rules.longshotMinDecimal}: ${longshots.length}`);
  }

  const favourite = favourites.length > 0
    ? priceOf([...favourites].sort((a, b) => a.decimal - b.decimal)[0])
    : null;
  const candidate = rejectionCode === null && longshots.length > 0
    ? { ...priceOf(longshots[0]), tieBreakApplied: longshots.length > 1 && longshots[0].decimal === longshots[1].decimal }
    : null;
  step(
    'CANDIDATE',
    candidate !== null,
    candidate
      ? `candidate=#${candidate.runnerNumber} ${candidate.name} @ ${candidate.decimal}${candidate.tieBreakApplied ? ' (tie broken by lowest runner number)' : ''}`
      : 'no candidate because an earlier rule failed'
  );

  return {
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.version,
    status: rejectionCode === null ? 'qualified' : 'rejected',
    qualificationStatus: rejectionCode === null ? QUALIFIED : null,
    rejectionCode,
    actualRunners: field.length,
    nonRunnerNumbers: nonRunnerNumbers(race),
    strongFavouriteCount: favourites.length,
    favourite,
    longshots: longshots.map(priceOf),
    candidate,
    trace
  };
}

export function evaluationSummary(race, evaluation, extra = {}) {
  return {
    raceId: race.raceId,
    date: race.date,
    time: race.time ?? null,
    course: race.course,
    courseRegion: race.courseRegion ?? null,
    raceType: race.raceType ?? null,
    isHandicap: race.isHandicap === true,
    class: race.class ?? null,
    raceName: race.name ?? null,
    declaredRunners: race.declaredRunners ?? (race.runners || []).length,
    actualRunners: evaluation.actualRunners,
    nonRunners: evaluation.nonRunnerNumbers.length,
    status: evaluation.status,
    qualificationStatus: evaluation.qualificationStatus,
    rejectionCode: evaluation.rejectionCode,
    favouriteRunnerNumber: evaluation.favourite ? evaluation.favourite.runnerNumber : null,
    favouriteDecimal: evaluation.favourite ? evaluation.favourite.decimal : null,
    candidateRunnerNumber: evaluation.candidate ? evaluation.candidate.runnerNumber : null,
    candidateName: evaluation.candidate ? evaluation.candidate.name : null,
    candidateDecimal: evaluation.candidate ? evaluation.candidate.decimal : null,
    resultStatus: race.resultStatus ?? 'unresolved',
    validationStatus: race.validation && race.validation.status ? race.validation.status : 'unknown',
    path: extra.path ?? null,
    sourceUrl: race.sourceUrl ?? null,
    retrievedAt: race.retrievedAt ?? null
  };
}
