import { round } from './util.js';

export const STRONG_FAVOURITE_MAX_DECIMAL = 3.5;
export const LONGSHOT_MIN_DECIMAL = 11;
export const ODDS_EPSILON = 1e-9;

const COMMON_PRICES = [
  [2, '1/1'],
  [2.1, '11/10'],
  [2.2, '6/5'],
  [2.25, '5/4'],
  [2.375, '11/8'],
  [2.5, '6/4'],
  [2.625, '13/8'],
  [2.75, '7/4'],
  [2.875, '15/8'],
  [3, '2/1'],
  [3.125, '85/40'],
  [3.25, '9/4'],
  [3.5, '5/2'],
  [3.75, '11/4'],
  [4, '3/1'],
  [4.2, '16/5'],
  [4.3333, '100/30'],
  [4.5, '7/2'],
  [5, '4/1'],
  [5.5, '9/2'],
  [6, '5/1'],
  [6.5, '11/2'],
  [7, '6/1'],
  [7.5, '13/2'],
  [8, '7/1'],
  [8.5, '15/2'],
  [9, '8/1'],
  [9.5, '17/2'],
  [10, '9/1'],
  [11, '10/1'],
  [12, '11/1'],
  [13, '12/1'],
  [14, '13/1'],
  [15, '14/1'],
  [17, '16/1'],
  [19, '18/1'],
  [21, '20/1'],
  [23, '22/1'],
  [26, '25/1'],
  [29, '28/1'],
  [34, '33/1'],
  [41, '40/1'],
  [51, '50/1'],
  [67, '66/1'],
  [81, '80/1'],
  [101, '100/1']
];

export function roundOdds(value) {
  return round(value, 4);
}

export function parseFractional(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 1) return null;
    return roundOdds(value);
  }
  let s = String(value).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (s === 'evens' || s === 'even' || s === 'evs') s = '1/1';
  if (s.includes('.')) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 1) return null;
    return roundOdds(n);
  }
  const m = s.match(/^(\d+)(?:\/(\d+))?$/);
  if (!m) return null;
  const num = Number(m[1]);
  const den = m[2] === undefined ? 1 : Number(m[2]);
  if (!(num > 0) || !(den > 0)) return null;
  const decimal = 1 + num / den;
  if (decimal > 1001) return null;
  return roundOdds(decimal);
}

export function toFraction(value, maxDen = 1000, tolerance = 1e-6) {
  if (!Number.isFinite(value) || value <= 0) return null;
  let bestN = 1;
  let bestD = 1;
  let bestErr = Math.abs(value - 1);
  const h = [0, 1];
  const k = [1, 0];
  let x = value;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(x);
    const n = a * h[1] + h[0];
    const d = a * k[1] + k[0];
    if (d > maxDen) break;
    h[0] = h[1];
    h[1] = n;
    k[0] = k[1];
    k[1] = d;
    const err = Math.abs(value - n / d);
    if (err < bestErr) {
      bestErr = err;
      bestN = n;
      bestD = d;
    }
    if (err < tolerance) break;
    const frac = x - a;
    if (frac < 1e-12) break;
    x = 1 / frac;
  }
  return { numerator: bestN, denominator: bestD, error: bestErr };
}

export function decimalToFractional(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  for (const [dec, label] of COMMON_PRICES) {
    if (Math.abs(dec - decimal) < 0.0005) return label;
  }
  const ratio = toFraction(decimal - 1);
  if (!ratio) return null;
  if (ratio.numerator === ratio.denominator) return '1/1';
  return `${ratio.numerator}/${ratio.denominator}`;
}

export function isStrongFavourite(decimal, maxDecimal = STRONG_FAVOURITE_MAX_DECIMAL) {
  return Number.isFinite(decimal) && decimal <= maxDecimal + ODDS_EPSILON;
}

export function isLongshot(decimal, minDecimal = LONGSHOT_MIN_DECIMAL) {
  return Number.isFinite(decimal) && decimal >= minDecimal - ODDS_EPSILON;
}

export function oddsRatioCompare(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function formatDecimalOdds(decimal) {
  return Number.isFinite(decimal) ? decimal.toFixed(2) : '';
}
