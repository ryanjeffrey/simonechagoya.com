/**
 * Renders the order emails from a sample order.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmationEmail, orderNumber, saleEmail, shippedEmail, trackingUrl } from '../src/lib/order-mail.ts';

const order = {
  id: 'cs_live_a1B2c3D4e5F6g7H8',
  number: orderNumber('cs_live_a1B2c3D4e5F6g7H8'),
  created: '2026-10-18T15:04:00.000Z',
  email: 'buyer@example.com',
  name: 'Jordan <Lee>',
  phone: null,
  shipTo: ['Jordan Lee', '123 W Main St', 'Chicago, IL 60601'],
  items: [
    { name: 'Smoke Necklace', qty: 1, amount: 14800, image: 'https://simonechagoya.com/_astro/smoke.jpg' },
    { name: 'Stardust (8x10)', qty: 2, amount: 9000 },
  ],
  subtotal: 23800,
  shipping: 1800,
  shippingMethod: 'Express shipping',
  express: true,
  discount: 2380,
  tax: 0,
  total: 23220,
  giftNote: 'Happy birthday, Mom',
  paid: true,
};

test('order numbers are short and stable', () => {
  assert.equal(order.number, 'SC-F6G7H8');
  assert.match(orderNumber('cs_test_xyz123abc'), /^SC-[A-Z0-9]{6}$/);
});

test('confirmation has the items, totals, address and gift note, escaped', () => {
  const email = confirmationEmail(order);
  assert.match(email.subject, /SC-/);
  for (const part of ['Smoke Necklace', '$148.00', '-$23.80', '$232.20', '123 W Main St', 'Happy birthday, Mom', 'Thank you, Jordan.']) {
    assert.ok(email.html.includes(part), `html has ${part}`);
    assert.ok(email.text.includes(part), `text has ${part}`);
  }
  assert.ok(!email.html.includes('<Lee>'), 'names are escaped');
  assert.ok(!/—/.test(email.html + email.text), 'no em dashes');
});

test('the sale alert flags express and links to the orders page', () => {
  const email = saleEmail(order, 'https://simonechagoya.com/studio');
  assert.match(email.subject, /^Express order: Smoke Necklace, Stardust \(8x10\) x2 \(\$232\.20\)$/);
  assert.ok(email.html.includes('https://simonechagoya.com/studio'));
  assert.ok(email.text.includes('buyer@example.com'));
});

test('the shipping email links to the carrier', () => {
  const shipment = { carrier: 'usps', tracking: '9400 1000', shippedAt: '2026-10-20T15:00:00.000Z' };
  const email = shippedEmail(order, shipment);
  assert.ok(email.html.includes('https://tools.usps.com/go/TrackConfirmAction?tLabels=9400%201000'));
  assert.ok(email.text.includes('Tracking number: 9400 1000'));
  assert.equal(trackingUrl({ carrier: 'other', tracking: 'X1' }), null);
  assert.ok(!shippedEmail(order, { ...shipment, tracking: '' }).html.includes('Track your package'));
});
