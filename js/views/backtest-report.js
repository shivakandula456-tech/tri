import { el, pageTitle, mount, metric, badge, button, notice, empty, fmtDateTime, fmtPct, fmtDecimal, table, barRow, downloadText, navigate } from '../ui.js';
import { getAnalysisRun } from '../storage.js';
import { backtestToCsv } from '../core/backtest-core.js';
import { rejectionLabel } from './parts.js';

function outcomeText(entry) {
  if (entry.status === 'rejected') return rejectionLabel(entry.rejectionCode);
  if (!entry.outcomeKnown) return 'awaiting results';
  if (entry.candidateNonFinishReason) return `did not finish (${entry.candidateNonFinishReason})`;
  if (typeof entry.candidateFinishPosition === 'number') return `candidate finished ${entry.candidateFinishPosition}`;
  return 'unknown';
}

export async function render(container, ctx) {
  const runId = ctx.segments[1];
  const run = runId ? await getAnalysisRun(runId) : null;
  if (!run) {
    mount(container,
      pageTitle('Report not found'),
      empty('This run is not stored in this browser profile.'),
      el('p', {}, el('a', { class: 'button', href: '#/backtest-a' }, 'Back to Backtest A'))
    );
    return;
  }

  const report = run.report;
  const totals = report.totals;
  const outcomes = report.outcomes;

  const header = pageTitle(
    `Backtest report · ${run.label}`,
    `Ruleset ${report.ruleset.label} (${report.ruleset.version}, hash ${report.ruleset.hash}) · window ${report.window.from} → ${report.window.to} · generated ${fmtDateTime(report.generatedAt)}`
  );

  const titleRow = el('p', { class: 'row' },
    badge(run.kind === 'A' ? 'Backtest A · fixed' : 'Backtest B · experimental', run.kind === 'A' ? 'info' : 'warn'),
    report.ruleset.locked ? badge('locked ruleset', 'ok') : badge('UNLOCKED — sandbox only', 'bad'),
    report.includeTestData ? badge('includes synthetic fixtures', 'warn') : null,
    el('a', { class: 'button', href: '#/backtest-a' }, 'New run')
  );

  const notes = report.evaluationMismatches.length > 0
    ? notice(el('div', {},
        el('strong', {}, `${report.evaluationMismatches.length} stored evaluations disagreed with recomputation: `),
        report.evaluationMismatches.join(', ')
      ), 'bad')
    : null;

  const metrics = el('div', { class: 'grid' },
    metric('Races in window', String(totals.racesInWindow), `${report.coverage.daysWithData}/${report.coverage.daysRequested} days with data`),
    metric('Qualified', String(totals.qualified), `${totals.rejected} rejected`),
    metric('Resolved qualified', String(totals.resolvedQualified), `${totals.unresolvedSelections} awaiting results`),
    metric('Excluded by validation', String(totals.racesExcludedByValidation), 'validation.status ≠ passed')
  );

  const outcomeMetrics = el('div', { class: 'grid' },
    metric('Candidate wins', String(outcomes.candidateWins), `win rate ${fmtPct(outcomes.candidateWinRate)} of resolved qualified`),
    metric('Favourite wins', String(outcomes.favouriteWins), `rate ${fmtPct(outcomes.favouriteWinRate)}`),
    metric('Candidate non-finishers', String(outcomes.candidateNonFinishers), 'pulled up, fell, etc.'),
    metric('Longshot wins', String(outcomes.longshotWins), 'all winners come from longshots by construction')
  );

  const maxCode = Math.max(1, ...Object.values(totals.byRejectionCode));
  const rejectionBars = el('div', { class: 'bars' },
    Object.entries(totals.byRejectionCode).map(([code, count]) => barRow(rejectionLabel(code), count, totals.racesInWindow || maxCode, count > 0 ? 'bad' : ''))
  );

  const finishDistribution = Object.keys(outcomes.candidateFinishDistribution).length > 0
    ? table([
        { label: 'Finish position', className: 'num', render: (r) => r.position },
        { label: 'Candidates', className: 'num', render: (r) => r.count }
      ], Object.entries(outcomes.candidateFinishDistribution)
        .map(([position, count]) => ({ position, count }))
        .sort((a, b) => Number(a.position) - Number(b.position)))
    : el('p', { class: 'muted' }, 'No resolved qualified races in this window, so there is no finish distribution to show.');

  const perRaceRows = report.perRace.slice(0, 300);
  const perRaceTable = table([
    { label: 'Date', render: (r) => r.date },
    { label: 'Course', render: (r) => r.course },
    { label: 'Class', className: 'num', render: (r) => r.class },
    { label: 'Runners', className: 'num', render: (r) => r.actualRunners },
    { label: 'Candidate', render: (r) => r.candidateRunnerNumber ? `#${r.candidateRunnerNumber} ${r.candidateName}` : '' },
    { label: 'Odds', className: 'num', render: (r) => fmtDecimal(r.candidateDecimal) },
    { label: 'Outcome', render: (r) => outcomeText(r) },
    { label: 'Test data', render: (r) => r.testData ? badge('fixture', 'warn') : '' }
  ], perRaceRows);

  const coverageMissing = report.coverage.daysWithoutData.length > 0
    ? el('p', { class: 'small muted' }, `Days without data: ${report.coverage.daysWithoutData.join(', ')}`)
    : el('p', { class: 'small faint' }, 'Every requested day has data.');

  const exportRow = el('div', { class: 'card-actions' },
    button('Export per-race CSV', () => downloadText(`backtest-${run.id}.csv`, backtestToCsv(report), 'text/csv'), {}),
    button('Export report JSON', () => downloadText(`backtest-${run.id}.json`, JSON.stringify(report, null, 2), 'application/json'), {})
  );

  mount(container,
    header,
    titleRow,
    report.includeTestData ? notice('This report includes synthetic test fixtures. Fixture rows are flagged in the table and must never be treated as real results.', 'warn') : null,
    report.ruleset.locked ? null : notice('This report ran an unlocked experimental ruleset. It cannot be compared with Phase 1 results without saying so explicitly.', 'bad'),
    notes,
    metrics,
    outcomeMetrics,
    el('div', { class: 'grid-wide' },
      el('div', { class: 'card' }, el('h3', {}, 'Rejections by rule'), totals.racesInWindow === 0 ? el('p', { class: 'muted' }, 'No data in this window.') : rejectionBars),
      el('div', { class: 'card' }, el('h3', {}, 'Candidate finish distribution'), finishDistribution)
    ),
    el('h2', {}, 'Coverage'),
    el('div', { class: 'card' }, coverageMissing),
    el('h2', {}, `Per-race detail (${perRaceRows.length} of ${report.perRace.length})`),
    el('div', { class: 'card' }, perRaceRows.length === 0 ? el('p', { class: 'muted' }, 'No races in window.') : perRaceTable),
    exportRow,
    el('h2', {}, 'Method notes'),
    el('ul', { class: 'muted' }, report.notes.map((note) => el('li', {}, note)))
  );
}
