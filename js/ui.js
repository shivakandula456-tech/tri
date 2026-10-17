import { formatDecimalOdds } from './core/odds.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (key === 'disabled') node.disabled = Boolean(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of children || []) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

export function h(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html).trim();
  return template.content.firstChild;
}

export function text(value) {
  return document.createTextNode(value === null || value === undefined ? '' : String(value));
}

export function fmtDate(dateKey) {
  if (!dateKey) return '';
  const parsed = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return String(dateKey);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

export function fmtDecimal(value) {
  return Number.isFinite(value) ? formatDecimalOdds(value) : '—';
}

export function fmtPct(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function badge(label, tone = 'muted') {
  return el('span', { class: `badge badge-${tone}` }, label);
}

export function metric(label, value, sub) {
  return el('div', { class: 'card metric' },
    el('span', { class: 'value' }, value),
    el('span', { class: 'label' }, label),
    sub ? el('span', { class: 'sub' }, sub) : null
  );
}

export function notice(message, tone = 'warn') {
  const cls = tone === 'bad' ? 'notice notice-bad' : tone === 'ok' ? 'notice notice-ok' : tone === 'info' ? 'notice notice-info' : 'notice';
  return el('div', { class: cls }, message);
}

export function empty(message) {
  return el('div', { class: 'empty' }, message);
}

export function table(columns, rows) {
  const thead = el('thead', {},
    el('tr', {}, columns.map((col) => el('th', { class: col.className || '' }, col.label)))
  );
  const tbody = el('tbody', {}, rows.map((row) => el('tr', {},
    columns.map((col) => {
      const content = col.render ? col.render(row) : row[col.key];
      return el('td', { class: col.className || '' }, content === null || content === undefined ? '' : content);
    })
  )));
  return el('div', { class: 'table-wrap' }, el('table', {}, thead, tbody));
}

export function button(label, onClick, options = {}) {
  return el('button', { class: options.className || '', onclick: onClick, disabled: options.disabled, type: options.type || 'button', title: options.title || '' }, label);
}

export function link(label, href, className = '') {
  return el('a', { href, class: className }, label);
}

export function field(labelText, control, hint) {
  return el('div', { class: 'field' },
    el('label', {}, labelText),
    control,
    hint ? el('span', { class: 'small faint' }, hint) : null
  );
}

export function inputField(labelText, { type = 'text', value = '', onInput, placeholder, min, max, step, id }) {
  const input = el('input', { type, value, placeholder, min, max, step, id });
  if (typeof onInput === 'function') input.addEventListener('input', () => onInput(input.value));
  return field(labelText, input);
}

export function selectField(labelText, options, value, onChange, hint) {
  const select = el('select', {}, options.map((option) => el('option', { value: option.value, selected: String(option.value) === String(value) }, option.label)));
  if (typeof onChange === 'function') select.addEventListener('change', () => onChange(select.value));
  return field(labelText, select, hint);
}

export function checkbox(labelText, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'inline-check' }, input, labelText);
}

export function barRow(label, count, total, tone = '') {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return el('div', { class: 'bar-row' },
    el('span', { title: label }, label),
    el('div', { class: 'bar-track' }, el('div', { class: `bar-fill ${tone}`.trim(), style: `width:${pct}%` })),
    el('span', { class: 'bar-count' }, String(count))
  );
}

export function toast(message, tone = 'info') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const node = el('div', { class: `toast ${tone}` }, message);
  region.appendChild(node);
  setTimeout(() => node.remove(), 5200);
}

export function downloadText(filename, textContent, mime = 'text/plain') {
  const blob = new Blob([textContent], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: filename });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function confirmAction(message) {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return Promise.resolve(true);
  return Promise.resolve(window.confirm(message));
}

export function navigate(hash) {
  if (typeof window !== 'undefined') window.location.hash = hash;
}

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');
  return { segments, query };
}

export function pageTitle(title, lede) {
  return el('header', {},
    el('h1', {}, title),
    lede ? el('p', { class: 'lede' }, lede) : null
  );
}

export async function guard(container, promiseFn) {
  try {
    await promiseFn();
  } catch (error) {
    mount(container, notice(`Could not load this view: ${error.message}`, 'bad'));
  }
}
