import { el, pageTitle, mount, button, badge, fmtDateTime, notice, toast, inputField, confirmAction, navigate } from '../ui.js';
import { PHASE1_RULESET, makeExperimentalRuleset, validateExperimentalRules } from '../core/rules-core.js';
import { addStrategyVersion, listStrategyVersions, deleteStrategyVersion, setSetting } from '../storage.js';

export async function render(container, ctx) {
  const listRegion = el('div', {});

  const nameInput = inputField('Name', { type: 'text', value: '', placeholder: 'e.g. Widen classes to 1-7' });
  const notesInput = el('textarea', { rows: 3, placeholder: 'What is this version for?' });
  const configInput = el('textarea', { rows: 12, class: 'mono' });
  configInput.value = JSON.stringify(PHASE1_RULESET.rules, null, 2);

  const feedback = el('div', {});

  async function createVersion() {
    const name = nameInput.querySelector('input').value.trim() || 'Untitled strategy';
    const notes = notesInput.value.trim();
    let config;
    try {
      config = JSON.parse(configInput.value);
    } catch (error) {
      mount(feedback, notice(`Config is not valid JSON: ${error.message}`, 'bad'));
      return;
    }
    const check = validateExperimentalRules(config);
    if (!check.ok) {
      mount(feedback, notice(el('div', {}, check.errors.map((e) => el('div', {}, `${e.field}: ${e.message}`))), 'bad'));
      return;
    }
    const isPhase1 = JSON.stringify({ ...PHASE1_RULESET.rules, ...config }) === JSON.stringify(PHASE1_RULESET.rules);
    const ruleset = isPhase1 ? PHASE1_RULESET : makeExperimentalRuleset(config);
    const version = {
      name,
      notes,
      locked: ruleset.locked === true,
      baseVersion: ruleset.baseVersion || PHASE1_RULESET.version,
      rulesetId: ruleset.id,
      rulesetVersion: ruleset.version,
      rules: ruleset.rules
    };
    await addStrategyVersion(version);
    toast('Strategy version saved.', 'ok');
    mount(feedback, notice(`Saved "${name}" as ${ruleset.locked ? 'a locked Phase 1 snapshot' : 'an unlocked experimental version'}.`, 'ok'));
    await renderList();
  }

  async function renderList() {
    const versions = await listStrategyVersions();
    const active = ctx.state.settings.activeStrategyVersionId;
    if (versions.length === 0) {
      mount(listRegion, el('p', { class: 'muted' }, 'No strategy versions saved yet. Snapshots live only in this browser profile.'));
      return;
    }
    mount(listRegion, el('div', { class: 'grid-wide' }, versions.map((version) => el('div', { class: 'card' },
      el('h3', {}, version.name),
      el('p', { class: 'row' },
        version.locked ? badge('Phase 1 snapshot', 'ok') : badge('experimental', 'warn'),
        version.id === active ? badge('active reference', 'info') : null
      ),
      version.notes ? el('p', { class: 'muted small' }, version.notes) : null,
      el('ul', { class: 'kv' },
        el('li', {}, el('span', { class: 'k' }, 'Created'), el('span', { class: 'v' }, fmtDateTime(version.createdAt))),
        el('li', {}, el('span', { class: 'k' }, 'Ruleset version'), el('span', { class: 'v' }, version.rulesetVersion))
      ),
      el('details', {}, el('summary', {}, 'Rules'), el('pre', { class: 'mono small' }, JSON.stringify(version.rules, null, 2))),
      el('div', { class: 'card-actions' },
        button('Mark active', async () => {
          await setSetting('activeStrategyVersionId', version.id);
          ctx.state.settings.activeStrategyVersionId = version.id;
          toast(`"${version.name}" is now the active reference.`, 'ok');
          await renderList();
        }),
        button('Delete', async () => {
          if (ctx.state.settings.confirmBeforeDelete !== false && !(await confirmAction(`Delete strategy "${version.name}"?`))) return;
          await deleteStrategyVersion(version.id);
          toast('Deleted.', 'ok');
          await renderList();
        }, { className: 'danger' })
      )
    ))));
  }

  mount(container,
    pageTitle('Strategy versions', 'Snapshots of rule configurations for comparison. A snapshot never changes the locked Phase 1 ruleset; it only documents what you tried.'),
    el('div', { class: 'card' },
      el('h3', {}, `Locked reference · ${PHASE1_RULESET.version}`),
      el('p', { class: 'muted' }, 'Backtest A always uses this ruleset. Everything else is sandbox material.'),
      el('div', { class: 'card-actions' }, button('Open Backtest A', () => navigate('#/backtest-a')), button('Open Backtest B', () => navigate('#/backtest-b')))
    ),
    el('h2', {}, 'Create a version'),
    el('div', { class: 'card' },
      nameInput,
      el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
      el('div', { class: 'field' }, el('label', {}, 'Rules config (JSON, validated with the experimental sandbox rules)'), configInput),
      feedback,
      el('div', { class: 'card-actions' }, button('Save version', createVersion, { className: 'primary' }))
    ),
    el('h2', {}, 'Saved versions'),
    listRegion
  );

  await renderList();
}
