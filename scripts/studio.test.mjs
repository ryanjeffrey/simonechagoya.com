/**
 * The studio's records: website orders read from Stripe (with a stand-in
 * Stripe client), commission payments as sales, and the backup round trip.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportAll, importAll, requestSales } from '../src/lib/ledger.ts';
import { websiteSales } from '../src/lib/website-sales.ts';

/** An in-memory studio store. */
function memoryKV() {
  const data = new Map();
  return {
    data,
    getJSON: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    setJSON: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => void data.delete(k),
    keys: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
  };
}

const created = Math.floor(Date.parse('2026-11-20T18:00:00Z') / 1000);

function fakeStripe({ feeAccess = true } = {}) {
  const calls = { lines: 0, intents: 0 };
  const sessions = [
    {
      id: 'cs_paid',
      created,
      metadata: { source: 'simonechagoya.com' },
      payment_status: 'paid',
      payment_intent: 'pi_1',
      amount_total: 27563,
      total_details: { amount_tax: 2563, amount_shipping: 0, amount_discount: 0 },
      shipping_cost: { amount_subtotal: 0 },
    },
    { id: 'cs_other_shop', created, metadata: { source: 'elsewhere' }, payment_status: 'paid' },
    { id: 'cs_unpaid', created, metadata: { source: 'simonechagoya.com' }, payment_status: 'unpaid' },
  ];
  return {
    calls,
    checkout: {
      sessions: {
        list: () => ({
          async *[Symbol.asyncIterator]() {
            yield* sessions;
          },
        }),
        listLineItems: async () => {
          calls.lines++;
          return {
            data: [
              {
                description: 'Smoke Necklace',
                quantity: 1,
                amount_subtotal: 25000,
                amount_discount: 0,
                price: { product: { metadata: { slug: 'smoke-necklace' } } },
              },
            ],
          };
        },
      },
    },
    paymentIntents: {
      retrieve: async () => {
        calls.intents++;
        if (!feeAccess) throw new Error('The provided key does not have the required permissions');
        return { latest_charge: { amount_refunded: 0, balance_transaction: { fee: 850 } } };
      },
    },
  };
}

function fakeInventory(shipments) {
  return { get: async (k) => shipments[k.replace('shipments/', '')] ?? null };
}

test('website orders come from this site’s paid sessions, with the exact fee and the label cost', async () => {
  const kv = memoryKV();
  const stripe = fakeStripe();
  const { sales, toShip, unlabeled } = await websiteSales(stripe, kv, fakeInventory({ cs_paid: { labelCost: 11.5 } }));
  assert.equal(sales.length, 1);
  const [sale] = sales;
  assert.equal(sale.date, '2026-11-20');
  assert.equal(sale.fees, 8.5);
  assert.equal(sale.feeEstimated, false);
  assert.equal(sale.tax, 25.63);
  assert.equal(sale.labelCost, 11.5);
  assert.deepEqual(sale.items, [{ title: 'Smoke Necklace', slug: 'smoke-necklace', qty: 1, amount: 250 }]);
  assert.equal(toShip, 0);
  assert.equal(unlabeled, 0);

  // The second load reads the cache: no more Stripe calls.
  await websiteSales(stripe, kv, fakeInventory({}));
  assert.deepEqual(stripe.calls, { lines: 1, intents: 1 });
});

test('without fee access the fee is Stripe’s standard rate, flagged as an estimate', async () => {
  const { sales, toShip } = await websiteSales(fakeStripe({ feeAccess: false }), memoryKV(), fakeInventory({}));
  assert.equal(sales[0].fees, 8.29); // 2.9% of $275.63 + 30 cents
  assert.equal(sales[0].feeEstimated, true);
  assert.equal(toShip, 1);
});

test('a refund is split between income and the sales tax it gives back', async () => {
  const stripe = fakeStripe();
  stripe.paymentIntents.retrieve = async () => ({ latest_charge: { amount_refunded: 27563, balance_transaction: { fee: 850 } } });
  const [sale] = (await websiteSales(stripe, memoryKV(), null)).sales;
  assert.equal(sale.refunded, 250);
  assert.equal(sale.tax, 0);
});

test('commission payments become sales, carrying their share of the cost', () => {
  const sales = requestSales([
    {
      id: 'r_1',
      created: '2026-10-01T15:00:00Z',
      source: 'Email',
      name: 'A client',
      type: 'Painting commission',
      message: '',
      status: 'making',
      quote: 1000,
      cost: 200,
      payments: [
        { id: 'pay_1', date: '2026-10-02', amount: 500 },
        { id: 'pay_2', date: '2026-11-15', amount: 500 },
      ],
      updated: '2026-11-15T00:00:00Z',
    },
  ]);
  assert.equal(sales.length, 2);
  assert.equal(sales[0].channel, 'commission');
  assert.equal(sales[0].items[0].cost, 100);
  assert.equal(sales[1].date, '2026-11-15');
});

test('a backup loads back the same, and loading it twice changes nothing', async () => {
  const kv = memoryKV();
  const file = {
    version: 1,
    costs: { 'honey-necklace': { cost: 8 } },
    sales: [{ id: 'etsy_1', date: '2026-04-01', channel: 'etsy', items: [{ title: 'Honey', qty: 1, amount: 100 }], shipping: 6, fees: 10, labelCost: 9 }],
    expenses: [{ id: 'exp_1', date: '2026-06-01', category: 'Marketing and ads', vendor: 'Ads', amount: 50 }],
    requests: [],
  };
  assert.deepEqual(await importAll(kv, file), { costs: 1, sales: 1, expenses: 1, requests: 0 });
  await importAll(kv, file);
  const backup = await exportAll(kv);
  assert.equal(backup.sales.length, 1);
  assert.equal(backup.expenses.length, 1);
  assert.equal(backup.costs['honey-necklace'].cost, 8);
  await assert.rejects(importAll(kv, { nope: true }), /not a studio backup/);
});
