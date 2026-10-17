export function fnv1a(input) {
  const str = String(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v === undefined ? null : v;
    if (Array.isArray(v)) return v.map(walk);
    if (seen.has(v)) throw new Error('stableStringify: circular structure');
    seen.add(v);
    const out = {};
    for (const key of Object.keys(v).sort()) {
      if (v[key] !== undefined) out[key] = walk(v[key]);
    }
    seen.delete(v);
    return out;
  };
  return JSON.stringify(walk(value));
}

export function slugify(text, fallback = 'x') {
  const s = String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

export function round(value, decimals = 4) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

export function parseDateKey(value) {
  return new Date(`${value}T00:00:00Z`);
}

export function addDays(dateKey, delta) {
  const d = parseDateKey(dateKey);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function eachDate(from, to, limit = 400) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < limit) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

export function isoNow(date = new Date()) {
  return date.toISOString();
}

export function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
