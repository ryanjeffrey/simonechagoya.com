/**
 * Live inventory for single pieces, so a one-of-one necklace cannot sell twice.
 *
 * The site is static, so a piece only shows Sold after a rebuild. Between the
 * sale and the rebuild, this store is the source of truth. It lives in Netlify
 * Blobs (store `inventory`):
 *
 *   orders/<checkout session id>  what a checkout bought, written by the Stripe webhook
 *   holds/<slug>                  a single piece reserved while a buyer is in Stripe Checkout
 *
 * Only single pieces (stock 1, no variants) are guarded. Prints and small runs
 * keep the stock number in their product file, which Simone lowers by hand.
 *
 * Outside Netlify there is no store: local dev and local builds use the product
 * files as they are, and checkout skips the guards.
 */
import { getStore, type Store } from '@netlify/blobs';
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

/** Slugs with a recorded order, paid or awaiting a delayed payment. */
export async function soldSlugs(s = inventoryStore()): Promise<Set<string>> {
  const sold = new Set<string>();
  if (!s) return sold;
  const { blobs } = await s.list({ prefix: 'orders/' });
  const orders = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' }) as Promise<Order | null>));
  for (const order of orders) for (const line of order?.lines ?? []) sold.add(line.slug);
  return sold;
}

let buildTimeSold: Promise<Set<string>> | undefined;

/**
 * Marks single pieces with an order as sold. Pages built after a sale show it as
 * Sold. `fresh` skips the per-process cache, for checkout at request time.
 */
export async function withInventory(products: Product[], { fresh = false } = {}): Promise<Product[]> {
  let sold: Set<string>;
  try {
    sold = await (fresh ? soldSlugs() : (buildTimeSold ??= soldSlugs()));
  } catch (err) {
    console.warn('Inventory store unreachable; using product files as they are.', err);
    return products;
  }
  if (!sold.size) return products;
  return products.map((p) =>
    p.data.status === 'available' && isSinglePiece(p) && sold.has(p.id)
      ? { ...p, data: { ...p.data, status: 'sold' as const } }
      : p,
  );
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
