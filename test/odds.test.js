import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LONGSHOT_MIN_DECIMAL,
  STRONG_FAVOURITE_MAX_DECIMAL,
  decimalToFractional,
  isLongshot,
  isStrongFavourite,
  parseFractional
} from '../js/core/odds.js';

test('parseFractional normalises fractional prices to decimal', () => {
  assert.equal(parseFractional('5/2'), 3.5);
  assert.equal(parseFractional('10/1'), 11);
  assert.equal(parseFractional('4/6'), 1.6667);
  assert.equal(parseFractional('1/2'), 1.5);
  assert.equal(parseFractional('11/4'), 3.75);
  assert.equal(parseFractional('100/30'), 4.3333);
  assert.equal(parseFractional('7/4'), 2.75);
  assert.equal(parseFractional('9/4'), 3.25);
  assert.equal(parseFractional('6/4'), 2.5);
  assert.equal(parseFractional('2/1'), 3);
  assert.equal(parseFractional('33/1'), 34);
  assert.equal(parseFractional('evens'), 2);
  assert.equal(parseFractional('EVS'), 2);
  assert.equal(parseFractional(' 10/1 '), 11);
  assert.equal(parseFractional('3'), 4);
});

test('parseFractional handles decimal numbers and decimal strings', () => {
  assert.equal(parseFractional(3.5), 3.5);
  assert.equal(parseFractional('2.5'), 2.5);
  assert.equal(parseFractional('4.3333'), 4.3333);
});

test('parseFractional rejects malformed or impossible odds', () => {
  assert.equal(parseFractional(null), null);
  assert.equal(parseFractional(undefined), null);
  assert.equal(parseFractional(''), null);
  assert.equal(parseFractional('abc'), null);
  assert.equal(parseFractional('0/1'), null);
  assert.equal(parseFractional('5/0'), null);
  assert.equal(parseFractional('1.0'), null);
  assert.equal(parseFractional(0), null);
  assert.equal(parseFractional(1), null);
  assert.equal(parseFractional(-4), null);
  assert.equal(parseFractional('2000/1'), null);
});

test('boundary helpers use the locked Phase 1 thresholds', () => {
  assert.equal(STRONG_FAVOURITE_MAX_DECIMAL, 3.5);
  assert.equal(LONGSHOT_MIN_DECIMAL, 11);
  assert.equal(isStrongFavourite(3.5), true);
  assert.equal(isStrongFavourite(3.25), true);
  assert.equal(isStrongFavourite(2.5), true);
  assert.equal(isStrongFavourite(3.5002), false);
  assert.equal(isStrongFavourite(4), false);
  assert.equal(isLongshot(11), true);
  assert.equal(isLongshot(13), true);
  assert.equal(isLongshot(21), true);
  assert.equal(isLongshot(10.999), false);
  assert.equal(isLongshot(10), false);
});

test('decimalToFractional reconstructs common racing prices', () => {
  assert.equal(decimalToFractional(3.5), '5/2');
  assert.equal(decimalToFractional(11), '10/1');
  assert.equal(decimalToFractional(2), '1/1');
  assert.equal(decimalToFractional(2.5), '6/4');
  assert.equal(decimalToFractional(4.3333), '100/30');
  assert.equal(decimalToFractional(2.75), '7/4');
  assert.equal(decimalToFractional(34), '33/1');
  assert.equal(decimalToFractional(1.5), '1/2');
});

test('fractional to decimal to fractional round trip is stable for common prices', () => {
  const labels = ['1/1', '6/4', '5/2', '11/4', '100/30', '7/2', '4/1', '9/2', '10/1', '12/1', '16/1', '25/1', '33/1', '50/1', '100/1'];
  for (const label of labels) {
    const decimal = parseFractional(label);
    assert.ok(decimal !== null, `${label} parsed`);
    assert.equal(decimalToFractional(decimal), label, `${label} round trip`);
  }
});
