import { el, pageTitle, mount, metric, badge, fmtDateTime, table, button, navigate, notice } from '../ui.js';
import { datasetBadge } from './parts.js';
import { getPublished, getFixtures, getImported, summarize, toRaceList } from '../data.js';
import { invalidate } from '../data.js';

function statusTone(value) {
  return value ? 'ok' : 'warn';
}

export async function render(container, ctx) {
  const published = await getPublished().catch((error) => ({ error, entries: [], index: null, statusFile: null }));
  const fixtures = await getFixtures().catch((error) => ({ error, entries: [] }));
  const imported = await getImported().catch(() => ({ entries: [] }));

  const index = published.index || {};
  const status = published.statusFile || {};
  const publishedList = toRaceList(published.entries || []);
  const fixtureList = toRaceList(fixtures.entries || []);
  const importedList = toRaceList(imported.entries || []);
  const publishedSummary = summarize(published.entries || []);

  const header = pageTitle('Dashboard', 'Phase 1 research status at a glance. Everything here runs in your browser; nothing is transmitted anywhere.');

  const refreshRow = el('div', { class: 'card-actions' },
    button('Reload data', () => {
      invalidate();
      window.location.reload();
    }),
    button('Open race finder', () => navigate('#/finder'), { className: 'primary' }),
    button('Run Backtest A', () => navigate('#/backtest-a'))
  );

  const metrics = el('div', { class: 'grid' },
    metric('Published races', String(index.counts && index.counts.races !== undefined ? index.counts.races : publishedList.length), index.datasetStatus || 'unknown'),
    metric('Qualified (published)', String(publishedSummary.qualified), 'after Phase 1 rules'),
    metric('Fixtures available', String(fixtureList.length), 'synthetic test data'),
    metric('Imported races', String(importedList.length), 'stored locally only')
  );

  const emptyState = index.datasetStatus === 'not_collected'
    ? el('div', { class: 'card' },
        el('h3', {}, 'No production data yet'),
        el('p', { class: 'muted' }, 'The published dataset is honestly empty: no collection run has delivered real race data. This is expected while automated access to the source remains blocked (HTTP 403 observed 2026-10-18).'),
        el('p', { class: 'muted' }, 'The engine is fully exercisable right now with 12 clearly labelled synthetic fixtures in test mode. Fixtures never mix with production data.'),
        el('div', { class: 'card-actions' },
          button('Explore fixtures (test mode)', () => navigate('#/finder?ds=fixture'), { className: 'primary' }),
          el('a', { class: 'button', href: 'docs/DATA-SOURCES.md', target: '_blank', rel: 'noopener' }, 'Access policy (docs)')
        )
      )
    : null;

  const statusCard = el('div', { class: 'card' },
    el('h3', {}, 'Collection status'),
    el('ul', { class: 'kv' },
      el('li', {}, el('span', { class: 'k' }, 'Dataset status'), el('span', { class: 'v' }, badge(String(index.datasetStatus || 'unknown'), index.datasetStatus === 'published' ? 'ok' : 'muted'))),
      el('li', {}, el('span', { class: 'k' }, 'Collector enabled'), el('span', { class: 'v' }, badge(status.collectorEnabled ? 'yes' : 'no', statusTone(status.collectorEnabled)))),
      el('li', {}, el('span', { class: 'k' }, 'Parser validated against live'), el('span', { class: 'v' }, badge(status.parserValidatedAgainstLive ? 'yes' : 'no', statusTone(status.parserValidatedAgainstLive)))),
      el('li', {}, el('span', { class: 'k' }, 'Permission status'), el('span', { class: 'v' }, String(status.permissionStatus || 'unknown'))),
      el('li', {}, el('span', { class: 'k' }, 'Desired window'), el('span', { class: 'v' }, status.desiredWindow ? `${status.desiredWindow.from} → ${status.desiredWindow.to}` : 'not set')),
      el('li', {}, el('span', { class: 'k' }, 'Last run'), el('span', { class: 'v' }, status.lastRun ? `${status.lastRun.runId} · ${fmtDateTime(status.lastRun.startedAt)}` : 'never'))
    ),
    Array.isArray(status.permissionNotes)
      ? el('details', {}, el('summary', {}, `Permission notes (${status.permissionNotes.length})`),
          el('ul', {}, status.permissionNotes.map((note) => el('li', { class: 'small muted' }, note))))
      : null,
    published.error ? notice(`Could not load published index: ${published.error.message}`, 'bad') : null,
    status.permissionStatus === 'blocked_http_403_observed'
      ? notice('Automated access to the source is currently blocked (HTTP 403 observed). Collection stays off and no bypass is attempted. Fixtures and imported data are the only available sources for now.', 'info')
      : null
  );

  const fixtureCard = el('div', { class: 'card' },
    el('h3', {}, 'Test fixtures'),
    el('p', { class: 'muted' }, 'Twelve synthetic races cover every Phase 1 rule path, boundary and tie-break. They are labelled everywhere and never enter published exports.'),
    el('div', { class: 'row' }, datasetBadge('fixture'), el('span', { class: 'small faint' }, `${fixtureList.length} races loaded`)),
    el('div', { class: 'card-actions' }, button('Browse fixtures', () => navigate('#/finder?ds=fixture')))
  );

  const runs = Array.isArray(status.runs) ? status.runs : [];
  const runsSection = el('section', {},
    el('h2', {}, 'Recent collection runs'),
    runs.length === 0
      ? el('p', { class: 'muted' }, 'No collection run has been recorded yet. Runs are logged to data/logs/collection/ once the collector is enabled by the repository owner.')
      : table([
          { label: 'Run', render: (r) => r.runId },
          { label: 'Mode', render: (r) => r.mode || '' },
          { label: 'Started', render: (r) => fmtDateTime(r.startedAt) },
          { label: 'Outcome', render: (r) => badge(String(r.outcome ?? r.exitCode ?? 'unknown'), r.outcome === 'success' ? 'ok' : 'warn') },
          { label: 'Races', className: 'num', render: (r) => r.racesPublished ?? '' }
        ], runs.slice(0, 10))
  );

  mount(container, header, metrics, emptyState, el('div', { class: 'grid-wide' }, statusCard, fixtureCard), refreshRow, runsSection);
}
