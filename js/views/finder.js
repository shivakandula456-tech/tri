import { el, pageTitle, mount, navigate, selectField, inputField, checkbox, table, empty, fmtDate } from '../ui.js';
import { getAllEntries, toRaceList } from '../data.js';
import { REJECTION_CODES } from '../core/rules-core.js';
import { statusBadge, resultBadge, datasetBadge, rejectionLabel, testDataBanner } from './parts.js';

function withinWindow(race, from, to) {
  if (from && race.date < from) return false;
  if (to && race.date > to) return false;
  return true;
}

function matchesSearch(race, term) {
  if (!term) return true;
  const haystack = `${race.raceId} ${race.course} ${race.name || ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export async function render(container, ctx) {
  const entries = toRaceList(await getAllEntries({ includeFixtures: true, includeImported: true }));
  const requestedKind = ctx.query ? ctx.query.get('ds') : null;

  const filters = {
    kinds: new Set(requestedKind ? [requestedKind] : ['published', 'fixture', 'imported']),
    status: 'all',
    rejectionCode: 'all',
    classValue: 'all',
    from: '',
    to: '',
    search: ''
  };

  const header = pageTitle('Race finder', 'Browse evaluated races from every loaded dataset. Open a race for its full evaluation trace and runner detail.');

  const resultCount = el('p', { class: 'muted' });
  const resultRegion = el('div', {});

  function applyFilters() {
    return entries
      .filter((entry) => filters.kinds.has(entry.kind))
      .filter((entry) => filters.status === 'all' || entry.evaluation.status === filters.status)
      .filter((entry) => filters.rejectionCode === 'all' ||
        (filters.rejectionCode === 'none' ? !entry.evaluation.rejectionCode : entry.evaluation.rejectionCode === filters.rejectionCode))
      .filter((entry) => filters.classValue === 'all' || String(entry.race.class) === filters.classValue)
      .filter((entry) => withinWindow(entry.race, filters.from, filters.to))
      .filter((entry) => matchesSearch(entry.race, filters.search))
      .sort((a, b) => (b.race.date + (b.race.time || '')).localeCompare(a.race.date + (a.race.time || '')));
  }

  function renderResults() {
    const rows = applyFilters();
    const showingFixtures = rows.some((row) => row.kind === 'fixture');
    const showingImported = rows.some((row) => row.kind === 'imported');
    resultCount.textContent = `${rows.length} of ${entries.length} races match.`;
    if (rows.length === 0) {
      mount(resultRegion,
        showingFixtures || showingImported ? testDataBanner(showingFixtures ? 'fixture' : 'imported') : null,
        empty(entries.length === 0
          ? 'Nothing loaded yet. Published data appears here after a collection run; fixtures are always available.'
          : 'No race matches the current filters.')
      );
      return;
    }
    mount(resultRegion,
      showingFixtures ? testDataBanner('fixture') : showingImported ? testDataBanner('imported') : null,
      table([
        { label: 'Date', render: (r) => fmtDate(r.race.date) },
        { label: 'Time', render: (r) => r.race.time || '' },
        { label: 'Course', render: (r) => r.race.course },
        { label: 'Class', className: 'num', render: (r) => r.race.class },
        { label: 'Runners', className: 'num', render: (r) => r.evaluation.actualRunners },
        {
          label: 'Favourite',
          render: (r) => r.evaluation.favourite
            ? `#${r.evaluation.favourite.runnerNumber} ${r.evaluation.favourite.fractional || ''}`
            : el('span', { class: 'faint' }, '—')
        },
        {
          label: 'Candidate / rejection',
          render: (r) => r.evaluation.candidate
            ? `#${r.evaluation.candidate.runnerNumber} ${r.evaluation.candidate.fractional || ''}`
            : el('span', { class: 'muted' }, rejectionLabel(r.evaluation.rejectionCode))
        },
        { label: 'Status', render: (r) => statusBadge(r.evaluation.status) },
        { label: 'Result', render: (r) => resultBadge(r.race.resultStatus) },
        { label: 'Dataset', render: (r) => datasetBadge(r.kind) },
        {
          label: '',
          render: (r) => {
            const anchor = el('a', { href: `#/selection/${encodeURIComponent(r.race.raceId)}?ds=${r.kind}`, class: 'button' }, 'Open');
            return anchor;
          }
        }
      ], rows.map((row) => ({ ...row, id: `${row.kind}:${row.race.raceId}` })))
    );
  }

  const controls = el('div', { class: 'filters' },
    el('div', { class: 'field' },
      el('label', {}, 'Datasets'),
      el('div', {},
        ['published', 'fixture', 'imported'].map((kind) => checkbox(kind, filters.kinds.has(kind), (checked) => {
          if (checked) filters.kinds.add(kind);
          else filters.kinds.delete(kind);
          renderResults();
        }))
      )
    ),
    selectField('Status', [
      { value: 'all', label: 'All' },
      { value: 'qualified', label: 'Qualified only' },
      { value: 'rejected', label: 'Rejected only' }
    ], filters.status, (value) => {
      filters.status = value;
      renderResults();
    }),
    selectField('Rejection code', [
      { value: 'all', label: 'Any' },
      { value: 'none', label: 'No rejection (qualified)' },
      ...Object.keys(REJECTION_CODES).map((code) => ({ value: code, label: code }))
    ], filters.rejectionCode, (value) => {
      filters.rejectionCode = value;
      renderResults();
    }),
    selectField('Class', [
      { value: 'all', label: 'All' },
      ...[2, 3, 4, 5, 6, 1, 7].map((c) => ({ value: String(c), label: `Class ${c}` }))
    ], filters.classValue, (value) => {
      filters.classValue = value;
      renderResults();
    }),
    inputField('From date', { type: 'date', value: filters.from, onInput: (value) => { filters.from = value; renderResults(); } }),
    inputField('To date', { type: 'date', value: filters.to, onInput: (value) => { filters.to = value; renderResults(); } }),
    inputField('Search', { type: 'text', value: filters.search, placeholder: 'course, race id or name', onInput: (value) => { filters.search = value; renderResults(); } })
  );

  mount(container, header, controls, resultCount, resultRegion);
  renderResults();
}
