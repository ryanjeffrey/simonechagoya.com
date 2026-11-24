/**
 * Everything the studio dashboard counts, in one load: website orders from
 * Stripe, sales and expenses Simone entered, commission payments, and costs.
 */
import { STRIPE_SECRET_KEY } from 'astro:env/server';
import Stripe from 'stripe';
import { inventoryStore } from './inventory';
import { getCosts, listExpenses, listRequests, listSales, requestSales } from './ledger';
import type { KV } from './studio-store';
import { websiteSales, type WebsiteSales } from './website-sales';

export const stripeClient = () => (STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null);

export const stripeTestMode = () => Boolean(STRIPE_SECRET_KEY?.includes('_test_'));

export const byDateDesc = (a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date);

export async function loadLedger(kv: KV, { website = true } = {}) {
  const [web, manual, expenses, requests, costs] = await Promise.all([
    website ? websiteSales(stripeClient(), kv, inventoryStore()) : Promise.resolve<WebsiteSales>({ sales: [], toShip: 0, unlabeled: 0 }),
    listSales(kv),
    listExpenses(kv),
    listRequests(kv),
    getCosts(kv),
  ]);
  const sales = [...web.sales, ...manual, ...requestSales(requests)].sort(byDateDesc);
  return { sales, web, manual, expenses: expenses.sort(byDateDesc), requests, costs };
}

export type Ledger = Awaited<ReturnType<typeof loadLedger>>;
