import { el, pageTitle, mount, metric, table, notice, button, fmtDateTime, badge } from '../ui.js';
import { validateRaceRecord, summarizeIssues, validateIndexFile, validateStatusFile } from '../core/validate-core.js';
import { evaluateRace } from '../core/rules-core.js';
import { getAllEntries, fetchJson } from '../data.js';

export async function render(container, ctx) {
  const buttonsRegion = el('div', { class: 'card-actions' });
  const summaryRegion = el('div', {});
  const issuesRegion = el('div', {});
  const repoRegion = el('div', {});

  async function runValidation() {
    summaryRegion.textContent = 'Validating…';
    const entries = await getAllEntries({ includeFixtures: true, includeImported: true });
    const errors = [];
    const warnings = [];
    const perKind = { published: 0, fixture: 0, imported: 0 };
    const expectationMismatches = [];

    for (const entry of entries) {
      const expectedDataset = entry.kind === 'fixture' ? 'test-fixture' : entry.kind;
      const result = validateRaceRecord(entry.race, { expectedDataset, requireTimestamps: true });
      perKind[entry.kind] = (perKind[entry.kind] || 0) + 1;
      for (const error of result.errors) errors.push({ ...error, raceId: entry.race.raceId, kind: entry.kind });
      for (const warning of result.warnings) warnings.push({ ...warning, raceId: entry.race.raceId, kind: entry.kind });

      if (entry.kind === 'fixture' && entry.expected) {
        const evaluation = evaluateRace(entry.race);
        const expected = entry.expected;
        const candidate = evaluation.candidate ? evaluation.candidate.runnerNumber : null;
        if (evaluation.status !== expected.status ||
            (evaluation.rejectionCode || null) !== (expected.rejectionCode || null) ||
            candidate !== (expected.candidateRunnerNumber || null)) {
          expectationMismatches.push(entry.race.raceId);
        }
      }
    }

    const summary = summarizeIssues(errors, warnings);
    mount(summaryRegion,
      el('div', { class: 'grid' },
        metric('Records checked', String(entries.length), `${perKind.published} published · ${perKind.fixture} fixtures · ${perKind.imported} imported`),
        metric('Errors', String(summary.errorCount), summary.errorCount === 0 ? 'all clean' : 'must be fixed'),
        metric('Warnings', String(summary.warningCount), 'worth reviewing'),
        metric('Fixture expectation mismatches', String(expectationMismatches.length), 'should always be zero')
      ),
      expectationMismatches.length > 0 ? notice(`Fixtures disagree with the manifest: ${expectationMismatches.join(', ')}`, 'bad') : null
    );

    const allIssues = [
      ...errors.map((issue) => ({ ...issue, severity: 'error' })),
      ...warnings.map((issue) => ({ ...issue, severity: 'warning' }))
    ].slice(0, 200);

    mount(issuesRegion,
      el('h2', {}, 'Issues'),
      allIssues.length === 0
        ? notice('No issues found across the loaded datasets.', 'ok')
        : table([
            { label: 'Severity', render: (r) => badge(r.severity, r.severity === 'error' ? 'bad' : 'warn') },
            { label: 'Race', render: (r) => r.raceId || '' },
            { label: 'Dataset', render: (r) => r.kind || '' },
            { label: 'Code', render: (r) => r.code },
            { label: 'Field', render: (r) => r.field },
            { label: 'Message', render: (r) => r.message }
          ], allIssues)
    );
  }

  async function loadRepoReport() {
    try {
      const index = await fetchJson('data/indexes/races-index.json');
      const status = await fetchJson('data/indexes/status.json');
      const indexCheck = validateIndexFile(index);
      const statusCheck = validateStatusFile(status);
      mount(repoRegion, el('div', { class: 'grid-wide' },
        el('div', { class: 'card' },
          el('h3', {}, 'Published index'),
          el('ul', { class: 'kv' },
            el('li', {}, el('span', { class: 'k' }, 'datasetStatus'), el('span', { class: 'v' }, String(index.datasetStatus))),
            el('li', {}, el('span', { class: 'k' }, 'races listed'), el('span', { class: 'v' }, String((index.races || []).length))),
            el('li', {}, el('span', { class: 'k' }, 'generated'), el('span', { class: 'v' }, fmtDateTime(index.generatedAt))),
            el('li', {}, el('span', { class: 'k' }, 'validation'), el('span', { class: 'v' }, indexCheck.errors.length === 0 ? 'clean' : `${indexCheck.errors.length} errors`))
          )
        ),
        el('div', { class: 'card' },
          el('h3', {}, 'Status file'),
          el('ul', { class: 'kv' },
            el('li', {}, el('span', { class: 'k' }, 'collectorEnabled'), el('span', { class: 'v' }, String(status.collectorEnabled))),
            el('li', {}, el('span', { class: 'k' }, 'parserValidatedAgainstLive'), el('span', { class: 'v' }, String(status.parserValidatedAgainstLive))),
            el('li', {}, el('span', { class: 'k' }, 'permissionStatus'), el('span', { class: 'v' }, String(status.permissionStatus))),
            el('li', {}, el('span', { class: 'k' }, 'validation'), el('span', { class: 'v' }, statusCheck.errors.length === 0 ? 'clean' : `${statusCheck.errors.length} errors`))
          )
        )
      ));
    } catch (error) {
      mount(repoRegion, notice(`Could not load repository data files: ${error.message}`, 'bad'));
    }
  }

  mount(container,
    pageTitle('Validation', 'Run the same structural validation that guards the repository, directly against the datasets loaded in this browser.'),
    buttonsRegion,
    summaryRegion,
    issuesRegion,
    el('h2', {}, 'Repository data files'),
    repoRegion
  );

  mount(buttonsRegion, button('Run validation', runValidation, { className: 'primary' }));

  await Promise.all([runValidation(), loadRepoReport()]);
}
