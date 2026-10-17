const DB_NAME = 'atr-research-db';
const DB_VERSION = 1;

export const STORES = Object.freeze({
  settings: 'settings',
  analysisRuns: 'analysisRuns',
  selectionJournal: 'selectionJournal',
  dataCache: 'dataCache',
  imports: 'imports',
  datasets: 'datasets',
  strategyVersions: 'strategyVersions'
});

export const DEFAULT_SETTINGS = Object.freeze({
  includeFixturesInBacktests: false,
  requireValidationPassed: true,
  backtestFrom: '2026-08-01',
  backtestTo: '2026-08-15',
  activeStrategyVersionId: null,
  confirmBeforeDelete: true
});

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORES.analysisRuns)) db.createObjectStore(STORES.analysisRuns, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.selectionJournal)) db.createObjectStore(STORES.selectionJournal, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.dataCache)) db.createObjectStore(STORES.dataCache, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORES.imports)) db.createObjectStore(STORES.imports, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.datasets)) db.createObjectStore(STORES.datasets, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.strategyVersions)) db.createObjectStore(STORES.strategyVersions, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(storeName, mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    try {
      result = run(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted.'));
  }));
}

export function idbPut(storeName, value) {
  return tx(storeName, 'readwrite', (store) => store.put(value));
}

export function idbGet(storeName, key) {
  return tx(storeName, 'readonly', (store) => store.get(key));
}

export function idbGetAll(storeName) {
  return tx(storeName, 'readonly', (store) => store.getAll());
}

export function idbDelete(storeName, key) {
  return tx(storeName, 'readwrite', (store) => store.delete(key));
}

export function idbClear(storeName) {
  return tx(storeName, 'readwrite', (store) => store.clear());
}

export function makeId(prefix) {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${rand.slice(0, 8)}`;
}

export async function getAllSettings() {
  const rows = await idbGetAll(STORES.settings);
  const merged = { ...DEFAULT_SETTINGS };
  for (const row of rows || []) {
    if (row && typeof row.key === 'string') merged[row.key] = row.value;
  }
  return merged;
}

export async function getSetting(key, fallback) {
  const row = await idbGet(STORES.settings, key);
  if (row && row.value !== undefined) return row.value;
  if (DEFAULT_SETTINGS[key] !== undefined) return DEFAULT_SETTINGS[key];
  return fallback;
}

export async function setSetting(key, value) {
  await idbPut(STORES.settings, { key, value });
  return value;
}

export async function saveAnalysisRun(run) {
  await idbPut(STORES.analysisRuns, run);
  return run;
}

export async function listAnalysisRuns(limit = 20) {
  const rows = await idbGetAll(STORES.analysisRuns);
  return (rows || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}

export function getAnalysisRun(id) {
  return idbGet(STORES.analysisRuns, id);
}

export async function addJournalEntry(entry) {
  const row = { id: makeId('journal'), createdAt: new Date().toISOString(), ...entry };
  await idbPut(STORES.selectionJournal, row);
  return row;
}

export async function listJournal(limit = 100) {
  const rows = await idbGetAll(STORES.selectionJournal);
  return (rows || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}

export async function addDataset(entry) {
  const row = { id: entry.id || makeId('dataset'), createdAt: new Date().toISOString(), ...entry };
  await idbPut(STORES.datasets, row);
  return row;
}

export async function listDatasets() {
  const rows = await idbGetAll(STORES.datasets);
  return (rows || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getDatasetRecord(id) {
  return idbGet(STORES.datasets, id);
}

export function deleteDatasetRecord(id) {
  return idbDelete(STORES.datasets, id);
}

export async function addImportRecord(entry) {
  const row = { id: entry.id || makeId('import'), createdAt: new Date().toISOString(), ...entry };
  await idbPut(STORES.imports, row);
  return row;
}

export async function listImports() {
  const rows = await idbGetAll(STORES.imports);
  return (rows || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function addStrategyVersion(version) {
  const row = { id: version.id || makeId('strategy'), createdAt: new Date().toISOString(), ...version };
  await idbPut(STORES.strategyVersions, row);
  return row;
}

export async function listStrategyVersions() {
  const rows = await idbGetAll(STORES.strategyVersions);
  return (rows || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getStrategyVersion(id) {
  return idbGet(STORES.strategyVersions, id);
}

export function deleteStrategyVersion(id) {
  return idbDelete(STORES.strategyVersions, id);
}

export async function cachePut(key, payload) {
  await idbPut(STORES.dataCache, { key, payload, fetchedAt: new Date().toISOString() });
}

export async function cacheGet(key) {
  const row = await idbGet(STORES.dataCache, key);
  return row ? { payload: row.payload, fetchedAt: row.fetchedAt } : null;
}

export async function storageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  } catch {
    return null;
  }
}
