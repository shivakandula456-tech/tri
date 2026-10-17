import { el, pageTitle, mount, badge, button, notice, empty, toast } from '../ui.js';
import { getDataset, evaluateEntry, toRaceList } from '../data.js';
import { addJournalEntry, listJournal } from '../storage.js';
import { statusBadge, resultBadge, datasetBadge, runnerTable, traceList, raceFactsList, selectionSummary, testDataBanner } from './parts.js';

export async function render(container, ctx) {
  const raceId = decodeURIComponent(ctx.segments[1] || '');
  const kind = ctx.query.get('ds') || 'published';
  const dataset = await getDataset(kind);
  const entries = toRaceList(dataset.entries || []);
  const entry = entries.find((candidate) => candidate.race.raceId === raceId);

  if (!entry) {
    mount(container,
      pageTitle('Race not found'),
      empty(`No race with id "${raceId}" exists in the ${kind} dataset.`),
      el('p', {}, el('a', { href: '#/finder', class: 'button' }, 'Back to finder'))
    );
    return;
  }

  const evaluation = entry.evaluation;
  const race = entry.race;

  const expectationCard = entry.expected
    ? el('div', { class: 'card' },
        el('h3', {}, 'Manifest expectation'),
        el('ul', { class: 'kv' },
          el('li', {}, el('span', { class: 'k' }, 'Expected status'), el('span', { class: 'v' }, entry.expected.status)),
          el('li', {}, el('span', { class: 'k' }, 'Expected rejection'), el('span', { class: 'v' }, entry.expected.rejectionCode || '—')),
          el('li', {}, el('span', { class: 'k' }, 'Expected candidate'), el('span', { class: 'v' }, entry.expected.candidateRunnerNumber ? `#${entry.expected.candidateRunnerNumber}` : '—'))
        ),
        notice(
          evaluation.status === entry.expected.status &&
          (evaluation.rejectionCode || null) === (entry.expected.rejectionCode || null) &&
          (evaluation.candidate ? evaluation.candidate.runnerNumber : null) === (entry.expected.candidateRunnerNumber || null)
            ? 'Live evaluation matches the manifest.'
            : 'Live evaluation diverges from the manifest. This is exactly what the fixture tests exist to catch.',
          'ok'
        )
      )
    : null;

  const journalRegion = el('div', {});
  const noteInput = el('textarea', { rows: 3, placeholder: 'Why does this race matter to your research?' });
  const saveNote = async () => {
    const note = noteInput.value.trim();
    if (!note) {
      toast('Write something first.', 'warn');
      return;
    }
    await addJournalEntry({ raceId: race.raceId, datasetKind: kind, note });
    noteInput.value = '';
    toast('Saved to journal.', 'ok');
    renderJournal();
  };

  async function renderJournal() {
    const rows = (await listJournal(200)).filter((row) => row.raceId === race.raceId);
    mount(journalRegion, el('div', { class: 'card' },
      el('h3', {}, `Research journal (${rows.length})`),
      el('div', { class: 'field' }, noteInput, el('span', { class: 'small faint' }, 'Stored only in this browser profile.')),
      el('div', { class: 'card-actions' }, button('Save note', saveNote, { className: 'primary' })),
      rows.length === 0
        ? el('p', { class: 'muted' }, 'No notes on this race yet.')
        : el('ul', {}, rows.map((row) => el('li', {}, el('span', { class: 'small faint' }, `${row.createdAt} — `), row.note)))
    ));
  }

  const header = pageTitle(
    `${race.course} ${race.time || ''} · ${race.name || race.raceId}`,
    `${raceId} · ${race.date} · class ${race.class} · ${evaluation.actualRunners} runners`
  );

  const titleRow = el('p', { class: 'row' },
    datasetBadge(kind),
    statusBadge(evaluation.status),
    resultBadge(race.resultStatus),
    race.testData ? badge('TEST DATA', 'warn') : null,
    el('a', { href: `#/finder?ds=${kind}`, class: 'button' }, 'Back to finder')
  );

  mount(container,
    header,
    titleRow,
    testDataBanner(kind),
    selectionSummary(entry, evaluation),
    el('div', { class: 'grid-wide' },
      el('div', { class: 'card' }, el('h3', {}, 'Race facts'), raceFactsList(race)),
      el('div', { class: 'card' },
        el('h3', {}, 'Evaluation trace'),
        race.resultStatus === 'resolved' ? el('p', { class: 'small muted' }, 'Result is known; outcomes in backtests use finish positions.') : null,
        traceList(evaluation)
      )
    ),
    el('h2', {}, 'Runners'),
    el('div', { class: 'card' }, runnerTable(race, evaluation)),
    expectationCard,
    el('h2', {}, 'Journal'),
    journalRegion
  );

  await renderJournal();
}
