import { parseFractional } from '../../js/core/odds.js';
import { isValidDateString, round } from '../../js/core/util.js';

export const PARSER_VERSION = 'atr-parser-0.1.0';

const ESSENTIAL_CHECKS = [
  'htmlNonEmpty',
  'raceContainerFound',
  'raceIdFound',
  'dateFound',
  'courseFound',
  'courseRegionFound',
  'raceTypeFound',
  'classFound',
  'runnersFound',
  'runnerNumbersUnique',
  'runnerNamesComplete'
];

const RESULT_STATUS_ALIASES = {
  f: 'fell',
  fell: 'fell',
  pu: 'pulled_up',
  p: 'pulled_up',
  'pulled up': 'pulled_up',
  pulled_up: 'pulled_up',
  ur: 'unseated',
  u: 'unseated',
  unseated: 'unseated',
  ref: 'refused',
  ro: 'refused',
  refused: 'refused',
  bd: 'brought_down',
  brought_down: 'brought_down',
  dsq: 'disqualified',
  d: 'disqualified',
  disqualified: 'disqualified',
  nr: 'withdrawn',
  withdrawn: 'withdrawn',
  fin: 'finished',
  finished: 'finished'
};

function attrValue(tag, name) {
  if (!tag) return null;
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

function firstAttr(html, name) {
  const match = html.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

function truthyAttr(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

export function discoverRaceLinks(html, baseUrl, options = {}) {
  const hint = options.hint || 'racecard/';
  const base = new URL(baseUrl);
  const found = new Map();
  const hrefPattern = /href="([^"#\s]+)"/gi;
  let match;
  while ((match = hrefPattern.exec(String(html ?? ''))) !== null) {
    const href = match[1];
    if (!href.toLowerCase().includes(hint.toLowerCase())) continue;
    if (/\.(css|js|jpg|jpeg|png|gif|svg|webp|ico|pdf)(\?|$)/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) continue;
    url.hash = '';
    url.search = '';
    const key = url.pathname;
    if (!found.has(key)) found.set(key, url.toString());
  }
  return [...found.values()];
}

export function parseRacecard(html, { sourceUrl = null, retrievedAt = null } = {}) {
  const checks = [];
  const check = (name, passed, detail) => {
    checks.push({ name, passed, detail });
    return passed;
  };

  const hasHtml = typeof html === 'string' && html.length > 200;
  check('htmlNonEmpty', hasHtml, `length=${typeof html === 'string' ? html.length : 0}`);
  if (!hasHtml) {
    return { ok: false, race: null, checks, confidence: 0, reason: 'empty_or_missing_html' };
  }

  const raceId = firstAttr(html, 'data-race-id');
  check('raceContainerFound', raceId !== null, raceId ? `data-race-id="${raceId}"` : 'no element with data-race-id');
  check('raceIdFound', raceId !== null, raceId ?? 'missing');
  if (raceId === null) {
    return { ok: false, race: null, checks, confidence: 0, reason: 'no_race_container' };
  }

  const date = firstAttr(html, 'data-race-date');
  const dateOk = isValidDateString(date);
  check('dateFound', dateOk, date ?? 'missing');

  const course = firstAttr(html, 'data-course');
  check('courseFound', Boolean(course), course ?? 'missing');

  const courseRegion = firstAttr(html, 'data-course-region');
  check('courseRegionFound', Boolean(courseRegion), courseRegion ?? 'missing');

  const raceType = firstAttr(html, 'data-race-type');
  check('raceTypeFound', Boolean(raceType), raceType ?? 'missing');

  const classRaw = firstAttr(html, 'data-race-class');
  const classNumber = classRaw === null ? null : Number(classRaw);
  check('classFound', Number.isInteger(classNumber), classRaw ?? 'missing');

  const raceName = firstAttr(html, 'data-race-name');
  const time = firstAttr(html, 'data-race-time');
  const distance = firstAttr(html, 'data-race-distance');
  const going = firstAttr(html, 'data-race-going');
  const declaredRaw = firstAttr(html, 'data-declared-runners');
  const handicapAttr = firstAttr(html, 'data-race-handicap');

  const runnerPattern = /(<li\b[^>]*data-runner-number="([^"]*)"[^>]*>)([\s\S]*?)<\/li>/gi;
  const runners = [];
  let match;
  while ((match = runnerPattern.exec(html)) !== null) {
    const openTag = match[1];
    const block = match[3];
    const number = Number(match[2]);
    let name = attrValue(openTag, 'data-runner-name');
    if (!name) {
      const nameMatch = block.match(/<[^>]*class="[^"]*runner-name[^"]*"[^>]*>([^<]+)</i);
      if (nameMatch) name = nameMatch[1].trim();
    }
    const oddsRaw = attrValue(openTag, 'data-odds') ?? attrValue(block, 'data-odds');
    const oddsDecimal = parseFractional(oddsRaw);
    const isNonRunner =
      truthyAttr(attrValue(openTag, 'data-non-runner')) ||
      /\bis-non-runner\b/i.test(openTag) ||
      /\bnon-?runner\b/i.test(block);
    runners.push({
      runnerNumber: Number.isInteger(number) ? number : null,
      name: name ? name.trim() : null,
      status: isNonRunner ? 'non_runner' : 'runner',
      odds: oddsRaw && oddsDecimal !== null ? { fractional: oddsRaw, decimal: oddsDecimal, capturedAt: retrievedAt } : null,
      oddsRaw: oddsRaw ?? null,
      sp: null,
      finishPosition: null,
      resultStatus: null,
      jockey: attrValue(openTag, 'data-jockey') ?? null,
      trainer: attrValue(openTag, 'data-trainer') ?? null
    });
  }

  check('runnersFound', runners.length > 0, `runners=${runners.length}`);
  const numbers = runners.map((r) => r.runnerNumber);
  const numbersUnique = runners.length > 0 && new Set(numbers).size === numbers.length && numbers.every((n) => Number.isInteger(n) && n > 0);
  check('runnerNumbersUnique', numbersUnique, `numbers=[${numbers.join(',')}]`);
  const namesComplete = runners.length > 0 && runners.every((r) => typeof r.name === 'string' && r.name.length > 0);
  check('runnerNamesComplete', namesComplete, `named=${runners.filter((r) => r.name).length}/${runners.length}`);

  const activeRunners = runners.filter((r) => r.status === 'runner');
  const oddsFound = activeRunners.filter((r) => r.odds !== null).length;
  const oddsCoverage = activeRunners.length > 0 ? oddsFound / activeRunners.length : 0;
  check('oddsCoverage', oddsCoverage >= 0.8, `priced=${oddsFound}/${activeRunners.length} (${round(oddsCoverage * 100, 1)}%)`);

  const declaredNumber = declaredRaw === null ? runners.length : Number(declaredRaw);
  const declaredMatches = !Number.isInteger(declaredNumber) || declaredNumber === runners.length;
  check('declaredMatches', declaredMatches, `declared=${declaredRaw ?? 'n/a'} listed=${runners.length}`);

  const failedEssential = checks.filter((c) => ESSENTIAL_CHECKS.includes(c.name) && !c.passed);
  const passed = checks.filter((c) => c.passed).length;
  const confidence = failedEssential.length === 0 ? round(passed / checks.length, 4) : 0;

  if (failedEssential.length > 0) {
    return {
      ok: false,
      race: null,
      checks,
      confidence,
      reason: `essential_checks_failed:${failedEssential.map((c) => c.name).join(',')}`
    };
  }

  const isHandicap = handicapAttr !== null ? truthyAttr(handicapAttr) : /\bhandicap\b/i.test(String(raceName ?? ''));

  const race = {
    raceId: String(raceId),
    dataset: 'published',
    testData: false,
    source: 'atr',
    sourceUrl,
    retrievedAt,
    parserVersion: PARSER_VERSION,
    date,
    time: time ?? null,
    course: course ?? null,
    courseRegion: String(courseRegion).toUpperCase(),
    raceType,
    isHandicap,
    class: classNumber,
    name: raceName ?? null,
    distance: distance ?? null,
    going: going ?? null,
    declaredRunners: declaredNumber,
    actualRunners: activeRunners.length,
    resultStatus: 'unresolved',
    runners: runners.map(({ oddsRaw, ...rest }) => rest),
    validation: { status: 'pending', checks }
  };

  return { ok: true, race, checks, confidence, reason: null };
}

export function parseResults(html, { race, retrievedAt = null } = {}) {
  const checks = [];
  const check = (name, passed, detail) => {
    checks.push({ name, passed, detail });
    return passed;
  };

  if (!race || !Array.isArray(race.runners)) {
    return { ok: false, patch: null, checks, reason: 'missing_race_input' };
  }
  if (typeof html !== 'string' || html.length === 0) {
    return { ok: false, patch: null, checks: [{ name: 'htmlNonEmpty', passed: false, detail: 'no html' }], reason: 'empty_html' };
  }

  const runnerPattern = /(<li\b[^>]*data-runner-number="([^"]*)"[^>]*>)([\s\S]*?)<\/li>/gi;
  const blocks = new Map();
  let match;
  while ((match = runnerPattern.exec(html)) !== null) {
    blocks.set(Number(match[2]), { openTag: match[1], block: match[3] });
  }

  const updates = [];
  let positionsFound = 0;
  let spFound = 0;
  let nonFinishReasons = 0;

  for (const runner of race.runners) {
    if (runner.status === 'non_runner') continue;
    const entry = blocks.get(runner.runnerNumber);
    if (!entry) continue;
    const positionRaw = attrValue(entry.openTag, 'data-finish-position') ?? attrValue(entry.block, 'data-finish-position');
    const spRaw = attrValue(entry.openTag, 'data-sp') ?? attrValue(entry.block, 'data-sp');
    const resultStatusRaw = attrValue(entry.openTag, 'data-result-status') ?? attrValue(entry.block, 'data-result-status');
    const finishPosition = positionRaw !== null && /^\d+$/.test(positionRaw) ? Number(positionRaw) : null;
    const normalisedResult = resultStatusRaw ? RESULT_STATUS_ALIASES[resultStatusRaw.trim().toLowerCase()] || null : null;
    if (finishPosition !== null) positionsFound += 1;
    if (normalisedResult && normalisedResult !== 'finished') nonFinishReasons += 1;
    const spDecimal = parseFractional(spRaw);
    if (spDecimal !== null) spFound += 1;
    if (finishPosition !== null || normalisedResult !== null || spDecimal !== null) {
      updates.push({
        runnerNumber: runner.runnerNumber,
        finishPosition,
        resultStatus: normalisedResult || (finishPosition !== null ? 'finished' : null),
        sp: spDecimal !== null ? { fractional: spRaw, decimal: spDecimal, capturedAt: retrievedAt } : null
      });
    }
  }

  check('finishPositionsFound', positionsFound > 0, `positions=${positionsFound}`);
  check('spFound', spFound > 0, `sp=${spFound}`);
  if (positionsFound === 0) {
    return { ok: false, patch: null, checks, reason: 'results_not_present' };
  }

  const activeCount = race.runners.filter((r) => r.status !== 'non_runner').length;
  const positionsUnique = new Set(updates.filter((u) => u.finishPosition !== null).map((u) => u.finishPosition)).size === positionsFound;
  check('positionsUnique', positionsUnique, 'finish positions must be unique');

  const accounted = updates.filter((u) => u.finishPosition !== null || (u.resultStatus && u.resultStatus !== 'finished')).length;
  const resultStatus = accounted >= activeCount ? 'resolved' : 'partial';

  const sortedUpdates = [...updates].sort((a, b) => {
    if (a.finishPosition !== null && b.finishPosition !== null) return a.finishPosition - b.finishPosition;
    if (a.finishPosition !== null) return -1;
    if (b.finishPosition !== null) return 1;
    return a.runnerNumber - b.runnerNumber;
  });

  return {
    ok: true,
    patch: { resultStatus, updates: sortedUpdates, spFound, nonFinishReasons },
    checks,
    reason: null
  };
}

export function applyResultsPatch(race, patch, retrievedAt, parserVersion = PARSER_VERSION) {
  if (!patch) return race;
  const updateMap = new Map(patch.updates.map((u) => [u.runnerNumber, u]));
  const runners = race.runners.map((runner) => {
    const update = updateMap.get(runner.runnerNumber);
    if (!update) return runner;
    return {
      ...runner,
      finishPosition: update.finishPosition,
      resultStatus: update.resultStatus || runner.resultStatus,
      sp: update.sp ? { ...update.sp, capturedAt: retrievedAt } : runner.sp
    };
  });
  return {
    ...race,
    runners,
    resultStatus: patch.resultStatus,
    resultsRetrievedAt: retrievedAt,
    parserVersion
  };
}
