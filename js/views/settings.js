import { el, pageTitle, mount, button, checkbox, inputField, notice, toast, downloadText, readFileAsText, confirmAction, fmtDateTime, table } from '../ui.js';
import { setSetting, storageEstimate, STORES, idbGetAll, idbClear, listDatasets, addDataset, addImportRecord, deleteDatasetRecord } from '../storage.js';
import { importDatasetFromCsv, parseDatasetJson, exportDatasetCsv, racesToJsonExport } from '../core/csv.js';
import { validateRaceRecord } from '../core/validate-core.js';
import { PHASE1_RULESET } from '../core/rules-core.js';
import { invalidate } from '../data.js';

export async function render(container, ctx) {
  const settings = ctx.state.settings;

  const prefs = {
    backtestFrom: settings.backtestFrom || '2026-08-01',
    backtestTo: settings.backtestTo || '2026-08-15',
    includeFixturesInBacktests: settings.includeFixturesInBacktests === true,
    requireValidationPassed: settings.requireValidationPassed !== false,
    confirmBeforeDelete: settings.confirmBeforeDelete !== false
  };

  const importFeedback = el('div', {});
  const datasetRegion = el('div', {});
  const storageRegion = el('div', {});

  async function savePrefs() {
    for (const [key, value] of Object.entries(prefs)) await setSetting(key, value);
    Object.assign(ctx.state.settings, prefs);
    toast('Preferences saved.', 'ok');
  }

  const importOptions = { testData: false };
  const importInput = el('input', { type: 'file', accept: '.csv,.json,text/csv,application/json' });

  async function handleImport() {
    const file = importInput.files && importInput.files[0];
    if (!file) {
      toast('Choose a file first.', 'warn');
      return;
    }
    mount(importFeedback, el('p', { class: 'muted' }, `Reading ${file.name}…`));
    try {
      const text = await readFileAsText(file);
      let races = [];
      let rejected = [];
      let errors = [];
      let warnings = [];
      if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        const parsed = parseDatasetJson(text);
        for (const race of parsed.races) {
          const result = validateRaceRecord(race, { expectedDataset: undefined });
          if (result.errors.length > 0) rejected.push({ raceId: race.raceId || '(missing id)', reason: result.errors.map((e) => `${e.code}: ${e.message}`).join(' | ') });
          else {
            races.push({ ...race, dataset: 'imported', testData: importOptions.testData || race.testData === true, source: race.source || 'json-import' });
            for (const warning of result.warnings) warnings.push({ ...warning, raceId: race.raceId });
          }
        }
      } else {
        const result = importDatasetFromCsv(text, { dataset: 'imported' });
        races = result.races.map((race) => ({ ...race, testData: importOptions.testData || race.testData === true }));
        rejected = result.rejected;
        errors = result.errors;
        warnings = result.warnings;
      }

      if (races.length > 0) {
        const record = await addDataset({
          name: file.name,
          kind: 'imported',
          testData: races.some((race) => race.testData === true),
          source: 'file-import',
          races
        });
        await addImportRecord({ name: file.name, format: file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv', imported: races.length, rejected: rejected.length, datasetId: record.id });
        invalidate();
      }

      mount(importFeedback,
        notice(`Imported ${races.length} race(s). Rejected ${rejected.length}. Warnings ${warnings.length}.`, races.length > 0 ? 'ok' : 'bad'),
        errors.length > 0 ? notice(el('div', {}, errors.map((e) => el('div', {}, e.message))), 'bad') : null,
        rejected.length > 0 ? el('details', {}, el('summary', {}, `Rejected rows (${rejected.length})`), el('ul', {}, rejected.slice(0, 20).map((r) => el('li', { class: 'small' }, `${r.raceId}: ${r.reason}`)))) : null
      );
      await Promise.all([renderDatasets(), renderStorage()]);
    } catch (error) {
      mount(importFeedback, notice(`Import failed: ${error.message}`, 'bad'));
    }
    importInput.value = '';
  }

  async function renderDatasets() {
    const datasets = await listDatasets();
    if (datasets.length === 0) {
      mount(datasetRegion, el('p', { class: 'muted' }, 'No imported datasets stored.'));
      return;
    }
    mount(datasetRegion, table([
      { label: 'Name', render: (row) => row.name },
      { label: 'Races', className: 'num', render: (row) => (row.races || []).length },
      { label: 'Test data', render: (row) => row.testData ? 'yes' : 'no' },
      { label: 'Imported', render: (row) => fmtDateTime(row.createdAt) },
      { label: '', render: (row) => el('div', { class: 'row' },
          button('CSV', () => {
            const { csv } = exportDatasetCsv(row.races || []);
            downloadText(`${row.id}.csv`, csv, 'text/csv');
          }),
          button('JSON', () => downloadText(`${row.id}.json`, racesToJsonExport(row.races || [], { name: row.name, source: 'local-export' }), 'application/json')),
          button('Delete', async () => {
            if (ctx.state.settings.confirmBeforeDelete !== false && !(await confirmAction(`Delete dataset "${row.name}"?`))) return;
            await deleteDatasetRecord(row.id);
            invalidate();
            toast('Dataset deleted.', 'ok');
            await renderDatasets();
          }, { className: 'danger' })
        ) }
    ], datasets));
  }

  async function exportEverything() {
    const [settings, analysisRuns, selectionJournal, imports, datasets, strategyVersions] = await Promise.all([
      idbGetAll(STORES.settings),
      idbGetAll(STORES.analysisRuns),
      idbGetAll(STORES.selectionJournal),
      idbGetAll(STORES.imports),
      idbGetAll(STORES.datasets),
      idbGetAll(STORES.strategyVersions)
    ]);
    downloadText('atr-research-local-export.json', JSON.stringify({
      format: 'atr-research-local-export-1',
      exportedAt: new Date().toISOString(),
      settings, analysisRuns, selectionJournal, imports, datasets, strategyVersions
    }, null, 2), 'application/json');
  }

  async function renderStorage() {
    const estimate = await storageEstimate();
    const parts = [];
    if (estimate && estimate.usage !== null) {
      const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      parts.push(el('p', { class: 'muted' }, `Browser storage used: ${mb(estimate.usage)}${estimate.quota ? ` of about ${mb(estimate.quota)}` : ''}.`));
    }
    mount(storageRegion, ...parts);
  }

  mount(container,
    pageTitle('Settings', 'Preferences, local data management and import/export. Everything is stored in this browser profile only.'),
    el('div', { class: 'grid-wide' },
      el('div', { class: 'card' },
        el('h3', {}, 'Preferences'),
        el('div', { class: 'form-row' },
          inputField('Default backtest from', { type: 'date', value: prefs.backtestFrom, onInput: (value) => { prefs.backtestFrom = value; } }),
          inputField('Default backtest to', { type: 'date', value: prefs.backtestTo, onInput: (value) => { prefs.backtestTo = value; } })
        ),
        checkbox('Include synthetic fixtures in backtests by default', prefs.includeFixturesInBacktests, (checked) => { prefs.includeFixturesInBacktests = checked; }),
        checkbox('Require validation.status = passed in backtests', prefs.requireValidationPassed, (checked) => { prefs.requireValidationPassed = checked; }),
        checkbox('Ask before deleting stored items', prefs.confirmBeforeDelete, (checked) => { prefs.confirmBeforeDelete = checked; }),
        el('div', { class: 'card-actions' }, button('Save preferences', savePrefs, { className: 'primary' }))
      ),
      el('div', { class: 'card' },
        el('h3', {}, 'About'),
        el('ul', { class: 'kv' },
          el('li', {}, el('span', { class: 'k' }, 'Phase 1 ruleset'), el('span', { class: 'v' }, PHASE1_RULESET.version)),
          el('li', {}, el('span', { class: 'k' }, 'Collector version'), el('span', { class: 'v' }, '0.1.0')),
          el('li', {}, el('span', { class: 'k' }, 'Parser version'), el('span', { class: 'v' }, 'atr-parser-0.1.0')),
          el('li', {}, el('span', { class: 'k' }, 'Data schema'), el('span', { class: 'v' }, '1.0.0')),
          el('li', {}, el('span', { class: 'k' }, 'Storage database'), el('span', { class: 'v' }, 'atr-research-db'))
        ),
        el('p', { class: 'small faint' }, 'Collection is disabled until the repository owner confirms permission and reviews a probe run. No bypass of site protection exists in this project.')
      )
    ),
    el('h2', {}, 'Import data'),
    el('div', { class: 'card' },
      el('p', { class: 'muted' }, 'Import a dataset CSV (single combined format) or a JSON dataset export. Invalid records are rejected with reasons; nothing is silently fixed.'),
      el('div', { class: 'field' }, el('label', {}, 'File'), importInput),
      checkbox('Flag imported races as test data', importOptions.testData, (checked) => { importOptions.testData = checked; }),
      el('div', { class: 'card-actions' }, button('Import file', handleImport, { className: 'primary' })),
      importFeedback
    ),
    el('h2', {}, 'Export data'),
    el('div', { class: 'card' },
      el('p', { class: 'muted' }, 'Export every local record (settings, runs, journal, imports, datasets, strategies) as a single JSON backup.'),
      el('div', { class: 'card-actions' }, button('Export all local data', exportEverything))
    ),
    el('h2', {}, 'Imported datasets'),
    el('div', { class: 'card' }, datasetRegion),
    el('h2', {}, 'Danger zone'),
    el('div', { class: 'card' },
      storageRegion,
      el('div', { class: 'card-actions' },
        button('Clear journal', async () => {
          if (ctx.state.settings.confirmBeforeDelete !== false && !(await confirmAction('Clear every journal note?'))) return;
          await idbClear(STORES.selectionJournal);
          toast('Journal cleared.', 'ok');
        }, { className: 'danger' }),
        button('Clear analysis runs', async () => {
          if (ctx.state.settings.confirmBeforeDelete !== false && !(await confirmAction('Clear every stored backtest run?'))) return;
          await idbClear(STORES.analysisRuns);
          toast('Runs cleared.', 'ok');
        }, { className: 'danger' }),
        button('Clear strategy versions', async () => {
          if (ctx.state.settings.confirmBeforeDelete !== false && !(await confirmAction('Clear every saved strategy version?'))) return;
          await idbClear(STORES.strategyVersions);
          toast('Strategies cleared.', 'ok');
        }, { className: 'danger' })
      )
    )
  );

  await Promise.all([renderDatasets(), renderStorage()]);
}
