import { el, pageTitle, mount, button, checkbox, inputField, toast, navigate, fmtDateTime, table, notice, badge } from '../ui.js';
import { PHASE1_RULESET } from '../core/rules-core.js';
import { runBacktest } from '../core/backtest-core.js';
import { getAllEntries, toRaceList } from '../data.js';
import { saveAnalysisRun, listAnalysisRuns, makeId, setSetting } from '../storage.js';

export async function render(container, ctx) {
  const settings = ctx.state.settings;

  const config = {
    from: settings.backtestFrom || '2026-08-01',
    to: settings.backtestTo || '2026-08-15',
    includeFixtures: settings.includeFixturesInBacktests === true,
    includeImported: false,
    requireValidationPassed: settings.requireValidationPassed !== false
  };

  const runRegion = el('div', {});

  function racePool() {
    return getAllEntries({ includeFixtures: config.includeFixtures, includeImported: config.includeImported });
  }

  async function runNow() {
    runRegion.textContent = 'Running…';
    try {
      const entries = await racePool();
      const races = entries.map((entry) => entry.race);
      const report = runBacktest({ races, ruleset: PHASE1_RULESET, options: { ...config, includeTestData: config.includeFixtures } });
      const run = {
        id: makeId('run'),
        kind: 'A',
        label: `Phase 1 fixed · ${config.from} → ${config.to}${config.includeFixtures ? ' · with fixtures' : ''}`,
        createdAt: new Date().toISOString(),
        report
      };
      await saveAnalysisRun(run);
      await setSetting('backtestFrom', config.from);
      await setSetting('backtestTo', config.to);
      await setSetting('includeFixturesInBacktests', config.includeFixtures);
      toast('Backtest complete.', 'ok');
      navigate(`#/report/${run.id}`);
    } catch (error) {
      mount(runRegion, notice(`Backtest failed: ${error.message}`, 'bad'));
    }
  }

  const form = el('div', { class: 'card' },
    el('h3', {}, 'Run configuration'),
    el('div', { class: 'form-row' },
      inputField('From (inclusive)', { type: 'date', value: config.from, onInput: (value) => { config.from = value; } }),
      inputField('To (inclusive)', { type: 'date', value: config.to, onInput: (value) => { config.to = value; } })
    ),
    checkbox('Include synthetic fixtures (clearly flagged in the report)', config.includeFixtures, (checked) => { config.includeFixtures = checked; }),
    checkbox('Include locally imported datasets', config.includeImported, (checked) => { config.includeImported = checked; }),
    checkbox('Require validation.status = passed', config.requireValidationPassed, (checked) => { config.requireValidationPassed = checked; }),
    notice('Fixtures are synthetic. They exist to prove the engine, not to measure real performance. Reports that include them carry a banner.', 'warn'),
    el('div', { class: 'card-actions' }, button('Run Backtest A', runNow, { className: 'primary' }))
  );

  const rulesCard = el('div', { class: 'card' },
    el('h3', {}, `Ruleset · ${PHASE1_RULESET.label}`),
    el('p', { class: 'row' }, badge(`version ${PHASE1_RULESET.version}`, 'info'), badge('locked', 'ok')),
    el('ul', { class: 'kv' },
      el('li', {}, el('span', { class: 'k' }, 'Region'), el('span', { class: 'v' }, PHASE1_RULESET.rules.regions.join(', '))),
      el('li', {}, el('span', { class: 'k' }, 'Race type'), el('span', { class: 'v' }, PHASE1_RULESET.rules.raceTypes.join(', '))),
      el('li', {}, el('span', { class: 'k' }, 'Handicaps only'), el('span', { class: 'v' }, 'yes')),
      el('li', {}, el('span', { class: 'k' }, 'Classes'), el('span', { class: 'v' }, PHASE1_RULESET.rules.classes.join(', '))),
      el('li', {}, el('span', { class: 'k' }, 'Actual runners'), el('span', { class: 'v' }, `${PHASE1_RULESET.rules.minRunners}–${PHASE1_RULESET.rules.maxRunners}`)),
      el('li', {}, el('span', { class: 'k' }, 'Strong favourite'), el('span', { class: 'v' }, `exactly one at ≤ ${PHASE1_RULESET.rules.favouriteMaxFractional}`)),
      el('li', {}, el('span', { class: 'k' }, 'Longshot'), el('span', { class: 'v' }, `≥ ${PHASE1_RULESET.rules.longshotMinFractional}`)),
      el('li', {}, el('span', { class: 'k' }, 'Candidate'), el('span', { class: 'v' }, 'shortest longshot, ties → lowest number'))
    )
  );

  async function renderRecent() {
    const runs = (await listAnalysisRuns(10)).filter((run) => run.kind === 'A');
    mount(runRegion, el('div', {},
      el('h2', {}, 'Recent Backtest A runs'),
      runs.length === 0
        ? el('p', { class: 'muted' }, 'No runs yet.')
        : table([
            { label: 'Run', render: (r) => `${r.label}` },
            { label: 'When', render: (r) => fmtDateTime(r.createdAt) },
            { label: 'Races', className: 'num', render: (r) => r.report.totals.racesInWindow },
            { label: 'Qualified', className: 'num', render: (r) => r.report.totals.qualified },
            { label: '', render: (r) => el('a', { class: 'button', href: `#/report/${r.id}` }, 'Open report') }
          ], runs)
    ));
  }

  mount(container,
    pageTitle('Backtest A', 'Replay the locked Phase 1 rules over stored, validated data. Descriptive statistics only; no staking or money concepts exist anywhere in this project.'),
    el('div', { class: 'grid-wide' }, form, rulesCard),
    runRegion
  );

  await renderRecent();
}
