/**
 * The studio's money math: fees, periods, per-sale profit and the summary.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  csv,
  etsyFee,
  monthly,
  parseMoney,
  period,
  saleMath,
  stripeFee,
  summarize,
} from '../src/lib/finance.ts';

test('fees match Stripe and Simone’s Etsy sheet', () => {
  assert.equal(stripeFee(250), 7.55);
  assert.equal(stripeFee(0), 0);
  // Her 2026 Inventory sheet: $24.20 on $250, $14.70 on $150, $9.95 on $100, $8.05 on $80, $6.15 on $60.
  assert.equal(etsyFee(250), 24.2);
  assert.equal(etsyFee(150), 14.7);
  assert.equal(etsyFee(100), 9.95);
  assert.equal(etsyFee(80), 8.05);
  assert.equal(etsyFee(60), 6.15);
});

test('periods are whole months and years in Chicago time', () => {
  assert.deepEqual(period('month', '2026-11-24'), { key: 'month', label: 'This month', from: '2026-11-01', to: '2026-12-01' });
  assert.deepEqual(period('last-month', '2026-01-10'), { key: 'last-month', label: 'Last month', from: '2025-12-01', to: '2026-01-01' });
  assert.equal(period('year', '2026-11-24').from, '2026-01-01');
  assert.equal(period('last-year', '2026-11-24').to, '2026-01-01');
});

// Made-up costs: Simone's real ones live only in the private studio store.
const costs = { 'smoke-necklace': { cost: 90 }, 'honey-necklace': { cost: 8 } };

const website = {
  id: 'cs_1',
  date: '2026-11-20',
  channel: 'website',
  items: [{ title: 'Smoke Necklace', slug: 'smoke-necklace', qty: 1, amount: 250 }],
  shipping: 0,
  fees: 7.55,
  labelCost: 12,
  tax: 25.63,
};

const etsy = {
  id: 'etsy-honey',
  date: '2026-04-13',
  channel: 'etsy',
  items: [{ title: 'Honey Necklace', slug: 'honey-necklace', qty: 1, amount: 100 }],
  shipping: 6,
  fees: 9.95,
  labelCost: 9,
};

test('a sale’s profit uses the piece’s cost record', () => {
  const m = saleMath(website, costs);
  assert.equal(m.cogs, 90);
  assert.equal(m.net, 250 - 7.55 - 12 - 90);
  assert.equal(m.missingCost, 0);
  const unknown = saleMath({ ...website, items: [{ title: 'Mystery', qty: 1, amount: 50 }] }, costs);
  assert.equal(unknown.missingCost, 1);
  const own = saleMath({ ...website, items: [{ title: 'Card set', qty: 2, amount: 80, cost: 19 }] }, costs);
  assert.equal(own.cogs, 19);
});

test('the summary nets out fees, labels, piece costs and running costs, never tax or supplies', () => {
  const expenses = [
    { id: 'e1', date: '2026-11-02', category: 'Website and software', vendor: 'Domain', amount: 20 },
    { id: 'e2', date: '2026-11-03', category: 'Beads and stones', vendor: 'Bead supplier', amount: 150 },
    { id: 'e3', date: '2026-11-04', category: 'Donations', vendor: 'A charity', amount: 25 },
  ];
  const s = summarize([website, etsy], expenses, costs, period('month', '2026-11-24'));
  assert.equal(s.count, 1);
  assert.equal(s.gross, 250);
  assert.equal(s.taxCollected, 25.63);
  assert.equal(s.supplies, 150);
  assert.equal(s.running, 20);
  assert.equal(s.donations, 25);
  assert.equal(s.net, Math.round((250 - 7.55 - 12 - 90 - 20 - 25) * 100) / 100);
  // Selling the Smoke Necklace direct: Etsy would have taken $24.20, Stripe took $7.55.
  assert.deepEqual(s.direct, { orders: 1, etsyWouldCharge: 24.2, stripeCharged: 7.55, saved: 16.65 });

  const year = summarize([website, etsy], [], costs, period('year', '2026-11-24'));
  assert.equal(year.count, 2);
  assert.equal(year.etsyFeesPaid, 9.95);
  assert.deepEqual(year.byChannel.map((c) => c.channel), ['website', 'etsy']);
  assert.equal(year.topPieces[0].slug, 'smoke-necklace');
});

test('monthly rows cover twelve months', () => {
  const rows = monthly([website, etsy], [], costs, 2026);
  assert.equal(rows.length, 12);
  assert.equal(rows[3].label, 'Apr');
  assert.equal(rows[3].count, 1);
  assert.equal(rows[10].gross, 250);
});

test('money and CSV inputs are cleaned', () => {
  assert.equal(parseMoney('$1,234.567'), 1234.57);
  assert.equal(parseMoney('nonsense'), 0);
  assert.equal(csv([['a', 'b,c', '=SUM(A1)', -5]]), 'a,"b,c",\'=SUM(A1),-5\n');
});
