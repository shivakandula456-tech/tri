import { mount, parseHash } from './ui.js';
import { getAllSettings, DEFAULT_SETTINGS } from './storage.js';
import * as dashboard from './views/dashboard.js';
import * as finder from './views/finder.js';
import * as selection from './views/selection.js';
import * as backtestA from './views/backtestA.js';
import * as backtestB from './views/backtestB.js';
import * as backtestReport from './views/backtest-report.js';
import * as strategy from './views/strategy.js';
import * as validation from './views/validation.js';
import * as settingsView from './views/settings.js';

export const state = {
  settings: { ...DEFAULT_SETTINGS }
};

export const ROUTES = [
  { id: 'dashboard', nav: 'Dashboard', hash: '#/', match: (segments) => segments.length === 0, view: dashboard },
  { id: 'finder', nav: 'Race finder', hash: '#/finder', match: (segments) => segments[0] === 'finder', view: finder },
  { id: 'selection', nav: null, hash: null, match: (segments) => segments[0] === 'selection', view: selection },
  { id: 'backtest-a', nav: 'Backtest A', hash: '#/backtest-a', match: (segments) => segments[0] === 'backtest-a', view: backtestA },
  { id: 'backtest-b', nav: 'Backtest B', hash: '#/backtest-b', match: (segments) => segments[0] === 'backtest-b', view: backtestB },
  { id: 'report', nav: null, hash: null, match: (segments) => segments[0] === 'report', view: backtestReport },
  { id: 'strategy', nav: 'Strategies', hash: '#/strategy', match: (segments) => segments[0] === 'strategy', view: strategy },
  { id: 'validation', nav: 'Validation', hash: '#/validation', match: (segments) => segments[0] === 'validation', view: validation },
  { id: 'settings', nav: 'Settings', hash: '#/settings', match: (segments) => segments[0] === 'settings', view: settingsView }
];

function renderNav(activeId) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  mount(nav, ROUTES.filter((route) => route.nav).map((route) => {
    const anchor = document.createElement('a');
    anchor.href = route.hash;
    anchor.textContent = route.nav;
    if (route.id === activeId) anchor.className = 'active';
    return anchor;
  }));
}

export async function refreshSettings() {
  try {
    state.settings = { ...DEFAULT_SETTINGS, ...(await getAllSettings()) };
  } catch {
    state.settings = { ...DEFAULT_SETTINGS };
  }
  return state.settings;
}

async function renderRoute() {
  const container = document.getElementById('view');
  if (!container) return;
  const { segments, query } = parseHash(window.location.hash);
  const route = ROUTES.find((candidate) => candidate.match(segments)) || ROUTES[0];
  renderNav(route.id);
  document.title = `${route.nav || 'Selection'} · ATR Phase 1 Research`;
  await refreshSettings();
  mount(container, document.createElement('p'));
  container.firstChild.textContent = 'Loading…';
  try {
    await route.view.render(container, { segments, query, state, routeId: route.id });
  } catch (error) {
    mount(container, document.createElement('div'));
    container.firstChild.className = 'notice notice-bad';
    container.firstChild.textContent = `This view failed to load: ${error.message}`;
  }
  window.scrollTo({ top: 0 });
}

async function boot() {
  await refreshSettings();
  renderNav('dashboard');
  window.addEventListener('hashchange', () => {
    renderRoute().catch(() => {});
  });
  await renderRoute();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
}
