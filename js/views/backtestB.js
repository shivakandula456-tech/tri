import { el, pageTitle, mount, button, checkbox, inputField, selectField, toast, navigate, notice, badge } from '../ui.js';
import { makeExperimentalRuleset, validateExperimentalRules, PHASE1_RULESET } from '../core/rules-core.js';
import { runBacktest } from '../core/backtest-core.js';
import { getAllEntries } from '../data.js';
import { saveAnalysisRun, makeId } from '../storage.js';

const REGIONS = ['GB', 'IRE', 'FR', 'USA'];
const RACE_TYPES = ['Flat', 'Hurdle', 'Chase', 'NH Flat'];
const CLASSES = [1, 2, 3, 4, 5, 6, 7];

export async function render(container, ctx) {
  const settings = ctx.state.settings;

  const config = {
    label: 'Untitled experiment',
    regions: [...PHASE1_RULESET.rules.regions],
    raceTypes: [...PHASE1_RULESET.rules.raceTypes],
    handicapOnly: true,
    classes: [...PHASE1_RULESET.rules.classes],
    minRunners: PHASE1_RULESET.rules.minRunners,
    maxRunners: PHASE1_RULESET.rules.maxRunners,
    favouriteMode: PHASE1_RULESET.rules.favouriteMode,
    favouriteMaxDecimal: PHASE1_RULESET.rules.favouriteMaxDecimal,
    longshotMinDecimal: PHASE1_RULESET.rules.longshotMinDecimal,
    from: settings.backtestFrom || '2026-08-01',
    to: settings.backtestTo || '2026-08-15',
    includeFixtures: settings.includeFixturesInBacktests === true,
    includeImported: false
  };

  const warningsRegion = el('div', {});
  const runRegion = el('div', {});

  function refreshValidation() {
    const result = validateExperimentalRules(config);
    const parts = [];
    if (result.errors.length > 0) parts.push(notice(el('div', {}, result.errors.map((e) => el('div', {}, `${e.field}: ${e.message}`))), 'bad'));
    if (result.warnings.length > 0) parts.push(notice(el('div', {}, result.warnings.map((w) => el('div', {}, `${w.field}: ${w.message}`))), 'warn'));
    if (parts.length === 0) parts.push(notice('This sandbox ruleset is valid.', 'ok'));
    mount(warningsRegion, ...parts);
  }

  async function runNow() {
    const check = validateExperimentalRules(config);
    if (!check.ok) {
      toast('Fix the configuration errors first.', 'bad');
      return;
    }
    runRegion.textContent = 'Running…';
    try {
      const ruleset = makeExperimentalRuleset(config);
      const entries = await getAllEntries({ includeFixtures: config.includeFixtures, includeImported: config.includeImported });
      const report = runBacktest({ races: entries.map((entry) => entry.race), ruleset, options: { ...config, includeTestData: config.includeFixtures } });
      const run = {
        id: makeId('run'),
        kind: 'B',
        label: `${config.label} · ${config.from} → ${config.to}`,
        createdAt: new Date().toISOString(),
        report
      };
      await saveAnalysisRun(run);
      toast('Experimental backtest complete.', 'ok');
      navigate(`#/report/${run.id}`);
    } catch (error) {
      mount(runRegion, notice(`Backtest failed: ${error.message}`, 'bad'));
    }
  }

  const forms = el('div', { class: 'grid-wide' },
    el('div', { class: 'card' },
      el('h3', {}, 'Scope'),
      inputField('Experiment label', { type: 'text', value: config.label, onInput: (value) => { config.label = value; } }),
      el('div', { class: 'field' }, el('label', {}, 'Regions'),
        el('div', {}, REGIONS.map((region) => checkbox(region, config.regions.includes(region), (checked) => {
          if (checked) config.regions.push(region);
          else config.regions = config.regions.filter((r) => r !== region);
          refreshValidation();
        })))),
      el('div', { class: 'field' }, el('label', {}, 'Race types'),
        el('div', {}, RACE_TYPES.map((type) => checkbox(type, config.raceTypes.includes(type), (checked) => {
          if (checked) config.raceTypes.push(type);
          else config.raceTypes = config.raceTypes.filter((t) => t !== type);
          refreshValidation();
        })))),
      checkbox('Handicaps only', config.handicapOnly, (checked) => { config.handicapOnly = checked; refreshValidation(); }),
      el('div', { class: 'field' }, el('label', {}, 'Classes'),
        el('div', {}, CLASSES.map((c) => checkbox(String(c), config.classes.includes(c), (checked) => {
          if (checked) config.classes.push(c);
          else config.classes = config.classes.filter((x) => x !== c);
          refreshValidation();
        }))))
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Thresholds'),
      el('div', { class: 'form-row' },
        inputField('Min runners', { type: 'number', value: config.minRunners, min: 2, max: 40, onInput: (value) => { config.minRunners = Number(value); refreshValidation(); } }),
        inputField('Max runners', { type: 'number', value: config.maxRunners, min: 2, max: 40, onInput: (value) => { config.maxRunners = Number(value); refreshValidation(); } })
      ),
      selectField('Favourite mode', [
        { value: 'exactlyOne', label: 'Exactly one strong favourite' },
        { value: 'atLeastOne', label: 'At least one strong favourite' },
        { value: 'ignore', label: 'Ignore favourite rule' }
      ], config.favouriteMode, (value) => { config.favouriteMode = value; refreshValidation(); }),
      el('div', { class: 'form-row' },
        inputField('Favourite max (decimal)', { type: 'number', value: config.favouriteMaxDecimal, min: 1.01, max: 50, step: 0.01, onInput: (value) => { config.favouriteMaxDecimal = Number(value); refreshValidation(); } }),
        inputField('Longshot min (decimal)', { type: 'number', value: config.longshotMinDecimal, min: 1.01, max: 300, step: 0.01, onInput: (value) => { config.longshotMinDecimal = Number(value); refreshValidation(); } })
      ),
      el('div', { class: 'form-row' },
        inputField('From', { type: 'date', value: config.from, onInput: (value) => { config.from = value; } }),
        inputField('To', { type: 'date', value: config.to, onInput: (value) => { config.to = value; } })
      ),
      checkbox('Include synthetic fixtures', config.includeFixtures, (checked) => { config.includeFixtures = checked; }),
      checkbox('Include imported datasets', config.includeImported, (checked) => { config.includeImported = checked; })
    )
  );

  mount(container,
    pageTitle('Backtest B', 'Sandbox for experimental rulesets. Anything run here is explicitly unlocked and can never be presented as Phase 1 output.'),
    notice('Experimental rulesets are for sandbox research only. They do not replace the locked Phase 1 ruleset and their reports are permanently marked as unlocked.', 'info'),
    forms,
    warningsRegion,
    el('div', { class: 'card-actions' }, button('Run Backtest B', runNow, { className: 'primary' }), badge('unlocked sandbox', 'warn')),
    runRegion
  );

  refreshValidation();
}
