import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const viewModules = ['dashboard', 'finder', 'selection', 'backtestA', 'backtestB', 'backtest-report', 'strategy', 'validation', 'settings'];

test('every view module imports cleanly and exports render', async () => {
  for (const name of viewModules) {
    const mod = await import(new URL(`../js/views/${name}.js`, import.meta.url));
    assert.equal(typeof mod.render, 'function', `views/${name}.js must export render()`);
  }
});

test('shared view parts import cleanly and expose the shared helpers', async () => {
  const parts = await import(new URL('../js/views/parts.js', import.meta.url));
  for (const fn of ['statusBadge', 'resultBadge', 'datasetBadge', 'rejectionLabel', 'testDataBanner', 'traceList', 'runnerTable', 'raceFactsList', 'selectionSummary']) {
    assert.equal(typeof parts[fn], 'function', `parts.js must export ${fn}()`);
  }
  assert.equal(typeof parts.REJECTION_LABELS, 'object');
});

test('app module exposes routes and state without touching the DOM on import', async () => {
  const app = await import(new URL('../js/app.js', import.meta.url));
  assert.ok(Array.isArray(app.ROUTES));
  const ids = app.ROUTES.map((route) => route.id);
  for (const id of ['dashboard', 'finder', 'selection', 'backtest-a', 'backtest-b', 'report', 'strategy', 'validation', 'settings']) {
    assert.ok(ids.includes(id), `route ${id} must be registered`);
  }
  for (const route of app.ROUTES.filter((candidate) => candidate.nav)) {
    assert.match(route.hash, /^#\//, `nav route ${route.id} needs a hash`);
  }
  assert.equal(typeof app.state.settings, 'object');
});

test('ui and storage modules expose the shared helper surface', async () => {
  const ui = await import(new URL('../js/ui.js', import.meta.url));
  for (const fn of ['el', 'mount', 'table', 'toast', 'navigate', 'parseHash', 'downloadText']) {
    assert.equal(typeof ui[fn], 'function', `ui.js must export ${fn}()`);
  }
  const storage = await import(new URL('../js/storage.js', import.meta.url));
  for (const fn of ['openDb', 'getAllSettings', 'setSetting', 'saveAnalysisRun', 'addJournalEntry', 'addDataset', 'listDatasets', 'addStrategyVersion']) {
    assert.equal(typeof storage[fn], 'function', `storage.js must export ${fn}()`);
  }
  assert.equal(storage.STORES.datasets, 'datasets');
  assert.equal(storage.DEFAULT_SETTINGS.includeFixturesInBacktests, false);
});

test('data module exposes the dataset loading surface', async () => {
  const data = await import(new URL('../js/data.js', import.meta.url));
  for (const fn of ['getPublished', 'getFixtures', 'getImported', 'getAllEntries', 'toRaceList', 'summarize', 'evaluateEntry', 'invalidate']) {
    assert.equal(typeof data[fn], 'function', `data.js must export ${fn}()`);
  }
});

test('index.html wires the app shell and stylesheet', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  assert.match(html, /css\/styles\.css/);
  assert.match(html, /js\/app\.js/);
  assert.match(html, /id="nav"/);
  assert.match(html, /id="view"/);
  assert.match(html, /id="banners"/);
  assert.match(html, /id="toast-region"/);
});

test('backtest views map the fixtures toggle onto the core includeTestData option', () => {
  for (const name of ['backtestA', 'backtestB']) {
    const source = fs.readFileSync(path.join(rootDir, `js/views/${name}.js`), 'utf8');
    assert.match(source, /includeTestData: config\.includeFixtures/, `views/${name}.js must map includeFixtures onto options.includeTestData`);
  }
});

test('site sources never reference external network hosts', () => {
  const files = [
    'js/app.js', 'js/ui.js', 'js/data.js', 'js/storage.js',
    ...viewModules.map((name) => `js/views/${name}.js`),
    'js/views/parts.js'
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(rootDir, file), 'utf8');
    assert.ok(!/https?:\/\//.test(source.replace(/https:\/\/json-schema\.org[^\s"]*/g, '')), `${file} must not hard-code external URLs`);
  }
});
