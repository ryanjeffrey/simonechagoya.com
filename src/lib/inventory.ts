/**
 * Live inventory, so a one-of-one necklace cannot sell twice and a small run
 * cannot sell more than it has.
 *
 * The site is static, so a piece only shows Sold after a rebuild. Between the
 * sale and the rebuild, this store is the source of truth. It lives in Netlify
 * Blobs (store `inventory`):
 *
 *   orders/<checkout session id>  what a checkout bought, written by the Stripe webhook
 *   holds/<slug>                  a single piece reserved while a buyer is in Stripe Checkout
 *
 * Every recorded order counts against `stock` in the product file, so `stock`
 * is how many were ever offered here, and restocking means raising it. Only
 * single pieces (stock 1, no variants) are also held during Checkout.
 *
 * Outside Netlify there is no store: local dev and local builds use the product
 * files as they are, and checkout skips the guards.
 */
import { getStore, type Store } from '@netlify/blobs';
import { STRIPE_SECRET_KEY } from 'astro:env/server';
import type { Product } from './catalog';

export type OrderLine = { slug: string; variant?: string; qty: number };
type Order = { lines: OrderLine[]; paid: boolean; at: string };
type Hold = { token: string; until: number };

/** Checkout sessions stay open 31 minutes (Stripe's minimum is 30); holds outlast them by a minute. */
export const HOLD_SECONDS = 32 * 60;

let store: Store | null | undefined;

export function inventoryStore(): Store | null {
  if (store === undefined) {
    try {
      store = getStore({ name: 'inventory', consistency: 'strong' });
    } catch {
      store = null; // Not running on Netlify.
    }
  }
  return store;
}

export const isSinglePiece = (p: Product) => p.data.stock === 1 && p.data.variants.length === 0;

/** Units with a recorded order, paid or awaiting a delayed payment, keyed by slug and by `slug:variant`. */
export async function soldCounts(s = inventoryStore()): Promise<Map<string, number>> {
  const sold = new Map<string, number>();
  if (!s) return sold;
  // Test orders share the store with real ones; once live keys are in, they stop counting.
  const live = Boolean(STRIPE_SECRET_KEY?.includes('_live_'));
  const { blobs } = await s.list({ prefix: 'orders/' });
  const keys = blobs.map((b) => b.key).filter((key) => !(live && key.startsWith('orders/cs_test_')));
  const orders = await Promise.all(keys.map((key) => s.get(key, { type: 'json' }) as Promise<Order | null>));
  const add = (key: string, qty: number) => sold.set(key, (sold.get(key) ?? 0) + qty);
  for (const order of orders) {
    for (const line of order?.lines ?? []) {
      add(line.slug, line.qty);
      if (line.variant) add(`${line.slug}:${line.variant}`, line.qty);
    }
  }
  return sold;
}

let buildTimeSold: Promise<Map<string, number>> | undefined;

/**
 * Subtracts recorded orders from stock, and marks products that ran out as
 * sold. Pages built after a sale show it. `fresh` skips the per-process cache,
 * for checkout at request time.
 */
export async function withInventory(products: Product[], { fresh = false } = {}): Promise<Product[]> {
  let sold: Map<string, number>;
  try {
    sold = await (fresh ? soldCounts() : (buildTimeSold ??= soldCounts()));
  } catch (err) {
    console.warn('Inventory store unreachable; using product files as they are.', err);
    return products;
  }
  if (!sold.size) return products;
  return products.map((p) => {
    const count = sold.get(p.id);
    if (!count) return p;
    const stock = Math.max(0, p.data.stock - count);
    const variants = p.data.variants.map((v) =>
      v.stock === undefined ? v : { ...v, stock: Math.max(0, v.stock - (sold.get(`${p.id}:${v.id}`) ?? 0)) },
    );
    const soldOut = p.data.status === 'available' && !variants.length && stock === 0;
    return { ...p, data: { ...p.data, stock, variants, status: soldOut ? ('sold' as const) : p.data.status } };
  });
}

/** Reserves single pieces for one checkout. Returns the slugs it could not hold. */
export async function holdPieces(s: Store, slugs: string[], token: string): Promise<string[]> {
  const until = Date.now() + HOLD_SECONDS * 1000;
  const taken: string[] = [];
  const held: string[] = [];
  for (const slug of slugs) {
    if (await acquire(s, `holds/${slug}`, { token, until })) held.push(slug);
    else taken.push(slug);
  }
  if (taken.length) await releasePieces(s, held, token);
  return taken;
}

async function acquire(s: Store, key: string, hold: Hold): Promise<boolean> {
  if ((await s.setJSON(key, hold, { onlyIfNew: true })).modified) return true;
  const current = await s.getWithMetadata(key, { type: 'json' });
  if (!current) return (await s.setJSON(key, hold, { onlyIfNew: true })).modified;
  if ((current.data as Hold).until > Date.now()) return false;
  // The old hold has lapsed. Take it over only if nobody else did first.
  return (await s.setJSON(key, hold, { onlyIfMatch: current.etag })).modified;
}

/** Drops the holds this checkout owns. Holds taken over by a later checkout are left alone. */
export async function releasePieces(s: Store, slugs: string[], token: string | undefined) {
  if (!token) return;
  await Promise.all(
    slugs.map(async (slug) => {
      const key = `holds/${slug}`;
      const hold = (await s.get(key, { type: 'json' })) as Hold | null;
      if (hold?.token === token) await s.delete(key);
    }),
  );
}

/** Records a checkout's items. Idempotent per session; a paid order is never marked unpaid again. */
export async function recordOrder(s: Store, sessionId: string, lines: OrderLine[], paid: boolean) {
  const key = `orders/${sessionId}`;
  const existing = (await s.get(key, { type: 'json' })) as Order | null;
  await s.setJSON(key, { lines, paid: paid || Boolean(existing?.paid), at: existing?.at ?? new Date().toISOString() });
}

export async function deleteOrder(s: Store, sessionId: string) {
  await s.delete(`orders/${sessionId}`);
}
