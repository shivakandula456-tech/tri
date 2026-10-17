import { parseFractional } from './odds.js';
import { validateRaceRecord } from './validate-core.js';

export const RACE_COLUMNS = [
  'recordType', 'raceId', 'date', 'time', 'course', 'courseRegion', 'raceType', 'isHandicap', 'class',
  'declaredRunners', 'actualRunners', 'raceName', 'distance', 'going', 'resultStatus',
  'favouriteRunnerNumber', 'favouriteOddsDecimal',
  'candidateRunnerNumber', 'candidateOddsDecimal', 'rejectionCode',
  'sourceUrl', 'retrievedAt'
];

export const RUNNER_COLUMNS = [
  'recordType', 'raceId', 'runnerNumber', 'name', 'status', 'oddsFractional', 'oddsDecimal',
  'spFractional', 'spDecimal', 'finishPosition', 'resultStatus', 'jockey', 'trainer'
];

export function toCsv(columns, rows) {
  const esc = (value) => {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${columns.join(',')}\n${rows.map((row) => columns.map((col) => esc(row[col])).join(',')).join('\n')}\n`;
}

export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export function csvRowsToObjects(rows) {
  if (rows.length === 0) return { headers: [], objects: [] };
  const headers = rows[0].map((h) => h.trim());
  const objects = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] === undefined ? '' : r[i];
    });
    return obj;
  });
  return { headers, objects };
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function truthyFlag(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

export function exportRaceRows(races) {
  return races.map((race) => {
    const evaluation = race.evaluation || null;
    return {
      recordType: 'race',
      raceId: race.raceId,
      date: race.date,
      time: race.time ?? '',
      course: race.course,
      courseRegion: race.courseRegion,
      raceType: race.raceType,
      isHandicap: race.isHandicap ? 'true' : 'false',
      class: race.class,
      declaredRunners: race.declaredRunners ?? (race.runners || []).length,
      actualRunners: race.actualRunners ?? (race.runners || []).filter((r) => r.status !== 'non_runner').length,
      raceName: race.name ?? '',
      distance: race.distance ?? '',
      going: race.going ?? '',
      resultStatus: race.resultStatus ?? 'unresolved',
      favouriteRunnerNumber: evaluation && evaluation.favourite ? evaluation.favourite.runnerNumber : '',
      favouriteOddsDecimal: evaluation && evaluation.favourite ? evaluation.favourite.decimal : '',
      candidateRunnerNumber: evaluation && evaluation.candidate ? evaluation.candidate.runnerNumber : '',
      candidateOddsDecimal: evaluation && evaluation.candidate ? evaluation.candidate.decimal : '',
      rejectionCode: evaluation ? evaluation.rejectionCode ?? '' : '',
      sourceUrl: race.sourceUrl ?? '',
      retrievedAt: race.retrievedAt ?? ''
    };
  });
}

export function exportRunnerRows(races) {
  const rows = [];
  for (const race of races) {
    for (const runner of race.runners || []) {
      rows.push({
        recordType: 'runner',
        raceId: race.raceId,
        runnerNumber: runner.runnerNumber,
        name: runner.name,
        status: runner.status || 'runner',
        oddsFractional: runner.odds ? runner.odds.fractional ?? '' : '',
        oddsDecimal: runner.odds ? runner.odds.decimal ?? '' : '',
        spFractional: runner.sp ? runner.sp.fractional ?? '' : '',
        spDecimal: runner.sp ? runner.sp.decimal ?? '' : '',
        finishPosition: runner.finishPosition ?? '',
        resultStatus: runner.resultStatus ?? '',
        jockey: runner.jockey ?? '',
        trainer: runner.trainer ?? ''
      });
    }
  }
  return rows;
}

export function exportRacesCsv(races) {
  return toCsv(RACE_COLUMNS, exportRaceRows(races));
}

export function exportRunnersCsv(races) {
  return toCsv(RUNNER_COLUMNS, exportRunnerRows(races));
}

export const DATASET_COLUMNS = [...RACE_COLUMNS, ...RUNNER_COLUMNS.filter((col) => !RACE_COLUMNS.includes(col))];

export function exportDatasetCsv(races) {
  const rows = [...exportRaceRows(races), ...exportRunnerRows(races)];
  return {
    csv: toCsv(DATASET_COLUMNS, rows),
    raceRows: races.length,
    runnerRows: rows.length - races.length
  };
}

export function importDatasetFromCsv(text, options = {}) {
  const { headers, objects } = csvRowsToObjects(parseCsv(text));
  const errors = [];
  const warnings = [];
  const rejected = [];

  const requiredRaceColumns = ['recordType', 'raceId', 'date', 'course', 'courseRegion', 'raceType', 'isHandicap', 'class'];
  const requiredRunnerColumns = ['recordType', 'raceId', 'runnerNumber', 'name'];
  const headerSet = new Set(headers);
  for (const col of requiredRaceColumns) if (!headerSet.has(col)) errors.push({ code: 'MISSING_COLUMN', message: `CSV is missing required column "${col}".` });
  for (const col of requiredRunnerColumns) if (!headerSet.has(col)) errors.push({ code: 'MISSING_COLUMN', message: `CSV is missing required column "${col}".` });
  if (errors.length > 0) return { races: [], rejected: [], errors, warnings };

  const raceMap = new Map();
  for (const obj of objects) {
    const kind = String(obj.recordType || '').trim().toLowerCase();
    const raceId = String(obj.raceId || '').trim();
    if (!raceId) {
      warnings.push({ code: 'EMPTY_ROW', message: 'Row without a raceId was skipped.' });
      continue;
    }
    if (kind === 'race') {
      if (raceMap.has(raceId)) {
        errors.push({ code: 'DUPLICATE_RACE_ROW', message: `raceId ${raceId} appears in more than one race row.` });
        continue;
      }
      raceMap.set(raceId, {
        raceId,
        dataset: options.dataset || 'imported',
        testData: options.testData === true,
        source: 'csv-import',
        sourceUrl: obj.sourceUrl || null,
        retrievedAt: obj.retrievedAt || null,
        parserVersion: 'csv-import-1.0.0',
        date: String(obj.date || '').trim(),
        time: obj.time ? String(obj.time).trim() : null,
        course: String(obj.course || '').trim(),
        courseRegion: String(obj.courseRegion || '').trim().toUpperCase(),
        raceType: String(obj.raceType || '').trim(),
        isHandicap: truthyFlag(obj.isHandicap),
        class: optionalNumber(obj.class),
        name: obj.raceName ? String(obj.raceName).trim() : null,
        distance: obj.distance ? String(obj.distance).trim() : null,
        going: obj.going ? String(obj.going).trim() : null,
        declaredRunners: optionalNumber(obj.declaredRunners),
        actualRunners: optionalNumber(obj.actualRunners),
        resultStatus: obj.resultStatus ? String(obj.resultStatus).trim() : 'unresolved',
        validation: { status: 'pending', checks: [] },
        runners: []
      });
    } else if (kind === 'runner') {
      const race = raceMap.get(raceId);
      if (!race) {
        rejected.push({ raceId, reason: 'Runner row references a raceId with no race row in the same file.' });
        continue;
      }
      const oddsFractional = obj.oddsFractional ? String(obj.oddsFractional).trim() : null;
      const spFractional = obj.spFractional ? String(obj.spFractional).trim() : null;
      const oddsDecimal = optionalNumber(obj.oddsDecimal);
      const spDecimal = optionalNumber(obj.spDecimal);
      const odds = oddsFractional || oddsDecimal !== null
        ? { fractional: oddsFractional, decimal: oddsDecimal !== null ? oddsDecimal : parseFractional(oddsFractional) }
        : null;
      const sp = spFractional || spDecimal !== null
        ? { fractional: spFractional, decimal: spDecimal !== null ? spDecimal : parseFractional(spFractional), capturedAt: null }
        : null;
      race.runners.push({
        runnerNumber: optionalNumber(obj.runnerNumber),
        name: String(obj.name || '').trim(),
        status: String(obj.status || 'runner').trim() === 'non_runner' ? 'non_runner' : 'runner',
        odds,
        sp,
        finishPosition: optionalNumber(obj.finishPosition),
        resultStatus: obj.resultStatus ? String(obj.resultStatus).trim() : null,
        jockey: obj.jockey ? String(obj.jockey).trim() : null,
        trainer: obj.trainer ? String(obj.trainer).trim() : null
      });
    } else if (kind) {
      warnings.push({ code: 'UNKNOWN_RECORD_TYPE', message: `Row with recordType "${obj.recordType}" was skipped.` });
    }
  }

  const races = [];
  for (const race of raceMap.values()) {
    if (race.runners.length < 2) {
      rejected.push({ raceId: race.raceId, reason: `Race has ${race.runners.length} runner row(s); at least 2 are required.` });
      continue;
    }
    if (race.declaredRunners === null) race.declaredRunners = race.runners.length;
    if (race.actualRunners === null) race.actualRunners = race.runners.filter((r) => r.status !== 'non_runner').length;
    const result = validateRaceRecord(race, { expectedDataset: options.dataset === 'imported' ? 'imported' : undefined });
    if (result.errors.length > 0) {
      rejected.push({ raceId: race.raceId, reason: result.errors.map((e) => `${e.code}: ${e.message}`).join(' | ') });
      continue;
    }
    for (const w of result.warnings) warnings.push({ ...w, raceId: race.raceId });
    races.push(race);
  }

  return { races, rejected, errors, warnings };
}

export function racesToJsonExport(races, meta = {}) {
  return JSON.stringify({
    format: 'atr-research-dataset-1',
    exportedAt: new Date().toISOString(),
    meta,
    races
  }, null, 2);
}

export function parseDatasetJson(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return { races: parsed, meta: {} };
  if (parsed && Array.isArray(parsed.races)) return { races: parsed.races, meta: parsed.meta || {} };
  throw new Error('Unrecognised dataset JSON: expected an array of races or an object with a races array.');
}
