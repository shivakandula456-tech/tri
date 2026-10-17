import { el, badge, fmtDecimal, fmtDate, table } from '../ui.js';

export const REJECTION_LABELS = Object.freeze({
  NOT_GREAT_BRITAIN: 'Not Great Britain',
  NOT_FLAT: 'Not Flat racing',
  NOT_HANDICAP: 'Not a handicap',
  CLASS_OUT_OF_RANGE: 'Class outside 2-6',
  FIELD_SIZE_OUT_OF_RANGE: 'Field size outside 6-12',
  INCOMPLETE_ODDS: 'Incomplete odds',
  NO_STRONG_FAVOURITE: 'No strong favourite at 5/2 or shorter',
  MULTIPLE_STRONG_FAVOURITES: 'Multiple strong favourites',
  NO_LONGSHOT: 'No longshot at 10/1 or bigger'
});

export function statusBadge(status) {
  if (status === 'qualified') return badge('QUALIFIED', 'ok');
  if (status === 'rejected') return badge('REJECTED', 'bad');
  return badge(String(status || 'unknown').toUpperCase(), 'muted');
}

export function resultBadge(resultStatus) {
  if (resultStatus === 'resolved') return badge('resolved', 'ok');
  if (resultStatus === 'partial') return badge('partial', 'warn');
  return badge('unresolved', 'muted');
}

export function datasetBadge(kind) {
  if (kind === 'published') return badge('published', 'info');
  if (kind === 'fixture') return badge('TEST FIXTURE', 'warn');
  if (kind === 'imported') return badge('imported', 'muted');
  return badge(String(kind || 'unknown'), 'muted');
}

export function rejectionLabel(code) {
  if (!code) return '';
  return REJECTION_LABELS[code] || code;
}

export function testDataBanner(kind) {
  if (kind !== 'fixture' && kind !== 'imported') return null;
  return el('div', { class: 'banner banner-test' },
    el('strong', {}, kind === 'fixture' ? 'Synthetic test data' : 'Imported data'),
    el('span', {}, kind === 'fixture'
      ? 'Everything in this view is invented by the fixture generator. It is not real racing data and never enters published datasets.'
      : 'Imported data is user-supplied. Check its provenance before drawing conclusions; test-flagged rows stay excluded from Phase 1 backtests unless you opt in.')
  );
}

export function oddsCell(odds) {
  if (!odds) return el('span', { class: 'faint' }, 'no price');
  const fractional = odds.fractional || '?';
  const decimal = Number.isFinite(odds.decimal) ? ` (${fmtDecimal(odds.decimal)})` : '';
  return el('span', { class: 'mono' }, `${fractional}${decimal}`);
}

export function traceList(evaluation) {
  return el('ol', { class: 'trace' }, (evaluation.trace || []).map((step) => el('li', { class: step.passed ? '' : 'fail' },
    el('span', { class: 'step-code' }, `${step.passed ? '✔' : '✘'} ${step.code}`),
    el('span', { class: 'detail' }, step.detail + (step.rejectionCode && !step.passed ? ` → ${step.rejectionCode}` : ''))
  )));
}

export function runnerTable(race, evaluation) {
  const candidateNumber = evaluation.candidate ? evaluation.candidate.runnerNumber : null;
  const favouriteNumber = evaluation.favourite ? evaluation.favourite.runnerNumber : null;
  const columns = [
    { label: '#', className: 'num', render: (r) => r.runnerNumber },
    {
      label: 'Runner',
      render: (r) => el('span', {},
        r.name,
        r.runnerNumber === candidateNumber ? el('span', { class: 'badge badge-ok', style: 'margin-left:0.4rem' }, 'candidate') : null,
        r.runnerNumber === favouriteNumber ? el('span', { class: 'badge badge-info', style: 'margin-left:0.4rem' }, 'favourite') : null
      )
    },
    { label: 'Status', render: (r) => r.status === 'non_runner' ? badge('non-runner', 'warn') : '' },
    { label: 'Odds', render: (r) => oddsCell(r.odds) },
    { label: 'SP', render: (r) => oddsCell(r.sp) },
    { label: 'Finish', className: 'num', render: (r) => r.finishPosition ?? '' },
    { label: 'Result', render: (r) => r.resultStatus && r.resultStatus !== 'finished' ? badge(r.resultStatus, 'muted') : '' }
  ];
  return table(columns, race.runners || []);
}

export function raceFactsList(race) {
  const items = [
    ['Course', race.course],
    ['Region', race.courseRegion],
    ['Date', fmtDate(race.date)],
    ['Off time', race.time || '—'],
    ['Type', race.raceType],
    ['Handicap', race.isHandicap ? 'yes' : 'no'],
    ['Class', race.class],
    ['Declared', race.declaredRunners ?? '—'],
    ['Actual runners', race.actualRunners ?? '—'],
    ['Distance', race.distance || '—'],
    ['Going', race.going || '—'],
    ['Result', race.resultStatus || 'unresolved'],
    ['Source', race.source || '—'],
    ['Retrieved', race.retrievedAt || '—'],
    ['Parser', race.parserVersion || '—']
  ];
  return el('ul', { class: 'kv' }, items.map(([key, value]) => el('li', {},
    el('span', { class: 'k' }, key),
    el('span', { class: 'v' }, String(value))
  )));
}

export function selectionSummary(entry, evaluation) {
  const favourite = evaluation.favourite;
  const candidate = evaluation.candidate;
  return el('div', { class: 'grid' },
    el('div', { class: 'card' },
      el('h3', {}, 'Strong favourite'),
      favourite
        ? el('p', {}, `#${favourite.runnerNumber} ${favourite.name} at ${favourite.fractional || fmtDecimal(favourite.decimal)}`)
        : el('p', { class: 'muted' }, 'None in this race.')
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Candidate selection'),
      candidate
        ? el('p', {},
            `#${candidate.runnerNumber} ${candidate.name} at ${candidate.fractional || fmtDecimal(candidate.decimal)}`,
            candidate.tieBreakApplied ? el('span', { class: 'badge badge-info', style: 'margin-left:0.4rem' }, 'tie-break: lowest number') : null
          )
        : el('p', { class: 'muted' }, 'No candidate: an earlier rule failed.')
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Field'),
      el('p', {}, `${evaluation.actualRunners} actual runners`),
      evaluation.nonRunnerNumbers.length > 0
        ? el('p', { class: 'small muted' }, `Non-runners: ${evaluation.nonRunnerNumbers.map((n) => `#${n}`).join(', ')}`)
        : el('p', { class: 'small faint' }, 'No non-runners')
    )
  );
}
