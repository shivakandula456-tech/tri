import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTOR_VERSION, CONFIG, EXIT_CODES, REPO_ROOT, emptyIndex, initialState, racecardsIndexUrl } from './config.js';
import { createHttpClient } from './http.js';
import { fetchRobots, robotsDecision } from './robots.js';
import { PARSER_VERSION, applyResultsPatch, discoverRaceLinks, parseRacecard, parseResults } from './atr-parser.js';
import { PHASE1_RULESET, evaluateRace, evaluationSummary } from '../../js/core/rules-core.js';
import { validateRaceRecord } from '../../js/core/validate-core.js';
import { eachDate, fnv1a, isoNow, stableStringify } from '../../js/core/util.js';

export function createFsIO(baseDir = REPO_ROOT) {
  const abs = (rel) => path.join(baseDir, rel);
  return {
    baseDir,
    readText: (rel) => fs.readFileSync(abs(rel), 'utf8'),
    writeText: (rel, text) => {
      fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
      fs.writeFileSync(abs(rel), text);
    },
    exists: (rel) => fs.existsSync(abs(rel)),
    list: (rel) => {
      try {
        return fs.readdirSync(abs(rel));
      } catch {
        return [];
      }
    },
    readJson(rel) {
      return this.exists(rel) ? JSON.parse(this.readText(rel)) : null;
    },
    writeJson(rel, value) {
      this.writeText(rel, `${JSON.stringify(value, null, 2)}\n`);
    }
  };
}

export function createMemoryIO(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    readText: (rel) => (files.has(rel) ? files.get(rel) : null),
    writeText: (rel, text) => files.set(rel, text),
    exists: (rel) => files.has(rel),
    list: (rel) => [...files.keys()].filter((key) => key.startsWith(`${rel}/`)),
    readJson(rel) {
      return files.has(rel) ? JSON.parse(files.get(rel)) : null;
    },
    writeJson(rel, value) {
      files.set(rel, `${JSON.stringify(value, null, 2)}\n`);
    },
    snapshot: () => Object.fromEntries(files)
  };
}

export function createFixtureClient(pages) {
  const map = new Map(Object.entries(pages));
  const stats = { requests: 0, retries: 0, blocked: false, totalBytes: 0 };
  return {
    stats,
    async request(url) {
      stats.requests += 1;
      if (!map.has(url)) {
        return { ok: false, status: 404, headers: {}, body: '', error: 'http_404', attempts: 1, url };
      }
      const body = map.get(url);
      stats.totalBytes += body.length;
      return { ok: true, status: 200, headers: { 'content-type': 'text/html' }, body, attempts: 1, url };
    }
  };
}

export function computeHashes(race) {
  const structuralHash = fnv1a(stableStringify({
    date: race.date,
    course: race.course,
    raceType: race.raceType,
    isHandicap: race.isHandicap,
    class: race.class,
    runners: (race.runners || []).map((r) => ({ n: r.runnerNumber, nm: r.name, st: r.status }))
  }));
  const snapshotHash = fnv1a(stableStringify({
    odds: (race.runners || []).map((r) => [r.runnerNumber, r.odds ? r.odds.decimal : null]),
    sp: (race.runners || []).map((r) => [r.runnerNumber, r.sp ? r.sp.decimal : null]),
    positions: (race.runners || []).map((r) => [r.runnerNumber, r.finishPosition ?? null, r.resultStatus ?? null]),
    resultStatus: race.resultStatus
  }));
  return { structuralHash, snapshotHash };
}

export function raceFilePath(race, racesDir = CONFIG.paths.racesDir) {
  const [year, month] = race.date.split('-');
  return `${racesDir}/${year}/${month}/${race.date}/${race.raceId}.json`;
}

export function mergeIndex(existingIndex, newEntries, options = {}) {
  const windowFrom = options.windowFrom || CONFIG.windowFrom;
  const windowTo = options.windowTo || CONFIG.windowTo;
  const replacedIds = new Set(newEntries.map((e) => e.raceId));
  const merged = [
    ...(existingIndex.races || []).filter((entry) => !replacedIds.has(entry.raceId)),
    ...newEntries
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if ((a.time || '') !== (b.time || '')) return (a.time || '') < (b.time || '') ? -1 : 1;
    if (a.course !== b.course) return a.course < b.course ? -1 : 1;
    return a.raceId < b.raceId ? -1 : 1;
  });

  const counts = {
    races: merged.length,
    qualified: merged.filter((e) => e.status === 'qualified').length,
    rejected: merged.filter((e) => e.status === 'rejected').length,
    resolvedResults: merged.filter((e) => e.resultStatus === 'resolved').length
  };
  const days = eachDate(windowFrom, windowTo);
  const daysWithData = [...new Set(merged.map((e) => e.date))].filter((d) => d >= windowFrom && d <= windowTo).sort();
  const coverage = {
    daysWithData,
    daysWithoutData: days.filter((d) => !daysWithData.includes(d))
  };

  return {
    schemaVersion: '1.0.0',
    datasetStatus: merged.length > 0 ? 'published' : 'not_collected',
    collectorVersion: COLLECTOR_VERSION,
    parserVersion: options.parserVersion || PARSER_VERSION,
    generatedAt: options.generatedAt || isoNow(),
    window: { requestedFrom: windowFrom, requestedTo: windowTo },
    counts,
    coverage,
    integrity: {
      structuralHash: fnv1a(stableStringify(merged.map((e) => [e.raceId, e.structuralHash || null]))),
      lastValidatedAt: null,
      status: 'pending'
    },
    races: merged
  };
}

export function planRaceWrites(entries, existingById) {
  const writes = [];
  let skipped = 0;
  let updated = 0;
  for (const entry of entries) {
    const race = entry.record;
    const existing = existingById.get(race.raceId) || null;
    const { structuralHash, snapshotHash } = computeHashes(race);
    if (existing && existing.structuralHash === structuralHash && existing.snapshotHash === snapshotHash) {
      skipped += 1;
      continue;
    }
    const revision = existing ? (existing.revision || 1) + 1 : 1;
    if (existing) updated += 1;
    writes.push({ entry, existing, structuralHash, snapshotHash, revision, path: raceFilePath(race) });
  }
  return { writes, skipped, updated };
}

function failedCheckNames(checks) {
  return (checks || []).filter((c) => !c.passed).map((c) => c.name);
}

export async function runPipeline({ mode, dates, client, io, now = () => new Date(), logger = () => {}, config = CONFIG }) {
  const started = now();
  const runId = `${isoNow(started).replace(/[:.]/g, '-')}-${mode}`;
  const report = {
    runId,
    mode,
    collectorVersion: COLLECTOR_VERSION,
    parserVersion: PARSER_VERSION,
    startedAt: isoNow(started),
    finishedAt: null,
    dates,
    status: 'running',
    blocked: false,
    blockedReason: null,
    exitCode: null,
    robots: null,
    counts: {
      requests: 0,
      discovered: 0,
      parsed: 0,
      parseFailed: 0,
      evaluatedQualified: 0,
      evaluatedRejected: 0,
      published: 0,
      updated: 0,
      skippedDuplicates: 0,
      resultsResolved: 0,
      resultsUnresolved: 0
    },
    failures: [],
    notes: [],
    summaryText: ''
  };

  const robots = await fetchRobots(client, config.siteBase);
  report.robots = { present: robots.present, unclear: robots.unclear, reason: robots.reason, url: robots.url };
  if (robots.unclear) {
    return finish(report, {
      status: 'blocked',
      blocked: true,
      blockedReason: `robots_unclear:${robots.reason}`,
      exitCode: EXIT_CODES.BLOCKED
    }, mode, io, config);
  }
  const decision = robotsDecision(robots.parsed, { path: '/racecards/', userAgent: config.robotsUserAgent });
  report.robots.decision = { allowed: decision.allowed, reason: decision.reason };
  if (!decision.allowed) {
    return finish(report, {
      status: 'blocked',
      blocked: true,
      blockedReason: `robots_disallow:${decision.reason}`,
      exitCode: EXIT_CODES.BLOCKED
    }, mode, io, config);
  }
  if (decision.crawlDelayMs && decision.crawlDelayMs > config.requestIntervalMs) {
    report.notes.push(`robots.txt advertises crawl-delay of ${decision.crawlDelayMs}ms; the collector interval (${config.requestIntervalMs}ms) will be raised for this run.`);
  }

  const state = mode === 'live' ? io.readJson(config.paths.stateFile) || initialState() : initialState();
  const existingIndex = io.readJson(config.paths.indexFile) || emptyIndex();
  const existingById = new Map((existingIndex.races || []).map((entry) => [entry.raceId, entry]));
  const skippedUrls = new Set(state.completedUrls || []);

  const parsedEntries = [];
  let blockedDuringRun = null;

  outer: for (const date of dates) {
    if (now().getTime() - started.getTime() > config.maxRunMs) {
      report.notes.push(`Time budget of ${config.maxRunMs}ms exhausted before processing ${date}; remaining dates are left for the next run.`);
      break;
    }
    const indexUrl = racecardsIndexUrl(date, config.siteBase);
    const indexResponse = await client.request(indexUrl);
    if (indexResponse.blocked) {
      blockedDuringRun = { url: indexUrl, reason: indexResponse.reason || 'blocked' };
      break;
    }
    if (!indexResponse.ok) {
      report.failures.push({ url: indexUrl, reason: indexResponse.error || `http_${indexResponse.status}` });
      continue;
    }
    const links = discoverRaceLinks(indexResponse.body, indexUrl, { hint: config.raceLinkHint });
    const budget = Math.max(config.maxRacesPerRun - parsedEntries.length, 0);
    const selected = links.slice(0, budget);
    if (links.length > selected.length) {
      report.notes.push(`Discovered ${links.length} racecard links for ${date}; ${selected.length} processed within the per-run budget of ${config.maxRacesPerRun}.`);
    }
    report.counts.discovered += selected.length;

    for (const link of selected) {
      if (now().getTime() - started.getTime() > config.maxRunMs) {
        report.notes.push('Time budget exhausted mid-date; remaining racecards are left for the next run.');
        break outer;
      }
      if (mode === 'live' && skippedUrls.has(link)) {
        report.counts.skippedDuplicates += 1;
        continue;
      }
      const page = await client.request(link);
      if (page.blocked) {
        blockedDuringRun = { url: link, reason: page.reason || 'blocked' };
        break outer;
      }
      if (!page.ok) {
        report.failures.push({ url: link, reason: page.error || `http_${page.status}` });
        state.failedTargets.push({ url: link, at: isoNow(now()), reason: page.error || `http_${page.status}` });
        continue;
      }
      const retrievedAt = isoNow(now());
      const parsed = parseRacecard(page.body, { sourceUrl: link, retrievedAt });
      if (!parsed.ok) {
        report.counts.parseFailed += 1;
        report.failures.push({ url: link, reason: parsed.reason, failedChecks: failedCheckNames(parsed.checks) });
        continue;
      }
      if (parsed.confidence < config.minParseConfidence) {
        report.counts.parseFailed += 1;
        report.failures.push({ url: link, reason: `low_parse_confidence:${parsed.confidence}` });
        continue;
      }
      let race = parsed.race;
      if (config.fetchResults) {
        const results = parseResults(page.body, { race, retrievedAt });
        if (results.ok) race = applyResultsPatch(race, results.patch, retrievedAt);
      }
      report.counts.parsed += 1;
      parsedEntries.push({ race, sourceUrl: link, confidence: parsed.confidence, checks: parsed.checks });
      if (mode === 'live') skippedUrls.add(link);
    }
  }

  report.counts.requests = client.stats.requests;

  if (blockedDuringRun) {
    report.failures.push({ url: blockedDuringRun.url, reason: blockedDuringRun.reason, blocked: true });
    return finish(report, {
      status: 'blocked',
      blocked: true,
      blockedReason: blockedDuringRun.reason,
      exitCode: EXIT_CODES.BLOCKED,
      extraNotes: ['Automated access appears blocked by the source. Collection stopped immediately. No bypass was attempted. Data was not published from this run.']
    }, mode, io, config);
  }

  const publishable = [];
  for (const entry of parsedEntries) {
    const race = entry.race;
    const evaluation = evaluateRace(race, PHASE1_RULESET);
    race.evaluation = evaluation;
    const validation = validateRaceRecord(race, { expectedDataset: 'published', strictEvaluation: true, requireTimestamps: true });
    race.validation = {
      status: validation.errors.length === 0 ? 'passed' : 'failed',
      parserChecks: entry.checks,
      confidence: entry.confidence,
      errors: validation.errors,
      warnings: validation.warnings,
      validatedAt: isoNow(now())
    };
    if (evaluation.status === 'qualified') report.counts.evaluatedQualified += 1;
    else report.counts.evaluatedRejected += 1;
    if (race.resultStatus === 'resolved') report.counts.resultsResolved += 1;
    else report.counts.resultsUnresolved += 1;
    if (validation.errors.length > 0) {
      report.failures.push({ url: entry.sourceUrl, reason: 'validation_failed', errors: validation.errors.slice(0, 5) });
      continue;
    }
    publishable.push({ record: race, sourceUrl: entry.sourceUrl, confidence: entry.confidence, checks: entry.checks });
  }

  const shouldPublish = mode === 'live' || mode === 'self-test';
  if (shouldPublish && publishable.length > 0) {
    const plan = planRaceWrites(publishable, existingById);
    const newEntries = [];
    for (const write of plan.writes) {
      const race = write.entry.record;
      race.revision = write.revision;
      race.updatedAt = isoNow(now());
      race.integrity = { structuralHash: write.structuralHash, snapshotHash: write.snapshotHash };
      io.writeJson(write.path, race);
      const summary = evaluationSummary(race, race.evaluation, { path: write.path });
      summary.structuralHash = write.structuralHash;
      summary.snapshotHash = write.snapshotHash;
      summary.revision = write.revision;
      newEntries.push(summary);
    }
    const nextIndex = mergeIndex(existingIndex, newEntries, { generatedAt: isoNow(now()) });
    io.writeJson(config.paths.indexFile, nextIndex);
    report.counts.published = newEntries.length;
    report.counts.updated = plan.updated;
    report.counts.skippedDuplicates += plan.skipped;

    state.lastRunId = report.runId;
    state.lastStartedAt = isoNow(started);
    state.lastFinishedAt = isoNow(now());
    state.completedUrls = [...skippedUrls].slice(-2000);
    state.completedRaceIds = [...new Set([...(state.completedRaceIds || []), ...newEntries.map((e) => e.raceId)])].slice(-5000);
    state.failedTargets = (state.failedTargets || []).slice(-500);
    io.writeJson(config.paths.stateFile, state);
  }

  const hadFailures = report.failures.length > 0;
  const status = hadFailures ? 'completed_with_failures' : parsedEntries.length > 0 ? 'ok' : 'no_data';
  return finish(report, {
    status,
    exitCode: status === 'ok' ? EXIT_CODES.OK : status === 'completed_with_failures' ? EXIT_CODES.PARTIAL : EXIT_CODES.VALIDATION_FAILED
  }, mode, io, config);
}

function persistRunArtifacts(io, config, result) {
  const status = io.readJson(config.paths.statusFile) || {
    schemaVersion: '1.0.0',
    collectorEnabled: false,
    parserValidatedAgainstLive: false,
    permissionStatus: 'unknown',
    runs: []
  };
  const entry = {
    runId: result.runId,
    mode: result.mode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    status: result.status,
    blocked: result.blocked,
    blockedReason: result.blockedReason,
    exitCode: result.exitCode,
    dates: result.dates,
    collectorVersion: result.collectorVersion,
    parserVersion: result.parserVersion,
    counts: result.counts,
    failures: result.failures.slice(0, 50),
    notes: result.notes
  };
  status.runs = [entry, ...(Array.isArray(status.runs) ? status.runs : [])].slice(0, 200);
  status.lastRun = entry;
  status.observedAccess = {
    checkedAt: result.finishedAt,
    blocked: result.blocked === true,
    reason: result.blockedReason || null,
    status: result.status
  };
  io.writeJson(config.paths.statusFile, status);

  io.writeJson(`${config.paths.logsDir}/${result.runId}.json`, result);
  const logsIndex = io.readJson(`${config.paths.logsDir}/index.json`) || { runs: [] };
  logsIndex.runs = [
    { runId: result.runId, at: result.startedAt, mode: result.mode, status: result.status, counts: { published: result.counts.published, parseFailed: result.counts.parseFailed } },
    ...(Array.isArray(logsIndex.runs) ? logsIndex.runs : [])
  ].slice(0, 100);
  io.writeJson(`${config.paths.logsDir}/index.json`, logsIndex);
}

function finish(report, outcome, mode, io, config) {
  const result = finalize(report, outcome);
  if (mode === 'live') persistRunArtifacts(io, config, result);
  return result;
}

function buildSummary(report) {
  const counts = report.counts;
  return [
    `# ATR collection run ${report.runId}`,
    '',
    `- Mode: \`${report.mode}\``,
    `- Status: **${report.status}**`,
    report.blockedReason ? `- Blocked reason: \`${report.blockedReason}\`` : null,
    `- Dates requested: ${report.dates.join(', ') || 'none'}`,
    `- Requests made: ${counts.requests}`,
    `- Racecards discovered: ${counts.discovered}`,
    `- Racecards parsed: ${counts.parsed} (${counts.parseFailed} failed)`,
    `- Evaluations: ${counts.evaluatedQualified} qualified, ${counts.evaluatedRejected} rejected`,
    `- Results resolved: ${counts.resultsResolved}, unresolved: ${counts.resultsUnresolved}`,
    `- Published: ${counts.published} (updated ${counts.updated}, duplicates skipped ${counts.skippedDuplicates})`,
    '',
    report.failures.length > 0 ? '## Failures' : null,
    ...report.failures.slice(0, 20).map((f) => `- ${f.url}: ${f.reason}${f.failedChecks ? ` (${f.failedChecks.join(', ')})` : ''}`),
    report.failures.length > 20 ? `- ...and ${report.failures.length - 20} more (see JSON report)` : null,
    report.notes.length > 0 ? '## Notes' : null,
    ...report.notes.map((n) => `- ${n}`),
    '',
    'Exit code guide: 0 ok, 2 blocked / attention required, 3 validation or discovery failure, 4 completed with failures (resumable).'
  ].filter((line) => line !== null).join('\n');
}

function finalize(report, outcome) {
  report.finishedAt = new Date().toISOString();
  report.status = outcome.status;
  report.blocked = outcome.blocked === true;
  report.blockedReason = outcome.blockedReason || null;
  report.exitCode = outcome.exitCode;
  if (outcome.extraNotes) report.notes.push(...outcome.extraNotes);
  if (report.robots && report.robots.present === false) {
    report.notes.push('robots.txt is absent at the source; collection proceeded under the project policy of honouring robots rules and stopping immediately on any block signal.');
  }
  report.summaryText = buildSummary(report);
  return report;
}

export function writeTmpArtifacts(report, tmpDir = CONFIG.paths.tmpDir, baseDir = REPO_ROOT) {
  const dir = path.join(baseDir, tmpDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'last-run-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'summary.md'), `${report.summaryText}\n`);
  return { reportPath: path.join(tmpDir, 'last-run-report.json'), summaryPath: path.join(tmpDir, 'summary.md') };
}

function loadFixturePages(config, baseDir) {
  const dir = path.join(baseDir, config.paths.htmlFixturesDir);
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  const indexUrl = racecardsIndexUrl(config.selfTestDate, config.siteBase);
  return {
    indexUrl,
    pages: {
      [`${config.siteBase}/robots.txt`]: read('atr-robots-observed-2026-10-18.txt'),
      [indexUrl]: read('synthetic-racecards-index.html'),
      [`${config.siteBase}/racecard/fixtureton/${config.selfTestDate}/1001`]: read('synthetic-racecard-1001.html'),
      [`${config.siteBase}/racecard/fixtureton/${config.selfTestDate}/1002`]: read('synthetic-racecard-1002-results.html'),
      [`${config.siteBase}/racecard/fixtureton/${config.selfTestDate}/1003`]: read('synthetic-racecard-1003-malformed.html')
    }
  };
}

export async function runSelfTest({ baseDir = REPO_ROOT, now = () => new Date(), logger = () => {} } = {}) {
  const { indexUrl, pages } = loadFixturePages(CONFIG, baseDir);
  const client = createFixtureClient(pages);
  const io = createMemoryIO({
    [CONFIG.paths.indexFile]: `${JSON.stringify(emptyIndex(), null, 2)}\n`,
    [CONFIG.paths.stateFile]: `${JSON.stringify(initialState(), null, 2)}\n`
  });
  const report = await runPipeline({
    mode: 'self-test',
    dates: [CONFIG.selfTestDate],
    client,
    io,
    now,
    logger,
    config: CONFIG
  });
  const snapshot = io.snapshot();
  const publishedFiles = Object.keys(snapshot).filter((key) => key.startsWith(`${CONFIG.paths.racesDir}/`));
  report.notes.push(`Self-test ran entirely against bundled synthetic fixtures. Index URL: ${indexUrl}`);
  report.notes.push(`Self-test wrote ${publishedFiles.length} race file(s) into an in-memory IO; nothing was written to data/.`);
  report.counts.published = publishedFiles.length;
  report.publishedFiles = publishedFiles;

  const expectedFailures = report.failures.filter((f) => f.url.endsWith('/1003') && (f.failedChecks || []).includes('runnerNamesComplete'));
  const unexpectedFailures = report.failures.filter((f) => !expectedFailures.includes(f));
  const healthy = unexpectedFailures.length === 0 && report.counts.parsed === 2 && publishedFiles.length === 2;
  report.status = healthy ? 'ok' : 'failed';
  report.exitCode = healthy ? EXIT_CODES.OK : EXIT_CODES.VALIDATION_FAILED;
  report.expectedFailures = expectedFailures.length;
  report.unexpectedFailures = unexpectedFailures.length;
  if (expectedFailures.length > 0) {
    report.notes.push('The malformed fixture 1003 failed parsing exactly as designed (essential check runnerNamesComplete); this run proves partial-failure detection and recovery reporting work.');
  }
  report.summaryText = buildSummary(report);
  return report;
}

export async function runProbe({ date, maxRacecards = 3, baseDir = REPO_ROOT, logger = () => {} } = {}) {
  const client = createHttpClient({
    timeoutMs: CONFIG.timeoutMs,
    intervalMs: CONFIG.requestIntervalMs,
    maxRetries: CONFIG.maxRetries,
    retryBaseMs: CONFIG.retryBaseMs,
    maxRequests: 10,
    userAgent: CONFIG.userAgent,
    logger
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const probeDir = path.join(baseDir, CONFIG.paths.probesDir, stamp);
  fs.mkdirSync(probeDir, { recursive: true });
  const report = {
    probeId: stamp,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    date,
    robots: null,
    indexUrl: null,
    indexFetch: null,
    discoveredLinks: [],
    racecardProbes: [],
    status: 'running'
  };

  const robots = await fetchRobots(client, CONFIG.siteBase);
  report.robots = { present: robots.present, unclear: robots.unclear, reason: robots.reason, url: robots.url };
  if (robots.unclear) {
    report.status = 'blocked';
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(probeDir, 'probe-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }
  const decision = robotsDecision(robots.parsed, { path: '/racecards/', userAgent: CONFIG.robotsUserAgent });
  report.robots.decision = { allowed: decision.allowed, reason: decision.reason };
  if (!decision.allowed) {
    report.status = 'blocked_by_robots';
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(probeDir, 'probe-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  const indexUrl = racecardsIndexUrl(date, CONFIG.siteBase);
  report.indexUrl = indexUrl;
  const indexResponse = await client.request(indexUrl);
  report.indexFetch = { ok: indexResponse.ok, status: indexResponse.status, blocked: indexResponse.blocked === true, reason: indexResponse.reason || indexResponse.error || null, bytes: indexResponse.body ? indexResponse.body.length : 0 };
  if (indexResponse.ok) {
    fs.writeFileSync(path.join(probeDir, 'racecards-index.html'), indexResponse.body);
    const links = discoverRaceLinks(indexResponse.body, indexUrl, { hint: CONFIG.raceLinkHint });
    report.discoveredLinks = links;
    for (const link of links.slice(0, maxRacecards)) {
      const page = await client.request(link);
      const entry = { url: link, ok: page.ok, status: page.status, blocked: page.blocked === true, reason: page.reason || page.error || null, bytes: page.body ? page.body.length : 0 };
      if (page.ok) {
        const fileName = `racecard-${fnv1a(link)}.html`;
        fs.writeFileSync(path.join(probeDir, fileName), page.body);
        entry.savedAs = fileName;
        const parsed = parseRacecard(page.body, { sourceUrl: link, retrievedAt: new Date().toISOString() });
        entry.parse = { ok: parsed.ok, confidence: parsed.confidence, reason: parsed.reason, failedChecks: failedCheckNames(parsed.checks), runners: parsed.race ? parsed.race.runners.length : 0, raceId: parsed.race ? parsed.race.raceId : null };
      }
      report.racecardProbes.push(entry);
    }
    report.status = report.racecardProbes.some((p) => p.ok) ? 'probe_completed' : 'probe_no_pages';
  } else if (indexResponse.blocked) {
    report.status = 'blocked';
  } else {
    report.status = 'index_fetch_failed';
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(probeDir, 'probe-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function parseArgs(argv) {
  const args = { mode: null, date: null, from: null, to: null, maxRaces: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--self-test') args.mode = 'self-test';
    else if (arg === '--dry-run') args.mode = 'dry-run';
    else if (arg === '--live') args.mode = 'live';
    else if (arg === '--probe') args.mode = 'probe';
    else if (arg === '--date') args.date = argv[++i] || null;
    else if (arg === '--from') args.from = argv[++i] || null;
    else if (arg === '--to') args.to = argv[++i] || null;
    else if (arg === '--max-races') args.maxRaces = Number(argv[++i]) || null;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

export function resolveDates(args, now = new Date()) {
  if (args.date) return [args.date];
  if (args.from && args.to) return eachDate(args.from, args.to);
  const today = now.toISOString().slice(0, 10);
  return [today];
}

function usage() {
  return [
    'ATR research collector',
    '',
    'Usage: node collector/src/collect.js [mode] [options]',
    '',
    'Modes:',
    '  --self-test   Parse bundled synthetic fixtures end to end. No network. Default and safest mode.',
    '  --dry-run     Contact the live source, parse and evaluate, but write nothing to data/.',
    '  --live        Contact the live source and publish validated data/ files. Requires explicit permission.',
    '  --probe       Accessibility and parser probe. Saves raw HTML under collector/.probe/, publishes nothing.',
    '',
    'Options:',
    '  --date YYYY-MM-DD     Single date (default: today UTC)',
    '  --from / --to         Date range (inclusive)',
    '  --max-races N         Racecard pages per run (bounded by config)',
    '',
    'Exit codes: 0 ok, 2 blocked / attention required, 3 validation or discovery failure, 4 completed with failures.'
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const mode = args.mode || 'self-test';
  const logger = (message) => console.log(`[collector] ${message}`);
  if (mode === 'self-test') {
    const report = await runSelfTest({ logger });
    const paths = writeTmpArtifacts(report);
    console.log(`[collector] report written to ${paths.reportPath}`);
    console.log(report.summaryText);
    process.exitCode = report.exitCode ?? EXIT_CODES.OK;
    return;
  }
  if (mode === 'probe') {
    const dates = resolveDates(args);
    const report = await runProbe({ date: dates[0], maxRacecards: args.maxRaces || 3, logger });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'probe_completed' ? EXIT_CODES.OK : report.status === 'blocked' || report.status === 'blocked_by_robots' ? EXIT_CODES.BLOCKED : EXIT_CODES.VALIDATION_FAILED;
    return;
  }
  if (mode === 'live' && process.env.COLLECTOR_LIVE_CONFIRMED !== '1') {
    console.error('[collector] REFUSED: live collection is gated. Set COLLECTOR_LIVE_CONFIRMED=1 (done by the workflow only when the repository variable COLLECTOR_ENABLED is true) and confirm you hold permission to collect from the source.');
    process.exitCode = EXIT_CODES.BLOCKED;
    return;
  }
  const client = createHttpClient({
    timeoutMs: CONFIG.timeoutMs,
    intervalMs: CONFIG.requestIntervalMs,
    maxRetries: CONFIG.maxRetries,
    retryBaseMs: CONFIG.retryBaseMs,
    maxRequests: CONFIG.maxRequestsPerRun,
    userAgent: CONFIG.userAgent,
    logger
  });
  const io = createFsIO();
  const dates = resolveDates(args);
  const report = await runPipeline({ mode, dates, client, io, logger, config: { ...CONFIG, maxRacesPerRun: args.maxRaces || CONFIG.maxRacesPerRun } });
  writeTmpArtifacts(report);
  console.log(report.summaryText);
  process.exitCode = report.exitCode ?? EXIT_CODES.OK;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[collector] internal error: ${error && error.stack ? error.stack : error}`);
    process.exitCode = EXIT_CODES.INTERNAL_ERROR;
  });
}
