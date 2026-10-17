import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, EXIT_CODES, REPO_ROOT } from './config.js';
import {
  validateDataset,
  validateIndexFile,
  validateManifest,
  validateStatusFile,
  validateRaceRecord,
  summarizeIssues
} from '../../js/core/validate-core.js';
import { PARSER_VERSION } from './atr-parser.js';

function walkJson(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJson(full));
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

function readJsonFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text);
}

export function validateRepository({ baseDir = REPO_ROOT, fixturesOnly = false, write = false, logger = console.log } = {}) {
  const issues = { errors: [], warnings: [] };
  const summary = {
    generatedAt: new Date().toISOString(),
    parserVersion: PARSER_VERSION,
    mode: fixturesOnly ? 'fixtures-only' : 'full',
    published: { races: 0, files: 0 },
    fixtures: { races: 0, files: 0 },
    index: { status: 'not_checked', races: 0 },
    statusFile: { status: 'not_checked', runs: 0 },
    byCode: {}
  };

  const fixtureRaces = [];
  const fixtureManifestPath = path.join(baseDir, CONFIG.paths.fixtureManifest);
  if (fs.existsSync(fixtureManifestPath)) {
    try {
      const manifest = readJsonFile(fixtureManifestPath);
      const manifestResult = validateManifest(manifest);
      issues.errors.push(...manifestResult.errors.map((e) => ({ ...e, source: 'fixtures-manifest.json' })));
      issues.warnings.push(...manifestResult.warnings.map((e) => ({ ...e, source: 'fixtures-manifest.json' })));
    } catch (error) {
      issues.errors.push({ code: 'JSON_PARSE_ERROR', source: 'fixtures-manifest.json', message: String(error.message || error) });
    }
  } else {
    issues.errors.push({ code: 'MISSING_FILE', source: CONFIG.paths.fixtureManifest, message: 'Fixture manifest is missing.' });
  }

  const fixtureDir = path.join(baseDir, CONFIG.paths.fixtureRacesDir);
  for (const file of walkJson(fixtureDir)) {
    const rel = path.relative(baseDir, file).replace(/\\/g, '/');
    try {
      const race = readJsonFile(file);
      fixtureRaces.push(race);
      const result = validateRaceRecord(race, { expectedDataset: 'test-fixture' });
      issues.errors.push(...result.errors.map((e) => ({ ...e, source: rel })));
      issues.warnings.push(...result.warnings.map((e) => ({ ...e, source: rel })));
      summary.fixtures.files += 1;
    } catch (error) {
      issues.errors.push({ code: 'JSON_PARSE_ERROR', source: rel, message: String(error.message || error) });
    }
  }
  const fixtureDataset = validateDataset(fixtureRaces, { expectedDataset: 'test-fixture' });
  issues.errors.push(...fixtureDataset.errors.map((e) => ({ ...e, source: 'fixtures-dataset' })));
  issues.warnings.push(...fixtureDataset.warnings.map((e) => ({ ...e, source: 'fixtures-dataset' })));
  summary.fixtures.races = fixtureRaces.length;

  if (!fixturesOnly) {
    const publishedRaces = [];
    const racesDir = path.join(baseDir, CONFIG.paths.racesDir);
    for (const file of walkJson(racesDir)) {
      const rel = path.relative(baseDir, file).replace(/\\/g, '/');
      try {
        const race = readJsonFile(file);
        publishedRaces.push(race);
        const result = validateRaceRecord(race, { expectedDataset: 'published', strictEvaluation: true, requireTimestamps: true });
        issues.errors.push(...result.errors.map((e) => ({ ...e, source: rel })));
        issues.warnings.push(...result.warnings.map((e) => ({ ...e, source: rel })));
        summary.published.files += 1;
      } catch (error) {
        issues.errors.push({ code: 'JSON_PARSE_ERROR', source: rel, message: String(error.message || error) });
      }
    }
    const publishedDataset = validateDataset(publishedRaces, { expectedDataset: 'published' });
    issues.errors.push(...publishedDataset.errors.map((e) => ({ ...e, source: 'published-dataset' })));
    issues.warnings.push(...publishedDataset.warnings.map((e) => ({ ...e, source: 'published-dataset' })));
    summary.published.races = publishedRaces.length;

    const indexPath = path.join(baseDir, CONFIG.paths.indexFile);
    if (fs.existsSync(indexPath)) {
      try {
        const index = readJsonFile(indexPath);
        const indexResult = validateIndexFile(index);
        issues.errors.push(...indexResult.errors.map((e) => ({ ...e, source: CONFIG.paths.indexFile })));
        issues.warnings.push(...indexResult.warnings.map((e) => ({ ...e, source: CONFIG.paths.indexFile })));
        summary.index.status = indexResult.errors.length === 0 ? 'ok' : 'errors';
        summary.index.races = Array.isArray(index.races) ? index.races.length : 0;
        const indexIds = new Set((index.races || []).map((r) => r.raceId));
        for (const race of publishedRaces) {
          if (race && race.raceId && !indexIds.has(race.raceId)) {
            issues.errors.push({ code: 'INDEX_MISSING_RACE', source: CONFIG.paths.indexFile, raceId: race.raceId, message: `Race ${race.raceId} exists on disk but is not listed in the index.` });
          }
        }
        for (const entry of index.races || []) {
          const rel = String(entry.path || '').replace(/\\/g, '/');
          if (rel && !fs.existsSync(path.join(baseDir, rel))) {
            issues.errors.push({ code: 'INDEX_DANGLING_PATH', source: CONFIG.paths.indexFile, raceId: entry.raceId, message: `Index entry points at ${rel} but the file does not exist.` });
          }
        }
      } catch (error) {
        issues.errors.push({ code: 'JSON_PARSE_ERROR', source: CONFIG.paths.indexFile, message: String(error.message || error) });
      }
    } else {
      issues.errors.push({ code: 'MISSING_FILE', source: CONFIG.paths.indexFile, message: 'Published index file is missing.' });
    }

    const statusPath = path.join(baseDir, CONFIG.paths.statusFile);
    if (fs.existsSync(statusPath)) {
      try {
        const status = readJsonFile(statusPath);
        const statusResult = validateStatusFile(status);
        issues.errors.push(...statusResult.errors.map((e) => ({ ...e, source: CONFIG.paths.statusFile })));
        issues.warnings.push(...statusResult.warnings.map((e) => ({ ...e, source: CONFIG.paths.statusFile })));
        summary.statusFile.status = statusResult.errors.length === 0 ? 'ok' : 'errors';
        summary.statusFile.runs = Array.isArray(status.runs) ? status.runs.length : 0;
      } catch (error) {
        issues.errors.push({ code: 'JSON_PARSE_ERROR', source: CONFIG.paths.statusFile, message: String(error.message || error) });
      }
    } else {
      issues.errors.push({ code: 'MISSING_FILE', source: CONFIG.paths.statusFile, message: 'Collection status file is missing.' });
    }
  }

  summary.byCode = summarizeIssues(issues.errors, issues.warnings).byCode;
  const report = { status: issues.errors.length === 0 ? 'passed' : 'failed', ...summary, issues };

  if (write && !fixturesOnly) {
    fs.writeFileSync(path.join(baseDir, CONFIG.paths.validationReport), `${JSON.stringify(report, null, 2)}\n`);
  }

  logger(`[validate] mode=${report.mode} published=${summary.published.races} fixtures=${summary.fixtures.races} errors=${issues.errors.length} warnings=${issues.warnings.length}`);
  for (const error of issues.errors.slice(0, 30)) {
    logger(`  ERROR ${error.code} ${error.source || ''} ${error.raceId ? `race=${error.raceId} ` : ''}${error.message}`);
  }
  if (issues.errors.length > 30) logger(`  ...and ${issues.errors.length - 30} more errors`);
  for (const warning of issues.warnings.slice(0, 20)) {
    logger(`  WARN ${warning.code} ${warning.source || ''} ${warning.raceId ? `race=${warning.raceId} ` : ''}${warning.message}`);
  }
  return report;
}

function parseArgs(argv) {
  return {
    fixturesOnly: argv.includes('--fixtures-only'),
    write: argv.includes('--write'),
    strict: argv.includes('--strict')
  };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isDirectRun) {
  const args = parseArgs(process.argv.slice(2));
  const report = validateRepository({ fixturesOnly: args.fixturesOnly, write: args.write });
  const failed = report.status === 'failed' || (args.strict && report.issues.warnings.length > 0);
  process.exitCode = failed ? EXIT_CODES.VALIDATION_FAILED : EXIT_CODES.OK;
}

export { parseArgs as parseValidateArgs };
