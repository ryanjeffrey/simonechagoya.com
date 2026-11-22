/**
 * The sale window, which pieces it covers and how prices round.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { site } from '../src/data/site.ts';
import { checkoutPrice, saleActive, saleCovers, salePhase, salePrice, saleWindow } from '../src/lib/sale.ts';

const sale = site.sale;

test('the sale window runs midnight to midnight, Chicago time', { skip: !sale }, () => {
  const at = (iso) => salePhase(Date.parse(iso));
  assert.equal(at('2026-11-22T12:00:00-06:00'), 'soon');
  assert.equal(at('2026-11-26T23:59:59-06:00'), 'soon');
  assert.equal(at('2026-11-27T00:00:00-06:00'), 'on');
  assert.equal(at('2026-11-30T23:59:59-06:00'), 'on');
  assert.equal(at('2026-12-01T00:00:00-06:00'), null);
  assert.equal(saleActive(Date.parse('2026-11-28T09:00:00-06:00')), true);
  assert.equal(saleActive(Date.parse('2026-12-02T09:00:00-06:00')), false);
  assert.ok(saleWindow.ends > saleWindow.starts);
});

test('jewelry and prints for sale are covered; paintings, cards and sold pieces are not', { skip: !sale }, () => {
  assert.equal(saleCovers({ category: 'necklaces', status: 'available' }), true);
  assert.equal(saleCovers({ category: 'prints', status: 'available' }), true);
  assert.equal(saleCovers({ category: 'cards', status: 'available' }), false);
  assert.equal(saleCovers({ category: 'originals', status: 'inquire' }), false);
  assert.equal(saleCovers({ category: 'originals', status: 'available' }), false);
  assert.equal(saleCovers({ category: 'necklaces', status: 'sold' }), false);
  // A piece already marked down keeps its own price.
  assert.equal(saleCovers({ category: 'necklaces', status: 'available', compareAt: 300 }), false);
});

test('sale prices are 20% off, to the cent', { skip: !sale }, () => {
  assert.equal(sale.percentOff, 20);
  assert.equal(salePrice(250), 200);
  assert.equal(salePrice(150), 120);
  assert.equal(salePrice(60), 48);
  assert.equal(salePrice(50), 40);
  assert.equal(salePrice(80), 64);
  assert.equal(salePrice(19.99), 15.99);
});

test('checkout charges the sale price only during the sale, and only for covered pieces', { skip: !sale }, () => {
  const during = Date.parse('2026-11-28T10:00:00-06:00');
  const before = Date.parse('2026-11-26T10:00:00-06:00');
  const after = Date.parse('2026-12-01T00:00:01-06:00');
  const necklace = { category: 'necklaces', status: 'available' };
  const print = { category: 'prints', status: 'available' };
  const cards = { category: 'cards', status: 'available' };
  assert.deepEqual(checkoutPrice(necklace, 250, during), { unit: 200, reduced: true });
  assert.deepEqual(checkoutPrice(print, 50, during), { unit: 40, reduced: true });
  assert.deepEqual(checkoutPrice(cards, 30, during), { unit: 30, reduced: false });
  assert.deepEqual(checkoutPrice(necklace, 250, before), { unit: 250, reduced: false });
  assert.deepEqual(checkoutPrice(necklace, 250, after), { unit: 250, reduced: false });
});

test('free shipping is judged on the discounted subtotal', { skip: !sale }, () => {
  // An $80 necklace is $64 on sale: under the $75 threshold, so standard shipping applies.
  assert.ok(salePrice(80) < site.shipping.freeThreshold);
  // A $100 necklace is $80 on sale: still over.
  assert.ok(salePrice(100) >= site.shipping.freeThreshold);
});
